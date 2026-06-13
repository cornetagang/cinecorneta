// ===========================================================
// MÓDULO DE UNIVERSOS — GALAXY UI
// ===========================================================
// Todo el CSS se inyecta en un <style> tag (no toca main.css).
// Uso: initUniverses(dependencies) → renderUniversesHub()
// ===========================================================

let shared;
let isInitialized = false;
let domBuilt = false;

// ── Performance / visual settings ──────────────────────────
// Defaults: animaciones OFF, logos solo en hover
const perfSettings = {
  animations: false,
  logosAlwaysVisible: false,
};

// ── State ──────────────────────────────────────────────────
let currentUniverseId = null;
let currentSagaObj = null;
let _lastGalaxyPos = null;
let _lastPlanetPos = null;
let gridMode = false;
let sortMode = "saga"; // 'saga' | 'cronologico'

// NUEVAS VARIABLES PARA MARVEL (o cualquier universo con fases)
let activeSubSaga = "all";
let activePhase = "all";

// Función global para que los botones de filtro puedan actualizar la vista
window.setUniverseFilter = function (type, value) {
  if (type === "saga") {
    activeSubSaga = value;
    activePhase = "all"; // Si cambias de saga, resetear fase
  } else if (type === "fase") {
    activePhase = value;
    activeSubSaga = "all"; // Si cambias a fase, resetear saga
  }
  // Volver a renderizar la grilla con el nuevo filtro aplicado
  if (currentSagaObj) renderMovieCards(currentSagaObj);
};

window.setUniverseSort = function (mode) {
  sortMode = mode;
  if (currentSagaObj) renderMovieCards(currentSagaObj);
};

// Galaxy pan/zoom
let gDrag = false,
  gDragStart = { x: 0, y: 0 },
  gPan = { x: 0, y: 0 },
  gScale = 1;
let _gDirty = false,
  _gRafPending = false;

// Particles
const _galaxyParticles = [];
let _lastGPF = 0;
let _particleLoopAF = null;

// Stars
let stars = [];
let starAF = null;
let _lastStarF = 0;

