/* ── "IDEAL PARA HOY" — RECOMENDACIONES SEGÚN EL CLIMA ─────────
   Lee el clima que publica weather.js (window.ccWeather / evento
   "cc:weather"), decide un "ánimo" (tormenta, lluvia, calor, noche…) y
   arma una fila con películas y series cuyos géneros encajan.
   Se muestra dentro del panel del clima (contenedor .wx-picks-slot que
   crea weather.js), no en el inicio.
   Es independiente de script.js: solo usa window.appState,
   window.getMovieLock, window.getSeriesLock y window.openDetailsModal.
   ─────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  const MAX_ITEMS = 11;
  const MIN_ITEMS = 4; // con menos coincidencias no se muestra la fila
  const SERIES_SHARE = 0.4; // ~4 de 11 son series (si hay suficientes que encajen)
  const RECENT_DAYS = 4; // lo mostrado en los últimos días pesa menos
  const RECENT_PENALTY = 0.2; // multiplicador de peso para lo mostrado hace poco
  const SHOWN_KEY = "cc_wxp_shown";

  const norm = (s) =>
    String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  // Grupos de géneros: se comparan por "raíz" contra el texto de géneros del
  // catálogo (sin tildes ni mayúsculas). Si en tu hoja usas otros nombres,
  // agrégalos aquí.
  const GROUPS = {
    terror: ["terror", "horror", "miedo", "slasher", "sobrenatural", "paranormal"],
    suspenso: ["suspens", "thriller", "misterio", "intriga"],
    crimen: ["crimen", "polici", "noir", "detective"],
    drama: ["drama"],
    romance: ["romanc", "romant"],
    comedia: ["comedia", "humor", "parodi"],
    accion: ["accion", "action", "artes marcial"], // "marcial" cubre "Marciales" y "Marcialas"
    aventura: ["aventura"],
    animacion: ["animacion", "anime", "animad"],
    fantasia: ["fantasi", "magia"],
    scifi: ["ciencia ficc", "ciencia-ficc", "cyberpunk", "futurista"], // "ficc" cubre "Ficción" y "Ficcón"
    familiar: ["familia", "infantil"],
    guerra: ["guerra", "belico"],
    historia: ["historia", "historic"],
    musical: ["musical"],
    deportes: ["deporte"],
    western: ["western", "oeste"],
    superheroes: ["superheroe"],
  };

  // El primer género de cada ánimo pesa más que el último.
  const MOODS = {
    storm: { icon: "fa-cloud-bolt", say: "Tormenta", genres: ["terror", "suspenso", "crimen"] },
    stormSoon: { icon: "fa-cloud-bolt", say: "Tormenta en camino", genres: ["terror", "suspenso", "crimen"] },
    rainSoon: { icon: "fa-umbrella", say: "Se viene la lluvia", genres: ["drama", "romance", "suspenso", "crimen", "musical"] },
    wind: { icon: "fa-wind", say: "Día ventoso", genres: ["aventura", "fantasia", "suspenso", "accion", "western"] },
    dusk: { icon: "fa-cloud-sun", say: "Atardecer", genres: ["romance", "drama", "aventura", "fantasia", "musical"] },
    rain: { icon: "fa-cloud-showers-heavy", say: "Día de lluvia", genres: ["drama", "romance", "suspenso", "crimen", "musical"] },
    snow: { icon: "fa-snowflake", say: "Día de nieve", genres: ["fantasia", "animacion", "familiar", "romance", "aventura", "musical"] },
    fog: { icon: "fa-smog", say: "Día de niebla", genres: ["suspenso", "terror", "crimen"] },
    hot: { icon: "fa-sun", say: "Día de calor", genres: ["comedia", "aventura", "accion", "animacion", "superheroes", "deportes"] },
    cold: { icon: "fa-mug-hot", say: "Día frío", genres: ["drama", "romance", "fantasia", "animacion", "musical", "historia"] },
    night: { icon: "fa-moon", say: "Noche tranquila", genres: ["scifi", "suspenso", "terror", "crimen"] },
    sun: { icon: "fa-sun", say: "Día despejado", genres: ["aventura", "accion", "comedia", "scifi", "deportes", "western"] },
    cloud: { icon: "fa-cloud", say: "Día nublado", genres: ["suspenso", "drama", "scifi", "crimen", "historia", "guerra"] },
  };

  // Código WMO + pronóstico de las próximas horas + hora + temperatura → ánimo
  const n = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
  function moodFor(w) {
    const c = w.code;
    if (c >= 95) return "storm";
    if (w.stormSoon) return "stormSoon";
    if ((c >= 71 && c <= 77) || c === 85 || c === 86 || n(w.snowfall) > 0) return "snow";
    if (c === 45 || c === 48 || (typeof w.visibilityKm === "number" && w.visibilityKm < 1.5)) return "fog";
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || w.rainingNow) return "rain";
    if (w.rainSoon) return "rainSoon";
    if (n(w.gust) >= 55) return "wind";
    if (w.temp >= 28) return "hot";
    if (w.temp <= 8) return "cold";
    // Hora dorada: la hora antes del atardecer y los 45 min después
    if (w.isDay && w.minsToSunset != null && w.minsToSunset <= 60) return "dusk";
    if (!w.isDay && w.minsSinceSunset != null && w.minsSinceSunset <= 45) return "dusk";
    if (!w.isDay) return "night";
    if (c === 0 || c === 1) return "sun";
    return "cloud";
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function score(item, mood) {
    const g = norm(item.genres || item.generos || "");
    if (!g) return 0;
    let s = 0;
    mood.genres.forEach((key, i) => {
      if (GROUPS[key].some((stem) => g.includes(stem))) s += mood.genres.length - i;
    });
    return s;
  }

  function isPlayable(id, item, type) {
    if (!item) return false;
    const est = norm(item.estado).trim();
    if (est === "vetada" || est === "mantenimiento") return false;
    const adm = String(item.admin || "").toLowerCase().trim();
    if (adm === "si" || adm === "yes" || adm === "true") return false; // contenido de admin
    try {
      const lock = type === "series" ? window.getSeriesLock?.(id, item) : window.getMovieLock?.(id, item);
      if (lock) return false; // "Próximamente"
    } catch (_) {}
    return true;
  }

  /* ── Rotación: recuerda qué se mostró en los últimos días ──
     Así mañana no repite lo de hoy aunque el clima sea el mismo. */
  const pad = (v) => String(v).padStart(2, "0");
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function loadShown() {
    try { return JSON.parse(localStorage.getItem(SHOWN_KEY) || "{}") || {}; } catch (_) { return {}; }
  }
  function saveShown(day, ids) {
    try {
      const all = loadShown();
      all[day] = ids;
      const keep = Object.keys(all).sort().slice(-(RECENT_DAYS + 1));
      const out = {};
      keep.forEach((k) => { out[k] = all[k]; });
      localStorage.setItem(SHOWN_KEY, JSON.stringify(out));
    } catch (_) {}
  }
  function recentlyShown(day) {
    const set = new Set();
    const all = loadShown();
    Object.keys(all).forEach((k) => {
      if (k !== day && Array.isArray(all[k])) all[k].forEach((id) => set.add(id));
    });
    return set;
  }

  // Sorteo ponderado (Efraimidis–Spirakis): más afinidad = más probabilidad,
  // pero cualquiera con afinidad puede salir. La semilla cambia cada día.
  function rankWeighted(list, day, recent) {
    return list
      .map((x) => {
        const u = (hash(`${day}:${x.type}:${x.id}`) + 1) / 4294967297; // (0,1)
        const w = x.s * (recent.has(x.id) ? RECENT_PENALTY : 1);
        return { ...x, k: Math.pow(u, 1 / w) };
      })
      .sort((a, b) => b.k - a.k);
  }

  // Devuelve [{id, item, type}]: mezcla de películas y series con afinidad al
  // ánimo, distinta cada día, sin lo ya visto y sin repetir lo de los últimos días.
  function pickItems(mood, movies, series) {
    const day = todayKey();
    const recent = recentlyShown(day);
    const all = [
      ...Object.entries(movies || {}).map(([id, item]) => ({ id, item, type: "movie" })),
      ...Object.entries(series || {}).map(([id, item]) => ({ id, item, type: "series" })),
    ];
    const pool = all
      .filter((x) => isPlayable(x.id, x.item, x.type))
      .filter((x) => !(x.type === "movie" && watchedMovies.has(x.id))) // película ya vista
      .filter((x) => !(x.type === "series" && (completedSeries.has(x.id) || startedSeries.has(x.id)))) // serie terminada o ya empezada
      .map((x) => ({ ...x, s: score(x.item, mood) }))
      .filter((x) => x.s > 0);

    const rankedSeries = rankWeighted(pool.filter((x) => x.type === "series"), day, recent);
    const rankedMovies = rankWeighted(pool.filter((x) => x.type === "movie"), day, recent);

    // Cupo: ~40% series, ~60% películas; si falta de un lado, se completa con el otro
    const wantSeries = Math.min(rankedSeries.length, Math.round(MAX_ITEMS * SERIES_SHARE));
    const wantMovies = Math.min(rankedMovies.length, MAX_ITEMS - wantSeries);
    const extraSeries = Math.min(rankedSeries.length - wantSeries, MAX_ITEMS - wantSeries - wantMovies);

    return [
      ...rankedSeries.slice(0, wantSeries + Math.max(0, extraSeries)),
      ...rankedMovies.slice(0, wantMovies),
    ]
      .sort((a, b) => b.k - a.k) // películas y series intercaladas al azar
      .slice(0, MAX_ITEMS);
  }

  /* ── Películas ya vistas ──────────────────────────────────
     Misma regla que usa el perfil ("Películas vistas"):
     · está en users/{uid}/roulette_watched (al 85% o marcada a mano), o
     · su entrada en el historial es de película y está terminada.
     Series: se ocultan las terminadas (users/{uid}/series_completed).
     Los invitados no tienen historial, así que no se filtra nada. */
  let watchedMovies = new Set();
  let completedSeries = new Set();
  let startedSeries = new Set(); // series con algún capítulo en el historial (ya en "Continuar viendo")
  let watchedVer = 0;
  let wReady = true; // false mientras un usuario logueado aún no carga su info
  let wRoulette = new Set();
  let wHistory = new Set();
  let wStarted = new Set();
  let wDetach = null;

  function recomputeWatched() {
    watchedMovies = new Set([...wRoulette, ...wHistory]);
    startedSeries = new Set(wStarted);
    watchedVer++;
    schedule();
  }

  function watchUser(user) {
    if (wDetach) { wDetach(); wDetach = null; }
    wRoulette = new Set(); wHistory = new Set(); wStarted = new Set(); completedSeries = new Set();
    if (!user || !window.firebase) { wReady = true; recomputeWatched(); return; }

    wReady = false;
    const base = window.firebase.database().ref(`users/${user.uid}`);
    const rRef = base.child("roulette_watched");
    const hRef = base.child("history");
    const sRef = base.child("series_completed");
    let gotR = false, gotH = false, gotS = false;
    const done = () => { if (gotR && gotH && gotS) wReady = true; };

    const onR = (snap) => {
      const v = snap.val() || {};
      wRoulette = new Set(Object.keys(v).filter((k) => v[k] !== false));
      gotR = true; done(); recomputeWatched();
    };
    const onH = (snap) => {
      const v = snap.val() || {};
      wHistory = new Set(Object.keys(v).filter((k) => {
        const h = v[k];
        if (!h || h.type !== "movie") return false;
        const pr = h.progress;
        return typeof pr !== "number" || pr === 0 || pr >= 0.85;
      }));
      wStarted = new Set(Object.keys(v)
        .filter((k) => v[k] && v[k].type === "series")
        .map((k) => String(v[k].contentId || k)));
      gotH = true; done(); recomputeWatched();
    };
    const onS = (snap) => {
      completedSeries = new Set(Object.keys(snap.val() || {}));
      gotS = true; done(); recomputeWatched();
    };
    sRef.on("value", onS, () => { gotS = true; done(); recomputeWatched(); });
    rRef.on("value", onR, () => { gotR = true; done(); recomputeWatched(); });
    hRef.on("value", onH, () => { gotH = true; done(); recomputeWatched(); });
    // Si Firebase tarda o falla, no dejamos la fila sin mostrarse
    const t = setTimeout(() => { wReady = true; schedule(); }, 4000);
    wDetach = () => { clearTimeout(t); rRef.off("value", onR); hRef.off("value", onH); sRef.off("value", onS); };
  }

  function initWatched() {
    let tries = 0;
    const iv = setInterval(() => {
      if (window.firebase && window.firebase.apps && window.firebase.apps.length) {
        clearInterval(iv);
        window.firebase.auth().onAuthStateChanged(watchUser);
      } else if (++tries > 120) clearInterval(iv);
    }, 250);
  }

  /* ── Render: dentro del panel del clima (.wx-picks-slot) ── */
  let lastKey = "";
  let raf = 0;

  function injectStyles() {
    if (document.getElementById("wxp-styles")) return;
    const st = document.createElement("style");
    st.id = "wxp-styles";
    st.textContent = `
.wxp-t{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:0 2px 6px;
  font-size:.62rem;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted,#64748b)}
.wxp-t em{font-style:normal;letter-spacing:0;text-transform:none;white-space:nowrap}
.wxp-t em i{color:var(--accent-color);margin-right:4px}
.wxp-row{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px;scrollbar-width:thin;overscroll-behavior:contain}
.wxp-card{position:relative;flex:0 0 66px;aspect-ratio:2/3;border-radius:8px;overflow:hidden;cursor:pointer;
  background:#1a1c24 center/cover no-repeat;border:1px solid rgba(255,255,255,.08);transition:transform .15s,border-color .15s}
.wxp-card:hover,.wxp-card:focus-visible{transform:translateY(-2px) scale(1.04);border-color:rgba(var(--accent-rgb),.7);outline:none}
@media (min-width:768px) and (max-height:820px){.wxp-card{flex-basis:56px}}
@media (max-width:767px){.wxp-card{flex-basis:78px}.wxp-row{gap:10px}}
.wxp-card span{position:absolute;left:0;right:0;bottom:0;padding:10px 3px 3px;text-align:center;font-size:.5rem;font-weight:800;
  letter-spacing:.4px;text-transform:uppercase;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.85))}
`;
    document.head.appendChild(st);
  }

  function clearSlot() {
    const slot = document.querySelector(".wx-picks-slot");
    if (slot) slot.innerHTML = "";
    lastKey = "";
  }

  function render() {
    raf = 0;
    const w = window.ccWeather;
    const app = window.appState;
    const slot = document.querySelector(".wx-picks-slot");
    if (!w || !app || !app.content || !slot) return;
    if (!wReady) return; // espera a saber qué ya vio el usuario

    const movies = app.content.movies || {};
    const series = app.content.series || {};
    if (!Object.keys(movies).length && !Object.keys(series).length) return; // catálogo aún cargando

    const moodKey = moodFor(w);
    const mood = MOODS[moodKey];
    const key = [watchedVer, todayKey(), moodKey, Object.keys(movies).length, Object.keys(series).length].join("|");
    if (lastKey === key && slot.childElementCount) return;

    const items = pickItems(mood, movies, series);
    if (items.length < MIN_ITEMS) { clearSlot(); return; }

    injectStyles();
    lastKey = key;
    saveShown(todayKey(), items.map((x) => x.id));
    slot.innerHTML = "";

    const head = document.createElement("div");
    head.className = "wxp-t";
    head.innerHTML = `<span>Ideal para hoy</span><em><i class="fas ${mood.icon}"></i><span class="wxp-say"></span></em>`;
    head.querySelector(".wxp-say").textContent = mood.say;

    const row = document.createElement("div");
    row.className = "wxp-row";
    // Con la rueda del mouse se desplaza de lado (si hay más posters de los que caben)
    row.addEventListener("wheel", (e) => {
      if (row.scrollWidth <= row.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      row.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });

    items.forEach(({ id, item, type }) => {
      const card = document.createElement("div");
      card.className = "wxp-card";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      const img = String(item.poster || item.banner || "").replace(/'/g, "%27");
      card.style.backgroundImage = `url('${img}')`;
      const label = (item.title || "") + (item.year ? ` (${item.year})` : "");
      card.title = label;
      card.setAttribute("aria-label", label);
      const tag = document.createElement("span");
      tag.textContent = type === "series" ? "Serie" : "Película";
      card.appendChild(tag);
      const open = () => {
        window.ccWeatherClose?.();
        window.openDetailsModal?.(id, type);
      };
      card.onclick = open;
      card.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
      row.appendChild(card);
    });

    slot.appendChild(head);
    slot.appendChild(row);
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(render);
  }

  function init() {
    initWatched();
    window.addEventListener("cc:weather", schedule);
    window.addEventListener("cc:weather-open", schedule);
    // El catálogo puede tardar en cargar: reintenta hasta que la fila se pueda dibujar
    let tries = 0;
    const iv = setInterval(() => {
      schedule();
      if (lastKey || ++tries > 180) clearInterval(iv);
    }, 1000);
  }

  // Expuesto solo para pruebas
  window.ccWeatherPicks = { moodFor, pickItems, MOODS };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();