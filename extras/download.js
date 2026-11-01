// ===========================================================
// DESCARGAS — extras/download.js
// ===========================================================
// Botón "Descargar" de películas y episodios.
// Pide al Worker que prepare un MKV con el video ORIGINAL + el subtítulo incrustado
// (lo arma GitHub Actions, una sola vez por título) y lo baja cuando está listo.
//
//   POST /dl-request  → inicia la preparación (o reutiliza una ya hecha / en curso)
//   GET  /dl-status   → estado: queued | running | ready | error
//   POST /dl-sign     → enlace de descarga firmado (dura 10 min)
//
// Uso desde script.js (carga perezosa):
//   const dl = await import("./extras/download.js?v=1");
//   dl.openMovieDownload(id, data);
//   dl.openEpisodeDownload({ seriesId, seriesData, seasons, seasonOrder, seasonPosters, season, index, activeLang });
//   (la ventana de series trae su propio selector de Temporada y Episodio: no hace falta reproducir)
//
// Mientras se prueba, solo lo ve el admin. Para abrirlo a todos: DL_ADMIN_ONLY = false.

import { WORKER_URL, PERMISSIONS } from "../core/config.js";
import ContentManager from "../utils/content-manager.js";

const DL_ADMIN_ONLY = true;

const POLL_FAST_MS = 4000;                 // consulta de estado: cada 4 s…
const POLL_SLOW_MS = 10000;                // …y cada 10 s pasado el primer minuto
const POLL_SLOW_AFTER_MS = 60 * 1000;
const POLL_GIVE_UP_MS = 45 * 60 * 1000;    // deja de preguntar a los 45 min (el trabajo sigue en el servidor)

// ───────────────────────────────────────────────────────────
// Pistas de audio y subtítulo: MISMAS reglas que el reproductor
// ───────────────────────────────────────────────────────────

// Espejo de getLangTracks() de features/player.js: así lo que se descarga es
// exactamente lo que el usuario ve en pantalla (incluida la etiqueta de idioma).
function getLangTracks(data) {
  const rawEn = data.videoId_en?.trim() || "";
  const rawEs = data.videoId_es?.trim() || "";
  const rawJp = data.videoId_jp?.trim() || data.videoId_alt?.trim() || "";
  const rawMain = data.videoId?.trim() || "";

  const rawLang = (data.language || data.idioma || data.audio || "").trim();
  const langParts = rawLang
    .split(/[-;|]/)
    .map((l) => l.trim())
    .filter(Boolean);

  const SPANISH_LABELS = ["latino", "español", "castellano", "doblado", "esp"];
  const isSpanish = (l) =>
    SPANISH_LABELS.some((s) => l.toLowerCase().includes(s));

  const spanishLabel = langParts.find((l) => isSpanish(l)) || "Latino";
  const originalLabels = langParts.filter((l) => !isSpanish(l));

  const mainIsSpanish =
    langParts.length > 0 && langParts.every((l) => isSpanish(l));

  const tracks = [];

  if (rawEn) {
    tracks.push({
      id: rawEn,
      lang: "en",
      label: originalLabels[0] || "Original",
    });
  } else if (rawMain && !mainIsSpanish && !rawEs) {
    tracks.push({
      id: rawMain,
      lang: "en",
      label: originalLabels[0] || "Original",
    });
  }

  if (rawEs) {
    // El video puede estar guardado en el campo _es por convención aunque
    // el audio real NO sea español (ej: películas en inglés sin doblaje,
    // donde solo se llenó este campo). Si el campo "language" indica un
    // idioma no-español y no hay otro track que lo represente, este es
    // en realidad el track "original" y no debe etiquetarse como Latino.
    const esIsActuallyOriginal =
      !rawEn && !rawMain && langParts.length > 0 && !langParts.some(isSpanish);

    tracks.push({
      id: rawEs,
      lang: esIsActuallyOriginal ? "en" : "es",
      label: esIsActuallyOriginal ? (originalLabels[0] || spanishLabel) : spanishLabel,
    });
  } else if (rawMain && mainIsSpanish) {
    tracks.push({ id: rawMain, lang: "es", label: spanishLabel });
  }

  // Tercer audio (Japonés): va al final → Original · Latino · Japonés
  if (rawJp) {
    tracks.push({ id: rawJp, lang: "jp", label: originalLabels[1] || "Japonés" });
  }

  return tracks;
}

