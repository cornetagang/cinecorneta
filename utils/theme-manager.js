// ===========================================================
// GESTOR DE TEMAS (Halloween, Navidad…)
// -----------------------------------------------------------
// Modos (nodo Firebase `site_theme`, lectura pública):
//   { mode: "auto" }                       → por fechas (hora de Chile)
//   { mode: "manual", theme: "halloween" } → forzado por el admin
//   { mode: "off" }                        → sin tema para todos
// Cada usuario puede además apagarlo (localStorage `themeOptOut`).
//
// El calendario vive en el script del <head> (window.__THEME_SCHEDULE),
// que pone la clase en <html> antes del primer render. Aquí solo se
// lee, para no duplicarlo.
// ===========================================================

const CACHE_KEY = "siteTheme";
const OPTOUT_KEY = "themeOptOut";

// Modo liviano (equipos débiles): sin niebla, brasas ni animaciones; las
// apariciones con video siguen, con menos resolución y cuadros por segundo.
//   localStorage `themeLite`: "on" | "off" | (vacío = automático según el equipo)
const LITE_KEY = "themeLite";
const LITE_MAX_CORES = 2;      // hilos de CPU: 2 o menos (Celeron, Pentium) → liviano; i3/i5/Ryzen quedan en completo
const LITE_MAX_MEMORY_GB = 2;  // navigator.deviceMemory: 2 GB o menos → liviano
const IGNORE_REDUCED_MOTION = true; // TEMPORAL: pruebas de efectos (dejar en false al publicar)
// Prueba local del admin: solo vale en este navegador y gana sobre
// Firebase y el calendario. Se borra con "Quitar prueba".
const LOCAL_KEY = "themeLocalTest";
// Cuando pasemos a tema global, poner en true para mostrar el botón
// "Guardar para todos" (escribe en Firebase `site_theme`).
const GLOBAL_SAVE_ENABLED = true;

// Apariciones (videos croma) — intervalo elegido en el panel de admin.
// Se guarda igual que el tema: local por ahora, y dentro de `site_theme.cameo`
// en Firebase cuando GLOBAL_SAVE_ENABLED pase a true. Todo en segundos.
const CAMEO_LOCAL_KEY = "themeCameoLocal";
const CAMEO_FALLBACK = { enabled: true, firstDelay: 15, minDelay: 60, maxDelay: 180 };

const NORMAL = {
  icon: "https://res.cloudinary.com/djhgmmdjx/image/upload/v1759209689/u71QEFc_bet4rv.png",
  logo: "https://res.cloudinary.com/djhgmmdjx/image/upload/v1759209688/vgJjqSM_oicebo.png",
};

export const THEME_ASSETS = {
  normal: NORMAL,
  navidad: {
    icon: "https://res.cloudinary.com/djhgmmdjx/image/upload/v1762920149/cornenavidad_lxtqh3.webp",
    logo: "https://res.cloudinary.com/djhgmmdjx/image/upload/v1763875732/NavidadCorneta_pjcdgq.webp",
  },
  halloween: {
    icon: "https://res.cloudinary.com/djhgmmdjx/image/upload/v1790795083/clrbmguuo32cablo3bwl.webp",
    logo: null, // el logo es texto
  },
};
THEME_ASSETS.christmas = THEME_ASSETS.navidad; // alias de compatibilidad

export const THEME_LABELS = { halloween: "Halloween", navidad: "Navidad" };
const TITLE_EMOJI = { navidad: "🎄 " };

// Temas con CSS listo. Navidad aún no tiene paleta en themes.css.
const SCHEDULE = () =>
  window.__THEME_SCHEDULE || [
    { theme: "halloween", from: "10-01", to: "10-31" },
    { theme: "navidad", from: "12-01", to: "12-31", ready: false },
  ];
const isReady = (name) =>
  SCHEDULE().some((t) => t.theme === name && t.ready !== false);

// Efectos (niebla, brasas, nieve): un solo módulo para todos los temas,
// cargado solo cuando hay un tema activo.
let fxModule = null;
const loadFx = () =>
  (fxModule ||= import("../features/themes/fx-themes.js"));

