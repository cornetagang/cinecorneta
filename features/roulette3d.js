// =============================================================
// RULETA 3D — ETAPAS 1 y 2: rueda de casino, bola y cámara cinematográfica
// -------------------------------------------------------------
// Módulo OPCIONAL. roulette.js lo carga con import() dinámico solo cuando
// hace falta; si algo falla (sin WebGL, sin red al CDN, etc.) roulette.js
// vuelve solo al carrusel cover-flow de siempre.
//
// La película ganadora ya la decide roulette.js ANTES de girar. Este módulo
// solo dibuja la rueda y la detiene con la ganadora al frente (abajo de la
// pantalla, donde el póster se lee derecho).
//
// Para desactivarlo sin tocar código:   localStorage.roulette3d = "off"
// Para volver a activarlo:              localStorage.removeItem("roulette3d")
//
// Three.js se carga desde jsDelivr (versión fija, de hace más de 2 semanas).
// =============================================================

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

// ── Ajustes fáciles de tocar ─────────────────────────────────
const TUNING = {
  minPockets: 12,        // casillas mínimas (si hay pocas películas se repiten)
  maxPockets: 18,        // casillas máximas (más y los pósters quedan diminutos)
  idleSpeed: 0.12,       // rad/s: giro lento antes de apretar "Girar"
  spinMin: 20020,        // ms de giro (mínimo): = duración del audio medida, 20,02 s
  spinMax: 20020,        // ms de giro (máximo)
  turnsMin: 2.2,           // vueltas mínimas de la rueda en el giro
  turnsExtra: 1,       // vueltas extra al azar
  cameraElevation: 46,   // grados de inclinación de la cámara (90 = desde arriba)
  spotIntensity: 45,     // brillo del foco que ilumina a la ganadora
  ballRadius: 0.16,      // tamaño de la bola
  ballSpinRate: 0.3,     // cuánto gira la bola sobre sí misma (1 = rodadura real, que a esta velocidad se ve como un borrón; 0 = no gira)
  trailLength: 7,        // largo de la estela (unidades de recorrido)
  trailLead: 0.2,        // cuánto sobresale la punta de la estela por delante de la bola (0 = justo en la bola)
  trailMaxSec: 1.1,      // tope de duración de la estela (s)
  trailWidth: 0.55,      // ancho del brillo de la estela
  trailColor: "#7dff3a", // color de la estela si no se usa el del usuario (prueba "#7dff3a" para verde neón)
  trailUseAccent: true,  // true = la estela usa el color de acento que eligió el usuario en la página (--accent-color)
  ballSpeed: 6.0,        // rad/s: velocidad inicial de la bola en el borde (más alto = la cámara de seguimiento gira más rápido)
  ballSpeedEnd: 2.6,     // rad/s: velocidad justo antes de caer
  dropSec: 0.55,         // s que tarda en caer del borde a las casillas
  settleSec: 2.8,        // s saltando entre casillas hasta quedarse
  hopHeight: 0.34,       // altura de los rebotes
  flySec: 0.9,           // s que tarda el póster en volar hacia la cámara
  popHeight: 0.28,       // cuánto "salta" el póster ganador
  sound: false,          // sin sonidos sintetizados (golpes y rodadura); true = los activa
  spinSoundUrl: "", // sin música/sonido del giro. Para volver a ponerlo: "https://res.cloudinary.com/djhgmmdjx/video/upload/v1793134230/oevmypftqoyss6d1hy4q.mp3" (suena de 0 s al final, pegado a la animación)
  audioVolume: 0.5,      // 0 a 1: volumen del sonido de giro (el mp3)
  clickVolume: 0.64,     // 0 a 1: volumen de los golpes (aterrizaje, rebotes, caída a las casillas)
  audioFadeMs: 600,      // ms de fundido al cortar el sonido (Saltar, cerrar)
  tableColor: "#1b6b43", // color del paño de la mesa (cualquier color CSS; prueba "#7a1020" para rojo vino)
  // Cámara del giro (3 planos, como en el video de referencia):
  //  1) bajo y pegado a la bola, desde el lado interior de la rueda
  chaseLag: 0.55,        //   ángulo (rad) por detrás de la bola
  chaseInside: 1.7,      //   cuánto más hacia el centro que la bola
  chaseHeight: 0.75,     //   altura sobre la rueda
  chaseAhead: 0.8,       //   cuánto mira por delante de la bola
  chaseFov: 52,          //   campo de visión (más alto = más cerca y más dramático)
  //  2) cenital: ve toda la rueda y la estela de la bola
  topHeight: 11.5,
  topOffset: 4.5,
  topFov: 42,
  topSpin: 0.28,         //   rad/s: vuelta lenta de la cámara cenital
  //  3) pegado al eje: mira por encima del cono hacia la pista
  innerR: 1.5,
  innerH: 1.7,
  innerFov: 50,
  // Plano 0: la bola entra desde arriba y cae a la pista (la cámara ya va pegada a ella)
  dropInSec: 1.13,       //   s que dura la caída: la bola toca la madera/pista en este instante (medido en el audio)
  dropInRadius: 8.5,     //   a qué distancia del eje empieza la cámara (fuera de la mesa/tazón)
  dropInHeight: 6.5,     //   altura inicial de la cámara y de la bola (la bola sale pegada al lente)
  dropInFov: 58,         //   campo de visión al inicio (se cierra hasta el del plano 1)
  dropInBounce: 0.12,    //   altura del primer rebote al aterrizar (casi sin rebote, como en el video)
  windowWeather: true,   // true = el cielo de las ventanas sigue la hora y el clima reales (window.ccWeather de weather.js)
  dropFlareSize: 1.5,    //   tamaño del destello de lente pegado a la bola (0 = sin destello)
  camRollDeg: 6,         // inclinación "holandesa" en los planos 1 y 3
  viewCenterX: 3.8,      // hacia dónde mira la cámara en x (0 = solo la rueda; más = se ve más tablero de apuestas)
  viewHalfWidth: 11.5,   // cuánto ancho de mesa entra en pantalla (más = rueda más chica, se ve más mesa)
  audioFadeAtReveal: true, // true = el sonido se funde al revelar la ganadora
  // ── Montaje medido sobre el audio (segundos desde que arranca el giro) ──
  //   0,00 → dropInSec : la bola cae (plano 0)
  //   dropInSec → chaseEndSec : seguimiento pegado a la bola
  //   chaseEndSec → followStartSec : cámara cenital sobre la rueda (con un corte breve al cono al empezar)
  //   followStartSec → final : último seguimiento a la bola (adaptado del video de ejemplo)
  // Si cambias spinMin/spinMax, chaseEndSec y followStartSec se escalan en proporción a la nueva duración.
  cueRefSec: 20.02,      // duración con la que se midieron los tiempos de este bloque
  chaseEndSec: 5.24,     // fin del seguimiento y arranque de la cámara cenital
  coneCutSec: 0.45,      // corte breve al cono (con destello) entre el seguimiento y el cenital, como en el video (0 = sin corte)
  followStartSec: 14.09, // fin del cenital y arranque del último seguimiento
  topPush: 0.15,         // cuánto se acerca el cenital a lo largo de su tramo (0 = quieto; 0.15 = baja un 15 %)
  followSwoopSec: 1.6,   // s que tarda la cámara en bajar en espiral del cenital al seguimiento final
  followR: 1.5,          // seguimiento final: distancia de la cámara al eje (pegada al cono)
  followH: 1.0,          //   altura de esa cámara
  followLag: 0.9,        //   ángulo (rad) por detrás de la bola
  followFov: 50,         //   campo de visión
  followCloseR: 2.1,     //   al caer la bola a las casillas, la cámara se acerca a esta posición
  followCloseH: 0.8,
};

// ── Geometría (unidades arbitrarias) ─────────────────────────
const R_IN = 2.0;        // radio interior de las casillas
const R_OUT = 3.75;      // radio exterior de las casillas
const R_BOWL = 5.3;      // radio del tazón
const TWO_PI = Math.PI * 2;

let THREE = null;
let threePromise = null;

function loadThree() {
  if (!threePromise) {
    threePromise = import(THREE_URL).then((m) => (THREE = m));
    threePromise.catch(() => {
      threePromise = null; // permite reintentar en la próxima apertura
    });
  }
  return threePromise;
}

let _webgl = null;
export function webglAvailable() {
  if (_webgl !== null) return _webgl;
  try {
    const c = document.createElement("canvas");
    _webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch (_) {
    _webgl = false;
  }
  return _webgl;
}

// ── Utilidades puras ─────────────────────────────────────────
const mod = (a, n) => ((a % n) + n) % n;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const smoothstep01 = (x) => x * x * (3 - 2 * x);
const mix = (a, b, k) => a + (b - a) * k;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Arma la lista de casillas de la rueda.
 * entries: [{ id, title, poster }] (puede traer repetidos)
 * winnerId: id de la película que ya eligió roulette.js
 * Devuelve { items, winnerIndex }.
 *  - Con muchas películas: la ganadora + hasta (maxPockets-1) al azar, mezcladas.
 *  - Con pocas (p. ej. ruleta personalizada de 2): se reparten en ciclo para
 *    llenar la rueda y la casilla ganadora es una de las de la película elegida.
 */
export function prepareWheelItems(entries, winnerId) {
  const byId = new Map();
  for (const e of entries) if (e && !byId.has(e.id)) byId.set(e.id, e);
  const winner = byId.get(winnerId) || entries[0];
  const wid = winner ? winner.id : winnerId;
  byId.delete(wid);
  const others = shuffle([...byId.values()]);
  const uniqueCount = others.length + 1;

  if (uniqueCount >= TUNING.minPockets) {
    const list = shuffle([winner, ...others.slice(0, TUNING.maxPockets - 1)]);
    return { items: list, winnerIndex: list.findIndex((e) => e.id === wid) };
  }

  const cycle = shuffle([winner, ...others]);
  const items = [];
  for (let i = 0; i < TUNING.minPockets; i++) items.push(cycle[i % cycle.length]);
  const candidates = [];
  items.forEach((e, i) => {
    if (e.id === wid) candidates.push(i);
  });
  const winnerIndex = candidates[Math.floor(Math.random() * candidates.length)];
  return { items, winnerIndex };
}

// ── Estilos (se inyectan una sola vez) ───────────────────────
function injectStyles() {
  if (document.getElementById("roulette3d-styles")) return;
  const st = document.createElement("style");
  st.id = "roulette3d-styles";
  st.textContent = `
    .r3d-stage { position:absolute; inset:0; z-index:6; display:none;
      background: radial-gradient(ellipse at 50% 62%, rgba(255,255,255,0.05), transparent 65%); }
    .r3d-stage.on { display:block; }
    .r3d-canvas { display:block; width:100%; height:100%; }
    .r3d-stage::after { content:""; position:absolute; inset:0; pointer-events:none; background:radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,.42) 100%); }
    .r3d-title { position:absolute; left:0; right:0; bottom:4%; text-align:center; padding:0 6%;
      pointer-events:none; font-weight:800; font-size:clamp(1.05rem, 2.6vw, 1.6rem); color:#fff;
      text-shadow:0 2px 14px rgba(0,0,0,.95), 0 0 3px rgba(0,0,0,.9); opacity:0; transform:translateY(8px);
      transition: opacity .5s ease .6s, transform .5s ease .6s; }
    .r3d-stage[data-state="done"] .r3d-title { opacity:1; transform:none; }
    .r3d-skip { position:absolute; top:8px; right:10px; z-index:2; display:none; cursor:pointer;
      border:1px solid rgba(255,255,255,.28); background:rgba(0,0,0,.5); color:#fff;
      font:600 12px/1 sans-serif; padding:7px 12px; border-radius:999px; backdrop-filter:blur(4px); }
    .r3d-stage[data-state="spinning"] .r3d-skip { display:block; }
    .roulette-modal-content.r3d-on { max-width: 940px; }
    .roulette-modal-content.r3d-on .roulette-carousel-wrapper {
      height: clamp(340px, 56vh, 490px); perspective: none; overflow: hidden; }
    .roulette-modal-content.r3d-on .roulette-carousel-wrapper::before,
    .roulette-modal-content.r3d-on .roulette-carousel-wrapper::after { display:none; }
    .roulette-modal-content.r3d-on .roulette-carousel-track,
    .roulette-modal-content.r3d-on .roulette-selector { display:none !important; }
  `;
  document.head.appendChild(st);
}

// ── Texturas de póster ───────────────────────────────────────
const POSTER_W = 384;
const POSTER_H = 576;
let MAX_ANISO = 1; // se ajusta al crear el renderer: pósters nítidos aun inclinados
const texCache = new Map(); // url → Promise<Texture>

function wrapText(ctx, text, maxW) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 6);
}

function placeholderTexture(title) {
  const c = document.createElement("canvas");
  c.width = POSTER_W;
  c.height = POSTER_H;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, POSTER_H);
  g.addColorStop(0, "#2a2f3a");
  g.addColorStop(1, "#12141a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);
  const k = POSTER_W / 256;
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 4 * k;
  ctx.strokeRect(8 * k, 8 * k, POSTER_W - 16 * k, POSTER_H - 16 * k);
  ctx.fillStyle = "#fff";
  ctx.font = "700 " + 28 * k + "px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapText(ctx, title, POSTER_W - 40 * k);
  const lh = 34 * k;
  lines.forEach((l, i) => ctx.fillText(l, POSTER_W / 2, POSTER_H / 2 + (i - (lines.length - 1) / 2) * lh));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

function imageToTexture(img) {
  const c = document.createElement("canvas");
  c.width = POSTER_W;
  c.height = POSTER_H;
  const ctx = c.getContext("2d");
  // recorte tipo "cover" a 2:3
  const target = POSTER_W / POSTER_H;
  const ir = img.naturalWidth / img.naturalHeight;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  let sx = 0;
  let sy = 0;
  if (ir > target) {
    sw = sh * target;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = sw / target;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, POSTER_W, POSTER_H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

const POSTER_TIMEOUT = 12000; // ms por intento
const POSTER_ATTEMPTS = 3;    // intentos por póster (el 2º y 3º evitan una copia en caché sin CORS)

function posterSrc(url, n) {
  if (!n) return url;
  return url + (url.includes("?") ? "&" : "?") + "r3d=" + n;
}

function tryLoadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // WebGL exige CORS
    img.decoding = "async";
    const timer = setTimeout(() => {
      img.onload = img.onerror = null;
      img.src = "";
      reject(new Error("timeout"));
    }, POSTER_TIMEOUT);
    img.onload = () => {
      clearTimeout(timer);
      if (!img.naturalWidth) reject(new Error("vacía"));
      else resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("error"));
    };
    img.src = src;
  });
}

async function loadPosterImage(url) {
  for (let n = 0; n < POSTER_ATTEMPTS; n++) {
    try {
      const img = await tryLoadImage(posterSrc(url, n));
      return imageToTexture(img);
    } catch (_) {
      await new Promise((r) => setTimeout(r, 400 * (n + 1)));
    }
  }
  return null;
}

function loadPosterTexture(url, title) {
  const key = url || "title:" + title;
  if (texCache.has(key)) return texCache.get(key);
  const p = (async () => {
    if (!url) return placeholderTexture(title);
    const tex = await loadPosterImage(url);
    if (tex) return tex;
    // Falló: no se guarda en caché, así la próxima vez se vuelve a intentar
    texCache.delete(key);
    const ph = placeholderTexture(title);
    ph.userData.placeholder = true;
    return ph;
  })();
  texCache.set(key, p);
  return p;
}

function pruneTextureCache(keepKeys) {
  if (texCache.size <= 60) return;
  for (const [k, p] of texCache) {
    if (keepKeys.has(k)) continue;
    texCache.delete(k);
    p.then((t) => t.dispose()).catch(() => {});
  }
}

// ── Texturas procedurales (sin archivos externos) ──
function addNoise(g, w, h, amp) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amp;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