// ─────────────────────────────────────────────────────────────
// 1. INIT
// ─────────────────────────────────────────────────────────────
export function initUniverses(dependencies) {
  if (isInitialized) return;
  shared = dependencies;
  isInitialized = true;
  injectStyles();
  loadSettings(); // intento inicial (puede fallar si aún no hay usuario)

  // Re-cargar cuando el usuario loguea (resuelve el caso de "no había sesión al init")
  if (shared.auth) {
    shared.auth.onAuthStateChanged((user) => {
      if (user) loadSettings();
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 2. RENDER HUB (llamado cada vez que switchView("sagas"))
// ─────────────────────────────────────────────────────────────
export function renderUniversesHub() {
  if (!domBuilt) buildDOM();

  invalidateDataCache();
  const sagas = getSortedSagas();

  // Reset state
  currentUniverseId = null;
  currentSagaObj = null;
  gridMode = false;

  resetUI();
  syncSettingsUI();
  buildGalaxy(sagas);
  buildGridView(sagas);
  startStarCanvas();
  startParticleLoop();
  updateNavOffset();

  // Centrar galaxia en el inicio
  gPan = { x: 0, y: 0 };
  gScale = 1;
  applyGalaxy();
}

// ─────────────────────────────────────────────────────────────
// 3. CSS INJECTION
// ─────────────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById("universes-css")) return;
  const s = document.createElement("style");
  s.id = "universes-css";
  s.textContent = `
/* ═══ UNIVERSES MODULE ════════════════════════════════════ */

/* Convertir el contenedor en overlay full-screen */
#sagas-hub-container {
    position: fixed !important;
    inset: 0 !important;
    z-index: 50 !important;
    overflow: hidden !important;
    padding: 0 !important;
    background: #05070a;
    font-family: "Montserrat", "Bebas Neue", sans-serif;
    color: #f8fafc;
}
#sagas-hub-container .content-header { display: none !important; }
#sagas-hub-container .sagas-grid     { display: none !important; }

/* Grain overlay */
#sagas-hub-container::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E");
    opacity: .025;
    pointer-events: none;
    z-index: 9998;
}

/* Star canvas */
#univ-star-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
}

/* ── Galaxy Wrapper ─────────────────────────── */
#univ-galaxy-wrapper {
    position: absolute;
    inset: 0;
    z-index: 10;
    overflow: hidden;
    cursor: grab;
    touch-action: none;   /* bloquea zoom/pan nativo del browser en mobile */
}
#univ-galaxy-wrapper.dragging { cursor: grabbing; }
#univ-galaxy-map {
    position: absolute;
    width: 3200px;
    height: 2200px;
    will-change: transform;
    user-select: none;
    transform-origin: 0 0;
}

/* Map hint */
.univ-map-hint {
    position: absolute;
    top: calc(var(--univ-nav-h, 64px) + 16px);
    left: 50%;
    transform: translateX(-50%);
    font-size: .6rem;
    font-weight: 600;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: rgba(255,255,255,.2);
    z-index: 400;
    pointer-events: none;
    animation: univ-hint-fade 3s 2s forwards;
}
@keyframes univ-hint-fade { from{opacity:1} to{opacity:0} }
@keyframes univ-galaxy-enter { from{opacity:0;transform:scale(.4)} to{opacity:1;transform:scale(1)} }
@keyframes univ-planet-enter { from{opacity:0;transform:scale(.2)} to{opacity:1;transform:scale(1)} }

/* ── Planet System ──────────────────────────── */
.univ-planet-system {
    position: absolute;
    cursor: pointer;
    transform-origin: center;
}
.univ-planet-system:hover { z-index: 100; }
.univ-planet-system:hover .univ-planet-label {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
}

.univ-planet-logo-wrap {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2;
    padding: 14%;
}
.univ-planet-logo-wrap img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    filter: drop-shadow(0 2px 10px rgba(0,0,0,.95)) brightness(1.2);
    opacity: 0;
    transition: opacity .35s ease;
}
.univ-planet-system:hover .univ-planet-logo-wrap img { opacity: 1; }

.univ-planet-label {
    position: absolute;
    bottom: 0px;
    left: 50%;
    transform: translateX(-50%) translateY(4px);
    text-align: center;
    opacity: 0;
    transition: opacity .3s, transform .3s;
    pointer-events: none;
    white-space: nowrap;
}
.univ-planet-label-name {
    font-size: .72rem;
    font-weight: 800;
    color: #f8fafc;
    letter-spacing: .5px;
    text-shadow: 0 2px 8px rgba(0,0,0,.8);
    display: block;
}
.univ-planet-label-count {
    font-size: .55rem;
    font-weight: 700;
    color: var(--accent-color, #3b82f6);
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-top: 2px;
    display: block;
}

/* ── Universe Overlay (grid de películas) ───── */
#univ-universe-overlay {
    position: absolute;
    inset: 0;
    z-index: 500;
    background: rgba(5,7,10,0);
    pointer-events: none;
    transition: background .5s ease;
    overflow-y: auto;
}
#univ-universe-overlay.active {
    background: rgba(5,7,10,.97);
    pointer-events: all;
}
#univ-universe-inner {
    opacity: 0;
    transition: opacity .4s .25s ease;
    padding: calc(var(--univ-nav-h, 64px) + 72px) 5% 60px;
    max-width: 1500px;
    margin: 0 auto;
}
#univ-universe-overlay.active #univ-universe-inner { opacity: 1; }

/* Header del universo dentro del overlay */
.univ-ov-logo {
    height: 48px;
    max-width: 180px;
    object-fit: contain;
    filter: drop-shadow(0 2px 12px rgba(0,0,0,.9)) brightness(1.1);
    flex-shrink: 0;
}
.univ-ov-meta { display: flex; flex-direction: column; gap: 4px; }
.univ-ov-title {
    font-size: .6rem;
    font-weight: 700;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: var(--accent-color, #3b82f6);
}
.univ-ov-count {
    font-size: .52rem;
    font-weight: 600;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #64748b;
}

/* Grid de películas */
.univ-ov-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
}
.univ-ov-card {
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.07);
    transition: transform .25s cubic-bezier(.34,1.56,.64,1), border-color .25s, box-shadow .25s;
    animation: univ-planet-enter .4s ease both;
}
.univ-ov-card:hover {
    transform: translateY(-4px) scale(1.02);
    border-color: rgba(59,130,246,.4);
    box-shadow: 0 12px 32px rgba(0,0,0,.5), 0 0 0 1px rgba(59,130,246,.2);
}
.univ-ov-card-poster {
    width: 100%;
    aspect-ratio: 2/3;
    object-fit: cover;
    display: block;
    filter: brightness(.85) saturate(1.1);
    transition: filter .25s;
}
.univ-ov-card:hover .univ-ov-card-poster { filter: brightness(1) saturate(1.3); }
.univ-ov-card-info {
    padding: 10px 12px 12px;
}
.univ-ov-card-title {
    font-size: .68rem;
    font-weight: 800;
    color: #f8fafc;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.univ-ov-card-year {
    font-size: .55rem;
    font-weight: 600;
    color: var(--accent-color, #3b82f6);
    margin-top: 4px;
    display: block;
    letter-spacing: .5px;
}

@media (max-width: 900px)  { .univ-ov-grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); } }
@media (max-width: 600px)  { .univ-ov-grid { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; } }

/* ── Back Button ────────────────────────────── */
#univ-back-btn {
    position: absolute;
    top: calc(var(--univ-nav-h, 64px) + 14px);
    left: 24px;
    z-index: 600;
    display: none;
    align-items: center;
    gap: 8px;
    background: rgba(15,23,42,.9);
    border: 1px solid rgba(255,255,255,.1);
    border-radius: 50px;
    padding: 10px 18px;
    color: #64748b;
    font-size: .65rem;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    cursor: pointer;
    transition: all .3s;
    backdrop-filter: blur(12px);
    font-family: inherit;
}
#univ-back-btn.visible { display: flex; }
#univ-back-btn:hover { color: #f8fafc; border-color: rgba(59,130,246,.4); background: rgba(59,130,246,.08); }

/* ── Universe Label ─────────────────────────── */
#univ-universe-label {
    position: absolute;
    top: calc(var(--univ-nav-h, 64px) + 14px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 600;
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    pointer-events: none;
    opacity: 0;
    transition: opacity .4s .5s;
}
#univ-universe-label.visible { display: flex; opacity: 1; }
#univ-label-name {
    font-size: .65rem;
    font-weight: 700;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: var(--accent-color, #3b82f6);
}
#univ-label-sub {
    font-size: .52rem;
    font-weight: 600;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #64748b;
}

/* ── Floating Controls ──────────────────────── */
#univ-controls {
    position: absolute;
    top: calc(var(--univ-nav-h, 64px) + 14px);
    right: 2%;
    z-index: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: opacity .3s;
}
#univ-controls.hidden { opacity:0; pointer-events:none; }

.univ-search-wrap {
    position: relative;
}
.univ-search-box {
    display: flex;
    align-items: center;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.1);
    border-radius: 50px;
    padding: 8px 16px;
    gap: 8px;
    width: 220px;
    transition: all .3s;
}
.univ-search-box:focus-within { border-color:rgba(59,130,246,.5); box-shadow:0 0 20px rgba(59,130,246,.1); }
.univ-search-box svg { opacity:.5; flex-shrink:0; }
.univ-search-box input {
    background:transparent; border:none; outline:none;
    color:#f8fafc; font-size:.8rem; width:100%; font-family:inherit;
}
.univ-search-box input::placeholder { color:#64748b; }

.univ-search-dropdown {
    display: none;
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    right: 0;
    background: rgba(10,14,28,.97);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 14px;
    overflow: hidden;
    z-index: 3000;
    box-shadow: 0 20px 40px rgba(0,0,0,.6);
}
.univ-sdrop-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    cursor: pointer;
    transition: background .2s;
    border-bottom: 1px solid rgba(255,255,255,.04);
}
.univ-sdrop-item:last-child { border-bottom: none; }
.univ-sdrop-item:hover { background: rgba(59,130,246,.08); }
.univ-sdrop-logo { width:32px; height:32px; object-fit:contain; filter:drop-shadow(0 1px 4px rgba(0,0,0,.8)); flex-shrink:0; }
.univ-sdrop-name { font-size:.75rem; font-weight:700; color:#f8fafc; display:block; }
.univ-sdrop-meta { font-size:.58rem; font-weight:600; color:#64748b; margin-top:2px; display:block; }

.univ-toggle-btn {
    width:40px; height:40px; border-radius:50%;
    background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1);
    color:#64748b; display:flex; align-items:center; justify-content:center;
    cursor:pointer; transition:all .3s; flex-shrink:0;
}
.univ-toggle-btn:hover { border-color:rgba(59,130,246,.4); color:#f8fafc; }
.univ-toggle-btn svg { width:16px; height:16px; stroke:currentColor; fill:none; stroke-width:2; }

/* ── Grid View ──────────────────────────────── */
#univ-grid-view {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: none;
    overflow-y: auto;
    padding: calc(var(--univ-nav-h, 64px) + 28px) 5% 40px;
    background: rgba(5,7,10,.98);
}
#univ-grid-view.active { display: block; }
.univ-grid-inner {
    display: grid;
    grid-template-columns: repeat(5,1fr);
    gap: 16px;
    max-width: 1500px;
    margin: 0 auto;
}
.univ-grid-card {
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.07);
    border-radius: 18px;
    padding: 22px 16px 18px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    transition: background .25s, border-color .25s, transform .25s;
    text-align: center;
}
.univ-grid-card:hover {
    background: rgba(59,130,246,.09);
    border-color: rgba(59,130,246,.35);
    transform: translateY(-3px);
    box-shadow: 0 8px 32px rgba(59,130,246,.12);
}
.univ-grid-card-logo  { width:160px; height:64px; object-fit:contain; filter:drop-shadow(0 2px 10px rgba(0,0,0,.85)); }
.univ-grid-card-name  { font-size:.72rem; font-weight:800; color:#f8fafc; }
.univ-grid-card-count { font-size:.6rem; font-weight:700; color:var(--accent-color,#3b82f6); letter-spacing:1.2px; text-transform:uppercase; }

/* ── Scrollbar ─────────────────────────────── */
#univ-grid-view::-webkit-scrollbar,
#univ-universe-overlay::-webkit-scrollbar { width:4px; }
#univ-grid-view::-webkit-scrollbar-track,
#univ-universe-overlay::-webkit-scrollbar-track { background:transparent; }
#univ-grid-view::-webkit-scrollbar-thumb,
#univ-universe-overlay::-webkit-scrollbar-thumb { background:rgba(255,255,255,.08); border-radius:2px; }

/* ── Responsive ─────────────────────────────── */
@media (max-width: 1200px) { .univ-grid-inner { grid-template-columns: repeat(4,1fr); } }
@media (max-width: 900px)  { .univ-grid-inner { grid-template-columns: repeat(3,1fr); } }
@media (max-width: 600px) {
    .univ-grid-inner {
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
    }

    /* Padding lateral reducido para que las cards usen más ancho */
    /* padding-bottom extra cubre la tab bar inferior (~70px) */
    #univ-grid-view { padding-left: 12px; padding-right: 12px; padding-bottom: 90px; }

    /* Logo y card adaptados al ancho real disponible */
    .univ-grid-card { padding: 16px 10px 14px; border-radius: 14px; gap: 8px; }
    .univ-grid-card-logo { width: 100%; max-width: 120px; height: 52px; }

    /* Universe overlay con espacio para la barra */
    #univ-universe-inner { padding-top: calc(var(--univ-nav-h,56px) + 72px); }

    /* ── Barra de controles full-width en mobile ── */
    #univ-controls {
        top: var(--univ-nav-h, 56px);
        left: 0;
        right: 0;
        width: 100%;
        padding: 8px 12px;
        gap: 8px;
        background: rgba(5,7,10,.85);
        backdrop-filter: blur(12px);
        border-bottom: 1px solid rgba(255,255,255,.06);
        box-sizing: border-box;
    }

    /* Search ocupa todo el espacio disponible */
    .univ-search-wrap { flex: 1; min-width: 0; }
    .univ-search-box  { width: 100%; }

    /* Botones compactos */
    .univ-toggle-btn { width: 36px; height: 36px; flex-shrink: 0; }

    /* Back button y label ajustados a la barra */
    #univ-back-btn { left: 12px; padding: 8px 14px; top: calc(var(--univ-nav-h,56px) + 56px); }
    #univ-universe-label { top: calc(var(--univ-nav-h,56px) + 56px); }

    /* Grid view con espacio para la barra */
    #univ-grid-view { padding-top: calc(var(--univ-nav-h,56px) + 64px); }
}

/* ── Settings panel ─────────────────────────── */
.univ-settings-wrap { position: relative; }

#univ-settings-panel {
    display: none;
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    width: 230px;
    background: rgba(10,14,28,.97);
    backdrop-filter: blur(24px);
    border: 1px solid rgba(255,255,255,.09);
    border-radius: 16px;
    padding: 6px 0;
    box-shadow: 0 20px 50px rgba(0,0,0,.7);
    z-index: 3000;
    overflow: hidden;
}
#univ-settings-panel.open { display: block; }

.univ-sett-header {
    font-size: .55rem;
    font-weight: 800;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: rgba(255,255,255,.25);
    padding: 10px 16px 6px;
}
.univ-sett-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 16px;
    gap: 12px;
    transition: background .15s;
    cursor: pointer;
}
.univ-sett-row:hover { background: rgba(255,255,255,.04); }

.univ-sett-info { display: flex; flex-direction: column; gap: 2px; }
.univ-sett-label {
    font-size: .72rem;
    font-weight: 700;
    color: #f8fafc;
}
.univ-sett-desc {
    font-size: .58rem;
    font-weight: 500;
    color: rgba(255,255,255,.3);
    line-height: 1.35;
}

/* Toggle pill */
.univ-toggle {
    position: relative;
    width: 36px;
    height: 20px;
    flex-shrink: 0;
}
.univ-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.univ-toggle-track {
    position: absolute;
    inset: 0;
    border-radius: 20px;
    background: rgba(255,255,255,.12);
    border: 1px solid rgba(255,255,255,.1);
    transition: background .25s, border-color .25s;
    cursor: pointer;
}
.univ-toggle input:checked + .univ-toggle-track {
    background: #3b82f6;
    border-color: #3b82f6;
}
.univ-toggle-track::after {
    content: '';
    position: absolute;
    top: 2px; left: 2px;
    width: 14px; height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: transform .25s cubic-bezier(.4,0,.2,1);
    box-shadow: 0 1px 4px rgba(0,0,0,.4);
}
.univ-toggle input:checked + .univ-toggle-track::after {
    transform: translateX(16px);
}

.univ-sett-divider {
    height: 1px;
    background: rgba(255,255,255,.05);
    margin: 4px 0;
}

/* Logos always visible */
#univ-galaxy-map.logos-always-visible .univ-planet-logo-wrap img {
    opacity: 1 !important;
    transition: none !important;
}

/* ── Sort toggle ─────────────────────────────── */
.univ-ov-header {
    display: flex;
    align-items: flex-end;
    gap: 20px;
    margin-bottom: 32px;
    flex-wrap: wrap;
}
.univ-ov-sort-wrap {
    margin-left: auto;
    display: flex;
    gap: 6px;
    align-items: center;
}
.univ-sort-btn {
    font-size: .58rem;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    padding: 6px 14px;
    border-radius: 50px;
    border: 1px solid rgba(255,255,255,.1);
    background: rgba(255,255,255,.05);
    color: rgba(255,255,255,.4);
    cursor: pointer;
    transition: all .2s;
    font-family: inherit;
}
.univ-sort-btn:hover {
    border-color: rgba(59,130,246,.4);
    color: #f8fafc;
}
.univ-sort-btn.active {
    background: rgba(59,130,246,.15);
    border-color: rgba(59,130,246,.5);
    color: #60a5fa;
}

/* ── Phase Dropdown ─────────────────────────── */
.univ-phase-dropdown-wrap {
    margin-left: auto;
    position: relative;
}
.univ-phase-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 50px;
    color: #f8fafc;
    font-size: .62rem;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    padding: 8px 16px;
    cursor: pointer;
    font-family: inherit;
    transition: border-color .2s;
    white-space: nowrap;
    user-select: none;
}
.univ-phase-btn:hover { border-color: rgba(59,130,246,.5); }
.univ-phase-menu {
    display: none;
    position: fixed;
    min-width: 160px;
    background: rgba(10,14,28,.97);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 14px;
    overflow: visible;
    z-index: 9999;
    box-shadow: 0 20px 40px rgba(0,0,0,.6);
}
.univ-phase-menu.open { display: block; }
.univ-phase-option {
    padding: 10px 16px;
    font-size: .68rem;
    font-weight: 700;
    color: rgba(255,255,255,.6);
    cursor: pointer;
    letter-spacing: .5px;
    transition: background .15s, color .15s;
    border-bottom: 1px solid rgba(255,255,255,.04);
}
.univ-phase-option:last-child { border-bottom: none; }
.univ-phase-option:hover { background: rgba(59,130,246,.08); color: #f8fafc; }
.univ-phase-option.active { color: #60a5fa; background: rgba(59,130,246,.1); }

/* ── Phase Drawer (mobile only) ─────────────────────────── */
.univ-phase-drawer-trigger {
    display: none;
    align-items: center;
    gap: 8px;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 50px;
    color: #f8fafc;
    font-size: .62rem;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    padding: 8px 16px;
    cursor: pointer;
    font-family: inherit;
    white-space: nowrap;
    user-select: none;
    transition: border-color .2s;
}
.univ-phase-drawer-trigger.has-active { border-color: rgba(59,130,246,.5); color: #60a5fa; }
.univ-phase-drawer-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.55);
    z-index: 1500;
    backdrop-filter: blur(2px);
    transform: translateZ(0);
    -webkit-transform: translateZ(0);
}
.univ-phase-drawer-overlay.open { display: block; }
.univ-phase-drawer {
    position: fixed;
    bottom: -100%;
    left: 0;
    right: 0;
    background: #0a0e1c;
    border-radius: 20px 20px 0 0;
    z-index: 1501;
    padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
    transition: bottom .35s cubic-bezier(.165,.84,.44,1);
    max-height: 70vh;
    overflow-y: auto;
    scrollbar-width: none;
    /* Fuerza capa GPU propia — supera el stacking context del mobile-tab-bar (translateZ/will-change) */
    transform: translateZ(0);
    -webkit-transform: translateZ(0);
    will-change: transform;
}
.univ-phase-drawer::-webkit-scrollbar { display: none; }
.univ-phase-drawer.open { bottom: 0; }
.univ-phase-drawer-handle {
    width: 36px;
    height: 4px;
    background: rgba(255,255,255,.15);
    border-radius: 2px;
    margin: 12px auto 4px;
}
.univ-phase-drawer-title {
    font-size: .6rem;
    font-weight: 800;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #64748b;
    padding: 10px 20px 14px;
    margin: 0;
    border-bottom: 1px solid rgba(255,255,255,.06);
}
.univ-phase-drawer-list {
    display: flex;
    flex-direction: column;
    padding: 8px 12px 0;
    gap: 2px;
}
.univ-phase-drawer-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 13px 10px;
    border-radius: 10px;
    cursor: pointer;
    color: #f8fafc;
    font-size: .95rem;
    font-weight: 500;
    border: none;
    background: transparent;
    width: 100%;
    text-align: left;
    font-family: inherit;
    transition: background .15s;
}
.univ-phase-drawer-item:active { background: rgba(255,255,255,.06); }
.univ-phase-drawer-item.active { color: #60a5fa; font-weight: 700; }
.univ-phase-drawer-check {
    color: #60a5fa;
    font-size: .85rem;
    opacity: 0;
    transition: opacity .15s;
}
.univ-phase-drawer-item.active .univ-phase-drawer-check { opacity: 1; }

/* Ítem tipo saga dentro del drawer de fases */
.univ-phase-drawer-saga {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 11px 10px;
    border-radius: 10px;
    cursor: pointer;
    color: rgba(255,255,255,.55);
    font-size: .72rem;
    font-weight: 800;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    border: none;
    background: transparent;
    width: 100%;
    text-align: left;
    font-family: inherit;
    transition: background .15s, color .15s;
    border-top: 1px solid rgba(255,255,255,.05);
    margin-top: 2px;
}
.univ-phase-drawer-saga:active { background: rgba(255,255,255,.04); }
.univ-phase-drawer-saga.active { color: #60a5fa; }
.univ-phase-drawer-saga .univ-phase-drawer-check {
    color: #60a5fa;
    font-size: .85rem;
    opacity: 0;
    transition: opacity .15s;
}
.univ-phase-drawer-saga.active .univ-phase-drawer-check { opacity: 1; }
@media (max-width: 768px) {
    .univ-phase-btn { display: none !important; }
    .univ-phase-menu { display: none !important; }
    .univ-phase-drawer-trigger { display: flex !important; }
}

/* ═══════════════════════════════════════════════════════════ */
    `;
  document.head.appendChild(s);
}

// ─────────────────────────────────────────────────────────────
// 4. DOM BUILD (una sola vez)
// ─────────────────────────────────────────────────────────────
function buildDOM() {
  const hub = document.getElementById("sagas-hub-container");
  if (!hub) return;

  hub.innerHTML = `
        <canvas id="univ-star-canvas"></canvas>

        <!-- Nebulas decorativas -->
        <div style="position:absolute;width:600px;height:600px;top:10%;left:-5%;border-radius:50%;pointer-events:none;z-index:1;filter:blur(80px);opacity:.06;background:radial-gradient(circle,#3b82f6,transparent 70%);"></div>
        <div style="position:absolute;width:400px;height:400px;bottom:15%;right:-2%;border-radius:50%;pointer-events:none;z-index:1;filter:blur(80px);opacity:.06;background:radial-gradient(circle,#8b5cf6,transparent 70%);"></div>

        <!-- Galaxy map -->
        <div id="univ-galaxy-wrapper">
            <div id="univ-galaxy-map"></div>
            <div class="univ-map-hint">Arrastrá para explorar · Scroll para hacer zoom</div>
        </div>

        <!-- Universe overlay (grid de películas) -->
        <div id="univ-universe-overlay">
            <div id="univ-universe-inner">
                <div class="univ-ov-header">
                    <img class="univ-ov-logo" id="univ-ov-logo" src="" alt=""/>
                    <div class="univ-ov-meta">
                        <span class="univ-ov-title" id="univ-ov-title"></span>
                        <span class="univ-ov-count" id="univ-ov-count"></span>
                    </div>
                </div>
                <div class="univ-ov-grid" id="univ-ov-grid"></div>
            </div>
        </div>

        <!-- Back button -->
        <button id="univ-back-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Galaxia
        </button>

        <!-- Universe label -->
        <div id="univ-universe-label">
            <span id="univ-label-name"></span>
            <span id="univ-label-sub"></span>
        </div>

        <!-- Floating controls -->
        <div id="univ-controls">
            <div class="univ-search-wrap">
                <div class="univ-search-box">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    <input id="univ-search-input" type="text" placeholder="Buscar universo…" autocomplete="off"/>
                </div>
                <div id="univ-search-dropdown" class="univ-search-dropdown"></div>
            </div>
            <button class="univ-toggle-btn" id="univ-toggle-btn" title="Cambiar vista">
                <svg id="univ-toggle-icon" viewBox="0 0 24 24">
                    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                    <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
            </button>
            <div class="univ-settings-wrap">
                <button class="univ-toggle-btn" id="univ-settings-btn" title="Configuración visual">
                    <svg viewBox="0 0 24 24">
                        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                </button>
                <div id="univ-settings-panel">
                    <div class="univ-sett-header">Rendimiento visual</div>
                    <label class="univ-sett-row">
                        <div class="univ-sett-info">
                            <span class="univ-sett-label">Animaciones</span>
                            <span class="univ-sett-desc">Estrellas y partículas en movimiento</span>
                        </div>
                        <div class="univ-toggle">
                            <input type="checkbox" id="univ-sett-animations"/>
                            <div class="univ-toggle-track"></div>
                        </div>
                    </label>
                    <div class="univ-sett-divider"></div>
                    <div class="univ-sett-header">Visualización</div>
                    <label class="univ-sett-row">
                        <div class="univ-sett-info">
                            <span class="univ-sett-label">Logos siempre visibles</span>
                            <span class="univ-sett-desc">Sin hover — se muestran todo el tiempo</span>
                        </div>
                        <div class="univ-toggle">
                            <input type="checkbox" id="univ-sett-logos"/>
                            <div class="univ-toggle-track"></div>
                        </div>
                    </label>
                </div>
            </div>
        </div>

        <!-- Grid view -->
        <div id="univ-grid-view">
            <div class="univ-grid-inner" id="univ-grid-inner"></div>
        </div>

    `;

  // ── Event listeners ──
  document
    .getElementById("univ-back-btn")
    .addEventListener("click", exitUniverse);

  // Toggle grid/galaxy
  document
    .getElementById("univ-toggle-btn")
    .addEventListener("click", toggleViewMode);

  // Search
  const searchInput = document.getElementById("univ-search-input");
  const dropdown = document.getElementById("univ-search-dropdown");
  searchInput.addEventListener("input", (e) =>
    renderSearchDropdown(e.target.value),
  );
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dropdown.style.display = "none";
      searchInput.blur();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".univ-search-wrap")) dropdown.style.display = "none";
  });
  // Delegación: un solo listener para todos los items del dropdown
  dropdown.addEventListener("click", (e) => {
    const item = e.target.closest(".univ-sdrop-item");
    if (!item) return;
    const sagas = getSortedSagas();
    const saga = sagas.find((s) => s.id === item.dataset.id);
    searchInput.value = "";
    dropdown.style.display = "none";
    if (!saga) return;
    if (gridMode) {
      showUniverseGrid(saga);
      return;
    }
    const node = planetNodes[saga.id];
    if (node) enterUniverse(saga, node.pos, node.size);
  });

  // Galaxy pan/zoom
  setupGalaxyPanZoom();
  // Pause loops when hidden
  setupVisibilityObserver();
  document.addEventListener("visibilitychange", () => {
    _hubVisible = document.visibilityState === "visible";
  });

  // Settings panel
  const settBtn = document.getElementById("univ-settings-btn");
  const settPanel = document.getElementById("univ-settings-panel");
  const chkAnim = document.getElementById("univ-sett-animations");
  const chkLogos = document.getElementById("univ-sett-logos");

  settBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    settPanel.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".univ-settings-wrap"))
      settPanel.classList.remove("open");
  });

  chkAnim.addEventListener("change", () => {
    perfSettings.animations = chkAnim.checked;
    saveSettings();
    // Reapply: reiniciar loops
    startStarCanvas();
    startParticleLoop();
    // Rebuild galaxy para aplicar/quitar animaciones CSS
    buildGalaxy(getSortedSagas());
  });

  chkLogos.addEventListener("change", () => {
    perfSettings.logosAlwaysVisible = chkLogos.checked;
    saveSettings();
    // Aplicar sin rebuild
    const map = document.getElementById("univ-galaxy-map");
    if (map) map.classList.toggle("logos-always-visible", chkLogos.checked);
  });

  domBuilt = true;
}