// ── Fecha en Chile ──────────────────────────────────────────
function chileMonthDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("month")}-${get("day")}`;
}

export function themeFromDate(date = new Date()) {
  const md = chileMonthDay(date);
  const hit = SCHEDULE().find(
    (t) => t.ready !== false && md >= t.from && md <= t.to,
  );
  return hit ? hit.theme : null;
}

// ── Preferencias guardadas ──────────────────────────────────
function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); }
  catch { return null; }
}
function writeCache(setting) {
  try {
    if (setting) localStorage.setItem(CACHE_KEY, JSON.stringify(setting));
    else localStorage.removeItem(CACHE_KEY);
  } catch {}
}

export function readLocalTest() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); }
  catch { return null; }
}
export function writeLocalTest(setting) {
  try {
    if (setting) localStorage.setItem(LOCAL_KEY, JSON.stringify(setting));
    else localStorage.removeItem(LOCAL_KEY);
  } catch {}
}

// ── Apariciones: ajustes del admin ──────────────────────────
const CLIP_LAYOUTS = ["cover", "contain", "pop"];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_CLIPS = 20;
const newClipId = () =>
  "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Un video de aparición guardado por el admin. Solo se aceptan URLs https.
function sanitizeClip(c) {
  if (!c || typeof c !== "object") return null;
  const src = typeof c.src === "string" ? c.src.trim() : "";
  if (!/^https:\/\/\S+$/i.test(src)) return null;
  const out = {
    id: String(c.id || "").replace(/[^\w-]/g, "").slice(0, 40) || newClipId(),
    name: String(c.name || "").trim().slice(0, 60) || "Video",
    src,
    enabled: c.enabled !== false,
    layout: CLIP_LAYOUTS.includes(c.layout) ? c.layout : "cover",
    sound: c.sound === true,
  };
  const range = (v, lo, hi) => {
    const n = Number(v);
    return v != null && v !== "" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined;
  };
  const vol = range(c.volume, 0, 1);
  if (vol !== undefined) out.volume = vol;
  ["minDelay", "maxDelay"].forEach((k) => {
    const n = range(c[k], 5, 86400);
    if (n !== undefined) out[k] = Math.round(n);
  });
  if (out.minDelay && out.maxDelay && out.maxDelay < out.minDelay) out.maxDelay = out.minDelay;
  if (c.pool === false) out.pool = false; // fuera del sorteo "uno al azar" (por defecto entran todos)
  const chance = range(c.chance, 0, 100);
  if (chance !== undefined && chance < 100) out.chance = Math.round(chance * 100) / 100;
  if (HEX_COLOR.test(c.key)) out.key = c.key.toLowerCase();
  [["similarity", 0, 1], ["smoothness", 0, 1], ["floor", 0, 0.5], ["dark", 0, 0.3]].forEach(([k, lo, hi]) => {
    const n = range(c[k], lo, hi);
    if (n !== undefined) out[k] = n;
  });
  if (typeof c.despill === "boolean") out.despill = c.despill;
  return out;
}

function sanitizeCameo(c) {
  if (!c || typeof c !== "object") return null;
  const out = { enabled: c.enabled !== false };
  if (c.pickOne === true) out.pickOne = true;   // modo "sale uno al azar cada vez"
  ["firstDelay", "minDelay", "maxDelay"].forEach((k) => {
    const v = Number(c[k]);
    if (c[k] != null && Number.isFinite(v) && v >= 0) out[k] = v;
  });
  // Lista de videos propia de cada tema (si no hay, valen los de fábrica de fx-themes.js).
  if (c.byTheme && typeof c.byTheme === "object") {
    const byTheme = {};
    Object.keys(THEME_LABELS).forEach((t) => {
      const e = c.byTheme[t];
      if (!e || typeof e !== "object") return;
      // Firebase guarda las listas como objeto si tienen huecos; se aceptan ambas.
      const list = Array.isArray(e.clips) ? e.clips : e.clips ? Object.values(e.clips) : [];
      byTheme[t] = {
        custom: true,
        clips: list.map(sanitizeClip).filter(Boolean).slice(0, MAX_CLIPS),
      };
    });
    if (Object.keys(byTheme).length) out.byTheme = byTheme;
  }
  return out;
}
export function readLocalCameo() {
  try { return sanitizeCameo(JSON.parse(localStorage.getItem(CAMEO_LOCAL_KEY) || "null")); }
  catch { return null; }
}
export function writeLocalCameo(c) {
  try {
    if (c) localStorage.setItem(CAMEO_LOCAL_KEY, JSON.stringify(c));
    else localStorage.removeItem(CAMEO_LOCAL_KEY);
  } catch {}
}
/** Ajustes de apariciones vigentes: prueba local > Firebase > null (valores de fx-themes.js). */
export function resolveCameo(setting) {
  const local = readLocalCameo();
  if (local) return local;
  const s = setting === undefined ? readCache() : setting;
  return sanitizeCameo(s && s.cameo);
}

export function isThemeOptedOut() {
  try { return localStorage.getItem(OPTOUT_KEY) === "1"; } catch { return false; }
}
export function setThemeOptOut(off) {
  try {
    if (off) localStorage.setItem(OPTOUT_KEY, "1");
    else localStorage.removeItem(OPTOUT_KEY);
  } catch {}
  applyTheme(resolveTheme());
}

// ── Modo liviano ────────────────────────────────────────────
export function getLiteSetting() {
  try {
    const v = localStorage.getItem(LITE_KEY);
    return v === "on" || v === "off" ? v : "auto";
  } catch { return "auto"; }
}
/** ¿El equipo parece débil? (pocos hilos de CPU, poca RAM o ahorro de datos) */
export function isLowSpecDevice() {
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8;
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  return cores <= LITE_MAX_CORES || mem <= LITE_MAX_MEMORY_GB || saveData;
}
export function isLiteMode() {
  const v = getLiteSetting();
  return v === "on" ? true : v === "off" ? false : isLowSpecDevice();
}
/** value: "on" | "off" | "auto" */
export function setLiteMode(value) {
  try {
    if (value === "on" || value === "off") localStorage.setItem(LITE_KEY, value);
    else localStorage.removeItem(LITE_KEY);
  } catch {}
  applyTheme(resolveTheme());
}

// ── Video forzado por el admin ──────────────────────────────
// El admin escribe `site_theme/forced = { id, ts, clip }`. Todos los que están
// conectados lo reciben por el mismo listener de `site_theme` y lo ven en
// pantalla completa al instante, aunque estén viendo un video. Para que nadie
// reciba uno viejo: la primera lectura (al abrir la página) solo se anota, y
// solo se reproduce cuando cambia el `id` y el mensaje no es antiguo.
const FORCED_MAX_AGE_MS = 2 * 60 * 1000;
let forcedLastId;        // undefined = aún no se leyó el primer valor
let serverOffset = 0;    // diferencia entre el reloj del servidor y el de este equipo

function handleForced(forced) {
  const id = forced && forced.id != null ? String(forced.id) : null;
  if (forcedLastId === undefined) { forcedLastId = id; return; }
  if (!id || id === forcedLastId) return;
  forcedLastId = id;
  const ts = Number(forced.ts);
  if (Number.isFinite(ts) && Date.now() + serverOffset - ts > FORCED_MAX_AGE_MS) return;
  if (document.hidden) return; // pestaña en segundo plano: no se puede dibujar nada
  const clip = sanitizeClip(forced.clip);
  if (!clip) return;
  loadFx()
    .then((m) => m.playForcedNow(clip))
    .catch((e) => console.warn("Video forzado:", e));
}

/** Panel de admin: manda un video para que salga ahora, en pantalla completa, a todos los conectados. */
export async function sendForcedClip(db, clip) {
  const clean = sanitizeClip(clip);
  if (!db || !clean) throw new Error("Video o conexión inválidos");
  const ts = (window.firebase && window.firebase.database && window.firebase.database.ServerValue)
    ? window.firebase.database.ServerValue.TIMESTAMP : Date.now();
  await db.ref("site_theme/forced").set({ id: newClipId(), ts, clip: clean });
}

/** Decide qué tema toca ahora (o null). */
export function resolveTheme(setting) {
  if (isThemeOptedOut()) return null;
  const local = readLocalTest();
  if (local && local.mode) {
    if (local.mode === "off") return null;
    if (local.mode === "manual") return isReady(local.theme) ? local.theme : null;
    return themeFromDate();
  }
  const s = setting === undefined ? readCache() : setting;
  if (s && s.mode === "off") return null;
  if (s && s.mode === "manual") return isReady(s.theme) ? s.theme : null;
  return themeFromDate();
}

export function getActiveTheme() {
  const cls = [...document.documentElement.classList].find((c) =>
    c.startsWith("tema-") && c !== "tema-fx-off");
  return cls ? cls.slice(5) : null;
}

// ── Logo de texto: la O de CORNETA pasa a ser una calabaza ──
// Los logos son texto plano en index.html (.logo en desktop y
// .mobile-top-logo en móvil). Con Halloween activo se reemplaza esa
// O por un SVG; con cualquier otro tema se devuelve el texto original.
const LOGO_SELECTOR = ".logo, .mobile-top-logo";
const LOGO_TEXT = "CINE CORNETA";
const PUMPKIN_SVG =
  '<svg viewBox="0 0 32 32" focusable="false" aria-hidden="true">' +
  '<path d="M15 7.5C15 4.5 16.5 2.5 19.5 2.3L19.7 4.4C18.2 4.6 17.6 5.6 17.6 7.6Z" fill="#4c9a3f"/>' +
  '<ellipse cx="16" cy="18.5" rx="6.2" ry="11" fill="currentColor"/>' +
  '<ellipse cx="10.2" cy="18.8" rx="7.4" ry="10" fill="currentColor"/>' +
  '<ellipse cx="21.8" cy="18.8" rx="7.4" ry="10" fill="currentColor"/>' +
  '<path d="M12.2 8.8Q9.2 18.8 12.2 28.6M19.8 8.8Q22.8 18.8 19.8 28.6" fill="none" stroke="#000" stroke-opacity=".22"/>' +
  '<path d="M9.3 18L13.2 18L11.25 13.8ZM18.8 18L22.7 18L20.75 13.8Z" fill="#140a04"/>' +
  '<path d="M9.8 21.6L12.4 23.6L14.4 21.9L16 24L17.6 21.9L19.6 23.6L22.2 21.6L21.2 25.2Q16 28.4 10.8 25.2Z" fill="#140a04"/>' +
  "</svg>";

function updateLogoText(name) {
  document.querySelectorAll(LOGO_SELECTOR).forEach((el) => {
    const hasPumpkin = !!el.querySelector(".logo-calabaza");
    if (name === "halloween") {
      // Solo si sigue siendo el texto original (no una imagen u otra cosa).
      if (hasPumpkin || el.textContent.trim() !== LOGO_TEXT) return;
      el.setAttribute("aria-label", LOGO_TEXT);
      el.innerHTML =
        'CINE C<span class="logo-calabaza" aria-hidden="true">' +
        PUMPKIN_SVG + "</span>RNETA";
    } else if (hasPumpkin) {
      el.removeAttribute("aria-label");
      el.textContent = LOGO_TEXT;
    }
  });
}

// ── Assets (favicon, título) ────────────────────────────────
export function updateThemeAssets() {
  const name = getActiveTheme();
  const assets = THEME_ASSETS[name] || THEME_ASSETS.normal;

  const iconLink = document.getElementById("app-icon");
  if (iconLink) {
    const url = assets.icon.split("?")[0].toLowerCase();
    iconLink.type = url.endsWith(".ico") ? "image/x-icon"
      : url.startsWith("data:image/svg") ? "image/svg+xml"
      : "image/png";
    iconLink.href = assets.icon;
  }
  // El logo actual es texto (<a class="logo">). Si algún día vuelve a
  // ser <img id="app-logo">, esto lo cubre.
  const logoImg = document.getElementById("app-logo");
  if (logoImg) logoImg.src = assets.logo || NORMAL.logo;

  updateLogoText(name);

  const base = document.title.replace(/^(🎃|🎄)\s*/u, "");
  document.title = (TITLE_EMOJI[name] || "") + base;
}

// ── Aplicar ─────────────────────────────────────────────────
export function applyTheme(name, setting) {
  const root = document.documentElement;
  Object.keys(THEME_LABELS).forEach((k) =>
    root.classList.toggle("tema-" + k, k === name));

  // Equipo débil: ya no se apagan los efectos, se pasa a modo liviano.
  const reduced = !IGNORE_REDUCED_MOTION &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  root.classList.toggle("tema-fx-off", !!reduced);
  const lite = isLiteMode();
  root.classList.toggle("modo-liviano", lite);

  // Si el usuario nunca eligió acento (o quedó el azul por defecto),
  // se quita el style inline para que mande la paleta del tema.
  if (name) {
    let saved = null;
    try { saved = localStorage.getItem("cinemaColor"); } catch {}
    if (!saved || saved.toLowerCase() === "#3b82f6") {
      ["--accent-color", "--accent-rgb", "--accent-dark"].forEach((p) =>
        root.style.removeProperty(p));
    }
  }

  updateThemeAssets();

  const fxOn = !!name && !root.classList.contains("tema-fx-off");
  if (fxOn) {
    loadFx()
      .then((m) => {
        m.setCameoSettings(resolveCameo(setting));
        m.startThemeFx(name, { lite });
      })
      .catch((e) => console.warn("FX del tema no cargó:", e));
  } else if (fxModule) {
    fxModule.then((m) => m.stopThemeFx()).catch(() => {});
  }
}

// Revisa cada tanto si el tema que toca cambió (por ejemplo, pasó la medianoche
// del 1 de octubre con la página abierta) y lo aplica sin recargar.
let themeWatch = 0;
function watchThemeByDate() {
  if (themeWatch) return;
  const check = () => {
    const want = resolveTheme();
    if (want !== getActiveTheme()) applyTheme(want);
  };
  themeWatch = setInterval(check, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
}

/** Arranque: aplica lo cacheado y se suscribe al ajuste del admin. */
export function initTheme(db) {
  applyTheme(resolveTheme());
  watchThemeByDate();
  if (!db) return;
  try {
    db.ref(".info/serverTimeOffset").on("value", (s) => { serverOffset = Number(s.val()) || 0; });
    db.ref("site_theme").on(
      "value",
      (snap) => {
        // `forced` es un aviso de un solo uso: no es parte del ajuste del tema ni se cachea.
        const { forced, ...rest } = snap.val() || {};
        const setting = Object.keys(rest).length ? rest : null;
        writeCache(setting);
        applyTheme(resolveTheme(setting), setting);
        handleForced(forced);
      },
      (err) => console.warn("No se pudo leer site_theme:", err),
    );
  } catch (err) {
    console.warn("initTheme:", err);
  }
}


// ── Cuentagotas del croma ───────────────────────────────────
// Abre un modal con un frame del video real: se toca el verde del fondo y
// al lado se ve el recorte en vivo (sobre un tablero de ajedrez). Usa el
// mismo shader que las apariciones, así lo que ves es lo que saldrá.
function openKeyPicker(fx, clip, onApply) {
  const opts = { ...fx.CAMEO_DEFAULTS };
  ["key", "similarity", "smoothness", "floor", "dark", "despill"].forEach((k) => {
    if (clip[k] !== undefined && clip[k] !== null && clip[k] !== "") opts[k] = clip[k];
  });

  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:12px;overflow:auto;font:13px system-ui,sans-serif;color:#fff";
  wrap.innerHTML = `
    <div style="background:#15131c;border:1px solid rgba(255,255,255,.15);border-radius:14px;padding:14px;max-width:1100px;width:100%">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong>Cuentagotas · toca el verde del video</strong>
        <button type="button" data-k="close" style="background:none;border:0;color:#fff;font-size:18px;cursor:pointer">✕</button>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div style="flex:1 1 320px;min-width:0">
          <div style="opacity:.7;margin-bottom:4px">Original</div>
          <canvas data-k="src" style="width:100%;background:#000;border-radius:8px;cursor:crosshair;display:block"></canvas>
        </div>
        <div style="flex:1 1 320px;min-width:0">
          <div style="opacity:.7;margin-bottom:4px">Resultado (así saldrá)</div>
          <canvas data-k="out" style="width:100%;border-radius:8px;display:block;background:repeating-conic-gradient(#3a3a44 0% 25%,#24242c 0% 50%) 0 0/20px 20px"></canvas>
        </div>
      </div>
      <div style="margin:10px 0;display:flex;gap:10px;align-items:center">
        <span style="opacity:.7">Momento</span>
        <input data-k="seek" type="range" min="0" max="1000" value="300" style="flex:1">
        <span data-k="time" style="min-width:64px;text-align:right;opacity:.8">0:00</span>
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <span style="display:flex;gap:8px;align-items:center">
          <span data-k="swatch" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(255,255,255,.4)"></span>
          <code data-k="hex"></code>
          <span data-k="hover" style="opacity:.6"></span>
        </span>
        <label style="display:flex;gap:6px;align-items:center">Parecido<input data-k="similarity" type="range" min="0" max="100" style="width:110px"><span data-v="similarity"></span></label>
        <label style="display:flex;gap:6px;align-items:center">Suavizado<input data-k="smoothness" type="range" min="0" max="100" style="width:110px"><span data-v="smoothness"></span></label>
        <label style="display:flex;gap:6px;align-items:center">Piso<input data-k="floor" type="range" min="0" max="50" style="width:90px"><span data-v="floor"></span></label>
        <label style="display:flex;gap:6px;align-items:center">Negros<input data-k="dark" type="range" min="0" max="30" style="width:90px"><span data-v="dark"></span></label>
      </div>
      <div data-k="msg" style="min-height:18px;opacity:.85;margin-bottom:8px">Cargando video…</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" data-k="cancel" style="padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;cursor:pointer">Cancelar</button>
        <button type="button" data-k="ok" style="padding:8px 14px;border-radius:8px;border:0;background:#ff7a1a;color:#140a04;font-weight:700;cursor:pointer">Usar este ajuste</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const q = (k) => wrap.querySelector(`[data-k="${k}"]`);
  const srcCv = q("src"), outCv = q("out"), msg = q("msg");

  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = clip.src;

  let renderer = null;
  const srcCtx = srcCv.getContext("2d", { willReadFrequently: true });

  const close = () => {
    renderer?.stop();
    video.pause();
    video.removeAttribute("src");
    video.load();
    wrap.remove();
  };
  q("close").onclick = q("cancel").onclick = close;
  wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });

  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const toHex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

  const sync = () => {
    q("swatch").style.background = opts.key;
    q("hex").textContent = opts.key;
    ["similarity", "smoothness"].forEach((k) => {
      q(k).value = Math.round(opts[k] * 100);
      wrap.querySelector(`[data-v="${k}"]`).textContent = opts[k].toFixed(2);
    });
    ["floor", "dark"].forEach((k) => {
      q(k).value = Math.round(opts[k] * 100);
      wrap.querySelector(`[data-v="${k}"]`).textContent = opts[k].toFixed(2);
    });
    renderer?.setOptions(opts);
  };

  const draw = () => {
    srcCtx.drawImage(video, 0, 0, srcCv.width, srcCv.height);
    renderer?.redraw();
  };

  // Promedio de un cuadro de 7×7 px: un solo píxel es ruidoso por la compresión del video.
  const sample = (e, size) => {
    const r = srcCv.getBoundingClientRect();
    const x = Math.round((e.clientX - r.left) * srcCv.width / r.width);
    const y = Math.round((e.clientY - r.top) * srcCv.height / r.height);
    const h = Math.floor(size / 2);
    const x0 = Math.max(0, Math.min(srcCv.width - size, x - h));
    const y0 = Math.max(0, Math.min(srcCv.height - size, y - h));
    const d = srcCtx.getImageData(x0, y0, size, size).data;
    let R = 0, G = 0, B = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
    return toHex(R / n, G / n, B / n);
  };

  srcCv.addEventListener("click", (e) => {
    try {
      opts.key = sample(e, 7);
      msg.textContent = "Color tomado. Ajusta Parecido/Suavizado hasta que el resultado quede limpio.";
      sync();
    } catch {
      msg.textContent = "El video no permite leer sus colores (CORS). Sube el video a Cloudinary u otro host con CORS.";
    }
  });
  srcCv.addEventListener("mousemove", (e) => {
    try { q("hover").textContent = sample(e, 1); } catch { /* sin CORS */ }
  });

  const seek = q("seek");
  seek.addEventListener("input", () => {
    if (video.duration) video.currentTime = (Number(seek.value) / 1000) * video.duration;
  });
  video.addEventListener("seeked", () => { draw(); q("time").textContent = fmt(video.currentTime); });

  video.addEventListener("loadedmetadata", () => {
    const k = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
    srcCv.width = outCv.width = Math.round(video.videoWidth * k);
    srcCv.height = outCv.height = Math.round(video.videoHeight * k);
    try {
      renderer = fx.createKeyRenderer(outCv, video, opts);
    } catch (err) { console.warn(err); }
    if (!renderer) msg.textContent = "WebGL no disponible: no se puede ver el resultado, pero el cuentagotas sigue funcionando.";
    else msg.textContent = "Toca sobre el fondo verde del video de la izquierda.";
    sync();
    video.currentTime = Math.max(0.05, video.duration * 0.3);
  }, { once: true });
  video.addEventListener("error", () => { msg.textContent = "No se pudo cargar el video."; });

  ["similarity", "smoothness", "floor", "dark"].forEach((k) => {
    q(k).addEventListener("input", () => { opts[k] = Number(q(k).value) / 100; sync(); });
  });

  q("ok").onclick = () => {
    clip.key = opts.key;
    ["similarity", "smoothness", "floor", "dark"].forEach((k) => { clip[k] = +opts[k].toFixed(2); });
    close();
    onApply?.();
  };
}