// ── Mesa de ruleta de casino ──
const TABLE = { cx: 5.75, hw: 14.75, hd: 8.5, r: 3.2, rail: 1.0, feltY: -0.2 };
const BOARD_DZ = -1.5; // desplazamiento del tablero hacia arriba (negativo = más arriba / más cerca de la rueda)
const LAYOUT = { x0: 6.6, z0: 0.3 + BOARD_DZ, zeroW: 1.0, colW: 0.78, rowH: 1.0, dozH: 0.8, outH: 0.8, twoW: 1.0 };
const RED_NUMS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function spacedText(g, text, x, y, spacing) {
  let w = 0;
  for (const ch of text) w += g.measureText(ch).width + spacing;
  w -= spacing;
  let cx = x - w / 2;
  g.textAlign = "left";
  for (const ch of text) {
    g.fillText(ch, cx, y);
    cx += g.measureText(ch).width + spacing;
  }
}

// Paño verde con el tablero de apuestas dibujado encima (vista desde arriba: z mínimo = arriba del canvas)
function tableFeltTexture(cssColor) {
  const CW = 2048;
  const PPU = CW / (2 * TABLE.hw);
  const CH = Math.round(2 * TABLE.hd * PPU);
  const c = document.createElement("canvas");
  c.width = CW;
  c.height = CH;
  const g = c.getContext("2d");
  const X = (x) => (x - (TABLE.cx - TABLE.hw)) * PPU;
  const Z = (z) => (z + TABLE.hd) * PPU;

  g.fillStyle = cssColor;
  g.fillRect(0, 0, CW, CH);
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * CW;
    const y = Math.random() * CH;
    const r = 40 + Math.random() * 120;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, Math.random() < 0.5 ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.035)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  addNoise(g, CW, CH, 24);

  // sombra suave alrededor del tazón y viñeta hacia los bordes
  const sg = g.createRadialGradient(X(0), Z(0), 5.2 * PPU, X(0), Z(0), 7.8 * PPU);
  sg.addColorStop(0, "rgba(0,0,0,0.55)");
  sg.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = sg;
  g.fillRect(0, 0, CW, CH);
  const vg = g.createRadialGradient(X(TABLE.cx), Z(0), 6 * PPU, X(TABLE.cx), Z(0), 17 * PPU);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.45)");
  g.fillStyle = vg;
  g.fillRect(0, 0, CW, CH);

  // líneas doradas alrededor de la rueda
  // los aros terminan justo en el marco del tablero (sin cruzarlo ni quedar paralelos a él)
  g.save();
  g.beginPath();
  g.rect(0, 0, X(LAYOUT.x0 - 0.3), CH);
  g.clip();
  g.strokeStyle = "rgba(212,175,55,0.7)";
  g.lineWidth = 3;
  g.beginPath();
  g.arc(X(0), Z(0), 6.4 * PPU, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "rgba(212,175,55,0.38)";
  g.lineWidth = 2;
  g.beginPath();
  g.arc(X(0), Z(0), 6.75 * PPU, 0, Math.PI * 2);
  g.stroke();
  g.restore();

  // ── Tablero de apuestas ──
  const L = LAYOUT;
  const LINE = "rgba(240,230,200,0.9)";
  const cell = (x, z, w, h, fill, label, fs) => {
    if (fill) {
      g.fillStyle = fill;
      g.fillRect(X(x), Z(z), w * PPU, h * PPU);
    }
    g.strokeStyle = LINE;
    g.lineWidth = 3;
    g.strokeRect(X(x), Z(z), w * PPU, h * PPU);
    if (label) {
      g.fillStyle = "#fff";
      g.font = "700 " + (fs || 0.44) * PPU + "px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(label, X(x + w / 2), Z(z + h / 2) + 2);
    }
  };
  const gx = L.x0 + L.zeroW;
  const gz = L.z0;
  const totalW = L.zeroW + 12 * L.colW + L.twoW;
  const totalH = 3 * L.rowH + L.dozH + L.outH;

  // marco dorado alrededor del tablero
  g.strokeStyle = "rgba(212,175,55,0.75)";
  g.lineWidth = 4;
  g.strokeRect(X(L.x0 - 0.3), Z(gz - 0.3), (totalW + 0.6) * PPU, (totalH + 0.6) * PPU);

  cell(L.x0, gz, L.zeroW, 3 * L.rowH, "rgba(255,255,255,0.05)", "0", 0.7);
  for (let col = 0; col < 12; col++) {
    for (let row = 0; row < 3; row++) {
      const n = 3 * col + 3 - row;
      cell(gx + col * L.colW, gz + row * L.rowH, L.colW, L.rowH, RED_NUMS.has(n) ? "#a8141c" : "#101010", String(n), 0.46);
    }
  }
  for (let row = 0; row < 3; row++) cell(gx + 12 * L.colW, gz + row * L.rowH, L.twoW, L.rowH, null, "2:1", 0.36);
  const dz = gz + 3 * L.rowH;
  ["1-12", "13-24", "25-36"].forEach((t, i) => cell(gx + i * 4 * L.colW, dz, 4 * L.colW, L.dozH, null, t, 0.42));
  const oz = dz + L.dozH;
  const w2 = 2 * L.colW;
  ["1-18", "PAR", "", "", "IMPAR", "19-36"].forEach((t, i) => cell(gx + i * w2, oz, w2, L.outH, null, t, 0.38));
  [["#c1121c", 2], ["#0b0b0b", 3]].forEach(([col, i]) => {
    const cxm = X(gx + i * w2 + w2 / 2);
    const cym = Z(oz + L.outH / 2);
    const dw = 0.5 * PPU;
    const dh = 0.3 * PPU;
    g.fillStyle = col;
    g.strokeStyle = "rgba(240,230,200,0.85)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cxm, cym - dh);
    g.lineTo(cxm + dw, cym);
    g.lineTo(cxm, cym + dh);
    g.lineTo(cxm - dw, cym);
    g.closePath();
    g.fill();
    g.stroke();
  });

  // rótulo dorado detrás del tablero
  const midX = X(L.x0 + totalW / 2);
  const gold = g.createLinearGradient(0, Z(-4.3), 0, Z(-2.7));
  gold.addColorStop(0, "#f7e08a");
  gold.addColorStop(0.5, "#d4af37");
  gold.addColorStop(1, "#8a6a14");
  g.fillStyle = gold;
  g.textBaseline = "middle";
  g.font = "700 " + 0.78 * PPU + "px Georgia, 'Times New Roman', serif";
  g.shadowColor = "rgba(0,0,0,0.6)";
  g.shadowBlur = 6;
  spacedText(g, "RULETA DE PELÍCULAS", midX, Z(-3.5), 0.12 * PPU);
  g.font = "700 " + 0.4 * PPU + "px Georgia, serif";
  spacedText(g, "★  ★  ★", midX, Z(-2.5), 0.2 * PPU);
  g.shadowBlur = 0;
  g.strokeStyle = "rgba(212,175,55,0.5)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(X(L.x0 + 0.5), Z(-4.4));
  g.lineTo(X(L.x0 + totalW - 0.5), Z(-4.4));
  g.moveTo(X(L.x0 + 0.5), Z(-2.1));
  g.lineTo(X(L.x0 + totalW - 0.5), Z(-2.1));
  g.stroke();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

function chipTexture(color) {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.fillStyle = color;
  g.fillRect(0, 0, S, S);
  g.fillStyle = "rgba(255,255,255,0.92)";
  for (let i = 0; i < 8; i++) {
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate((i * Math.PI) / 4);
    g.fillRect(-8, -S / 2, 16, 22);
    g.restore();
  }
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = 3;
  g.beginPath();
  g.arc(S / 2, S / 2, 38, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Alfombra oscura con motivo de rombos dorados muy tenue
function carpetTexture() {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.fillStyle = "#2b0b10";
  g.fillRect(0, 0, S, S);
  g.strokeStyle = "rgba(200,150,60,0.20)";
  g.lineWidth = 2;
  const step = 64;
  for (let i = -S; i <= S * 2; i += step) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + S, S);
    g.moveTo(i + S, 0);
    g.lineTo(i, S);
    g.stroke();
  }
  g.fillStyle = "rgba(200,150,60,0.16)";
  for (let y = 0; y <= S; y += step) {
    for (let x = 0; x <= S; x += step) {
      g.beginPath();
      g.moveTo(x, y - 7);
      g.lineTo(x + 7, y);
      g.lineTo(x, y + 7);
      g.lineTo(x - 7, y);
      g.closePath();
      g.fill();
    }
  }
  addNoise(g, S, S, 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(30, 30);
  t.anisotropy = MAX_ANISO;
  return t;
}

// Telón del salón: cortinas de terciopelo con luces desenfocadas entre ellas
// Tablones de madera oscura para el suelo del salón (como el del video)
function plankTexture() {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  const N = 8;
  const ph = S / N;
  for (let i = 0; i < N; i++) {
    const y = i * ph;
    g.fillStyle = "hsl(" + (20 + Math.random() * 8) + "," + (38 + Math.random() * 12) + "%," + (12 + Math.random() * 8) + "%)";
    g.fillRect(0, y, S, ph);
    for (let j = 0; j < 16; j++) {
      const y0 = y + Math.random() * ph;
      const amp = 0.6 + Math.random() * 2;
      const ph0 = Math.random() * 6.28;
      const f = 0.01 + Math.random() * 0.02;
      g.strokeStyle = Math.random() < 0.6 ? "rgba(10,4,1," + (0.12 + Math.random() * 0.22) + ")" : "rgba(190,120,60," + (0.04 + Math.random() * 0.1) + ")";
      g.lineWidth = 0.6 + Math.random() * 1.6;
      g.beginPath();
      for (let x = 0; x <= S; x += 8) {
        const yy = Math.min(y + ph - 2, Math.max(y + 2, y0 + Math.sin(x * f + ph0) * amp));
        if (x === 0) g.moveTo(x, yy);
        else g.lineTo(x, yy);
      }
      g.stroke();
    }
    g.fillStyle = "rgba(0,0,0,0.75)"; // junta entre tablones
    g.fillRect(0, y, S, 2);
    g.fillRect(Math.random() * S, y, 2, ph); // junta de testa
  }
  addNoise(g, S, S, 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(22, 22);
  t.anisotropy = MAX_ANISO;
  return t;
}

// ── Cielo de las ventanas: hora y clima reales (los publica weather.js en window.ccWeather) ──
const _rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const _lerpC = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const _css = (c, a) => "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + (a === undefined ? 1 : a) + ")";
const _seeded = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const SKY_COLORS = {
  night: ["#050820", "#1b1a48", "#5a3040"].map(_rgb),
  day: ["#2f7fd6", "#6fb2ee", "#cfe8ff"].map(_rgb),
  dusk: ["#2b2f78", "#c0587a", "#ffb060"].map(_rgb),
  nightGrey: ["#0e1018", "#171a25", "#262836"].map(_rgb),
  dayGrey: ["#7f8a98", "#a0a9b5", "#c3c9d1"].map(_rgb),
};
// Convierte window.ccWeather (o, sin él, la hora del equipo y cielo despejado) en el estado del cielo
function skyState(w, nowMs) {
  const num = (v) => typeof v === "number" && isFinite(v);
  let m;
  if (w && num(w.localMin)) m = w.localMin + (nowMs - (w.at || nowMs)) / 60000;
  else {
    const d = new Date(nowMs);
    m = d.getHours() * 60 + d.getMinutes();
  }
  m = ((m % 1440) + 1440) % 1440;
  const sr = w && num(w.sunriseMin) ? w.sunriseMin : 7 * 60;
  const ss = w && num(w.sunsetMin) ? w.sunsetMin : 19 * 60;
  const e = Math.min(m - sr, ss - m); // minutos al borde del día más cercano (negativo = de noche)
  const L = clamp01((e + 30) / 70); // 0 = noche cerrada, 1 = día pleno
  const dusk = clamp01(1 - Math.abs(e - 5) / 45); // pico en el amanecer/atardecer
  const dayLen = Math.max(60, ss - sr);
  const fDay = (m - sr) / dayLen;
  const fNight = ((m - ss + 1440) % 1440) / Math.max(60, 1440 - dayLen);
  const code = w && num(w.code) ? w.code : 0;
  let cat = "clear";
  if (code >= 95) cat = "storm";
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) cat = "snow";
  else if (code === 45 || code === 48) cat = "fog";
  else if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) cat = "rain";
  else if (code >= 51 && code <= 57) cat = "drizzle";
  else if (code === 3) cat = "overcast";
  else if (code === 2) cat = "partly";
  if ((cat === "clear" || cat === "partly" || cat === "overcast") && w && w.rainingNow) cat = "rain";
  const base = { clear: 0.06, partly: 0.45, overcast: 0.92, fog: 0.8, drizzle: 0.88, rain: 0.96, snow: 0.92, storm: 1 }[cat];
  let cover = w && num(w.cloud) ? clamp01(w.cloud / 100) : base;
  if (cat !== "clear" && cat !== "partly") cover = Math.max(cover, base * 0.95);
  const precip = w && num(w.precip) ? w.precip : 0;
  let rain = 0;
  if (cat === "drizzle") rain = 0.25;
  else if (cat === "rain") rain = precip >= 2.5 || code === 65 || code === 67 || code === 82 ? 1 : precip >= 0.6 ? 0.65 : 0.5;
  else if (cat === "storm") rain = 1;
  const snow = cat === "snow" ? (w && num(w.snowfall) && w.snowfall > 0.5 ? 1 : 0.6) : 0;
  const fog = cat === "fog" ? 1 : 0;
  const sig = [cat, rain, snow, Math.round(m / 10), Math.round(cover * 5)].join("|");
  return { m, L, dusk, fDay, fNight, cat, cover, rain, snow, fog, storm: cat === "storm", sig };
}

