/* ── RELOJ + CLIMA EN EL HEADER ───────────────────────────────
   Datos: Open-Meteo (gratis, sin API key, con CORS).
   - Muestra hora + icono + temperatura en el header (escritorio).
   - Click → panel con detalle, próximas horas y pronóstico de 3 días.
   - Responsive: en móvil (≤767px) el botón se mueve a la barra superior y el
     panel baja a todo lo ancho; en laptops con zoom 125 % se compacta.
   - Datos extra de la misma consulta: probabilidad de lluvia, UV, ráfagas,
     dirección del viento, presión, visibilidad, nieve, energía de tormenta
     (CAPE), amanecer/atardecer y pronóstico hora a hora. Todo se publica
     en window.ccWeather para que lo use weather-picks.js.
   - "Ideal para hoy": weather-picks.js dibuja ahí (.wx-picks-slot) las
     películas y series que encajan con el clima.
   - Ciudad por defecto: Santiago. Se cambia escribiendo (con
     sugerencias) o con "Usar mi ubicación".
   - PERSISTENCIA:
       · Invitado  → localStorage (solo ese navegador).
       · Con sesión → Firebase: users/{uid}/weatherPlace, así la ciudad
         te sigue en cualquier dispositivo. También se copia a
         localStorage como respaldo si Firebase falla.
   ─────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  const LS_PREFIX = "cc_weather_place_";
  const DEFAULT_PLACE = { name: "Santiago", lat: -33.4489, lon: -70.6693 };
  const REFRESH_MS = 15 * 60 * 1000; // actualizar clima cada 15 min

  let uid = null; // null = invitado
  let place = loadLocal();
  let data = null;
  let tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let els = {};

  /* ── Persistencia ─────────────────────────────────────── */
  const lsKey = () => LS_PREFIX + (uid || "guest");

  function validPlace(p) {
    return (
      p && typeof p.name === "string" && p.name.length < 120 &&
      isFinite(p.lat) && Math.abs(p.lat) <= 90 &&
      isFinite(p.lon) && Math.abs(p.lon) <= 180
    );
  }
  function loadLocal(key) {
    try {
      const p = JSON.parse(localStorage.getItem(key || LS_PREFIX + "guest"));
      if (validPlace(p)) return { name: p.name, lat: +p.lat, lon: +p.lon };
    } catch (_) {}
    return { ...DEFAULT_PLACE };
  }
  function cloudRef() {
    try {
      if (uid && window.firebase && firebase.apps && firebase.apps.length) {
        return firebase.database().ref(`users/${uid}/weatherPlace`);
      }
    } catch (_) {}
    return null;
  }
  function savePlace() {
    try { localStorage.setItem(lsKey(), JSON.stringify(place)); } catch (_) {}
    const ref = cloudRef();
    if (ref) {
      ref.set({ name: place.name, lat: place.lat, lon: place.lon, updatedAt: Date.now() })
        .catch((e) => console.warn("[Clima] No se pudo guardar la ciudad en Firebase (¿reglas?):", e && e.message));
    }
  }

  // Cuando cambia la sesión: cargar la ciudad guardada en la cuenta
  async function onUserChanged(user) {
    const newUid = user ? user.uid : null;
    if (newUid === uid) return;
    uid = newUid;

    if (!uid) { // cerró sesión → vuelve a la ciudad de invitado
      place = loadLocal();
      if (els.wrap) fetchWeather();
      return;
    }

    const ref = cloudRef();
    let cloud = null;
    if (ref) {
      try {
        const snap = await ref.once("value");
        const v = snap.val();
        if (validPlace(v)) cloud = { name: v.name, lat: +v.lat, lon: +v.lon };
      } catch (e) {
        console.warn("[Clima] No se pudo leer la ciudad de Firebase:", e && e.message);
      }
    }

    if (cloud) {
      place = cloud; // la cuenta manda
      try { localStorage.setItem(lsKey(), JSON.stringify(place)); } catch (_) {}
    } else {
      // Primera vez con cuenta: sube la ciudad que ya tenía (respaldo local o la de invitado)
      const mine = loadLocal(LS_PREFIX + uid);
      const guest = loadLocal(LS_PREFIX + "guest");
      const isDefault = (p) => p.lat === DEFAULT_PLACE.lat && p.lon === DEFAULT_PLACE.lon;
      place = !isDefault(mine) ? mine : guest;
      savePlace();
    }
    if (els.wrap) fetchWeather();
  }

  // Espera a que Firebase esté inicializado por script.js y escucha la sesión
  function watchAuth() {
    let tries = 0;
    const iv = setInterval(() => {
      try {
        if (window.firebase && firebase.apps && firebase.apps.length) {
          clearInterval(iv);
          firebase.auth().onAuthStateChanged(onUserChanged);
        } else if (++tries > 60) clearInterval(iv); // ~15 s
      } catch (_) { clearInterval(iv); }
    }, 250);
  }

  /* ── Códigos WMO → icono + texto ──────────────────────── */
  function wmo(code, isDay) {
    const d = isDay ? 0 : 1;
    const t = (day, night, txt) => ({ icon: [day, night][d], txt });
    if (code === 0) return t("fa-sun", "fa-moon", "Despejado");
    if (code === 1) return t("fa-sun", "fa-moon", "Mayormente despejado");
    if (code === 2) return t("fa-cloud-sun", "fa-cloud-moon", "Parcialmente nublado");
    if (code === 3) return t("fa-cloud", "fa-cloud", "Nublado");
    if (code === 45 || code === 48) return t("fa-smog", "fa-smog", "Niebla");
    if (code >= 51 && code <= 57) return t("fa-cloud-rain", "fa-cloud-rain", "Llovizna");
    if (code >= 61 && code <= 67) return t("fa-cloud-showers-heavy", "fa-cloud-showers-heavy", "Lluvia");
    if (code >= 71 && code <= 77) return t("fa-snowflake", "fa-snowflake", "Nieve");
    if (code >= 80 && code <= 82) return t("fa-cloud-showers-heavy", "fa-cloud-showers-heavy", "Chubascos");
    if (code === 85 || code === 86) return t("fa-snowflake", "fa-snowflake", "Chubascos de nieve");
    if (code >= 95) return t("fa-cloud-bolt", "fa-cloud-bolt", "Tormenta");
    return t("fa-cloud", "fa-cloud", "—");
  }

  /* ── Estilos ──────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById("wx-styles")) return;
    const st = document.createElement("style");
    st.id = "wx-styles";
    st.textContent = `
.wx-wrap{position:relative;flex-shrink:0}
.wx-btn{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 14px;border-radius:50px;cursor:pointer;
  border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.05);color:var(--text-light,#f8fafc);
  font:700 .74rem/1 inherit;letter-spacing:.5px;white-space:nowrap;transition:background .2s,border-color .2s}
.wx-btn:hover,.wx-btn.open{background:rgba(var(--accent-rgb),.15);border-color:rgba(var(--accent-rgb),.5)}
.wx-btn i{color:var(--accent-color);font-size:14px}
.wx-time{font-variant-numeric:tabular-nums}
.wx-sep{width:1px;height:14px;background:rgba(255,255,255,.15)}
.wx-pop{position:absolute;top:calc(100% + 12px);right:0;width:330px;z-index:1100;display:none;
  background:rgba(12,14,20,.96);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:16px;
  box-shadow:0 20px 50px rgba(0,0,0,.55);color:var(--text-light,#f8fafc)}
.wx-pop.open{display:block}
.wx-grip,.wx-backdrop{display:none}
.wx-pop{max-height:calc(100vh - 100px);overflow-y:auto;scrollbar-width:thin}
.wx-toggle{width:100%;height:28px;margin:0 0 12px;display:flex;align-items:center;justify-content:center;gap:6px;
  cursor:pointer;border:1px dashed rgba(255,255,255,.16);background:transparent;color:var(--text-muted,#64748b);
  border-radius:50px;font-size:.7rem;transition:color .2s,border-color .2s,background .2s}
.wx-toggle:hover{color:var(--text-light,#f8fafc);border-color:rgba(var(--accent-rgb),.5);background:rgba(var(--accent-rgb),.08)}
.wx-toggle i{font-size:.62rem;color:var(--accent-color)}
.wx-picks-slot{margin:0 0 12px}
.wx-picks-slot:empty{display:none}
.wx-more{display:none}
.wx-pop.expanded{width:min(680px,calc(100vw - 48px))}
.wx-pop.expanded .wx-grid{display:grid;grid-template-columns:1fr 1fr;align-items:start}
.wx-pop.expanded .wx-left{padding-right:18px;min-width:0}
.wx-pop.expanded .wx-more{padding-left:18px;border-left:1px solid rgba(255,255,255,.08);min-width:0}
.wx-pop.expanded .wx-more{display:block}
.wx-alert{display:none;margin:0 0 12px;padding:8px 10px;border-radius:10px;font-size:.7rem;line-height:1.35;
  background:rgba(var(--accent-rgb),.14);border:1px solid rgba(var(--accent-rgb),.3)}
.wx-alert.show{display:block}
.wx-hours{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-bottom:12px}
.wx-hr{text-align:center;font-size:.62rem;padding:6px 2px;border-radius:10px;background:rgba(255,255,255,.04);color:var(--text-muted,#64748b)}
.wx-hr i{display:block;margin:4px 0;color:var(--accent-color);font-size:13px}
.wx-hr b{display:block;font-size:.72rem;color:var(--text-light,#f8fafc)}
.wx-chart{margin-bottom:12px;position:relative}
.wx-chart-t{font-size:.62rem;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted,#64748b);margin:0 2px 4px;display:flex;justify-content:space-between}
.wx-chart-t i{font-style:normal;text-transform:none;letter-spacing:0}
.wx-chart-svg{display:block;width:100%;height:auto;border-radius:10px;background:rgba(255,255,255,.03)}
.wx-chart-svg .nt{fill:rgba(255,255,255,.04)}
.wx-chart-svg .bar{fill:#7dd3fc;opacity:.45}
.wx-chart-svg .ar{fill:var(--accent-color);opacity:.14}
.wx-chart-svg .ln{fill:none;stroke:var(--accent-color);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.wx-chart-svg .dot{fill:var(--accent-color)}
.wx-chart-svg .tx{fill:var(--text-muted,#64748b);font-size:8.5px;font-family:inherit}
.wx-chart-svg .tv{fill:var(--text-light,#f8fafc);font-size:9px;font-weight:700;font-family:inherit}
.wx-chart-svg{touch-action:pan-y;cursor:crosshair;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.wx-chart-svg.zoomed{cursor:grab}
.wx-chart-svg:focus-visible{outline:2px solid var(--accent-color);outline-offset:1px}
.wx-chart-svg *{pointer-events:none}
.wx-chart-svg .gl{stroke:rgba(255,255,255,.06);stroke-width:.6}
.wx-chart-svg .cur{stroke:rgba(255,255,255,.55);stroke-width:.8;stroke-dasharray:2 2}
.wx-chart-svg .cd{fill:var(--accent-color);stroke:#fff;stroke-width:1}
.wx-chart-svg .tb{fill:rgba(12,14,20,.94);stroke:rgba(255,255,255,.18);stroke-width:.6}
.wx-zoomc{position:absolute;top:22px;right:5px;display:flex;gap:4px;z-index:1}
.wx-zoomc button{width:20px;height:20px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:50%;cursor:pointer;
  border:1px solid rgba(255,255,255,.14);background:rgba(12,14,20,.72);color:var(--text-muted,#94a3b8);font-size:8px;transition:color .15s,border-color .15s}
.wx-zoomc button:hover:not(:disabled){color:var(--text-light,#f8fafc);border-color:rgba(var(--accent-rgb),.6)}
.wx-zoomc button:disabled{opacity:.35;cursor:default}
.wx-zoomc button[hidden]{display:none}
@media (max-width:767px){.wx-zoomc button{width:28px;height:28px;font-size:10px}.wx-zoomc{top:20px}}
.wx-hr small{display:block;font-size:.58rem;min-height:1em;color:#7dd3fc}
.wx-city{font-size:.7rem;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted,#64748b)}
.wx-main{display:flex;align-items:center;gap:14px;margin:10px 0 12px}
.wx-main>i{font-size:34px;color:var(--accent-color)}
.wx-temp{font-size:2rem;font-weight:800;line-height:1}
.wx-desc{font-size:.8rem;color:var(--text-muted,#64748b);margin-top:4px}
.wx-clock{margin-left:auto;text-align:right;font-size:.72rem;color:var(--text-muted,#64748b);text-transform:capitalize}
.wx-clock b{display:block;font-size:1.05rem;color:var(--text-light,#f8fafc);font-variant-numeric:tabular-nums}
.wx-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
.wx-stat{background:rgba(255,255,255,.05);border-radius:10px;padding:8px;text-align:center;font-size:.68rem;color:var(--text-muted,#64748b)}
.wx-stat b{display:block;white-space:nowrap;font-size:.85rem;color:var(--text-light,#f8fafc);margin-top:2px}
.wx-days{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
.wx-day{text-align:center;font-size:.7rem;padding:8px 4px;border-radius:10px;border:1px solid rgba(255,255,255,.07)}
.wx-day i{display:block;margin:6px 0;color:var(--accent-color);font-size:16px}
.wx-day span{color:var(--text-muted,#64748b)}
.wx-search{display:flex;gap:6px}
.wx-search input{flex:1;min-width:0;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
  border-radius:50px;padding:8px 12px;color:inherit;font-size:.75rem;outline:none}
.wx-search input:focus{border-color:var(--accent-color)}
.wx-search button{cursor:pointer;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.06);
  color:inherit;border-radius:50px;padding:0 12px;font-size:.72rem;transition:background .2s}
.wx-search button:hover{background:rgba(var(--accent-rgb),.2)}
.wx-sugg{display:none;margin-top:6px;border:1px solid rgba(255,255,255,.1);border-radius:12px;overflow:hidden;background:rgba(255,255,255,.04)}
.wx-sugg.open{display:block}
.wx-opt{display:flex;flex-direction:column;gap:2px;padding:8px 12px;cursor:pointer;font-size:.75rem;border-bottom:1px solid rgba(255,255,255,.05)}
.wx-opt:last-child{border-bottom:0}
.wx-opt small{color:var(--text-muted,#64748b);font-size:.66rem}
.wx-opt:hover,.wx-opt.active{background:rgba(var(--accent-rgb),.2)}
.wx-credit{margin-top:6px;font-size:.62rem;text-align:right}
.wx-credit a{color:var(--text-muted,#64748b);text-decoration:none}
.wx-credit a:hover{color:var(--accent-color)}
.wx-msg{font-size:.7rem;color:var(--text-muted,#64748b);margin-top:8px;min-height:1em}

/* ── Adaptación ─────────────────────────────────────────────
   · ≥1251px ........ botón completo (hora + icono + temperatura).
   · 1101–1250px .... botón compacto (icono + temperatura) y nav un poco más apretado
                      para que el buscador no se quede sin espacio (laptops con zoom 125 %).
   · 768–1100px ..... oculto: no hay espacio en el nav (tablet vertical).
   · ≤767px ......... vive en la barra superior móvil; el panel baja a todo lo ancho. */
