// ===========================================================
// EFECTOS ESTACIONALES (fx-themes.js)
// -----------------------------------------------------------
// Un solo módulo para todos los temas. Cada tema se registra en
// EFFECTS con un `mount(layer)` que rellena la capa de efectos.
// Los estilos de cada efecto viven en css/themes.css.
//
// Para agregar un tema nuevo (ej. Navidad):
//   1. Añadir su clave en EFFECTS con un mount(layer).
//   2. Escribir sus clases (.fx-snow, etc.) en themes.css.
//   3. Listo: theme-manager ya llama a startThemeFx(nombre).
//
// Cada tema puede tener además `decor(layer)`: decoración fija (telarañas,
// arañas) en una capa aparte por encima del contenido, y `playerDecor(el)`:
// decoración dentro de las franjas de info del reproductor (esa capa fija se
// oculta con el reproductor abierto para no tapar el video).
//
// Además de la capa de ambiente, cada tema puede tener "apariciones":
// videos con fondo verde que salen cada cierto tiempo (ver CAMEOS).
//
// Se carga con import() dinámico solo si hay un tema activo.
// ===========================================================

const root = document.documentElement;
const rand = (min, max) => min + Math.random() * (max - min);
const isMobile = () => window.innerWidth < 768;

// ── Decoración fija: telarañas y arañas ─────────────────────
// Telaraña de esquina dibujada por código: rayos desde la esquina (0,0) y
// arcos que se curvan hacia ella. Para las otras esquinas se voltea con CSS.
function buildWebSVG() {
  const R = 100, rays = 6, rings = [0.26, 0.5, 0.76, 1];
  const ang = (i) => (i / (rays - 1)) * (Math.PI / 2);
  const pt = (a, r) => [(Math.cos(a) * r).toFixed(1), (Math.sin(a) * r).toFixed(1)];
  let d = "";
  for (let i = 0; i < rays; i++) {
    const [x, y] = pt(ang(i), R);
    d += `M0 0L${x} ${y}`;
  }
  for (const k of rings) {
    for (let i = 0; i < rays - 1; i++) {
      const [x1, y1] = pt(ang(i), R * k);
      const [x2, y2] = pt(ang(i + 1), R * k);
      const [cx, cy] = pt((ang(i) + ang(i + 1)) / 2, R * k * 0.8);
      d += `M${x1} ${y1}Q${cx} ${cy} ${x2} ${y2}`;
    }
  }
  return (
    '<svg viewBox="-1 -1 102 102" focusable="false" aria-hidden="true">' +
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width=".8" stroke-linecap="round"/>` +
    "</svg>"
  );
}

// Araña: los colores se ponen en themes.css (.sp-body, .sp-legs, .sp-eye, .sp-mark).
const SPIDER_SVG =
  '<svg viewBox="0 0 40 40" focusable="false" aria-hidden="true">' +
  '<g class="sp-legs" fill="none" stroke-width="1.6" stroke-linecap="round">' +
  '<path d="M15 18Q7 10 3 14M14 21Q5 18 2 24M14 24Q6 27 3 35M16 27Q10 33 8 39"/>' +
  '<path d="M25 18Q33 10 37 14M26 21Q35 18 38 24M26 24Q34 27 37 35M24 27Q30 33 32 39"/>' +
  "</g>" +
  '<ellipse class="sp-body" cx="20" cy="25" rx="6.5" ry="8.5"/>' +
  '<circle class="sp-body" cx="20" cy="15" r="4.4"/>' +
  '<path class="sp-mark" d="M20 20.5L17.8 25L20 29.5L22.2 25Z"/>' +
  '<circle class="sp-eye" cx="18.5" cy="14.3" r="1"/>' +
  '<circle class="sp-eye" cx="21.5" cy="14.3" r="1"/>' +
  "</svg>";

// ── Registro de efectos ─────────────────────────────────────
const EFFECTS = {
  halloween: {
    mount(layer) {
      const fog = document.createElement("div");
      fog.className = "fx-fog";
      layer.appendChild(fog);

      const frag = document.createDocumentFragment();
      const count = isMobile() ? 8 : 16;
      for (let i = 0; i < count; i++) {
        const ember = document.createElement("div");
        ember.className = "fx-ember";
        const size = rand(2, 5).toFixed(1);
        const dur = rand(9, 18).toFixed(1);
        // Delay negativo: las brasas ya van a mitad de camino al cargar.
        ember.style.cssText =
          `left:${rand(0, 100).toFixed(1)}%;` +
          `width:${size}px;height:${size}px;` +
          `animation-duration:${dur}s;` +
          `animation-delay:-${rand(0, dur).toFixed(1)}s;` +
          `--ember-drift:${rand(-60, 60).toFixed(0)}px;`;
        frag.appendChild(ember);
      }
      layer.appendChild(frag);
    },

    // Decoración fija (capa aparte, por encima del contenido): telarañas en
    // las esquinas superiores y arañas colgando de un hilo.
    decor(layer) {
      for (const corner of ["tl", "tr"]) {
        const web = document.createElement("div");
        web.className = `fx-web fx-web--${corner}`;
        web.innerHTML = buildWebSVG();
        layer.appendChild(web);
      }

      // left: % de la pantalla · rest: px desde arriba en reposo · bob: px que baja y sube
      const spiders = isMobile()
        ? [{ left: 12, rest: 64, bob: 44, dur: 11, scale: 0.8 }]
        : [
            { left: 7, rest: 112, bob: 84, dur: 12, scale: 1 },
            { left: 91, rest: 72, bob: 56, dur: 9, scale: 0.75 },
          ];
      for (const sp of spiders) {
        const el = document.createElement("div");
        el.className = "fx-spider";
        el.style.cssText =
          `left:${sp.left}%;top:${sp.rest}px;` +
          `--bob:${sp.bob}px;--spider-scale:${sp.scale};` +
          `animation-duration:${sp.dur}s;` +
          `animation-delay:-${rand(0, sp.dur).toFixed(1)}s;`;
        el.innerHTML =
          `<div class="fx-spider-sway" style="animation-delay:-${rand(0, 5).toFixed(1)}s">` +
          SPIDER_SVG + "</div>";
        layer.appendChild(el);
      }
    },

    // Decoración dentro de las franjas de info del reproductor de SERIES (debajo
    // del video, nunca encima): telaraña en la esquina y una araña colgando.
    playerDecor(deco) {
      const web = document.createElement("div");
      web.className = "fx-pweb";
      web.innerHTML = buildWebSVG();
      deco.appendChild(web);

      const dur = rand(7, 11);
      const spider = document.createElement("div");
      spider.className = "fx-spider";
      spider.style.cssText =
        `--bob:${rand(8, 12).toFixed(0)}px;--spider-scale:0.62;--sway:0.8deg;` +
        `animation-duration:${dur.toFixed(1)}s;animation-delay:-${rand(0, dur).toFixed(1)}s;`;
      spider.innerHTML =
        `<div class="fx-spider-sway" style="animation-delay:-${rand(0, 5).toFixed(1)}s">` +
        SPIDER_SVG + "</div>";
      deco.appendChild(spider);
    },
  },

  // navidad: {
  //   mount(layer) { /* copos de nieve: .fx-snow en themes.css */ },
  // },
};

// ── Apariciones: videos con fondo verde ─────────────────────
// Cada tema puede tener sus clips. El fondo verde se quita en vivo con
// un shader (WebGL), sin tener que convertir los videos.
//
//   (La lista de clips de aquí es la "de fábrica": el panel de admin puede guardar
//    su propia lista por tema y esa pasa a mandar.)
//   firstDelay / minDelay / maxDelay : segundos (la primera aparición, y
//                                      el rango aleatorio entre las demás).
//                                      Son los valores por defecto: el panel de
//                                      admin los puede cambiar (setCameoSettings).
//   clips[].src      : URL del video (mp4/webm). Tiene que permitir CORS
//                      (Cloudinary lo permite) o WebGL no podrá leerlo.
//   clips[].width    : tamaño CSS ("30vw", "300px"). Sin width = pantalla completa.
//   clips[].align    : "left" | "center" | "right" | "random" (solo con width)
//   clips[].valign   : "bottom" | "top" | "center"           (solo con width)
//   clips[].fit      : "contain" | "cover" (solo pantalla completa)
//   clips[].name     : nombre que se ve en el panel de admin
//   clips[].minDelay / maxDelay : segundos entre apariciones de ESTE video
//                      (si no se ponen, vale el intervalo general)
//   clips[].chance   : 0 a 100. Probabilidad (%) de que salga cada vez que le toca
//                      según su intervalo (por defecto 100 = siempre). Con 1, un video
//                      "raro": cada vez que toca tira el dado y solo sale 1 de cada 100.
//   clips[].enabled  : false para dejarlo guardado sin que salga
//   clips[].layout   : "cover" | "contain" | "pop" (pop = pequeño, usa width/align/valign)
//   clips[].sound    : true para que suene (por defecto va mudo)
//   clips[].volume   : 0 a 1 (por defecto 0.6, solo con sound)
//   clips[].key / similarity / smoothness / despill / floor / dark : ajuste del verde
//     (por clip; si no se pone, valen CAMEO_DEFAULTS)
const CAMEOS = {
  halloween: {
    firstDelay: 15,
    minDelay: 60,
    maxDelay: 180,
    clips: [
      { name: "Esqueleto", src: "https://res.cloudinary.com/djhgmmdjx/video/upload/v1790797516/mfncnef0a9wzt1zdp3qg.mp4", fit: "cover" },
      // { src: "https://res.cloudinary.com/.../fantasma.mp4", width: "28vw", align: "random", valign: "bottom" },
      // { src: "https://res.cloudinary.com/.../murcielagos.mp4" }, // pantalla completa
    ],
  },
};

export const CAMEO_DEFAULTS = {
  key: "#00b140",     // verde típico de croma; para verde puro: "#00ff00"
  similarity: 0.15,   // cuánto se parece al verde para borrarlo (sube si queda verde)
  smoothness: 0.1,    // suavizado del borde (sube si se ve con dientes)
  despill: true,      // quita el reflejo verde en los bordes
  floor: 0.08,        // borra el velo casi transparente (sube si aún oscurece, baja si se comen los bordes suaves)
  dark: 0.05,         // lo más oscuro que esto (0 a 1 de brillo) se vuelve transparente; sube si quedan esquinas oscuras
};
// Si alguno de estos elementos está visible, no sale ninguna aparición
// (por ejemplo el reproductor). Agrega aquí el selector del tuyo.
const CAMEO_BLOCK_SELECTORS = [".art-video-player"];
const CAMEO_MAX_SECONDS = 30;  // tope de seguridad por aparición
const CAMEO_MAX_PX = 1280;     // lado mayor del canvas (rendimiento)
// Modo liviano: las apariciones salen igual pero con menos resolución y menos
// cuadros por segundo (el canvas se estira por CSS a pantalla completa).
const CAMEO_LITE_MAX_PX = 640;
const CAMEO_LITE_FPS = 24;

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec3 u_key;
uniform float u_sim;
uniform float u_smooth;
uniform float u_despill;
uniform float u_floor;
uniform float u_dark;
vec2 chroma(vec3 c) {
  return vec2(-0.169 * c.r - 0.331 * c.g + 0.5 * c.b,
               0.5 * c.r - 0.419 * c.g - 0.081 * c.b);
}
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  float v  = max(max(c.r, c.g), c.b);
  float vk = max(max(u_key.r, u_key.g), u_key.b);
  // Distancia de croma "cruda" (la de siempre) y otra normalizada por brillo.
  // El verde oscuro (sombras, viñeta del fondo, compresión del video) tiene el
  // mismo matiz que el verde del fondo pero menos croma, y con la distancia
  // cruda se quedaba como una capa negra semitransparente: eso oscurecía la
  // pantalla. Normalizando, cualquier verde se borra sin importar su brillo.
  // En píxeles casi negros (sin matiz fiable) se vuelve a la distancia cruda.
  float dr = distance(chroma(c.rgb), chroma(u_key));
  float dn = distance(chroma(c.rgb / max(v, 0.0001)), chroma(u_key / vk)) * vk;
  float d  = mix(dr, dn, smoothstep(0.012, 0.08, v));
  float a  = smoothstep(u_sim, u_sim + u_smooth, d);
  // Piso de alfa: borra el velo casi invisible que deja la compresión.
  a = clamp((a - u_floor) / (1.0 - u_floor), 0.0, 1.0);
  // Corte de negros: las esquinas del fondo verde suelen quedar casi negras (viñeta)
  // y no hay forma de saber si eran verde. Como el sitio es oscuro, lo casi negro
  // se vuelve transparente y ya no "ensucia" la pantalla.
  a *= smoothstep(u_dark * 0.5, u_dark, v);
  vec3 rgb = c.rgb;
  if (u_despill > 0.5) rgb.g = min(rgb.g, max(rgb.r, rgb.b));
  gl_FragColor = vec4(rgb * a, a);
}`;

const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
};

// Dibuja `video` en `canvas` quitando el color de fondo. Devuelve null si
// WebGL no está disponible.
export function createKeyRenderer(canvas, video, o) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const setUniforms = (o) => {
    gl.uniform3fv(gl.getUniformLocation(prog, "u_key"), hexToRgb(o.key));
    gl.uniform1f(gl.getUniformLocation(prog, "u_sim"), o.similarity);
    gl.uniform1f(gl.getUniformLocation(prog, "u_smooth"), o.smoothness);
    gl.uniform1f(gl.getUniformLocation(prog, "u_despill"), o.despill ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(prog, "u_floor"), Math.min(0.5, Math.max(0, o.floor ?? 0)));
    gl.uniform1f(gl.getUniformLocation(prog, "u_dark"), Math.min(0.3, Math.max(0.002, o.dark ?? 0.05)));
  };
  setUniforms(o);
  gl.clearColor(0, 0, 0, 0);

  let stopped = false;
  let handle = 0;
  let onFail = () => {};
  const useVfc = "requestVideoFrameCallback" in video;

  const minGap = o && o.maxFps ? 1000 / o.maxFps : 0;
  let lastDraw = 0;

  const frame = () => {
    if (stopped) return;
    const now = performance.now();
    if (minGap && now - lastDraw < minGap - 1) return next();
    lastDraw = now;
    if (video.readyState >= 2) {
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      } catch (err) {
        // Casi siempre: el video no permite CORS.
        stopped = true;
        console.warn("Aparición: no se pudo leer el video (¿CORS?):", err);
        onFail();
        return;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    next();
  };
  const next = () => {
    handle = useVfc ? video.requestVideoFrameCallback(frame) : requestAnimationFrame(frame);
  };

  return {
    // Cambia el ajuste en vivo (la vista previa del cuentagotas lo usa) y redibuja.
    setOptions(opts) {
      setUniforms(opts);
      if (video.readyState >= 2) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    },
    /** Dibuja el frame actual una vez (para videos en pausa). */
    redraw() {
      if (video.readyState < 2) return;
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); } catch { return; }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    start() { stopped = false; next(); },
    stop() {
      stopped = true;
      if (useVfc) video.cancelVideoFrameCallback?.(handle);
      else cancelAnimationFrame(handle);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
    set onFail(fn) { onFail = fn; },
  };
}

let cameoLayer = null;
const cameoTimers = new Map();  // id del clip → temporizador de su próxima aparición
let cameoTheme = null;
let cameoActive = null;         // { abort() } mientras hay una aparición en pantalla
let cameoCooldownUntil = 0;     // respiro entre una aparición y la siguiente
const CAMEO_COOLDOWN_MS = 8000;

// Ajustes que llegan desde el panel de admin (theme-manager.js) y pisan los
// valores de CAMEOS. Todo en segundos:
//   { enabled, firstDelay, minDelay, maxDelay,
//     byTheme: { halloween: { clips: [...] } } }   ← lista de videos propia
let cameoOverride = null;

// Deja un clip en un solo formato, venga de CAMEOS (escrito a mano) o del panel.
function normalizeClip(c, i = 0) {
  const num = (v, d, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  let layout = c.layout;
  if (!["cover", "contain", "pop"].includes(layout)) {
    layout = c.width ? "pop" : c.fit === "cover" ? "cover" : "contain";
  }
  const out = {
    id: c.id != null ? String(c.id) : "c" + i,
    name: c.name || "Video " + (i + 1),
    src: typeof c.src === "string" ? c.src.trim() : "",
    enabled: c.enabled !== false,
    layout,
    sound: c.sound === true,
    volume: num(c.volume, 0.6, 0, 1),
    minDelay: null,   // null = usa el intervalo general
    maxDelay: null,
    chance: num(c.chance, 100, 0, 100), // % de probabilidad cada vez que le toca salir
  };
  if (c.width) out.width = c.width;
  if (Number.isFinite(c.minDelay) && c.minDelay > 0) out.minDelay = Math.max(5, c.minDelay);
  if (Number.isFinite(c.maxDelay) && c.maxDelay > 0) out.maxDelay = Math.max(5, c.maxDelay);
  if (c.align) out.align = c.align;
  if (c.valign) out.valign = c.valign;
  if (typeof c.key === "string") out.key = c.key;
  ["similarity", "smoothness", "floor", "dark"].forEach((k) => {
    if (Number.isFinite(c[k])) out[k] = c[k];
  });
  if (typeof c.despill === "boolean") out.despill = c.despill;
  return out;
}

/** Videos "de fábrica" de un tema (los de CAMEOS), ya normalizados. Los usa el panel de admin. */
export function getDefaultClips(name) {
  const base = CAMEOS[name];
  return ((base && base.clips) || []).map((c, i) => normalizeClip(c, i)).filter((c) => c.src);
}

function cameoCfg(name) {
  const base = CAMEOS[name];
  if (!base) return null;
  const o = cameoOverride || {};
  const num = (v, d) => (Number.isFinite(v) && v >= 0 ? v : d);
  const minDelay = Math.max(5, num(o.minDelay, base.minDelay)); // tope inferior de seguridad
  // Si el admin guardó su propia lista para este tema, manda esa (aunque esté vacía).
  const saved = o.byTheme && o.byTheme[name];
  const rawClips = saved ? saved.clips || [] : base.clips || [];
  return {
    ...base,
    clips: rawClips.map((c, i) => normalizeClip(c, i)).filter((c) => c.src),
    enabled: o.enabled !== false,
    firstDelay: num(o.firstDelay, base.firstDelay),
    minDelay,
    maxDelay: Math.max(minDelay, num(o.maxDelay, base.maxDelay)),
  };
}

/** Lo llama theme-manager con lo que el admin eligió. Reprograma si cambió. */
export function setCameoSettings(settings) {
  const next = settings || null;
  if (JSON.stringify(next) === JSON.stringify(cameoOverride)) return;
  cameoOverride = next;
  // Si hay una aparición en pantalla se deja terminar; los temporizadores ya usan los valores nuevos.
  if (current) startCameos(current);
}

// Cada video tiene su propio intervalo (si no, el general).
function clipDelay(cfg, clip) {
  const min = Math.max(5, clip.minDelay ?? cfg.minDelay);
  const max = Math.max(min, clip.maxDelay ?? cfg.maxDelay);
  return rand(min, max);
}

function cameoBlocked() {
  const b = document.body;
  return (
    document.hidden ||
    b.classList.contains("modal-open") ||
    b.classList.contains("tab-inactive") ||
    CAMEO_BLOCK_SELECTORS.some((sel) =>
      [...document.querySelectorAll(sel)].some((el) => el.getClientRects().length > 0))
  );
}

function scheduleClip(id, seconds) {
  clearTimeout(cameoTimers.get(id));
  if (!cameoTheme) return;
  cameoTimers.set(id, setTimeout(() => tryClip(id), seconds * 1000));
}

function tryClip(id) {
  cameoTimers.delete(id);
  const cfg = cameoTheme && cameoCfg(cameoTheme);
  if (!cfg || !cfg.enabled) return;
  const clip = cfg.clips.find((c) => c.id === id);
  if (!clip || !clip.enabled) return;
  // Nunca dos a la vez: si toca pero hay otra en pantalla, en descanso o algo
  // bloquea (reproductor, modal), se reintenta en unos segundos.
  if (cameoActive || Date.now() < cameoCooldownUntil || cameoBlocked()) {
    return scheduleClip(id, rand(3, 6));
  }
  // Probabilidad: solo se tira el dado cuando de verdad podría salir (no bloqueado).
  // Si no sale, se vuelve a programar con el intervalo normal del video.
  if (clip.chance < 100 && Math.random() * 100 >= clip.chance) {
    return scheduleClip(id, clipDelay(cfg, clip));
  }
  playCameo(cameoTheme, clip, { timed: true });
}

function placeCameo(canvas, clip) {
  const st = canvas.style;
  if (clip.layout !== "pop") {
    // Pantalla completa ("cover" llena recortando; "contain" muestra el video entero)
    st.cssText += `;inset:0;width:100%;height:100%;object-fit:${clip.layout || "contain"}`;
    return;
  }
  st.width = clip.width || "28vw";
  st.maxWidth = "100%";
  st.height = "auto";
  const align = clip.align || "random";
  const tx = [];
  if (align === "left") st.left = "0";
  else if (align === "right") st.right = "0";
  else if (align === "center") { st.left = "50%"; tx.push("translateX(-50%)"); }
  else st.left = rand(0, 60).toFixed(0) + "%";
  const valign = clip.valign || "bottom";
  if (valign === "top") st.top = "0";
  else if (valign === "center") { st.top = "50%"; tx.push("translateY(-50%)"); }
  else st.bottom = "0";
  if (tx.length) st.transform = tx.join(" ");
}

function playCameo(name, source, { timed = false } = {}) {
  if (!source || !source.src || cameoActive) return false;
  const clip = { ...CAMEO_DEFAULTS, ...source };

  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  // Por defecto las apariciones van sin sonido. Con `sound: true` en el clip suena
  // (volumen 0..1 con `volume`, por defecto 0.6).
  const wantSound = clip.sound === true;
  video.muted = !wantSound;
  video.volume = Math.min(1, Math.max(0, Number.isFinite(clip.volume) ? clip.volume : 0.6));
  video.playsInline = true;
  video.preload = "auto";
  video.src = clip.src;

  const canvas = document.createElement("canvas");
  canvas.className = "theme-cameo";
  placeCameo(canvas, clip);

  let renderer = null;
  let safety = 0;
  let done = false;

  const finish = (scheduleNext = true) => {
    if (done) return;
    done = true;
    clearTimeout(safety);
    cameoActive = null;
    canvas.classList.remove("is-on");
    setTimeout(() => {
      renderer?.stop();
      video.pause();
      video.removeAttribute("src");
      video.load();
      canvas.remove();
    }, 700);
    cameoCooldownUntil = Date.now() + CAMEO_COOLDOWN_MS;
    // Solo las apariciones programadas reprograman la siguiente (las de prueba no).
    // Se relee la config: el admin pudo cambiarla o apagarla mientras salía el video.
    if (scheduleNext && timed) {
      const live = cameoCfg(name);
      const liveClip = live && live.clips.find((c) => c.id === clip.id);
      if (live && live.enabled && liveClip && liveClip.enabled) {
        scheduleClip(clip.id, clipDelay(live, liveClip));
      }
    }
  };
  cameoActive = { abort: () => finish(false) };

  try {
    // El tamaño del canvas se fija al conocer el del video.
    video.addEventListener("loadedmetadata", () => {
      const k = Math.min(1, (liteMode ? CAMEO_LITE_MAX_PX : CAMEO_MAX_PX) / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * k);
      canvas.height = Math.round(video.videoHeight * k);
    }, { once: true });

    renderer = createKeyRenderer(canvas, video, liteMode ? { ...clip, maxFps: CAMEO_LITE_FPS } : clip);
    if (!renderer) throw new Error("WebGL no disponible");
    renderer.onFail = () => finish();
  } catch (err) {
    console.warn("Aparición cancelada:", err);
    finish();
    return false;
  }

  video.addEventListener("playing", () => {
    renderer.start();
    requestAnimationFrame(() => canvas.classList.add("is-on"));
  }, { once: true });
  video.addEventListener("ended", () => finish());
  video.addEventListener("error", () => {
    console.warn("Aparición: el video no cargó:", clip.src);
    finish();
  });
  safety = setTimeout(() => finish(), CAMEO_MAX_SECONDS * 1000);

  if (!cameoLayer) {
    cameoLayer = document.createElement("div");
    cameoLayer.className = "theme-cameo-layer";
    cameoLayer.setAttribute("aria-hidden", "true");
    document.body.appendChild(cameoLayer);
  }
  cameoLayer.appendChild(canvas);
  video.play().catch((err) => {
    // Los navegadores bloquean el audio automático hasta que la persona haya
    // tocado la página. Si pasa, se reintenta sin sonido en vez de cancelar.
    if (wantSound && !video.muted) {
      video.muted = true;
      return video.play().catch((err2) => {
        console.warn("Aparición: el navegador bloqueó la reproducción:", err2);
        finish();
      });
    }
    console.warn("Aparición: el navegador bloqueó la reproducción:", err);
    finish();
  });
  return true;
}

function clearCameoTimers() {
  cameoTimers.forEach((t) => clearTimeout(t));
  cameoTimers.clear();
}

/** (Re)programa todos los videos activos. No corta una aparición que esté en pantalla. */
function startCameos(name) {
  clearCameoTimers();
  cameoTheme = null;
  const cfg = cameoCfg(name);
  if (!cfg || !cfg.enabled) return;
  const list = cfg.clips.filter((c) => c.enabled);
  if (!list.length) return;
  cameoTheme = name;
  // El primero (al azar) sale a los `firstDelay` segundos; los demás, después
  // de esa espera más su propio intervalo, para que no choquen.
  const order = [...list].sort(() => Math.random() - 0.5);
  order.forEach((c, i) =>
    scheduleClip(c.id, cfg.firstDelay + (i === 0 ? 0 : clipDelay(cfg, c))));
}

function stopCameos() {
  clearCameoTimers();
  cameoTheme = null;
  cameoActive?.abort();
  if (cameoLayer) { cameoLayer.remove(); cameoLayer = null; }
}

/**
 * Para probar: fuerza una aparición ahora (window.__themeFx.playCameoNow()).
 * Sin argumento elige un video activo al azar; con un objeto de clip prueba ese
 * (así el panel de admin puede probar cambios sin guardarlos).
 */
export function playCameoNow(arg) {
  if (!current || cameoActive) return false;
  let clip = null;
  if (arg && typeof arg === "object") {
    clip = normalizeClip(arg);
  } else {
    const cfg = cameoCfg(current);
    const pool = cfg ? cfg.clips.filter((c) => c.enabled) : [];
    clip = pool[Math.floor(Math.random() * pool.length)];
  }
  if (!clip || !clip.src) return false;
  return playCameo(current, clip);
}

// ── Estado ──────────────────────────────────────────────────
let liteMode = false;   // modo liviano: sin niebla/brasas/apariciones, sin animaciones
let layer = null;
let decoLayer = null;   // telarañas y arañas (por encima del contenido)
let current = null;
let observer = null;
let pollTimer = 0;

// Franjas del reproductor donde va la decoración: SOLO series (.sp-ep-info-strip
// cubre escritorio; .sp-details-mobile es el título móvil). La franja de las
// películas (.dv-player-info) es más baja y tiene sus propias reglas: va sin
// decoración; si se quiere una, agregar ese selector y una versión a su medida.
// El reproductor se dibuja de nuevo al abrir cada título, así que se revisa
// en cada ciclo de syncPause y se agrega donde falte.
const PLAYER_DECOR_TARGETS = ".sp-ep-info-strip, .sp-details-mobile";

function syncPlayerDecor() {
  const effect = EFFECTS[current];
  if (!effect || !effect.playerDecor) return;
  document.querySelectorAll(PLAYER_DECOR_TARGETS).forEach((host) => {
    if (host.querySelector(":scope > .fx-player-deco")) return;
    // La decoración es absoluta: si la franja no estaba posicionada, se le da
    // position:relative (solo en ese caso, para no romper una fija o sticky).
    if (getComputedStyle(host).position === "static") {
      host.style.position = "relative";
      host.dataset.fxPos = "1";
    }
    const deco = document.createElement("div");
    deco.className = "fx-player-deco";
    deco.setAttribute("aria-hidden", "true");
    effect.playerDecor(deco);
    host.appendChild(deco);
  });
}

function clearPlayerDecor() {
  document.querySelectorAll(".fx-player-deco").forEach((el) => el.remove());
  document.querySelectorAll("[data-fx-pos]").forEach((el) => {
    el.style.position = "";
    delete el.dataset.fxPos;
  });
}

// Pausa las animaciones cuando no se ven o hay un modal abierto.
// La decoración, que va por encima del contenido, además se oculta con un
// modal abierto o con el reproductor en pantalla.
function syncPause() {
  if (!layer && !decoLayer) return;
  const b = document.body;
  const modal = b.classList.contains("modal-open");
  const paused = document.hidden || modal || b.classList.contains("tab-inactive");
  if (layer) layer.classList.toggle("fx-paused", paused);
  if (decoLayer) {
    const playerOpen = CAMEO_BLOCK_SELECTORS.some((sel) =>
      [...document.querySelectorAll(sel)].some((el) => el.getClientRects().length > 0));
    // Las telarañas de las esquinas se quedan con el reproductor abierto (en
    // escritorio el video no llega a las esquinas). Solo se ocultan en pantalla
    // completa del reproductor, con un modal, o en móvil (ahí sí podrían tapar el video).
    const playerFull = !!document.querySelector(
      ".art-video-player.art-fullscreen, .art-video-player.art-fullscreen-web");
    decoLayer.classList.toggle("fx-paused", paused);
    decoLayer.classList.toggle("fx-hidden", modal || playerFull || (playerOpen && isMobile()));
  }
  syncPlayerDecor();
}

export function hasThemeFx(name) {
  return !!EFFECTS[name];
}

export function stopThemeFx() {
  if (observer) { observer.disconnect(); observer = null; }
  document.removeEventListener("visibilitychange", syncPause);
  if (layer) { layer.remove(); layer = null; }
  if (decoLayer) { decoLayer.remove(); decoLayer = null; }
  clearPlayerDecor();
  clearInterval(pollTimer);
  stopCameos();
  current = null;
  liteMode = false;
}

export function startThemeFx(name, opts = {}) {
  const lite = !!opts.lite;
  // Mismo tema y mismo modo ya corriendo: no hacer nada (applyTheme se llama varias veces).
  const alive = (layer && layer.isConnected) || (decoLayer && decoLayer.isConnected);
  if (current === name && liteMode === lite && alive) return;
  stopThemeFx();

  const effect = EFFECTS[name];
  if (!effect || root.classList.contains("tema-fx-off")) return;
  liteMode = lite;

  // Modo liviano: no se crea la capa de ambiente (niebla, brasas) y la
  // decoración queda estática (themes.css apaga sus animaciones).
  if (!lite) {
    layer = document.createElement("div");
    layer.className = "theme-fx-layer";
    layer.setAttribute("aria-hidden", "true");
    effect.mount(layer);
    document.body.appendChild(layer);
  }
  if (effect.decor) {
    decoLayer = document.createElement("div");
    decoLayer.className = "theme-deco-layer";
    decoLayer.setAttribute("aria-hidden", "true");
    effect.decor(decoLayer);
    document.body.appendChild(decoLayer);
  }
  current = name;

  observer = new MutationObserver(syncPause);
  observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("visibilitychange", syncPause);
  // El reproductor puede abrirse sin cambiar la clase del body: se revisa cada tanto.
  pollTimer = setInterval(syncPause, lite ? 4000 : 1500);
  syncPause();
  startCameos(name); // en modo liviano salen igual, pero más baratas (ver CAMEO_LITE_*)
  window.__themeFx = { playCameoNow }; // solo para pruebas
}

export default { startThemeFx, stopThemeFx, hasThemeFx, playCameoNow, setCameoSettings };