// Google Drive IDs: empiezan con '1' y tienen >= 25 caracteres (igual que el player)
function isDriveId(id) {
  return typeof id === "string" && id.startsWith("1") && id.length >= 25 && /^[A-Za-z0-9_-]+$/.test(id);
}

// Misma regla de subtítulo que loadMovieInPlayer / loadSeriesInDetailPlayer
function resolveSub(data, lang) {
  let subId, subType;
  if (lang === "en" && data.subId_en) {
    subId = data.subId_en; subType = data.subType_en || "srt";
  } else if (lang === "jp" && data.subId_jp) {
    subId = data.subId_jp; subType = data.subType_jp || "srt";
  } else if (data.subId_es) {
    subId = data.subId_es; subType = data.subType_es || "srt";
  } else {
    return ContentManager.getSubtitleConfig(data);
  }
  return ContentManager.getSubtitleConfig({ subId, subType });
}

// Una "versión" = un video (idioma de audio) + su subtítulo
function buildVersions(data) {
  return getLangTracks(data || {}).map((t) => {
    const sub = resolveSub(data, t.lang);
    return {
      lang: t.lang,
      label: t.label,
      videoId: t.id,
      subId: sub.subId || "",
      subType: sub.subId ? sub.subType : "",
      downloadable: isDriveId(t.id),   // los videos de YouTube no se pueden bajar
    };
  });
}

// ───────────────────────────────────────────────────────────
// API pública
// ───────────────────────────────────────────────────────────
export function canUseDownloads() {
  if (!DL_ADMIN_ONLY) return true;
  const u = currentUser();
  return !!(u && PERMISSIONS.isAdmin(u.email));
}

export function openMovieDownload(id, data) {
  if (!data) return;
  openDialog({
    heading: data.title || "Película",
    subheading: data.year ? `Película · ${data.year}` : "Película",
    baseName: data.year ? `${data.title} (${data.year})` : String(data.title || "Película"),
    versions: buildVersions(data),
    activeLang: window._dvActiveLang,
  });
}