function wallTexture(sky) {
  const W = 4096;
  const H = 1024;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0a0406");
  bg.addColorStop(0.5, "#1c0b0e");
  bg.addColorStop(1, "#050203");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  const SEC = 512; // ancho de cada tramo de pared entre columnas
  const COLW = 40; // ancho de la columna
  const NSEC = W / SEC;
  const curtainTop = Math.round(H * 0.12);
  const wy = Math.round(H * 0.74); // arriba del zócalo de madera
  const gold = "rgba(212,175,55,";

  for (let sec = 0; sec < NSEC; sec++) {
    const x0 = sec * SEC + COLW / 2;
    const x1 = (sec + 1) * SEC - COLW / 2;
    // cortina de terciopelo con pliegues continuos
    const pleat = 30 + (sec % 3) * 3;
    for (let x = Math.floor(x0); x < x1; x++) {
      const u = (x - x0) / (x1 - x0);
      const fold = 0.5 + 0.5 * Math.sin(((x - x0) / pleat) * Math.PI * 2 + sec * 1.3);
      const edge = 0.55 + 0.45 * Math.min(1, Math.min(u, 1 - u) * 9);
      const k = (0.22 + 0.78 * Math.pow(fold, 1.3)) * edge;
      g.fillStyle = "rgb(" + Math.round(152 * k) + "," + Math.round(16 * k) + "," + Math.round(30 * k) + ")";
      g.fillRect(x, curtainTop, 1.5, wy - curtainTop + 4);
    }
    // sombra vertical de la cortina: oscura arriba y abajo, más viva al centro
    const vg = g.createLinearGradient(0, curtainTop, 0, wy);
    vg.addColorStop(0, "rgba(0,0,0,0.65)");
    vg.addColorStop(0.3, "rgba(0,0,0,0.2)");
    vg.addColorStop(0.65, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.4)");
    g.fillStyle = vg;
    g.fillRect(x0, curtainTop, x1 - x0, wy - curtainTop + 4);
    // cenefa festoneada con flecos dorados
    g.fillStyle = "rgb(62,8,16)";
    g.fillRect(x0, 0, x1 - x0, curtainTop);
    for (let x = x0; x < x1 - 1; x += 64) {
      const w = Math.min(64, x1 - x);
      g.fillStyle = "rgb(112,13,26)";
      g.beginPath();
      g.ellipse(x + w / 2, curtainTop, w / 2, 34, 0, 0, Math.PI);
      g.fill();
      g.strokeStyle = gold + "0.75)";
      g.lineWidth = 3;
      g.stroke();
    }
    // zócalo de madera con paneles
    g.fillStyle = "rgb(40,21,11)";
    g.fillRect(x0, wy, x1 - x0, H - wy);
    for (let i = 0; i < 4; i++) {
      const pw = (x1 - x0 - 60) / 4;
      const px = x0 + 12 + i * (pw + 12);
      const py = wy + 34;
      const ph = H * 0.94 - py;
      const wg = g.createLinearGradient(px, py, px + pw, py + ph);
      wg.addColorStop(0, "rgb(78,42,22)");
      wg.addColorStop(1, "rgb(46,24,12)");
      g.fillStyle = wg;
      g.fillRect(px, py, pw, ph);
      g.strokeStyle = "rgba(0,0,0,0.75)";
      g.lineWidth = 3;
      g.strokeRect(px, py, pw, ph);
      g.strokeStyle = gold + "0.45)";
      g.lineWidth = 1.5;
      g.strokeRect(px + 7, py + 7, pw - 14, ph - 14);
    }
  }
  // moldura dorada entre cortina y zócalo
  g.fillStyle = gold + "0.8)";
  g.fillRect(0, wy - 2, W, 5);
  g.fillStyle = "rgba(0,0,0,0.45)";
  g.fillRect(0, wy + 3, W, 6);

  // columnas acanaladas con capitel y base dorados
  for (let sec = 0; sec < NSEC; sec++) {
    const cx = sec * SEC - COLW / 2 + (sec === 0 ? W : 0);
    for (let x = 0; x < COLW; x++) {
      const k = 0.35 + 0.65 * Math.sin((x / COLW) * Math.PI);
      const px = (sec * SEC + SEC - COLW / 2 + x) % W;
      g.fillStyle = "rgb(" + Math.round(70 * k + 14) + "," + Math.round(40 * k + 9) + "," + Math.round(16 * k + 5) + ")";
      g.fillRect(px, 0, 1.5, H);
      if (x % 7 === 3) {
        g.fillStyle = gold + "0.28)";
        g.fillRect(px, curtainTop, 1.5, H - curtainTop);
      }
    }
    const gx = (sec * SEC + SEC - COLW / 2 - 4) % W;
    g.fillStyle = gold + "0.85)";
    g.fillRect(gx, curtainTop - 10, COLW + 8, 12);
    g.fillRect(gx, wy - 8, COLW + 8, 10);
    void cx;
  }

  // manchas de luz cálida sobre la cortina (apliques del salón)
  g.globalCompositeOperation = "lighter";
  const cols = ["255,196,110", "255,140,80", "255,226,170", "255,110,110"];
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * W;
    const y = H * (0.22 + Math.random() * 0.42);
    const r = 50 + Math.random() * 110;
    const col = cols[Math.floor(Math.random() * cols.length)];
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(" + col + "," + (0.1 + Math.random() * 0.14) + ")");
    gr.addColorStop(1, "rgba(" + col + ",0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.globalCompositeOperation = "source-over";
  addNoise(g, W, H, 9);

  const sh = g.createLinearGradient(0, 0, 0, H);
  sh.addColorStop(0, "rgba(0,0,0,0.55)");
  sh.addColorStop(0.3, "rgba(0,0,0,0)");
  sh.addColorStop(0.85, "rgba(0,0,0,0.1)");
  sh.addColorStop(1, "rgba(0,0,0,0.85)");
  g.fillStyle = sh;
  g.fillRect(0, 0, W, H);

  // ── Aberturas para que el salón no se sienta cerrado: ventanas, pasillos y una puerta ──
  const rnd = (a, b) => a + Math.random() * (b - a);
  const yFloor = Math.round(H * 0.982); // el suelo de la escena queda justo aquí
  const arch = (xa, xb, yTop, yBot) => {
    // el lienzo está estirado (más píxeles a lo ancho que a lo alto): el arco usa una elipse 2:1
    const r = (xb - xa) / 2;
    const ry = r / 2;
    g.beginPath();
    g.moveTo(xa, yBot);
    g.lineTo(xa, yTop + ry);
    g.ellipse((xa + xb) / 2, yTop + ry, r, ry, 0, Math.PI, Math.PI * 2);
    g.lineTo(xb, yBot);
    g.closePath();
  };
  const frame = (xa, xb, yTop, yBot, lw) => {
    arch(xa, xb, yTop, yBot);
    g.lineWidth = lw;
    g.strokeStyle = gold + "0.95)";
    g.stroke();
    g.lineWidth = lw * 0.35;
    g.strokeStyle = "rgba(0,0,0,0.55)";
    g.stroke();
  };
  const glowAt = (x, y, r, col, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(" + col + "," + a + ")");
    gr.addColorStop(1, "rgba(" + col + ",0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  const poly = (pts, fill) => {
    g.beginPath();
    pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };

  // ventana arqueada: el cielo sigue la hora y el clima (sol, luna, nubes, lluvia, nieve, niebla)
  const drawWindow = (xa, xb, S, idx) => {
    const rand = _seeded(9100 + idx * 131);
    const rr = (a, b) => a + rand() * (b - a);
    const yTop = Math.round(H * 0.4);
    const yBot = wy - 6;
    const hgt = yBot - yTop;
    const wid = xb - xa;
    const { L, dusk, cover } = S;
    const SC = SKY_COLORS;
    const skyCol = (i) => {
      let col = _lerpC(_lerpC(SC.night[i], SC.day[i], L), SC.dusk[i], dusk * 0.8);
      let grey = _lerpC(SC.nightGrey[i], SC.dayGrey[i], L);
      grey = _lerpC(grey, SC.dusk[i], dusk * 0.25);
      col = _lerpC(col, grey, Math.pow(cover, 0.8) * 0.92);
      if (S.storm) col = col.map((v) => v * 0.62);
      return col;
    };
    g.save();
    arch(xa, xb, yTop, yBot);
    g.clip();
    const sk = g.createLinearGradient(0, yTop, 0, yBot);
    sk.addColorStop(0, _css(skyCol(0)));
    sk.addColorStop(0.55, _css(skyCol(1)));
    sk.addColorStop(1, _css(skyCol(2)));
    g.fillStyle = sk;
    g.fillRect(xa, yTop, wid, hgt);

    // estrellas
    if (L < 0.55) {
      const a = (1 - L / 0.55) * (1 - cover);
      for (let i = 0; i < 45; i++) {
        g.fillStyle = "rgba(255,255,255," + rr(0.3, 0.9) * a + ")";
        g.fillRect(rr(xa, xb), rr(yTop, yTop + hgt * 0.55), 2, 1);
      }
    }
    // sol
    if (S.fDay >= 0 && S.fDay <= 1 && L > 0.1) {
      const sx = xa + wid * (0.14 + 0.72 * S.fDay);
      const sy = yBot - hgt * (0.1 + 0.7 * Math.sin(Math.PI * S.fDay));
      const vis = (1 - cover * 0.88) * clamp01(L * 2);
      const sc = _lerpC([255, 246, 200], [255, 150, 70], clamp01(dusk * 1.2));
      g.globalCompositeOperation = "lighter";
      glowAt(sx, sy, 130, Math.round(sc[0]) + "," + Math.round(sc[1]) + "," + Math.round(sc[2]), 0.55 * vis);
      g.globalCompositeOperation = "source-over";
      g.fillStyle = _css(sc, vis);
      g.beginPath();
      g.ellipse(sx, sy, 17, 8.5, 0, 0, Math.PI * 2);
      g.fill();
    }
    // luna
    if (L < 0.6) {
      const mx = xa + wid * (0.14 + 0.72 * S.fNight);
      const my = yBot - hgt * (0.1 + 0.7 * Math.sin(Math.PI * S.fNight));
      const vis = (1 - L / 0.6) * (1 - cover * 0.9);
      g.globalCompositeOperation = "lighter";
      glowAt(mx, my, 70, "210,225,255", 0.5 * vis);
      g.globalCompositeOperation = "source-over";
      g.fillStyle = "rgba(238,243,255," + vis + ")";
      g.beginPath();
      g.ellipse(mx, my, 15, 7.5, 0, 0, Math.PI * 2);
      g.fill();
    }
    // nubes
    if (cover > 0.12) {
      const dark = S.storm ? 0.45 : S.rain > 0 || S.snow > 0 ? 0.7 : 1;
      let cc = _lerpC([40, 46, 66], [250, 252, 255], L);
      cc = _lerpC(cc, [255, 190, 150], dusk * 0.45);
      cc = cc.map((v) => v * (S.rain > 0 ? 0.62 + 0.38 * dark : dark));
      const n = Math.round(cover * 16);
      for (let i = 0; i < n; i++) {
        const cx = rr(xa - 20, xb + 20);
        const cy = rr(yTop + 10, yBot - hgt * 0.22);
        const r = rr(40, 95);
        g.save();
        g.translate(cx, cy);
        g.scale(1, 0.45);
        const cg = g.createRadialGradient(0, 0, 0, 0, 0, r);
        cg.addColorStop(0, _css(cc, 0.6 * Math.min(1, cover + 0.2)));
        cg.addColorStop(1, _css(cc, 0));
        g.fillStyle = cg;
        g.fillRect(-r, -r, r * 2, r * 2);
        g.restore();
      }
      if (cover > 0.8) {
        const og = g.createLinearGradient(0, yTop, 0, yBot);
        og.addColorStop(0, _css(cc, 0.55));
        og.addColorStop(0.65, _css(cc, 0));
        g.fillStyle = og;
        g.fillRect(xa, yTop, wid, hgt);
      }
      if (S.storm) {
        g.globalCompositeOperation = "lighter";
        for (let i = 0; i < 2; i++) glowAt(rr(xa + 40, xb - 40), rr(yTop + 40, yTop + hgt * 0.4), 90, "190,205,255", 0.3);
        g.globalCompositeOperation = "source-over";
      }
    }
    // ciudad
    const horizon = skyCol(2);
    for (let x = xa - 10; x < xb; ) {
      const bw = rr(14, 34);
      const bh = rr(18, 110);
      let bc = _lerpC([rr(6, 16), rr(6, 14), rr(14, 28)], [rr(60, 80), rr(72, 92), rr(92, 112)], L);
      bc = _lerpC(bc, horizon, clamp01(S.fog * 0.7 + cover * 0.22 * L));
      g.fillStyle = _css(bc);
      g.fillRect(x, yBot - bh, bw, bh + 2);
      if (L < 0.8) {
        const la = 1 - L / 0.8;
        for (let k = 0; k < bh / 9; k++) {
          if (rand() < 0.55) {
            g.fillStyle = rand() < 0.8 ? "rgba(255,206,120," + 0.85 * la + ")" : "rgba(160,200,255," + 0.8 * la + ")";
            g.fillRect(x + rr(2, bw - 5), yBot - rr(4, bh - 2), 3, 2);
          }
        }
      }
      x += bw + rr(0, 4);
    }
    // niebla
    if (S.fog > 0) {
      const fg = g.createLinearGradient(0, yTop, 0, yBot);
      const fc = _lerpC([40, 44, 54], [214, 218, 224], L);
      fg.addColorStop(0, _css(fc, 0.35));
      fg.addColorStop(1, _css(fc, 0.8));
      g.fillStyle = fg;
      g.fillRect(xa, yTop, wid, hgt);
    }
    // lluvia: rayas largas y gruesas (el lienzo está estirado), gotas y chorros en el vidrio
    if (S.rain > 0) {
      g.fillStyle = "rgba(0,0,0," + 0.1 * S.rain + ")";
      g.fillRect(xa, yTop, wid, hgt);
      const lc = _lerpC([170, 190, 230], [235, 245, 255], L);
      g.lineCap = "round";
      const n = Math.round(60 + 200 * S.rain);
      for (let i = 0; i < n; i++) {
        const x = rr(xa - 20, xb + 20);
        const y = rr(yTop - 20, yBot);
        const len = rr(28, 62);
        g.strokeStyle = _css(lc, rr(0.25, 0.6));
        g.lineWidth = rr(1.6, 3);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - len * 0.22, y + len);
        g.stroke();
      }
      for (let i = 0; i < Math.round(26 * S.rain); i++) {
        const x = rr(xa + 6, xb - 6);
        const y = rr(yTop + 20, yBot - 14);
        g.fillStyle = _css(lc, 0.5);
        g.beginPath();
        g.ellipse(x, y, 3.4, 2, 0, 0, Math.PI * 2);
        g.fill();
        if (rand() < 0.35) {
          g.strokeStyle = _css(lc, 0.4);
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + rr(-2, 2), y + rr(24, 70));
          g.stroke();
        }
      }
    }
    // nieve
    if (S.snow > 0) {
      for (let i = 0; i < Math.round(110 * S.snow); i++) {
        g.fillStyle = "rgba(255,255,255," + rr(0.55, 0.95) + ")";
        g.beginPath();
        g.ellipse(rr(xa, xb), rr(yTop, yBot), 2.6, 1.3, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    // travesaños de madera
    const cx = (xa + xb) / 2;
    g.fillStyle = "rgb(58,30,15)";
    g.fillRect(cx - 5, yTop, 10, hgt);
    g.fillRect(xa, yTop + hgt * 0.5 - 4, wid, 8);
    g.fillStyle = gold + "0.5)";
    g.fillRect(cx - 5, yTop, 2, hgt);
    g.restore();
    frame(xa, xb, yTop, yBot, 10);
    g.fillStyle = gold + "0.9)";
    g.fillRect(xa - 14, yBot, wid + 28, 12);
    g.globalCompositeOperation = "lighter";
    if (L > 0.5) glowAt(cx, yBot + 40, wid * 0.6, "255,236,200", 0.22 * L * (1 - cover * 0.6));
    else glowAt(cx, yBot + 40, wid * 0.6, "120,140,255", 0.18 * (1 - L));
    g.globalCompositeOperation = "source-over";
  };

  // pasillo en perspectiva con alfombra roja, luces de techo y apliques
  const drawHall = (xa, xb) => {
    const yTop = Math.round(H * 0.52);
    const yBot = yFloor;
    const ys = yTop + (xb - xa) / 4;
    const vx = (xa + xb) / 2;
    const vy = Math.round(H * 0.72);
    const bx0 = vx - 24;
    const bx1 = vx + 24;
    const by0 = vy - 64;
    const by1 = vy + 30;
    g.save();
    arch(xa, xb, yTop, yBot);
    g.clip();
    g.fillStyle = "rgb(18,8,6)";
    g.fillRect(xa, yTop, xb - xa, yBot - yTop);
    poly([[xa, yTop], [xb, yTop], [bx1, by0], [bx0, by0]], "rgb(40,19,12)");
    const lw = g.createLinearGradient(xa, 0, bx0, 0);
    lw.addColorStop(0, "rgb(70,35,19)");
    lw.addColorStop(1, "rgb(168,104,58)");
    poly([[xa, ys], [bx0, by0], [bx0, by1], [xa, yBot]], lw);
    const rw = g.createLinearGradient(xb, 0, bx1, 0);
    rw.addColorStop(0, "rgb(70,35,19)");
    rw.addColorStop(1, "rgb(168,104,58)");
    poly([[xb, ys], [bx1, by0], [bx1, by1], [xb, yBot]], rw);
    poly([[xa, yBot], [xb, yBot], [bx1, by1], [bx0, by1]], "rgb(46,22,12)");
    poly([[vx - 92, yBot], [vx + 92, yBot], [vx + 9, by1], [vx - 9, by1]], "rgb(124,14,28)");
    g.strokeStyle = gold + "0.7)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(vx - 92, yBot);
    g.lineTo(vx - 9, by1);
    g.moveTo(vx + 92, yBot);
    g.lineTo(vx + 9, by1);
    g.stroke();
    // fondo del pasillo: puerta doble iluminada
    const bg2 = g.createRadialGradient(vx, vy, 0, vx, vy, 60);
    bg2.addColorStop(0, "rgb(255,226,170)");
    bg2.addColorStop(1, "rgb(206,128,66)");
    g.fillStyle = bg2;
    g.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
    g.fillStyle = "rgb(84,44,22)";
    g.fillRect(bx0 + 4, by0 + 14, 18, by1 - by0 - 14);
    g.fillRect(bx1 - 22, by0 + 14, 18, by1 - by0 - 14);
    g.globalCompositeOperation = "lighter";
    glowAt(vx, vy - 10, 150, "255,200,130", 0.5);
    for (let i = 0; i < 5; i++) {
      const d = 0.12 + i * 0.18;
      const sc = 1 - d * 0.85;
      const cy = mix(ys - 4, by0, d);
      glowAt(vx, cy + 6, 70 * sc, "255,214,150", 0.8); // luces del techo
      const lx = mix(xa, bx0, d);
      const rx = mix(xb, bx1, d);
      const sy = mix(yBot * 0.52 + yTop * 0.48, vy - 10, d);
      glowAt(lx + 6, sy, 40 * sc, "255,190,110", 0.85); // apliques
      glowAt(rx - 6, sy, 40 * sc, "255,190,110", 0.85);
    }
    glowAt(vx, yBot - 30, 130, "255,150,110", 0.14); // reflejo en la alfombra
    g.globalCompositeOperation = "source-over";
    g.restore();
    frame(xa, xb, yTop, yBot, 12);
  };

  // puerta doble con montante de vidrio y apliques a los lados
  const drawDoor = (cx) => {
    // puerta grande: sus hojas son más altas que el zócalo, para que no parezca un mueble
    const xa = cx - 185;
    const xb = cx + 185;
    const yBot = yFloor;
    const yLeaf = yBot - 480;
    const yTop = yLeaf - (xb - xa) / 4 - 6;
    g.save();
    arch(xa, xb, yTop, yBot);
    g.clip();
    const tr = g.createLinearGradient(0, yTop, 0, yLeaf);
    tr.addColorStop(0, "rgb(255,226,170)");
    tr.addColorStop(1, "rgb(218,150,80)");
    g.fillStyle = tr;
    g.fillRect(xa, yTop, xb - xa, yLeaf - yTop);
    g.strokeStyle = "rgba(90,50,20,0.85)";
    g.lineWidth = 2;
    for (let i = -3; i <= 3; i++) {
      g.beginPath();
      g.moveTo(cx, yLeaf);
      g.lineTo(cx + i * 36, yTop);
      g.stroke();
    }
    for (let leaf = 0; leaf < 2; leaf++) {
      const lx = leaf ? cx + 2 : xa;
      const lw2 = leaf ? xb - cx - 2 : cx - xa - 2;
      const wg = g.createLinearGradient(lx, 0, lx + lw2, 0);
      wg.addColorStop(0, "rgb(86,46,24)");
      wg.addColorStop(1, "rgb(52,27,14)");
      g.fillStyle = wg;
      g.fillRect(lx, yLeaf, lw2, yBot - yLeaf);
      const ph = (yBot - yLeaf - 40) / 3;
      for (let k = 0; k < 2; k++) {
        const py = yLeaf + 14 + k * (ph * 1.3 + 12);
        const pH = k ? ph * 1.1 : ph * 1.3;
        g.strokeStyle = "rgba(0,0,0,0.7)";
        g.lineWidth = 3;
        g.strokeRect(lx + 12, py, lw2 - 24, pH);
        g.strokeStyle = gold + "0.5)";
        g.lineWidth = 1.5;
        g.strokeRect(lx + 18, py + 6, lw2 - 36, pH - 12);
      }
    }
    g.fillStyle = gold + "1)";
    g.beginPath();
    g.ellipse(cx - 12, yLeaf + (yBot - yLeaf) * 0.52, 6, 3, 0, 0, Math.PI * 2);
    g.ellipse(cx + 12, yLeaf + (yBot - yLeaf) * 0.52, 6, 3, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(0,0,0,0.6)";
    g.fillRect(cx - 1, yLeaf, 2, yBot - yLeaf);
    g.fillStyle = "rgba(0,0,0,0.55)"; // umbral
    g.fillRect(xa, yBot - 10, xb - xa, 10);
    g.restore();
    frame(xa, xb, yTop, yBot, 14);
    g.globalCompositeOperation = "lighter";
    for (const sx of [xa - 34, xb + 34]) {
      g.fillStyle = gold + "0.9)";
      g.fillRect(sx - 5, yLeaf + 170, 10, 26);
      glowAt(sx, yLeaf + 170, 110, "255,200,120", 0.7);
    }
    glowAt(cx, yBot - 20, 160, "255,190,120", 0.16);
    g.globalCompositeOperation = "source-over";
  };

  const kinds = ["W", "C", "H", "C", "W", "D", "C", "H"];
  const winSlots = [];
  for (let sec = 0; sec < NSEC; sec++) {
    const kind = kinds[sec % kinds.length];
    const x0 = sec * SEC + COLW / 2;
    const x1 = (sec + 1) * SEC - COLW / 2;
    const cxs = (x0 + x1) / 2;
    if (kind === "W") winSlots.push([cxs - 150, cxs + 150, sec]);
    else if (kind === "H") drawHall(cxs - 175, cxs + 175);
    else if (kind === "D") drawDoor(cxs);
  }
  // copia de la pared sin ventanas: permite repintarlas sin acumular brillos
  const baseCv = document.createElement("canvas");
  baseCv.width = W;
  baseCv.height = H;
  baseCv.getContext("2d").drawImage(c, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = MAX_ANISO;
  t.userData.paintWindows = (S) => {
    g.drawImage(baseCv, 0, 0);
    winSlots.forEach(([xa, xb, sec]) => drawWindow(xa, xb, S, sec));
    t.needsUpdate = true;
  };
  t.userData.paintWindows(sky || skyState(null, Date.now()));
  return t;
}

function roundedRectShape(cx, hw, hd, r) {
  const s = new THREE.Shape();
  const x0 = cx - hw;
  const x1 = cx + hw;
  const y0 = -hd;
  const y1 = hd;
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - r);
  s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  s.lineTo(x0 + r, y1);
  s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + r);
  s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

// Veta de madera para el tazón
function woodTexture() {
  const W = 512;
  const H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#4b2813";
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 220; i++) {
    const y0 = Math.random() * H;
    const amp = 2 + Math.random() * 6;
    const ph = Math.random() * 6.28;
    const f = 0.01 + Math.random() * 0.02;
    g.strokeStyle = Math.random() < 0.55
      ? "rgba(20,8,2," + (0.1 + Math.random() * 0.25) + ")"
      : "rgba(150,90,45," + (0.05 + Math.random() * 0.14) + ")";
    g.lineWidth = 0.6 + Math.random() * 2.6;
    g.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const y = y0 + Math.sin(x * f + ph) * amp;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  addNoise(g, W, H, 14);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  t.anisotropy = MAX_ANISO;
  return t;
}

// ── Entorno para los reflejos del metal (sin archivos externos) ──
function buildEnvironment(renderer) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#1a2233");
  g.addColorStop(0.5, "#3a2a1c");
  g.addColorStop(1, "#07080b");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = "rgba(255,240,215,0.95)"; // "softboxes"
  ctx.fillRect(60, 40, 90, 46);
  ctx.fillRect(300, 30, 120, 40);
  ctx.fillStyle = "rgba(190,215,255,0.7)";
  ctx.fillRect(210, 90, 60, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromEquirectangular(tex);
  tex.dispose();
  pmrem.dispose();
  return rt;
}

// =============================================================
// Rueda
// =============================================================
/** Precarga Three.js (para que la pantalla de carga dure menos). */
export function preload() {
  return loadThree().catch(() => {});
}

export async function createWheel(wrapper) {
  await loadThree();
  injectStyles();
  const T = THREE;

  const stage = document.createElement("div");
  stage.className = "r3d-stage";
  const canvas = document.createElement("canvas");
  canvas.className = "r3d-canvas";
  stage.appendChild(canvas);
  const titleEl = document.createElement("div");
  titleEl.className = "r3d-title";
  stage.appendChild(titleEl);
  const skipBtn = document.createElement("button");
  skipBtn.type = "button";
  skipBtn.className = "r3d-skip";
  skipBtn.textContent = "Saltar »";
  stage.appendChild(skipBtn);
  stage.dataset.state = "idle";
  wrapper.appendChild(stage);

  const renderer = new T.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  MAX_ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const extraTex = []; // texturas propias de la escena (se liberan en dispose)

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(32, 1, 0.1, 100);

  let envRT = null;
  try {
    envRT = buildEnvironment(renderer);
    scene.environment = envRT.texture;
  } catch (e) {
    console.warn("[Ruleta 3D] sin mapa de entorno:", e);
  }

  // ── Luces ──
  const ambient = new T.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);
  const key = new T.DirectionalLight(0xfff1dd, 2.0);
  key.position.set(4, 9, 6);
  scene.add(key);
  const warm = new T.PointLight(0xffb36b, 30, 0, 2);
  warm.position.set(-3.5, 5, 3);
  scene.add(warm);
  const rim = new T.DirectionalLight(0x7f9bff, 0.9);
  rim.position.set(0, 5, -8);
  scene.add(rim);

  const rMid = (R_IN + R_OUT) / 2;
  const spot = new T.SpotLight(0xfff0d8, 0, 0, 0.55, 0.7, 2);
  spot.position.set(0, 7.5, R_OUT + 3.5);
  spot.target.position.set(0, 0, rMid);
  scene.add(spot);
  scene.add(spot.target);

  // ── Materiales ──
  const woodTex = woodTexture();
  extraTex.push(woodTex);
  const wood = new T.MeshStandardMaterial({
    color: 0xffffff,
    map: woodTex,
    roughness: 0.42,
    metalness: 0.05,
    envMapIntensity: 0.6,
    bumpMap: woodTex,
    bumpScale: 0.8,
  });
  const lacquer = new T.MeshStandardMaterial({
    color: 0x7a5a48,
    map: woodTex,
    roughness: 0.32,
    metalness: 0.1,
    envMapIntensity: 0.25, // menos reflejo del entorno: antes se veía azulada
    bumpMap: woodTex,
    bumpScale: 0.6,
    side: T.DoubleSide,
  });
  const gold = new T.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.28 });
  const floorMat = new T.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.9, metalness: 0 });
  const coneMat = new T.MeshStandardMaterial({ color: 0x3a1c0c, roughness: 0.35, metalness: 0.3 });

  // ── Tazón (fijo) ──
  const lathe = (pts, mat) => {
    const geo = new T.LatheGeometry(
      pts.map(([x, y]) => new T.Vector2(x, y)),
      96
    );
    const m = new T.Mesh(geo, mat);
    m.material.side = T.DoubleSide;
    return m;
  };
  const bowl = new T.Group();
  bowl.add(
    lathe(
      [
        [0.01, -0.7],
        [R_BOWL, -0.7],
        [R_BOWL, 0.28],
        [R_BOWL - 0.12, 0.42],
        [R_BOWL - 0.42, 0.42],
        [R_BOWL - 0.5, 0.3],
      ],
      wood
    )
  );
  bowl.add(
    lathe(
      [
        [R_BOWL - 0.5, 0.3],
        [R_OUT + 0.12, 0.03],
      ],
      lacquer
    )
  );
  const rimRing = new T.Mesh(new T.TorusGeometry(R_BOWL - 0.27, 0.05, 12, 96), gold);
  rimRing.rotation.x = Math.PI / 2;
  rimRing.position.y = 0.42;
  bowl.add(rimRing);
  scene.add(bowl);

  // ── Mesa de ruleta: paño, borde de madera, faldón, fichas, alfombra y salón ──
  const FY = TABLE.feltY;
  const feltTex = tableFeltTexture(TUNING.tableColor);
  extraTex.push(feltTex);
  const feltShape = roundedRectShape(TABLE.cx, TABLE.hw, TABLE.hd, TABLE.r);
  const hole = new T.Path();
  hole.absarc(0, 0, R_BOWL - 0.1, 0, Math.PI * 2, false);
  feltShape.holes.push(hole);
  const feltGeo = new T.ShapeGeometry(feltShape, 64);
  {
    const pos = feltGeo.attributes.position;
    const uv = feltGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) - (TABLE.cx - TABLE.hw)) / (2 * TABLE.hw), (pos.getY(i) + TABLE.hd) / (2 * TABLE.hd));
    }
    uv.needsUpdate = true;
  }
  const felt = new T.Mesh(
    feltGeo,
    new T.MeshStandardMaterial({ map: feltTex, roughness: 1, metalness: 0, envMapIntensity: 0.1 })
  );
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = FY;
  scene.add(felt);

  const railTex = woodTex.clone();
  railTex.repeat.set(0.12, 0.3);
  railTex.needsUpdate = true;
  extraTex.push(railTex);
  const railMat = new T.MeshStandardMaterial({
    color: 0xb08068,
    map: railTex,
    roughness: 0.4,
    metalness: 0.05,
    envMapIntensity: 0.45,
    bumpMap: railTex,
    bumpScale: 0.8,
  });
  const railShape = roundedRectShape(TABLE.cx, TABLE.hw, TABLE.hd, TABLE.r);
  railShape.holes.push(roundedRectShape(TABLE.cx, TABLE.hw - TABLE.rail, TABLE.hd - TABLE.rail, TABLE.r - 0.8));
  const RAIL_TOP = FY - 0.1 + 0.65 + 0.15;
  const rail = new T.Mesh(
    new T.ExtrudeGeometry(railShape, {
      depth: 0.65,
      bevelEnabled: true,
      bevelThickness: 0.15,
      bevelSize: 0.15,
      bevelSegments: 3,
      curveSegments: 40,
    }),
    railMat
  );
  rail.rotation.x = -Math.PI / 2;
  rail.position.y = FY - 0.1;
  scene.add(rail);
  const skirt = new T.Mesh(
    new T.ExtrudeGeometry(roundedRectShape(TABLE.cx, TABLE.hw - 0.2, TABLE.hd - 0.2, TABLE.r - 0.2), {
      depth: 5.25,
      bevelEnabled: false,
      curveSegments: 40,
    }),
    new T.MeshStandardMaterial({ color: 0x4a2a1a, map: railTex, roughness: 0.55, metalness: 0.05 })
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = FY - 0.05 - 5.25;
  scene.add(skirt);

  // portavasos dorados en el borde delantero
  const cupDark = new T.MeshStandardMaterial({ color: 0x0b0706, roughness: 0.6 });
  const cupGeo = new T.CylinderGeometry(0.27, 0.27, 0.05, 24);
  const cupRingGeo = new T.TorusGeometry(0.29, 0.035, 8, 28);
  for (let i = 0; i < 8; i++) {
    const cx = 8.2 + i * 1.5;
    const cz = TABLE.hd - TABLE.rail / 2 - 0.02;
    const cup = new T.Mesh(cupGeo, cupDark);
    cup.position.set(cx, RAIL_TOP + 0.005, cz);
    scene.add(cup);
    const ring = new T.Mesh(cupRingGeo, gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cx, RAIL_TOP + 0.03, cz);
    scene.add(ring);
  }

  // fichas
  const CHIP_COLORS = ["#c62828", "#1e5bb8", "#141414", "#2e8b57", "#ececec"];
  const chipGeo = new T.CylinderGeometry(0.3, 0.3, 0.09, 28);
  const chipMats = CHIP_COLORS.map((col) => {
    const tex = chipTexture(col);
    extraTex.push(tex);
    const face = new T.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.05 });
    return [new T.MeshStandardMaterial({ color: col, roughness: 0.45, metalness: 0.05 }), face, face];
  });
  const stack = (x, z, n, ci) => {
    for (let i = 0; i < n; i++) {
      const chip = new T.Mesh(chipGeo, chipMats[ci]);
      chip.position.set(x + (Math.random() - 0.5) * 0.04, FY + 0.045 + i * 0.09, z + (Math.random() - 0.5) * 0.04);
      chip.rotation.y = Math.random() * 6.28;
      scene.add(chip);
    }
  };
  [
    [8.2, 0.9, 4, 0],
    [9.9, 1.9, 6, 1],
    [11.5, 1.0, 3, 2],
    [13.4, 2.1, 5, 3],
    [15.2, 1.3, 7, 0],
    [16.8, 0.9, 2, 4],
    [12.3, 4.4, 5, 1],
    [14.6, 4.7, 3, 2],
    [6.0, 5.8, 8, 1],
    [6.7, 6.1, 6, 0],
    [7.4, 5.9, 5, 3],
  ].forEach((c) => stack(c[0], c[1] + BOARD_DZ, c[2], c[3]));

  // luz cálida sobre el tablero
  const tableLight = new T.PointLight(0xffd9a0, 70, 0, 2);
  tableLight.position.set(10, 9, 3);
  scene.add(tableLight);

  // salón: alfombra, telón al fondo y niebla oscura
  const carpetTex = plankTexture();
  const wallTex = wallTexture(TUNING.windowWeather ? skyState(window.ccWeather, Date.now()) : null);
  extraTex.push(carpetTex, wallTex);
  const carpet = new T.Mesh(
    new T.PlaneGeometry(160, 160),
    new T.MeshStandardMaterial({ color: 0xffffff, map: carpetTex, roughness: 0.5, metalness: 0, envMapIntensity: 0.35 })
  );
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.y = -5.5;
  scene.add(carpet);
  const wallMesh = new T.Mesh(
    new T.CylinderGeometry(48, 48, 28, 128, 1, true),
    new T.MeshBasicMaterial({ map: wallTex, side: T.BackSide, fog: false, color: 0xe8dcdc })
  );
  wallMesh.position.y = 8;
  scene.add(wallMesh);
  scene.fog = new T.Fog(0x120709, 30, 85);
  // las ventanas se actualizan cuando weather.js publica clima nuevo y cada minuto (la hora avanza)
  let skySig = TUNING.windowWeather ? skyState(window.ccWeather, Date.now()).sig : "";
  function refreshSky() {
    if (!TUNING.windowWeather || state === "spinning") return; // no se repinta a mitad de un giro
    const S = skyState(window.ccWeather, Date.now());
    if (S.sig === skySig) return;
    skySig = S.sig;
    wallTex.userData.paintWindows(S);
  }
  window.addEventListener("cc:weather", refreshSky);
  const skyTimer = setInterval(refreshSky, 60000);
  // luz de ambiente cálida: levanta el salón sin lavar la rueda
  const room = new T.HemisphereLight(0xffd2a0, 0x2a1208, 0.22);
  scene.add(room);

  // Puntero fijo (al frente, apuntando a la casilla)
  let accent = new T.Color(0xe50914);
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent-color").trim();
    if (v) accent = new T.Color(v);
  } catch (_) {}
  const pointer = new T.Mesh(
    new T.ConeGeometry(0.16, 0.45, 20),
    new T.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 0.6,
      metalness: 0.3,
      roughness: 0.35,
    })
  );
  pointer.rotation.x = -Math.PI / 2; // la punta mira hacia el centro
  pointer.position.set(0, 0.32, R_OUT + 0.28);
  pointer.visible = false; // la ganadora ya no la define la flecha: cae donde caiga la bola
  scene.add(pointer);

  // ── Rotor (gira) ──
  const rotor = new T.Group();
  scene.add(rotor);

  const floor = new T.Mesh(new T.RingGeometry(R_IN, R_OUT, 96), floorMat);
  floor.rotation.x = -Math.PI / 2;
  rotor.add(floor);

  const ringOuter = new T.Mesh(new T.TorusGeometry(R_OUT, 0.045, 10, 120), gold);
  ringOuter.rotation.x = Math.PI / 2;
  ringOuter.position.y = 0.06;
  rotor.add(ringOuter);
  const ringInner = new T.Mesh(new T.TorusGeometry(R_IN, 0.045, 10, 96), gold);
  ringInner.rotation.x = Math.PI / 2;
  ringInner.position.y = 0.06;
  rotor.add(ringInner);

  // Cono central + eje
  const cone = lathe(
    [
      [R_IN, 0.0],
      [R_IN - 0.15, 0.18],
      [1.1, 0.65],
      [0.55, 1.0],
      [0.35, 1.12],
      [0.01, 1.12],
    ],
    coneMat
  );
  rotor.add(cone);
  const spindle = new T.Mesh(new T.CylinderGeometry(0.07, 0.1, 0.8, 16), gold);
  spindle.position.y = 1.5;
  rotor.add(spindle);
  const knob = new T.Mesh(new T.SphereGeometry(0.16, 20, 14), gold);
  knob.position.y = 1.95;
  rotor.add(knob);
  for (const rotY of [0, Math.PI / 2]) {
    const arm = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.9, 10), gold);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = rotY;
    arm.position.y = 1.32;
    rotor.add(arm);
    for (const s of [-1, 1]) {
      const tip = new T.Mesh(new T.SphereGeometry(0.07, 12, 10), gold);
      tip.position.set(rotY === 0 ? 0.45 * s : 0, 1.32, rotY === 0 ? 0 : 0.45 * s);
      rotor.add(tip);
    }
  }

  // Casillas (se reconstruyen en cada setItems)
  const pocketRoot = new T.Group();
  rotor.add(pocketRoot);
  let pockets = []; // { mesh, mat, baseY }
  let buildStamp = 0;
  let currentN = 0;
  let winnerIndex = -1;

  function disposeTree(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose(); // no libera las texturas (están en caché)
    });
  }

  // ── Bola ──
  const BALL_R = TUNING.ballRadius;
  // Cel shading: la luz se reparte en 3 escalones duros (sombra, media luz, luz) y la bola lleva un contorno oscuro.
  const toonSteps = new T.DataTexture(new Uint8Array([95, 170, 255]), 3, 1, T.RedFormat);
  toonSteps.minFilter = toonSteps.magFilter = T.NearestFilter;
  toonSteps.needsUpdate = true;
  extraTex.push(toonSteps);
  const ballMat = new T.MeshToonMaterial({
    color: 0xfbfbf5,
    gradientMap: toonSteps,
    emissive: 0x2a2a2a, // evita que la sombra se vea negra sobre lo blanco
  });
  const ball = new T.Mesh(new T.SphereGeometry(BALL_R, 48, 32), ballMat);
  ball.visible = false;
  const ballOutline = new T.Mesh(
    new T.SphereGeometry(BALL_R * 1.07, 32, 20),
    new T.MeshBasicMaterial({ color: 0x0e1016, side: T.BackSide, fog: false })
  );
  ball.add(ballOutline);
  // giro de la bola sobre sí misma: rueda según lo que avanza (ver spinBall)
  const ballPrev = new T.Vector3();
  let ballPrevT = -1;
  const spinAxis = new T.Vector3();
  scene.add(ball);
  const ballLight = new T.PointLight(0xffe6bd, 0, 3.2, 2);
  scene.add(ballLight);

  const glowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,244,214,1)");
    gr.addColorStop(0.25, "rgba(255,214,150,0.55)");
    gr.addColorStop(1, "rgba(255,190,110,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    return t;
  })();
  const spriteMat = (color) =>
    new T.SpriteMaterial({
      map: glowTex,
      color,
      blending: T.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
  const glow = new T.Sprite(spriteMat(0xffffff));
  glow.material.depthTest = false; // con prueba de profundidad, la pista cortaba el halo en línea recta
  glow.renderOrder = 3;
  glow.visible = false;
  scene.add(glow);
  // destello breve donde la bola toca la pista
  const flash = new T.Sprite(spriteMat(0xff9a40));
  flash.material.depthTest = false;
  flash.renderOrder = 4;
  flash.visible = false;
  scene.add(flash);
  // destello de lente cálido pegado a la bola desde que se acerca a la pista hasta que cae a las casillas
  function updateLandFlash(t, P) {
    const k = clamp01((t - 0.5 * P.dropIn) / 0.3) * (1 - clamp01((t - (P.tB - 0.4)) / 0.4));
    if (k <= 0.01 || TUNING.dropFlareSize <= 0) {
      flash.visible = false;
      return;
    }
    flash.position.set(bA.x, bA.y + 0.1, bA.z);
    flash.visible = true;
    flash.scale.setScalar(TUNING.dropFlareSize);
    flash.material.opacity = 0.5 * k * (0.85 + 0.15 * Math.sin(t * 23));
  }
  // el halo se apaga si algo (cono, borde) tapa la bola desde la cámara
  const occRay = new T.Raycaster();
  const occDir = new T.Vector3();
  function ballOccluded(p) {
    occDir.copy(p).sub(camera.position);
    const dist = occDir.length();
    if (dist < 0.3) return false;
    occDir.multiplyScalar(1 / dist);
    occRay.set(camera.position, occDir);
    occRay.far = dist - 0.12;
    return occRay.intersectObjects([bowl, rotor], true).length > 0;
  }
  // ── Estela: dos cintas (brillo ancho + núcleo blanco) que siguen el recorrido real de la bola
  //    y se orientan siempre hacia la cámara ──
  const TRAIL_PTS = 72;
  const TRAIL_HEAD = TUNING.trailLead / (TUNING.trailLength + TUNING.trailLead); // fracción de la cinta por delante de la bola
  const ribbonTex = (() => {
    const W = 256;
    const H = 64;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const v = 1 - Math.abs((y / (H - 1)) * 2 - 1); // 1 en el centro de la cinta, 0 en los bordes
      for (let x = 0; x < W; x++) {
        const u = x / (W - 1); // 0 = punta (apenas por delante de la bola), TRAIL_HEAD = la bola, 1 = fin de la cola
        const i = (y * W + x) * 4;
        // la punta aparece de forma gradual (antes empezaba de golpe, con un corte recto delante de la bola)
        const head = u < TRAIL_HEAD ? Math.sin((u / TRAIL_HEAD) * Math.PI * 0.5) : 1;
        const tail = u < TRAIL_HEAD ? 1 : Math.pow(1 - (u - TRAIL_HEAD) / (1 - TRAIL_HEAD), 1.5);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * Math.pow(v, 1.3) * head * tail);
      }
    }
    g.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    return t;
  })();
  function makeRibbon(color) {
    const geo = new T.BufferGeometry();
    const pos = new Float32Array(TRAIL_PTS * 2 * 3);
    const uv = new Float32Array(TRAIL_PTS * 2 * 2);
    const idx = [];
    for (let i = 0; i < TRAIL_PTS; i++) {
      const u = i / (TRAIL_PTS - 1);
      uv.set([u, 0, u, 1], i * 4);
      if (i < TRAIL_PTS - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const attr = new T.BufferAttribute(pos, 3);
    attr.setUsage(T.DynamicDrawUsage);
    geo.setAttribute("position", attr);
    geo.setAttribute("uv", new T.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mat = new T.MeshBasicMaterial({
      map: ribbonTex,
      color,
      transparent: true,
      opacity: 0,
      blending: T.AdditiveBlending,
      depthWrite: false,
      side: T.DoubleSide,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new T.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 2;
    scene.add(mesh);
    return { mesh, pos, attr };
  }
  const glowRibbon = makeRibbon(new T.Color(TUNING.trailColor));
  // El color de la estela sigue al color de acento que el usuario eligió en la página (variable CSS --accent-color).
  // Se relee en cada giro, así que si lo cambia con la ruleta ya cargada, el siguiente giro ya lo usa.
  function applyTrailColor() {
    const col = glowRibbon.mesh.material.color;
    col.set(TUNING.trailColor);
    if (!TUNING.trailUseAccent) return;
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue("--accent-color").trim();
      if (v) col.set(v);
    } catch (_) { /* se queda el color por defecto */ }
  }
  applyTrailColor();
  const coreRibbon = makeRibbon(new T.Color(0xffffff));
  const trPts = Array.from({ length: TRAIL_PTS }, () => new T.Vector3());
  const trSide = new T.Vector3(0, 1, 0);
  const trTmp = new T.Vector3();
  const trTan = new T.Vector3();
  const trView = new T.Vector3();
  function hideTrail() {
    glowRibbon.mesh.visible = false;
    coreRibbon.mesh.visible = false;
  }
  const trSurf = new T.Vector3();
  const trLow = new T.Vector3();
  function setPair(r, i, p, side, hw) {
    const o = i * 6;
    r.pos[o] = p.x - side.x * hw;
    r.pos[o + 1] = p.y - side.y * hw;
    r.pos[o + 2] = p.z - side.z * hw;
    r.pos[o + 3] = p.x + side.x * hw;
    r.pos[o + 4] = p.y + side.y * hw;
    r.pos[o + 5] = p.z + side.z * hw;
  }
  function updateTrail(t, P, speed, appear) {
    const sf = clamp01((speed - 3) / 9) * appear;
    if (sf <= 0.01) {
      hideTrail();
      return;
    }
    // el largo se mide en recorrido: a poca velocidad la estela dura más tiempo, a mucha, menos
    const dur = Math.min(TUNING.trailMaxSec, TUNING.trailLength / Math.max(speed, 1));
    // la cinta arranca un poco por delante de la bola, con la punta redondeada, y se alarga hacia atrás
    const span = dur / (1 - TRAIL_HEAD);
    const t0 = t + span * TRAIL_HEAD;
    const wMul = 1 + 0.6 * (1 - smoothstep01(clamp01((t - P.dropIn) / 0.8))); // más ancha mientras cae
    for (let i = 0; i < TRAIL_PTS; i++) {
      ballAt(Math.min(P.D, Math.max(0, t0 - (span * i) / (TRAIL_PTS - 1))), trPts[i], P);
    }
    for (let i = 0; i < TRAIL_PTS; i++) {
      trTan.copy(trPts[Math.min(i + 1, TRAIL_PTS - 1)]).sub(trPts[Math.max(i - 1, 0)]);
      trView.copy(camera.position).sub(trPts[i]);
      trTmp.crossVectors(trTan, trView);
      const l = trTmp.length();
      if (l > 1e-6) trSide.copy(trTmp).multiplyScalar(1 / l); // si no, se mantiene el lado anterior
      const sp = i / (TRAIL_PTS - 1);
      let taper;
      if (sp < TRAIL_HEAD) {
        const q = (TRAIL_HEAD - sp) / TRAIL_HEAD;
        taper = Math.sqrt(Math.max(0, 1 - q * q)); // punta redonda
      } else {
        taper = 0.25 + 0.75 * Math.pow(1 - (sp - TRAIL_HEAD) / (1 - TRAIL_HEAD), 0.7);
      }
      // núcleo: de cara a la cámara y estrecho (nunca llega a cortar la superficie de la pista)
      setPair(coreRibbon, i, trPts[i], trSide, 0.5 * TUNING.trailWidth * wMul * 0.26 * (0.3 + 0.7 * taper));
      // brillo: tendido sobre la pista, siguiendo su inclinación y su curva, sin bordes cortados
      const rr = Math.hypot(trPts[i].x, trPts[i].z) || 1e-6;
      const slope = rr > 3.87 && rr < 4.8 ? 0.27 / 0.93 : 0;
      trSurf.set(trPts[i].x / rr, slope, trPts[i].z / rr).normalize();
      trLow.copy(trPts[i]);
      trLow.y -= BALL_R * 0.85;
      setPair(glowRibbon, i, trLow, trSurf, 0.5 * TUNING.trailWidth * wMul * taper);
    }
    glowRibbon.attr.needsUpdate = true;
    coreRibbon.attr.needsUpdate = true;
    glowRibbon.mesh.material.opacity = 0.9 * sf;
    coreRibbon.mesh.material.opacity = sf;
    glowRibbon.mesh.visible = true;
    coreRibbon.mesh.visible = true;
  }

  // luces desenfocadas del salón (parpadean muy suave)
  const ambience = [];
  {
    const cols = [0xffc46e, 0xff8c50, 0xffe2aa, 0x78b4ff, 0xff7a7a];
    for (let i = 0; i < 90; i++) {
      const m = new T.SpriteMaterial({
        map: glowTex,
        color: cols[Math.floor(Math.random() * cols.length)],
        blending: T.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        fog: false,
        opacity: 0,
      });
      const sp = new T.Sprite(m);
      const a = Math.random() * TWO_PI;
      const r = 24 + Math.random() * 20;
      sp.position.set(Math.cos(a) * r, 1 + Math.random() * 12, Math.sin(a) * r);
      sp.scale.setScalar(1.8 + Math.random() * 4.5);
      scene.add(sp);
      ambience.push({ m, base: 0.3 + Math.random() * 0.4, speed: 0.4 + Math.random() * 0.9, ph: Math.random() * 6.28 });
    }
  }
  function twinkle(now) {
    const t = now * 0.001;
    for (const a of ambience) a.m.opacity = a.base * (0.72 + 0.28 * Math.sin(t * a.speed + a.ph));
  }

  const R_TRACK0 = 4.62; // radio de la pista al lanzar la bola
  const R_TRACK1 = 4.2; // radio justo antes de caer
  const DROP_TAU = 0.06; // s que tarda la bola en tomar la velocidad de la pista tras tocarla (corto: es un golpe)
  const R_FINAL = 3.5; // radio donde se asienta (zona exterior de la casilla)
  const Y_REST = BALL_R + 0.03; // centro de la bola apoyada en el piso
  const Y_HOVER = BALL_R + 0.13; // sobre el borde de los separadores
  const trackY = (r) => 0.03 + clamp01((r - 3.87) / 0.93) * 0.27 + BALL_R * 0.95;

  const BASE_LIGHT = { ambient: 0.55, key: 2.0, warm: 30, rim: 0.9, room: 0.22 };
  function resetLights() {
    ambient.intensity = BASE_LIGHT.ambient;
    key.intensity = BASE_LIGHT.key;
    warm.intensity = BASE_LIGHT.warm;
    rim.intensity = BASE_LIGHT.rim;
    room.intensity = BASE_LIGHT.room;
  }

  let posterW = 1;
  let posterH = 1.5;
  let reveal = null; // { mesh, mat, p0, q0, s0, p1, q1, s1 }

  function clearReveal() {
    if (reveal) {
      scene.remove(reveal.mesh);
      reveal.mesh.geometry.dispose(); // el material es el de la casilla (se libera con ella)
      reveal = null;
    }
  }

  function hideBallFx() {
    ball.visible = false;
    ballPrevT = -1;
    glow.visible = false;
    flash.visible = false;
    ballLight.intensity = 0;
    hideTrail();
  }

  // ── Estado de animación ──
  let state = "idle"; // idle | spinning | done
  let spinInfo = null;
  let doneAt = 0;
  let spotLevel = 0;
  let endNotified = false;
  let smoothLookReady = false;

  // Casilla en forma de cuña (sector anular). El póster la rellena entera, sin deformarse:
  // la textura se proyecta plana sobre la caja de la cuña (modo "cover") y se recorta a su forma.
  function wedgeGeometry(step) {
    const h = step / 2;
    const gap = 0.04; // distancia al eje del separador
    const r0 = R_IN + 0.07;
    const r1 = R_OUT - 0.07;
    const half = (r) => h - Math.asin(Math.min(0.9, gap / r));
    const K = 6;
    const M = 6;
    const pts = [];
    for (let k = 0; k <= K; k++) {
      const r = r0 + ((r1 - r0) * k) / K;
      const ha = half(r);
      for (let m = 0; m <= M; m++) {
        const a = -ha + (2 * ha * m) / M;
        pts.push([r * Math.sin(a), r * Math.cos(a)]);
      }
    }
    let xmin = Infinity;
    let xmax = -Infinity;
    let zmin = Infinity;
    let zmax = -Infinity;
    for (const [x, z] of pts) {
      xmin = Math.min(xmin, x);
      xmax = Math.max(xmax, x);
      zmin = Math.min(zmin, z);
      zmax = Math.max(zmax, z);
    }
    const W = xmax - xmin;
    const H = zmax - zmin;
    const texAspect = POSTER_W / POSTER_H;
    const Tw = Math.max(W, H * texAspect);
    const Th = Tw / texAspect;
    const xc = (xmin + xmax) / 2;
    const zc = (zmin + zmax) / 2;
    const pos = [];
    const uv = [];
    for (const [x, z] of pts) {
      pos.push(x, 0, z);
      uv.push(0.5 + (x - xc) / Tw, 0.5 + (zc - z) / Th); // arriba del póster = hacia el centro
    }
    const idx = [];
    for (let k = 0; k < K; k++) {
      for (let m = 0; m < M; m++) {
        const a = k * (M + 1) + m;
        const b = a + 1;
        const c = a + (M + 1);
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  function setItems(items, winnerIdx, onProgress) {
    clearReveal();
    hideBallFx();
    resetLights();
    endNotified = false;
    smoothLookReady = false;
    stage.dataset.state = "idle";
    ensureSpinAud();
    titleEl.textContent = (items[winnerIdx] && items[winnerIdx].title) || "";
    buildStamp++;
    const stamp = buildStamp;
    while (pocketRoot.children.length) {
      const ch = pocketRoot.children[0];
      pocketRoot.remove(ch);
      disposeTree(ch);
    }
    pockets = [];
    const N = items.length;
    currentN = N;
    winnerIndex = winnerIdx;
    state = "idle";
    spinInfo = null;
    spot.intensity = 0;
    spotLevel = 0;

    const step = TWO_PI / N;
    const arc = (TWO_PI * rMid) / N;
    const depth = R_OUT - R_IN;
    const ph = Math.min(depth * 0.92, arc * 0.9 * 1.5);
    const pw = ph / 1.5;
    posterW = pw;
    posterH = ph;
    let settledCount = 0; // pósters ya resueltos (cargados o con marcador) → progreso de la pantalla de carga
    const posterGeo = wedgeGeometry(step);
    const divGeo = new T.BoxGeometry(0.05, 0.12, depth);

    items.forEach((it, i) => {
      const phi = i * step;

      const g = new T.Group();
      g.rotation.y = phi; // +Z local = hacia afuera
      const mat = new T.MeshStandardMaterial({
        color: 0x1a1d24,
        roughness: 0.55,
        metalness: 0,
        emissive: 0x000000,
      });
      const mesh = new T.Mesh(posterGeo, mat);
      mesh.position.set(0, 0.015, 0); // la cuña ya viene acostada y con su posición real
      g.add(mesh);
      pocketRoot.add(g);
      pockets.push({ mesh, mat, baseY: 0.015, g });

      const dg = new T.Group();
      dg.rotation.y = phi + step / 2;
      const div = new T.Mesh(divGeo, gold);
      div.position.set(0, 0.06, rMid);
      dg.add(div);
      pocketRoot.add(dg);

      const loadInto = (attempt) => {
        loadPosterTexture(it.poster, it.title).then((tex) => {
          if (stamp !== buildStamp) return; // la rueda ya se rearmó
          if (attempt === 0 && onProgress) {
            settledCount++;
            try { onProgress(settledCount, N); } catch (_) { /* nada */ }
          }
          const old = mat.map;
          mat.map = tex;
          mat.emissiveMap = tex;
          mat.emissive.set(0x555555);
          mat.color.set(0xffffff);
          mat.needsUpdate = true;
          if (old && old !== tex && old.userData.placeholder) old.dispose();
          // Si el póster no cargó, se sigue reintentando en segundo plano
          if (tex.userData.placeholder && attempt < 5) {
            setTimeout(() => {
              if (stamp === buildStamp) loadInto(attempt + 1);
            }, 3000 * (attempt + 1));
          }
        });
      };
      loadInto(0);
    });

    pruneTextureCache(new Set(items.map((it) => it.poster || "title:" + it.title)));
  }

  // ── Trayectoria de la bola ─────────────────────────────────
  // Fases (t en segundos desde que se aprieta "Girar"):
  //  A) 0 → tA:   la bola corre por la pista en sentido contrario a la rueda, frenando.
  //  B) tA → tB:  cae del borde a las casillas.
  //  C) tB → D:   rebota entre casillas (en el marco de la rueda) y se asienta
  //               en la ganadora, que ya viene decidida por roulette.js.
  // Montaje de planos a los tiempos medidos sobre el audio (ver TUNING):
  //   chase  0 → chaseEndSec     caída + seguimiento pegado a la bola (toca la pista en dropInSec)
  //   inner  corte breve al cono (como en el video)
  //   top    → followStartSec    cámara cenital sobre la rueda
  //   follow followStartSec → D  último seguimiento: baja del cenital, se pega al cono siguiendo a la bola
  //                              y se acerca para verla caer a la casilla; luego la cámara rodea hasta la vista final.
  function planShots(D) {
    const sc = D / TUNING.cueRefSec;
    const tChase = TUNING.chaseEndSec * sc;
    const tFollow = Math.min(TUNING.followStartSec * sc, D - 2.5);
    const cone = TUNING.coneCutSec > 0.05 ? Math.min(TUNING.coneCutSec, (tFollow - tChase) / 3) : 0;
    const list = [{ k: "chase", t0: 0, t1: tChase, v: 0 }];
    if (cone > 0) list.push({ k: "inner", t0: tChase, t1: tChase + cone, v: 1 });
    list.push({ k: "top", t0: tChase + cone, t1: tFollow, v: 0 });
    list.push({ k: "follow", t0: tFollow, t1: D, v: 0, last: true });
    return { list, cue: { chase: tChase, topStart: tChase + cone, follow: tFollow } };
  }

  function planBall(from, to, D) {
    const step = TWO_PI / currentN;
    const Tc = TUNING.settleSec;
    const Td = TUNING.dropSec;
    const dropIn = TUNING.dropInSec;
    const tA = Math.max(2.5, D - Tc - Td - dropIn); // duración de la fase A (medida desde que aterriza)
    const tB = dropIn + tA + Td; // instante absoluto en que cae a las casillas
    const w0 = TUNING.ballSpeed;
    const w1 = TUNING.ballSpeedEnd;
    const rot = (t) => from + (to - from) * easeOutQuart(clamp01(t / D));
    const S = (t) => w1 * t + (((w0 - w1) * tA) / 3) * (1 - Math.pow(1 - t / tA, 3));
    const SA = S(tA);
    const psiEnd = (Math.random() * 2 - 1) * Math.PI; // dónde empieza a caer: al azar en toda la pista
    const psiB = psiEnd + w1 * Td * 0.825;
    const phiB = psiB - rot(tB);
    const phiF = winnerIndex * step;
    let delta = mod(phiF - phiB, TWO_PI);
    if (delta < 1.5) delta += TWO_PI;
    const rotRate = Math.abs(((to - from) * 4 * Math.pow(1 - tB / D, 3)) / D);
    const v0 = w1 * 0.65 + rotRate;
    // Perfil cúbico: arranca a ~la velocidad con la que cayó (sp) y frena suave hasta 0
    const sp = Math.min(2.9, Math.max(0.3, (v0 * Tc) / delta));
    const hops = 4 + Math.floor(Math.random() * 3);
    // Plano 0: la cámara arranca alta y fuera de la mesa; la bola sale pegada al lente y cae en diagonal
    const psiL = psiEnd - SA;
    const P0x = R_TRACK0 * Math.sin(psiL);
    const P0z = R_TRACK0 * Math.cos(psiL);
    const yL = trackY(R_TRACK0);
    const camAz = psiL - 0.7;
    const cs = new T.Vector3(
      TUNING.dropInRadius * Math.sin(camAz),
      TUNING.dropInHeight,
      TUNING.dropInRadius * Math.cos(camAz)
    );
    const lc = new T.Vector3(P0x, yL, P0z);
    const fwd0 = lc.clone().sub(cs).normalize();
    const right0 = new T.Vector3().crossVectors(fwd0, new T.Vector3(0, 1, 0)).normalize();
    const s0 = cs.clone().addScaledVector(fwd0, 0.8).addScaledVector(right0, 0.35);
    s0.y -= 0.3;
    // la bola cae con velocidad horizontal constante; al tocar la pista pasa a la de la pista sin saltos
    const tau = DROP_TAU;
    const vtx = w0 * R_TRACK0 * Math.cos(psiL);
    const vtz = -w0 * R_TRACK0 * Math.sin(psiL);
    const q = tau / dropIn;
    const Lx = (P0x + s0.x * q + vtx * tau) / (1 + q);
    const Lz = (P0z + s0.z * q + vtz * tau) / (1 + q);
    const vlx = (Lx - s0.x) / dropIn;
    const vlz = (Lz - s0.z) / dropIn;
    const drop = { s0, Lx, Lz, dvx: vlx - vtx, dvz: vlz - vtz, g: (2 * (s0.y - yL)) / (dropIn * dropIn) };
    const { list: shots, cue } = planShots(D);
    return { D, dropIn, drop, cs, lc, shots, cue, tA, tB, Td, Tc, w0, w1, psiEnd, S, SA, psiB, phiB, delta, sp, hops, rot, to, aF: phiF + to };
  }

  function ballAt(t, out, P) {
    let psi;
    let r;
    let y;
    let ex = 0;
    let ez = 0;
    if (t < P.dropIn) {
      // Fase 0: sale pegada al lente y cae en diagonal hacia donde empieza la pista, con gravedad real.
      const dr = P.drop;
      const k = t / P.dropIn;
      return out.set(
        mix(dr.s0.x, dr.Lx, k),
        dr.s0.y - 0.5 * dr.g * t * t,
        mix(dr.s0.z, dr.Lz, k)
      );
    }
    const tl = t - P.dropIn;
    if (tl <= P.tA) {
      const u = tl / P.tA;
      psi = P.psiEnd - (P.SA - P.S(tl));
      r = mix(R_TRACK0, R_TRACK1, u * u) + 0.035 * Math.sin(tl * 7.3) * (1 - u);
      // dos rebotes pequeños al aterrizar; en planta sigue girando, así que no hay salto lateral
      const d1 = 0.3;
      const d2 = 0.16;
      let bounce = 0;
      if (tl < d1) bounce = 4 * TUNING.dropInBounce * (tl / d1) * (1 - tl / d1);
      else if (tl < d1 + d2) bounce = 4 * TUNING.dropInBounce * 0.35 * ((tl - d1) / d2) * (1 - (tl - d1) / d2);
      y = trackY(r) + bounce;
      // arrastre de la caída: conserva su velocidad horizontal y la funde con la de la pista
      const dec = DROP_TAU * Math.exp(-tl / DROP_TAU);
      ex = -P.drop.dvx * dec;
      ez = -P.drop.dvz * dec;
    } else if (t <= P.tB) {
      const s = tl - P.tA;
      const v = s / P.Td;
      psi = P.psiEnd + P.w1 * (s - (0.175 * s * s) / P.Td);
      r = mix(R_TRACK1, R_FINAL, smoothstep01(v));
      y =
        Y_HOVER +
        (trackY(R_TRACK1) - Y_HOVER) * (1 - v * v) +
        0.12 * Math.sin(Math.PI * clamp01((v - 0.6) / 0.4));
    } else {
      const u = clamp01((t - P.tB) / P.Tc);
      const prog = P.sp * u + (3 - 2 * P.sp) * u * u + (P.sp - 2) * u * u * u;
      psi = P.phiB + P.delta * prog + P.rot(t);
      r = R_FINAL + 0.06 * (1 - u) * Math.sin(u * 19);
      const hop =
        TUNING.hopHeight * Math.pow(1 - u, 1.5) * Math.abs(Math.sin(Math.PI * P.hops * Math.pow(u, 1.5)));
      y = mix(Y_HOVER, Y_REST, smoothstep01(clamp01((u - 0.72) / 0.28))) + hop;
    }
    return out.set(r * Math.sin(psi) + ex, y, r * Math.cos(psi) + ez);
  }

  // Ángulo continuo (sin envolver a ±π) de la bola alrededor del eje, igual que el que usa ballAt desde que toca la pista.
  // Sirve para que la cámara de seguimiento gire con ella sin saltos al cruzar el ángulo ±π.
  function ballPsi(t, P) {
    const tl = t - P.dropIn;
    if (tl <= P.tA) return P.psiEnd - (P.SA - P.S(Math.max(0, tl)));
    if (t <= P.tB) {
      const s = tl - P.tA;
      return P.psiEnd + P.w1 * (s - (0.175 * s * s) / P.Td);
    }
    const u = clamp01((t - P.tB) / P.Tc);
    const prog = P.sp * u + (3 - 2 * P.sp) * u * u + (P.sp - 2) * u * u * u;
    return P.phiB + P.delta * prog + P.rot(t);
  }

  const bA = new T.Vector3();
  const bB = new T.Vector3();

  // La bola rueda: gira alrededor del eje perpendicular a su avance, según lo que recorre.
  // Una rodadura real a esta velocidad (decenas de vueltas por segundo) se vería como un borrón o como si girara al
  // revés, así que se escala con ballSpinRate y se limita el giro por cuadro.
  function spinBall(t) {
    if (ballPrevT >= 0 && t > ballPrevT) {
      const dx = bA.x - ballPrev.x;
      const dz = bA.z - ballPrev.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-5) {
        spinAxis.set(dz, 0, -dx).multiplyScalar(1 / d); // eje = arriba × avance
        const ang = Math.min(0.5, (d / BALL_R) * TUNING.ballSpinRate);
        ball.rotateOnWorldAxis(spinAxis, ang);
      }
    }
    ballPrev.copy(bA);
    ballPrevT = t;
  }

  function updateBall(t, P) {
    ballAt(t, bA, P);
    const appear = clamp01(t / 0.08);
    ball.visible = true;
    ball.scale.setScalar(Math.max(0.001, appear));
    ball.position.copy(bA);
    spinBall(t);
    ballLight.position.set(bA.x, bA.y + 0.35, bA.z);
    ballLight.intensity = 0.6 * appear;

    let speed = 0;
    if (t > 0.012) {
      ballAt(t - 0.012, bB, P);
      speed = bA.distanceTo(bB) / 0.012;
    }
    const sf = clamp01((speed - 6) / 14);
    glow.visible = !ballOccluded(bA);
    glow.position.copy(bA);
    glow.scale.setScalar(0.8 + 0.7 * sf);
    glow.material.opacity = (0.22 + 0.4 * sf) * appear;

    updateTrail(t, P, speed, appear);
    updateLandFlash(t, P);
  }

  function placeBallFinal(P) {
    ballAt(P.D, bA, P);
    ball.visible = true;
    ball.scale.setScalar(1);
    ball.position.copy(bA);
    ballLight.position.set(bA.x, bA.y + 0.35, bA.z);
    ballLight.intensity = 0.35;
    glow.visible = false;
    hideTrail();
  }

  // ── Cámara cinematográfica ─────────────────────────────────
  const BASE_FOV = 32;
  const camBase = { pos: new T.Vector3(), look: new T.Vector3(0, 0.2, 0.3) };
  const cPos = new T.Vector3();
  const cLook = new T.Vector3();
  const cBall = new T.Vector3();
  const cPocket = new T.Vector3();
  const cV = new T.Vector3();
  const cChase = new T.Vector3();
  const cDrop = new T.Vector3();
  const cDropLook = new T.Vector3();
  const cAhead = new T.Vector3();
  const cTop = new T.Vector3();
  const cInner = new T.Vector3();
  const cTopLook = new T.Vector3();
  const cAheadD = new T.Vector3();
  const cAccP = new T.Vector3();
  const cAccL = new T.Vector3();
  const cTmp = new T.Vector3();
  const cTmp2 = new T.Vector3();
  const SHOT_BLEND = 0.18; // s de fundido entre planos
  const smoothLook = new T.Vector3();

  function setCamera(pos, look, fov, roll) {
    camera.position.copy(pos);
    camera.lookAt(look);
    if (roll) camera.rotateZ(roll);
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  function camPoses() {
    const portrait = (camera.aspect || 1) < 0.9;
    return portrait
      ? { k: 1.35, fovAdd: 8, rev: { r: 6.4, h: 4.6, fov: 32 } }
      : { k: 1, fovAdd: 0, rev: { r: 5.5, h: 3.5, fov: 30 } };
  }

  function pocketWorld(t, P, out) {
    const ang = winnerIndex * (TWO_PI / currentN) + P.rot(t);
    return out.set(rMid * Math.sin(ang), 0.1, rMid * Math.cos(ang));
  }

  const wrapPi = (a) => mod(a + Math.PI, TWO_PI) - Math.PI;

  // El foco ilumina la casilla ganadora esté donde esté
  function aimSpot(t, P) {
    const ang = winnerIndex * (TWO_PI / currentN) + P.rot(t);
    spot.position.set(Math.sin(ang) * (R_OUT + 3.5), 7.5, Math.cos(ang) * (R_OUT + 3.5));
    spot.target.position.set(rMid * Math.sin(ang), 0, rMid * Math.cos(ang));
  }

  // Secuencia: vista general → 1) bajo, pegado a la bola → 2) cenital → 3) pegado al eje mirando a la pista
  // → al asentarse la bola, la cámara rodea la rueda y se coloca detrás de la casilla ganadora.
  function applyCinematic(t, P, dt, snap) {
    const { k, fovAdd, rev } = camPoses();
    const D = P.D;
    const wB = smoothstep01(clamp01(t / (P.dropIn + 0.1))); // plano 0 (alto, fuera de la mesa) baja y se acerca hasta el plano 1
    const tW = P.tB + 0.3; // la cámara empieza a rodear hacia la vista final poco después de caer a las casillas
    const w2 = smoothstep01(clamp01((t - tW) / Math.max(0.5, D - tW)));
    const cue = P.cue;
    // plano cenital (compartido con el seguimiento final para que enlacen sin salto)
    const topCam = (tt, out) => {
      const az = 0.6 + TUNING.topSpin * tt;
      const push = 1 - TUNING.topPush * smoothstep01(clamp01((tt - cue.topStart) / Math.max(0.1, cue.follow - cue.topStart)));
      return out.set(TUNING.topOffset * Math.sin(az), TUNING.topHeight * k * push, TUNING.topOffset * Math.cos(az));
    };
    ballAt(t, cBall, P);
    const azBall = Math.atan2(cBall.x, cBall.z);
    const rBall = Math.hypot(cBall.x, cBall.z);

    // posiciones y miradas de cada tipo de plano
    const azB = azBall - TUNING.chaseLag; // detrás de la bola (ella avanza hacia ángulos mayores)
    const rB = Math.max(2.2, rBall - TUNING.chaseInside);
    cChase.set(rB * Math.sin(azB), TUNING.chaseHeight, rB * Math.cos(azB));
    cDrop.copy(P.cs); // plano 0: alto y fuera de la mesa, mirando hacia donde caerá la bola
    const azD = P.psiEnd + Math.PI; // al otro lado de donde cae la bola

    // hacia dónde mira: un poco por delante de la bola (seguimiento y cono), al centro de la rueda (cenital)
    ballAt(Math.min(D, t + 0.05), cV, P);
    cV.sub(cBall);
    const len = cV.length();
    if (len > 1e-4) cV.multiplyScalar(clamp01(len / 0.2) / len);
    else cV.set(0, 0, 0);
    cAhead.copy(cBall).addScaledVector(cV, TUNING.chaseAhead);
    cAheadD.copy(cBall).addScaledVector(cV, 0.3);
    cTopLook.set(0, 0.3, 0.4).lerp(cBall, 0.25);
    cDropLook.copy(P.lc).lerp(camBase.look, 0.3).lerp(cBall, wB);

    // montaje: cada plano entra y sale con un fundido muy corto (casi corte seco, como en el video)
    const rollMax = (TUNING.camRollDeg * Math.PI) / 180;
    cAccP.set(0, 0, 0);
    cAccL.set(0, 0, 0);
    let fovA = 0;
    let rollA = 0;
    let sum = 0;
    for (const sh of P.shots) {
      const a = sh.t0 <= 0 ? 1 : smoothstep01(clamp01((t - sh.t0) / SHOT_BLEND));
      const b = sh.last ? 1 : 1 - smoothstep01(clamp01((t - sh.t1) / SHOT_BLEND));
      const w = a * b;
      if (w < 1e-4) continue;
      let fv;
      let rl;
      if (sh.k === "chase") {
        cTmp.copy(cDrop).lerp(cChase, wB);
        cTmp2.copy(cDropLook).lerp(cAhead, wB);
        fv = mix(TUNING.dropInFov, TUNING.chaseFov, wB);
        rl = mix(-0.14, rollMax, wB); // arranca inclinada, como en el video
      } else if (sh.k === "top") {
        topCam(t, cTmp);
        cTmp2.copy(cTopLook);
        fv = TUNING.topFov;
        rl = 0;
      } else if (sh.k === "follow") {
        // Último seguimiento: parte exactamente de la posición del cenital, baja en espiral hasta quedar
        // pegada al cono mirando a la bola y, al caer ésta a las casillas, se acerca para verla entrar.
        const f = smoothstep01(clamp01((t - sh.t0) / Math.max(0.1, TUNING.followSwoopSec)));
        const g = smoothstep01(clamp01((t - (P.tB - 1.0)) / 1.0));
        topCam(t, cTmp);
        // ángulo de la cámara: mezcla continua entre la órbita del cenital y "detrás de la bola".
        // El camino (a qué lado se gira) se elige una sola vez, al empezar, y después no vuelve a cambiar.
        const dAz = (tt) => ballPsi(tt, P) - TUNING.followLag - (0.6 + TUNING.topSpin * tt);
        const d0 = dAz(sh.t0);
        const az = 0.6 + TUNING.topSpin * t + (dAz(t) + (wrapPi(d0) - d0)) * f;
        const rF = mix(TUNING.topOffset, mix(TUNING.followR, TUNING.followCloseR, g), f);
        const hF = mix(cTmp.y, mix(TUNING.followH, TUNING.followCloseH, g), f);
        cTmp.set(rF * Math.sin(az), hF, rF * Math.cos(az));
        cTmp2.copy(cTopLook).lerp(cAheadD, f);
        fv = mix(TUNING.topFov, TUNING.followFov, f);
        rl = -rollMax * 0.8 * f;
      } else {
        const azI = azD + 1.1 * sh.v;
        cTmp.set(TUNING.innerR * Math.sin(azI), TUNING.innerH, TUNING.innerR * Math.cos(azI));
        cTmp2.copy(cAheadD);
        fv = TUNING.innerFov;
        rl = -rollMax * 0.8;
      }
      cAccP.addScaledVector(cTmp, w);
      cAccL.addScaledVector(cTmp2, w);
      fovA += (fv + fovAdd) * w;
      rollA += rl * w;
      sum += w;
    }
    if (sum < 1e-4) sum = 1;
    cPos.copy(cAccP).multiplyScalar(1 / sum);
    cLook.copy(cAccL).multiplyScalar(1 / sum);
    let fov = fovA / sum;
    let roll = rollA / sum;
    if (w2 > 0) {
      // del seguimiento final a la vista final: se parte de la posición que tenía la cámara en ese instante
      // y se rodea la rueda por fuera de las casillas, sin cruzar el eje
      if (!P.w2from) P.w2from = { az: Math.atan2(cPos.x, cPos.z), r: Math.hypot(cPos.x, cPos.z), h: cPos.y };
      const f0 = P.w2from;
      const azP = f0.az + wrapPi(P.aF - f0.az) * w2;
      const rP = mix(f0.r, rev.r, w2);
      const hP = mix(f0.h, rev.h, w2);
      cPos.set(rP * Math.sin(azP), hP, rP * Math.cos(azP));
      fov = mix(fov, rev.fov, w2);
      roll = mix(roll, 0, w2);
    }
    pocketWorld(t, P, cPocket);
    cLook.lerp(cPocket, smoothstep01(clamp01((t - (D - 1.7)) / 1.3)));
    if (snap || !smoothLookReady) {
      smoothLook.copy(cLook);
      smoothLookReady = true;
    } else {
      smoothLook.lerp(cLook, 1 - Math.exp(-dt / 0.045));
    }
    setCamera(cPos, smoothLook, fov, roll);
  }

  // ── Revelación: el póster ganador vuela hacia la cámara ────
  function startReveal() {
    const p = pockets[winnerIndex];
    if (!p) return;
    // Póster rectangular 2:3 que "sale" de la casilla (la cuña se queda en su sitio)
    const m = new T.Mesh(new T.PlaneGeometry(1, 1.5), p.mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.03, rMid);
    m.scale.setScalar(((R_OUT - R_IN) * 0.6) / 1.5);
    p.g.add(m);
    scene.updateMatrixWorld(true);
    scene.attach(m); // conserva su posición en el mundo
    camera.updateMatrixWorld(true);
    const fwd = new T.Vector3();
    camera.getWorldDirection(fwd);
    const up = new T.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const dF = 2.1;
    const viewH = 2 * dF * Math.tan((camera.fov * Math.PI) / 360);
    const viewW = viewH * (camera.aspect || 1);
    const s1 = Math.min((0.7 * viewH) / 1.5, (0.8 * viewW) / 1);
    reveal = {
      mesh: m,
      mat: p.mat,
      p0: m.position.clone(),
      q0: m.quaternion.clone(),
      s0: m.scale.x,
      p1: camera.position.clone().addScaledVector(fwd, dF).addScaledVector(up, 0.04 * viewH),
      q1: camera.quaternion.clone(),
      s1,
    };
  }

  function animateReveal(k) {
    const d = 1 - 0.6 * k;
    ambient.intensity = BASE_LIGHT.ambient * d;
    key.intensity = BASE_LIGHT.key * d;
    warm.intensity = BASE_LIGHT.warm * d;
    rim.intensity = BASE_LIGHT.rim * d;
    room.intensity = BASE_LIGHT.room * d;
    spot.intensity = TUNING.spotIntensity * (1 - k);
    if (!reveal) return;
    const m = reveal.mesh;
    m.position.lerpVectors(reveal.p0, reveal.p1, k);
    m.position.y += 0.6 * Math.sin(Math.PI * k);
    m.quaternion.copy(reveal.q0).slerp(reveal.q1, k);
    const sc = mix(reveal.s0, reveal.s1, k);
    m.scale.set(sc, sc, 1);
    const e = mix(0.09, 0.65, k);
    reveal.mat.emissive.setRGB(e, e, e);
  }

  // ── Sonido del giro ──
  // ── Sonido de la bola, generado en el navegador (sin archivos) ──
  // Rodadura de una bola dura sobre madera (sigue la velocidad real de la bola, con un leve pulso por vuelta)
  // y "tocs" al aterrizar, al rebotar en las separaciones y entre las casillas.
  let snd = null;
  let sndEvents = [];
  let sndIdx = 0;
  let sndSuspend = 0;
  let audioWanted = false; // el sonido "debería estar sonando": evita que arranque tarde si ya nos fuimos
  function buildSound() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    const sr = ctx.sampleRate;
    // Una bola rodando sobre madera = miles de micro-golpecitos por segundo que hacen vibrar la madera.
    // Se simula con un tren de impulsos irregulares (su velocidad de lectura sigue la de la bola)
    // pasado por resonancias de madera: suena a "rrrr" de madera y no a ruido de viento o de neumático.
    const len = sr * 2;
    const nb = ctx.createBuffer(1, len, sr);
    const d = nb.getChannelData(0);
    for (let i = 0; i < 1400; i++) {
      const pos = Math.floor(Math.random() * (len - 2));
      const a = (0.3 + 0.7 * Math.random()) * (Math.random() < 0.5 ? -1 : 1);
      d[pos] += a;
      d[pos + 1] -= a * 0.5;
    }
    // Rodadura: un rumor grave y suave de la bola sobre la pista, un "shhh" que sube y baja con cada vuelta
    // y un zumbido tonal que cambia de tono con la velocidad (como una bola dando vueltas en un cuenco).
    const wl = sr * 2;
    const wn = ctx.createBuffer(1, wl, sr);
    const wd = wn.getChannelData(0);
    let lastV = 0;
    for (let i = 0; i < wl; i++) {
      lastV = lastV * 0.96 + (Math.random() * 2 - 1) * 0.2; // ruido "marrón": sin siseo agudo
      wd[i] = lastV;
    }
    const mkNoise = () => {
      const n = ctx.createBufferSource();
      n.buffer = wn;
      n.loop = true;
      n.start();
      return n;
    };
    const rollG = ctx.createGain();
    rollG.gain.value = 0;
    const soft = ctx.createBiquadFilter();
    soft.type = "lowpass";
    soft.frequency.value = 2200;
    rollG.connect(soft);
    soft.connect(master);
    const rumLP = ctx.createBiquadFilter();
    rumLP.type = "lowpass";
    rumLP.frequency.value = 300;
    rumLP.Q.value = 0.5;
    const rumG = ctx.createGain();
    rumG.gain.value = 1;
    mkNoise().connect(rumLP);
    rumLP.connect(rumG);
    rumG.connect(rollG);
    const swBP = ctx.createBiquadFilter();
    swBP.type = "bandpass";
    swBP.frequency.value = 900;
    swBP.Q.value = 0.9;
    const swG = ctx.createGain();
    swG.gain.value = 0.9;
    mkNoise().connect(swBP);
    swBP.connect(swG);
    swG.connect(rollG);
    const hum = ctx.createOscillator();
    hum.type = "sine";
    hum.frequency.value = 120;
    const hum2 = ctx.createOscillator();
    hum2.type = "triangle";
    hum2.frequency.value = 240;
    const humG = ctx.createGain();
    humG.gain.value = 0.05;
    const hum2G = ctx.createGain();
    hum2G.gain.value = 0.02;
    hum.connect(humG);
    hum2.connect(hum2G);
    humG.connect(rollG);
    hum2G.connect(rollG);
    hum.start();
    hum2.start();
    const lfo = ctx.createOscillator(); // pulso por vuelta
    lfo.frequency.value = 1;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0;
    lfo.connect(lfoG);
    lfoG.connect(rollG.gain);
    lfo.start();
    return { ctx, master, nb, rollG, rumLP, swBP, hum, hum2, lfo, lfoG, phase: 0, lastT: 0 };
  }
  function sndClick(vol, when) {
    const { ctx, master, nb } = snd;
    const src = ctx.createBufferSource();
    src.buffer = nb;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1300 + Math.random() * 1300;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.035);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(when, Math.random() * 1.5, 0.05);
    const o = ctx.createOscillator(); // el "toc" de la bola sobre la madera
    o.type = "triangle";
    o.frequency.setValueAtTime(560 + Math.random() * 280, when);
    o.frequency.exponentialRampToValueAtTime(240, when + 0.06);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.5, when);
    og.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
    o.connect(og);
    og.connect(master);
    o.start(when);
    o.stop(when + 0.07);
  }
  // Golpes del giro: aterrizaje, rebotes en la pista, traqueteo al caer a las casillas y saltitos hasta quedarse
  function buildSoundEvents(P) {
    const ev = [];
    // (sin golpes al aterrizar y rebotar en la pista: solo suena el mp3)
    const tFall = P.dropIn + P.tA;
    let t = tFall;
    for (let i = 0; t < P.tB - 0.03; i++) {
      ev.push({ t, v: 0.3 + 0.35 * ((t - tFall) / P.Td) });
      t += 0.045 + Math.random() * 0.05;
    }
    ev.push({ t: P.tB, v: 0.9 });
    for (let j = 1; j <= P.hops; j++) {
      const u = Math.pow(j / P.hops, 2 / 3);
      ev.push({ t: P.tB + u * P.Tc, v: 0.2 + 0.6 * Math.pow(1 - u, 0.8) });
    }
    return ev.sort((a, b) => a.t - b.t);
  }
  function driveSpinSound(t, P) {
    if (!snd || !audioWanted) return;
    const { ctx } = snd;
    const now = ctx.currentTime;
    const set = (param, v) => param.setTargetAtTime(v, now, 0.05);
    const tl = t - P.dropIn;
    let om = 0;
    let onTrack = 0;
    if (t < P.dropIn) {
      onTrack = 0; // cayendo por el aire: en silencio hasta tocar la pista
    } else if (tl <= P.tA) {
      const q = 1 - tl / P.tA;
      om = P.w1 + (P.w0 - P.w1) * q * q;
      onTrack = smoothstep01(clamp01(tl / 0.1));
    } else if (t <= P.tB) {
      om = P.w1;
      onTrack = 1 - 0.8 * smoothstep01(clamp01((t - (P.dropIn + P.tA)) / P.Td));
    } else {
      const u = clamp01((t - P.tB) / P.Tc);
      om = P.w1 * 0.5 * (1 - u);
      onTrack = 0.25 * (1 - u);
    }
    const r = clamp01(om / P.w0);
    const level = TUNING.spinSoundUrl ? 0 : 0.1 * onTrack * (0.35 + 0.65 * Math.pow(r, 0.8)); // suave: no tapa los golpes
    set(snd.rollG.gain, level);
    set(snd.rumLP.frequency, 220 + 380 * r);
    set(snd.swBP.frequency, 700 + 1100 * r);
    set(snd.hum.frequency, 90 + 120 * r); // el tono baja al frenar la bola
    set(snd.hum2.frequency, 2 * (90 + 120 * r));
    set(snd.lfo.frequency, Math.max(0.2, om / TWO_PI));
    set(snd.lfoG.gain, 0.4 * level);
    // un "tac" suave cada vez que la bola pasa por la misma tabla de la pista
    const dtS = Math.max(0, Math.min(0.2, t - snd.lastT));
    snd.lastT = t;
    if (onTrack > 0.5 && !TUNING.spinSoundUrl) {
      const before = Math.floor(snd.phase / TWO_PI);
      snd.phase += om * dtS;
      if (Math.floor(snd.phase / TWO_PI) > before) sndClick(0.14 * onTrack, now + 0.005);
    }
    while (sndIdx < sndEvents.length && sndEvents[sndIdx].t <= t) {
      const e = sndEvents[sndIdx++];
      if (t - e.t < 0.3) sndClick(e.v * 1.2, now + 0.005); // los golpes atrasados (pestaña oculta) se descartan
    }
  }
  // Sonido de giro (mp3): dura lo mismo que el giro (20,02 s) y suena de principio a fin, a velocidad normal,
  // pegado a la animación: arranca en el instante en que la bola empieza a caer (t = 0) y se funde al revelar la
  // ganadora. Encima de él se añaden los golpes sintetizados (aterrizaje, caída a las casillas, rebotes).
  let spinAud = null;
  let spinAudFade = 0;
  let spinAudSync = 0;
  function ensureSpinAud() {
    if (!TUNING.spinSoundUrl) return null;
    if (!spinAud) {
      spinAud = new Audio(TUNING.spinSoundUrl);
      spinAud.preload = "auto";
      spinAud.loop = false;
      spinAud.playbackRate = 1;
    }
    return spinAud;
  }
  function driveSpinFile(t) {
    const a = spinAud;
    if (!a || !audioWanted) return;
    if (a.playbackRate !== 1) a.playbackRate = 1;
    // si el audio va desfasado (carga lenta, pestaña en segundo plano), se recoloca en el instante exacto de la animación
    const nowMs = performance.now();
    const dur = isFinite(a.duration) ? a.duration : Infinity;
    if (!a.paused && a.readyState >= 2 && t < dur - 0.1 && Math.abs(a.currentTime - t) > 0.2 && nowMs - spinAudSync > 500) {
      spinAudSync = nowMs;
      try { a.currentTime = t; } catch (_) { /* aún sin metadatos */ }
    }
    a.volume = clamp01(TUNING.audioVolume * smoothstep01(clamp01(t / 0.05)));
  }
  function startSpinAudio() {
    audioWanted = true;
    const el = spinInfo ? Math.max(0, (performance.now() - spinInfo.t0) / 1000) : 0;
    try {
      const a = ensureSpinAud();
      if (a) {
        clearInterval(spinAudFade);
        a.loop = false;
        a.playbackRate = 1;
        a.volume = 0; // arranca dentro del clic (permiso del navegador) y sube en cuanto driveSpinFile lo ajusta
        try {
          const dur = isFinite(a.duration) ? a.duration : Infinity;
          a.currentTime = Math.min(el, Math.max(0, dur - 0.05)); // desde 0 s (o desde donde va la animación al volver a la pestaña)
        } catch (_) { /* aún sin metadatos */ }
        const p = a.play();
        if (p && p.then) p.then(() => { if (!audioWanted) a.pause(); }).catch(() => { /* bloqueado: sin sonido */ });
      }
    } catch (_) { /* sin sonido */ }
    if (!TUNING.sound) return;
    try {
      if (!snd) snd = buildSound();
      if (!snd) return;
      clearTimeout(sndSuspend);
      const { ctx, master } = snd;
      if (ctx.state === "suspended") ctx.resume();
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(TUNING.clickVolume, ctx.currentTime, 0.03);
      if (spinInfo && spinInfo.plan) {
        sndEvents = buildSoundEvents(spinInfo.plan);
        sndIdx = sndEvents.findIndex((e) => e.t >= el);
        if (sndIdx < 0) sndIdx = sndEvents.length;
      }
    } catch (_) { /* sin sonido */ }
  }
  function stopSpinAudio(fadeMs) {
    audioWanted = false;
    const a = spinAud;
    if (a) {
      clearInterval(spinAudFade);
      if (!fadeMs || a.paused) {
        a.pause(); // también cancela un play() que aún no arrancó (mp3 cargando)
      } else {
        const v0 = a.volume;
        const t0 = performance.now();
        spinAudFade = setInterval(() => {
          const k = Math.min(1, (performance.now() - t0) / fadeMs);
          a.volume = v0 * (1 - k);
          if (k >= 1) { clearInterval(spinAudFade); a.pause(); }
        }, 40);
      }
    }
    if (!snd) return;
    const { ctx, master } = snd;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.005, (fadeMs || 0) / 3000));
    clearTimeout(sndSuspend);
    sndSuspend = setTimeout(() => { if (!audioWanted && snd) snd.ctx.suspend(); }, (fadeMs || 0) + 400);
  }
  // Al volver a la ruleta en pleno giro, el sonido retoma donde corresponde
  function syncSpinAudio() {
    if (state !== "spinning" || !spinInfo || (!TUNING.sound && !TUNING.spinSoundUrl)) return;
    const el = (performance.now() - spinInfo.t0) / 1000;
    if (el >= spinInfo.dur / 1000) return;
    startSpinAudio();
  }
  const onVisibility = () => {
    if (document.hidden) stopSpinAudio(0);
    else if (running) syncSpinAudio();
  };
  document.addEventListener("visibilitychange", onVisibility);

  function spin(onEnd) {
    if (state === "spinning" || !currentN) {
      if (!currentN && onEnd) onEnd();
      return;
    }
    const step = TWO_PI / currentN;
    // El giro comienza desde el ángulo actual (normalizado para no perder precisión)
    const from = mod(rotor.rotation.y, TWO_PI);
    rotor.rotation.y = from;
    // La rueda se detiene en un ángulo cualquiera: la ganadora queda donde caiga la bola
    const turns = TUNING.turnsMin + Math.random() * TUNING.turnsExtra;
    const to = from - TWO_PI * turns - Math.random() * TWO_PI;
    const dur = TUNING.spinMin + Math.random() * (TUNING.spinMax - TUNING.spinMin);
    const plan = planBall(from, to, dur / 1000);
    spinInfo = { from, to, dur, t0: performance.now(), onEnd, plan };
    endNotified = false;
    smoothLookReady = false;
    state = "spinning";
    stage.dataset.state = "spinning";
    applyTrailColor();
    startSpinAudio();
  }

  skipBtn.addEventListener("click", () => {
    if (state === "spinning" && spinInfo) {
      spinInfo.t0 = performance.now() - spinInfo.dur - 1;
      stopSpinAudio(TUNING.audioFadeMs);
    }
  });

  function update(now, dt) {
    // si la ruleta se ocultó sin avisarnos (otro código cerró el modal o cambió de pantalla), se corta el sonido
    if (audioWanted && !stage.clientWidth) stopSpinAudio(0);
    twinkle(now);
    if (state === "idle") {
      rotor.rotation.y -= dt * TUNING.idleSpeed;
      setCamera(camBase.pos, camBase.look, BASE_FOV);
      return;
    }
    const P = spinInfo.plan;
    if (state === "spinning") {
      const t = Math.min(P.D, Math.max(0, (now - spinInfo.t0) / 1000));
      rotor.rotation.y = P.rot(t);
      updateBall(t, P);
      driveSpinSound(t, P);
      driveSpinFile(t);
      applyCinematic(t, P, dt, false);
      aimSpot(t, P);
      spot.intensity = TUNING.spotIntensity * smoothstep01(clamp01((t - (P.D - 1.8)) / 1.2));
      if (t >= P.D) {
        state = "done";
        stage.dataset.state = "done";
        doneAt = now;
        rotor.rotation.y = spinInfo.to;
        applyCinematic(P.D, P, 0, true);
        placeBallFinal(P);
        startReveal();
        if (TUNING.audioFadeAtReveal) stopSpinAudio(TUNING.audioFadeMs);
      }
    } else if (state === "done") {
      applyCinematic(P.D, P, 0, true);
      const k = easeOutCubic(clamp01((now - doneAt) / (TUNING.flySec * 1000)));
      aimSpot(P.D, P);
      animateReveal(k);
      if (!endNotified && now - doneAt > 700) {
        endNotified = true;
        const cb = spinInfo.onEnd;
        if (cb) cb();
      }
    }
  }

  // ── Cámara y tamaño ──
  function fitCamera() {
    const aspect = camera.aspect || 1;
    const vFov = (BASE_FOV * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const elev = (TUNING.cameraElevation * Math.PI) / 180;
    // En pantallas anchas se ve la rueda y parte del tablero; en vertical (móvil), solo la rueda
    const portrait = aspect < 0.9;
    const halfW = portrait ? R_BOWL + 0.4 : TUNING.viewHalfWidth;
    const cx = portrait ? 0 : TUNING.viewCenterX;
    const halfH = R_BOWL * Math.sin(elev) + 1.0; // el eje central sobresale
    const d = Math.max(halfW / Math.tan(hFov / 2), halfH / Math.tan(vFov / 2)) * 1.04;
    camBase.pos.set(cx, Math.sin(elev) * d, Math.cos(elev) * d + 0.3);
    camBase.look.set(cx, 0.2, 0.3);
  }

  function onResize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) {
      stopSpinAudio(0);
      return;
    }
    if (!audioWanted) syncSpinAudio();
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    fitCamera();
    camera.updateProjectionMatrix();
  }
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
  if (ro) ro.observe(stage);

  // ── Bucle de render ──
  let raf = 0;
  let last = 0;
  let running = false;
  let dead = false;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    update(now, dt);
    renderer.render(scene, camera);
  }
  function resume() {
    if (running || dead) return;
    running = true;
    last = performance.now();
    onResize();
    syncSpinAudio();
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    stopSpinAudio(0);
    running = false;
    cancelAnimationFrame(raf);
  }

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    dead = true;
    pause();
  });

  function show() {
    stage.classList.add("on");
    resume();
  }
  function hide() {
    stage.classList.remove("on");
    pause();
  }
  function dispose() {
    pause();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("cc:weather", refreshSky);
    clearInterval(skyTimer);
    clearTimeout(sndSuspend);
    clearInterval(spinAudFade);
    if (spinAud) { spinAud.src = ""; spinAud = null; }
    if (snd) { try { snd.ctx.close(); } catch (_) { /* ya cerrado */ } snd = null; }
    if (ro) ro.disconnect();
    clearReveal();
    glowTex.dispose();
    ribbonTex.dispose();
    extraTex.forEach((t) => t.dispose());
    disposeTree(scene);
    if (envRT) envRT.dispose();
    renderer.dispose();
    stage.remove();
  }

  return { setItems, spin, show, hide, pause, resume, dispose, isDead: () => dead };
}