// ─────────────────────────────────────────────────────────────
// 5. NAV HEIGHT HELPER
// ─────────────────────────────────────────────────────────────
function updateNavOffset() {
  const nav = document.querySelector("nav.main-nav");
  let h = 64;
  // nav puede existir en el DOM pero estar oculto en mobile (offsetHeight = 0)
  // → si mide 0, caemos al mobile-top-bar igual que si no existiera
  if (nav && nav.offsetHeight > 0) {
    h = nav.offsetHeight;
  } else {
    const mob = document.querySelector(".mobile-top-bar");
    if (mob && getComputedStyle(mob).display !== "none") h = mob.offsetHeight;
  }
  const hub = document.getElementById("sagas-hub-container");
  if (hub) hub.style.setProperty("--univ-nav-h", h + "px");
}

// ─────────────────────────────────────────────────────────────
// 6. STARS
// ─────────────────────────────────────────────────────────────
function resizeStarCanvas(canvas) {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
function initStars(canvas) {
  stars = [];
  const N = Math.floor((canvas.width * canvas.height) / 3000);
  for (let i = 0; i < N; i++) {
    stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.2 + 0.2,
      o: Math.random() * 0.7 + 0.1,
      sp: Math.random() * 0.002 + 0.0005,
      ph: Math.random() * Math.PI * 2,
    });
  }
}
function drawStars(canvas, now) {
  if (!canvas || !document.contains(canvas)) {
    starAF = null;
    return;
  }
  const ctx = canvas.getContext("2d");
  const t = now / 1000;
  if (now - _lastStarF > 40) {
    // ~25fps
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of stars) {
      const op = s.o * (0.5 + 0.5 * Math.sin(t * s.sp * 1000 + s.ph));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${op})`;
      ctx.fill();
    }
    _lastStarF = now;
  }
  starAF = requestAnimationFrame((t) => drawStars(canvas, t));
}
function startStarCanvas() {
  const canvas = document.getElementById("univ-star-canvas");
  if (!canvas) return;
  if (starAF) cancelAnimationFrame(starAF);
  if (!perfSettings.animations) {
    // Dibujar estrellas estáticas una sola vez (sin parpadeo)
    resizeStarCanvas(canvas);
    initStars(canvas);
    const ctx = canvas.getContext("2d");
    for (const s of stars) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${s.o * 0.7})`;
      ctx.fill();
    }
    return;
  }
  resizeStarCanvas(canvas);
  initStars(canvas);
  starAF = requestAnimationFrame((t) => drawStars(canvas, t));
}