// seasons: { temporada: [episodios] }  ·  season/index (opcionales): episodio que se está viendo → se abre ahí
export function openEpisodeDownload({ seriesId, seriesData, seasons, seasonOrder, seasonPosters, season, index, activeLang }) {
  const serie = seriesData?.title || "Serie";
  const all = seasons || {};
  const keys = (seasonOrder?.length ? seasonOrder : Object.keys(all)).map(String)
    .filter((k, i, a) => a.indexOf(k) === i && Array.isArray(all[k]) && all[k].length);
  if (!keys.length) {
    openDialog({ heading: serie, subheading: "Serie", baseName: serie, versions: [],
      emptyText: "Esta serie todavía no tiene episodios disponibles." });
    return;
  }

  const word = String(seriesData?.nombreTemporadas || "").trim() || "Temporada";
  const labelOf = (k) => {
    const custom = String(seasonPosters?.[k]?.etiqueta || "").trim();
    return custom || (/^\d+$/.test(k) ? `${word} ${k}` : k);
  };
  const hasVideo = (ep) => getLangTracks(ep || {}).some((t) => t.id);
  const epName = (ep) => {            // título propio, o "" si es genérico ("Episodio 3")
    const t = String(ep?.title || "").trim();
    return /^episodio\s*\d+$/i.test(t) ? "" : t;
  };

  // Punto de partida: el episodio que se está viendo; si no hay, el primero con video
  const playKey = season !== undefined && season !== null ? String(season) : null;
  const playing = playKey && keys.includes(playKey) && all[playKey][index] ? { key: playKey, index: Number(index) } : null;
  const firstKey = keys.find((k) => all[k].some(hasVideo)) || keys[0];
  const start = playing || { key: firstKey, index: Math.max(0, all[firstKey].findIndex(hasVideo)) };

  openDialog({
    heading: serie,
    picker: {
      seasonWord: word,
      seasons: keys.map((k) => ({
        key: k,
        label: labelOf(k),
        episodes: all[k].map((ep) => ({
          name: epName(ep),
          hasVideo: hasVideo(ep),
          ids: getLangTracks(ep || {}).map((t) => t.id).filter(Boolean),
        })),
      })),
      start,
      spec(key, idx) {
        const ep = all[key][idx];
        const n = idx + 1;
        const sNum = /^\d+$/.test(key) ? `S${key.padStart(2, "0")}` : key;
        const tag = `${sNum}${/^S\d/.test(sNum) ? "" : " "}E${String(n).padStart(2, "0")}`;
        const t = String(ep?.title || "").trim();
        const named = t && !/^episodio\s*\d+$/i.test(t);
        return {
          subheading: `${labelOf(key)} · Episodio ${n}${named ? ` — ${t}` : ""}`,
          baseName: `${serie} - ${tag}${named ? ` - ${t}` : ""}`,
          versions: buildVersions(ep),
          // "viendo ahora" solo en el episodio que realmente se está reproduciendo
          activeLang: playing && key === playing.key && idx === playing.index ? (activeLang || window._spActiveLang) : undefined,
          emptyText: "Este episodio todavía no tiene video disponible.",
        };
      },
    },
  });
}

// ───────────────────────────────────────────────────────────
// Llamadas al Worker
// ───────────────────────────────────────────────────────────
function currentUser() {
  try { return window.firebase?.auth?.().currentUser || null; } catch { return null; }
}