// ── Tarjeta del panel admin ─────────────────────────────────
// Por ahora trabaja en LOCAL: aplica el tema solo en este navegador
// para poder probarlo. `db` es opcional y solo se usa si
// GLOBAL_SAVE_ENABLED está en true.
export function renderThemeAdminCard(container, db, cameoHost) {
  if (!container) return;
  const themeOptions = Object.keys(THEME_LABELS)
    .map((k) => `<option value="${k}"${isReady(k) ? "" : " disabled"}>${THEME_LABELS[k]}${isReady(k) ? "" : " (sin diseño aún)"}</option>`)
    .join("");

  // Apariciones: va en su propio cuadro (cameoHost) si se entrega uno; si no,
  // queda dentro de esta tarjeta como antes.
  const cameoBlock = `
      <div class="adash-cameo">
        <div class="adash-cameo-top">
          <h4>Apariciones <small>videos con fondo verde</small></h4>
          <label class="adash-check"><input type="checkbox" id="adash-cameo-on"> Activadas</label>
        </div>
        <div class="adash-theme-row adash-cameo-general">
          <label>Primera aparición (seg)<input type="number" id="adash-cameo-first" min="0" step="1"></label>
          <label>Cada mínimo (min)<input type="number" id="adash-cameo-min" min="0.25" step="0.25"></label>
          <label>Cada máximo (min)<input type="number" id="adash-cameo-max" min="0.25" step="0.25"></label>
        </div>
        <label class="adash-check adash-pool"><input type="checkbox" id="adash-cameo-pool"> Sale uno al azar cada vez (entre los videos que elijas; el % de cada uno es su parte del reparto)</label>
        <p class="adash-theme-info adash-pool-info">Un solo reloj, el intervalo general de arriba: cada vez que toca sale <b>un</b> video elegido entre los que tengan marcado «Participa en el sorteo». El % de cada uno es su parte del reparto: tres videos iguales salen parejo (33% cada uno); uno en 1 frente a otro en 50 casi nunca sale. Los videos que desmarques (etiqueta «aparte») quedan fuera del sorteo y salen solos con su propio intervalo y probabilidad. Los tiempos propios solo cuentan para esos.</p>
        <p class="adash-theme-info adash-general-info">Intervalo general. Cada video puede tener el suyo; si lo dejas vacío, usa este. Cada aparición sale en un momento al azar entre el mínimo y el máximo (para una frecuencia fija, pon el mismo valor en los dos). Nunca salen dos a la vez.</p>
        <h5 id="adash-clips-title" style="margin-top:12px">Videos</h5>
        <div id="adash-clips"></div>
        <div class="adash-theme-row adash-cameo-actions">
          <button id="adash-clip-add" type="button">+ Agregar video</button>
          <button id="adash-clip-reset" type="button">Restaurar de fábrica</button>
          <button id="adash-cameo-apply" type="button">Aplicar apariciones</button>
          <span id="adash-cameo-status" class="adash-theme-status"></span>
        </div>
      </div>`;

  container.innerHTML = `
    <style>
      .adash-theme-card{margin-top:12px;padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#fff}
      .adash-theme-card h4{margin:0 0 4px;font-size:14px;font-weight:700}
      .adash-theme-badge{display:inline-block;margin:0 0 10px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:rgba(255,170,0,.15);color:#ffb84d}
      .adash-theme-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
      .adash-theme-card select,.adash-theme-card button{padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.08);color:#fff;font-size:13px}
      .adash-theme-card button{cursor:pointer;font-weight:600}
      .adash-theme-card button:disabled{opacity:.5;cursor:not-allowed}
      .adash-theme-card select option{color:#000}
      .adash-theme-info{font-size:12px;opacity:.7;margin:0 0 4px}
      .adash-theme-status.ok{color:#21d07a}.adash-theme-status.err{color:#ef4444}
      .adash-cameo{margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.1)}
      .adash-cameo h5{margin:0 0 8px;font-size:13px;font-weight:700}
      .adash-cameo label{display:flex;flex-direction:column;gap:4px;font-size:12px;opacity:.85}
      .adash-cameo label.adash-check{flex-direction:row;align-items:center;gap:8px;font-size:13px;opacity:1;margin-bottom:8px}
      .adash-cameo input[type=number]{width:96px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.08);color:#fff;font-size:13px}
      .adash-chips{display:flex;gap:6px;overflow-x:auto;padding:2px 2px 8px;margin-bottom:6px;scrollbar-width:thin}
      .adash-chip{display:flex;align-items:center;gap:6px;flex:none;max-width:190px;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);cursor:pointer;font-size:12px;font-weight:600;user-select:none}
      .adash-chip:hover{background:rgba(255,255,255,.12)}
      .adash-chip.active{background:rgba(33,208,122,.18);border-color:#21d07a}
      .adash-chip.off span{opacity:.45}
      .adash-chip input[type=checkbox]{width:14px;height:14px;margin:0;flex:none;cursor:pointer}
      .adash-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .adash-chip em{flex:none;font-style:normal;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;background:rgba(255,184,77,.18);color:#ffb84d}
      .adash-chip em:empty{display:none}
      .adash-clip{display:none;margin:0 0 10px;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03)}
      .adash-clip.active{display:block}
      .adash-clip-head{display:flex;gap:8px;align-items:center;margin-bottom:8px}
      .adash-clip input[type=text],.adash-clip input[type=url]{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.08);color:#fff;font-size:13px}
      .adash-clip-head input[type=text]{flex:1;min-width:0}
      .adash-clip-grid{margin:8px 0 0}
      .adash-clip-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:8px}
      .adash-cameo .adash-clip-form input[type=number],.adash-cameo .adash-clip-form select{width:100%;box-sizing:border-box}
      .adash-clip-sound{grid-column:1/-1;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
      .adash-cameo .adash-clip-sound label.adash-check{margin:0}
      .adash-clip-sound input[type=range]{flex:1;min-width:80px;max-width:280px}
      .adash-cameo .adash-clip label.adash-vol{flex-direction:row;align-items:center;gap:8px;flex:0 1 420px;min-width:140px}
      .adash-clip input[type=number]{width:84px}
      .adash-clip input[type=color]{width:48px;height:34px;padding:2px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.08)}
      .adash-clip details{margin-top:8px;font-size:12px}
      .adash-clip summary{cursor:pointer;opacity:.8}
      .adash-cameo-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
      .adash-cameo-top h4{margin:0;font-size:15px}
      .adash-cameo-top h4 small{font-weight:500;font-size:12px;opacity:.6;margin-left:6px}
      .adash-cameo .adash-cameo-top label.adash-check{margin:0}
      .adash-cameo-general{gap:12px}
      .adash-pool-info{display:none}
      .adash-cameo.pool .adash-pool-info{display:block}
      .adash-cameo.pool .adash-general-info{display:none}
      .adash-cameo.pool .adash-clip.in-pool .adash-own-time{opacity:.35;pointer-events:none}
      .adash-pool-opt{display:none!important}
      .adash-cameo.pool .adash-pool-opt{display:flex!important;grid-column:1/-1;margin:0}
      .adash-chip em.solo{background:rgba(120,170,255,.2);color:#8ab4ff}
      .adash-cameo-actions{margin:4px 0 0;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)}
      /* Cuadro independiente (a todo el ancho) */
      .adash-cameo-card{margin-top:0}
      .adash-cameo-card .adash-cameo{margin-top:0;padding-top:0;border-top:0}
      .adash-cameo-card .adash-chips{flex-wrap:wrap;overflow-x:visible}
      .adash-cameo-card .adash-clip-head input[type=text]{flex:0 1 360px}
      .adash-cameo-card .adash-clip-form{grid-template-columns:repeat(4,minmax(0,1fr))}
      @media (max-width:760px){.adash-cameo-card .adash-clip-form{grid-template-columns:repeat(2,minmax(0,1fr))}}
    </style>
    <div class="adash-theme-card">
      <h4>Tema del sitio</h4>
      <span class="adash-theme-badge">${GLOBAL_SAVE_ENABLED ? "Aplicar = prueba local · Guardar para todos = global" : "Prueba local · solo en este navegador"}</span>
      <div class="adash-theme-row">
        <select id="adash-theme-mode">
          <option value="auto">Automático (por fechas)</option>
          <option value="manual">Manual</option>
          <option value="off">Apagado</option>
        </select>
        <select id="adash-theme-pick">${themeOptions}</select>
        <button id="adash-theme-apply" type="button">Aplicar</button>
        <button id="adash-theme-clear" type="button">Quitar prueba</button>
        ${GLOBAL_SAVE_ENABLED ? '<button id="adash-theme-save" type="button">Guardar para todos</button>' : ""}
        <span id="adash-theme-status" class="adash-theme-status"></span>
      </div>
      <p class="adash-theme-info" id="adash-theme-info"></p>
      <p class="adash-theme-info" id="adash-theme-now"></p>
      <div class="adash-theme-row">
        <select id="adash-lite">
          <option value="auto">Modo liviano: automático (según el equipo)</option>
          <option value="on">Modo liviano: siempre activado</option>
          <option value="off">Modo liviano: desactivado (efectos completos)</option>
        </select>
      </div>
      <p class="adash-theme-info" id="adash-lite-info"></p>

      ${cameoHost ? "" : cameoBlock}
    </div>`;

  if (cameoHost) cameoHost.innerHTML = `<div class="adash-theme-card adash-cameo-card">${cameoBlock}</div>`;
  const cameoRoot = cameoHost || container;

  const modeEl = container.querySelector("#adash-theme-mode");
  const pickEl = container.querySelector("#adash-theme-pick");
  const applyEl = container.querySelector("#adash-theme-apply");
  const clearEl = container.querySelector("#adash-theme-clear");
  const saveEl = container.querySelector("#adash-theme-save");
  const statusEl = container.querySelector("#adash-theme-status");
  const infoEl = container.querySelector("#adash-theme-info");
  const nowEl = container.querySelector("#adash-theme-now");
  const liteEl = container.querySelector("#adash-lite");
  const liteInfoEl = container.querySelector("#adash-lite-info");

  const cOnEl = cameoRoot.querySelector("#adash-cameo-on");
  const cPoolEl = cameoRoot.querySelector("#adash-cameo-pool");
  const cFirstEl = cameoRoot.querySelector("#adash-cameo-first");
  const cMinEl = cameoRoot.querySelector("#adash-cameo-min");
  const cMaxEl = cameoRoot.querySelector("#adash-cameo-max");
  const cApplyEl = cameoRoot.querySelector("#adash-cameo-apply");
  const cClipsEl = cameoRoot.querySelector("#adash-clips");
  const cTitleEl = cameoRoot.querySelector("#adash-clips-title");
  const cAddEl = cameoRoot.querySelector("#adash-clip-add");
  const cResetEl = cameoRoot.querySelector("#adash-clip-reset");
  const cStatusEl = cameoRoot.querySelector("#adash-cameo-status");

  let statusTimer;
  const flash = (msg, cls = "ok", el = statusEl) => {
    el.className = "adash-theme-status " + cls;
    el.textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { el.textContent = ""; }, cls === "err" ? 7000 : 3000);
  };

  // Confirmación propia para "Forzar a todos" (en vez del cuadro del navegador).
  // Devuelve una promesa: true si el admin confirma, false si cancela/Esc/clic afuera.
  const confirmForce = (c) => new Promise((resolve) => {
    if (!document.getElementById("adash-force-style")) {
      const st = document.createElement("style");
      st.id = "adash-force-style";
      st.textContent = `
        .adash-force-ov{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.62);backdrop-filter:blur(3px);animation:adashFIn .15s ease-out}
        .adash-force-box{width:min(420px,100%);padding:22px 22px 18px;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:#15151c;color:#fff;box-shadow:0 20px 60px rgba(0,0,0,.6);font-family:inherit}
        .adash-force-ico{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;background:rgba(255,184,77,.16);margin-bottom:12px}
        .adash-force-box h3{margin:0 0 4px;font-size:17px;font-weight:700}
        .adash-force-name{margin:0 0 12px;font-size:13px;opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .adash-force-name b{opacity:1;color:#ffb84d}
        .adash-force-txt{margin:0 0 12px;font-size:13.5px;line-height:1.5;opacity:.92}
        .adash-force-tags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
        .adash-force-tags span{padding:3px 9px;border-radius:999px;font-size:11.5px;font-weight:600;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1)}
        .adash-force-warn{margin:0 0 16px;padding:9px 11px;border-radius:10px;font-size:12px;line-height:1.45;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);color:#fca5a5}
        .adash-force-btns{display:flex;gap:8px;justify-content:flex-end}
        .adash-force-btns button{padding:10px 16px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.08);color:#fff;font-size:13.5px;font-weight:600;cursor:pointer}
        .adash-force-btns button:hover{background:rgba(255,255,255,.15)}
        .adash-force-btns button.go{background:#ffb84d;border-color:#ffb84d;color:#1a1200}
        .adash-force-btns button.go:hover{background:#ffc766}
        .adash-force-btns button:focus-visible{outline:2px solid #8ab4ff;outline-offset:2px}
        @keyframes adashFIn{from{opacity:0}to{opacity:1}}`;
      document.head.appendChild(st);
    }
    const sound = c.sound
      ? "🔊 Con sonido (" + Math.round((Number.isFinite(+c.volume) ? +c.volume : 0.6) * 100) + "%)"
      : "🔇 Sin sonido";
    const layout = c.layout === "pop" ? "Pantalla completa (entero)" : (LAYOUT_LABELS[c.layout] || LAYOUT_LABELS.cover);
    const ov = document.createElement("div");
    ov.className = "adash-force-ov";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-labelledby", "adash-force-title");
    ov.innerHTML = `
      <div class="adash-force-box">
        <div class="adash-force-ico">⚡</div>
        <h3 id="adash-force-title">Forzar video a todos</h3>
        <p class="adash-force-name">Video: <b>${esc(c.name || "Sin nombre")}</b></p>
        <p class="adash-force-txt">Saldrá <b>ahora mismo</b> en pantalla completa a todas las personas que tengan el sitio abierto, aunque estén viendo una película o serie.</p>
        <div class="adash-force-tags"><span>${esc(layout)}</span><span>${esc(sound)}</span></div>
        <p class="adash-force-warn">No se puede deshacer: una vez enviado, el video se reproduce hasta el final en cada pantalla.</p>
        <div class="adash-force-btns">
          <button type="button" data-r="0">Cancelar</button>
          <button type="button" class="go" data-r="1">⚡ Enviar ahora</button>
        </div>
      </div>`;
    const prevFocus = document.activeElement;
    const done = (v) => {
      document.removeEventListener("keydown", onKey, true);
      ov.remove();
      try { prevFocus?.focus?.(); } catch {}
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === "Tab") { // el foco se queda dentro del cuadro
        const b = [...ov.querySelectorAll("button")];
        const i = b.indexOf(document.activeElement);
        e.preventDefault();
        b[(i + (e.shiftKey ? b.length - 1 : 1)) % b.length].focus();
      }
    };
    ov.addEventListener("click", (e) => {
      if (e.target === ov) return done(false);
      const b = e.target.closest("button[data-r]");
      if (b) done(b.dataset.r === "1");
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(ov);
    ov.querySelector('button[data-r="0"]').focus(); // por defecto en Cancelar: un Enter por error no envía
  });

  // Apariciones: los campos muestran minutos, internamente todo va en segundos.
  const fillCameoFields = (c) => {
    const v = { ...CAMEO_FALLBACK, ...(c || {}) };
    cOnEl.checked = v.enabled !== false;
    cPoolEl.checked = v.pickOne === true;
    cameoRoot.querySelector(".adash-cameo")?.classList.toggle("pool", cPoolEl.checked);
    cFirstEl.value = v.firstDelay;
    cMinEl.value = +(v.minDelay / 60).toFixed(2);
    cMaxEl.value = +(v.maxDelay / 60).toFixed(2);
  };
  const readCameoFields = () => {
    const first = Math.max(0, Number(cFirstEl.value) || 0);
    const min = Math.max(0.25, Number(cMinEl.value) || CAMEO_FALLBACK.minDelay / 60);
    const max = Math.max(min, Number(cMaxEl.value) || min);
    const out = {
      enabled: cOnEl.checked,
      ...(cPoolEl.checked ? { pickOne: true } : {}),
      firstDelay: Math.round(first),
      minDelay: Math.round(min * 60),
      maxDelay: Math.round(max * 60),
    };
    // Lista de videos: se guarda solo si se tocó (así los de fábrica siguen
    // actualizándose con el código); los de otros temas se conservan tal cual.
    const byTheme = { ...(resolveCameo()?.byTheme || {}) };
    if (clipsTheme) {
      if (clipsReset) delete byTheme[clipsTheme];
      else if (clipsDirty) {
        byTheme[clipsTheme] = { custom: true, clips: clips.map((c) => ({ ...c })) };
      }
    }
    if (Object.keys(byTheme).length) out.byTheme = byTheme;
    return out;
  };
  fillCameoFields(resolveCameo());

  // ── Videos de las apariciones ─────────────────────────────
  const HTTPS = /^https:\/\/\S+$/i;
  const LAYOUT_LABELS = {
    cover: "Pantalla completa (llenar)",
    contain: "Pantalla completa (entero)",
    pop: "Pequeño, abajo",
  };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const minutes = (s) => (s ? +(s / 60).toFixed(2) : "");
  const editTheme = () => getActiveTheme() || Object.keys(THEME_LABELS).find(isReady) || null;
  const toEditable = (c) => Object.fromEntries(
    Object.entries(c).filter(([k, v]) => v != null && !["width", "align", "valign"].includes(k)));

  let clips = [];
  let clipsTheme = null;
  let clipsDirty = false;   // el admin cambió la lista → se guarda al aplicar
  let clipsReset = false;   // pidió volver a los videos de fábrica
  let activeClip = 0;       // video cuyos ajustes están abiertos

  // En modo "uno al azar" la etiqueta es la parte del reparto (33/33/33 → 33% cada uno);
  // en modo normal es la probabilidad propia, y solo se muestra si es menor a 100.
  const weight = (c) => c.chance ?? 100;
  const badgeText = (c) => {
    if (cPoolEl.checked) {
      if (c.enabled === false) return "";
      if (c.pool === false) return "aparte";
      const total = clips.reduce((sum, x) => sum + (x.enabled === false || x.pool === false ? 0 : weight(x)), 0);
      if (!(total > 0) || !(weight(c) > 0)) return "";
      const pct = (weight(c) / total) * 100;
      return pct < 1 ? "<1%" : Math.round(pct) + "%";
    }
    return c.chance != null && c.chance < 100 ? c.chance + "%" : "";
  };
  const clipSummary = (c) => {
    if (cPoolEl.checked && c.pool !== false) return "Parte del reparto: " + (badgeText(c) || "no sale");
    if (cPoolEl.checked) return "Fuera del sorteo · sale aparte, " + (minutes(c.minDelay) && minutes(c.maxDelay) ? `cada ${minutes(c.minDelay)}–${minutes(c.maxDelay)} min` : "con el intervalo general") + " · " + (c.chance ?? 100) + "%";
    const a = minutes(c.minDelay), b = minutes(c.maxDelay);
    return (a && b ? `Cada ${a}–${b} min` : "Intervalo general") + " · " + (c.chance ?? 100) + "%";
  };
  const refreshBadges = () => cClipsEl.querySelectorAll(".adash-chip").forEach((chip) => {
    const c = clips[Number(chip.dataset.i)];
    if (!c) return;
    const em = chip.querySelector("[data-pct]");
    if (em) { em.textContent = badgeText(c); em.classList.toggle("solo", cPoolEl.checked && c.pool === false); }
    chip.title = clipSummary(c);
  });

  // Pestaña del video (fila horizontal): activo/inactivo + nombre + % si no es 100
  const chipHtml = (c, i) => `
    <div class="adash-chip${i === activeClip ? " active" : ""}${c.enabled === false ? " off" : ""}" data-i="${i}" role="tab" title="${esc(clipSummary(c))}">
      <input type="checkbox" data-f="enabled" title="Activo"${c.enabled !== false ? " checked" : ""}>
      <span>${esc(c.name || "Sin nombre")}</span>
      <em data-pct class="${cPoolEl.checked && c.pool === false ? "solo" : ""}">${esc(badgeText(c))}</em>
    </div>`;

  // Ajustes del video: solo se ve el del video elegido
  const clipHtml = (c, i) => `
    <div class="adash-clip${i === activeClip ? " active" : ""}${c.pool === false ? "" : " in-pool"}" data-i="${i}">
      <div class="adash-clip-head">
        <input type="text" data-f="name" maxlength="60" placeholder="Nombre" value="${esc(c.name)}">
        <button type="button" data-act="force" title="Sale ahora, en pantalla completa, a todos los que estén conectados (aunque estén viendo algo)">⚡ Forzar a todos</button>
        <button type="button" data-act="test">Probar</button>
        <button type="button" data-act="del" title="Eliminar video">✕</button>
      </div>
      <input type="url" data-f="src" placeholder="https://res.cloudinary.com/…/video.mp4" value="${esc(c.src)}">
      <div class="adash-clip-form">
        <label class="adash-check adash-pool-opt" title="Marcado: este video entra al sorteo y comparte el reparto con los demás marcados. Desmarcado: queda fuera y sale aparte, con su propio intervalo y probabilidad."><input type="checkbox" data-f="pool"${c.pool === false ? "" : " checked"}> Participa en el sorteo (si lo desmarcas, sale aparte con su propio intervalo)</label>
        <label class="adash-own-time">Sale cada · mín (min)<input type="number" data-f="minMin" min="0.25" step="0.25" placeholder="general" value="${minutes(c.minDelay)}"></label>
        <label class="adash-own-time">Sale cada · máx (min)<input type="number" data-f="maxMin" min="0.25" step="0.25" placeholder="general" value="${minutes(c.maxDelay)}"></label>
        <label>Probabilidad (%)<input type="number" data-f="chance" min="0" max="100" step="0.1" placeholder="100" value="${c.chance ?? ""}" title="Cada vez que le toca salir se tira el dado: 1 = sale 1 de cada 100 veces. Vacío = siempre."></label>
        <label>Tamaño<select data-f="layout">${Object.keys(LAYOUT_LABELS).map((k) =>
          `<option value="${k}"${(c.layout || "cover") === k ? " selected" : ""}>${LAYOUT_LABELS[k]}</option>`).join("")}</select></label>
        <div class="adash-clip-sound">
          <label class="adash-check"><input type="checkbox" data-f="sound"${c.sound ? " checked" : ""}> Con sonido</label>
          <label class="adash-vol">Volumen <span data-vol>${Math.round((c.volume ?? 0.6) * 100)}%</span>
            <input type="range" data-f="volume" min="0" max="100" value="${Math.round((c.volume ?? 0.6) * 100)}"${c.sound ? "" : " disabled"}></label>
        </div>
      </div>
      <details>
        <summary>Ajuste del verde</summary>
        <div class="adash-theme-row adash-clip-grid">
          <label>Color<input type="color" data-f="key" value="${HEX_COLOR.test(c.key) ? c.key : "#00b140"}"></label>
          <button type="button" data-act="pick" title="Elegir el verde tocando el video">🎯 Cuentagotas</button>
          <label>Parecido<input type="number" data-f="similarity" min="0" max="1" step="0.01" placeholder="0.15" value="${c.similarity ?? ""}"></label>
          <label>Suavizado<input type="number" data-f="smoothness" min="0" max="1" step="0.01" placeholder="0.1" value="${c.smoothness ?? ""}"></label>
          <label>Piso de velo<input type="number" data-f="floor" min="0" max="0.5" step="0.01" placeholder="0.08" value="${c.floor ?? ""}"></label>
          <label>Corte de negros<input type="number" data-f="dark" min="0" max="0.3" step="0.01" placeholder="0.05" value="${c.dark ?? ""}"></label>
          <label class="adash-check"><input type="checkbox" data-f="despill"${c.despill !== false ? " checked" : ""}> Quitar reflejo verde</label>
        </div>
      </details>
    </div>`;

  const renderClips = () => {
    cTitleEl.textContent = clipsTheme ? "Videos de " + THEME_LABELS[clipsTheme] : "Videos";
    if (!clips.length) {
      cClipsEl.innerHTML = '<p class="adash-theme-info">No hay videos. Agrega uno con el botón de abajo.</p>';
      return;
    }
    activeClip = Math.min(Math.max(activeClip, 0), clips.length - 1);
    cClipsEl.innerHTML =
      `<div class="adash-chips" role="tablist">${clips.map(chipHtml).join("")}</div>` +
      clips.map(clipHtml).join("");
  };

  // Cambiar de video no vuelve a dibujar nada: solo se muestra/oculta
  const setActiveClip = (i) => {
    activeClip = i;
    cClipsEl.querySelectorAll(".adash-chip, .adash-clip").forEach((el) =>
      el.classList.toggle("active", Number(el.dataset.i) === i));
    cClipsEl.querySelector(`.adash-chip[data-i="${i}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const defaultClips = async (theme) => {
    try {
      const m = await loadFx();
      return m.getDefaultClips(theme).map(toEditable);
    } catch (err) {
      console.warn("No se pudieron leer los videos de fábrica:", err);
      return [];
    }
  };

  const loadClips = async () => {
    clipsTheme = editTheme();
    clips = [];
    if (clipsTheme) {
      const saved = resolveCameo()?.byTheme?.[clipsTheme];
      clips = saved ? saved.clips.map((c) => ({ ...c })) : await defaultClips(clipsTheme);
    }
    clipsDirty = false;
    clipsReset = false;
    activeClip = 0;
    renderClips();
  };

  const onClipEdit = (e) => {
    const el = e.target;
    const f = el.dataset && el.dataset.f;
    if (!f) return;
    const card = el.closest("[data-i]");   // pestaña o ajustes del video
    const idx = card ? Number(card.dataset.i) : -1;
    const c = clips[idx];
    if (!c) return;
    const chipEl = () => cClipsEl.querySelector(`.adash-chip[data-i="${idx}"]`);
    const editEl = () => cClipsEl.querySelector(`.adash-clip[data-i="${idx}"]`);
    const n = el.value === "" ? null : Number(el.value);
    switch (f) {
      case "enabled":
        c.enabled = el.checked;
        chipEl()?.classList.toggle("off", !c.enabled);
        refreshBadges();
        break;
      case "sound":
        c.sound = el.checked;
        editEl().querySelector('[data-f="volume"]').disabled = !c.sound;
        break;
      case "despill": c.despill = el.checked; break;
      case "pool":
        if (el.checked) delete c.pool; else c.pool = false;
        editEl()?.classList.toggle("in-pool", el.checked);
        refreshBadges();
        break;
      case "name":
        c.name = el.value;
        { const sp = chipEl()?.querySelector("span"); if (sp) sp.textContent = el.value || "Sin nombre"; }
        break;
      case "src": case "layout": case "key": c[f] = el.value; break;
      case "volume":
        c.volume = Number(el.value) / 100;
        editEl().querySelector("[data-vol]").textContent = el.value + "%";
        break;
      case "minMin": case "maxMin": {
        const k = f === "minMin" ? "minDelay" : "maxDelay";
        if (n > 0) c[k] = Math.round(n * 60); else delete c[k];
        if (chipEl()) chipEl().title = clipSummary(c);
        break;
      }
      case "similarity": case "smoothness": case "floor": case "dark":
        if (n != null && Number.isFinite(n)) c[f] = n; else delete c[f];
        break;
      case "chance":
        // Vacío o 100 = siempre sale (no se guarda el campo).
        if (n != null && Number.isFinite(n) && n < 100) c.chance = Math.max(0, n); else delete c.chance;
        refreshBadges();
        break;
    }
    clipsDirty = true;
  };
  cPoolEl.addEventListener("change", () => {
    cameoRoot.querySelector(".adash-cameo")?.classList.toggle("pool", cPoolEl.checked);
    refreshBadges();
  });
  cClipsEl.addEventListener("input", onClipEdit);
  cClipsEl.addEventListener("change", onClipEdit);

  cClipsEl.addEventListener("click", async (e) => {
    // Pestaña del video (el checkbox de activar no cambia de pestaña)
    const chip = e.target.closest(".adash-chip");
    if (chip && !e.target.closest("input")) return setActiveClip(Number(chip.dataset.i));
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const i = Number(btn.closest(".adash-clip").dataset.i);
    const c = clips[i];
    if (!c) return;
    if (btn.dataset.act === "del") {
      clips.splice(i, 1);
      if (i < activeClip) activeClip--;
      clipsDirty = true;
      renderClips();
    } else if (btn.dataset.act === "pick") {
      if (!HTTPS.test((c.src || "").trim())) return flash("Falta la URL https del video", "err", cStatusEl);
      try {
        const m = await loadFx();
        openKeyPicker(m, c, () => { clipsDirty = true; renderClips(); flash("Ajuste del verde aplicado al video", "ok", cStatusEl); });
      } catch (err) {
        console.warn("Cuentagotas:", err);
        flash("No se pudo abrir el cuentagotas", "err", cStatusEl);
      }
    } else if (btn.dataset.act === "force") {
      if (!HTTPS.test((c.src || "").trim())) return flash("Falta la URL https del video", "err", cStatusEl);
      if (!db) return flash("Sin conexión a Firebase: no se puede enviar a todos", "err", cStatusEl);
      if (!(await confirmForce(c))) return;
      btn.disabled = true;
      try {
        await sendForcedClip(db, c);
        flash("⚡ «" + (c.name || "Video") + "» enviado a todos ✓", "ok", cStatusEl);
      } catch (err) {
        console.error("Error enviando video forzado:", err);
        const denied = err && (err.code === "PERMISSION_DENIED" || /permission/i.test(String(err.message)));
        flash(denied
          ? "Firebase rechazó el envío: revisa que sigas con sesión de admin y las reglas de site_theme/forced"
          : "No se pudo enviar. Revisa tu conexión e inténtalo de nuevo", "err", cStatusEl);
      } finally {
        btn.disabled = false;
      }
    } else if (btn.dataset.act === "test") {
      // Prueba el video tal como está en pantalla, sin guardarlo: sirve para afinar el verde.
      if (!HTTPS.test((c.src || "").trim())) return flash("Falta la URL https del video", "err", cStatusEl);
      try {
        const m = await loadFx();
        const ok = m.playCameoNow({ ...c });
        flash(ok ? "Lanzado ✓" : "Necesita un tema activo (o ya hay una aparición en pantalla)", ok ? "ok" : "err", cStatusEl);
      } catch (err) {
        console.warn("Probar aparición:", err);
        flash("No se pudo lanzar", "err", cStatusEl);
      }
    }
  });

  cAddEl.addEventListener("click", () => {
    if (!clipsTheme) return flash("No hay un tema con apariciones", "err", cStatusEl);
    if (clips.length >= MAX_CLIPS) return flash("Máximo " + MAX_CLIPS + " videos", "err", cStatusEl);
    clips.push({ id: newClipId(), name: "Video nuevo", src: "", enabled: true, layout: "cover", sound: false, volume: 0.6 });
    clipsDirty = true;
    activeClip = clips.length - 1;
    renderClips();
    cClipsEl.querySelector('.adash-clip.active [data-f="src"]')?.focus();
    cClipsEl.querySelector(".adash-chip.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  cResetEl.addEventListener("click", async () => {
    if (!clipsTheme) return;
    clips = await defaultClips(clipsTheme);
    clipsDirty = false;
    clipsReset = true;   // al aplicar, se borra la lista propia y vuelven los de fábrica
    renderClips();
    flash("Videos de fábrica cargados. Aplica para guardar.", "ok", cStatusEl);
  });
  loadClips();

  const refreshUi = () => {
    pickEl.style.display = modeEl.value === "manual" ? "" : "none";
    const byDate = themeFromDate();
    infoEl.textContent = "Por fechas hoy (hora de Chile) corresponde: " +
      (byDate ? THEME_LABELS[byDate] : "ningún tema") + ".";
    const active = getActiveTheme();
    const reasons = [];
    if (isThemeOptedOut()) reasons.push("apagado por el usuario");
    if (readLocalTest()) reasons.push("prueba local activa");
    if (isLiteMode()) reasons.push("modo liviano");
    nowEl.textContent = "Tema aplicado ahora: " +
      (active ? THEME_LABELS[active] : "ninguno") +
      (reasons.length ? " (" + reasons.join(", ") + ")" : "") + ".";
  };
  modeEl.addEventListener("change", refreshUi);

  const refreshLite = () => {
    liteInfoEl.textContent = "Este equipo se detecta como " +
      (isLowSpecDevice() ? "liviano" : "normal") + " · ahora: " +
      (isLiteMode() ? "modo liviano activo (sin niebla ni brasas; apariciones en calidad reducida)" : "efectos completos") +
      ". Se guarda solo en este navegador.";
  };
  liteEl.value = getLiteSetting();
  refreshLite();
  liteEl.addEventListener("change", () => {
    setLiteMode(liteEl.value);
    refreshLite();
    refreshUi();
    flash("Aplicado ✓");
  });

  // Estado inicial: prueba local si existe; si no, lo último de Firebase.
  const current = readLocalTest() || readCache();
  if (current?.mode) modeEl.value = current.mode;
  if (current?.theme && isReady(current.theme)) pickEl.value = current.theme;
  else pickEl.value = Object.keys(THEME_LABELS).find(isReady) || "";
  refreshUi();

  applyEl.addEventListener("click", () => {
    const mode = modeEl.value;
    if (mode === "manual" && !pickEl.value) return flash("Elige un tema", "err");
    writeLocalTest(mode === "manual" ? { mode, theme: pickEl.value } : { mode });
    applyTheme(resolveTheme());
    if (editTheme() !== clipsTheme) loadClips();
    refreshUi();
    flash("Aplicado ✓");
  });

  clearEl.addEventListener("click", () => {
    writeLocalTest(null);
    writeLocalCameo(null);
    applyTheme(resolveTheme());
    const fallback = readCache();
    modeEl.value = fallback?.mode || "auto";
    fillCameoFields(resolveCameo());
    loadClips();
    refreshUi();
    flash("Prueba quitada ✓");
  });

  cApplyEl.addEventListener("click", async () => {
    const bad = clips.find((c) => !HTTPS.test((c.src || "").trim()));
    if (bad) return flash("Falta la URL https de «" + (bad.name || "sin nombre") + "»", "err", cStatusEl);
    const cameo = sanitizeCameo(readCameoFields());
    writeLocalCameo(cameo);          // primero local: se ve al instante aunque falle la red
    let saved = false;
    if (db) {
      cApplyEl.disabled = true;
      try {
        // Solo se toca site_theme/cameo: el modo y el tema elegidos no se pisan.
        await db.ref("site_theme/cameo").set(cameo);
        // Ya está en Realtime Database: se quita la copia local para que no tape
        // futuros cambios y se actualiza la caché con lo recién guardado.
        writeCache({ ...(readCache() || {}), cameo });
        writeLocalCameo(null);
        saved = true;
      } catch (err) {
        console.error("Error guardando site_theme/cameo:", err);
      } finally {
        cApplyEl.disabled = false;
      }
    }
    fillCameoFields(resolveCameo()); // refleja valores ya corregidos (mín. 15 s, máx ≥ mín)
    applyTheme(resolveTheme());
    await loadClips();               // y la lista tal como quedó guardada
    if (!db) flash("Apariciones aplicadas (solo en este navegador) ✓", "ok", cStatusEl);
    else if (saved) flash("Apariciones guardadas para todos ✓", "ok", cStatusEl);
    else flash("Aplicado solo aquí: no se pudo guardar en Firebase", "err", cStatusEl);
  });

  if (saveEl && db) {
    saveEl.addEventListener("click", async () => {
      const mode = modeEl.value;
      const payload = {
        ...(mode === "manual" ? { mode, theme: pickEl.value } : { mode }),
        cameo: sanitizeCameo(readCameoFields()),
      };
      saveEl.disabled = true;
      try {
        await db.ref("site_theme").set(payload);
        writeLocalTest(null); // que mande el valor global
        writeLocalCameo(null);
        applyTheme(resolveTheme(payload), payload);
        refreshUi();
        flash("Guardado para todos ✓");
      } catch (err) {
        console.error("Error guardando site_theme:", err);
        flash("Error al guardar", "err");
      } finally {
        saveEl.disabled = false;
      }
    });
  }
}

export default {
  initTheme, applyTheme, resolveTheme, themeFromDate, getActiveTheme,
  updateThemeAssets, setThemeOptOut, isThemeOptedOut, renderThemeAdminCard,
  readLocalTest, writeLocalTest,
  resolveCameo, readLocalCameo, writeLocalCameo, sendForcedClip,
  getLiteSetting, isLowSpecDevice, isLiteMode, setLiteMode,
  THEME_ASSETS, THEME_LABELS,
};