// ─────────────────────────────────────────────────────────────
// 7. GALAXY CANVAS (spiral galaxies per planet)
// ─────────────────────────────────────────────────────────────
function hexRgb(h) {
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}

function drawGalaxyBase(canvas, color, tilt) {
  const W = canvas.width,
    H = canvas.height;
  const cx = W / 2,
    cy = H / 2;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  const [r, g, b] = hexRgb(color);
  const RX = W * 0.46,
    RY = RX * tilt;

  for (let ri = 14; ri >= 1; ri--) {
    const t = ri / 14;
    const rx = RX * t,
      ry = RY * t;
    const alpha = 0.06 + (1 - t) * 0.18;
    const cr = Math.round(r * t + 180 * (1 - t));
    const cg = Math.round(g * t + 210 * (1 - t));
    const cb = Math.round(b * t + 255 * (1 - t));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha * 2.2})`);
    grad.addColorStop(0.5, `rgba(${cr},${cg},${cb},${alpha})`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.09 + (1 - t) * 0.12})`;
    ctx.lineWidth = t < 0.4 ? 1.5 : 0.8;
    ctx.stroke();
    ctx.restore();
  }

  const haloGrad = ctx.createRadialGradient(cx, cy, RX * 0.5, cx, cy, RX * 1.1);
  haloGrad.addColorStop(0, `rgba(${r},${g},${b},0.07)`);
  haloGrad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.beginPath();
  ctx.ellipse(cx, cy, RX * 1.1, RY * 1.1, 0, 0, Math.PI * 2);
  ctx.fillStyle = haloGrad;
  ctx.fill();

  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, RX * 0.22);
  coreGrad.addColorStop(0, `rgba(255,255,255,0.92)`);
  coreGrad.addColorStop(0.15, `rgba(255,255,255,0.55)`);
  coreGrad.addColorStop(0.4, `rgba(${r},${g},${b},0.3)`);
  coreGrad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.beginPath();
  ctx.ellipse(cx, cy, RX * 0.22, RY * 0.22, 0, 0, Math.PI * 2);
  ctx.fillStyle = coreGrad;
  ctx.fill();
}