async function api(path, { method = "GET", body } = {}) {
  const user = currentUser();
  if (!user) return { ok: false, status: 401, data: { error: "no_autenticado" } };
  let token;
  try { token = await user.getIdToken(); } catch { return { ok: false, status: 401, data: { error: "no_autenticado" } }; }
  try {
    const res = await fetch(`${WORKER_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* sin cuerpo JSON */ }
    return { ok: res.ok, status: res.status, data: data || {} };
  } catch {
    return { ok: false, status: 0, data: { error: "red" } };
  }
}

function humanError({ status, data }) {
  const e = data?.error;
  if (status === 0 || e === "red") return "Sin conexión con el servidor. Revisa tu internet e inténtalo otra vez.";
  if (status === 401 || e === "no_autenticado") return "Inicia sesión para descargar.";
  if (e === "cuota_diaria_preparacion") return `Llegaste al máximo de descargas nuevas de hoy (${data.max}). Mañana puedes pedir más.`;
  if (e === "cuota_diaria") return `Llegaste al máximo de descargas de hoy (${data.max}).`;
  if (e === "descargas_en_pausa") {
    const min = Math.max(1, Math.ceil((Number(data.retryAfter) || 1800) / 60));
    return `Las descargas están en pausa. Inténtalo de nuevo en unos ${min} min.`;
  }
  if (e === "demasiadas_descargas_simultaneas") return "Ya tienes descargas en curso. Espera a que terminen.";
  if (e === "no_esta_en_el_catalogo") return "Este título todavía no está disponible para descargar.";
  if (e === "subtitulo_no_encontrado") return "No se encontró el subtítulo de este título.";
  return "No se pudo iniciar la descarga. Inténtalo de nuevo más tarde.";
}

function workflowError(code) {
  if (code === "tiempo_agotado") return "La preparación tardó demasiado. Inténtalo otra vez.";
  if (code === "sin espacio en la cuenta de descargas") return "No hay espacio para prepararlo ahora. Inténtalo más tarde.";
  return "No se pudo preparar el archivo. Inténtalo otra vez en un rato.";
}

const fmtSize = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
const fmtClock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

// ───────────────────────────────────────────────────────────
// Estado en memoria: sobrevive a cerrar y reabrir la ventana
// ───────────────────────────────────────────────────────────
const jobs = new Map(); // "videoId|subId|lang" → { key, status, size }

// Historial de la cuenta: videoId → fecha (ms) de la última descarga. Lo guarda el servidor cuando
// de verdad empieza a entregar el archivo; aquí solo se lee, y se anota al instante al descargar.
const history = new Map();

async function loadHistory() {
  const r = await api("/dl-history");
  if (!r.ok || !r.data?.ids) return false;
  for (const [vid, t] of Object.entries(r.data.ids)) history.set(vid, Number(t) || 1);
  return true;
}

function fmtDay(t) {
  const d = new Date(t);
  const opts = d.getFullYear() === new Date().getFullYear() ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" };
  return d.toLocaleDateString("es-CL", opts).replace(".", "");
}

// ───────────────────────────────────────────────────────────
// Ventana
// ───────────────────────────────────────────────────────────
let dialog = null; // { root, rows, onKey }

function closeDialog() {
  if (!dialog) return;
  for (const row of dialog.rows) stopRow(row);
  document.removeEventListener("keydown", dialog.onKey);
  dialog.root.remove();
  dialog = null;
}

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const NOTE_TEXT =
  "MKV en calidad original con el subtítulo incrustado. La primera vez tarda unos minutos: " +
  "puedes cerrar esta ventana y volver. Para verlo usa VLC, mpv u otro reproductor compatible.";

function openDialog({ heading, subheading, baseName, versions, activeLang, emptyText, picker }) {
  closeDialog();
  injectStyles();

  const root = mk("div", "dlx-backdrop");
  const box = mk("div", "dlx-box");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "Descargar");

  const head = mk("div", "dlx-head");
  head.appendChild(mk("h2", "dlx-h", "Descargar"));
  const x = mk("button", "dlx-x", "×");
  x.type = "button";
  x.setAttribute("aria-label", "Cerrar");
  x.onclick = closeDialog;
  head.appendChild(x);
  box.appendChild(head);

  box.appendChild(mk("div", "dlx-title", heading));
  const subEl = mk("div", "dlx-sub", subheading || "");
  box.appendChild(subEl);

  const list = mk("div", "dlx-list");
  const note = mk("div", "dlx-note", NOTE_TEXT);
  const secEl = mk("div", "dlx-sec");          // qué episodio se va a descargar (solo series)

  const onKey = (e) => {
    if (e.key === "Escape") closeDialog();
  };
  dialog = { root, rows: [], onKey, markAll: () => {} };

  // Pinta las versiones (audio + subtítulo) de lo elegido; se llama al abrir y al cambiar de episodio
  const fill = (spec) => {
    for (const r of dialog.rows) stopRow(r);
    dialog.rows = [];
    list.textContent = "";
    if (spec.subheading !== undefined) (picker ? secEl : subEl).textContent = spec.subheading;
    const playable = spec.versions.filter((v) => v.videoId);
    if (!playable.length) list.appendChild(mk("div", "dlx-empty", spec.emptyText || "No hay video disponible para descargar."));
    for (const v of playable) {
      const row = buildRow(v, spec.baseName, v.lang === spec.activeLang);
      dialog.rows.push(row);
      list.appendChild(row.el);
    }
    note.style.display = dialog.rows.length ? "" : "none";
    for (const row of dialog.rows) resumeRow(row);   // si ya había algo en marcha, se retoma
  };

  if (picker) {
    box.classList.add("dlx-box--wide");
    subEl.style.display = "none";
    const bySeason = new Map(picker.seasons.map((s) => [s.key, s]));
    let curKey = picker.start.key;
    let curIdx = picker.start.index;

    // Temporadas: pestañas que se desplazan de lado (no se cortan los nombres largos)
    const tabs = mk("div", "dlx-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", picker.seasonWord);
    const tabEls = new Map();
    for (const s of picker.seasons) {
      const b = mk("button", "dlx-tab", s.label);
      b.type = "button";
      b.title = s.label;
      b.setAttribute("role", "tab");
      b.onclick = () => choose(s.key, 0);
      tabEls.set(s.key, b);
      tabs.appendChild(b);
    }
    if (picker.seasons.length <= 1) tabs.style.display = "none";

    // Episodios: lista con scroll, el elegido resaltado
    const eps = mk("div", "dlx-eps");
    eps.setAttribute("role", "listbox");
    eps.setAttribute("aria-label", "Episodio");
    let epEls = [];
    const renderEps = () => {
      eps.textContent = "";
      epEls = bySeason.get(curKey).episodes.map((e, i) => {
        const b = mk("button", "dlx-ep" + (e.hasVideo ? "" : " is-off"));
        b.type = "button";
        b.setAttribute("role", "option");
        b.appendChild(mk("span", "dlx-ep-n", String(i + 1)));
        b.appendChild(mk("span", "dlx-ep-t", e.name || `Episodio ${i + 1}`));
        if (!e.hasVideo) b.appendChild(mk("span", "dlx-ep-tag", "Próximamente"));
        const ok = mk("span", "dlx-ep-ok", "✔");
        ok.hidden = true;
        b.appendChild(ok);
        b.onclick = () => choose(curKey, i);
        eps.appendChild(b);
        return b;
      });
    };
    const mark = () => {
      for (const [k, b] of tabEls) { b.classList.toggle("is-on", k === curKey); b.setAttribute("aria-selected", String(k === curKey)); }
      epEls.forEach((b, i) => { b.classList.toggle("is-on", i === curIdx); b.setAttribute("aria-selected", String(i === curIdx)); });
      epEls[curIdx]?.scrollIntoView?.({ block: "nearest" });
      tabEls.get(curKey)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    };
    const choose = (key, idx) => {
      if (key !== curKey) { curKey = key; renderEps(); }
      curIdx = idx;
      mark();
      dialog.markAll();
      fill(picker.spec(curKey, curIdx));
    };
    // Flechas arriba/abajo dentro de la lista de episodios
    eps.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const n = Math.min(epEls.length - 1, Math.max(0, curIdx + (e.key === "ArrowDown" ? 1 : -1)));
      if (n !== curIdx) { choose(curKey, n); epEls[n].focus(); }
    });

    // ✔ en los episodios donde esta cuenta ya descargó alguna versión
    const markDone = () => {
      const season = bySeason.get(curKey);
      epEls.forEach((b, i) => {
        const downloaded = season.episodes[i].ids.some((id) => history.has(id));
        b.classList.toggle("is-done", downloaded);
        const ok = b.querySelector(".dlx-ep-ok");
        if (ok) ok.hidden = !downloaded;
        b.title = downloaded ? "Ya descargaste este episodio" : "";
      });
    };
    dialog.markAll = () => { markDone(); for (const r of dialog.rows) markRow(r); };

    box.append(tabs, eps, secEl, list, note);
    renderEps();
    mark();
    fill(picker.spec(curKey, curIdx));
    markDone();
  } else {
    dialog.markAll = () => { for (const r of dialog.rows) markRow(r); };
    box.append(list, note);
    fill({ baseName, versions, activeLang, emptyText });
  }

  root.appendChild(box);
  root.addEventListener("mousedown", (e) => { if (e.target === root) closeDialog(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(root);
  x.focus();

  // Historial de la cuenta (no bloquea la ventana): al llegar, se pintan los ✔
  const mine = dialog;
  loadHistory().then((okLoad) => { if (okLoad && dialog === mine) mine.markAll(); });
}

function buildRow(v, baseName, isActive) {
  const el = mk("div", "dlx-row");
  const top = mk("div", "dlx-row-top");
  const info = mk("div", "dlx-info");
  const name = mk("div", "dlx-lang", v.label + (isActive ? " · viendo ahora" : ""));
  const meta = mk("div", "dlx-meta",
    v.subId ? `Con subtítulos (${String(v.subType).toUpperCase()})` : "Sin subtítulos");
  const done = mk("span", "dlx-done");
  done.hidden = true;
  meta.appendChild(done);
  info.append(name, meta);

  const btn = mk("button", "dlx-btn", "Descargar");
  btn.type = "button";
  top.append(info, btn);

  const msg = mk("div", "dlx-msg");
  el.append(top, msg);

  const row = {
    v, el, btn, msg, done,
    name: `${baseName} [${v.label}]`,
    jobKey: `${v.videoId}|${v.subId}|${v.lang}`,
    key: null,
    state: { status: "idle" },
    timer: null, tick: null, waitSince: 0, alive: true,
  };

  if (!v.downloadable) {
    btn.disabled = true;
    msg.textContent = "Este video no se puede descargar.";
  } else {
    btn.onclick = () => onAction(row);
  }
  markRow(row);
  return row;
}

// ✔ en la versión que esta cuenta ya descargó
function markRow(row) {
  const t = history.get(row.v.videoId);
  row.done.hidden = !t;
  if (t) {
    row.done.textContent = ` · ✔ Descargado ${fmtDay(t)}`;
    row.done.title = "Ya descargaste esta versión";
  }
}

// ───────────────────────────────────────────────────────────
// Estado de cada fila
// ───────────────────────────────────────────────────────────
function stopRow(row) {
  row.alive = false;
  clearTimeout(row.timer);
  clearInterval(row.tick);
}

function setState(row, patch) {
  row.state = { ...row.state, ...patch };
  render(row);
}

function render(row) {
  const s = row.state;
  const LABELS = { idle: "Descargar", starting: "Un momento…", waiting: "Preparando…", ready: "Descargar", downloaded: "Descargar otra vez", error: "Reintentar" };
  row.btn.textContent = LABELS[s.status] || "Descargar";
  row.btn.disabled = s.status === "starting" || s.status === "waiting";
  row.btn.classList.toggle("dlx-btn--go", s.status === "ready");
  row.el.classList.toggle("dlx-row--wait", s.status === "waiting");

  let text = s.message || "";
  if (!text) {
    if (s.status === "ready") text = `Listo para descargar${s.size ? ` · ${fmtSize(s.size)}` : ""}`;
    if (s.status === "downloaded") text = "Descarga iniciada. Revisa tu carpeta de descargas.";
  }
  row.msg.textContent = text;
  row.msg.classList.toggle("dlx-msg--err", s.status === "error");

  clearInterval(row.tick);
  if (s.status === "waiting") {
    const paint = () => {
      row.msg.textContent = `Preparando el archivo… ${fmtClock(Date.now() - row.waitSince)}`;
    };
    paint();
    row.tick = setInterval(paint, 1000);
  }
}

function resumeRow(row) {
  const job = jobs.get(row.jobKey);
  if (!job || !row.v.downloadable) return;
  row.key = job.key;
  if (job.status === "ready") setState(row, { status: "ready", size: job.size });
  else if (job.status === "queued" || job.status === "running") startWaiting(row);
}

function startWaiting(row) {
  row.waitSince = row.waitSince || Date.now();
  setState(row, { status: "waiting", message: "" });
  schedulePoll(row);
}

// ───────────────────────────────────────────────────────────
// Acciones
// ───────────────────────────────────────────────────────────
function onAction(row) {
  const st = row.state.status;
  if (st === "ready" || st === "downloaded") return startDownload(row);
  if (st === "idle" || st === "error") return requestJob(row);
}

async function requestJob(row) {
  const v = row.v;
  row.waitSince = 0;
  setState(row, { status: "starting", message: "Enviando pedido…" });
  const r = await api("/dl-request", {
    method: "POST",
    body: { videoId: v.videoId, subId: v.subId, subType: v.subType, lang: v.lang, name: row.name },
  });
  if (!row.alive) return;
  if (!r.ok) return setState(row, { status: "error", message: humanError(r) });
  applyStatus(row, r.data, true);
}

// fresh = respuesta inmediata al pedido (ya estaba hecho): el clic del usuario sigue vigente,
// así que se puede iniciar la descarga sin pedir otro clic.
function applyStatus(row, d, fresh = false) {
  row.key = d.key || row.key;
  jobs.set(row.jobKey, { key: row.key, status: d.status, size: d.size });
  if (d.status === "ready") {
    setState(row, { status: "ready", size: d.size, message: "" });
    if (fresh) startDownload(row);
  } else if (d.status === "error") {
    jobs.delete(row.jobKey);
    setState(row, { status: "error", message: workflowError(d.error) });
  } else {
    startWaiting(row);
  }
}

function schedulePoll(row) {
  clearTimeout(row.timer);
  const elapsed = Date.now() - row.waitSince;
  if (elapsed > POLL_GIVE_UP_MS) {
    setState(row, { status: "error", message: "Sigue en preparación. Vuelve en unos minutos y pulsa Reintentar." });
    return;
  }
  row.timer = setTimeout(async () => {
    if (!row.alive) return;
    const r = await api(`/dl-status?key=${encodeURIComponent(row.key)}`);
    if (!row.alive) return;
    if (r.ok) return applyStatus(row, r.data);
    if (r.status === 404) {
      jobs.delete(row.jobKey);
      return setState(row, { status: "error", message: "Se perdió el rastro de este pedido. Pulsa Reintentar." });
    }
    schedulePoll(row); // fallo pasajero de red o servidor: seguir preguntando
  }, elapsed < POLL_SLOW_AFTER_MS ? POLL_FAST_MS : POLL_SLOW_MS);
}

async function startDownload(row) {
  setState(row, { status: "starting", message: "Preparando el enlace…" });
  const s = await api("/dl-sign", { method: "POST", body: { key: row.key } });
  if (!row.alive) return;
  if (!s.ok) {
    if (s.status === 404) return needsRebuild(row);
    return setState(row, { status: "error", message: humanError(s) });
  }

  // Comprobación ligera (1 byte) ANTES de navegar: si el servidor responde con un error,
  // se muestra aquí en vez de dejar la página en una pantalla de JSON.
  let chk = null;
  try { chk = await fetch(s.data.url, { headers: { Range: "bytes=0-0" } }); } catch { /* red */ }
  if (!row.alive) return;
  if (!chk || (chk.status !== 200 && chk.status !== 206)) {
    let data = {};
    try { data = (await chk?.json()) || {}; } catch { /* sin cuerpo */ }
    if (chk?.status === 404) return needsRebuild(row);
    return setState(row, { status: "error", message: humanError({ status: chk ? chk.status : 0, data }) });
  }
  try { await chk.body?.cancel(); } catch { /* ya cerrado */ }

  const a = document.createElement("a");
  a.href = s.data.url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  history.set(row.v.videoId, Date.now());
  dialog?.markAll?.();
  setState(row, { status: "downloaded", message: "" });
}

// El archivo ya no está en Drive (se liberó espacio): se vuelve a preparar al pulsar otra vez
function needsRebuild(row) {
  jobs.delete(row.jobKey);
  setState(row, { status: "idle", message: "Hay que prepararlo de nuevo. Pulsa Descargar." });
}

// ───────────────────────────────────────────────────────────
// Estilos (se inyectan una sola vez)
// ───────────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById("dlx-style")) return;
  const st = document.createElement("style");
  st.id = "dlx-style";
  st.textContent = `
.dlx-backdrop{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.72);backdrop-filter:blur(4px)}
.dlx-box{width:min(460px,100%);max-height:88vh;overflow:auto;box-sizing:border-box;padding:20px;border-radius:16px;background:#141414;color:#f2f2f2;border:1px solid rgba(255,255,255,.1);box-shadow:0 20px 60px rgba(0,0,0,.6);font-family:inherit}
.dlx-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.dlx-h{margin:0;font-size:1.05rem;font-weight:700;letter-spacing:.02em}
.dlx-x{width:32px;height:32px;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:#fff;font-size:1.3rem;line-height:1;cursor:pointer}
.dlx-x:hover{background:rgba(255,255,255,.16)}
.dlx-title{font-size:1.1rem;font-weight:700;line-height:1.3}
.dlx-sub{margin-top:2px;font-size:.85rem;color:#a8a8a8}
.dlx-box--wide{width:min(540px,100%)}
.dlx-tabs{display:flex;gap:8px;margin-top:14px;padding-bottom:4px;overflow-x:auto;scrollbar-width:thin;scroll-snap-type:x proximity}
.dlx-tab{flex:none;max-width:240px;padding:7px 14px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:transparent;color:#cfcfcf;font:inherit;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;scroll-snap-align:start}
.dlx-tab:hover{background:rgba(255,255,255,.08)}
.dlx-tab.is-on{background:var(--accent-color,#e50914);border-color:transparent;color:#fff;font-weight:600}
.dlx-eps{display:flex;flex-direction:column;gap:2px;margin-top:10px;max-height:min(232px,34vh);overflow-y:auto;padding:4px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);scrollbar-width:thin}
.dlx-ep{display:flex;align-items:center;gap:12px;width:100%;padding:9px 10px;border:0;border-radius:8px;background:transparent;color:#e6e6e6;font:inherit;font-size:.9rem;text-align:left;cursor:pointer}
.dlx-ep:hover{background:rgba(255,255,255,.07)}
.dlx-ep.is-on{background:rgba(255,255,255,.12);box-shadow:inset 3px 0 0 var(--accent-color,#e50914)}
.dlx-ep.is-off{opacity:.5}
.dlx-ep-n{flex:none;min-width:1.6em;text-align:right;color:#8d8d8d;font-variant-numeric:tabular-nums}
.dlx-ep-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dlx-ep-ok{flex:none;color:#46d369;font-weight:700;font-size:.95rem}
.dlx-ep-ok[hidden],.dlx-done[hidden]{display:none}
.dlx-ep.is-done .dlx-ep-t{color:#cfcfcf}
.dlx-done{color:#46d369}
.dlx-ep-tag{flex:none;font-size:.68rem;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.1);color:#bdbdbd}
.dlx-sec{margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08);font-size:.85rem;font-weight:600;color:#d8d8d8;line-height:1.35}
.dlx-list{display:flex;flex-direction:column;gap:10px;margin:12px 0}
.dlx-row{padding:12px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07)}
.dlx-row--wait{border-color:var(--accent-color,#e50914)}
.dlx-row-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dlx-lang{font-weight:600}
.dlx-meta{margin-top:2px;font-size:.8rem;color:#a8a8a8}
.dlx-btn{flex:none;padding:9px 18px;border:0;border-radius:999px;background:rgba(255,255,255,.16);color:#fff;font:inherit;font-weight:600;font-size:.9rem;cursor:pointer;white-space:nowrap}
.dlx-btn:hover:not(:disabled){background:rgba(255,255,255,.2)}
.dlx-btn:disabled{opacity:.55;cursor:default}
.dlx-btn--go{background:var(--accent-color,#e50914)}
.dlx-btn--go:hover:not(:disabled){background:var(--accent-color,#e50914);filter:brightness(1.12)}
.dlx-msg{margin-top:8px;font-size:.82rem;color:#c9c9c9;min-height:0}
.dlx-msg:empty{display:none}
.dlx-msg--err{color:#ff8a8a}
.dlx-empty{padding:14px;border-radius:12px;background:rgba(255,255,255,.05);color:#c9c9c9;font-size:.9rem}
.dlx-note{font-size:.78rem;line-height:1.45;color:#8d8d8d}
`;
  document.head.appendChild(st);
}

export default { canUseDownloads, openMovieDownload, openEpisodeDownload };