@media (min-width:768px) and (max-width:1250px){
  .wx-time,.wx-sep{display:none}
  .wx-btn{padding:0 12px}
  .nav-pill a{padding:7px 10px;letter-spacing:.5px}
}
@media (min-width:768px) and (max-width:1100px){.wx-wrap{display:none}}

/* Pantallas bajas (laptop con zoom 125 %): menos aire vertical para que casi no haga falta scroll */
@media (min-width:768px) and (max-height:820px){
  .wx-pop{padding:12px 14px;max-height:calc(100vh - 84px)}
  .wx-main{margin:6px 0 8px}
  .wx-stats{gap:6px;margin-bottom:8px}
  .wx-stat{padding:5px}
  .wx-toggle{height:26px;margin-bottom:8px}
  .wx-alert,.wx-hours,.wx-chart,.wx-days,.wx-picks-slot{margin-bottom:8px}
  .wx-day{padding:5px 4px}
  .wx-day i{margin:3px 0}
  .wx-hr{padding:4px 2px}
}

/* Móvil: el panel es un drawer (bottom sheet) que sube desde abajo.
   Vive en <body> (lo mueve placePop) porque la barra superior móvil tiene transform/contain
   y atraparía cualquier position:fixed que estuviera dentro de ella. */
@media (max-width:767px){
  .wx-wrap{display:block}
  .wx-time,.wx-sep{display:none}
  .wx-btn{height:36px;padding:0 11px;gap:6px;font-size:.74rem}
  .wx-backdrop{display:block;position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);
    opacity:0;visibility:hidden;transition:opacity .28s,visibility 0s .28s;-webkit-tap-highlight-color:transparent}
  .wx-backdrop.open{opacity:1;visibility:visible;transition:opacity .28s}
  .wx-pop,.wx-pop.expanded{
    display:block;position:fixed;top:auto;left:0;right:0;bottom:0;width:100%;z-index:10001;
    padding:6px 16px calc(16px + env(safe-area-inset-bottom,0px));
    border-radius:20px 20px 0 0;border-width:1px 0 0;
    max-height:88vh;max-height:88dvh;overflow-y:auto;overscroll-behavior:contain;
    transform:translateY(105%);visibility:hidden;
    transition:transform .3s cubic-bezier(.32,.72,0,1),visibility 0s .3s;
    box-shadow:0 -12px 40px rgba(0,0,0,.6)}
  .wx-pop.open{transform:translateY(0);visibility:visible;transition:transform .3s cubic-bezier(.32,.72,0,1)}
  .wx-pop.dragging{transition:none}
  .wx-grip{display:flex;justify-content:center;align-items:center;position:sticky;top:0;z-index:2;
    height:26px;margin:0 -16px 4px;cursor:grab;touch-action:none;
    background:linear-gradient(rgba(12,14,20,.98) 70%,rgba(12,14,20,0))}
  .wx-close{position:absolute;right:10px;top:0;width:34px;height:26px;display:flex;align-items:center;justify-content:center;
    border:0;background:transparent;color:var(--text-muted,#64748b);font-size:15px;cursor:pointer;border-radius:8px}
  .wx-close:focus-visible,.wx-pop:focus-visible{outline:2px solid var(--accent-color);outline-offset:-2px}
  .wx-pop:focus{outline:none}
  .wx-grip::before{content:"";width:40px;height:4px;border-radius:4px;background:rgba(255,255,255,.28)}
  .wx-pop.expanded .wx-grid{display:block}
  .wx-pop.expanded .wx-left{padding-right:0}
  .wx-pop.expanded .wx-more{padding-left:0;border-left:0}
  .wx-toggle{height:38px;font-size:.76rem}
  .wx-search input{font-size:16px;padding:10px 14px} /* 16px evita el zoom automático de iOS al escribir */
  .wx-search button{min-height:40px}
  .wx-opt{padding:11px 12px;font-size:.82rem}
  html.wx-lock,html.wx-lock body{overflow:hidden}
}
`;
    document.head.appendChild(st);
  }

  /* ── Ubicación: nav de escritorio o barra superior móvil ── */
  const mqMobile = window.matchMedia ? window.matchMedia("(max-width: 767px)") : { matches: false };

  // En móvil el panel (y su fondo oscuro) se mueven a <body> para que sea un drawer real;
  // en escritorio vuelven a su sitio dentro del widget.
  function placePop() {
    if (!els.pop || !els.backdrop) return;
    if (mqMobile.matches) {
      if (els.pop.parentNode !== document.body) {
        document.body.appendChild(els.backdrop);
        document.body.appendChild(els.pop);
      }
    } else if (els.pop.parentNode !== els.wrap) {
      els.wrap.appendChild(els.pop);
      els.backdrop.remove();
    }
  }

  // El widget va justo DESPUÉS del botón del calendario (que crea script.js): [calendario] [clima]
  let calTries = 0, calTimer = 0;
  function waitForCalendar() {
    if (calTimer || calTries > 40) return;
    calTimer = setInterval(() => {
      calTries++;
      const mobile = mqMobile.matches;
      if (document.getElementById(mobile ? "cal-btn-mobile" : "cal-btn-desktop") || calTries > 40) {
        clearInterval(calTimer);
        calTimer = 0;
        placeWidget();
      }
    }, 500);
  }

  function placeWidget() {
    if (!els.wrap) return;
    placePop();
    const mobile = mqMobile.matches;
    const host = document.querySelector(mobile ? ".mobile-top-right" : ".nav-right");
    if (!host) return;
    const cal = document.getElementById(mobile ? "cal-btn-mobile" : "cal-btn-desktop");
    const calHere = !!cal && cal.parentNode === host;
    const inPlace = els.wrap.parentNode === host && (!calHere || cal.nextSibling === els.wrap);
    if (inPlace) { if (!calHere) waitForCalendar(); return; }
    const moved = els.wrap.parentNode !== host;
    if (calHere) host.insertBefore(els.wrap, cal.nextSibling);
    else {
      // El calendario aún no existe: se coloca provisionalmente al principio y se reintenta
      host.insertBefore(els.wrap, host.firstChild);
      waitForCalendar();
    }
    if (moved && els.pop) toggle(false); // al cambiar de modo (girar el equipo, redimensionar) se cierra el panel
  }
  if (mqMobile.addEventListener) mqMobile.addEventListener("change", placeWidget);
  else if (mqMobile.addListener) mqMobile.addListener(placeWidget);

  /* ── Construcción del widget ──────────────────────────── */
  function build() {
    const host = document.querySelector(".nav-right");
    if (!host || document.getElementById("wx-widget")) return !!host;

    const wrap = document.createElement("div");
    wrap.className = "wx-wrap";
    wrap.id = "wx-widget";
    wrap.innerHTML = `
      <button class="wx-btn" type="button" title="Hora y clima" aria-label="Hora y clima" aria-expanded="false">
        <span class="wx-time">--:--</span>
        <span class="wx-sep"></span>
        <i class="fas fa-cloud wx-ico"></i>
        <span class="wx-t">--°</span>
      </button>
      <div class="wx-pop" role="dialog" aria-label="Clima" tabindex="-1">
        <div class="wx-grip"><button class="wx-close" type="button" aria-label="Cerrar clima"><i class="fas fa-xmark" aria-hidden="true"></i></button></div>
        <div class="wx-grid"><div class="wx-left">
        <div class="wx-city">—</div>
        <div class="wx-main">
          <i class="fas fa-cloud wx-bigico"></i>
          <div><div class="wx-temp">--°</div><div class="wx-desc">Cargando…</div></div>
          <div class="wx-clock"><b>--:--</b><span>—</span></div>
        </div>
        <div class="wx-alert" role="status"></div>
        <div class="wx-stats">
          <div class="wx-stat">Sensación<b class="wx-feels">--</b></div>
          <div class="wx-stat">Humedad<b class="wx-hum">--</b></div>
          <div class="wx-stat">Viento<b class="wx-wind">--</b></div>
        </div>
        <button class="wx-toggle" type="button" aria-expanded="false"><i class="fas fa-plus"></i><span>Más detalles</span></button>
        <div class="wx-days"></div>
        </div>
        <div class="wx-more">
        <div class="wx-stats">
          <div class="wx-stat"><span class="wx-rain-l" title="Probabilidad máxima de precipitación en las próximas 6 horas">Lluvia 6h</span><b class="wx-rain">--</b></div>
          <div class="wx-stat">Índice UV<b class="wx-uv">--</b></div>
          <div class="wx-stat">Ráfagas<b class="wx-gust">--</b></div>
          <div class="wx-stat">Presión<b class="wx-pres">--</b></div>
          <div class="wx-stat">Visibilidad<b class="wx-vis">--</b></div>
          <div class="wx-stat"><span class="wx-sun-l">Atardecer</span><b class="wx-sun">--</b></div>
        </div>
        <div class="wx-hours" aria-label="Próximas horas"></div>
        <div class="wx-chart"><div class="wx-chart-t"><span>Próximas 24 horas</span><i>temperatura · lluvia</i></div><svg class="wx-chart-svg" viewBox="0 0 300 100" role="img" aria-label="Temperatura y probabilidad de lluvia de las próximas 24 horas"></svg></div>
        </div>
        </div>
        <div class="wx-picks-slot"></div>
        <form class="wx-search">
          <input type="text" placeholder="Escribe una ciudad…" autocomplete="off" />
          <button type="submit">Ir</button>
        </form>
        <div class="wx-sugg" role="listbox"></div>
        <div class="wx-msg"></div>
      </div>`;
    host.insertBefore(wrap, host.firstChild);

    const q = (s) => wrap.querySelector(s);
    els = {
      wrap, btn: q(".wx-btn"), pop: q(".wx-pop"), time: q(".wx-time"), ico: q(".wx-ico"), t: q(".wx-t"),
      city: q(".wx-city"), big: q(".wx-bigico"), temp: q(".wx-temp"), desc: q(".wx-desc"),
      clockB: q(".wx-clock b"), clockS: q(".wx-clock span"), feels: q(".wx-feels"), hum: q(".wx-hum"),
      wind: q(".wx-wind"), days: q(".wx-days"), hours: q(".wx-hours"), alert: q(".wx-alert"), toggle: q(".wx-toggle"), chart: q(".wx-chart-svg"),
      rain: q(".wx-rain"), rainL: q(".wx-rain-l"), uv: q(".wx-uv"), gust: q(".wx-gust"), pres: q(".wx-pres"),
      vis: q(".wx-vis"), sun: q(".wx-sun"), sunL: q(".wx-sun-l"), form: q(".wx-search"), input: q(".wx-search input"),
      msg: q(".wx-msg"), sugg: q(".wx-sugg"),
    };

    els.backdrop = document.createElement("div");
    els.backdrop.className = "wx-backdrop";
    els.backdrop.addEventListener("click", () => toggle(false));

    // Arrastrar el asa hacia abajo cierra el drawer (solo móvil)
    const grip = q(".wx-grip");
    let dragY0 = null, dragDy = 0;
    grip.addEventListener("pointerdown", (e) => {
      dragY0 = e.clientY; dragDy = 0;
      els.pop.classList.add("dragging");
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener("pointermove", (e) => {
      if (dragY0 === null) return;
      dragDy = Math.max(0, e.clientY - dragY0);
      els.pop.style.transform = `translateY(${dragDy}px)`;
    });
    const endDrag = () => {
      if (dragY0 === null) return;
      dragY0 = null;
      els.pop.classList.remove("dragging");
      els.pop.style.transform = "";
      if (dragDy > 90) toggle(false);
    };
    grip.addEventListener("pointerup", endDrag);
    grip.addEventListener("pointercancel", endDrag);

    // Botón cerrar (accesible; no inicia el arrastre del asa)
    const closeBtn = q(".wx-close");
    closeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    closeBtn.addEventListener("click", () => toggle(false));

    // Foco atrapado dentro del drawer mientras está abierto (solo móvil)
    const focusables = () => [...els.pop.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.offsetParent !== null);
    els.pop.addEventListener("keydown", (e) => {
      if (e.key !== "Tab" || !mqMobile.matches) return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === els.pop)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    document.addEventListener("focusin", (e) => {
      if (mqMobile.matches && els.pop.classList.contains("open") && !els.pop.contains(e.target)) els.pop.focus({ preventScroll: true });
    });

    // Botón "atrás" del celular: cierra el drawer en vez de salir de la página
    // Retroceso real del navegador. El drawer nunca llama a history.back() por su cuenta
    // (así la X no puede "volver atrás" en la página).
    window.addEventListener("popstate", (e) => {
      if (histPushed) {           // botón/gesto "atrás" con el drawer abierto: solo lo cierra
        histPushed = false;
        e.stopImmediatePropagation();
        toggle(false);
        return;
      }
      if (histStale) {            // atrás sobre la entrada que dejó un cierre con la X: se ignora
        histStale = false;
        e.stopImmediatePropagation();
      }
    }, true);

    // Con el teclado abierto, que el buscador no quede tapado
    q(".wx-search input").addEventListener("focus", () => {
      if (mqMobile.matches) setTimeout(() => q(".wx-search").scrollIntoView({ block: "center", behavior: "smooth" }), 300);
    });

    const EXP_KEY = "cc_weather_expanded";
    const setExpanded = (on, save) => {
      els.pop.classList.toggle("expanded", on);
      els.toggle.setAttribute("aria-expanded", String(on));
      els.toggle.querySelector("i").className = "fas " + (on ? "fa-minus" : "fa-plus");
      els.toggle.querySelector("span").textContent = on ? "Menos detalles" : "Más detalles";
      if (save) { try { localStorage.setItem(EXP_KEY, on ? "1" : "0"); } catch (_) {} }
    };
    try { setExpanded(localStorage.getItem(EXP_KEY) === "1", false); } catch (_) {}
    els.toggle.addEventListener("click", () => setExpanded(!els.pop.classList.contains("expanded"), true));
    els.btn.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    els.pop.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => toggle(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggle(false); });
    els.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const pick = suggestions[activeIdx >= 0 ? activeIdx : 0];
      if (pick) selectPlace(pick);
      else searchCity(els.input.value.trim());
    });
    els.input.addEventListener("input", () => {
      clearTimeout(suggTimer);
      const v = els.input.value.trim();
      if (v.length < 2) { closeSuggestions(); return; }
      suggTimer = setTimeout(() => loadSuggestions(v), 250); // espera a que dejes de escribir
    });
    els.input.addEventListener("keydown", (e) => {
      if (!suggestions.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = suggestions.length;
        activeIdx = e.key === "ArrowDown" ? (activeIdx + 1) % n : (activeIdx - 1 + n) % n;
        highlight();
      }
    });
    setupChart();
    placeWidget();
    return true;
  }

  let histStale = false; // true = quedó una entrada de historial del drawer ya sin uso (se reutiliza o se ignora)
  let histPushed = false; // true mientras hay una entrada de historial creada por el drawer
  let lastFocus = null;

  // keepHistory: cierre que no debe llamar a history.back() (p. ej. al abrir un título,
  // para no pisar el historial que el detalle pueda crear justo después).
  function toggle(force, keepHistory) {
    const open = typeof force === "boolean" ? force : !els.pop.classList.contains("open");
    const wasOpen = els.pop.classList.contains("open");
    const mobile = mqMobile.matches;
    els.pop.classList.toggle("open", open);
    els.pop.setAttribute("aria-modal", String(open && mobile));
    if (!mobile && histPushed) histPushed = false; // se pasó a escritorio con el drawer abierto
    if (mobile) {
      if (open && !wasOpen) {
        lastFocus = document.activeElement;
        if (!histPushed) {
          if (histStale) { histStale = false; histPushed = true; } // reutiliza la entrada sobrante
          else { try { history.pushState({ wx: 1 }, ""); histPushed = true; } catch (_) {} }
        }
        setTimeout(() => { if (els.pop.classList.contains("open")) els.pop.focus({ preventScroll: true }); }, 50);
      } else if (!open && wasOpen) {
        if (histPushed) {
          histPushed = false;
          // Sin history.back(): cerrar con la X/fondo/arrastre/Esc nunca navega.
          // La entrada queda sobrante y se reutiliza al reabrir (o se ignora si llega un "atrás").
          if (keepHistory) { try { history.replaceState(null, ""); } catch (_) {} }
          else histStale = true;
        }
        const back = lastFocus && document.contains(lastFocus) ? lastFocus : els.btn;
        if (!keepHistory) back.focus({ preventScroll: true });
        lastFocus = null;
      }
    }
    if (!open && els.sugg) closeSuggestions();
    els.btn.classList.toggle("open", open);
    els.backdrop.classList.toggle("open", open);
    document.documentElement.classList.toggle("wx-lock", open && mqMobile.matches);
    if (open) window.dispatchEvent(new Event("cc:weather-open")); // para refrescar las recomendaciones
    els.btn.setAttribute("aria-expanded", String(open));
  }

  /* ── Reloj ────────────────────────────────────────────── */
  // Fecha (AAAA-MM-DD) en la zona horaria de la ciudad mostrada
  function dayKey(d) {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).format(d || new Date());
  }
  let shownDay = "";
  let shownHour = "";

  // Hora local de la ciudad como "AAAA-MM-DDTHH:MM" (mismo formato que Open-Meteo)
  function nowLocal() {
    const p = {};
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      hourCycle: "h23", timeZone: tz,
    }).formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }

  function tick() {
    if (!els.time) return;
    const now = new Date();
    // Cambió el día (pasaron las 00:00): refresca clima y pronóstico sin recargar la página
    const dk = dayKey(now);
    if (shownDay && dk !== shownDay) {
      shownDay = dk;
      if (data) render();   // reacomoda el pronóstico al instante
      fetchWeather();       // y trae los datos nuevos del día
    }
    shownDay = dk;
    // Cambió la hora: recalcula "próximas horas" y alertas con los datos que ya tenemos
    const hk = nowLocal().slice(0, 13);
    if (shownHour && hk !== shownHour && data) { shownHour = hk; render(); }
    shownHour = hk;
    const hm = new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(now);
    const day = new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "short", timeZone: tz }).format(now);
    els.time.textContent = hm;
    els.clockB.textContent = hm;
    els.clockS.textContent = day;
  }

  /* ── Clima ────────────────────────────────────────────── */
  async function fetchWeather() {
    const url = "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${place.lat}&longitude=${place.lon}` +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day," +
        "wind_direction_10m,wind_gusts_10m,pressure_msl,precipitation,snowfall" +
      "&hourly=temperature_2m,weather_code,is_day,precipitation_probability,precipitation,snowfall,cloud_cover," +
        "wind_speed_10m,wind_gusts_10m,uv_index,visibility,cape" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max," +
        "precipitation_probability_max,precipitation_sum,snowfall_sum,wind_gusts_10m_max" +
      "&timezone=auto&forecast_days=4";
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      data = await r.json();
      if (data.timezone) tz = data.timezone;
      shownHour = nowLocal().slice(0, 13);
      shownDay = dayKey(); // al cambiar de ciudad/zona no cuenta como cambio de día
      render();
    } catch (err) {
      console.warn("[Clima] No se pudo obtener el clima:", err);
      els.desc.textContent = "Sin conexión con el clima";
    }
  }

  /* ── Datos derivados: próximas horas, lluvia, tormenta, sol… ── */
  const DIRS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  const compass = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  const isNum = (v) => typeof v === "number" && isFinite(v);

  function derive() {
    const c = data.current, h = data.hourly || {}, d = data.daily || {};
    const nowStr = nowLocal();
    const times = h.time || [];
    let i = times.indexOf(nowStr.slice(0, 13) + ":00");
    if (i < 0) i = 0;
    // valores numéricos de una variable por hora: from = desplazamiento desde la hora actual
    const win = (key, from, n) => (h[key] || []).slice(i + from, i + from + n).filter(isNum);
    const max = (a) => (a.length ? Math.max(...a) : 0);
    const sum = (a) => a.reduce((t, v) => t + v, 0);

    const rainingNow =
      (c.weather_code >= 51 && c.weather_code <= 67) || (c.weather_code >= 80 && c.weather_code <= 82) ||
      (isNum(c.precipitation) && c.precipitation > 0);
    const rainProb3 = max(win("precipitation_probability", 0, 3));
    const rainMm3 = sum(win("precipitation", 0, 3));
    const rainSoon = !rainingNow && (rainProb3 >= 70 || rainMm3 >= 1);
    const codes6 = win("weather_code", 0, 6);
    const cape6 = max(win("cape", 0, 6));
    const stormSoon = codes6.some((x) => x >= 95) || (cape6 >= 2000 && max(win("precipitation_probability", 0, 3)) >= 50);
    const snowSoon = sum(win("snowfall", 0, 6)) > 0 || codes6.some((x) => (x >= 71 && x <= 77) || x === 85 || x === 86);

    // Amanecer / atardecer
    const ev = [];
    (d.time || []).forEach((_, k) => {
      if (d.sunrise && d.sunrise[k]) ev.push({ t: d.sunrise[k], type: "sunrise" });
      if (d.sunset && d.sunset[k]) ev.push({ t: d.sunset[k], type: "sunset" });
    });
    ev.sort((a, b) => (a.t < b.t ? -1 : 1));
    const mins = (a, b) => Math.round((Date.parse(a + ":00Z") - Date.parse(b + ":00Z")) / 60000);
    const next = ev.find((e) => e.t > nowStr) || null;
    const prevSunset = [...ev].reverse().find((e) => e.type === "sunset" && e.t <= nowStr) || null;
    const nextSunset = ev.find((e) => e.type === "sunset" && e.t > nowStr) || null;

    const di = Math.max(0, (d.time || []).indexOf(nowStr.slice(0, 10)));
    const hours = [];
    for (let k = 1; k <= 6 && i + k < times.length; k++) {
      hours.push({
        hour: times[i + k].slice(11, 13),
        code: h.weather_code ? h.weather_code[i + k] : 0,
        temp: h.temperature_2m ? h.temperature_2m[i + k] : null,
        pop: h.precipitation_probability ? h.precipitation_probability[i + k] : 0,
        isDay: h.is_day ? !!h.is_day[i + k] : true,
      });
    }
    const chart = [];
    for (let k = 0; k <= 24 && i + k < times.length; k++) {
      chart.push({
        time: times[i + k],
        hour: times[i + k].slice(11, 13),
        temp: h.temperature_2m ? h.temperature_2m[i + k] : null,
        pop: h.precipitation_probability ? h.precipitation_probability[i + k] : 0,
        isDay: h.is_day ? !!h.is_day[i + k] : true,
      });
    }
    const visM = h.visibility ? h.visibility[i] : null;
    return {
      windDir: isNum(c.wind_direction_10m) ? c.wind_direction_10m : null,
      gust: isNum(c.wind_gusts_10m) ? c.wind_gusts_10m : null,
      pressure: isNum(c.pressure_msl) ? c.pressure_msl : null,
      precip: isNum(c.precipitation) ? c.precipitation : 0,
      snowfall: isNum(c.snowfall) ? c.snowfall : 0,
      uv: h.uv_index && isNum(h.uv_index[i]) ? h.uv_index[i] : null,
      uvMax: d.uv_index_max && isNum(d.uv_index_max[di]) ? d.uv_index_max[di] : null,
      visibilityKm: isNum(visM) ? visM / 1000 : null,
      rainingNow, rainSoon, rainProb: max(win("precipitation_probability", 0, 6)), rainProb3, rainMm3,
      stormSoon, snowSoon, cape: cape6,
      nextSun: next ? { type: next.type, time: next.t.slice(11, 16) } : null,
      minsToSunset: nextSunset ? mins(nextSunset.t, nowStr) : null,
      minsSinceSunset: prevSunset ? mins(nowStr, prevSunset.t) : null,
      hours, chart,
    };
  }

  const uvLabel = (u) => (u < 3 ? "Bajo" : u < 6 ? "Moderado" : u < 8 ? "Alto" : u < 11 ? "Muy alto" : "Extremo");

  /* ── Gráfico de las próximas 24 h ──
     Línea de temperatura + barras de probabilidad de lluvia, con zoom tipo línea de tiempo:
     · rueda del mouse (o botones + / −) acerca y aleja alrededor del cursor
     · arrastrar mueve la ventana de tiempo; pellizco en pantallas táctiles
     · pasar el mouse / tocar muestra la hora exacta con su temperatura y lluvia
     · doble clic acerca / vuelve a las 24 h · teclado: + − ← → 0 */
  const CH = { W: 300, H: 100, pl: 8, pr: 8, pt: 16, pb: 24 };
  const CH_MIN_SPAN = 3; // horas visibles como mínimo
  const CH_DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const cs = { pts: [], v0: 0, v1: 24, cur: null, t0: "", raf: 0 };
  const csClamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const csFull = () => cs.pts.length < 2 || (cs.v0 <= 1e-6 && cs.v1 >= cs.pts.length - 1 - 1e-6);

  function csFix() {
    const n = cs.pts.length;
    if (n < 2) return;
    const span = csClamp(cs.v1 - cs.v0, Math.min(CH_MIN_SPAN, n - 1), n - 1);
    cs.v0 = csClamp(cs.v0, 0, n - 1 - span);
    cs.v1 = cs.v0 + span;
    if (cs.cur != null && (cs.cur < cs.v0 - 1e-6 || cs.cur > cs.v1 + 1e-6)) cs.cur = null;
  }
  function csSchedule() {
    if (!cs.raf) cs.raf = requestAnimationFrame(() => { cs.raf = 0; drawChart(); });
  }
  // Acerca (factor < 1) o aleja (factor > 1) manteniendo fijo el instante k. Devuelve false si ya está en el límite.
  function csZoom(factor, k) {
    const n = cs.pts.length;
    if (n < 3) return false;
    const span = cs.v1 - cs.v0;
    const ns = csClamp(span * factor, Math.min(CH_MIN_SPAN, n - 1), n - 1);
    if (Math.abs(ns - span) < 1e-6) return false;
    const f = (k - cs.v0) / span;
    cs.v0 = k - f * ns;
    cs.v1 = cs.v0 + ns;
    csFix();
    csSchedule();
    return true;
  }
  function csReset() {
    cs.v0 = 0; cs.v1 = Math.max(1, cs.pts.length - 1); cs.cur = null;
    csSchedule();
  }

  function renderChart(pts) {
    const svg = els.chart;
    if (!svg) return;
    const ok = (pts || []).filter((p) => isNum(p.temp));
    if (ok.length < 3) { svg.innerHTML = ""; cs.pts = []; return; }
    const wasFull = csFull();
    // Si cambió la hora, la ventana se corre con ella para seguir mirando lo mismo
    if (!wasFull && cs.t0 && pts[0].time && cs.t0 !== pts[0].time) {
      const d = Math.round((Date.parse(pts[0].time + ":00Z") - Date.parse(cs.t0 + ":00Z")) / 3600000);
      if (isFinite(d)) { cs.v0 -= d; cs.v1 -= d; if (cs.cur != null) cs.cur -= d; }
    }
    cs.pts = pts;
    cs.t0 = pts[0].time || "";
    if (wasFull) { cs.v0 = 0; cs.v1 = pts.length - 1; }
    csFix();
    drawChart();
  }

  function drawChart() {
    const svg = els.chart;
    const pts = cs.pts;
    const n = pts.length;
    if (!svg || n < 3) return;
    const { W, H, pl, pr, pt, pb } = CH;
    const base = H - pb, plotH = base - pt, plotW = W - pl - pr;
    const v0 = cs.v0, v1 = cs.v1, span = v1 - v0;
    const x = (k) => pl + ((k - v0) / span) * plotW;
    const step = plotW / span; // ancho de una hora en unidades del gráfico
    const inView = (k) => k >= v0 - 1e-6 && k <= v1 + 1e-6;
    const temps = pts.filter((p) => isNum(p.temp)).map((p) => p.temp);
    const tmin = Math.min(...temps), tmax = Math.max(...temps);
    const tspan = Math.max(tmax - tmin, 2); // evita una línea plana exagerada
    const y = (t) => pt + (1 - (t - tmin) / tspan) * (plotH - 6) + 2;
    const a = Math.max(0, Math.floor(v0)), b = Math.min(n - 1, Math.ceil(v1));
    const f1 = (v) => v.toFixed(1);

    // Cada cuántas horas va una marca en el eje
    const tickStep = [1, 2, 3, 6].find((s) => span / s <= 6.5) || 6;
    const ticks = [];
    for (let k = Math.ceil(v0 - 1e-6); k <= v1 + 1e-6; k++) {
      if (k % tickStep === 0 || (k === n - 1 && (n - 1) % tickStep >= tickStep * 0.5)) ticks.push(k);
    }

    let out = "";
    // Noche: franjas tenues
    for (let k = a; k <= b; k++) {
      if (!pts[k].isDay) out += `<rect class="nt" x="${f1(x(k) - step / 2)}" y="${pt - 4}" width="${(step + 0.6).toFixed(1)}" height="${plotH + 4}"/>`;
    }
    // Líneas guía (ayudan a leer la hora exacta al hacer zoom)
    if (span < n - 1) ticks.forEach((k) => { out += `<line class="gl" x1="${f1(x(k))}" x2="${f1(x(k))}" y1="${pt - 4}" y2="${base}"/>`; });
    // Lluvia: barras desde la base
    for (let k = a; k <= b; k++) {
      const pop = isNum(pts[k].pop) ? pts[k].pop : 0;
      if (pop < 10) continue;
      const bh = (pop / 100) * plotH * 0.55;
      out += `<rect class="bar" x="${f1(x(k) - step * 0.35)}" y="${f1(base - bh)}" width="${(step * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" rx="1"/>`;
    }
    // Línea y área de temperatura (un punto más allá de cada borde para que llegue hasta el marco)
    const idx = [];
    for (let k = a; k <= b; k++) if (isNum(pts[k].temp)) idx.push(k);
    if (idx.length) {
      const line = idx.map((k) => `${f1(x(k))},${f1(y(pts[k].temp))}`);
      out += `<polygon class="ar" points="${f1(x(idx[0]))},${base} ${line.join(" ")} ${f1(x(idx[idx.length - 1]))},${base}"/>`;
      out += `<polyline class="ln" points="${line.join(" ")}"/>`;
    }
    // Puntos: uno por hora al acercar; solo "ahora" con la vista completa
    idx.forEach((k) => {
      if (inView(k) && (span <= 12 || k === 0)) out += `<circle class="dot" cx="${f1(x(k))}" cy="${f1(y(pts[k].temp))}" r="${k === 0 ? 2.8 : 2}"/>`;
    });
    // Máxima y mínima (si están dentro de la vista)
    const iMax = pts.findIndex((p) => p.temp === tmax), iMin = pts.findIndex((p) => p.temp === tmin);
    const lab = (k, dy) => {
      const tx = Math.min(W - 14, Math.max(14, x(k)));
      return `<text class="tv" text-anchor="middle" x="${f1(tx)}" y="${f1(y(pts[k].temp) + dy)}">${Math.round(pts[k].temp)}°</text>`;
    };
    if (iMax >= 0 && inView(iMax)) out += lab(iMax, -5);
    if (iMin >= 0 && iMin !== iMax && inView(iMin)) out += lab(iMin, 13);
    // Eje de horas
    ticks.forEach((k) => {
      const ax = x(k);
      const anchor = ax < pl + 12 ? "start" : ax > W - pr - 12 ? "end" : "middle";
      out += `<text class="tx" text-anchor="${anchor}" x="${f1(ax)}" y="${H - 6}">${k === 0 ? "ahora" : pts[k].hour + "h"}</text>`;
    });

    // Cursor: hora exacta
    if (cs.cur != null && pts[cs.cur] && inView(cs.cur)) {
      const k = cs.cur, p = pts[k], cx = x(k);
      out += `<line class="cur" x1="${f1(cx)}" x2="${f1(cx)}" y1="${pt - 4}" y2="${base}"/>`;
      if (isNum(p.temp)) out += `<circle class="cd" cx="${f1(cx)}" cy="${f1(y(p.temp))}" r="3.4"/>`;
      let day = "";
      if (p.time) { const dt = new Date(p.time + ":00Z"); if (!isNaN(dt)) day = CH_DAYS[dt.getUTCDay()] + " "; }
      const l1 = k === 0 ? `Ahora · ${p.hour}:00` : `${day}${p.hour}:00`;
      const l2 = `${isNum(p.temp) ? Math.round(p.temp) + "°" : "--"} · lluvia ${isNum(p.pop) ? Math.round(p.pop) : 0}%`;
      const w = Math.max(l1.length, l2.length) * 4.9 + 12;
      const bx = csClamp(cx - w / 2, 2, W - w - 2);
      const by = bx + w > W - 72 ? 24 : 1; // si choca con los botones de zoom, baja un poco
      out += `<rect class="tb" x="${f1(bx)}" y="${by}" width="${w.toFixed(1)}" height="24" rx="4"/>`;
      out += `<text class="tx" x="${f1(bx + 6)}" y="${by + 9}">${l1}</text>`;
      out += `<text class="tv" x="${f1(bx + 6)}" y="${by + 19}">${l2}</text>`;
    }
    svg.innerHTML = out;
    svg.classList.toggle("zoomed", !csFull());
    if (els.zin) els.zin.disabled = span <= Math.min(CH_MIN_SPAN, n - 1) + 1e-6;
    if (els.zout) els.zout.disabled = csFull();
    if (els.zreset) els.zreset.hidden = csFull();
  }

  function setupChart() {
    const svg = els.chart;
    if (!svg || svg.dataset.zoomReady) return;
    svg.dataset.zoomReady = "1";
    const { W, pl, pr } = CH;
    const plotW = W - pl - pr;

    // Botones − + y "ver las 24 h"
    const zc = document.createElement("div");
    zc.className = "wx-zoomc";
    // El botón de restablecer va a la izquierda de − y +: así, al aparecer, "−" y "+" no se mueven de sitio
    // (quien hace clic repetido en "+" no termina presionando el de restablecer).
    zc.innerHTML =
      '<button type="button" class="wx-z-reset" aria-label="Ver las 24 horas" title="Ver las 24 horas" hidden><i class="fas fa-arrow-rotate-left"></i></button>' +
      '<button type="button" class="wx-z-out" aria-label="Alejar" title="Alejar"><i class="fas fa-minus"></i></button>' +
      '<button type="button" class="wx-z-in" aria-label="Acercar" title="Acercar"><i class="fas fa-plus"></i></button>';
    svg.parentNode.appendChild(zc);
    els.zout = zc.querySelector(".wx-z-out");
    els.zin = zc.querySelector(".wx-z-in");
    els.zreset = zc.querySelector(".wx-z-reset");
    svg.tabIndex = 0;
    svg.setAttribute("aria-description", "Rueda o botones para acercar; flechas para ver cada hora.");

    const center = () => (cs.cur != null ? cs.cur : (cs.v0 + cs.v1) / 2);
    els.zin.addEventListener("click", () => csZoom(0.6, center()));
    els.zout.addEventListener("click", () => csZoom(1 / 0.6, center()));
    els.zreset.addEventListener("click", csReset);

    // x de pantalla → instante (en horas desde "ahora", con decimales)
    const toK = (clientX) => {
      const r = svg.getBoundingClientRect();
      const vx = ((clientX - r.left) / (r.width || 1)) * W;
      return cs.v0 + ((vx - pl) / plotW) * (cs.v1 - cs.v0);
    };
    const setCursor = (clientX) => {
      const lo = Math.ceil(cs.v0 - 1e-6), hi = Math.floor(cs.v1 + 1e-6);
      cs.cur = csClamp(Math.round(toK(clientX)), lo, hi);
      csSchedule();
    };

    // Rueda: zoom alrededor del cursor. En el límite deja pasar el scroll al panel.
    svg.addEventListener("wheel", (e) => {
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (!dy) return;
      if (csZoom(Math.exp(csClamp(dy, -200, 200) * 0.0015), toK(e.clientX))) e.preventDefault();
    }, { passive: false });

    // Puntero: mover cursor, arrastrar (pan) y pellizcar (zoom)
    const ptrs = new Map();
    let drag = null, pinch = null;
    svg.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      try { svg.setPointerCapture(e.pointerId); } catch (_) {}
      ptrs.set(e.pointerId, { x: e.clientX });
      if (ptrs.size === 2) {
        const [p1, p2] = [...ptrs.values()];
        pinch = { d: Math.abs(p1.x - p2.x) || 1, v0: cs.v0, v1: cs.v1, mid: toK((p1.x + p2.x) / 2) };
        drag = null;
      } else {
        drag = { x: e.clientX, v0: cs.v0, v1: cs.v1, moved: false };
        setCursor(e.clientX);
      }
    });
    svg.addEventListener("pointermove", (e) => {
      const p = ptrs.get(e.pointerId);
      if (p) p.x = e.clientX;
      const n = cs.pts.length;
      if (pinch && ptrs.size === 2) {
        const [p1, p2] = [...ptrs.values()];
        const d = Math.abs(p1.x - p2.x) || 1;
        const span0 = pinch.v1 - pinch.v0;
        const ns = csClamp((span0 * pinch.d) / d, Math.min(CH_MIN_SPAN, n - 1), n - 1);
        const f = (pinch.mid - pinch.v0) / span0;
        cs.v0 = pinch.mid - f * ns;
        cs.v1 = cs.v0 + ns;
        cs.cur = null;
        csFix();
        csSchedule();
        return;
      }
      if (drag && p) {
        const dx = e.clientX - drag.x;
        if (Math.abs(dx) > 3) drag.moved = true;
        if (drag.moved && !csFull()) { // con zoom, arrastrar desplaza el tiempo
          const r = svg.getBoundingClientRect();
          const perHour = ((r.width || 1) / W) * plotW / (drag.v1 - drag.v0);
          cs.v0 = drag.v0 - dx / perHour;
          cs.v1 = drag.v1 - dx / perHour;
          cs.cur = null;
          csFix();
          csSchedule();
          return;
        }
      }
      if (e.pointerType === "mouse" || drag) setCursor(e.clientX);
    });
    const endPtr = (e) => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (ptrs.size === 1) { const [p1] = [...ptrs.values()]; drag = { x: p1.x, v0: cs.v0, v1: cs.v1, moved: true }; }
      else drag = null;
    };
    svg.addEventListener("pointerup", endPtr);
    svg.addEventListener("pointercancel", endPtr);
    svg.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse" && !drag) { cs.cur = null; csSchedule(); }
    });
    // Doble clic / doble toque: acerca ahí, o vuelve a las 24 h si ya hay zoom
    svg.addEventListener("dblclick", (e) => {
      e.preventDefault();
      if (csFull()) csZoom(0.3, toK(e.clientX)); else csReset();
    });

    // Teclado
    svg.addEventListener("keydown", (e) => {
      const n = cs.pts.length;
      if (n < 3) return;
      let handled = true;
      if (e.key === "+" || e.key === "=") csZoom(0.6, center());
      else if (e.key === "-" || e.key === "_") csZoom(1 / 0.6, center());
      else if (e.key === "0" || e.key === "Home") csReset();
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        const from = cs.cur != null ? cs.cur : Math.round(dir < 0 ? cs.v1 : cs.v0);
        const next = csClamp(from + dir, 0, n - 1);
        cs.cur = next;
        if (next < cs.v0) { const sp = cs.v1 - cs.v0; cs.v0 = next; cs.v1 = next + sp; }
        else if (next > cs.v1) { const sp = cs.v1 - cs.v0; cs.v1 = next; cs.v0 = next - sp; }
        csFix();
        csSchedule();
      } else handled = false;
      if (handled) e.preventDefault();
    });
    svg.addEventListener("blur", () => { cs.cur = null; csSchedule(); });
  }

  function renderExtras(ctx, isDay) {
    const set = (el, v) => { if (el) el.textContent = v; };
    const w = data.current;
    set(els.wind, Math.round(w.wind_speed_10m) + " km/h" + (ctx.windDir != null ? " " + compass(ctx.windDir) : ""));
    set(els.gust, ctx.gust != null ? Math.round(ctx.gust) + " km/h" : "--");
    set(els.pres, ctx.pressure != null ? Math.round(ctx.pressure) + " hPa" : "--");
    set(els.vis, ctx.visibilityKm != null ? (ctx.visibilityKm >= 10 ? "10+ km" : ctx.visibilityKm.toFixed(1) + " km") : "--");
    set(els.uv, ctx.uv != null ? `${Math.round(ctx.uv)} · ${uvLabel(ctx.uv)}` : "--");
    set(els.rainL, ctx.snowfall > 0 || ctx.snowSoon ? "Nieve 6h" : "Lluvia 6h");
    set(els.rain, Math.round(ctx.rainProb) + "%");
    set(els.sunL, ctx.nextSun ? (ctx.nextSun.type === "sunrise" ? "Amanecer" : "Atardecer") : "Sol");
    set(els.sun, ctx.nextSun ? ctx.nextSun.time : "--");

    // Aviso destacado (solo si hay algo que valga la pena)
    let msg = "";
    if (w.weather_code >= 95) msg = "Hay tormenta eléctrica en tu zona.";
    else if (ctx.stormSoon) msg = "Posible tormenta en las próximas horas.";
    else if (ctx.rainSoon) msg = `Lluvia probable en las próximas horas (${Math.round(ctx.rainProb3)}%).`;
    else if (ctx.gust != null && ctx.gust >= 55) msg = `Ráfagas fuertes de viento (${Math.round(ctx.gust)} km/h).`;
    else if (isDay && ctx.uv != null && ctx.uv >= 8) msg = "Índice UV muy alto: usa protector solar.";
    else if (ctx.visibilityKm != null && ctx.visibilityKm < 1) msg = "Visibilidad muy baja por niebla.";
    els.alert.textContent = msg;
    els.alert.classList.toggle("show", !!msg);

    renderChart(ctx.chart);

    // Próximas horas
    els.hours.innerHTML = "";
    ctx.hours.forEach((x) => {
      const hw = wmo(x.code, x.isDay);
      const el = document.createElement("div");
      el.className = "wx-hr";
      const pop = isNum(x.pop) && x.pop >= 10 ? Math.round(x.pop) + "%" : "";
      el.innerHTML = `<span>${x.hour}h</span><i class="fas ${hw.icon}"></i><b>${isNum(x.temp) ? Math.round(x.temp) + "°" : "--"}</b><small>${pop}</small>`;
      els.hours.appendChild(el);
    });
  }

  function render() {
    const c = data.current;
    const w = wmo(c.weather_code, c.is_day);
    const deg = (n) => Math.round(n) + "°";
    els.ico.className = `fas ${w.icon} wx-ico`;
    els.big.className = `fas ${w.icon} wx-bigico`;
    els.t.textContent = deg(c.temperature_2m);
    els.temp.textContent = deg(c.temperature_2m) + "C";
    els.desc.textContent = w.txt;
    els.city.textContent = place.name;
    els.feels.textContent = deg(c.apparent_temperature);
    els.hum.textContent = Math.round(c.relative_humidity_2m) + "%";
    let ctx = {};
    try { ctx = derive(); renderExtras(ctx, !!c.is_day); } catch (err) { console.warn("[Clima] Datos extra no disponibles:", err); els.wind.textContent = Math.round(c.wind_speed_10m) + " km/h"; }
    els.btn.title = `${place.name} · ${w.txt}`;

    // Publica el clima para otros módulos (p. ej. weather-picks.js)
    window.ccWeather = Object.assign({
      code: c.weather_code,
      isDay: !!c.is_day,
      temp: c.temperature_2m,
      place: place.name,
    }, ctx);
    window.dispatchEvent(new CustomEvent("cc:weather", { detail: window.ccWeather }));

    // Pronóstico: los 3 días siguientes
    const d = data.daily;
    els.days.innerHTML = "";
    const today = dayKey();
    let shown = 0;
    for (let i = 0; i < d.time.length && shown < 3; i++) {
      if (d.time[i] <= today) continue; // salta hoy y días ya pasados
      shown++;
      const dw = wmo(d.weather_code[i], true);
      const label = new Intl.DateTimeFormat("es-CL", { weekday: "short", timeZone: "UTC" })
        .format(new Date(d.time[i] + "T00:00:00Z"));
      const el = document.createElement("div");
      el.className = "wx-day";
      el.innerHTML = `<span style="text-transform:capitalize">${label}</span><i class="fas ${dw.icon}"></i>` +
        `<b>${deg(d.temperature_2m_max[i])}</b> <span>${deg(d.temperature_2m_min[i])}</span>`;
      els.days.appendChild(el);
    }
    tick();
  }

  /* ── Autocompletado de ciudades ───────────────────────── */
  let suggestions = [];
  let activeIdx = -1;
  let suggTimer = null;
  let suggReq = 0;

  async function fetchCities(name, count) {
    const r = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=${count}&language=es&format=json`
    );
    const j = await r.json();
    return j.results || [];
  }

  async function loadSuggestions(name) {
    const req = ++suggReq; // ignora respuestas viejas si sigues escribiendo
    try {
      const res = await fetchCities(name, 6);
      if (req !== suggReq) return;
      suggestions = res;
      activeIdx = -1;
      renderSuggestions();
    } catch (_) {
      if (req === suggReq) closeSuggestions();
    }
  }

  function renderSuggestions() {
    els.sugg.innerHTML = "";
    if (!suggestions.length) {
      els.sugg.classList.remove("open");
      els.msg.textContent = "Sin resultados.";
      return;
    }
    els.msg.textContent = "";
    suggestions.forEach((g, i) => {
      const o = document.createElement("div");
      o.className = "wx-opt";
      o.setAttribute("role", "option");
      o.innerHTML = `<span></span><small></small>`;
      o.firstChild.textContent = g.name;
      o.lastChild.textContent = [g.admin1, g.country].filter(Boolean).join(", ");
      o.addEventListener("click", () => selectPlace(g));
      o.addEventListener("mouseenter", () => { activeIdx = i; highlight(); });
      els.sugg.appendChild(o);
    });
    els.sugg.classList.add("open");
  }

  function highlight() {
    [...els.sugg.children].forEach((c, i) => c.classList.toggle("active", i === activeIdx));
  }

  function closeSuggestions() {
    suggestions = [];
    activeIdx = -1;
    els.sugg.innerHTML = "";
    els.sugg.classList.remove("open");
  }

  function selectPlace(g) {
    place = { name: g.name + (g.country_code ? `, ${g.country_code}` : ""), lat: g.latitude, lon: g.longitude };
    savePlace(); // localStorage + Firebase (si hay sesión)
    els.input.value = "";
    els.msg.textContent = "";
    closeSuggestions();
    fetchWeather();
  }

  // Respaldo: si das Enter antes de que aparezcan sugerencias
  async function searchCity(name) {
    if (!name) return;
    els.msg.textContent = "Buscando…";
    try {
      const res = await fetchCities(name, 1);
      if (!res[0]) { els.msg.textContent = "No encontré esa ciudad."; return; }
      selectPlace(res[0]);
    } catch (_) {
      els.msg.textContent = "Error al buscar. Intenta de nuevo.";
    }
  }

  /* ── Arranque ─────────────────────────────────────────── */
  function init() {
    window.ccWeatherClose = () => toggle(false, true); // lo usa weather-picks.js al abrir un título
    injectStyles();
    watchAuth();
    // El header puede tardar en existir: reintenta un rato
    let tries = 0;
    const iv = setInterval(() => {
      if (build() || ++tries > 40) {
        clearInterval(iv);
        if (els.wrap) {
          tick();
          // Reloj alineado al cambio de minuto: la hora y el día cambian justo a las 00:00
          const scheduleTick = () => setTimeout(() => { tick(); scheduleTick(); }, 60000 - (Date.now() % 60000) + 50);
          scheduleTick();
          fetchWeather();
          setInterval(fetchWeather, REFRESH_MS);
          // Al volver a la pestaña (los navegadores frenan los temporizadores en segundo plano)
          document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
          window.addEventListener("focus", tick);
        }
      }
    }, 250);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();