function genParticles(size, color, tilt) {
  const [r, g, b] = hexRgb(color);
  const RX = size * 0.46,
    RY = RX * tilt;
  const pts = [];

  for (let arm = 0; arm < 2; arm++) {
    const baseAngle = (arm / 2) * Math.PI * 2;
    for (let p = 0; p < 100; p++) {
      const frac = p / 200;
      const spiralAngle = baseAngle + frac * Math.PI * 3.2;
      const spread = frac * 0.18 + 0.015;
      const rBase = frac * 0.92 + (Math.random() - 0.5) * spread;
      const clampedR = Math.max(0.02, Math.min(1, rBase));
      const alpha = (0.3 + Math.random() * 0.5) * (1 - frac * 0.4);
      const sz =
        Math.random() < 0.05 ? Math.random() * 2 + 1 : Math.random() * 1 + 0.3;
      const mixA = Math.min(frac * 2, 1);
      const cr = Math.round(255 * (1 - mixA) + r * mixA);
      const cg = Math.round(255 * (1 - mixA) + g * mixA);
      const cb = Math.round(255 * (1 - mixA) + b * mixA);
      const speed = 0.00008 + (1 - clampedR) * 0.00018;
      const fill = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
      pts.push({
        angle: spiralAngle,
        r: clampedR * RX,
        ry: clampedR * RY,
        speed,
        sz,
        fill,
      });
    }
  }
  for (let p = 0; p < 60; p++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.pow(Math.random(), 0.6);
    const speed = 0.00004 + (1 - dist) * 0.0001;
    const alpha = Math.random() * 0.35;
    const fill = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    pts.push({
      angle,
      r: dist * RX,
      ry: dist * RY,
      speed,
      sz: Math.random() * 1.2 + 0.2,
      fill,
    });
  }
  return pts;
}

function renderParticles(ctx, pts, W, H) {
  const cx = W / 2,
    cy = H / 2;
  ctx.clearRect(0, 0, W, H);
  for (const p of pts) {
    const x = cx + p.r * Math.cos(p.angle);
    const y = cy + p.ry * Math.sin(p.angle);
    ctx.beginPath();
    ctx.arc(x, y, p.sz, 0, Math.PI * 2);
    ctx.fillStyle = p.fill;
    ctx.fill();
  }
}

let _hubVisible = true;

function startParticleLoop() {
  if (_particleLoopAF) cancelAnimationFrame(_particleLoopAF);
  _particleLoopAF = null;
  if (!perfSettings.animations) return; // sin animación: partículas estáticas ya dibujadas en buildGalaxy
  _lastGPF = 0;
  function tick(now) {
    if (_hubVisible && now - _lastGPF > 80) {
      // ~12fps
      for (const g of _galaxyParticles) {
        for (const p of g.pts) p.angle += p.speed * 80;
        renderParticles(g.ctx, g.pts, g.W, g.H);
      }
      _lastGPF = now;
    }
    _particleLoopAF = requestAnimationFrame(tick);
  }
  _particleLoopAF = requestAnimationFrame(tick);
}

function setupVisibilityObserver() {
  const hub = document.getElementById("sagas-hub-container");
  if (!hub || typeof IntersectionObserver === "undefined") return;
  new IntersectionObserver(
    (entries) => {
      _hubVisible = entries[0].isIntersecting;
    },
    { threshold: 0 },
  ).observe(hub);
}

// ─────────────────────────────────────────────────────────────
// 8. BUILD GALAXY MAP
// ─────────────────────────────────────────────────────────────
const MAP_W = 3200,
  MAP_H = 2200;
const planetNodes = {};

function getSize(count) {
  if (count >= 30) return 200;
  if (count >= 15) return 160;
  if (count >= 8) return 130;
  if (count >= 3) return 105;
  return 85;
}

function randomPos(used, size) {
  const pad = size / 2 + 20;
  const minX = (pad / MAP_W) * 100,
    maxX = ((MAP_W - pad) / MAP_W) * 100;
  const minY = (pad / MAP_H) * 100,
    maxY = ((MAP_H - pad) / MAP_H) * 100;
  for (let i = 0; i < 300; i++) {
    const x = Math.random() * (maxX - minX) + minX;
    const y = Math.random() * (maxY - minY) + minY;
    const px = (x / 100) * MAP_W,
      py = (y / 100) * MAP_H;
    const ok = !used.some((p) => {
      const dx = (p.x / 100) * MAP_W - px,
        dy = (p.y / 100) * MAP_H - py;
      return Math.sqrt(dx * dx + dy * dy) < (size + p.size) / 2 + 40;
    });
    if (ok) return { x, y, size };
  }
  // Fallback: grid-based placement para evitar solapamientos
  console.warn(
    "[universes] randomPos: no free slot found, using grid fallback",
  );
  const cols = Math.ceil(Math.sqrt(used.length + 1));
  const idx = used.length;
  const col = idx % cols,
    row = Math.floor(idx / cols);
  const stepX = (maxX - minX) / cols;
  const stepY = (maxY - minY) / Math.max(cols, 1);
  return {
    x: minX + col * stepX + stepX / 2,
    y: minY + row * stepY + stepY / 2,
    size,
  };
}

function buildGalaxy(sagas) {
  const map = document.getElementById("univ-galaxy-map");
  if (!map) return;
  map.innerHTML = "";
  _galaxyParticles.length = 0;

  // Aplicar clase de logos según setting
  map.classList.toggle("logos-always-visible", perfSettings.logosAlwaysVisible);

  const used = [];
  const idleCb =
    typeof requestIdleCallback === "function"
      ? requestIdleCallback
      : (fn) => setTimeout(fn, 0);

  // Pre-calcular posiciones y tamaños (rápido, sin canvas)
  const items = sagas.map((saga, i) => {
    const count = getSagaMovieCount(saga.id);
    const size = getSize(count);
    const pos = randomPos(used, size);
    used.push(pos);
    return { saga, i, count, size, pos };
  });

  // Agregar al DOM de a uno en idle time para no bloquear
  let idx = 0;
  function processNext(deadline) {
    while (
      idx < items.length &&
      (deadline.timeRemaining() > 4 || deadline.didTimeout)
    ) {
      const { saga, i, count, size, pos } = items[idx++];
      const color = saga.color || "#3b82f6";
      const tilt = 0.32 + (i % 6) * 0.05;

      const sys = document.createElement("div");
      sys.className = "univ-planet-system";
      // Sin animación CSS si el setting está apagado
      const enterAnim = perfSettings.animations
        ? `animation:univ-galaxy-enter .7s ${i * 0.08}s ease both;`
        : "";
      sys.style.cssText = `left:${pos.x}%;top:${pos.y}%;width:${size}px;height:${size}px;margin-left:-${size / 2}px;margin-top:-${size / 2}px;${enterAnim}position:absolute;`;

      const gc = document.createElement("canvas");
      gc.width = size;
      gc.height = size;
      gc.style.cssText = "position:absolute;inset:0;border-radius:50%;";
      drawGalaxyBase(gc, color, tilt);
      sys.appendChild(gc);

      const gp = document.createElement("canvas");
      gp.width = size;
      gp.height = size;
      gp.style.cssText = "position:absolute;inset:0;border-radius:50%;";
      const pts = genParticles(size, color, tilt);
      renderParticles(gp.getContext("2d"), pts, size, size);
      sys.appendChild(gp);
      _galaxyParticles.push({
        ctx: gp.getContext("2d"),
        pts,
        W: size,
        H: size,
      });

      const lw = document.createElement("div");
      lw.className = "univ-planet-logo-wrap";
      const lg = document.createElement("img");
      lg.src = saga.logo || "";
      lg.alt = "";
      lg.draggable = false;
      lw.appendChild(lg);
      sys.appendChild(lw);

      const label = document.createElement("div");
      label.className = "univ-planet-label";
      label.innerHTML = `<span class="univ-planet-label-name">${saga.title || saga.titulo || saga.id}</span><span class="univ-planet-label-count">${count} ${count === 1 ? "título" : "títulos"}</span>`;
      sys.appendChild(label);

      sys.addEventListener("click", () => enterUniverse(saga, pos, size));
      planetNodes[saga.id] = { el: sys, pos, size };
      map.appendChild(sys);
    }
    if (idx < items.length) idleCb(processNext, { timeout: 300 });
  }
  idleCb(processNext, { timeout: 300 });
}

// ─────────────────────────────────────────────────────────────
// 9. GALAXY PAN / ZOOM
// ─────────────────────────────────────────────────────────────
function applyGalaxy() {
  _gDirty = true;
  if (_gRafPending) return;
  _gRafPending = true;
  requestAnimationFrame(() => {
    if (_gDirty) {
      const map = document.getElementById("univ-galaxy-map");
      if (map)
        map.style.transform = `translate(${gPan.x}px,${gPan.y}px) scale(${gScale})`;
      _gDirty = false;
    }
    _gRafPending = false;
  });
}

