// ═══════════════════════════════════════════════════════════════
// STATS MODULE — "Estadísticas" del cine
// Se carga perezoso desde script.js (getStatsModule), igual que
// roulette.js. No toca appState más allá de leerlo: todo lo que
// muestra sale de lo que ya está cargado en memoria (catálogo +
// universos), no pide nada nuevo al servidor.
// ═══════════════════════════════════════════════════════════════

let _appState = null;

export function initStats(deps) {
  _appState = deps.appState;
  injectStyles();
}

// ── 1. ARMAR EL SET UNIFICADO DE CONTENIDO ──────────────────────
// Catálogo principal + todos los universos, sin duplicar por id
// (si el mismo id aparece en el catálogo y en un universo, cuenta
// una sola vez). Gana la primera aparición.
//
// OJO: no podemos confiar en item.type para saber si es peli o
// serie en el catálogo principal — normalizeItem() en script.js le
// pone "movie" por default si el sheet no trae esa columna (típico
// en la hoja 'series', que no necesita repetir el tipo). Por eso acá
// clasificamos por la HOJA de origen (movies/series), no por el
// campo. Solo para universos, que mezclan ambos tipos en una sola
// hoja, se usa item.type como en el resto del sitio.
function buildUnifiedContent() {
  const map = new Map(); // id -> { item, kind: "movie" | "series" | otro (tipo de universo) }

  const addAll = (obj, forcedKind) => {
    if (!obj) return;
    Object.entries(obj).forEach(([id, item]) => {
      if (!item || map.has(id)) return;
      // Filas rotas del sheet: id vacío o el placeholder literal "id"
      // (se ve como texto gris itálico en Sheets cuando la fila no
      // tiene un id real cargado). No son contenido de verdad.
      const idClean = (id || "").toString().trim().toLowerCase();
      if (!idClean || idClean === "id") return;
      const kind =
        forcedKind ||
        (item.type || "movie").toString().toLowerCase().trim();
      map.set(id, { item, kind });
    });
  };

  addAll(_appState?.content?.movies, "movie");
  addAll(_appState?.content?.series, "series");
  Object.values(_appState?.content?.sagas || {}).forEach((sagaContent) =>
    addAll(sagaContent, null),
  );

  return map;
}