function setupGalaxyPanZoom() {
  const gw = document.getElementById("univ-galaxy-wrapper");
  if (!gw) return;

  gw.addEventListener("mousedown", (e) => {
    if (e.target.closest(".univ-planet-system")) return;
    gDrag = true;
    gDragStart = { x: e.clientX - gPan.x, y: e.clientY - gPan.y };
    gw.classList.add("dragging");
  });
  window.addEventListener("mousemove", (e) => {
    if (!gDrag) return;
    gPan.x = e.clientX - gDragStart.x;
    gPan.y = e.clientY - gDragStart.y;
    applyGalaxy();
  });
  window.addEventListener("mouseup", () => {
    gDrag = false;
    gw.classList.remove("dragging");
  });

  gw.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const d = e.deltaY > 0 ? -0.08 : 0.08;
      const ns = Math.min(2.5, Math.max(0.25, gScale + d));
      const r = gw.getBoundingClientRect();
      const mx = e.clientX - r.left,
        my = e.clientY - r.top;
      gPan.x = mx - (mx - gPan.x) * (ns / gScale);
      gPan.y = my - (my - gPan.y) * (ns / gScale);
      gScale = ns;
      applyGalaxy();
    },
    { passive: false },
  );

  // Touch drag
  gw.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        gDrag = true;
        gDragStart = { x: t.clientX - gPan.x, y: t.clientY - gPan.y };
      } else {
        gDrag = false; // no drag si hay más de un dedo
      }
    },
    { passive: true },
  );
  gw.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length === 2) {
        // Pinch zoom — bloqueamos el zoom nativo del browser
        e.preventDefault();
        const t1 = e.touches[0],
          t2 = e.touches[1];
        const dist = Math.hypot(
          t2.clientX - t1.clientX,
          t2.clientY - t1.clientY,
        );
        if (gw._lastPinchDist != null) {
          const d = (dist - gw._lastPinchDist) * 0.008;
          const ns = Math.min(2.5, Math.max(0.25, gScale + d));
          const r = gw.getBoundingClientRect();
          const mx = (t1.clientX + t2.clientX) / 2 - r.left;
          const my = (t1.clientY + t2.clientY) / 2 - r.top;
          gPan.x = mx - (mx - gPan.x) * (ns / gScale);
          gPan.y = my - (my - gPan.y) * (ns / gScale);
          gScale = ns;
          applyGalaxy();
        }
        gw._lastPinchDist = dist;
        return;
      }
      gw._lastPinchDist = null;
      if (!gDrag) return;
      const t = e.touches[0];
      gPan.x = t.clientX - gDragStart.x;
      gPan.y = t.clientY - gDragStart.y;
      applyGalaxy();
    },
    { passive: false },
  );
  window.addEventListener("touchend", (e) => {
    if (e.touches.length < 2) gw._lastPinchDist = null;
    if (e.touches.length === 0) gDrag = false;
  });
}

// ─────────────────────────────────────────────────────────────
// 10. ENTER UNIVERSE (zoom cinematic → grid)
// ─────────────────────────────────────────────────────────────
function enterUniverse(saga, pos, size) {
  currentUniverseId = saga.id;
  currentSagaObj = saga;

  const gw = document.getElementById("univ-galaxy-wrapper");
  if (!gw) return;
  const W = gw.offsetWidth,
    H = gw.offsetHeight;

  const planetX = (pos.x / 100) * MAP_W;
  const planetY = (pos.y / 100) * MAP_H;

  _lastGalaxyPos = { panX: gPan.x, panY: gPan.y, scale: gScale };
  _lastPlanetPos = { x: pos.x, y: pos.y };

  const midScale = 3.2;
  const midPanX = W / 2 - planetX * midScale;
  const midPanY = H / 2 - planetY * midScale;
  const startPanX = gPan.x,
    startPanY = gPan.y,
    startScale = gScale;
  const dur1 = 500,
    startT1 = performance.now();

  function ease(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  function zoomToCenter(now) {
    const t = Math.min((now - startT1) / dur1, 1),
      e = ease(t);
    gPan.x = startPanX + (midPanX - startPanX) * e;
    gPan.y = startPanY + (midPanY - startPanY) * e;
    gScale = startScale + (midScale - startScale) * e;
    applyGalaxy();
    if (t < 1) {
      requestAnimationFrame(zoomToCenter);
    } else {
      showUniverseGrid(saga);
    }
  }
  requestAnimationFrame(zoomToCenter);
}

function showUniverseGrid(saga) {
  currentUniverseId = saga.id;
  currentSagaObj = saga;

  document.getElementById("univ-controls")?.classList.add("hidden");
  document.getElementById("univ-back-btn")?.classList.add("visible");

  // Si estamos en modo grid, ocultarlo mientras se muestra el universo
  if (gridMode) {
    document.getElementById("univ-grid-view")?.classList.remove("active");
  }

  buildUniverseGrid(saga);

  const overlay = document.getElementById("univ-universe-overlay");
  overlay?.classList.add("active");
}

function buildUniverseGrid(saga) {
  const grid = document.getElementById("univ-ov-grid");
  const logo = document.getElementById("univ-ov-logo");
  const title = document.getElementById("univ-ov-title");
  const count = document.getElementById("univ-ov-count");
  if (!grid) return;

  // Resetear sort y filtros al abrir un universo
  sortMode = "saga";
  activeSubSaga = "all";
  activePhase = "all";

  // Header — logo, título, count
  if (logo) {
    logo.src = saga.logo || "";
    logo.alt = saga.title || "";
  }
  if (title)
    title.textContent = (saga.title || saga.titulo || saga.id).toUpperCase();
  const n = getSagaMovieCount(saga.id);
  if (count) count.textContent = `${n} ${n === 1 ? "título" : "títulos"}`;

  renderMovieCards(saga);

  // Reset scroll
  const overlay = document.getElementById("univ-universe-overlay");
  if (overlay) overlay.scrollTop = 0;
}

function renderMovieCards(saga) {
  const grid = document.getElementById("univ-ov-grid");
  if (!grid) return;

  // ── 1. (Reset ya hecho en buildUniverseGrid) ──
  currentSagaObj = saga;

  // ── 2. RESCATAR DATOS ORIGINALES ──
  let baseMovies = getSagaMovies(saga.id);
  const rawData = shared.appState.content.sagas[saga.id] || {};

  let movies = baseMovies.map((m) => {
    const fullData = { ...m, ...(rawData[m.id] || {}) };

    let fase = String(fullData.fase || fullData.Fase || "").trim();
    fullData.fase = fase;

    if (fase) {
      if (!fullData.saga) {
        if (["1", "2", "3"].includes(fase)) {
          fullData.saga = "Saga del Infinito";
        } else if (["4", "5", "6"].includes(fase)) {
          fullData.saga = "Saga del Multiverso";
        }
      }
    } else {
      fullData.saga = fullData.saga || null;
    }

    let crono =
      fullData.cronologia ?? fullData.Cronología ?? fullData.cronología ?? null;
    fullData.cronologia = crono === null || crono === "" ? null : Number(crono);

    return fullData;
  });

  // ── 3. FILTROS (sagas + orden) ──
  const hasSagas = movies.some((m) => m.saga);
  const hasPhases = movies.some((m) => m.fase);

  let filtersContainer = document.getElementById("univ-filters-container");
  if (!filtersContainer) {
    filtersContainer = document.createElement("div");
    filtersContainer.id = "univ-filters-container";
    filtersContainer.className = "univ-filters-bar";
    grid.insertAdjacentElement("beforebegin", filtersContainer);
  }

  let html = `<div class="univ-filter-group">`;

  // FILA 1: Orden
  const hasSortButtons = (saga.sort_buttons || "").toLowerCase() === "si";
  if (hasSortButtons) {
    html += `<div class="univ-filter-row univ-sort-row">
                <button class="univ-filter-btn ${sortMode === "saga" ? "active" : ""}" onclick="window.setUniverseSort('saga')"><i class="fas fa-calendar-alt"></i> Orden de Salida</button>
                <button class="univ-filter-btn ${sortMode === "cronologico" ? "active" : ""}" onclick="window.setUniverseSort('cronologico')"><i class="fas fa-clock"></i> Cronológico</button>
             </div>`;
  }

  // FILA 2: Sagas + dropdown de fases al final
  if (hasSagas) {
    const uniqueSagas = [...new Set(movies.map((m) => m.saga).filter(Boolean))];
    if (uniqueSagas.length > 0) {
      let phaseDropdownHTML = "";
      if (hasPhases) {
        // Siempre calcular fases desde todas las películas para que no desaparezcan al filtrar saga
        const uniquePhases = [
          ...new Set(movies.map((m) => m.fase).filter(Boolean)),
        ].sort((a, b) =>
          String(a).localeCompare(String(b), undefined, { numeric: true }),
        );

        // El label del trigger refleja la selección activa: saga tiene prioridad sobre fase
        const activeLabel =
          activeSubSaga !== "all"
            ? activeSubSaga
            : activePhase === "all"
              ? "Todas las Fases"
              : `Fase ${activePhase}`;
        const triggerHasActive =
          activeSubSaga !== "all" || activePhase !== "all";

        // Construir lista mezclada: fases con los dos ítems de saga intercalados
        // — Saga del Infinito: justo después de "Todas las Fases", antes de Fase 1
        // — Saga del Multiverso: entre Fase 3 y Fase 4
        const phaseItems = [];
        phaseItems.push({
          type: "fase",
          fase: "all",
          label: "Todas las Fases",
        });
        phaseItems.push({
          type: "saga",
          saga: "Saga del Infinito",
          label: "Saga del Infinito",
        });
        for (const f of uniquePhases) {
          if (String(f) === "4") {
            phaseItems.push({
              type: "saga",
              saga: "Saga del Multiverso",
              label: "Saga del Multiverso",
            });
          }
          phaseItems.push({ type: "fase", fase: f, label: `Fase ${f}` });
        }

        const renderDrawerItem = (item) => {
          if (item.type === "saga") {
            const isActive = activeSubSaga === item.saga;
            return `<button class="univ-phase-drawer-saga ${isActive ? "active" : ""}" data-type="saga" data-saga="${item.saga}">
                        ${item.label}
                        <i class="fas fa-check univ-phase-drawer-check"></i>
                    </button>`;
          }
          // Una fase solo se marca activa si no hay saga seleccionada
          const isActive = activeSubSaga === "all" && activePhase === item.fase;
          return `<button class="univ-phase-drawer-item ${isActive ? "active" : ""}" data-type="fase" data-fase="${item.fase}">
                    ${item.label}
                    <i class="fas fa-check univ-phase-drawer-check"></i>
                </button>`;
        };

        phaseDropdownHTML = `
                <div class="univ-phase-dropdown-wrap" id="univ-phase-dropdown-wrap">
                    <!-- Desktop: dropdown -->
                    <div class="univ-phase-btn" id="univ-phase-btn">
                        ${activeLabel}
                        <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="#64748b" stroke-width="1.5" stroke-linecap="round"/></svg>
                    </div>
                    <div class="univ-phase-menu" id="univ-phase-menu">
                        <div class="univ-phase-option ${activePhase === "all" ? "active" : ""}" data-fase="all">Todas las Fases</div>
                        ${uniquePhases.map((f) => `<div class="univ-phase-option ${activePhase === f ? "active" : ""}" data-fase="${f}">Fase ${f}</div>`).join("")}
                    </div>
                    <!-- Mobile: drawer trigger -->
                    <button class="univ-phase-drawer-trigger ${triggerHasActive ? "has-active" : ""}" id="univ-phase-drawer-trigger">
                        ${activeLabel}
                        <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    </button>
                </div>
                <!-- Mobile: drawer overlay + panel -->
                <div class="univ-phase-drawer-overlay" id="univ-phase-drawer-overlay"></div>
                <div class="univ-phase-drawer" id="univ-phase-drawer">
                    <div class="univ-phase-drawer-handle"></div>
                    <p class="univ-phase-drawer-title">FASES</p>
                    <div class="univ-phase-drawer-list">
                        ${phaseItems.map(renderDrawerItem).join("")}
                    </div>
                </div>`;
      }

      html += `<div class="univ-filter-row">
                    <button class="univ-filter-btn ${activeSubSaga === "all" ? "active" : ""}" onclick="window.setUniverseFilter('saga', 'all')">Todas las Sagas</button>
                    ${uniqueSagas.map((s) => `<button class="univ-filter-btn ${activeSubSaga === s ? "active" : ""}" onclick="window.setUniverseFilter('saga', '${s}')">${s}</button>`).join("")}
                    ${phaseDropdownHTML}
                 </div>`;
    }
  }

  html += `</div>`;
  filtersContainer.innerHTML = html;
  filtersContainer.style.display = "block";

  // Event listeners del dropdown
  const phaseBtn = document.getElementById("univ-phase-btn");
  const phaseMenu = document.getElementById("univ-phase-menu");
  if (phaseBtn && phaseMenu) {
    phaseBtn.onclick = (e) => {
      e.stopPropagation();
      const isOpen = phaseMenu.classList.contains("open");
      phaseMenu.classList.remove("open");
      if (!isOpen) {
        // Posicionar el menú con fixed relativo al botón
        const rect = phaseBtn.getBoundingClientRect();
        phaseMenu.style.position = "fixed";
        phaseMenu.style.top = rect.bottom + 8 + "px";
        phaseMenu.style.left = rect.left + "px";
        phaseMenu.style.right = "auto";
        phaseMenu.classList.add("open");
      }
    };
    phaseMenu.querySelectorAll(".univ-phase-option").forEach((opt) => {
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        phaseMenu.classList.remove("open");
        window.setUniverseFilter("fase", opt.dataset.fase);
      });
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#univ-phase-dropdown-wrap")) {
        phaseMenu.classList.remove("open");
      }
    });
  }

  // ── Event listeners del Phase Drawer (mobile) ──
  const phaseDrawerTrigger = document.getElementById(
    "univ-phase-drawer-trigger",
  );
  const phaseDrawer = document.getElementById("univ-phase-drawer");
  const phaseDrawerOverlay = document.getElementById(
    "univ-phase-drawer-overlay",
  );
  if (phaseDrawerTrigger && phaseDrawer && phaseDrawerOverlay) {
    // Mover al body para escapar del stacking context de #univ-universe-overlay (z-index:500)
    // Sin esto, el drawer queda atrapado en ese contexto y nunca puede superar la tab bar (z-index:1059)
    document.body.appendChild(phaseDrawerOverlay);
    document.body.appendChild(phaseDrawer);

    const openPhaseDrawer = () => {
      phaseDrawer.classList.add("open");
      phaseDrawerOverlay.classList.add("open");
      document.body.classList.add("modal-open");
    };
    const closePhaseDrawer = () => {
      phaseDrawer.classList.remove("open");
      phaseDrawerOverlay.classList.remove("open");
      document.body.classList.remove("modal-open");
    };
    phaseDrawerTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      openPhaseDrawer();
    });
    phaseDrawerOverlay.addEventListener("click", closePhaseDrawer);
    phaseDrawer
      .querySelectorAll(".univ-phase-drawer-item, .univ-phase-drawer-saga")
      .forEach((item) => {
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          closePhaseDrawer();
          if (item.dataset.type === "saga") {
            window.setUniverseFilter("saga", item.dataset.saga);
          } else {
            window.setUniverseFilter("fase", item.dataset.fase);
          }
        });
      });
  }

  // ── 5. APLICAR FILTROS ──
  if (activeSubSaga !== "all")
    movies = movies.filter((m) => m.saga === activeSubSaga);
  if (activePhase !== "all")
    movies = movies.filter((m) => m.fase === activePhase);

  // ── 6. ORDEN ──
  if (sortMode === "cronologico") {
    movies.sort((a, b) => {
      if (a.cronologia === null) return 1;
      if (b.cronologia === null) return -1;
      return a.cronologia - b.cronologia;
    });
  } else {
    movies.reverse();
  }

  // ── 7. GRILLA ──
  grid.innerHTML = movies
    .map(
      (m, i) => `
        <div class="univ-ov-card" data-id="${m.id}" style="animation-delay:${i * 0.03}s">
            <img class="univ-ov-card-poster"
                 src="${m.poster || m.banner || ""}"
                 alt="${m.title}"
                 loading="lazy"
                 onerror="this.style.opacity=0"/>
            <div class="univ-ov-card-info">
                <div class="univ-ov-card-title">${m.title}</div>
                <span class="univ-ov-card-year">${m.year || ""}</span>
            </div>
        </div>
    `,
    )
    .join("");

  // ── 8. CLICK ──
  grid.onclick = (e) => {
    const card = e.target.closest(".univ-ov-card");
    if (!card) return;
    const movie = movies.find((m) => m.id === card.dataset.id);
    if (!movie) return;

    const isSeries =
      (movie.type || "").toLowerCase().includes("serie") ||
      !!shared.appState.content.seriesEpisodes[movie.id];
    shared.appState.ui._fromUniverse = saga.id;

    if (isSeries) window.openSeriesDetailView(movie.id);
    else window.openDetailsModal(movie.id, "movie");
  };
}