// Escapa texto que viene del sheet antes de meterlo en el HTML del
// modal. Sin esto, un nombre/título con '<' o '>' puede romper la
// estructura del DOM entero (no solo esa fila) y dejar sin click
// todo lo que venga después en el innerHTML.
function esc(raw) {
  return String(raw ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function splitField(raw) {
  return String(raw || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── 2. COMPUTAR TODAS LAS ESTADÍSTICAS ──────────────────────────
function computeStats() {
  const content = buildUnifiedContent();

  let totalMovies = 0;
  let totalSeries = 0;
  const genreCounts = new Map();
  const langCounts = new Map();
  const requesterCounts = new Map();
  const requesterItems = new Map(); // nombre -> [{ id, title, kind }]

  for (const [id, { item, kind }] of content.entries()) {
    // Solo cuenta como "contenido" lo que es película o serie de
    // verdad — cosas como tipo=clip/marveliada de un universo modo
    // youtube no son parte del catálogo tradicional.
    if (kind !== "movie" && kind !== "series") continue;

    if (kind === "movie") totalMovies++;
    else totalSeries++;

    splitField(item.genres).forEach((g) => {
      genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
    });
    splitField(item.language || item.idioma || item.audio).forEach((l) => {
      langCounts.set(l, (langCounts.get(l) || 0) + 1);
    });

    const p = (item.pedido || "").toString().trim();
    if (p) {
      requesterCounts.set(p, (requesterCounts.get(p) || 0) + 1);
      if (!requesterItems.has(p)) requesterItems.set(p, []);
      requesterItems.get(p).push({
        id,
        title: item.title || "Sin título",
        kind,
        dateAdded: item.date_added || null,
      });
    }
  }

  const totalContent = totalMovies + totalSeries;
  const pctMovies = totalContent ? Math.round((totalMovies / totalContent) * 100) : 0;
  const pctSeries = totalContent ? Math.round((totalSeries / totalContent) * 100) : 0;

  const sortDesc = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);

  // ── Episodios: suma total + serie más larga / más corta ──
  const episodesData = _appState?.content?.seriesEpisodes || {};
  let totalEpisodes = 0;
  let longest = null;
  let shortest = null;
  for (const [id, { item, kind }] of content.entries()) {
    if (kind !== "series") continue;
    const seasons = episodesData[id];
    if (!seasons) continue;
    let count = 0;
    Object.values(seasons).forEach((eps) => {
      if (Array.isArray(eps)) count += eps.length;
    });
    if (count === 0) continue;
    totalEpisodes += count;
    const entry = { id, title: item.title || "Sin título", count };
    if (!longest || count > longest.count) longest = entry;
    if (!shortest || count < shortest.count) shortest = entry;
  }

  return {
    totalContent,
    totalMovies,
    totalSeries,
    pctMovies,
    pctSeries,
    genres: sortDesc(genreCounts),
    languages: sortDesc(langCounts),
    requesters: sortDesc(requesterCounts),
    requesterItems,
    totalEpisodes,
    longest,
    shortest,
  };
}

// ── 3. RENDER ────────────────────────────────────────────────────
function overviewCardHTML({ icon, color, label, value, sub, pct }) {
  return `
    <div class="stx-card">
      <div class="stx-card-icon" style="background:${color}1f;color:${color}">
        <i class="fas ${icon}"></i>
      </div>
      <div class="stx-card-label">${label}</div>
      <div class="stx-card-value">${value}</div>
      <div class="stx-card-sub">${sub}</div>
      <div class="stx-bar-track">
        <div class="stx-bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
    </div>`;
}

function rankListHTML(
  title,
  icon,
  entries,
  { max = 6, emptyLabel = "Sin datos todavía", scroll = false, clickable = false } = {},
) {
  const top = scroll ? entries : entries.slice(0, max);
  const maxVal = top.length ? top[0][1] : 0;
  const rows = top.length
    ? top
        .map(([label, count]) => {
          const attrs = clickable
            ? `data-requester="${esc(label)}" tabindex="0"`
            : "";
          const cls = clickable ? " stx-rank-row--clickable" : "";
          return `
        <div class="stx-rank-row${cls}" ${attrs}>
          <span class="stx-rank-label">${esc(label)}</span>
          <div class="stx-rank-track">
            <div class="stx-rank-fill" style="width:${maxVal ? (count / maxVal) * 100 : 0}%"></div>
          </div>
          <span class="stx-rank-count">${count}</span>
          ${clickable ? '<i class="fas fa-chevron-right stx-rank-arrow"></i>' : ""}
        </div>`;
        })
        .join("")
    : `<div class="stx-rank-empty">${emptyLabel}</div>`;

  const rowsHTML = scroll ? `<div class="stx-rank-scroll">${rows}</div>` : rows;

  return `
    <div class="stx-panel">
      <div class="stx-panel-title"><i class="fas ${icon}"></i> ${title}</div>
      ${rowsHTML}
    </div>`;
}

const REQ_PAGE_SIZE = 8;

// Ordena por date_added descendente (más nuevo primero); lo que no
// tiene fecha se queda al final, en el orden natural en que ya
// estaba (el orden del sheet), sin mezclarse con lo fechado.
function sortRequesterItems(items) {
  const dated = [];
  const undated = [];
  items.forEach((it) => {
    const d = it.dateAdded ? new Date(it.dateAdded) : null;
    if (d && !isNaN(d.getTime())) dated.push({ ...it, _d: d });
    else undated.push(it);
  });
  dated.sort((a, b) => b._d - a._d);
  return [...dated, ...undated];
}

// Vista de detalle: todo lo que pidió una persona puntual, paginado
// (8 por página) para no tirar una lista larga de una. Se intercambia
// adentro del mismo modal (drill-down), con un botón para volver al
// resumen general.
function requesterDetailHTML(stats, name, page = 1) {
  const allItems = sortRequesterItems(stats.requesterItems.get(name) || []);
  const totalPages = Math.max(1, Math.ceil(allItems.length / REQ_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * REQ_PAGE_SIZE;
  const items = allItems.slice(start, start + REQ_PAGE_SIZE);

  const rows = items.length
    ? items
        .map(
          (it) => `
        <div class="stx-req-item">
          <span class="stx-req-item-badge stx-req-item-badge--${it.kind}">
            ${it.kind === "series" ? "Serie" : "Película"}
          </span>
          <span class="stx-req-item-title">${esc(it.title)}</span>
        </div>`,
        )
        .join("")
    : `<div class="stx-rank-empty">No se encontraron pedidos.</div>`;

  const pagination =
    totalPages > 1
      ? `
    <div class="stx-req-pager">
      <button class="stx-pager-btn" data-stx-page="${safePage - 1}" data-stx-name="${esc(name)}" ${safePage <= 1 ? "disabled" : ""}>
        <i class="fas fa-chevron-left"></i>
      </button>
      <span class="stx-pager-label">Página ${safePage} de ${totalPages}</span>
      <button class="stx-pager-btn" data-stx-page="${safePage + 1}" data-stx-name="${esc(name)}" ${safePage >= totalPages ? "disabled" : ""}>
        <i class="fas fa-chevron-right"></i>
      </button>
    </div>`
      : "";

  return `
    <button class="stx-back-btn" data-stx-back type="button">
      <i class="fas fa-arrow-left"></i> Volver a Estadísticas
    </button>
    <div class="stx-req-header">
      <div class="stx-req-avatar"><i class="fas fa-user"></i></div>
      <div>
        <div class="stx-req-name">${esc(name)}</div>
        <div class="stx-req-count">${allItems.length} pedido${allItems.length === 1 ? "" : "s"} en total</div>
      </div>
    </div>
    <div class="stx-req-list">${rows}</div>
    ${pagination}`;
}

function episodeCardHTML(label, item, icon) {
  if (!item) {
    return `
      <div class="stx-ep-card">
        <div class="stx-ep-label"><i class="fas ${icon}"></i> ${label}</div>
        <div class="stx-ep-empty">Sin datos todavía</div>
      </div>`;
  }
  return `
    <div class="stx-ep-card">
      <div class="stx-ep-label"><i class="fas ${icon}"></i> ${label}</div>
      <div class="stx-ep-title">${esc(item.title)}</div>
      <div class="stx-ep-count">${item.count} episodio${item.count === 1 ? "" : "s"}</div>
    </div>`;
}

function renderContent(stats) {
  const overview = [
    overviewCardHTML({
      icon: "fa-th-large",
      color: "#f59e0b",
      label: "Contenido total",
      value: stats.totalContent,
      sub: "películas + series, catálogo y universos",
      pct: 100,
    }),
    overviewCardHTML({
      icon: "fa-film",
      color: "#a855f7",
      label: "Películas",
      value: stats.totalMovies,
      sub: `${stats.pctMovies}% del catálogo`,
      pct: stats.pctMovies,
    }),
    overviewCardHTML({
      icon: "fa-tv",
      color: "#38bdf8",
      label: "Series",
      value: stats.totalSeries,
      sub: `${stats.pctSeries}% del catálogo`,
      pct: stats.pctSeries,
    }),
  ].join("");

  const rankings = [
    rankListHTML("Géneros con más contenido", "fa-tags", stats.genres),
    rankListHTML("Idiomas disponibles", "fa-language", stats.languages),
    rankListHTML("Quién pide más", "fa-user-clock", stats.requesters, {
      scroll: true,
      clickable: true,
      emptyLabel: "Nadie pidió nada todavía",
    }),
  ].join("");

  const episodes = `
    <div class="stx-panel">
      <div class="stx-panel-title"><i class="fas fa-list-ol"></i> Episodios</div>
      <div class="stx-ep-grid">
        <div class="stx-ep-card">
          <div class="stx-ep-label"><i class="fas fa-hashtag"></i> Total de episodios</div>
          <div class="stx-ep-title stx-ep-title--big">${stats.totalEpisodes}</div>
          <div class="stx-ep-count">sumando todas las series</div>
        </div>
        ${episodeCardHTML("Serie más larga", stats.longest, "fa-arrow-up")}
        ${episodeCardHTML("Serie más corta", stats.shortest, "fa-arrow-down")}
      </div>
    </div>`;

  return `
    <div class="stx-overview">${overview}</div>
    <div class="stx-rankings">${rankings}</div>
    ${episodes}`;
}

// ── 4. MODAL ─────────────────────────────────────────────────────
export function openStatsModal() {
  if (!_appState) {
    console.warn("[stats] initStats no fue llamado todavía.");
    return;
  }

  document.getElementById("stx-overlay")?.remove();

  const stats = computeStats();

  const overlay = document.createElement("div");
  overlay.id = "stx-overlay";
  overlay.className = "stx-overlay";
  overlay.innerHTML = `
    <div class="stx-modal">
      <div class="stx-modal-header">
        <div>
          <div class="stx-modal-title"><i class="fas fa-chart-pie"></i> Estadísticas</div>
          <div class="stx-modal-sub">Un vistazo a todo lo que hay en el cine</div>
        </div>
        <button class="stx-close" aria-label="Cerrar" title="Cerrar">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="stx-modal-body">${renderContent(stats)}</div>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("active"));

  function close() {
    overlay.classList.remove("active");
    setTimeout(() => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }, 200);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }

  overlay.querySelector(".stx-close").onclick = close;
  document.addEventListener("keydown", onKey);

  // Drill-down: click en una persona de "Quién pide más" muestra su
  // detalle; el botón de volver restaura el resumen. Un solo listener
  // delegado en el body del modal — sobrevive a los innerHTML swaps
  // porque el nodo body en sí nunca se reemplaza, solo su contenido.
  const body = overlay.querySelector(".stx-modal-body");
  body.addEventListener("click", (e) => {
    if (e.target.closest("[data-stx-back]")) {
      body.innerHTML = renderContent(stats);
      body.scrollTop = 0;
      return;
    }

    const pageBtn = e.target.closest("[data-stx-page]");
    if (pageBtn && !pageBtn.disabled) {
      body.innerHTML = requesterDetailHTML(
        stats,
        pageBtn.dataset.stxName,
        Number(pageBtn.dataset.stxPage),
      );
      body.scrollTop = 0;
      return;
    }

    const row = e.target.closest("[data-requester]");
    if (row) {
      body.innerHTML = requesterDetailHTML(stats, row.dataset.requester);
      body.scrollTop = 0;
    }
  });
  body.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest("[data-requester]");
    if (row) {
      e.preventDefault();
      body.innerHTML = requesterDetailHTML(stats, row.dataset.requester);
      body.scrollTop = 0;
    }
  });
}

// ── 5. ESTILOS ───────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById("stats-css")) return;
  const s = document.createElement("style");
  s.id = "stats-css";
  s.textContent = `
.stx-overlay {
    position: fixed;
    inset: 0;
    z-index: 9998;
    background: rgba(2,4,8,.85);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 6vh 4vw;
    overflow-y: auto;
    opacity: 0;
    transition: opacity .2s ease;
    font-family: "Montserrat", "Bebas Neue", sans-serif;
}
.stx-overlay.active { opacity: 1; }
.stx-modal {
    width: 100%;
    max-width: 980px;
    background: #0a0d12;
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 14px;
    box-shadow: 0 20px 60px rgba(0,0,0,.6);
    transform: translateY(12px);
    transition: transform .2s ease;
    color: #f8fafc;
}
.stx-overlay.active .stx-modal { transform: translateY(0); }
.stx-modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 22px 26px;
    border-bottom: 1px solid rgba(255,255,255,.08);
}
.stx-modal-title { font-size: 1.3rem; font-weight: 800; display: flex; align-items: center; gap: 10px; }
.stx-modal-title i { color: #3b82f6; }
.stx-modal-sub { color: #94a3b8; font-size: .8rem; margin-top: 4px; }
.stx-close {
    width: 34px; height: 34px; border-radius: 50%;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.12);
    color: #f8fafc; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
}
.stx-close:hover { background: rgba(255,255,255,.14); }
.stx-modal-body { padding: 24px 26px 30px; }

.stx-overview {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-bottom: 22px;
}
.stx-card {
    background: #111827;
    border: 1px solid rgba(255,255,255,.06);
    border-radius: 12px;
    padding: 20px;
}
.stx-card-icon {
    width: 42px; height: 42px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 1rem; margin-bottom: 14px;
}
.stx-card-label { color: #94a3b8; font-size: .68rem; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; }
.stx-card-value { font-size: 2rem; font-weight: 800; margin-top: 4px; }
.stx-card-sub { color: #64748b; font-size: .72rem; margin-top: 2px; }
.stx-bar-track { height: 5px; border-radius: 3px; background: rgba(255,255,255,.06); margin-top: 14px; overflow: hidden; }
.stx-bar-fill { height: 100%; border-radius: 3px; }

.stx-rankings {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-bottom: 16px;
}
.stx-panel {
    background: #111827;
    border: 1px solid rgba(255,255,255,.06);
    border-radius: 12px;
    padding: 18px;
}
.stx-panel-title {
    font-size: .8rem; font-weight: 800; margin-bottom: 12px;
    display: flex; align-items: center; gap: 8px; color: #f8fafc;
}
.stx-panel-title i { color: #3b82f6; }
.stx-rank-row { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
.stx-rank-scroll {
    max-height: 168px;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 4px;
    margin-right: -4px;
}
.stx-rank-scroll::-webkit-scrollbar { width: 5px; }
.stx-rank-scroll::-webkit-scrollbar-track { background: transparent; }
.stx-rank-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 3px; }
.stx-rank-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.28); }
.stx-rank-label { font-size: .72rem; color: #cbd5e1; width: 78px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stx-rank-track { flex: 1; height: 5px; border-radius: 3px; background: rgba(255,255,255,.06); overflow: hidden; }
.stx-rank-fill { height: 100%; border-radius: 3px; background: #3b82f6; }
.stx-rank-count { font-size: .68rem; color: #64748b; width: 22px; text-align: right; flex-shrink: 0; }
.stx-rank-empty { color: #64748b; font-size: .72rem; padding: 8px 0; }

.stx-ep-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.stx-ep-card { background: rgba(255,255,255,.03); border-radius: 10px; padding: 14px; }
.stx-ep-label { font-size: .66rem; color: #94a3b8; text-transform: uppercase; letter-spacing: .4px; display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.stx-ep-label i { color: #3b82f6; }
.stx-ep-title { font-size: .82rem; font-weight: 700; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stx-ep-title--big { font-size: 1.7rem; font-weight: 800; }
.stx-ep-count { font-size: .68rem; color: #64748b; margin-top: 3px; }
.stx-ep-empty { color: #64748b; font-size: .72rem; }

.stx-rank-row--clickable {
    cursor: pointer;
    border-radius: 6px;
    margin: 0 -6px 9px;
    padding: 3px 6px;
    transition: background .12s ease;
}
.stx-rank-row--clickable:hover,
.stx-rank-row--clickable:focus-visible {
    background: rgba(255,255,255,.05);
    outline: none;
}
.stx-rank-arrow { color: #475569; font-size: .6rem; flex-shrink: 0; }

.stx-back-btn {
    display: flex; align-items: center; gap: 8px;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.1);
    color: #f8fafc;
    font-family: inherit; font-size: .78rem; font-weight: 700;
    padding: 9px 14px; border-radius: 8px; cursor: pointer;
    margin-bottom: 20px;
}
.stx-back-btn:hover { background: rgba(255,255,255,.12); }

.stx-req-header { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
.stx-req-avatar {
    width: 48px; height: 48px; border-radius: 50%;
    background: rgba(59,130,246,.15); color: #3b82f6;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.2rem; flex-shrink: 0;
}
.stx-req-name { font-size: 1.15rem; font-weight: 800; }
.stx-req-count { font-size: .75rem; color: #94a3b8; margin-top: 2px; }
.stx-req-list { display: flex; flex-direction: column; gap: 6px; }
.stx-req-item {
    display: flex; align-items: center; gap: 10px;
    background: #111827; border: 1px solid rgba(255,255,255,.06);
    border-radius: 8px; padding: 10px 12px;
}
.stx-req-item-badge {
    font-size: .6rem; font-weight: 800; text-transform: uppercase;
    letter-spacing: .4px; padding: 3px 8px; border-radius: 20px;
    flex-shrink: 0;
}
.stx-req-item-badge--movie { background: rgba(168,85,247,.15); color: #a855f7; }
.stx-req-item-badge--series { background: rgba(56,189,248,.15); color: #38bdf8; }
.stx-req-item-title { font-size: .82rem; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.stx-req-pager {
    display: flex; align-items: center; justify-content: center;
    gap: 16px; margin-top: 18px;
}
.stx-pager-btn {
    width: 32px; height: 32px; border-radius: 8px;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.1);
    color: #f8fafc; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: .75rem;
}
.stx-pager-btn:hover:not(:disabled) { background: rgba(255,255,255,.14); }
.stx-pager-btn:disabled { opacity: .35; cursor: default; }
.stx-pager-label { font-size: .74rem; color: #94a3b8; }

@media (max-width: 760px) {
    .stx-overview, .stx-rankings, .stx-ep-grid { grid-template-columns: 1fr; }
    .stx-overlay { padding: 0; align-items: stretch; }
    .stx-modal { max-width: 100%; border-radius: 0; min-height: 100%; }
}
    `;
  document.head.appendChild(s);
}