// ─────────────────────────────────────────────────────────────
// 11. EXIT UNIVERSE
// ─────────────────────────────────────────────────────────────
function exitUniverse() {
  if (!currentUniverseId) return;

  currentUniverseId = null;
  currentSagaObj = null;
  sortMode = "saga";

  // Limpiar botones de sort y filtros para el próximo universo
  const sortWrap = document.getElementById("univ-ov-sort-wrap");
  if (sortWrap) sortWrap.remove();
  const filtersContainer = document.getElementById("univ-filters-container");
  if (filtersContainer) filtersContainer.remove();
  const phaseDropdown = document.getElementById("univ-phase-dropdown-wrap"); // ← agregá estas dos líneas
  if (phaseDropdown) phaseDropdown.remove();

  document.getElementById("univ-back-btn")?.classList.remove("visible");
  document.getElementById("univ-controls")?.classList.remove("hidden");
  document.getElementById("univ-universe-overlay")?.classList.remove("active");

  const lbl = document.getElementById("univ-universe-label");
  if (lbl) {
    lbl.classList.remove("visible");
    setTimeout(() => {
      lbl.style.display = "none";
    }, 400);
  }

  // Si veníamos del grid, solo mostrar el grid de nuevo sin animar la galaxia
  if (gridMode) {
    document.getElementById("univ-grid-view")?.classList.add("active");
    return;
  }

  const savedPos = _lastPlanetPos || { x: 50, y: 50 };
  const planetX = (savedPos.x / 100) * MAP_W;
  const planetY = (savedPos.y / 100) * MAP_H;

  const gw = document.getElementById("univ-galaxy-wrapper");
  if (!gw) return;
  const W = gw.offsetWidth,
    H = gw.offsetHeight;

  const target = _lastGalaxyPos || { panX: 0, panY: 0, scale: 1 };
  const dur = 600,
    startT = performance.now();
  const startPanX = gPan.x,
    startPanY = gPan.y,
    startScale = gScale;

  function ease(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }
  function zoomBack(now) {
    const t = Math.min((now - startT) / dur, 1),
      e = ease(t);
    gPan.x = startPanX + (target.panX - startPanX) * e;
    gPan.y = startPanY + (target.panY - startPanY) * e;
    gScale = startScale + (target.scale - startScale) * e;
    applyGalaxy();
    if (t < 1) requestAnimationFrame(zoomBack);
  }
  requestAnimationFrame(zoomBack);
}

// ─────────────────────────────────────────────────────────────
// 17. GRID VIEW (toggle alternativo)
// ─────────────────────────────────────────────────────────────
function buildGridView(sagas) {
  const inner = document.getElementById("univ-grid-inner");
  if (!inner) return;
  inner.innerHTML = "";
  sagas.forEach((saga) => {
    const count = getSagaMovieCount(saga.id);
    const card = document.createElement("div");
    card.className = "univ-grid-card";
    card.innerHTML = `
            <img class="univ-grid-card-logo" src="${saga.logo || ""}" alt="${saga.title || ""}" onerror="this.style.opacity=0"/>
            <div class="univ-grid-card-name">${saga.title || saga.titulo || saga.id}</div>
            <div class="univ-grid-card-count">${count} ${count === 1 ? "título" : "títulos"}</div>
        `;
    card.addEventListener("click", () => showUniverseGrid(saga));
    inner.appendChild(card);
  });
}

function toggleViewMode() {
  gridMode = !gridMode;
  const icon = document.getElementById("univ-toggle-icon");
  const gw = document.getElementById("univ-galaxy-wrapper");
  const gv = document.getElementById("univ-grid-view");

  if (gridMode) {
    if (gw) gw.style.display = "none";
    gv?.classList.add("active");
    if (icon)
      icon.innerHTML = `<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`;
  } else {
    if (gw) gw.style.display = "";
    gv?.classList.remove("active");
    if (icon)
      icon.innerHTML = `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>`;
  }
}

// ─────────────────────────────────────────────────────────────
// 18. SEARCH
// ─────────────────────────────────────────────────────────────
function renderSearchDropdown(q) {
  const dropdown = document.getElementById("univ-search-dropdown");
  const input = document.getElementById("univ-search-input");
  if (!dropdown) return;
  if (!q.trim()) {
    dropdown.style.display = "none";
    return;
  }

  const sagas = getSortedSagas();
  const ql = q.toLowerCase();
  const matches = sagas
    .filter((s) =>
      (s.title || s.titulo || s.id || "").toLowerCase().includes(ql),
    )
    .slice(0, 6);

  if (!matches.length) {
    dropdown.style.display = "none";
    return;
  }

  dropdown.innerHTML = matches
    .map((s) => {
      const count = getSagaMovieCount(s.id);
      return `<div class="univ-sdrop-item" data-id="${s.id}">
            <img class="univ-sdrop-logo" src="${s.logo || ""}" alt="" onerror="this.style.opacity=0"/>
            <div>
                <span class="univ-sdrop-name">${s.title || s.titulo || s.id}</span>
                <span class="univ-sdrop-meta">${count} títulos</span>
            </div>
        </div>`;
    })
    .join("");

  dropdown.style.display = "block";
  // El listener de click está en el dropdown como delegación (se registra una sola vez en buildDOM)
}

// ─────────────────────────────────────────────────────────────
// 19. DATA HELPERS
// ─────────────────────────────────────────────────────────────

// Cache invalidado en cada renderUniversesHub()
let _sagasCache = null;
let _movieCountCache = null;

function invalidateDataCache() {
  _sagasCache = null;
  _movieCountCache = null;
}

function getSortedSagas() {
  if (_sagasCache) return _sagasCache;
  const list = shared.appState.content.sagasList || [];
  const arr = Array.isArray(list) ? list : Object.values(list);
  _sagasCache = [...arr].sort(
    (a, b) => (Number(a.order) || 99) - (Number(b.order) || 99),
  );
  return _sagasCache;
}

function getSagaMovieCount(sagaId) {
  if (!_movieCountCache) _movieCountCache = {};
  if (_movieCountCache[sagaId] != null) return _movieCountCache[sagaId];
  const sagaData = shared.appState.content.sagas?.[sagaId];
  _movieCountCache[sagaId] = sagaData ? Object.keys(sagaData).length : 0;
  return _movieCountCache[sagaId];
}

function getSagaMovies(sagaId) {
  const sagaData = shared.appState.content.sagas?.[sagaId] || {};
  const adminOk = !!(shared.auth?.currentUser && shared.auth.currentUser.email === "baquezadat@gmail.com");
  return Object.entries(sagaData)
    .filter(([, m]) => {
      const adminField = (m.admin || m.Admin || "").toString().toLowerCase().trim();
      return adminOk || adminField !== "si";
    })
    .map(([id, m]) => ({
      id,
      title: m.titulo || m.title || id,
      year: m.año || m.year || "",
      type: m.tipo || m.type || "Película",
      banner: m.banner || m.poster || m.img || "",
      poster: m.poster || m.banner || m.img || "",
      cronologia: Number(m.cronologia) || Number(m.cronologiaMulti) || null,
    }));
}

// ─────────────────────────────────────────────────────────────
// 21. SETTINGS — REALTIME DATABASE SAVE / LOAD
// ─────────────────────────────────────────────────────────────
function getSettingsRef() {
  const uid = shared.auth?.currentUser?.uid;
  if (!uid || !shared.db) return null;
  return shared.db.ref(`users/${uid}/preferences/universes`);
}

async function loadSettings() {
  try {
    const ref = getSettingsRef();
    if (!ref) return; // no hay usuario logueado todavía
    const snap = await ref.once("value");
    if (snap.exists()) {
      const data = snap.val();
      if (typeof data.animations === "boolean")
        perfSettings.animations = data.animations;
      if (typeof data.logosAlwaysVisible === "boolean")
        perfSettings.logosAlwaysVisible = data.logosAlwaysVisible;
    }
    syncSettingsUI();
  } catch (err) {
    console.warn("[universes] loadSettings error:", err);
  }
}

async function saveSettings() {
  try {
    const ref = getSettingsRef();
    if (!ref) return;
    await ref.set({
      animations: perfSettings.animations,
      logosAlwaysVisible: perfSettings.logosAlwaysVisible,
    });
  } catch (err) {
    console.warn("[universes] saveSettings error:", err);
  }
}

// Sincroniza checkboxes Y estado visual con perfSettings
function syncSettingsUI() {
  const chkAnim  = document.getElementById("univ-sett-animations");
  const chkLogos = document.getElementById("univ-sett-logos");
  if (chkAnim)  chkAnim.checked  = perfSettings.animations;
  if (chkLogos) chkLogos.checked = perfSettings.logosAlwaysVisible;

  // Aplica también la clase al mapa (no solo el checkbox)
  const map = document.getElementById("univ-galaxy-map");
  if (map) map.classList.toggle("logos-always-visible", perfSettings.logosAlwaysVisible);
}

// ─────────────────────────────────────────────────────────────
// 20. RESET UI
// ─────────────────────────────────────────────────────────────
function resetUI() {
  document.getElementById("univ-back-btn")?.classList.remove("visible");

  const lbl = document.getElementById("univ-universe-label");
  if (lbl) {
    lbl.classList.remove("visible");
    lbl.style.display = "none";
  }

  document.getElementById("univ-controls")?.classList.remove("hidden");
  document.getElementById("univ-grid-view")?.classList.remove("active");

  const gw = document.getElementById("univ-galaxy-wrapper");
  if (gw) gw.style.display = "";

  // Reset toggle icon
  const icon = document.getElementById("univ-toggle-icon");
  if (icon)
    icon.innerHTML = `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>`;

  currentUniverseId = null;
  currentSagaObj = null;
  gridMode = false;
}

export function restoreUniverseOverlay(sagaId) {
  const sagas = getSortedSagas();
  const saga = sagas.find((s) => s.id === sagaId);
  if (!saga) return;
  currentUniverseId = saga.id;
  currentSagaObj = saga;
  showUniverseGrid(saga);
}
