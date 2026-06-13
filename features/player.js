// ===========================================================
// MÓDULO DEL REPRODUCTOR (V4 - ARTPLAYER + artplayer-plugin-ass)
// Migración completa: SubtitlesOctopus WASM → artplayer-plugin-ass (assjs)
//
// ¿Por qué este cambio?
//   SubtitlesOctopus usa libass compilado a WASM:
//     ✗ Requiere SharedArrayBuffer → bloqueado por COOP/COEP en muchos hosts
//     ✗ El Worker WASM crashea en móviles con poca RAM (Redmi Note 9S, etc.)
//     ✗ Errores "Corrupted brotli dictionary", "postMessage on null", etc.
//
//   artplayer-plugin-ass usa assjs (Canvas puro, JavaScript 100%):
//     ✓ Sin WASM → sin crashes ni headers especiales requeridos
//     ✓ El canvas overlay se destruye con art.destroy() → sin fugas de memoria
//     ✓ API limpia: art.plugins.ass.setTrack(url) para cambiar subtítulo
//     ✓ Soporte nativo de resampling → typesetting complejo escala correctamente
// ===========================================================

import { logError } from "../utils/logger.js";
import { WORKER_URL } from "../core/config.js";
import ContentManager from "../utils/content-manager.js";

// ─── CDN del plugin oficial (ESM) ─────────────────────────────
// Se carga una vez y se cachea en módulo → no re-descarga por episodio
const ASS_PLUGIN_CDN =
  "/cinecorentatesteos/assests/js/artplayer-plugin-jassub.js";

// ─── Cache global del módulo (singleton por sesión) ───────────
let _assPluginModule = null;
let _assPluginLoadPromise = null;

// ─── Mapa de fuentes comunes en fansubs de anime ──────────────
// Clave: nombre en minúscula tal como aparece en [V4+ Styles] del .ass
// Valor: URL pública de la fuente en formato TTF (requerido por libass/JASSUB)
//
// IMPORTANTE: libass dentro del worker WASM sólo puede leer TTF/OTF.
// Los formatos WOFF y WOFF2 se descargan correctamente pero libass no puede
// parsearlos → VFS queda vacío → "failed to find any fallback".
// Usamos @expo-google-fonts en jsDelivr porque son el único CDN npm
// que publica TTF directamente accesibles por URL.
//
// Estrategia para fuentes comerciales (Gotham, Futura, etc.):
//   → Se incluye el sustituto libre más compatible visualmente.
//   → Para fuentes propietarias exactas, pasa el Drive ID en tu data
//     como fontIds: ['1Abc...'] y el Worker las servirá automáticamente.
// Cada familia tipográfica tiene su propio paquete en @expo-google-fonts.
// NO existe un paquete único — cada fuente necesita su URL base individual.
const ANIME_FONT_MAP = {
  // ── Sans-serif genéricas ──────────────────────────────────────────────
  "open sans":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/open-sans/400Regular/OpenSans_400Regular.ttf",
  roboto:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/roboto/400Regular/Roboto_400Regular.ttf",
  montserrat:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/montserrat/400Regular/Montserrat_400Regular.ttf",
  lato: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/lato/400Regular/Lato_400Regular.ttf",
  "noto sans":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf",
  "source sans pro":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/source-sans-pro/400Regular/SourceSansPro_400Regular.ttf",
  ubuntu:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/ubuntu/400Regular/Ubuntu_400Regular.ttf",
  nunito:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/nunito/400Regular/Nunito_400Regular.ttf",
  inter:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf",
  oswald:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/oswald/400Regular/Oswald_400Regular.ttf",
  raleway:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/raleway/400Regular/Raleway_400Regular.ttf",
  cabin:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/cabin/400Regular/Cabin_400Regular.ttf",
  "exo 2":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/exo-2/400Regular/Exo2_400Regular.ttf",
  rajdhani:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/rajdhani/400Regular/Rajdhani_400Regular.ttf",
  kanit:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/kanit/400Regular/Kanit_400Regular.ttf",
  "yanone kaffeesatz":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/yanone-kaffeesatz/400Regular/YanoneKaffeesatz_400Regular.ttf",

  // ── Sustitutos para fuentes comerciales comunes en fansubs ───────────
  gotham:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/montserrat/400Regular/Montserrat_400Regular.ttf",
  "gotham bold":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/montserrat/700Bold/Montserrat_700Bold.ttf",
  "gotham narrow":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/montserrat/400Regular/Montserrat_400Regular.ttf",
  futura:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/nunito-sans/400Regular/NunitoSans_400Regular.ttf",
  "futura pt":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/nunito-sans/400Regular/NunitoSans_400Regular.ttf",
  "gill sans":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/lato/400Regular/Lato_400Regular.ttf",
  "myriad pro":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/source-sans-pro/400Regular/SourceSansPro_400Regular.ttf",
  "helvetica neue":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf",
  helvetica:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf",
  "franklin gothic":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/oswald/400Regular/Oswald_400Regular.ttf",

  // ── Sustitutos para fuentes CLÁSICAS de Fansubs de Anime y Manga ─────
  "anime ace":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/comic-neue/700Bold/ComicNeue_700Bold.ttf",
  "anime ace bb":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/comic-neue/700Bold/ComicNeue_700Bold.ttf",
  "wild words":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/bangers/400Regular/Bangers_400Regular.ttf",
  "cc wild words":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/bangers/400Regular/Bangers_400Regular.ttf",
  "action man":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/bangers/400Regular/Bangers_400Regular.ttf",
  "comic book":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/comic-neue/400Regular/ComicNeue_400Regular.ttf",

  // ── Fuentes de sistema (equivalentes libres en TTF) ───────────────────
  arial:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/arimo/400Regular/Arimo_400Regular.ttf",
  "arial bold":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/arimo/700Bold/Arimo_700Bold.ttf",
  "times new roman":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/tinos/400Regular/Tinos_400Regular.ttf",
  "courier new":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/cousine/400Regular/Cousine_400Regular.ttf",
  "trebuchet ms":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/fira-sans/400Regular/FiraSans_400Regular.ttf",
  verdana:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/pt-sans/400Regular/PTSans_400Regular.ttf",
  tahoma:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf",
  georgia:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/lora/400Regular/Lora_400Regular.ttf",
  impact:
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/oswald/700Bold/Oswald_700Bold.ttf",
  "comic sans ms":
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/comic-neue/400Regular/ComicNeue_400Regular.ttf",
};

let shared;

// ─── Utilidad: descarga el sub, auto-detecta encoding y recodifica a UTF-8 ───
// Devuelve un blob:// URL listo para pasarle a Artplayer.
// Si el fetch falla, devuelve la URL original como fallback silencioso.
//
// ¿Por qué windows-1252 y no iso-8859-1?
//   Windows-1252 es un superset de Latin-1 que cubre los caracteres extra
//   usados en fansubs en español (€, smart quotes, etc.) y es lo que
//   realmente usan la mayoría de los .srt generados en Windows.
async function resolveSubtitleEncoding(url) {
  try {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();

    // 1. Intentar UTF-8 estricto: fatal:true lanza error ante cualquier byte inválido
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      // Ya es UTF-8 limpio → crear blob igualmente para consistencia
      return URL.createObjectURL(
        new Blob([text], { type: "text/plain;charset=utf-8" })
      );
    } catch (_) {
      // No es UTF-8 válido → decodificar como Windows-1252 (cubre á é í ó ú ñ ü ¿ ¡)
      const text = new TextDecoder("windows-1252").decode(buffer);
      return URL.createObjectURL(
        new Blob([text], { type: "text/plain;charset=utf-8" })
      );
    }
  } catch (err) {
    console.warn("[CinePlayer] resolveSubtitleEncoding falló, usando URL original:", err);
    return url;
  }
}

// ─── Utilidad: llama a .play() capturando AbortError ─────────────────────────
// El browser lanza AbortError cuando un video.load() interrumpe un play() en
// vuelo. Es un comportamiento esperado al cambiar de episodio o remontar el
// player; no indica un error real. Artplayer tampoco lo captura internamente,
// por lo que lo silenciamos aquí de forma quirúrgica.
//
// target: instancia de Artplayer (art) o HTMLVideoElement (art.video)
function safePlay(target) {
  try {
    const p = target.play();
    if (p && typeof p.catch === "function") {
      p.catch((e) => {
        if (e?.name !== "AbortError") {
          console.error("[CinePlayer] play() rechazado:", e);
        }
      });
    }
  } catch (e) {
    if (e?.name !== "AbortError") {
      console.error("[CinePlayer] play() excepción:", e);
    }
  }
}

// 1. INICIALIZACIÓN
export function initPlayer(dependencies) {
  shared = dependencies;

  // ─── Silenciar AbortError internos de artplayer.js ──────────────────────
  // Artplayer llama a video.play() sin capturar el AbortError que el browser
  // lanza cuando load() lo interrumpe. No podemos modificar artplayer.js,
  // así que interceptamos el evento global de forma quirúrgica:
  // solo silenciamos AbortError — cualquier otro rechazo sigue visible.
  window.addEventListener("unhandledrejection", (event) => {
    if (event.reason?.name === "AbortError") {
      event.preventDefault();
    }
  });

  // ✅ Cierra el reproductor al navegar desde el header
  document.addEventListener("click", (e) => {
    if (e.target.closest(".main-nav a, .nav-link, .logo, .header-logo")) {
      const page = document.getElementById("series-player-page");
      if (page && page.classList.contains("active")) {
        closeSeriesPlayerModal();
      }
    }
  });

  // ─── Guardar "Continuar viendo" si se cierra sin usar el botón Volver ──
  // Hoy commitAndClearPendingSave() y el flush del tiempo de reproducción
  // solo ocurren en navegaciones internas (cambiar de episodio, "Volver",
  // destroyPrevious). Si el usuario cierra la pestaña, el navegador, o
  // cambia de app/minimiza en móvil, nada de eso se dispara y el episodio
  // que se estaba viendo nunca queda registrado.
  //   - pagehide: cerrar pestaña/navegador o navegar fuera de la página.
  //   - visibilitychange (hidden): cubre minimizar / cambiar de app en
  //     móviles, donde pagehide no siempre es confiable.
  const flushOnExit = () => {
    flushActivePlayerProgress();
    commitAndClearPendingSave();
  };
  window.addEventListener("pagehide", flushOnExit);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnExit();
  });
}

// Guarda (o limpia, si ya casi terminó) el tiempo actual del player activo
// en localStorage, igual que hace el timeupdate cada 3s — pero al instante,
// para no perder hasta 3s de progreso si el cierre ocurre justo entre ciclos.
function flushActivePlayerProgress() {
  try {
    const container = shared?.appState?.player?.activeCineInstance?.container;
    const art = container?._artInstance;
    const sid = container?._artStorageId;
    if (!art || !sid) return;

    const t = art.currentTime;
    const d = art.duration;
    if (!(t > 5) || !(d > 0)) return;

    if (d - t < 60) {
      localStorage.removeItem(sid);
    } else {
      localStorage.setItem(sid, t);
    }

    const pending = shared.appState.player.pendingHistorySave;
    if (pending) {
      pending.episodeInfo.progress = d - t < 60 ? 1 : Math.min(1, Math.max(0, t / d));
    }
  } catch (_) {}
}

// ===========================================================
// 🛠️ CLASE CINEPLAYER (Artplayer + artplayer-plugin-ass)
// ===========================================================
function isDriveId(id) {
  // Google Drive IDs: empiezan con '1' y tienen >= 25 chars alfanuméricos
  return (
    typeof id === "string" &&
    id.startsWith("1") &&
    id.length >= 25 &&
    /^[A-Za-z0-9_-]+$/.test(id)
  );
}

function buildWorkerUrl(type, driveId) {
  if (!driveId) return null;
  return `${WORKER_URL}/?id=${driveId}&type=${type}`;
}

function buildErrorHTML(message = "No se pudo cargar el video.") {
  return `
      <div class="player-error" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:white; background:#000;">
        <i class="fas fa-exclamation-circle" style="font-size: 40px; color: #e50914; margin-bottom: 15px;"></i>
        <p style="font-weight: bold; font-size: 18px; margin-bottom: 5px;">Error de reproducción</p>
        <p style="color: #aaa; margin-bottom: 15px;">${message}</p>
        <button onclick="location.reload()" style="background:#e50914; border:none; padding:8px 16px; color:white; border-radius:5px; cursor:pointer;">Reintentar</button>
      </div>`;
}

function destroyPrevious(container) {
  if (container._artInstance) {
    // Flush del progreso actual antes de destruir, para no perder los últimos
    // segundos que el timeupdate (cada 3s) aún no había guardado.
    try {
      const art = container._artInstance;
      const t = art.currentTime;
      const d = art.duration;
      const sid = container._artStorageId;
      if (sid && t > 5 && d > 0 && d - t >= 60) {
        localStorage.setItem(sid, t);
      }
    } catch (_) {}
    // destroy(false) = no borra el nodo del DOM, solo limpia Artplayer.
    // El canvas de artplayer-plugin-ass se destruye automáticamente aquí.
    container._artInstance.destroy(false);
    container._artInstance = null;
  }
  // Limpiar referencia al plugin (ya fue destruido por art.destroy() arriba)
  container._assPluginRef = null;
}

class CinePlayer {
  constructor(containerSelector, options = {}) {
    this.container =
      typeof containerSelector === "string"
        ? document.querySelector(containerSelector)
        : containerSelector;
    if (!this.container)
      throw new Error(
        `[CinePlayer] Contenedor no encontrado: ${containerSelector}`,
      );

    this.container.classList.add("cine-player-wrapper");
    this.options = options;
    this.art = null;
    this._assPlugin = null; // Referencia al plugin activo (para cambio de tracks)
    // Contador anti-race: incrementar cancela cualquier _mountAssPlugin en vuelo
    this._mountId = 0;
  }

  // ===========================================================
  // 🎯 REGLAS DE SUBTÍTULOS:
  //   subType === 'srt' → Ruta Liviana: art.subtitle.url nativo
  //                       Sin canvas/WASM. Ideal para móviles.
  //   subType === 'ass' → Ruta Avanzada: artplayer-plugin-ass (assjs)
  //                       Canvas puro, sin WASM. Typesetting complejo.
  //   !subId            → Sin subtítulos.
  // ===========================================================
  async load({
    videoId,
    subId = null,
    subType = null,
    title = "",
    poster = "",
    grayscale = false,
    onHalfway = null,
  }) {
    // Limpiar timers y doc-listeners de la carga anterior (evita acumulación de handlers)
    if (this._epSetupTimer) {
      clearTimeout(this._epSetupTimer);
      this._epSetupTimer = null;
    }
    if (this._ccSetupTimer) {
      clearTimeout(this._ccSetupTimer);
      this._ccSetupTimer = null;
    }
    if (this._settingsSetupTimer) {
      clearTimeout(this._settingsSetupTimer);
      this._settingsSetupTimer = null;
    }
    if (this._epDocHandler) {
      document.removeEventListener("click", this._epDocHandler);
      this._epDocHandler = null;
    }
    if (this._ccDocHandler) {
      document.removeEventListener("click", this._ccDocHandler);
      this._ccDocHandler = null;
    }
    if (this._settingsDocHandler) {
      document.removeEventListener("click", this._settingsDocHandler);
      this._settingsDocHandler = null;
    }
    // Limpiar drawer móvil anterior
    if (this._mobileDrawerBackdrop) {
      this._mobileDrawerBackdrop.remove();
      this._mobileDrawerBackdrop = null;
    }
    if (this._mobileDrawerEl) {
      this._mobileDrawerEl.remove();
      this._mobileDrawerEl = null;
    }

    // Detener pre-fetch de la carga anterior
    this._stopPreFetch?.();
    this._stopPreFetch = null;

    destroyPrevious(this.container);
    this.container.innerHTML = "";

    if (!videoId) {
      this.showError("ID de video no proporcionado.");
      return;
    }

    if (!isDriveId(videoId)) {
      this._mountIframeFallback(videoId);
      // Sin ArtPlayer no hay eventos de progreso; usamos 30 min como proxy
      if (onHalfway) {
        clearTimeout(this._halfwayTimer);
        this._halfwayTimer = setTimeout(onHalfway, 30 * 60 * 1000);
      }
      return;
    }

    const videoUrl = buildWorkerUrl("video", videoId);
    const subUrl = subId ? buildWorkerUrl("sub", subId) : null;

    const resolvedSubType = subUrl
      ? ContentManager.getSubtitleConfig({ subId, subType }).subType
      : null;

    // ─── Recodificar el sub a UTF-8 antes de montar el player ────────────
    // Resuelve el problema de caracteres corruptos (ó→? á→? etc.) en archivos
    // SRT guardados en Latin-1/Windows-1252 por herramientas antiguas de fansub.
    // Para ASS se pasa la URL original; assjs maneja su propio encoding interno.
    const safeSubUrl =
      subUrl && resolvedSubType === "srt"
        ? await resolveSubtitleEncoding(subUrl)
        : subUrl;

    const [available, { isFastStart, contentLength }] = await Promise.all([
      this._pingWorker(videoUrl),
      this._detectFastStart(videoUrl),
    ]);
    if (!available) {
      this.showError(
        "El servidor de video no está disponible. Intenta más tarde.",
      );
      return;
    }

    const artConfig = {
      container: this.container,
      url: videoUrl,
      type: "mp4",
      title,
      poster,
      theme: "var(--accent-color)",
      volume: 1,
      autoplay: false,
      autoSize: true,
      fastForward: true,
      autoMini: false,
      autoPlayback: false,
      miniProgressBar: true,
      autoOrientation: true,
      screenshot: false,
      hotkey: false,
      mutex: true,
      fullscreen: true,
      lang: navigator.language.toLocaleLowerCase() || "es",
      moreVideoAttr: {
        playsinline: true,
        preload: "auto",
        crossOrigin: "anonymous",
      },

      // 🟢 RUTA LIVIANA (SRT): Motor nativo de ArtPlayer, sin canvas extra.
      // safeSubUrl ya es un blob:// UTF-8, así que no hace falta encoding aquí.
      ...(resolvedSubType === "srt" && safeSubUrl
        ? {
            subtitle: {
              url: safeSubUrl,
              type: "srt",
              escape: false,
              style: {
                color: "#ffffff",
                fontSize: "20px",
                textShadow: "1px 1px 3px rgba(0,0,0,0.8)",
              },
            },
          }
        : {}),

      // 🔴 RUTA AVANZADA (ASS): artplayer-plugin-ass se monta en el evento 'ready'
      //    NO se pasa nada en artConfig.plugins aquí; el plugin se agrega
      //    dinámicamente para poder hacer detección de CORS previa.

      // 🎨 Menú click derecho personalizado
      contextmenu: [
        // 📝 CONTROLES DE SUBTÍTULOS (SRT) — solo si hay subs SRT activos
        ...(resolvedSubType === "srt" && safeSubUrl
          ? [
              {
                width: 260,
                html: "Tamaño Subtítulos",
                tooltip: "100%",
                name: "subtitleSize",
                icon: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
                selector: [
                  { url: "14px", html: "50% (Muy Pequeño)" },
                  { url: "16px", html: "75% (Pequeño)" },
                  { url: "20px", html: "100% (Normal)", default: true },
                  { url: "26px", html: "150% (Grande)" },
                  { url: "32px", html: "200% (Extra Grande)" },
                ],
                onSelect: function (item) {
                  this.subtitle.style({ fontSize: item.url });
                  return item.html;
                },
              },
              {
                width: 260,
                html: "Fondo de Subtítulos",
                tooltip: "Transparente",
                name: "subtitleBg",
                icon: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
                selector: [
                  { url: "transparent", html: "Transparente", default: true },
                  { url: "rgba(0, 0, 0, 0.5)", html: "Semi-oscuro" },
                  {
                    url: "rgba(0, 0, 0, 0.85)",
                    html: "Oscuro (Estilo YouTube)",
                  },
                ],
                onSelect: function (item) {
                  const isTransparent = item.url === "transparent";
                  this.subtitle.style({
                    backgroundColor: item.url,
                    padding: isTransparent ? "0px" : "4px 12px",
                    borderRadius: isTransparent ? "0px" : "6px",
                    textShadow: isTransparent
                      ? "1px 1px 3px rgba(0,0,0,0.9)"
                      : "none",
                  });
                  return item.html;
                },
              },
            ]
          : []),
        {
          html: "Cine Corneta Player",
          click: function (contextmenu) {
            console.info("Reproductor oficial");
            contextmenu.show = false;
          },
        },
      ],

      ...this.options,
    };

    const art = new Artplayer(artConfig);
    this.art = art;
    this.container._artInstance = art;

    // ─── Montar subtítulos según tipo ────────────────────────
    if (safeSubUrl) {
      if (resolvedSubType === "srt") {
        // 🟢 RUTA LIVIANA: motor nativo ya configurado en artConfig.subtitle
        art.on("ready", () => {
          art.subtitle.show = true;
          art.subtitle.style({
            color: "#ffffff",
            fontSize: "20px", // ← Asegúrate de que esto sea 20px
            textShadow: "1px 1px 3px rgba(0,0,0,0.9)",
            backgroundColor: "transparent",
            padding: "0px",
            borderRadius: "0px",
          });
        });
      } else {
        // 🔴 RUTA AVANZADA (ASS): montar artplayer-plugin-ass tras inicializar
        art.on("ready", () => this._mountAssPlugin(safeSubUrl));
      }
    }

    // ─── Manejo de errores del reproductor ──────────────────
    // Artplayer emite el evento "error" con el Event nativo del <video>,
    // no con un objeto Error. err.target.error es el MediaError del browser.
    // Códigos MediaError:
    //   1 = MEDIA_ERR_ABORTED    → usuario canceló, ignorar
    //   2 = MEDIA_ERR_NETWORK    → error de red transitorio, no destruir el player
    //   3 = MEDIA_ERR_DECODE     → codec no soportado o archivo corrupto
    //   4 = MEDIA_ERR_SRC_NOT_SUPPORTED → formato/URL inválida, sí es fatal
    art.on("error", (err) => {
      const mediaError = err?.target?.error ?? err?.error ?? null;
      const code = mediaError?.code ?? 0;

      // Código 1: el usuario abortó la carga (p.ej. cambió de episodio)
      // Código 2: error de red transitorio — Artplayer reintenta solo
      // Ambos son no-fatales: solo logear, NO destruir el player.
      if (code === 1 || code === 2) {
        console.warn(
          `[CinePlayer] Error no fatal (MediaError code ${code}):`,
          mediaError?.message ?? err,
        );
        return;
      }

      // Códigos 3 y 4 son fatales: mostrar error al usuario.
      // También cubrimos el caso raro donde no hay MediaError (code === 0).
      console.error(`[CinePlayer] Error fatal (MediaError code ${code}):`, err);

      const msg =
        code === 4
          ? "Formato de video no soportado por este navegador."
          : code === 3
            ? "Error al decodificar el video. El archivo puede estar corrupto."
            : "Ocurrió un error al reproducir. Intenta de nuevo.";

      this.showError(msg);
    });

    // ─── Listener de 50% para historial de películas ─────────
    if (onHalfway) {
      let halfwayFired = false;
      art.on("timeupdate", () => {
        if (!halfwayFired && art.duration > 0 && art.currentTime >= art.duration * 0.5) {
          halfwayFired = true;
          onHalfway();
        }
      });
    }

    // ─── Pre-fetch en background ─────────────────────────────────────────
    // No requiere "fast-start" (moov al inicio): el cálculo de qué chunk
    // descargar es por proporción de tiempo (currentTime/duration), y el
    // moov es minúsculo frente al mdat, así que la estimación es válida
    // igual para archivos con moov al final (muy común en remuxes de
    // fansubs). Solo se necesita conocer el tamaño total del archivo.
    if (contentLength > 0) {
      this._startPreFetch(videoUrl, contentLength, art);
    }

    // ─── ResizeObserver para mantener proporciones ───────────
    this._observeResize();

    // ─── Bloqueo de orientación en pantalla completa (móvil) ─
    art.on("fullscreen", (isFullscreen) => {
      if (!window.screen?.orientation?.lock) return;
      if (isFullscreen) {
        screen.orientation.lock("landscape").catch(() => {});
      } else {
        screen.orientation.unlock();
      }
    });

    // =======================================================
    // 🔊 SLIDER DE VOLUMEN VERTICAL CUSTOM (solo desktop)
    // En móvil el volumen se controla con los botones físicos del dispositivo
    // =======================================================
    art.on("ready", () => {
      const volumeControl = this.container.querySelector(".art-control-volume");
      if (!volumeControl) return;

      if (window.innerWidth <= 768) {
        // Móvil: eliminar el botón de volumen directamente del DOM
        volumeControl.remove();
        return;
      }

      // Desktop: agregar slider vertical custom
      const panel = document.createElement("div");
      panel.className = "custom-volume-panel";
      panel.innerHTML = `<input type="range" min="0" max="1" step="0.01" value="${art.volume}">`;

      volumeControl.appendChild(panel);
      const slider = panel.querySelector("input");

      panel.addEventListener("click", (e) => e.stopPropagation());

      slider.addEventListener("input", (e) => {
        art.volume = parseFloat(e.target.value);
        if (art.volume > 0) art.muted = false;
      });

      art.on("video:volumechange", () => {
        slider.value = art.muted ? 0 : art.volume;
      });
    });
    // =======================================================
    // ▶️ NUEVO CÓDIGO: BOTÓN DE PLAY CENTRAL GIGANTE
    // =======================================================
    art.layers.add({
      name: "centerPlayBtn",
      // Inyectamos el icono SVG de Play directamente (con un pequeño margen para que se vea centrado ópticamente)
      html: '<svg viewBox="0 0 24 24" width="40" height="40" fill="white" style="margin-left: 5px;"><path d="M8 5v14l11-7z"/></svg>',
      click: function () {
        safePlay(art); // Al hacer clic, reproduce
      },
    });

    // Buscamos la capa que acabamos de crear
    const centerLayerBtn = this.container.querySelector(
      ".art-layer-centerPlayBtn",
    );

    // Si el video se está reproduciendo, ocultamos el botón central
    art.on("play", () => {
      if (centerLayerBtn) centerLayerBtn.style.display = "none";
    });

    // Si el video se pausa, volvemos a mostrar el botón central
    art.on("pause", () => {
      if (centerLayerBtn) centerLayerBtn.style.display = "flex";
    });

    // =======================================================
    // ⏭️ NUEVO CÓDIGO: BOTONES DE ADELANTAR / RETROCEDER
    // =======================================================
    art.on("ready", () => {
      // ⟲10 / ↷10 solo en desktop — en móvil el doble tap cumple la misma función
      if (window.innerWidth > 768) {
        // 1. Botón de Retroceder 10s (A la izquierda del Play)
        art.controls.add({
          name: "backward10",
          position: "left",
          index: 5,
          // Icono SVG oficial de Material Design (Replay 10)
          html: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8zm-1.1 11h-.85v-3.26l-1.01.31v-.69l1.77-.63h.09V16zm4.28-1.76c0 .32-.03.6-.1.82s-.17.42-.29.57-.28.26-.45.33-.37.1-.59.1-.41-.03-.59-.1-.33-.18-.46-.33-.23-.34-.29-.57-.1-.5-.1-.82v-1.4c0-.32.03-.6.1-.82s.17-.42.29-.57.28-.26.46-.33.37-.1.59-.1.41.03.59.1.33.18.45.33.22.34.29.57.1.5.1.82v1.4zm-1.74-1.54c-.04-.13-.11-.21-.21-.26s-.22-.08-.36-.08-.27.03-.36.08-.17.13-.21.27.06-.32.06-.58v1.66c0 .25.02.45.06.58s.11.22.21.27.22.08.36.08.27-.03.36-.08.17-.13.21-.27.06-.32.06-.58v-1.66c0-.25-.02-.45-.06-.58z"/></svg>',
          tooltip: "Retroceder 10s",
          click: function () {
            // Resta 10 segundos asegurando que no baje de 0
            art.currentTime = Math.max(art.currentTime - 10, 0);
          },
        });

        // 2. Botón de Adelantar 10s (A la derecha del Play)
        art.controls.add({
          name: "forward10",
          position: "left",
          index: 15,
          // Icono SVG oficial de Material Design (Forward 10)
          html: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2zm-5.66 3h-.85v-3.26l-1.01.31v-.69l1.77-.63h.09V16zm4.28-1.76c0 .32-.03.6-.1.82s-.17.42-.29.57-.28.26-.45.33-.37.1-.59.1-.41-.03-.59-.1-.33-.18-.46-.33-.23-.34-.29-.57-.1-.5-.1-.82v-1.4c0-.32.03-.6.1-.82s.17-.42.29-.57.28-.26.46-.33.37-.1.59-.1.41.03.59.1.33.18.45.33.22.34.29.57.1.5.1.82v1.4zm-1.74-1.54c-.04-.13-.11-.21-.21-.26s-.22-.08-.36-.08-.27.03-.36.08-.17.13-.21.26-.06.32-.06.58v1.66c0 .25.02.45.06.58s.11.22.21.27.22.08.36.08.27-.03.36-.08.17-.13.21-.27.06-.32.06-.58v-1.66c0-.25-.02-.45-.06-.58z"/></svg>',
          tooltip: "Adelantar 10s",
          click: function () {
            // Suma 10 segundos asegurando que no pase del máximo del video
            art.currentTime = Math.min(
              art.currentTime + 10,
              art.duration || art.currentTime + 10,
            );
          },
        });

        // 3. Indicador de conexión + buffer (icono de señal en controles)
        this._setupNetworkIndicator(art);
      }
    });

    // =======================================================
    // 🔤 BOTÓN CC INDEPENDIENTE (NIVEL PREMIUM Y FIJO)
    // Se delega a _refreshCCButton para poder reutilizarlo también
    // al cambiar episodio en fullscreen sin recrear el player.
    // =======================================================
    this._refreshCCButton(art, subUrl, resolvedSubType);

    // =======================================================
    // 📱 MÓVIL: BOTONES FLOTANTES + DRAWER (ESTILO YOUTUBE)
    // =======================================================
    this._setupMobileDrawer(art, subUrl, resolvedSubType);

    // =======================================================
    // ⌨️ CONTROL MAESTRO DE TECLADO (ESTILO YOUTUBE)
    // =======================================================
    // Variable para saber si el player tiene el foco
    let isPlayerFocused = false;

    // Detectamos cuándo el usuario hace clic dentro del reproductor
    this.container.addEventListener("mousedown", () => {
      isPlayerFocused = true;
    });

    // Si hace clic fuera del reproductor, le quitamos el foco
    document.addEventListener("mousedown", (e) => {
      if (!this.container.contains(e.target)) {
        isPlayerFocused = false;
      }
    });

    // Escuchamos las teclas a nivel global, pero SOLO actuamos si está enfocado
    document.addEventListener("keydown", (e) => {
      // Si no está enfocado, dejamos que el navegador haga lo normal (scroll, etc.)
      if (!isPlayerFocused) return;

      // Si presionó alguna de las teclas que nos interesan, bloqueamos el scroll nativo
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)
      ) {
        e.preventDefault();
      }

      switch (e.key) {
        case "ArrowRight":
          // Adelantar 10 segundos
          art.currentTime = Math.min(art.currentTime + 10, art.duration);
          art.notice.show = "Adelantar 10s";
          break;

        case "ArrowLeft":
          // Retroceder 10 segundos
          art.currentTime = Math.max(art.currentTime - 10, 0);
          art.notice.show = "Retroceder 10s";
          break;

        case "ArrowUp":
          // Subir volumen 5% (0.05)
          art.volume = Math.min(art.volume + 0.05, 1);
          art.muted = false;
          art.notice.show = `Volumen: ${Math.round(art.volume * 100)}%`;
          break;

        case "ArrowDown":
          // Bajar volumen 5% (0.05)
          art.volume = Math.max(art.volume - 0.05, 0);
          art.notice.show = `Volumen: ${Math.round(art.volume * 100)}%`;
          break;

        case " ": // Tecla Espacio
          // Play / Pausa (Funciona perfecto ahora que apagamos el nativo)
          art.toggle();
          break;

        case ",": {
          // Retroceder 1 fotograma (~1/30 s asumiendo 30 fps)
          const fps = 30;
          art.video.pause();
          art.currentTime = Math.max(art.currentTime - 1 / fps, 0);
          art.notice.show = "◀ 1 fotograma";
          break;
        }

        case ".": {
          // Adelantar 1 fotograma (~1/30 s asumiendo 30 fps)
          const fps = 30;
          art.video.pause();
          art.currentTime = Math.min(art.currentTime + 1 / fps, art.duration);
          art.notice.show = "1 fotograma ▶";
          break;
        }

        case "f":
        case "F":
          // Alternar pantalla completa
          art.fullscreen = !art.fullscreen;
          break;
      }
    });

    // =======================================================
// 🎞️ BOTÓN BLANCO Y NEGRO (solo si la serie lo requiere)
// =======================================================
if (grayscale) {
  art.on("ready", () => {
    let bynActivo = false;

    art.controls.add({
      name: "byn-toggle",
      position: "right",
      index: 5,
      tooltip: "Blanco y Negro",
      html: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
      click: () => {
        bynActivo = !bynActivo;
        this.container.style.filter = bynActivo
          ? "grayscale(100%) contrast(1.15) brightness(0.92)"
          : "";
        art.notice.show = bynActivo ? "Modo Blanco y Negro activado 🎞️" : "Color restaurado";
      },
    });
  });
}

    // =======================================================
    // ⏮️ BOTÓN FIJO: EPISODIO ANTERIOR
    // =======================================================
    if (window.appState?.player?.activeSeriesId) {
      art.controls.add({
        name: "btn-prev-ep",
        position: "left",
        index: 19,
        tooltip: "Episodio Anterior",
        html: '<i class="art-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="#ffffff"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"></path></svg></i>',
        click: function () {
          const currentEp = window._spCurrentEpisodeData;
          const seriesId = window.appState?.player?.activeSeriesId;
          if (!currentEp || !seriesId) return;

          const season = currentEp._season;
          const currentIdx = currentEp._index ?? 0;
          const allSeasons =
            window.appState?.content?.seriesEpisodes?.[seriesId] || {};

          let targetSeason = season;
          let targetIdx = null;
          let targetEp = null;

          // BUG FIX 3: usar seasonOrder para respetar el orden real de temporadas,
          // no el orden de keys del objeto (no garantizado en JS).
          const seasonOrder = window.appState?.content?.seasonOrder?.[seriesId];
          const seasonKeys = seasonOrder || Object.keys(allSeasons);

          if (currentIdx > 0) {
            targetIdx = currentIdx - 1;
            targetEp = (allSeasons[season] || [])[targetIdx];
          }

          if (targetIdx === null) {
            const currentSeasonPos = seasonKeys.indexOf(String(season));
            const prevSeasonKey = seasonKeys[currentSeasonPos - 1];

            if (prevSeasonKey && (allSeasons[prevSeasonKey] || []).length > 0) {
              targetSeason = prevSeasonKey;
              const prevEpisodes = allSeasons[prevSeasonKey];
              targetIdx = prevEpisodes.length - 1;
              targetEp = prevEpisodes[targetIdx];
            } else {
              art.notice.show = "Ya estás en el primer capítulo 🏁";
              return;
            }
          }

          const isFullscreen = !!document.fullscreenElement;

          if (isFullscreen && art) {
            let savedLang = null;
            try {
              savedLang = (JSON.parse(
                localStorage.getItem("seriesLangPrefs"),
              ) || {})[seriesId];
            } catch (_) {}
            const tracks = getLangTracks(targetEp);
            const activeLang =
              savedLang && tracks.some((t) => t.lang === savedLang)
                ? savedLang
                : window._spActiveLang || tracks[0]?.lang || "es";
            const track =
              tracks.find((t) => t.lang === activeLang) || tracks[0];
            if (!track) return;

            let subId, subType;
            if (activeLang === "en" && targetEp.subId_en) {
              subId = targetEp.subId_en;
              subType = targetEp.subType_en || "srt";
            } else if (targetEp.subId_es) {
              subId = targetEp.subId_es;
              subType = targetEp.subType_es || "srt";
            } else {
              const cfg = ContentManager.getSubtitleConfig(targetEp);
              subId = cfg.subId;
              subType = cfg.subType;
            }

            const newVideoUrl = buildWorkerUrl("video", track.id);
            const newSubUrl = subId ? buildWorkerUrl("sub", subId) : null;

            art.notice.show =
              targetSeason !== season
                ? "Cargando temporada anterior... 🍿"
                : "Cargando episodio anterior... 🍿";

            const videoEl = art.video;
            videoEl.src = newVideoUrl;
            videoEl.load();
            art.once("video:canplay", () => {
              safePlay(art);
            });

            const cineInst = window.appState?.player?.activeCineInstance;

            // Limpiar sub anterior antes de asignar el nuevo (incluye
            // destruir el canvas .ass del capítulo anterior si lo había,
            // sin esto se quedaba el sub viejo "pegado" sobre el video nuevo)
            art.subtitle.show = false;
            art.subtitle.url = "";
            if (newSubUrl && subType === "srt") {
              cineInst?._clearAssPlugin?.();
              art.subtitle.url = newSubUrl;
              art.subtitle.show = true;
            } else if (newSubUrl && subType === "ass") {
              cineInst?._remountAssPlugin?.(newSubUrl);
            } else {
              cineInst?._clearAssPlugin?.();
            }

            if (cineInst) cineInst._refreshCCButton(art, newSubUrl, subType);

            window.appState.player.state[seriesId] = {
              ...window.appState.player.state[seriesId],
              season: targetSeason,
              episodeIndex: targetIdx,
            };
            window._spCurrentEpisodeData = {
              ...targetEp,
              _season: targetSeason,
              _index: targetIdx,
            };
            window._spActiveLang = activeLang;

            _updateSpPsInfo(
              targetEp,
              targetSeason,
              seriesId,
              track.label || "",
              targetIdx,
            );

            if (targetSeason !== season) {
              _fillSpPsPanel(seriesId, targetSeason, targetIdx, activeLang);
            } else {
              const epListContainer =
                document.getElementById("sp-ps-episode-list");
              if (epListContainer) {
                epListContainer
                  .querySelectorAll(".sp-episode-item")
                  .forEach((el, i) => {
                    el.classList.toggle("active", i === targetIdx);
                  });
                epListContainer
                  .querySelector(".sp-episode-item.active")
                  ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }
            }

            // BUG FIX: actualizar pendingHistorySave con el episodio actual
            // para que al presionar Volver se guarde el ultimo episodio visto,
            // no el primero con el que se abrio el player.
            window.appState.player.pendingHistorySave = {
              contentId: seriesId,
              type: "series",
              episodeInfo: {
                season: targetSeason,
                index: targetIdx,
                title: targetEp.title || "",
              },
            };

            try {
              const allProgress =
                JSON.parse(localStorage.getItem("seriesProgress")) || {};
              if (!allProgress[seriesId]) allProgress[seriesId] = {};
              allProgress[seriesId][targetSeason] = targetIdx;
              localStorage.setItem(
                "seriesProgress",
                JSON.stringify(allProgress),
              );
            } catch (_) {}

            return;
          }

          art.notice.show =
            targetSeason !== season
              ? "Cargando temporada anterior... 🍿"
              : "Cargando episodio anterior... 🍿";
          playEpisodeInDetailView(seriesId, targetSeason, targetIdx);
        },
      });
    }

    // =======================================================
    // ⏭️ BOTÓN FIJO: SIGUIENTE CAPÍTULO
    // =======================================================
    if (window.appState?.player?.activeSeriesId) {
      art.controls.add({
        name: "btn-next-ep",
        position: "left",
        index: 20,
        tooltip: "Siguiente Capítulo",
        html: '<i class="art-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="#ffffff"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"></path></svg></i>',
        click: function () {
          const currentEp = window._spCurrentEpisodeData;
          const seriesId = window.appState?.player?.activeSeriesId;
          if (!currentEp || !seriesId) return;

          const season = currentEp._season;
          const currentIdx = currentEp._index ?? 0;
          const allSeasons =
            window.appState?.content?.seriesEpisodes?.[seriesId] || {};
          const episodes = allSeasons[season] || [];
          const nextIdx = currentIdx + 1;

          let targetSeason = season;
          let targetIdx = null;
          let targetEp = null;

          // BUG FIX 3: usar seasonOrder para respetar el orden real de temporadas,
          // no el orden de keys del objeto (no garantizado en JS).
          const seasonOrder = window.appState?.content?.seasonOrder?.[seriesId];
          const seasonKeys = seasonOrder || Object.keys(allSeasons);

          if (nextIdx < episodes.length) {
            targetIdx = nextIdx;
            targetEp = episodes[nextIdx];
          }

          if (targetIdx === null) {
            const currentSeasonPos = seasonKeys.indexOf(String(season));
            const nextSeasonKey = seasonKeys[currentSeasonPos + 1];

            if (nextSeasonKey && (allSeasons[nextSeasonKey] || []).length > 0) {
              targetSeason = nextSeasonKey;
              targetIdx = 0;
              targetEp = allSeasons[nextSeasonKey][0];
            } else {
              art.notice.show = "Ya estás en el último capítulo 🏁";
              return;
            }
          }

          const isFullscreen = !!document.fullscreenElement;

          if (isFullscreen && art) {
            let savedLang = null;
            try {
              savedLang = (JSON.parse(
                localStorage.getItem("seriesLangPrefs"),
              ) || {})[seriesId];
            } catch (_) {}
            const tracks = getLangTracks(targetEp);
            const activeLang =
              savedLang && tracks.some((t) => t.lang === savedLang)
                ? savedLang
                : window._spActiveLang || tracks[0]?.lang || "es";
            const track =
              tracks.find((t) => t.lang === activeLang) || tracks[0];
            if (!track) return;

            let subId, subType;
            if (activeLang === "en" && targetEp.subId_en) {
              subId = targetEp.subId_en;
              subType = targetEp.subType_en || "srt";
            } else if (targetEp.subId_es) {
              subId = targetEp.subId_es;
              subType = targetEp.subType_es || "srt";
            } else {
              const cfg = ContentManager.getSubtitleConfig(targetEp);
              subId = cfg.subId;
              subType = cfg.subType;
            }

            const newVideoUrl = buildWorkerUrl("video", track.id);
            const newSubUrl = subId ? buildWorkerUrl("sub", subId) : null;

            art.notice.show =
              targetSeason !== season
                ? "Cargando siguiente temporada... 🍿"
                : "Cargando siguiente capítulo... 🍿";

            const videoEl = art.video;
            videoEl.src = newVideoUrl;
            videoEl.load();
            art.once("video:canplay", () => {
              safePlay(art);
            });

            const cineInst = window.appState?.player?.activeCineInstance;

            // Limpiar sub anterior antes de asignar el nuevo (incluye
            // destruir el canvas .ass del capítulo anterior si lo había,
            // sin esto se quedaba el sub viejo "pegado" sobre el video nuevo)
            art.subtitle.show = false;
            art.subtitle.url = "";
            if (newSubUrl && subType === "srt") {
              cineInst?._clearAssPlugin?.();
              art.subtitle.url = newSubUrl;
              art.subtitle.show = true;
            } else if (newSubUrl && subType === "ass") {
              cineInst?._remountAssPlugin?.(newSubUrl);
            } else {
              cineInst?._clearAssPlugin?.();
            }

            if (cineInst) cineInst._refreshCCButton(art, newSubUrl, subType);

            window.appState.player.state[seriesId] = {
              ...window.appState.player.state[seriesId],
              season: targetSeason,
              episodeIndex: targetIdx,
            };
            window._spCurrentEpisodeData = {
              ...targetEp,
              _season: targetSeason,
              _index: targetIdx,
            };
            window._spActiveLang = activeLang;

            _updateSpPsInfo(
              targetEp,
              targetSeason,
              seriesId,
              track.label || "",
              targetIdx,
            );

            if (targetSeason !== season) {
              _fillSpPsPanel(seriesId, targetSeason, targetIdx, activeLang);
            } else {
              const epListContainer =
                document.getElementById("sp-ps-episode-list");
              if (epListContainer) {
                epListContainer
                  .querySelectorAll(".sp-episode-item")
                  .forEach((el, i) => {
                    el.classList.toggle("active", i === targetIdx);
                  });
                epListContainer
                  .querySelector(".sp-episode-item.active")
                  ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }
            }

            // BUG FIX: actualizar pendingHistorySave con el episodio actual
            // para que al presionar Volver se guarde el ultimo episodio visto,
            // no el primero con el que se abrio el player.
            window.appState.player.pendingHistorySave = {
              contentId: seriesId,
              type: "series",
              episodeInfo: {
                season: targetSeason,
                index: targetIdx,
                title: targetEp.title || "",
              },
            };

            try {
              const allProgress =
                JSON.parse(localStorage.getItem("seriesProgress")) || {};
              if (!allProgress[seriesId]) allProgress[seriesId] = {};
              allProgress[seriesId][targetSeason] = targetIdx;
              localStorage.setItem(
                "seriesProgress",
                JSON.stringify(allProgress),
              );
            } catch (_) {}

            return;
          }

          art.notice.show =
            targetSeason !== season
              ? "Cargando siguiente temporada... 🍿"
              : "Cargando siguiente capítulo... 🍿";
          playEpisodeInDetailView(seriesId, targetSeason, targetIdx);
        },
      });
    }

    // =======================================================
    // 💾 1. MEMORIA DE REPRODUCCIÓN (Continuar viendo)
    // =======================================================
    // Usamos videoId (ID estable de Drive/Cloudinary) como clave,
    // no la URL del worker que puede cambiar con cada refresh o token.
    const videoStorageId = "cine_progreso_" + videoId;
    // Guardamos la clave en el container para que destroyPrevious pueda
    // hacer un flush del currentTime justo antes de destruir el player.
    this.container._artStorageId = videoStorageId;
    const savedTime = localStorage.getItem(videoStorageId);

    // Si hay tiempo guardado y es mayor a 5 segundos, retomamos desde ahí
    if (savedTime && parseFloat(savedTime) > 5) {
      const jumpToSavedTime = () => {
        art.currentTime = parseFloat(savedTime);
        art.notice.show = "Continuando donde lo dejaste... 🍿";
      };

      // Seguro antibug: Verificamos si el video ya cargó su línea de tiempo
      if (art.video.readyState >= 1) {
        jumpToSavedTime(); // Si ya está listo, saltamos de inmediato
      } else {
        // Si está cargando, esperamos a que reporte los metadatos y luego saltamos
        art.once("video:loadedmetadata", jumpToSavedTime);
      }
    }

    // Guardar el progreso de forma inteligente
    let lastSaveTime = 0;
    art.on("video:timeupdate", () => {
      const now = Date.now();
      if (now - lastSaveTime > 3000) {
        // Guardamos cada 3 segundos reales
        // Si faltan menos de 60 segundos para terminar, borramos el progreso
        // para que la próxima vez la película empiece desde cero.
        if (art.duration > 0 && art.duration - art.currentTime < 60) {
          localStorage.removeItem(videoStorageId);
        } else {
          localStorage.setItem(videoStorageId, art.currentTime);
        }

        // Actualizamos el % de avance del capítulo actual para que la
        // barra roja de "Continuar viendo" refleje el progreso exacto.
        const pending = shared.appState.player.pendingHistorySave;
        if (pending && art.duration > 0) {
          pending.episodeInfo.progress =
            art.duration - art.currentTime < 60
              ? 1
              : Math.min(1, Math.max(0, art.currentTime / art.duration));
        }

        lastSaveTime = now;
      }
    });
    // =======================================================
    // 📱 2. DOBLE TOQUE PARA MÓVILES (Estilo App de YouTube)
    // =======================================================
    let lastTapTime = 0;
    art.template.$video.addEventListener(
      "touchstart",
      (e) => {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTapTime;

        // Si el toque ocurre con menos de 300ms de diferencia, es doble toque
        if (tapLength < 300 && tapLength > 0) {
          if (e.cancelable) e.preventDefault(); // Evita que la pantalla del celular haga "zoom"

          const touchX = e.changedTouches[0].clientX;
          const screenWidth = window.innerWidth;

          // ¿Tocó la mitad derecha o la mitad izquierda?
          if (touchX > screenWidth / 2) {
            art.currentTime = Math.min(art.currentTime + 10, art.duration);
            art.notice.show = "Adelantar 10s ⏭️";
          } else {
            art.currentTime = Math.max(art.currentTime - 10, 0);
            art.notice.show = "⏮️ Retroceder 10s";
          }
        }
        lastTapTime = currentTime;
      },
      { passive: false },
    );

    // =======================================================
    // 🔲 3. BOTÓN PICTURE-IN-PICTURE → movido al panel de Ajustes
    // =======================================================

    // ── Guardia de plataforma ────────────────────────────────
    // En móvil estos controles no se montan en la barra nativa:
    // el drawer de _setupMobileDrawer los reemplaza con mejor UX táctil.
    const isMobile = window.innerWidth <= 768;

    // =======================================================
    // ⚙️ 4. BOTÓN DE AJUSTES PERSONALIZADO (VELOCIDAD / ASPECTO)
    // =======================================================
    if (!isMobile) {
      art.controls.add({
        name: "custom-settings",
        position: "right",
        index: 30, // Se pone a la derecha del todo
        tooltip: "Ajustes",
        // Icono de Tuerca elegante y sólido
        html: '<i class="art-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="#ffffff"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"></path></svg></i>',
      });

      this._settingsSetupTimer = setTimeout(() => {
        this._settingsSetupTimer = null;
        const settingsControl = this.container.querySelector(
          ".art-control-custom-settings",
        );
        if (settingsControl) {
          settingsControl.style.position = "relative";

          const panel = document.createElement("div");
          // Heredamos la clase 'custom-cc-panel' para tener el mismo fondo de cristal desenfocado
          panel.className = "custom-cc-panel custom-settings-panel";
          const pipSection = document.pictureInPictureEnabled
            ? `
            <hr class="cc-separator">
            <span class="cc-title">MINIRREPRODUCTOR</span>
            <div class="cc-item" id="settings-pip-btn">📺 Imagen en Imagen (PiP)</div>
          `
            : "";

          panel.innerHTML = `
            <span class="cc-title">VELOCIDAD</span>
            <div class="settings-grid">
              <div class="settings-grid-item" data-speed="0.5">0.5x</div>
              <div class="settings-grid-item" data-speed="0.75">0.75x</div>
              <div class="settings-grid-item active" data-speed="1.0">1x</div>
              <div class="settings-grid-item" data-speed="1.25">1.25x</div>
              <div class="settings-grid-item" data-speed="1.5">1.5x</div>
              <div class="settings-grid-item" data-speed="2.0">2x</div>
            </div>
            <hr class="cc-separator">
            <span class="cc-title">ASPECTO</span>
            <div class="cc-item active" data-ratio="default">Original</div>
            <div class="cc-item" data-ratio="16:9">16:9</div>
            <div class="cc-item" data-ratio="4:3">4:3</div>
            ${pipSection}
          `;

          settingsControl.appendChild(panel);

          // Panel oculto por defecto — se muestra/oculta con el botón de ajustes
          panel.style.display = "none";

          // Toggle al hacer click en el botón de ajustes
          settingsControl.addEventListener("click", (e) => {
            e.stopPropagation();
            panel.style.display =
              panel.style.display === "none" ? "block" : "none";
          });

          // Cerrar al hacer click fuera del control (referencia guardada para limpiar en load())
          this._settingsDocHandler = (e) => {
            if (!settingsControl.contains(e.target)) panel.style.display = "none";
          };
          document.addEventListener("click", this._settingsDocHandler);

          // Evitar que el menú se cierre al hacer clic adentro
          panel.addEventListener("click", (e) => e.stopPropagation());

          // ==========================================
          // 1. Lógica para Velocidad (A prueba de balas)
          // ==========================================
          panel.querySelectorAll("[data-speed]").forEach((item) => {
            item.addEventListener("click", () => {
              const speed = parseFloat(item.getAttribute("data-speed"));

              // Método 1: API de ArtPlayer
              art.playbackRate = speed;
              // Método 2: Inyección directa al motor de video HTML5 (Imposible que falle)
              if (art.video) art.video.playbackRate = speed;

              art.notice.show = "Velocidad: " + speed + "x";

              panel
                .querySelectorAll("[data-speed]")
                .forEach((el) => el.classList.remove("active"));
              item.classList.add("active");
            });
          });

          // ==========================================
          // 2. Lógica para Aspecto (A prueba de balas)
          // ==========================================
          panel.querySelectorAll("[data-ratio]").forEach((item) => {
            item.addEventListener("click", () => {
              const ratio = item.getAttribute("data-ratio");

              // ArtPlayer calcula los píxeles aquí...
              art.aspectRatio = ratio;

              // ...pero si tu CSS lo está bloqueando, nosotros lo forzamos a obedecer con !important
              setTimeout(() => {
                if (art.video) {
                  if (ratio === "default") {
                    art.video.style.setProperty("width", "100%", "important");
                    art.video.style.setProperty("height", "100%", "important");
                  } else {
                    // Capturamos el cálculo de ArtPlayer y lo forzamos
                    art.video.style.setProperty(
                      "width",
                      art.video.style.width,
                      "important",
                    );
                    art.video.style.setProperty(
                      "height",
                      art.video.style.height,
                      "important",
                    );
                  }
                }
              }, 50);

              art.notice.show =
                "Aspecto: " + (ratio === "default" ? "Original" : ratio);

              panel
                .querySelectorAll("[data-ratio]")
                .forEach((el) => el.classList.remove("active"));
              item.classList.add("active");
            });
          });
          // ==========================================
          // 3. Lógica para Picture-in-Picture
          // ==========================================
          const pipBtn = panel.querySelector("#settings-pip-btn");
          if (pipBtn) {
            pipBtn.addEventListener("click", () => {
              panel.style.display = "none";
              if (document.pictureInPictureElement) {
                document.exitPictureInPicture().catch(console.error);
              } else {
                art.template.$video
                  .requestPictureInPicture()
                  .catch(console.error);
              }
            });
            // Actualizar texto según estado PiP
            art.template.$video.addEventListener("enterpictureinpicture", () => {
              pipBtn.textContent = "✖ Salir de PiP";
            });
            art.template.$video.addEventListener("leavepictureinpicture", () => {
              pipBtn.textContent = "📺 Imagen en Imagen (PiP)";
            });
          }
        }
      }, 150);

    } // end if (!isMobile)

    // =======================================================
    // 📑 BOTÓN Y PANEL: LISTA DE EPISODIOS (series, desktop y móvil)
    // =======================================================
    if (window.appState?.player?.activeSeriesId && window.innerWidth > 768) art.controls.add({
      name: "episodes-list",
      position: "right",
      index: 25,
      tooltip: "Episodios",
      html: '<i class="art-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="#ffffff"><path d="M4 10h12v2H4zm0-4h16v2H4zm0 8h8v2H4zm10 0v6l5-3z"></path></svg></i>',
    });

    if (window.appState?.player?.activeSeriesId && window.innerWidth > 768) this._epSetupTimer = setTimeout(() => {
        this._epSetupTimer = null;
        const epControl = this.container.querySelector(
          ".art-control-episodes-list",
        );
        if (!epControl) return;

        epControl.style.position = "relative";

        // Helpers para mostrar/ocultar usando setProperty con !important
        // — necesario porque el CSS tiene `display: flex !important` que gana al inline normal
        const showEpPanel = () =>
          epPanel.style.setProperty("display", "flex", "important");
        const hideEpPanel = () =>
          epPanel.style.setProperty("display", "none", "important");

        const epPanel = document.createElement("div");
        epPanel.className = "custom-cc-panel custom-settings-panel";
        const isMobileEp = window.innerWidth <= 768;
        // Posición base (no compite con !important del CSS externo)
        epPanel.style.cssText = "position:absolute; right:0; bottom:100%; z-index:100;";
        // Scroll y dimensiones con !important para ganarle al CSS externo
        const epMaxH = isMobileEp ? "55vh" : "40vh";
        const epMinW = isMobileEp ? "280px" : "320px";
        const epMaxW = isMobileEp ? "92vw" : "380px";
        epPanel.style.setProperty("max-height", epMaxH, "important");
        epPanel.style.setProperty("min-width", epMinW, "important");
        epPanel.style.setProperty("max-width", epMaxW, "important");
        epPanel.style.setProperty("overflow-y", "auto", "important");
        epPanel.style.setProperty("overflow-x", "hidden", "important");
        epPanel.style.setProperty("-webkit-overflow-scrolling", "touch", "important");
        epPanel.style.setProperty("overscroll-behavior", "contain", "important");
        hideEpPanel();
        epControl.appendChild(epPanel);
        epPanel.addEventListener("click", (e) => e.stopPropagation());

        const buildEpList = () => {
          // ✅ Leer desde window.appState (expuesto globalmente en script.js)
          const seriesId = window.appState?.player?.activeSeriesId;
          const state = window.appState?.player?.state?.[seriesId] || {};
          const season = state.season;
          const epIdx = state.episodeIndex ?? 0;

          const episodesData =
            window.appState?.content?.seriesEpisodes?.[seriesId] || {};
          const raw = episodesData[season];
          const epList = Array.isArray(raw) ? raw : Object.values(raw || {});

          if (!epList.length) return '<div class="cc-item">Sin episodios</div>';

          return epList
            .map((ep, idx) => {
              const isActive = idx === epIdx;
              const title = ep?.title || `Episodio ${idx + 1}`;
              const thumb = ep?.thumbnail || ep?.thumb || ep?.image || "";
              const thumbHtml = thumb
                ? `<img src="${thumb}" loading="lazy"
                     style="width:80px;min-width:80px;height:50px;object-fit:cover;border-radius:4px;display:block;"
                     onerror="this.style.display='none'">`
                : `<div style="width:80px;min-width:80px;height:50px;border-radius:4px;background:#1e1e2e;display:flex;align-items:center;justify-content:center;">
                     <svg width="18" height="18" fill="none" stroke="#555" stroke-width="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                   </div>`;
              return `<div class="ep-panel-item${isActive ? " active" : ""}" data-ep-idx="${idx}"
                style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;
                       border-bottom:1px solid rgba(255,255,255,0.06);
                       background:${isActive ? "rgba(var(--accent-color-rgb,229,115,26),0.18)" : "transparent"};
                       transition:background 0.15s;">
                ${thumbHtml}
                <div style="display:flex;flex-direction:column;gap:3px;min-width:0;flex:1;">
                  <span style="color:var(--accent-color);font-weight:700;font-size:0.72rem;line-height:1;">E${idx + 1}</span>
                  <span style="color:#fff;font-size:0.82rem;line-height:1.3;white-space:normal;word-break:break-word;">${title}</span>
                </div>
              </div>`;
            })
            .join("");
        };

        epPanel.addEventListener("click", (e) => {
          const item = e.target.closest(".ep-panel-item");
          if (!item) return;
          e.stopPropagation();
          const idx = parseInt(item.dataset.epIdx);
          const seriesId = window.appState?.player?.activeSeriesId;
          const season = window.appState?.player?.state?.[seriesId]?.season;

          hideEpPanel();

          const art = window.appState?.player?.activeCineInstance?.art;
          const isFullscreen = !!document.fullscreenElement;

          if (isFullscreen && art) {
            const episodesData =
              window.appState?.content?.seriesEpisodes?.[seriesId] || {};
            const episodes = episodesData[season] || [];
            const ep = episodes[idx];
            if (!ep) return;

            let savedLang = null;
            try {
              savedLang = (JSON.parse(localStorage.getItem("seriesLangPrefs")) ||
                {})[seriesId];
            } catch (_) {}
            const tracks = getLangTracks(ep);
            const activeLang =
              savedLang && tracks.some((t) => t.lang === savedLang)
                ? savedLang
                : window._spActiveLang || tracks[0]?.lang || "es";
            const track = tracks.find((t) => t.lang === activeLang) || tracks[0];

            let subId, subType;
            if (activeLang === "en" && ep.subId_en) {
              subId = ep.subId_en;
              subType = ep.subType_en || "srt";
            } else if (ep.subId_es) {
              subId = ep.subId_es;
              subType = ep.subType_es || "srt";
            } else {
              const cfg = ContentManager.getSubtitleConfig(ep);
              subId = cfg.subId;
              subType = cfg.subType;
            }

            const newVideoUrl = buildWorkerUrl("video", track.id);
            const newSubUrl = subId ? buildWorkerUrl("sub", subId) : null;

            const videoEl = art.video;
            videoEl.src = newVideoUrl;
            videoEl.load();
            art.once("video:canplay", () => {
              safePlay(art);
              hideEpPanel();
            });

            const cineInstSel = window.appState?.player?.activeCineInstance;

            // Limpiar sub anterior antes de asignar el nuevo (incluye
            // destruir el canvas .ass del episodio anterior si lo había)
            art.subtitle.show = false;
            art.subtitle.url = "";
            if (newSubUrl && subType === "srt") {
              cineInstSel?._clearAssPlugin?.();
              art.subtitle.url = newSubUrl;
              art.subtitle.show = true;
            } else if (newSubUrl && subType === "ass") {
              cineInstSel?._remountAssPlugin?.(newSubUrl);
            } else {
              cineInstSel?._clearAssPlugin?.();
            }

            // ✅ FIX: Actualizar el botón CC según el nuevo episodio.
            // En fullscreen el player NO se recrea, por eso hay que agregar/quitar
            // el botón manualmente cuando cambia la disponibilidad de subtítulos.
            const cineInst = window.appState?.player?.activeCineInstance;
            if (cineInst) cineInst._refreshCCButton(art, newSubUrl, subType);

            window.appState.player.state[seriesId] = {
              ...window.appState.player.state[seriesId],
              episodeIndex: idx,
            };
            window._spCurrentEpisodeData = {
              ...ep,
              _season: season,
              _index: idx,
            };
            window._spActiveLang = activeLang;

            _updateSpPsInfo(ep, season, seriesId, track.label || "", idx);

            const epListContainer = document.getElementById("sp-ps-episode-list");
            if (epListContainer) {
              epListContainer
                .querySelectorAll(".sp-episode-item")
                .forEach((el, i) => {
                  el.classList.toggle("active", i === idx);
                });
              epListContainer
                .querySelector(".sp-episode-item.active")
                ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }

            try {
              const allProgress =
                JSON.parse(localStorage.getItem("seriesProgress")) || {};
              if (!allProgress[seriesId]) allProgress[seriesId] = {};
              allProgress[seriesId][season] = idx;
              localStorage.setItem("seriesProgress", JSON.stringify(allProgress));
            } catch (_) {}

            // BUG FIX 1: actualizar pendingHistorySave para que al presionar
            // Volver se guarde el último episodio seleccionado desde el panel
            // de episodios en fullscreen (desktop), no el original.
            window.appState.player.pendingHistorySave = {
              contentId: seriesId,
              type: "series",
              episodeInfo: {
                season: season,
                index: idx,
                title: ep.title || "",
              },
            };

            return;
          }

          playEpisodeInDetailView(seriesId, season, idx);
        });

        epControl.addEventListener("click", (e) => {
          e.stopPropagation();
          const isHidden = epPanel.style.getPropertyValue("display") === "none";
          if (isHidden) {
            epPanel.innerHTML = buildEpList();
            showEpPanel();
            // Desplazar al episodio activo para que quede visible sin scroll manual
            requestAnimationFrame(() => {
              const activeItem = epPanel.querySelector(".ep-panel-item.active");
              if (activeItem) activeItem.scrollIntoView({ block: "nearest" });
            });
          } else {
            hideEpPanel();
          }
        });

        // Hover highlight via delegación (los items se recrean en cada apertura)
        epPanel.addEventListener("mouseover", (e) => {
          const item = e.target.closest(".ep-panel-item");
          if (item && !item.classList.contains("active"))
            item.style.background = "rgba(255,255,255,0.07)";
        });
        epPanel.addEventListener("mouseout", (e) => {
          const item = e.target.closest(".ep-panel-item");
          if (item && !item.classList.contains("active"))
            item.style.background = "transparent";
        });

        // Guardar referencia para poder eliminar el listener en el próximo load()
        this._epDocHandler = (e) => {
          if (!epControl.contains(e.target)) hideEpPanel();
        };
        document.addEventListener("click", this._epDocHandler);
      }, 150);
    // =======================================================

    return art;
  }
  // ===========================================================
  // 🎯 _mountAssPlugin: Carga artplayer-plugin-ass dinámicamente
  //
  //   Flujo:
  //     1. Cargar módulo ESM (cacheado globalmente con _assPluginModule)
  //     2. Fetch del .ass con detección proactiva de CORS / errores del Worker
  //     3. Parsear fuentes del archivo → mapear a CDN URLs
  //     4. Crear Blob URL del contenido (evita CORS en el Canvas renderer)
  //     5. Montar plugin en art.plugins → agrega canvas overlay automáticamente
  //     6. Revocar Blob URL tras carga (15s = tiempo suficiente para assjs)
  // ===========================================================
  async _mountAssPlugin(subUrl) {
    const myId = ++this._mountId;

    const ArtplayerPluginAss = await this._loadAssPlugin();
    if (myId !== this._mountId || !ArtplayerPluginAss || !this.art) return;

    const assContent = await this._fetchAssContent(subUrl);
    if (myId !== this._mountId) return;

    if (!assContent) {
      console.warn(
        "[CinePlayer] Subtítulos .ass no disponibles — reproductor continúa sin subs.",
      );
      return;
    }

    const { fontUrls, availableFonts } = this._extractFontsFromAss(assContent);

    const blobUrl = URL.createObjectURL(
      new Blob([assContent], { type: "text/plain; charset=utf-8" }),
    );

    try {
      // Las 4 variantes de Arimo en TTF — libass elige peso/estilo correcto por familia.
      // TTF requerido: libass dentro del worker WASM no puede parsear woff/woff2.
      // Cargamos las 4 variantes eager para que fontconfig pueda seleccionar
      // la negrita o cursiva correcta cuando el .ass lo pida (p.ej. Arial 700).
      const ARIMO_BASE =
        "https://cdn.jsdelivr.net/npm/@expo-google-fonts/arimo";
      const ARIMO_FONTS = [
        `${ARIMO_BASE}/400Regular/Arimo_400Regular.ttf`,
        `${ARIMO_BASE}/700Bold/Arimo_700Bold.ttf`,
        `${ARIMO_BASE}/400Regular_Italic/Arimo_400Regular_Italic.ttf`,
        `${ARIMO_BASE}/700Bold_Italic/Arimo_700Bold_Italic.ttf`,
      ];
      // Regular sigue siendo el anchor: es la URL que se registra en availableFonts
      // bajo la clave "arimo" para que fallbackFont tenga una URL válida que resolver.
      const EAGER_FALLBACK = ARIMO_FONTS[0];

      // fallbackFont espera un NOMBRE de fuente (no una URL).
      // La URL correspondiente debe existir en availableFonts bajo esa misma clave.
      const FALLBACK_FONT_NAME = "arimo";
      const availableFontsWithFallback = {
        ...availableFonts,
        [FALLBACK_FONT_NAME]: EAGER_FALLBACK,
      };

      const pluginInit = ArtplayerPluginAss({
        subUrl: blobUrl,

        // fonts[]: descarga eager — en VFS antes del frame 0.
        // Las 4 variantes de Arimo garantizan que fontconfig elija el peso/estilo
        // correcto cuando cualquier fuente de sistema caiga al fallback.
        // fontUrls contiene los sustitutos mapeados (Fira Sans, Tinos, etc.)
        // para los nombres que sí matchean en availableFonts.
        fonts: [...ARIMO_FONTS, ...fontUrls],

        // availableFonts: lazy fetch por nombre cuando libass pide una fuente
        // que aún no está en VFS. Las claves vienen en minúscula Y en caso original
        // del .ass (ver _extractFontsFromAss) para cubrir ambas estrategias de lookup.
        availableFonts: availableFontsWithFallback,

        // fallbackFont: NOMBRE de fuente (no URL) — debe existir en availableFonts.
        fallbackFont: FALLBACK_FONT_NAME,

        workerUrl: "/cinecorentatesteos/assests/js/jassub-worker.js",
        wasmUrl: "/cinecorentatesteos/assests/js/jassub-worker.wasm",
        legacyWasmUrl: "/cinecorentatesteos/assests/js/jassub-worker-legacy.js",
        libassMemoryLimit: 40,
        prescaleFactor: 0.8,
        dropAllAnimations: false,
        offscreenRender: false,
      });

      this._assPlugin = pluginInit(this.art);
      this.container._assPluginRef = this._assPlugin;

      // Esperar que JASSUB tenga todas las fuentes en el VFS de libass
      // antes de permitir el primer frame. Sin este await, libass cachea
      // "fuente no encontrada" en el frame 0 y nunca reintenta → canvas vacío.
      const wasPlaying = !this.art.video.paused;
      if (wasPlaying) this.art.video.pause();
      await this._assPlugin.instance.ready;
      if (wasPlaying) safePlay(this.art.video);

      console.log("[CinePlayer] Plugin ass montado:", this._assPlugin);
    } catch (err) {
      console.error(
        "[CinePlayer] Error al inicializar artplayer-plugin-jassub:",
        err,
      );
      URL.revokeObjectURL(blobUrl);
      return;
    }

    setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
  }

  // ===========================================================
  // 🧹 _clearAssPlugin: Destruye el canvas/worker ASS activo (si existe)
  //
  //   Necesario al cambiar de episodio sin recrear el <CinePlayer>
  //   (ej. botones siguiente/anterior en pantalla completa): si no se
  //   destruye, el canvas de JASSUB sigue renderizando los subtítulos
  //   .ass del capítulo anterior sobre el nuevo video.
  // ===========================================================
  _clearAssPlugin() {
    // Invalida cualquier _mountAssPlugin en vuelo (fetch del .ass anterior
    // que pudiera resolver tarde y reactivar subs viejos)
    this._mountId++;
    try {
      this._assPlugin?.instance?.destroy?.();
    } catch (_) {}
    try {
      this._assPlugin?.destroy?.();
    } catch (_) {}
    this._assPlugin = null;
    if (this.container) this.container._assPluginRef = null;
  }

  // ===========================================================
  // 🔁 _remountAssPlugin: Cambia los subtítulos .ass sin recrear el player
  //
  //   El plugin self-hosted (artplayer-plugin-jassub) no expone un
  //   `setTrack` real para cambiar de pista en caliente, así que la
  //   forma confiable de "cambiar" de subtítulo .ass es: destruir el
  //   canvas/worker actual y volver a montar el plugin con el nuevo .ass.
  // ===========================================================
  async _remountAssPlugin(subUrl) {
    this._clearAssPlugin();
    await this._mountAssPlugin(subUrl);
  }
  //
  //   Técnica "blob import":
  //     1. fetch() del .js remoto
  //     2. Crear Blob URL del mismo origen
  //     3. dynamic import() del blob (evita error "not a module" en algunos browsers)
  //     4. Revocar blob inmediatamente (el módulo ya está en memoria del engine)
  //     5. Cachear en _assPluginModule → todos los episodios usan la misma instancia
  // ===========================================================
  async _loadAssPlugin() {
    if (_assPluginModule) return _assPluginModule;
    if (_assPluginLoadPromise) return _assPluginLoadPromise;

    _assPluginLoadPromise = new Promise((resolve) => {
      // Script tag: los navegadores cargan scripts cross-origin
      // sin restricción CORS, a diferencia de fetch().
      // El build UMD expone window.artplayerPluginJassub como global.
      const existing = document.querySelector(
        `script[src="${ASS_PLUGIN_CDN}"]`,
      );
      if (existing) {
        // Ya fue inyectado antes (cambio de episodio rápido)
        _assPluginModule = window.artplayerPluginJassub ?? null;
        resolve(_assPluginModule);
        return;
      }

      const script = document.createElement("script");
      script.src = ASS_PLUGIN_CDN;
      script.async = true;

      script.onload = () => {
        _assPluginModule = window.artplayerPluginJassub ?? null;
        if (!_assPluginModule) {
          console.error(
            "[CinePlayer] artplayer-plugin-jassub cargó pero no expuso window.artplayerPluginJassub",
          );
        }
        resolve(_assPluginModule);
      };

      script.onerror = () => {
        console.error(
          "[CinePlayer] No se pudo cargar artplayer-plugin-jassub (self-hosted).",
        );
        _assPluginLoadPromise = null; // Permite reintento en el próximo episodio
        resolve(null);
      };

      document.head.appendChild(script);
    });

    return _assPluginLoadPromise;
  }

  // ===========================================================
  // 🔍 _fetchAssContent: Fetch robusto con detección de errores
  //
  //   Detecta y reporta:
  //     • CORS bloqueado (respuesta opaca / type !== 'cors')
  //     • HTTP 403/404 del Worker o de Google Drive
  //     • Worker devuelve HTML (página de error / redirect de auth)
  //     • Archivo no es .ass válido (sin [Script Info] ni [Events])
  //     • Error de red (offline, DNS, etc.)
  //     • Header x-deny-reason del proxy de Cloudflare (red interna)
  // ===========================================================
  async _fetchAssContent(subUrl) {
    try {
      const resp = await fetch(subUrl, {
        cache: "no-store", // Los subs de Drive no se deben cachear con URL vieja
      });

      // ── CORS: respuesta opaca = el Worker no envía los headers correctos ─
      if (resp.type === "opaque") {
        console.warn(
          "[CinePlayer] Subtítulo bloqueado por CORS (respuesta opaca).\n" +
            "Verifica que tu Cloudflare Worker incluya:\n" +
            "  'Access-Control-Allow-Origin': '*'\n" +
            "para requests de type=sub.",
        );
        return null;
      }

      // ── Errores HTTP ─────────────────────────────────────
      if (!resp.ok) {
        // x-deny-reason: header personalizado del Worker para diagnóstico
        const denyReason = resp.headers.get("x-deny-reason") ?? "";
        const detail = denyReason ? ` (${denyReason})` : "";

        if (resp.status === 403)
          console.warn(
            `[CinePlayer] .ass denegado por el servidor${detail}. Verifica el permiso del archivo en Drive.`,
          );
        else if (resp.status === 404)
          console.warn(
            `[CinePlayer] .ass no encontrado${detail}. Verifica el ID en tu base de datos.`,
          );
        else if (resp.status === 429)
          console.warn(
            `[CinePlayer] Rate limit del Worker al cargar .ass${detail}. Reintenta en unos segundos.`,
          );
        else
          console.warn(
            `[CinePlayer] Error HTTP ${resp.status} al cargar .ass${detail}.`,
          );
        return null;
      }

      // ── Content-Type: Worker debe devolver text/plain para subs ────────
      const ct = resp.headers.get("content-type") ?? "";
      if (ct.includes("text/html")) {
        console.warn(
          "[CinePlayer] El Worker devolvió HTML en lugar del .ass.\n" +
            "Causas probables:\n" +
            "  • Google Drive redirigió a página de login (archivo no público)\n" +
            "  • El Worker no tiene la ruta /?id=&type=sub implementada\n" +
            "Solución: asegúrate de que type=sub fuerza Content-Type: text/plain.",
        );
        return null;
      }

      const text = await resp.text();

      // ── Validar que realmente es un archivo .ass ─────────
      if (!text.includes("[Script Info]") && !text.includes("[Events]")) {
        console.warn(
          "[CinePlayer] La respuesta no parece ser un archivo .ass válido.\n" +
            "Contenido recibido (primeros 200 chars):\n" +
            text.slice(0, 200),
        );
        return null;
      }

      return text;
    } catch (err) {
      // TypeError: "Failed to fetch" → CORS sin cabeceras, red offline, etc.
      if (err.name === "TypeError") {
        console.warn(
          "[CinePlayer] Fetch del .ass falló (posible bloqueo CORS o red offline).\n" +
            "Error original:",
          err.message,
        );
      } else {
        console.warn("[CinePlayer] Error inesperado al cargar .ass:", err);
      }
      return null;
    }
  }

  // ===========================================================
  // 🔤 _extractFontsFromAss: Parsea fuentes del archivo .ass
  //
  //   Extrae de dos fuentes:
  //     1. Sección [V4+ Styles] → campo FontName de cada estilo definido
  //     2. Override tags inline  → \fn<nombre> dentro de los eventos
  //
  //   Luego mapea los nombres a URLs via ANIME_FONT_MAP.
  //   Las fuentes de sistema (Arial, Impact, etc.) se ignoran (sin URL).
  //
  //   Para fuentes propietarias no listadas en ANIME_FONT_MAP:
  //     → Pasa los Drive IDs en tu data como fontIds: ['1Abc...']
  //     → El Worker los servirá como /?id=1Abc&type=font
  //     → Agrégalos manualmente al array: fonts.push(buildWorkerUrl('font', id))
  // ===========================================================
  _extractFontsFromAss(assContent) {
    // Map lowercase → nombre original del .ass (para preservar capitalización exacta)
    const fontNames = new Map();
    const fontUrls = [];
    const availableFonts = {}; // { "Trebuchet MS": "https://cdn.../fira-sans.woff2", ... }

    // ── Leer de [V4+ Styles] ─────────────────────────────────
    // Formato de línea: Style: Name, Fontname, Fontsize, PrimaryColour, ...
    const stylesBlock = assContent.match(
      /\[V4\+?\s*Styles\]([\s\S]*?)(?=\n\[|$)/i,
    );
    if (stylesBlock) {
      for (const line of stylesBlock[1].split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("Style:")) {
          const parts = trimmed.split(",");
          // parts[0] = "Style: StyleName"  → ignorar
          // parts[1] = FontName
          if (parts[1]) {
            const original = parts[1].trim();
            fontNames.set(original.toLowerCase(), original);
          }
        }
      }
    }

    // ── Leer fuentes de override tags inline: {\fnFuente} ────
    const inlineRe = /\\fn([^\\{}\n]+)/g;
    let match;
    while ((match = inlineRe.exec(assContent)) !== null) {
      const original = match[1].trim();
      fontNames.set(original.toLowerCase(), original);
    }

    // ── Mapear nombres a URLs ─────────────────────────────────
    for (const [lower, original] of fontNames) {
      const url = ANIME_FONT_MAP[lower];
      if (url && url.length > 0) {
        availableFonts[lower] = url; // "arial" — por si JASSUB normaliza
        availableFonts[original] = url; // "Arial" — caso exacto del .ass  ← NUEVO
        fontUrls.push(url);
      }
    }

    // Log para debug (visible en DevTools cuando se analizan nuevos títulos)
    if (fontNames.size > 0) {
      const mapped = fontUrls.length;
      const unmapped = fontNames.size - mapped;
      const sysOrMiss = [...fontNames.keys()].filter(
        (n) => !ANIME_FONT_MAP[n] || ANIME_FONT_MAP[n] === "",
      );
      if (unmapped > 0) {
        console.info(
          `[CinePlayer] Fuentes .ass: ${mapped} mapeadas a CDN, ${sysOrMiss.length} de sistema/desconocidas:`,
          sysOrMiss,
        );
      }
    }

    const FALLBACK_URL =
      "https://cdn.jsdelivr.net/npm/@expo-google-fonts/arimo/400Regular/Arimo_400Regular.ttf";
    for (const genericName of ["arial", "sans-serif", "helvetica", "default"]) {
      if (!availableFonts[genericName]) {
        availableFonts[genericName] = FALLBACK_URL;
      }
    }

    return { fontUrls, availableFonts };
  }

  _mountIframeFallback(videoId) {
    let src = `https://streamtape.com/e/${videoId}/`;
    if (/^\d+$/.test(videoId))
      src = `https://ok.ru/videoembed/${videoId}?nochat=1`;

    this.container.innerHTML = `<iframe src="${src}" style="width:100%; height:100%; border:none;" allowfullscreen allow="autoplay; fullscreen; encrypted-media; picture-in-picture"></iframe>`;
  }

  async _pingWorker(url) {
    try {
      const resp = await fetch(url, { method: "HEAD", redirect: "manual" });
      if (
        resp.ok ||
        resp.status === 206 ||
        (resp.status >= 300 && resp.status < 400)
      )
        return true;
      if (resp.status === 405 || resp.status === 501) {
        const r2 = await fetch(url, {
          redirect: "manual",
          headers: { Range: "bytes=0-0" },
        });
        return (
          r2.ok ||
          r2.status === 206 ||
          r2.status === 416 ||
          (r2.status >= 300 && r2.status < 400)
        );
      }
      return false;
    } catch {
      return false;
    }
  }

  // ─── Detecta si el moov está al inicio del archivo (fast-start) ──────────
  // Hace un GET de los primeros 2 KB y parsea los boxes MP4.
  // Devuelve también el Content-Length total del archivo.
  async _detectFastStart(url) {
    try {
      const resp = await fetch(url, {
        headers: { Range: "bytes=0-2047" },
        redirect: "follow",
      });
      if (!resp.ok && resp.status !== 206)
        return { isFastStart: false, contentLength: null };

      // Content-Range: bytes 0-2047/TOTAL  →  extraer TOTAL
      const cr = resp.headers.get("content-range");
      const contentLength = cr
        ? parseInt(cr.split("/")[1], 10) || null
        : parseInt(resp.headers.get("content-length"), 10) || null;

      const buf = await resp.arrayBuffer();
      const view = new DataView(buf);
      let offset = 0;

      while (offset + 8 <= buf.byteLength) {
        const size = view.getUint32(offset);
        const type = String.fromCharCode(
          view.getUint8(offset + 4),
          view.getUint8(offset + 5),
          view.getUint8(offset + 6),
          view.getUint8(offset + 7),
        );
        if (type === "moov") return { isFastStart: true, contentLength };
        if (type === "mdat") return { isFastStart: false, contentLength };
        if (size < 8) break;
        offset += size;
      }
      return { isFastStart: false, contentLength };
    } catch {
      return { isFastStart: false, contentLength: null };
    }
  }

  // ─── Pre-fetch en pausa (estilo YouTube) ─────────────────────────────────
  // Mientras el video está REPRODUCIÉNDOSE no se hace ningún fetch extra: el
  // <video> nativo se encarga de su propio buffering sin competir por ancho
  // de banda con nada (esto es lo que causaba el "se queda cargando" en 3G /
  // Slow 4G). Cuando el usuario PAUSA, ahí sí se adelantan chunks por delante
  // del playhead — igual que YouTube llena la barra de buffer al pausar.
  // Al reanudar o buscar (seek), se corta de inmediato.
  //
  // Se respeta navigator.connection:
  //   - saveData / 2g / slow-2g → nunca se prefetchea, ni en pausa.
  //   - todo lo demás (3g, 4g, wifi, sin API) → prefetch normal en pausa.
  // ─── Pre-fetch en pausa Y durante reproducción (estilo YouTube) ──────────
  // En PAUSA: prefetch agresivo (varios chunks, 2 a la vez) — igual que antes.
  // REPRODUCIENDO: prefetch ligero (1 chunk de margen, 1 a la vez) en
  // conexiones razonables, para que el <video> nativo siempre tenga un
  // colchón extra cuando llega una escena de acción con bitrate más alto
  // (esto es lo que causa los "freezes" de medio segundo en anime/AV1).
  // En SEEK se reinicia el cálculo de "chunk actual" inmediatamente.
  // Se respeta navigator.connection:
  //   - saveData / 2g / slow-2g → nunca se prefetchea, ni en pausa ni jugando.
  //   - reproduciendo + 3g → no se prefetchea extra (evita competir con el
  //     buffering nativo, que es justo lo que rompía la reproducción en 3G).
  //   - reproduciendo + 4g / wifi / sin API → prefetch ligero permitido.
  _startPreFetch(url, contentLength, art) {
    const conn =
      navigator.connection ||
      navigator.mozConnection ||
      navigator.webkitConnection;

    const CHUNK = 4 * 1024 * 1024; // 4 MB por chunk

    // En pausa: igual de agresivo que antes (estilo "llenar la barra")
    const PAUSED_AHEAD = 4;
    const PAUSED_CONCURRENT = 2;

    // Reproduciendo, conexión "normal" (4g sin dato de downlink, o sin API):
    // colchón pequeño, sin arriesgarse a competir por ancho de banda
    const PLAYING_AHEAD_DEFAULT = 1;
    const PLAYING_CONCURRENT_DEFAULT = 1;

    // Reproduciendo, conexión RÁPIDA confirmada (downlink alto, ej. fibra):
    // colchón grande — igual de agresivo que en pausa, no hay riesgo real
    // de "robarle" ancho de banda al <video> nativo.
    const PLAYING_AHEAD_FAST = 6;
    const PLAYING_CONCURRENT_FAST = 3;
    const FAST_DOWNLINK_MBPS = 8; // ~8 Mbps+ ya sobra para cualquier 1080p

    const fetched = new Set();
    let stopped = false;
    let active = 0;

    // ─── Estado expuesto para el indicador de buffer ────────────────────
    // El indicador de red no puede usar art.video.buffered para medir este
    // pre-fetch (esos bytes van al caché HTTP, no al buffer del <video>).
    // En su lugar, exponemos chunks descargados + tamaño de chunk + bytes
    // totales para que el indicador calcule cuántos segundos de adelanto
    // representan los chunks contiguos ya cacheados por delante del playhead.
    this._prefetchState = {
      fetched,
      CHUNK,
      contentLength,
      getCurrentChunk: () =>
        art.duration > 0
          ? Math.floor(
              ((art.currentTime / art.duration) * contentLength) / CHUNK,
            )
          : 0,
    };

    // Conexión permite prefetch en pausa (igual de permisivo que antes)
    const connAllowsPaused = () => {
      if (!conn) return true;
      if (conn.saveData) return false;
      const type = conn.effectiveType;
      return !(type === "slow-2g" || type === "2g");
    };

    // Conexión permite prefetch ligero MIENTRAS SE REPRODUCE (más estricto:
    // solo 4g, wifi, o navegadores sin Network Information API)
    const connAllowsPlaying = () => {
      if (!conn) return true;
      if (conn.saveData) return false;
      const type = conn.effectiveType;
      return type === "4g" || type == null;
    };

    // ¿La conexión es claramente rápida (fibra/wifi bueno)? Si downlink no
    // está disponible (Safari, etc.) pero tampoco hay señales de conexión
    // lenta, se trata igual como "rápida" — mejor sobrar colchón que faltar.
    const connIsFast = () => {
      if (!conn) return true;
      if (conn.saveData) return false;
      const type = conn.effectiveType;
      if (type === "slow-2g" || type === "2g" || type === "3g") return false;
      if (typeof conn.downlink === "number") return conn.downlink >= FAST_DOWNLINK_MBPS;
      return true; // 4g/desconocido sin dato de downlink → asumir rápida
    };

    // ¿Cuánto margen / paralelismo corresponde según el estado actual?
    const currentLimits = () => {
      if (art.paused) {
        return connAllowsPaused()
          ? { ahead: PAUSED_AHEAD, concurrent: PAUSED_CONCURRENT }
          : null;
      }
      if (!connAllowsPlaying()) return null;
      return connIsFast()
        ? { ahead: PLAYING_AHEAD_FAST, concurrent: PLAYING_CONCURRENT_FAST }
        : { ahead: PLAYING_AHEAD_DEFAULT, concurrent: PLAYING_CONCURRENT_DEFAULT };
    };

    const fetchChunk = async (idx, maxConcurrent) => {
      if (stopped || fetched.has(idx) || active >= maxConcurrent) return;
      const start = idx * CHUNK;
      if (start >= contentLength) return;
      fetched.add(idx);
      active++;
      const end = Math.min(start + CHUNK - 1, contentLength - 1);
      try {
        const resp = await fetch(url, {
          headers: { Range: `bytes=${start}-${end}` },
        });
        await resp.arrayBuffer(); // consume el body → queda en caché HTTP
      } catch {
        fetched.delete(idx); // permitir reintento en el siguiente ciclo
      } finally {
        active--;
        pump(); // libera el "slot" → encadena el siguiente chunk si toca
      }
    };

    const pump = () => {
      if (stopped) return;
      const limits = currentLimits();
      if (!limits) return;

      const estimatedByte =
        art.duration > 0
          ? (art.currentTime / art.duration) * contentLength
          : 0;
      const currentChunk = Math.floor(estimatedByte / CHUNK);
      for (let i = 0; i <= limits.ahead; i++) {
        fetchChunk(currentChunk + i, limits.concurrent);
      }
    };

    // Cambios de estado relevantes → reevaluar y bombear
    const onStateChange = () => pump();

    // Seek → el "chunk actual" cambia de golpe; recalcular ya mismo
    const onSeeking = () => pump();

    // Mientras reproduce, recalcular cada pocos segundos para ir
    // "siguiendo" al playhead con el colchón ligero
    let lastTickPump = 0;
    const onTimeUpdate = () => {
      const now = Date.now();
      if (now - lastTickPump < 4000) return;
      lastTickPump = now;
      pump();
    };

    // Conexión cambió → reevaluar (puede habilitar o cortar el prefetch)
    const onConnChange = () => pump();

    art.on("play",       onStateChange);
    art.on("playing",    onStateChange);
    art.on("pause",      onStateChange);
    art.on("seeking",    onSeeking);
    art.on("timeupdate", onTimeUpdate);
    conn?.addEventListener?.("change", onConnChange);

    this._stopPreFetch = () => {
      stopped = true;
      this._prefetchState = null;
      art.off?.("play",       onStateChange);
      art.off?.("playing",    onStateChange);
      art.off?.("pause",      onStateChange);
      art.off?.("seeking",    onSeeking);
      art.off?.("timeupdate", onTimeUpdate);
      conn?.removeEventListener?.("change", onConnChange);
    };

    // Arranque inicial (poster / antes de darle play, o ya reproduciendo)
    pump();
  }

  // ─── 📶 Indicador de conexión + buffer ───────────────────────────────────
  // Ícono de señal (3 barras) en los controles:
  //   - Cantidad de barras encendidas = calidad de conexión (navigator.connection)
  //   - Color de las barras           = cuánto video hay bufferizado por
  //                                      delante del playhead (verde/amarillo/rojo)
  //   - Tooltip nativo (title)        = detalle en texto, ej. "4G · 38s de
  //                                      adelanto en buffer"
  // Solo desktop, igual que CC/episodios/ajustes.
  _setupNetworkIndicator(art) {
    if (window.innerWidth <= 768) return;

    const conn =
      navigator.connection ||
      navigator.mozConnection ||
      navigator.webkitConnection;

    const barsSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">' +
      '<rect class="cp-net-bar" x="2"  y="14" width="4" height="6"  rx="1"/>' +
      '<rect class="cp-net-bar" x="9"  y="9"  width="4" height="11" rx="1"/>' +
      '<rect class="cp-net-bar" x="16" y="4"  width="4" height="16" rx="1"/>' +
      "</svg>";

    art.controls.add({
      name: "net-indicator",
      position: "right",
      index: 5,
      html: `<i class="art-icon cp-net-indicator">${barsSvg}</i>`,
    });

    this._netIndicatorTimer = setTimeout(() => {
      this._netIndicatorTimer = null;
      const el = this.container.querySelector(".art-control-net-indicator");
      if (!el) return;
      el.style.cursor = "default";

      const bars = el.querySelectorAll(".cp-net-bar");

      // Cantidad de barras según la conexión (1 = mala/ahorro, 3 = buena/desconocida)
      const connInfo = () => {
        if (!conn) return { label: "Conexión", level: 3 };
        if (conn.saveData) return { label: "Ahorro de datos", level: 1 };
        switch (conn.effectiveType) {
          case "slow-2g": return { label: "2G lenta", level: 1 };
          case "2g":      return { label: "2G", level: 1 };
          case "3g":      return { label: "3G", level: 2 };
          case "4g":      return { label: "4G", level: 3 };
          default:        return { label: "Conexión", level: 3 };
        }
      };

      // Segundos de video ya bufferizados por delante del playhead actual
      const nativeBufferSeconds = () => {
        const buffered = art.video?.buffered;
        const current = art.currentTime || 0;
        if (!buffered) return 0;
        for (let i = 0; i < buffered.length; i++) {
          if (current >= buffered.start(i) - 0.5 && current <= buffered.end(i)) {
            return Math.max(0, buffered.end(i) - current);
          }
        }
        return 0;
      };

      // Segundos "adelantados" gracias al pre-fetch en pausa: cuenta los
      // chunks contiguos ya descargados (caché HTTP) por delante del
      // playhead y los convierte a segundos usando el bitrate estimado
      // (contentLength / duration).
      const prefetchBufferSeconds = () => {
        const pf = this._prefetchState;
        if (!pf || !art.duration) return 0;

        const { fetched, CHUNK, contentLength } = pf;
        const currentChunk = pf.getCurrentChunk();

        let aheadChunks = 0;
        let idx = currentChunk;
        while (fetched.has(idx)) {
          aheadChunks++;
          idx++;
        }
        if (aheadChunks === 0) return 0;

        const bytesPerSecond = contentLength / art.duration;
        if (bytesPerSecond <= 0) return 0;

        return (aheadChunks * CHUNK) / bytesPerSecond;
      };

      const bufferSeconds = () =>
        Math.max(nativeBufferSeconds(), prefetchBufferSeconds());

      const update = () => {
        const { label, level } = connInfo();
        const buf = bufferSeconds();

        let color;
        if (buf >= 20) color = "#4ade80";      // verde: buen margen
        else if (buf >= 5) color = "#facc15";  // amarillo: margen ajustado
        else color = "#f87171";                // rojo: casi sin buffer

        bars.forEach((bar, i) => {
          bar.setAttribute("fill", i < level ? color : "#5a5a5a");
        });

        const bufLabel =
          buf >= 1
            ? `${Math.round(buf)}s de adelanto en buffer`
            : "sin buffer adelantado";
        el.title = `${label} · ${bufLabel}`;
      };

      update();

      art.on("progress",   update);
      art.on("timeupdate", update);
      conn?.addEventListener?.("change", update);

      // El pre-fetch en pausa no dispara "timeupdate" (el video está
      // detenido), así que refrescamos por intervalo para reflejar los
      // chunks que se van cacheando mientras el usuario está pausado.
      const prefetchPoll = setInterval(update, 1000);

      this._netIndicatorCleanup = () => {
        conn?.removeEventListener?.("change", update);
        clearInterval(prefetchPoll);
      };
    }, 0);
  }

  _observeResize() {
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this._resizeObserver = new ResizeObserver(() => {
      if (this.art && typeof this.art.resize === "function") {
        this.art.resize();
      }
    });
    this._resizeObserver.observe(this.container);
  }

  showError(message) {
    destroyPrevious(this.container);
    this.container.innerHTML = buildErrorHTML(message);
  }

  destroy() {
    this._mountId++;
    this._stopPreFetch?.();
    this._stopPreFetch = null;
    clearTimeout(this._halfwayTimer);
    this._halfwayTimer = null;
    clearTimeout(this._netIndicatorTimer);
    this._netIndicatorTimer = null;
    this._netIndicatorCleanup?.();
    this._netIndicatorCleanup = null;
    this._resizeObserver?.disconnect();
    this._assPlugin = null;
    if (this._mobileDrawerBackdrop) {
      this._mobileDrawerBackdrop.remove();
      this._mobileDrawerBackdrop = null;
    }
    if (this._mobileDrawerEl) {
      this._mobileDrawerEl.remove();
      this._mobileDrawerEl = null;
    }
    destroyPrevious(this.container);
    this.container.innerHTML = "";
  }

  // ===========================================================
  // 📱 _setupMobileDrawer: Botones flotantes arriba-derecha +
  //   drawer desde abajo para CC / Episodios / Ajustes en móvil.
  //   Solo se monta si window.innerWidth <= 768.
  //   Se limpia automáticamente en load() al cambiar episodio.
  // ===========================================================
  _setupMobileDrawer(art, subUrl, subType) {
    // UA sniffing es frágil (falla en Chrome DevTools y tablets).
    // Detectamos por ancho real: <= 768px = mobile.
    const isMobile = () => window.innerWidth <= 768;
    if (!isMobile()) return;

    // Limpiar instancias anteriores (buscamos en $player para la pantalla completa)
    const oldOverlay = art.template.$player.querySelector(".cp-mobile-overlay");
    if (oldOverlay) oldOverlay.remove();
    const oldDrawerBg = art.template.$player.querySelector(
      ".cp-drawer-backdrop",
    );
    if (oldDrawerBg) oldDrawerBg.remove();
    const oldDrawer = art.template.$player.querySelector(".cp-drawer-mobile");
    if (oldDrawer) oldDrawer.remove();

    const hasSrtSubs = !!(subUrl && subType === "srt");

    // ── 1. Overlay de botones arriba a la derecha ─────────────
    const overlay = document.createElement("div");
    overlay.className = "cp-mobile-overlay";
    // Arranca con la misma visibilidad que la interfaz nativa
    overlay.style.setProperty(
      "opacity",
      art.controls.show ? "1" : "0",
      "important",
    );
    const btnStyle =
      "pointer-events:all !important; background:rgba(0,0,0,0.6) !important; backdrop-filter:blur(8px) !important; border:1px solid rgba(255,255,255,0.2) !important; border-radius:8px !important; width:38px !important; height:38px !important; display:flex !important; align-items:center !important; justify-content:center !important; cursor:pointer !important;";

    overlay.innerHTML = `
      <button class="cp-mob-btn" data-drawer="episodes" aria-label="Episodios" style="${btnStyle}">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M4 10h12v2H4zm0-4h16v2H4zm0 8h8v2H4zm10 0v6l5-3z"/></svg>
      </button>
      <button class="cp-mob-btn" data-drawer="cc" aria-label="Subtítulos" style="${btnStyle} display: ${hasSrtSubs ? "flex" : "none"} !important;">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 11H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h4v1.5H7.5v3h3.5V15zm8 0h-4c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h4v1.5h-3.5v3H19V15z"/></svg>
      </button>
      <button class="cp-mob-btn" data-drawer="settings" aria-label="Ajustes" style="${btnStyle}">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>
      </button>
    `;
    art.template.$player.appendChild(overlay);

    // Ocultar/Mostrar sincronizado con los controles nativos
    art.on("control", (state) => {
      overlay.style.setProperty("opacity", state ? "1" : "0", "important");
      const btns = overlay.querySelectorAll(".cp-mob-btn");
      btns.forEach((b) =>
        b.style.setProperty(
          "pointer-events",
          state ? "all" : "none",
          "important",
        ),
      );
    });

    // Cerrar menú por seguridad si el usuario sale de pantalla completa
    art.on("fullscreen", (isFullscreen) => {
      if (!isFullscreen) {
        const currentBackdrop = art.template.$player.querySelector(
          ".cp-drawer-backdrop",
        );
        const currentDrawer =
          art.template.$player.querySelector(".cp-drawer-mobile");
        if (currentBackdrop)
          currentBackdrop.classList.remove("cp-drawer-backdrop--open");
        if (currentDrawer)
          currentDrawer.classList.remove("cp-drawer-mobile--open");
      }
    });

    // ── 2. Drawer + backdrop (se añaden al $player para evitar clipping) ─
    const backdrop = document.createElement("div");
    backdrop.className = "cp-drawer-backdrop";
    art.template.$player.appendChild(backdrop);

    const drawer = document.createElement("div");
    drawer.className = "cp-drawer-mobile";
    drawer.innerHTML = `
      <div class="cp-drawer-content"></div>
      <div class="cp-drawer-handle"></div>
    `;
    art.template.$player.appendChild(drawer);

    const drawerContent = drawer.querySelector(".cp-drawer-content");

    // ── 3. Contenido por tipo ──────────────────────────────────
    const COLORS_MOB = [
      { hex: "#ffffff", label: "Blanco"   },
      { hex: "#000000", label: "Negro"    },
      { hex: "#ff0000", label: "Rojo"     },
      { hex: "#00cc00", label: "Verde"    },
      { hex: "#0088ff", label: "Azul"     },
      { hex: "#ffff00", label: "Amarillo" },
      { hex: "#ff00ff", label: "Magenta"  },
      { hex: "#00e5ff", label: "Cian"     },
    ];
    const buildCCContent = () => {
      let ccPrefsMob = {};
      try { ccPrefsMob = JSON.parse(localStorage.getItem("ccPrefs") || "{}"); } catch(_) {}
      const pSize   = parseInt(ccPrefsMob.size   ?? 20);
      const pColor  = ccPrefsMob.color  || "#ffffff";
      const pBg     = ccPrefsMob.bg     || "none";
      const pOutline= ccPrefsMob.outline !== false;
      const rawPos  = parseFloat(ccPrefsMob.pos ?? 85);
      const posLabel = rawPos <= 30 ? "Arriba" : rawPos <= 60 ? "Centro" : "Abajo";

      const colorDots = COLORS_MOB.map(c => `
        <div class="cp-cc-color-dot${pColor === c.hex ? " active" : ""}"
          data-cc-color="${c.hex}"
          style="background:${c.hex};width:32px;height:32px;border-radius:50%;cursor:pointer;border:2.5px solid ${pColor === c.hex ? "#fff" : "transparent"};flex-shrink:0;"
          title="${c.label}"></div>`).join("");

      const bgBtns = [
        { val: "none",             label: "Ninguno" },
        { val: "semi",             label: "Semi"    },
        { val: "rgba(0,0,0,0.95)", label: "Sólido"  },
      ].map(b => `<button class="cp-cc-bg-btn${pBg === b.val ? " active" : ""}" data-cc-bg="${b.val}"
        style="flex:1;padding:10px 0;border-radius:8px;border:1px solid rgba(255,255,255,${pBg===b.val?'0.5':'0.15'});background:${pBg===b.val?'rgba(255,255,255,0.12)':'transparent'};color:#fff;font-size:0.8rem;cursor:pointer;">${b.label}</button>`).join("");

      const stepBtn = "width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;font-size:1.2rem;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;";

      return `
        <div class="cp-drawer-title" style="padding:14px 20px 10px;font-size:1rem;font-weight:700;color:#fff;">Subtítulos</div>
        <div style="padding:0 20px 16px;display:flex;flex-direction:column;gap:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;color:#94a3b8;">TAMAÑO</span>
            <div style="display:flex;align-items:center;gap:12px;">
              <button id="cp-cc-size-minus" style="${stepBtn}">−</button>
              <span id="cp-cc-size-label" style="font-size:0.85rem;font-weight:700;color:#fff;min-width:40px;text-align:center;">${pSize}px</span>
              <button id="cp-cc-size-plus"  style="${stepBtn}">+</button>
            </div>
          </div>
          <div>
            <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;color:#94a3b8;margin-bottom:10px;">COLOR</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">${colorDots}</div>
          </div>
          <div>
            <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;color:#94a3b8;margin-bottom:8px;">FONDO</div>
            <div style="display:flex;gap:8px;">${bgBtns}</div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;color:#94a3b8;">CONTORNO</span>
            <div id="cp-cc-outline-toggle" style="width:42px;height:24px;border-radius:12px;background:${pOutline?'var(--accent-color,#3b82f6)':'rgba(255,255,255,0.15)'};cursor:pointer;position:relative;transition:background 0.2s;">
              <div style="position:absolute;top:3px;${pOutline?'right:3px':'left:3px'};width:18px;height:18px;border-radius:50%;background:#fff;transition:all 0.2s;"></div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;color:#94a3b8;">POSICIÓN</span>
            <div style="display:flex;align-items:center;gap:12px;">
              <button id="cp-cc-pos-up"   style="${stepBtn}">↑</button>
              <span id="cp-cc-pos-label" style="font-size:0.85rem;font-weight:700;color:#fff;min-width:48px;text-align:center;">${posLabel}</span>
              <button id="cp-cc-pos-down" style="${stepBtn}">↓</button>
            </div>
          </div>
        </div>`;
    };


    const buildSettingsContent = () => {
      const pipHtml = document.pictureInPictureEnabled
        ? `
        <div class="cp-drawer-section-label" style="margin-top:12px">MINIRREPRODUCTOR</div>
        <div class="cp-drawer-list">
          <div class="cp-drawer-item" id="cp-mob-pip">📺 Imagen en Imagen (PiP)</div>
        </div>`
        : "";
      return `
        <div class="cp-drawer-title">Ajustes</div>
        <div class="cp-drawer-section-label">VELOCIDAD</div>
        <div class="cp-drawer-speed-grid">
          <div class="cp-drawer-speed-item" data-speed="0.5">0.5x</div>
          <div class="cp-drawer-speed-item" data-speed="0.75">0.75x</div>
          <div class="cp-drawer-speed-item active" data-speed="1.0">1x</div>
          <div class="cp-drawer-speed-item" data-speed="1.25">1.25x</div>
          <div class="cp-drawer-speed-item" data-speed="1.5">1.5x</div>
          <div class="cp-drawer-speed-item" data-speed="2.0">2x</div>
        </div>
        <div class="cp-drawer-section-label" style="margin-top:12px">ASPECTO</div>
        <div class="cp-drawer-list">
          <div class="cp-drawer-item active" data-ratio="default">Original</div>
          <div class="cp-drawer-item" data-ratio="16:9">16:9</div>
          <div class="cp-drawer-item" data-ratio="4:3">4:3</div>
        </div>
        ${pipHtml}
      `;
    };

    const buildEpisodesContent = () => {
      const seriesId = window.appState?.player?.activeSeriesId;
      const state = window.appState?.player?.state?.[seriesId] || {};
      const season = state.season;
      const epIdx = state.episodeIndex ?? 0;
      const episodesData =
        window.appState?.content?.seriesEpisodes?.[seriesId] || {};
      const raw = episodesData[season];
      const epList = Array.isArray(raw) ? raw : Object.values(raw || {});

      if (!epList.length)
        return `
        <div class="cp-drawer-title">Episodios</div>
        <div style="padding:30px 20px;text-align:center;color:#4b5563;font-size:13px;font-family:Montserrat,sans-serif;">
          Sin episodios disponibles
        </div>`;

      const items = epList
        .filter(ep => String(ep?.proximamente || "").trim().toLowerCase() !== "si")
        .map((ep, idx) => {
          const isActive = idx === epIdx;
          const title = ep?.title || `Episodio ${idx + 1}`;
          const thumb = ep?.thumbnail || ep?.thumb || ep?.image || "";
          const playIcon = isActive
            ? `<div class="cp-ep-playing-icon">
               <svg width="16" height="16" viewBox="0 0 24 24" fill="#e50914">
                 <rect x="6" y="5" width="4" height="14" rx="1"/>
                 <rect x="14" y="5" width="4" height="14" rx="1"/>
               </svg>
             </div>`
            : "";

          const thumbHtml = thumb
            ? `<div class="cp-ep-thumb-wrap">
               <img src="${thumb}" loading="lazy"
                 onerror="this.style.display='none';this.parentNode.classList.add('cp-ep-no-thumb');this.parentNode.innerHTML+='<svg width=\\'22\\' height=\\'22\\' fill=\\'none\\' stroke=\\'#fff\\' stroke-width=\\'2\\' viewBox=\\'0 0 24 24\\'><polygon points=\\'5 3 19 12 5 21 5 3\\'/></svg>'">
               <span class="cp-ep-badge">E${idx + 1}</span>
             </div>`
            : `<div class="cp-ep-thumb-wrap cp-ep-no-thumb">
               <svg width="22" height="22" fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24">
                 <polygon points="5 3 19 12 5 21 5 3"/>
               </svg>
               <span class="cp-ep-badge">E${idx + 1}</span>
             </div>`;

          return `<div class="cp-ep-item${isActive ? " active" : ""}" data-ep-idx="${idx}">
          ${thumbHtml}
          <div class="cp-ep-info">
            <span class="cp-ep-num">Episodio ${idx + 1}</span>
            <span class="cp-ep-title">${title}</span>
          </div>
          ${playIcon}
        </div>`;
        })
        .join("");

      return `<div class="cp-drawer-title">Episodios — T${season}</div>
              <div class="cp-drawer-episode-list">${items}</div>`;
    };

    // ── 4. Abrir / cerrar drawer ───────────────────────────────
    const openDrawer = (type) => {
      switch (type) {
        case "cc":
          drawerContent.innerHTML = buildCCContent();
          break;
        case "settings":
          drawerContent.innerHTML = buildSettingsContent();
          break;
        case "episodes":
          drawerContent.innerHTML = buildEpisodesContent();
          break;
      }
      // Scroll al episodio activo
      if (type === "episodes") {
        setTimeout(() => {
          drawerContent
            .querySelector(".cp-ep-item.active")
            ?.scrollIntoView({ block: "center" });
        }, 50);
      }
      drawer.dataset.type = type;
      backdrop.classList.add("cp-drawer-backdrop--open");
      drawer.classList.add("cp-drawer-mobile--open");
      bindDrawerEvents(type);
    };

    const closeDrawer = () => {
      backdrop.classList.remove("cp-drawer-backdrop--open");
      drawer.classList.remove("cp-drawer-mobile--open");
    };

    // ── 5. Eventos dentro del drawer ──────────────────────────
    const bindDrawerEvents = (type) => {
      if (type === "cc") {
        const saveCCPrefsMob = (patch) => {
          let p = {};
          try { p = JSON.parse(localStorage.getItem("ccPrefs") || "{}"); } catch(_) {}
          Object.assign(p, patch);
          localStorage.setItem("ccPrefs", JSON.stringify(p));
        };
        const applySubStyle = () => {
          let p = {};
          try { p = JSON.parse(localStorage.getItem("ccPrefs") || "{}"); } catch(_) {}
          const color   = p.color   || "#ffffff";
          const bg      = p.bg      || "none";
          const outline = p.outline !== false;
          const bgColor = bg === "none" ? "transparent" : bg === "semi" ? "rgba(0,0,0,0.5)" : bg;
          const isTrans = bg === "none";
          art.subtitle.style({
            color,
            fontSize: `${parseInt(p.size ?? 20)}px`,
            backgroundColor: bgColor,
            padding: isTrans ? "0px" : "4px 12px",
            borderRadius: isTrans ? "0px" : "6px",
            textShadow: outline ? "1px 1px 3px rgba(0,0,0,0.9), -1px -1px 3px rgba(0,0,0,0.9)" : "none",
          });
          const posEl = document.getElementById("sp-subtitle-track") || art.template.$subtitle;
          if (posEl) posEl.style.bottom = `${p.pos ?? 85}%` === "85%" ? "" : `${100 - (p.pos ?? 85)}%`;
        };
        // Tamaño +/−
        const sizeLabel = drawerContent.querySelector("#cp-cc-size-label");
        const sizeMinus = drawerContent.querySelector("#cp-cc-size-minus");
        const sizePlus  = drawerContent.querySelector("#cp-cc-size-plus");
        const getSize = () => { let p={}; try{p=JSON.parse(localStorage.getItem("ccPrefs")||"{}")}catch(_){}; return parseInt(p.size??20); };
        if (sizeMinus) sizeMinus.addEventListener("click", () => {
          const v = Math.max(12, getSize() - 2);
          sizeLabel.textContent = v + "px";
          saveCCPrefsMob({ size: v });
          applySubStyle();
        });
        if (sizePlus) sizePlus.addEventListener("click", () => {
          const v = Math.min(40, getSize() + 2);
          sizeLabel.textContent = v + "px";
          saveCCPrefsMob({ size: v });
          applySubStyle();
        });
        // Colores
        drawerContent.querySelectorAll("[data-cc-color]").forEach(dot => {
          dot.addEventListener("click", () => {
            drawerContent.querySelectorAll("[data-cc-color]").forEach(d => {
              d.style.border = "2.5px solid transparent";
              d.classList.remove("active");
            });
            dot.style.border = "2.5px solid #fff";
            dot.classList.add("active");
            saveCCPrefsMob({ color: dot.dataset.ccColor });
            applySubStyle();
          });
        });
        // Fondo
        drawerContent.querySelectorAll("[data-cc-bg]").forEach(btn => {
          btn.addEventListener("click", () => {
            drawerContent.querySelectorAll("[data-cc-bg]").forEach(b => {
              b.style.background = "transparent";
              b.style.borderColor = "rgba(255,255,255,0.15)";
            });
            btn.style.background = "rgba(255,255,255,0.12)";
            btn.style.borderColor = "rgba(255,255,255,0.5)";
            saveCCPrefsMob({ bg: btn.dataset.ccBg });
            applySubStyle();
          });
        });
        // Contorno toggle
        const outlineToggle = drawerContent.querySelector("#cp-cc-outline-toggle");
        if (outlineToggle) outlineToggle.addEventListener("click", () => {
          let p = {};
          try { p = JSON.parse(localStorage.getItem("ccPrefs") || "{}"); } catch(_) {}
          const newVal = p.outline === false ? true : false;
          saveCCPrefsMob({ outline: newVal });
          outlineToggle.style.background = newVal ? "var(--accent-color,#3b82f6)" : "rgba(255,255,255,0.15)";
          outlineToggle.querySelector("div").style.cssText = `position:absolute;top:3px;${newVal?"right":"left"}:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:all 0.2s;`;
          applySubStyle();
        });
        // Posición ↑/↓ (3 pasos: Arriba=15, Centro=50, Abajo=85)
        const POS_STEPS = [{ label:"Arriba", val:15 },{ label:"Centro", val:50 },{ label:"Abajo", val:85 }];
        const posLabel  = drawerContent.querySelector("#cp-cc-pos-label");
        const posUp     = drawerContent.querySelector("#cp-cc-pos-up");
        const posDown   = drawerContent.querySelector("#cp-cc-pos-down");
        const getCurStep = () => {
          let p={}; try{p=JSON.parse(localStorage.getItem("ccPrefs")||"{}")}catch(_){}
          const v = parseFloat(p.pos ?? 85);
          return v <= 30 ? 0 : v <= 60 ? 1 : 2;
        };
        if (posUp) posUp.addEventListener("click", () => {
          const s = POS_STEPS[Math.max(0, getCurStep() - 1)];
          posLabel.textContent = s.label;
          saveCCPrefsMob({ pos: s.val });
          applySubStyle();
        });
        if (posDown) posDown.addEventListener("click", () => {
          const s = POS_STEPS[Math.min(2, getCurStep() + 1)];
          posLabel.textContent = s.label;
          saveCCPrefsMob({ pos: s.val });
          applySubStyle();
        });
      }

      if (type === "settings") {
        drawerContent.querySelectorAll("[data-speed]").forEach((el) => {
          el.addEventListener("click", () => {
            const speed = parseFloat(el.dataset.speed);
            art.playbackRate = speed;
            if (art.video) art.video.playbackRate = speed;
            art.notice.show = `Velocidad: ${speed}x`;
            drawerContent
              .querySelectorAll("[data-speed]")
              .forEach((e) => e.classList.remove("active"));
            el.classList.add("active");
          });
        });
        drawerContent.querySelectorAll("[data-ratio]").forEach((el) => {
          el.addEventListener("click", () => {
            art.aspectRatio = el.dataset.ratio;
            setTimeout(() => {
              if (art.video) {
                if (el.dataset.ratio === "default") {
                  art.video.style.setProperty("width", "100%", "important");
                  art.video.style.setProperty("height", "100%", "important");
                } else {
                  art.video.style.setProperty(
                    "width",
                    art.video.style.width,
                    "important",
                  );
                  art.video.style.setProperty(
                    "height",
                    art.video.style.height,
                    "important",
                  );
                }
              }
            }, 50);
            art.notice.show = `Aspecto: ${el.dataset.ratio === "default" ? "Original" : el.dataset.ratio}`;
            drawerContent
              .querySelectorAll("[data-ratio]")
              .forEach((e) => e.classList.remove("active"));
            el.classList.add("active");
          });
        });
        const pipBtn = drawerContent.querySelector("#cp-mob-pip");
        if (pipBtn) {
          pipBtn.addEventListener("click", () => {
            closeDrawer();
            if (document.pictureInPictureElement) {
              document.exitPictureInPicture().catch(console.error);
            } else {
              art.template.$video
                .requestPictureInPicture()
                .catch(console.error);
            }
          });
        }
      }

      if (type === "episodes") {
        drawerContent.querySelectorAll(".cp-ep-item").forEach((el) => {
          el.addEventListener("click", () => {
            const idx = parseInt(el.dataset.epIdx);
            const seriesId = window.appState?.player?.activeSeriesId;
            const season = window.appState?.player?.state?.[seriesId]?.season;
            closeDrawer();
            // Reusar la misma lógica fullscreen del panel de episodios
            const isFullscreen = !!document.fullscreenElement;
            if (isFullscreen && art) {
              const episodesData =
                window.appState?.content?.seriesEpisodes?.[seriesId] || {};
              const episodes = episodesData[season] || [];
              const ep = episodes[idx];
              if (!ep) return;

              let savedLang = null;
              try {
                savedLang = (JSON.parse(
                  localStorage.getItem("seriesLangPrefs"),
                ) || {})[seriesId];
              } catch (_) {}
              const tracks = getLangTracks(ep);
              const activeLang =
                savedLang && tracks.some((t) => t.lang === savedLang)
                  ? savedLang
                  : window._spActiveLang || tracks[0]?.lang || "es";
              const track =
                tracks.find((t) => t.lang === activeLang) || tracks[0];

              let epSubId, epSubType;
              if (activeLang === "en" && ep.subId_en) {
                epSubId = ep.subId_en;
                epSubType = ep.subType_en || "srt";
              } else if (ep.subId_es) {
                epSubId = ep.subId_es;
                epSubType = ep.subType_es || "srt";
              } else {
                const cfg = ContentManager.getSubtitleConfig(ep);
                epSubId = cfg.subId;
                epSubType = cfg.subType;
              }

              const newVideoUrl = buildWorkerUrl("video", track.id);
              const newSubUrl = epSubId ? buildWorkerUrl("sub", epSubId) : null;

              art.video.src = newVideoUrl;
              art.video.load();
              art.once("video:canplay", () => safePlay(art));

              const cineInstDrawer = window.appState?.player?.activeCineInstance;

              // Limpiar sub anterior antes de asignar el nuevo (incluye
              // destruir el canvas .ass del episodio anterior si lo había)
              art.subtitle.show = false;
              art.subtitle.url = "";
              if (newSubUrl && epSubType === "srt") {
                cineInstDrawer?._clearAssPlugin?.();
                art.subtitle.url = newSubUrl;
                art.subtitle.show = true;
              } else if (newSubUrl && epSubType === "ass") {
                cineInstDrawer?._remountAssPlugin?.(newSubUrl);
              } else {
                cineInstDrawer?._clearAssPlugin?.();
              }

              const cineInst = window.appState?.player?.activeCineInstance;
              if (cineInst)
                cineInst._refreshCCButton(art, newSubUrl, epSubType);

              window.appState.player.state[seriesId] = {
                ...window.appState.player.state[seriesId],
                episodeIndex: idx,
              };
              window._spCurrentEpisodeData = {
                ...ep,
                _season: season,
                _index: idx,
              };
              window._spActiveLang = activeLang;
              _updateSpPsInfo(ep, season, seriesId, track.label || "", idx);

              const epListContainer =
                document.getElementById("sp-ps-episode-list");
              if (epListContainer) {
                epListContainer
                  .querySelectorAll(".sp-episode-item")
                  .forEach((e, i) => e.classList.toggle("active", i === idx));
                epListContainer
                  .querySelector(".sp-episode-item.active")
                  ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }
              try {
                const allProgress =
                  JSON.parse(localStorage.getItem("seriesProgress")) || {};
                if (!allProgress[seriesId]) allProgress[seriesId] = {};
                allProgress[seriesId][season] = idx;
                localStorage.setItem(
                  "seriesProgress",
                  JSON.stringify(allProgress),
                );
              } catch (_) {}

              // BUG FIX 1: actualizar pendingHistorySave para que al presionar
              // Volver se guarde el último episodio seleccionado desde el drawer
              // de episodios en fullscreen (móvil), no el original.
              window.appState.player.pendingHistorySave = {
                contentId: seriesId,
                type: "series",
                episodeInfo: {
                  season: season,
                  index: idx,
                  title: ep.title || "",
                },
              };

              return;
            }
            playEpisodeInDetailView(seriesId, season, idx);
          });
        });
      }
    };

    // ── 6. Wiring botones del overlay ─────────────────────────
    overlay.querySelectorAll(".cp-mob-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openDrawer(btn.dataset.drawer);
      });
    });

    backdrop.addEventListener("click", closeDrawer);
    drawer
      .querySelector(".cp-drawer-handle")
      .addEventListener("click", closeDrawer);

    // Guardar referencia para limpiar en el próximo load()
    this._mobileDrawerBackdrop = backdrop;
    this._mobileDrawerEl = drawer;
  }

  // ===========================================================
  // 🔤 _refreshCCButton: Agregar o quitar el botón CC según si
  //   el episodio actual tiene subtítulos SRT.
  //
  //   Se llama desde dos lugares:
  //     1. load()         → player recién creado, siempre desde cero
  //     2. Fullscreen ep switch → player reutilizado, hay que sincronizar
  //        manualmente porque art.controls NO se recrea en este path.
  //
  //   Casos:
  //     • subUrl + subType==='srt' y botón ausente → agrega botón + panel
  //     • subUrl + subType==='srt' y botón presente → no hace nada (ya ok)
  //     • sin subUrl SRT y botón presente            → remueve botón
  //     • sin subUrl SRT y botón ausente             → no hace nada
  // ===========================================================
  _refreshCCButton(art, subUrl, subType) {
    // Limpiar timer/handler previos para evitar acumulación
    if (this._ccSetupTimer) {
      clearTimeout(this._ccSetupTimer);
      this._ccSetupTimer = null;
    }
    if (this._ccDocHandler) {
      document.removeEventListener("click", this._ccDocHandler);
      this._ccDocHandler = null;
    }

    const hasSrtSubs = !!(subUrl && subType === "srt");

    // ── NUEVO: Actualizar la visibilidad del botón flotante en móviles ──
    const mobileCcBtn = art.template.$player.querySelector(
      '.cp-mobile-overlay [data-drawer="cc"]',
    );
    if (mobileCcBtn) {
      mobileCcBtn.style.setProperty(
        "display",
        hasSrtSubs ? "flex" : "none",
        "important",
      );
    }
    // ────────────────────────────────────────────────────────────────────

    const existingBtn = this.container.querySelector(".art-control-cc-menu");

    // ── Sin subs SRT: quitar botón si existe ──────────────────
    if (!hasSrtSubs) {
      if (existingBtn) {
        try {
          art.controls.remove("cc-menu");
        } catch (_) {}
      }
      return;
    }

    // ── Con subs SRT: si el botón ya existe no hay nada que hacer ─
    if (existingBtn) return;

    // ── Con subs SRT: agregar botón + panel (solo desktop) ───
    if (window.innerWidth <= 768) return;

    const ccIconSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="#ffffff"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 11H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h4v1.5H7.5v3h3.5V15zm8 0h-4c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h4v1.5h-3.5v3H19V15z"/></svg>';

    art.controls.add({
      name: "cc-menu",
      position: "right",
      index: 10,
      tooltip: "Subtítulos",
      html: `<i class="art-icon">${ccIconSvg}</i>`,
    });

    // Esperar a que ArtPlayer monte el elemento en el DOM
    this._ccSetupTimer = setTimeout(() => {
      this._ccSetupTimer = null;
      const ccControl = this.container.querySelector(".art-control-cc-menu");
      if (!ccControl) return;

      ccControl.style.position = "relative";

      // ── Preferencias persistidas ──────────────────────────────
      let ccPrefs = {};
      try { ccPrefs = JSON.parse(localStorage.getItem("ccPrefs") || "{}"); } catch (_) {}
      const pSize   = parseInt(ccPrefs.size   ?? 20);
      const _validColors = ["#ffffff","#000000","#ff0000","#00cc00","#0088ff","#ffff00","#ff00ff","#00e5ff"];
      if (ccPrefs.color && !_validColors.includes(ccPrefs.color)) ccPrefs.color = "#ffffff";
      const pColor  = ccPrefs.color  ?? "#ffffff";
      const pBg     = ccPrefs.bg     ?? "transparent";
      const pBottom  = parseInt(ccPrefs.bottom  ?? 5);
      const pOutline = ccPrefs.outline ?? false;

      const savePrefs = (patch) => {
        Object.assign(ccPrefs, patch);
        try { localStorage.setItem("ccPrefs", JSON.stringify(ccPrefs)); } catch (_) {}
      };

      const applySubStyle = (s = {}) => {
        const bg      = s.bg     ?? ccPrefs.bg     ?? pBg;
        const isTrans = bg === "transparent";
        art.subtitle.style({
          fontSize:        (s.size   ?? ccPrefs.size   ?? pSize)   + "px",
          color:            s.color  ?? ccPrefs.color  ?? pColor,
          backgroundColor: bg,
          bottom:          (s.bottom ?? ccPrefs.bottom ?? pBottom) + "%",
          padding:         isTrans ? "0" : "3px 14px",
          borderRadius:    isTrans ? "0" : "5px",
          textShadow:      isTrans ? "0 1px 4px rgba(0,0,0,0.95)" : "none",
        });
      };
      applySubStyle();

      // ── Panel ─────────────────────────────────────────────────
      const panel = document.createElement("div");
      panel.className = "custom-cc-panel";
      // Posición y tamaño con !important para ganar al CSS externo
      panel.style.cssText = "position:absolute;right:auto;left:50%;transform:translateX(-50%);bottom:calc(100% + 8px);box-sizing:border-box;";
      panel.style.setProperty("width",      "290px", "important");
      panel.style.setProperty("min-width",  "290px", "important");
      panel.style.setProperty("padding",    "0",     "important");
      panel.style.setProperty("overflow",   "visible", "important");

      const COLORS = [
        { hex: "#ffffff", label: "Blanco"   },
        { hex: "#000000", label: "Negro"    },
        { hex: "#ff0000", label: "Rojo"     },
        { hex: "#00cc00", label: "Verde"    },
        { hex: "#0088ff", label: "Azul"     },
        { hex: "#ffff00", label: "Amarillo" },
        { hex: "#ff00ff", label: "Magenta"  },
        { hex: "#00e5ff", label: "Cian"     },
      ];
      const BG_OPTS = [
        { val: "transparent",       label: "Ninguno" },
        { val: "rgba(0,0,0,0.55)",  label: "Semi"    },
        { val: "rgba(0,0,0,0.90)",  label: "Sólido"  },
      ];

      const render = () => {
        const curSize   = parseInt(ccPrefs.size   ?? pSize);
        const curColor  = ccPrefs.color  ?? pColor;
        const curBg     = ccPrefs.bg     ?? pBg;
        const curBottom  = parseInt(ccPrefs.bottom  ?? pBottom);
        const curOutline = ccPrefs.outline ?? pOutline;
        const posLabel   = curBottom <= 6 ? "Abajo" : curBottom >= 40 ? "Arriba" : "Centro";

        panel.innerHTML = `
          <div style="
            background:linear-gradient(135deg,#1a1a2e,#16213e);
            border:1px solid rgba(255,255,255,0.1);
            border-radius:12px;
            box-shadow:0 8px 32px rgba(0,0,0,0.7);
            overflow:hidden;
          ">
            <!-- Cabecera -->
            <div style="
              padding:10px 16px;
              border-bottom:1px solid rgba(255,255,255,0.08);
              display:flex;align-items:center;gap:8px;
            ">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-color,#e5731a)" stroke-width="2.5">
                <rect x="2" y="4" width="20" height="16" rx="3"/><path d="M7 15h4m2 0h4M7 11h2m2 0h6"/>
              </svg>
              <span style="color:#fff;font-size:0.8rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">Subtítulos</span>
            </div>


            <div style="padding:10px 16px 14px;display:flex;flex-direction:column;gap:14px;">

              <!-- TAMAÑO -->
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="color:#aaa;font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase;">Tamaño</span>
                <div style="display:flex;align-items:center;gap:8px;">
                  <button id="cc-size-minus" style="width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.07);color:#fff;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">−</button>
                  <span id="cc-size-val" style="color:var(--accent-color,#e5731a);font-size:0.78rem;font-weight:700;min-width:36px;text-align:center;">${curSize}px</span>
                  <button id="cc-size-plus"  style="width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.07);color:#fff;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">+</button>
                </div>
              </div>

              <!-- COLOR -->
              <div>
                <span style="color:#aaa;font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase;display:block;margin-bottom:8px;">Color</span>
                <div style="display:flex;gap:6px;justify-content:center;">
                  ${COLORS.map(c => `
                    <div class="cc-color-swatch" data-color="${c.hex}" title="${c.label}" style="
                      width:22px;height:22px;border-radius:50%;background:${c.hex};cursor:pointer;
                      border:2px solid ${curColor===c.hex?"var(--accent-color,#e5731a)":"rgba(255,255,255,0.15)"};
                      box-shadow:${curColor===c.hex?"0 0 0 1px var(--accent-color,#e5731a)":"none"};
                      transition:all 0.15s;flex-shrink:0;
                    "></div>`).join("")}
                </div>
              </div>

              <!-- FONDO -->
              <div>
                <span style="color:#aaa;font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase;display:block;margin-bottom:8px;">Fondo</span>
                <div style="display:flex;gap:6px;">
                  ${BG_OPTS.map(o => `
                    <button class="cc-bg-btn" data-bg="${o.val}" style="
                      flex:1;padding:6px 4px;border-radius:6px;font-size:0.76rem;cursor:pointer;
                      border:1px solid ${curBg===o.val?"var(--accent-color,#e5731a)":"rgba(255,255,255,0.12)"};
                      background:${curBg===o.val?"rgba(229,115,26,0.18)":"rgba(255,255,255,0.05)"};
                      color:${curBg===o.val?"var(--accent-color,#e5731a)":"#ccc"};
                      font-weight:${curBg===o.val?"700":"400"};
                      transition:all 0.15s;
                    ">${o.label}</button>`).join("")}
                </div>
              </div>

              <!-- CONTORNO -->
              <div>
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span style="color:#aaa;font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase;">Contorno</span>
                  <button id="cc-outline-btn" style="
                    width:40px;height:22px;border-radius:11px;border:none;cursor:pointer;
                    background:${curOutline ? 'var(--accent-color,#e5731a)' : 'rgba(255,255,255,0.1)'};
                    position:relative;transition:background 0.2s;flex-shrink:0;
                  ">
                    <span style="
                      position:absolute;top:3px;
                      left:${curOutline ? '21px' : '3px'};
                      width:16px;height:16px;border-radius:50%;
                      background:#fff;transition:left 0.2s;
                    "></span>
                  </button>
                </div>
              </div>

              <!-- POSICIÓN -->
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="color:#aaa;font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase;">Posición</span>
                <div style="display:flex;align-items:center;gap:8px;">
                  <button id="cc-pos-up"   style="width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.07);color:#fff;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">↑</button>
                  <span id="cc-pos-label" style="color:var(--accent-color,#e5731a);font-size:0.78rem;font-weight:700;min-width:44px;text-align:center;">${posLabel}</span>
                  <button id="cc-pos-down" style="width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.07);color:#fff;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">↓</button>
                </div>
              </div>

            </div>
          </div>
        `;



        // — Tamaño —
        const sizeVal   = panel.querySelector("#cc-size-val");
        const sizeMinus = panel.querySelector("#cc-size-minus");
        const sizePlus  = panel.querySelector("#cc-size-plus");
        const getSize = () => parseInt(ccPrefs.size ?? pSize);
        sizeMinus.addEventListener("click", () => {
          const v = Math.max(12, getSize() - 2);
          sizeVal.textContent = v + "px";
          savePrefs({ size: v });
          applySubStyle({ size: v });
        });
        sizePlus.addEventListener("click", () => {
          const v = Math.min(44, getSize() + 2);
          sizeVal.textContent = v + "px";
          savePrefs({ size: v });
          applySubStyle({ size: v });
        });

        // — Color —
        panel.querySelectorAll(".cc-color-swatch").forEach(sw => {
          sw.addEventListener("click", () => {
            savePrefs({ color: sw.dataset.color });
            applySubStyle({ color: sw.dataset.color });
            render();
          });
        });

        // — Fondo —
        panel.querySelectorAll(".cc-bg-btn").forEach(btn => {
          btn.addEventListener("click", () => {
            savePrefs({ bg: btn.dataset.bg });
            applySubStyle({ bg: btn.dataset.bg });
            render();
          });
        });

        // — Contorno —
        panel.querySelector("#cc-outline-btn").addEventListener("click", () => {
          const next = !(ccPrefs.outline ?? pOutline);
          savePrefs({ outline: next });
          applySubStyle({ outline: next });
          render();
        });

        // — Posición —
        const POS_STEPS = [{ label:"Abajo", val:5 },{ label:"Centro", val:25 },{ label:"Arriba", val:45 }];
        const posLbl  = panel.querySelector("#cc-pos-label");
        const posUp   = panel.querySelector("#cc-pos-up");
        const posDown = panel.querySelector("#cc-pos-down");
        const getCurStep = () => {
          const v = parseInt(ccPrefs.bottom ?? pBottom);
          return v <= 6 ? 0 : v >= 40 ? 2 : 1;
        };
        posUp.addEventListener("click", () => {
          const s = POS_STEPS[Math.min(2, getCurStep() + 1)];
          posLbl.textContent = s.label;
          savePrefs({ bottom: s.val });
          applySubStyle({ bottom: s.val });
        });
        posDown.addEventListener("click", () => {
          const s = POS_STEPS[Math.max(0, getCurStep() - 1)];
          posLbl.textContent = s.label;
          savePrefs({ bottom: s.val });
          applySubStyle({ bottom: s.val });
        });
      };

      render();
      ccControl.appendChild(panel);
      panel.style.display = "none";
      panel.addEventListener("click", e => e.stopPropagation());

      ccControl.addEventListener("click", (e) => {
        e.stopPropagation();
        if (panel.style.display === "none") { render(); panel.style.display = "block"; }
        else panel.style.display = "none";
      });

      this._ccDocHandler = (e) => {
        if (!ccControl.contains(e.target)) panel.style.display = "none";
      };
      document.addEventListener("click", this._ccDocHandler);
    }, 150);
  }
}

// ===========================================================
// 🌐 HELPER: OBTENER TRACKS DE AUDIO DISPONIBLES DINÁMICAMENTE
// ===========================================================
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

  if (rawJp) {
    tracks.push({ id: rawJp, lang: "jp", label: originalLabels[1] || "Alt" });
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

  return tracks;
}

function buildLangButtonsHTML(tracks, activeLang, cssClass) {
  if (tracks.length <= 1) return "";
  return `<div class="movie-lang-selection">
        ${tracks
          .map(
            (t) => `
            <button class="${cssClass} ${t.lang === activeLang ? "active" : ""}" data-lang="${t.lang}">
                ${t.label}
            </button>`,
          )
          .join("")}
    </div>`;
}

// 🔥 BUSCADOR INTELIGENTE EN TODAS LAS SAGAS
function findContentData(id) {
  const content = shared.appState.content;

  if (content.movies && content.movies[id]) return content.movies[id];
  if (content.series && content.series[id]) return content.series[id];
  if (content.ucm && content.ucm[id]) return content.ucm[id];

  if (content.sagas) {
    for (const sagaKey in content.sagas) {
      const sagaData = content.sagas[sagaKey];
      if (sagaData && sagaData[id]) {
        return sagaData[id];
      }
    }
  }
  return null;
}

function saveProgress(seriesId) {
  try {
    let allProgress = JSON.parse(localStorage.getItem("seriesProgress")) || {};
    if (!allProgress[seriesId]) allProgress[seriesId] = {};
    const currentState = shared.appState.player.state[seriesId];
    allProgress[seriesId][currentState.season] = currentState.episodeIndex;
    localStorage.setItem("seriesProgress", JSON.stringify(allProgress));
  } catch (e) {
    logError(e, "Player: Save Progress", "warning");
  }
}

function loadProgress(seriesId, seasonNum) {
  try {
    const allProgress = JSON.parse(localStorage.getItem("seriesProgress"));
    return allProgress?.[seriesId]?.[seasonNum] || 0;
  } catch (e) {
    return 0;
  }
}

export function commitAndClearPendingSave() {
  if (shared.appState.player.pendingHistorySave) {
    try {
      shared.addToHistoryIfLoggedIn(
        shared.appState.player.pendingHistorySave.contentId,
        shared.appState.player.pendingHistorySave.type,
        shared.appState.player.pendingHistorySave.episodeInfo,
      );
    } catch (e) {
      logError(e, "Player: History Commit");
    }
    shared.appState.player.pendingHistorySave = null;
  }
}

function _openSeriesPlayerPage() {
  const sections = [
    "hero-section",
    "carousel-container",
    "full-grid-container",
    "my-list-container",
    "history-container",
    "profile-container",
    "settings-container",
    "profile-hub-container",
    "sagas-hub-container",
    "reviews-container",
    "reports-container",
    "filter-controls",
    "live-tv-section",
    "iptv-section",
    "continue-watching-carousel",
    "continue-watching-container",
  ];
  sections.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  // Cerrar detail-view si estaba abierto
  const detailView = document.getElementById("detail-view");
  if (detailView) {
    detailView.classList.remove("visible", "detail-view--playing");
    detailView.style.display = "none";
  }
  // Restaurar el <main> que openDetailsModal oculta
  const mainEl = document.querySelector("main");
  if (mainEl) mainEl.style.display = "";

  const page =
    shared.DOM.seriesPlayerModal ||
    document.getElementById("series-player-page");
  if (!page) {
    console.error("[Player] #series-player-page no encontrado en el DOM");
    return;
  }
  shared.DOM.seriesPlayerModal = page;

  page.style.display = "block";
  page.classList.add("active");
  // En mobile el player es fixed/full-screen: scrollear el window causa
  // un flash visual innecesario. Solo hacemos scroll si el page en sí
  // tiene scroll interno (overflow-y: auto, como en desktop).
  if (page.scrollHeight > page.clientHeight) {
    page.scrollTo({ top: 0, behavior: "instant" });
  }
}

export function closeSeriesPlayerModal() {
  clearTimeout(shared.appState.player.episodeOpenTimer);
  commitAndClearPendingSave();

  // ✅ NUEVO: Regenerar carrusel "Continuar Viendo" después de guardar historial
  const user = shared.auth?.currentUser;
  if (user) {
    shared.db
      .ref(`users/${user.uid}/history`)
      .orderByChild("viewedAt")
      .once("value", (snapshot) => {
        const existing = document.getElementById("continue-watching-carousel");
        if (existing) existing.remove();
        if (
          snapshot.exists() &&
          typeof window.generateContinueWatchingCarousel === "function"
        ) {
          window.generateContinueWatchingCarousel(snapshot);
        }
      });
  }

  const page = shared.DOM.seriesPlayerModal;
  page.classList.remove("active", "season-grid-view", "player-layout-view");
  page.style.display = "none";

  // Restaurar scroll del body en caso de que el sheet de temporadas
  // lo haya bloqueado y el usuario cierre el player sin cerrar el sheet.
  document.body.style.overflow = "";

  if (shared.appState.player.activeCineInstance) {
    shared.appState.player.activeCineInstance.destroy();
    shared.appState.player.activeCineInstance = null;
  }

  shared.appState.player.activeSeriesId = null;
  if (shared.switchView)
    shared.switchView(shared.appState.currentFilter || "all");
}

export async function openSeriesPlayer(seriesId, forceSeasonGrid = false) {
  try {
    shared.closeAllModals();

    const seriesInfo = findContentData(seriesId);

    if (!seriesInfo) {
      console.warn(`Serie ID no encontrado: ${seriesId}`);
      shared.ErrorHandler.show("content", "No se encontró la serie.");
      return;
    }

    _openSeriesPlayerPage();

    shared.DOM.seriesPlayerModal.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
                <div class="spinner"></div>
            </div>`;

    const seriesEpisodes =
      shared.appState.content.seriesEpisodes[seriesId] || {};
    const postersData = shared.appState.content.seasonPosters[seriesId] || {};

    const allSeasonsKeys = [
      ...new Set([...Object.keys(seriesEpisodes), ...Object.keys(postersData)]),
    ];

    let orderedKeys;
    if (
      shared.appState.content.seasonOrder &&
      shared.appState.content.seasonOrder[seriesId]
    ) {
      orderedKeys = shared.appState.content.seasonOrder[seriesId];
    } else {
      orderedKeys = [...allSeasonsKeys].sort((a, b) => {
        const posterA = postersData[a];
        const posterB = postersData[b];
        const ordenA =
          posterA &&
          typeof posterA === "object" &&
          posterA.orden !== undefined &&
          posterA.orden !== ""
            ? Number(posterA.orden)
            : null;
        const ordenB =
          posterB &&
          typeof posterB === "object" &&
          posterB.orden !== undefined &&
          posterB.orden !== ""
            ? Number(posterB.orden)
            : null;
        if (ordenA !== null && ordenB !== null) return ordenA - ordenB;
        if (ordenA !== null) return -1;
        if (ordenB !== null) return 1;
        const isNumericA = !isNaN(Number(a)) && String(a).trim() !== "";
        const isNumericB = !isNaN(Number(b)) && String(b).trim() !== "";
        if (isNumericA && isNumericB) return Number(a) - Number(b);
        if (isNumericA) return -1;
        if (isNumericB) return 1;
        return 0;
      });
    }

    const seasonsMapped = orderedKeys
      .filter((k) => allSeasonsKeys.includes(k))
      .map((k) => ({ key: k, num: !isNaN(k) ? Number(k) : 0 }));

    if (forceSeasonGrid && seasonsMapped.length > 1) {
      renderSeasonGrid(seriesId);
      return;
    }

    let targetSeasonKey = null;

    for (const s of seasonsMapped) {
      const seasonKey = s.key;

      const posterEntry = postersData[seasonKey];
      let seasonStatus = "";
      if (posterEntry && typeof posterEntry === "object") {
        seasonStatus = String(posterEntry.estado || "")
          .toLowerCase()
          .trim();
      }

      const eps = seriesEpisodes[seasonKey];
      const hasEpisodes =
        eps &&
        (Array.isArray(eps) ? eps.length > 0 : Object.keys(eps).length > 0);

      const isManuallyLocked =
        seasonStatus !== "" && seasonStatus !== "disponible";
      const isLocked =
        isManuallyLocked || (!hasEpisodes && seasonStatus !== "disponible");

      if (!isLocked) {
        targetSeasonKey = seasonKey;
        break;
      }
    }

    if (targetSeasonKey) {
      const user = shared.auth.currentUser;
      let resumeSeason = targetSeasonKey;
      let lastWatchedEpisode = 0;

      if (user) {
        try {
          const allProgress =
            JSON.parse(localStorage.getItem("seriesProgress")) || {};
          const seriesProgress = allProgress[seriesId] || {};

          // Buscar la última temporada con progreso, en orden
          const validKeys = seasonsMapped
            .map((s) => s.key)
            .filter((k) => {
              const pe = postersData[k];
              const status =
                pe && typeof pe === "object"
                  ? String(pe.estado || "")
                      .toLowerCase()
                      .trim()
                  : "";
              const eps = seriesEpisodes[k];
              const hasEps =
                eps &&
                (Array.isArray(eps)
                  ? eps.length > 0
                  : Object.keys(eps).length > 0);
              const locked =
                (status !== "" && status !== "disponible") ||
                (!hasEps && status !== "disponible");
              return !locked;
            });

          const seasonsWithProgress = validKeys.filter(
            (k) => seriesProgress[k] != null && seriesProgress[k] > 0,
          );

          if (seasonsWithProgress.length > 0) {
            // Tomar la última temporada con progreso registrado
            resumeSeason = seasonsWithProgress[seasonsWithProgress.length - 1];
            lastWatchedEpisode = seriesProgress[resumeSeason];
          }
        } catch (e) {
          // fallback silencioso → T1 E1
        }
      }

      renderEpisodePlayer(seriesId, resumeSeason, lastWatchedEpisode);
    } else {
      if (seasonsMapped.length > 0) {
        renderSeasonGrid(seriesId);
      } else {
        shared.DOM.seriesPlayerModal.innerHTML = `
                    <button class="close-btn streaming-back-btn"><i class="fas fa-arrow-left"></i> Volver</button>
                    <div style="text-align:center; padding: 20px; color: white;">
                        <h2>${seriesInfo.title}</h2>
                        <p>Próximamente disponible.</p>
                    </div>`;
        shared.DOM.seriesPlayerModal.querySelector(".close-btn").onclick =
          closeSeriesPlayerModal;
      }
    }
  } catch (error) {
    logError(error, "Player: Critical Crash");
    shared.ErrorHandler.show(
      "unknown",
      "Error al abrir el reproductor de series.",
    );
  }
}

function renderSeasonGrid(seriesId) {
  const seriesInfo = findContentData(seriesId);
  if (!seriesInfo) return;

  shared.DOM.seriesPlayerModal.className =
    "series-player-page active season-grid-view";

  shared.DOM.seriesPlayerModal.innerHTML = `
        <button class="close-btn streaming-back-btn"><i class="fas fa-arrow-left"></i> Volver</button>
        <div class="season-grid-container">
            <h2 class="player-title">${seriesInfo.title}</h2>
            <div id="season-grid" class="season-grid"></div>
        </div>
    `;

  shared.DOM.seriesPlayerModal.querySelector(".close-btn").onclick =
    closeSeriesPlayerModal;
  populateSeasonGrid(seriesId);
  shared.appState.player.activeSeriesId = null;
}

function populateSeasonGrid(seriesId) {
  const container = shared.DOM.seriesPlayerModal.querySelector("#season-grid");

  function formatSeasonName(seasonKey, seasonNum, customLabel = null) {
    if (customLabel && customLabel.trim()) return customLabel.trim();

    const keyLower = String(seasonKey).toLowerCase();

    if (
      keyLower.includes("pelicula") ||
      keyLower.includes("película") ||
      keyLower === "pelicula"
    )
      return "Película";
    if (keyLower.includes("especial") || keyLower === "especial")
      return "Especial";
    if (keyLower.includes("ova") || keyLower === "ova") return "OVA";
    if (keyLower.includes("movie") || keyLower === "movie") return "Película";
    if (keyLower.includes("special") || keyLower === "special")
      return "Especial";

    return `Temporada ${seasonNum}`;
  }

  const episodesData = shared.appState.content.seriesEpisodes[seriesId] || {};
  const postersData = shared.appState.content.seasonPosters[seriesId] || {};
  const seriesInfo = findContentData(seriesId);

  if (!seriesInfo) {
    console.error("No se encontró info para la serie:", seriesId);
    return;
  }

  if (!container) return;
  container.innerHTML = "";

  let allSeasons;

  if (
    shared.appState.content.seasonOrder &&
    shared.appState.content.seasonOrder[seriesId]
  ) {
    allSeasons = shared.appState.content.seasonOrder[seriesId];
  } else {
    const episodeSeasons = Object.keys(episodesData);
    const posterSeasons = Object.keys(postersData);
    allSeasons = [...new Set([...episodeSeasons, ...posterSeasons])];
  }

  const seasonsMapped = allSeasons.map((key) => ({
    key,
    num: !isNaN(key) ? Number(key) : 0,
  }));
  const totalSeasons = seasonsMapped.length;

  let columns = 5;
  if (totalSeasons <= 5) columns = totalSeasons;
  else if (totalSeasons === 6) columns = 3;
  else if (totalSeasons === 7 || totalSeasons === 8) columns = 4;
  else columns = 5;

  container.style.gridTemplateColumns = `repeat(${columns}, 200px)`;
  container.style.justifyContent = "center";
  container.style.maxWidth = `${columns * 200 + (columns - 1) * 20}px`;

  seasonsMapped.forEach(({ key: seasonKey, num: seasonNum }) => {
    const rawEpisodes = episodesData[seasonKey];
    const episodes = rawEpisodes
      ? Array.isArray(rawEpisodes)
        ? rawEpisodes
        : Object.values(rawEpisodes)
      : [];

    let posterUrl = seriesInfo.poster || "";
    let seasonStatus = "";
    let seasonStatusRaw = "";
    let seasonCustomLabel = "";

    const posterEntry = postersData[seasonKey];
    if (posterEntry) {
      if (typeof posterEntry === "object") {
        posterUrl = posterEntry.posterUrl || posterEntry.poster || posterUrl;
        seasonStatusRaw = String(posterEntry.estado || "").trim();
        seasonStatus = seasonStatusRaw.toLowerCase();
        seasonCustomLabel = String(posterEntry.etiqueta || "").trim();
      } else {
        posterUrl = posterEntry;
      }
    }

    const totalEpisodes = episodes.length;
    const isManuallyLocked =
      seasonStatus !== "" && seasonStatus !== "disponible";
    const isEmpty = totalEpisodes === 0;
    const isLocked =
      isManuallyLocked || (isEmpty && seasonStatus !== "disponible");
    const seasonLabel = formatSeasonName(
      seasonKey,
      seasonNum,
      seasonCustomLabel,
    );

    const card = document.createElement("div");
    card.className = `season-poster-card ${isLocked ? "locked" : ""} ${seasonStatus === "mantenimiento" ? "en-mantenimiento" : ""}`;

    card.onclick = () => {
      if (isLocked) {
        shared.ErrorHandler.show("content", "Temporada no disponible aún.");
      } else {
        renderEpisodePlayer(seriesId, seasonKey);
      }
    };

    let overlayText = "";
    if (isLocked) {
      if (seasonStatus === "mantenimiento") {
        overlayText = "Mantenimiento";
      } else if (
        seasonStatus === "proximamente" ||
        seasonStatus === "próximamente"
      ) {
        overlayText = "PRÓXIMAMENTE";
      } else if (/\d/.test(seasonStatusRaw)) {
        overlayText = `Próx. ${seasonStatusRaw}`;
      } else if (seasonStatusRaw) {
        overlayText = `Próx. en ${seasonStatusRaw}`;
      } else {
        overlayText = "PRÓXIMAMENTE";
      }
    } else if (!isNaN(seasonKey)) {
      overlayText = `${totalEpisodes} episodios`;
    }

    card.innerHTML = `
            <img src="${posterUrl}" alt="${seasonLabel}">
            <div class="overlay">
                <h3>${seasonLabel}</h3>
                <p>${overlayText}</p>
            </div>
        `;
    container.appendChild(card);
  });
}

// 5. REPRODUCTOR DE EPISODIOS
export async function renderEpisodePlayer(
  seriesId,
  seasonNum,
  startAtIndex = null,
) {
  try {
    shared.appState.player.activeSeriesId = seriesId;
    const savedEpisodeIndex = loadProgress(seriesId, seasonNum);
    const initialEpisodeIndex =
      startAtIndex !== null ? startAtIndex : savedEpisodeIndex;

    const episodes =
      shared.appState.content.seriesEpisodes[seriesId]?.[seasonNum] || [];
    const firstEpisode = episodes[0];

    if (!firstEpisode) {
      console.error("No hay episodios para renderizar.");
      return;
    }

    const seasonHasEn = episodes.some((ep) => ep?.videoId_en?.trim());
    const seasonHasEs = episodes.some((ep) => ep?.videoId_es?.trim());

    const syntheticEp = {
      ...firstEpisode,
      videoId_en: seasonHasEn
        ? episodes.find((ep) => ep?.videoId_en?.trim())?.videoId_en
        : "",
      videoId_es: seasonHasEs
        ? episodes.find((ep) => ep?.videoId_es?.trim())?.videoId_es
        : "",
    };
    const seriesTracks = getLangTracks(syntheticEp);
    const hasLangOptions = seriesTracks.length > 1;

    let savedLang = null;
    try {
      const prefs = JSON.parse(localStorage.getItem("seriesLangPrefs")) || {};
      savedLang = prefs[seriesId];
    } catch (e) {}

    let initialLang = seriesTracks[0]?.lang || "en";
    if (!hasLangOptions && seriesTracks[0]?.lang === "es") initialLang = "es";

    if (savedLang && seriesTracks.some((t) => t.lang === savedLang)) {
      initialLang = savedLang;
    }

    shared.appState.player.state[seriesId] = {
      season: seasonNum,
      episodeIndex: initialEpisodeIndex,
      lang: initialLang,
    };

    const seasonLower = String(seasonNum).toLowerCase();
    const isSpecialContent =
      seasonLower.includes("pelicula") ||
      seasonLower.includes("película") ||
      seasonLower.includes("especial") ||
      seasonLower.includes("ova") ||
      seasonLower.includes("movie") ||
      seasonLower.includes("special");

    const isSingleMovie = isSpecialContent && episodes.length === 1;

    const postersData =
      shared.appState.content.seasonPosters[seriesId]?.[seasonNum] || {};
    const seriesInfo = findContentData(seriesId) || {};

    const movieYear = postersData.year || postersData.anio || "";
    const movieDuration = postersData.duration || postersData.duracion || "";
    const movieRequester = postersData.pedido || postersData.pedidoPor || "";

    let specificPoster = postersData.poster || postersData.posterUrl;
    if (!specificPoster) specificPoster = seriesInfo.poster;

    const movieSynopsis =
      postersData.sinopsis ||
      firstEpisode.description ||
      "Sinopsis no disponible.";

    const displayTitle =
      isSpecialContent && firstEpisode.title
        ? firstEpisode.title
        : seriesInfo.title || firstEpisode.title || "Sin título";

    const _nombreTmp = String(seriesInfo.nombreTemporadas || "").trim();

    const seasonDisplayName = postersData.etiqueta
      ? postersData.etiqueta
      : isSpecialContent
        ? "Especial / Película"
        : `${_nombreTmp || "Temporada"} ${seasonNum}`;

    let seasonWordPlural = "Temporadas";
    if (_nombreTmp) {
      seasonWordPlural = `${_nombreTmp}s`; // "Parte" → "Partes"
    } else if (seasonDisplayName.toLowerCase().includes("parte")) {
      seasonWordPlural = "Partes";
    } else if (isSpecialContent) {
      seasonWordPlural = "Especiales";
    }

    const seasonsCount = Object.keys(
      shared.appState.content.seriesEpisodes[seriesId] || {},
    ).length;
    const backButtonHTML =
      seasonsCount > 1
        ? `<button class="player-back-link back-to-seasons"><i class="fas fa-arrow-left"></i> ${seasonWordPlural}</button>`
        : "";

    shared.DOM.seriesPlayerModal.className =
      "series-player-page active player-layout-view";

    const finishTime = movieDuration
      ? calculateFinishTime(movieDuration)
      : null;
    const endTimeHTML = finishTime
      ? `<span class="meta-tag" style="display:inline-flex;align-items:center;">
                   <i class="fas fa-flag-checkered" style="color:#ff4d4d;"></i>
                   <span style="opacity:0.9;margin-left:5px;">Terminas de ver a las <strong style="color:#fff;">${finishTime}</strong> aprox.</span>
               </span>`
      : "";

    if (isSingleMovie) {
      shared.DOM.seriesPlayerModal.innerHTML = `
                <button class="close-btn streaming-back-btn"><i class="fas fa-arrow-left"></i> Volver</button>
                <div class="player-layout-container movie-mode">
                    <div class="movie-player-container">
                        <h2 id="cinema-title-${seriesId}" class="movie-player-title cinema-title-above">${displayTitle}</h2>
                        <div class="screen"><div id="video-container-${seriesId}" style="width:100%; height:100%; background:#000;"></div></div>
                    </div>
                    <div class="movie-info-sidebar">
                        <div class="movie-info-sidebar-inner">
                            ${backButtonHTML}
                            <div class="movie-poster-container">
                                <img src="${specificPoster}" alt="Poster" onerror="this.src='https://via.placeholder.com/150'">
                            </div>
                            <div class="movie-details-info">
                                <div class="movie-meta-info">
                                    ${movieRequester ? `<span class="meta-tag request-tag"><i class="fas fa-user-circle"></i> ${movieRequester}</span>` : ""}
                                    ${movieYear ? `<span class="meta-tag"><i class="fas fa-calendar"></i> ${movieYear}</span>` : ""}
                                    ${movieDuration ? `<span class="meta-tag"><i class="fas fa-clock"></i> ${movieDuration}</span>` : ""}
                                    ${endTimeHTML}
                                </div>
                                <p id="cinema-synopsis-sp" class="movie-synopsis">${movieSynopsis}</p>
                                <div class="cinema-controls-sp">
                                    <button id="btn-review-player-${seriesId}" class="btn btn-review"><i class="fas fa-star"></i> Escribir Reseña</button>
                                    <button class="btn btn-report-sp"><i class="fas fa-flag"></i> Reportar problema</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
    } else {
      let langDropdown = "";
      if (hasLangOptions) {
        const currentLangLabel =
          seriesTracks.find((t) => t.lang === initialLang)?.label || "Original";

        const optionsHtml = seriesTracks
          .map(
            (t) => `
                    <div class="cc-lang-option ${t.lang === initialLang ? "active" : ""}" data-lang="${t.lang}" style="padding: 10px 15px; cursor: pointer; color: ${t.lang === initialLang ? "#fff" : "#aaa"}; background: ${t.lang === initialLang ? "var(--accent-color)" : "transparent"}; font-size: 11px; font-weight: bold; text-transform: uppercase; transition: 0.2s; border-bottom: 1px solid #222;">
                        ${t.label}
                    </div>
                `,
          )
          .join("");

        langDropdown = `
                    <div class="cc-custom-lang-wrapper" style="position: relative; display: inline-block; font-family: 'Montserrat', sans-serif;">
                        <div class="cc-lang-trigger" style="display:inline-flex;align-items:center;gap:6px;background:none;border:none;padding:0;cursor:pointer;transition:color 0.2s;">
                            <i class="fas fa-language" style="font-size:14px;color:var(--text-muted);pointer-events:none;transition:color 0.2s;"></i>
                            <span style="color:var(--text-light);font-size:0.9rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;pointer-events:none;transition:color 0.2s;">${currentLangLabel}</span>
                            <i class="fas fa-chevron-down" style="font-size:0.7rem;color:var(--text-muted);pointer-events:none;transition:color 0.2s;"></i>
                        </div>
                        <div class="cc-lang-menu" style="display: none; position: absolute; top: calc(100% + 5px); right: 0; background: #141414; border: 1px solid #333; border-radius: 8px; overflow: hidden; z-index: 999999; min-width: 130px; box-shadow: 0 10px 25px rgba(0,0,0,0.9);">
                            ${optionsHtml}
                        </div>
                    </div>
                `;
      }

      const mYear =
        postersData.year ||
        postersData.anio ||
        seriesInfo.year ||
        seriesInfo.anio ||
        "";
      const mReq =
        postersData.pedido ||
        postersData.pedidoPor ||
        seriesInfo.pedido ||
        seriesInfo.requester ||
        "";

      const normStr = (s) =>
        String(s || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9\s]/g, "");
      const rawAltTitle = seriesInfo.secondTitle || seriesId;
      const originalTitle =
        rawAltTitle && normStr(rawAltTitle) !== normStr(seriesInfo.title || "")
          ? rawAltTitle
          : null;

      let genresVal = "";
      if (seriesInfo.genres) {
        genresVal = Array.isArray(seriesInfo.genres)
          ? seriesInfo.genres.join(", ")
          : String(seriesInfo.genres).replace(/;/g, ", ");
      }
      const langVal =
        seriesInfo.language || seriesInfo.idioma || seriesInfo.audio || "";

      const mReqHtml = mReq
        ? `<span>Pedido por: <span style="color:#fff; font-weight:bold;">${mReq}</span></span><span style="font-size:10px; color:#555; margin:0 4px;">●</span>`
        : "";
      const mYearHtml = mYear
        ? `<span>Estreno: <span style="color:#fff; font-weight:bold;">${mYear}</span></span><span style="font-size:10px; color:#555; margin:0 4px;">●</span>`
        : "";
      const logoTheme =
        shared.THEMES?.normal?.logo ||
        "https://res.cloudinary.com/djhgmmdjx/image/upload/v1759209688/vgJjqSM_oicebo.png";

      shared.DOM.seriesPlayerModal.innerHTML = `
            <style>
                /* ── Crítico: page layout base (PC) ── */
                body:has(#series-player-page.active) .bottom-nav { display: none !important; }
                #series-player-page.player-layout-view {
                    position: fixed !important;
                    inset: 72px 0 0 0 !important;
                    display: block !important;
                    background-color: var(--bg-dark, #05070a) !important;
                    z-index: 999 !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    width: 100vw !important;
                    height: 100dvh !important;
                    border-radius: 0 !important;
                    overflow-y: auto !important;
                    overflow-x: hidden !important;
                }
                @media (min-width: 769px) { .mobile-only { display: none !important; } }
                
                /* ── ADAPTACIÓN PREMIUM PARA MÓVILES (<= 768px) ── */
                @media (max-width: 768px) { 
                    .desktop-only { display: none !important; } 
                    
                    /* Convertimos el layout global en un viewport fijo de app nativa */
                    #series-player-page.player-layout-view {
                        height: calc(100dvh - 72px) !important;
                        overflow: hidden !important; /* Prohibido el scroll en la página completa */
                        display: flex !important;
                        flex-direction: column !important;
                    }
                    
                    .sp-desktop-grid {
                        display: flex !important;
                        flex-direction: column !important;
                        height: 100% !important;
                        overflow: hidden !important;
                    }
                    
                    /* 📌 EL BLOQUE DEL REPRODUCTOR (Fijo/Pegado arriba) */
                    .sp-left-col,
                    .sp-left-col-mobile {
                        position: relative !important;
                        width: 100% !important;
                        flex-shrink: 0 !important; /* Evita que el navegador lo aplaste */
                        z-index: 100 !important;
                        background-color: var(--bg-dark, #05070a) !important;
                        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important; /* Separación visual elegante */
                    }
                    
                    /* 📱 MEJORA DE LA LISTA: Scroll independiente y suave */
                    .sp-right-col#scrollArea,
                    .sp-right-col-mobile#scrollArea {
                        flex: 1 !important;
                        min-height: 0 !important; /* Crucial para activar overflow en flexbox */
                        overflow-y: auto !important; /* Activa el scroll exclusivo de la lista */
                        -webkit-overflow-scrolling: touch !important; /* Scroll con inercia nativa de iOS/Android */
                        padding: 12px 14px 40px !important; /* Espaciado limpio para los extremos táctiles */
                    }
                    
                    /* Lista de episodios — estilo Image 1: filas planas, número inline */
                    .sp-right-col#scrollArea .sp-episode-item,
                    .sp-right-col-mobile#scrollArea .sp-episode-item-mobile {
                        padding: 10px 14px !important;
                        margin: 0 !important;
                        background: transparent !important;
                        border-radius: 0 !important;
                        border: none !important;
                        border-bottom: 1px solid rgba(255,255,255,0.05) !important;
                        transition: background 0.18s ease !important;
                        position: relative !important;
                    }
                    
                    .sp-right-col#scrollArea .sp-episode-item:hover,
                    .sp-right-col-mobile#scrollArea .sp-episode-item-mobile:hover {
                        background: rgba(255,255,255,0.03) !important;
                    }

                    .sp-right-col#scrollArea .sp-episode-item.active,
                    .sp-right-col-mobile#scrollArea .sp-episode-item-mobile.active {
                        background: rgba(var(--accent-rgb), 0.08) !important;
                        border-bottom-color: rgba(255,255,255,0.05) !important;
                    }

                    .sp-right-col#scrollArea .sp-episode-item.active::before,
                    .sp-right-col-mobile#scrollArea .sp-episode-item-mobile.active::before {
                        content: '' !important;
                        position: absolute !important;
                        left: 0 !important; top: 0 !important; bottom: 0 !important;
                        width: 3px !important;
                        background: var(--accent-color) !important;
                        border-radius: 0 2px 2px 0 !important;
                    }
                    
                    /* Número inline y descripción */
                    .sp-right-col#scrollArea .sp-ep-num-prefix,
                    .sp-right-col-mobile#scrollArea .sp-ep-num-prefix {
                        color: var(--accent-color) !important;
                        font-weight: 900 !important;
                        font-size: 0.78rem !important;
                        margin-right: 2px !important;
                    }

                    .sp-right-col#scrollArea .sp-ep-desc,
                    .sp-right-col-mobile#scrollArea .sp-ep-desc {
                        font-size: 11px !important;
                        line-height: 1.4 !important;
                        margin-top: 3px !important;
                        opacity: 0.65 !important;
                    }

                    /* Badge de duración en thumbnail */
                    .sp-right-col#scrollArea .sp-ep-duration,
                    .sp-right-col-mobile#scrollArea .sp-ep-duration {
                        position: absolute !important;
                        bottom: 4px !important; right: 4px !important;
                        background: rgba(0,0,0,0.82) !important;
                        color: #fff !important;
                        font-size: 0.6rem !important;
                        font-weight: 700 !important;
                        padding: 2px 5px !important;
                        border-radius: 4px !important;
                        pointer-events: none !important;
                    }
                }
            </style>

            <!--
            ╔══════════════════════════════════════════════════════╗
            ║  SP-TOPBAR  —  Barra superior con botón volver      ║
            ╚══════════════════════════════════════════════════════╝
            -->
            <div class="sp-player-topbar sp-player-topbar-mobile">
                <button class="streaming-back-btn sp-topbar-back-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M19 12H5M12 5l-7 7 7 7"/>
                    </svg>
                    Volver
                </button>
                <span class="sp-topbar-series-title">${displayTitle}</span>
            </div>
            <!-- /sp-topbar -->


            <!--
            ╔══════════════════════════════════════════════════════╗
            ║  SP-DESKTOP-GRID                                    ║
            ║  Left : video + franja info episodio                ║
            ║  Right: carrusel temporadas + lista capítulos       ║
            ╚══════════════════════════════════════════════════════╝
            -->
            <div class="sp-desktop-grid sp-desktop-grid-mobile">

                <!-- ─── COLUMNA IZQUIERDA ─── -->
                <div class="sp-left-col sp-left-col-mobile">

                    <!--
                        sp-fixed-header: wrapper del video.
                        En mobile queda sticky arriba al hacer scroll.
                        ID #fixedHeader es hook del scroll listener.
                    -->
                    <div class="sp-fixed-header sp-fixed-header-mobile" id="fixedHeader">

                        <!-- Barra de nav — solo móvil -->
                        <nav class="sp-nav-mobile mobile-only">
                            <img src="${logoTheme}" class="sp-nav-logo-mobile" alt="Cine Corneta">
                            <button class="streaming-back-btn sp-close-btn-mobile">
                                <i class="fas fa-times"></i> Cerrar
                            </button>
                        </nav>

                        <!-- Video container (siempre presente) -->
                        <div class="sp-video-wrap sp-video-wrap-mobile" style="position: relative; width: 100%; aspect-ratio: 16/9 !important; flex-shrink: 0 !important;">
                            <div id="video-container-${seriesId}"
                                 class="sp-video-container-mobile"
                                 style="width:100%; height:100%; background:#000;
                                        position:absolute; inset:0;">
                            </div>
                        </div>

                        <!-- Título + toggle expandir — solo móvil.
                             ID #toggleDescBtn y #toggleText son hooks del listener. -->
                        <div class="sp-details-mobile mobile-only" id="toggleDescBtn">
                            <div class="sp-details-text-mobile">
                                <span class="sp-ep-season-mobile" id="subTitle">${seasonDisplayName}</span>
                                <h1 class="sp-title-mobile" id="cinema-title-${seriesId}"></h1>
                            </div>
                            <span class="sp-toggle-hint-mobile" id="toggleText">... ver más</span>
                        </div>

                    </div>
                    <!-- /sp-fixed-header -->


                    <!--
                        sp-ep-info-strip: franja debajo del video — solo desktop.
                        Muestra temporada, título del ep, meta y sinopsis colapsable.
                        IDs #toggleDescBtnDesktop, #toggleArrowDesktop,
                            #synopsisContentDesktop son hooks del toggle listener.
                    -->
                    <div class="sp-ep-info-strip sp-ep-info-strip-mobile desktop-only" id="toggleDescBtnDesktop">

                        <div class="sp-ep-info-header">
                            <div class="sp-ep-info-text">
                                <span class="sp-ep-season-label" id="subTitleDesktop">${seasonDisplayName}</span>
                                <h2 class="sp-ep-title" id="cinema-title-desktop-${seriesId}"></h2>
                                <div class="sp-ep-meta">
                                    <span class="sp-ep-series-name">${displayTitle}</span>
                                    <span class="sp-ep-dot">·</span>
                                    <span class="sp-ep-lang" id="sp-ep-lang-${seriesId}">
                                        ${
                                          initialLang === "es"
                                            ? "Latino"
                                            : "Original"
                                        }
                                    </span>
                                </div>
                            </div>
                            ${hasLangOptions ? `<div class="sp-ep-lang-selector desktop-only">${langDropdown}</div>` : ""}
                            <div class="sp-ep-chevron" id="toggleArrowDesktop">
                                <svg viewBox="0 0 24 24" width="16" height="16"
                                     fill="none" stroke="currentColor" stroke-width="2.5">
                                    <path d="M6 9l6 6 6-6"/>
                                </svg>
                            </div>
                        </div>

                        <!-- Sinopsis del episodio — colapsable.
                             ID #synopsisContentDesktop y #episode-desc-desktop-X son hooks. -->
                        <div class="sp-synopsis-content" id="synopsisContentDesktop">
                            <p class="sp-ep-synopsis-text"
                               id="episode-desc-desktop-${seriesId}"></p>
                            <button class="vab-btn--report sp-report-btn-desktop">
                                <i class="fas fa-flag"></i> Reportar problema
                            </button>
                        </div>

                    </div>
                    <!-- /sp-ep-info-strip -->

                </div>
                <!-- /sp-left-col -->


                <!-- ─── COLUMNA DERECHA ───
                     ID #scrollArea es hook del scroll listener (mobile).
                     En desktop es el panel sticky de episodios. -->
                <div class="sp-right-col sp-right-col-mobile sp-scroll" id="scrollArea">

                    <!-- Meta info — solo móvil -->
                    <div class="sp-meta-mobile mobile-only">
                        ${mReqHtml}
                        ${mYearHtml}
                        <span>
                            <span class="sp-meta-highlight-mobile">${seasonsCount}</span>
                            ${seasonWordPlural}
                        </span>
                    </div>

                    <!-- Área expandible (géneros, título original, desc ep) — solo móvil.
                         ID #expandableArea es hook del toggle listener. -->
                    <div class="sp-expand-mobile mobile-only" id="expandableArea">
                        <div class="sp-expand-details-mobile">
                            ${
                              originalTitle
                                ? `<span><i class="fas fa-film sp-expand-icon-mobile"></i> ${originalTitle}</span>`
                                : ""
                            }
                            ${
                              genresVal
                                ? `<span><i class="fas fa-tags sp-expand-icon-mobile"></i> ${genresVal}</span>`
                                : ""
                            }
                            ${
                              langVal
                                ? `<span><i class="fas fa-language sp-expand-icon-mobile"></i> ${langVal}</span>`
                                : ""
                            }
                        </div>
                        <!-- ID #episode-desc-X es hook para texto del episodio (mobile) -->
                        <div class="sp-ep-desc-mobile" id="episode-desc-${seriesId}"></div>
                        <button class="vab-btn--report sp-report-btn-mobile">
                            <i class="fas fa-flag"></i> Reportar problema
                        </button>
                    </div>

                    <!-- Carrusel de temporadas — solo desktop.
                         #sp-season-tabs-X será poblado por JS en la fase siguiente. -->
                    <div class="sp-season-carousel sp-season-carousel-mobile desktop-only">
                        <div class="sp-panel-section-header">
                            <span class="sp-panel-section-title">${seasonWordPlural}</span>
                        </div>
                        <div class="sp-season-tabs-wrap">
                            <button class="sp-carousel-arrow sp-carousel-arrow--left"
                                    id="sp-carousel-prev-${seriesId}"
                                    aria-label="Temporada anterior">
                                <svg viewBox="0 0 24 24" width="13" height="13"
                                     fill="none" stroke="currentColor" stroke-width="2.5">
                                    <polyline points="15 18 9 12 15 6"/>
                                </svg>
                            </button>
                            <div class="sp-season-tabs" id="sp-season-tabs-${seriesId}"></div>
                            <button class="sp-carousel-arrow sp-carousel-arrow--right"
                                    id="sp-carousel-next-${seriesId}"
                                    aria-label="Temporada siguiente">
                                <svg viewBox="0 0 24 24" width="13" height="13"
                                     fill="none" stroke="currentColor" stroke-width="2.5">
                                    <polyline points="9 18 15 12 9 6"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <!-- /sp-season-carousel -->

                    <!--
                        sp-controls:
                          Mobile  → botón selector de temporada (sheet) + idioma
                          Desktop → etiqueta "Capítulos" + idioma
                        IDs #seasonSelectorBtn y #seasonBtnText son hooks del sheet listener.
                    -->
                    <div class="sp-controls sp-controls-mobile">

                        <!-- Botón que abre el sheet de temporadas — solo móvil -->
                        <div class="sp-season-btn-mobile mobile-only" id="seasonSelectorBtn">
                            <span id="seasonBtnText">${seasonDisplayName}</span>
                            <i class="fas fa-chevron-down"></i>
                        </div>

                        <!-- Etiqueta sección "Capítulos" — solo desktop -->
                        <div class="sp-panel-section-header desktop-only">
                            <span class="sp-panel-section-title">Capítulos</span>
                        </div>

                        <!-- Selector de idioma (ambas vistas).
                             .cc-custom-lang-wrapper / .cc-lang-trigger / .cc-lang-menu /
                             .cc-lang-option son hooks del listener de idioma.
                             mobile-only cuando no hay opciones de idioma (oculta en desktop). -->
                        <div class="sp-langs${hasLangOptions ? "" : " mobile-only"}">
                            ${langDropdown}
                        </div>

                    </div>
                    <!-- /sp-controls -->

                    <!-- Lista de episodios — hook para renderEpisodes().
                         ID #episode-list-X es esencial, no cambiar. -->
                    <div id="episode-list-${seriesId}" class="sp-episode-list sp-episode-list-mobile"></div>

                </div>
                <!-- /sp-right-col -->

            </div>
            <!-- /sp-desktop-grid -->


            <!--
            ╔══════════════════════════════════════════════════════╗
            ║  SP-SHEET  —  Selector de temporadas (mobile)       ║
            ║  IDs #seasonModalSheet, #season-grid-sheet-container║
            ║  y #closeSeasonSheetBtn son hooks del JS existente. ║
            ╚══════════════════════════════════════════════════════╝
            -->
            <div class="sp-sheet-overlay sp-sheet-overlay-mobile" id="seasonModalSheet">
                <div class="sp-sheet sp-sheet-mobile" onclick="event.stopPropagation();">
                    <div class="sp-sheet-header">
                        <span>${seasonWordPlural}</span>
                        <button class="sp-sheet-close" id="closeSeasonSheetBtn">✕</button>
                    </div>
                    <div class="sp-sheet-grid" id="season-grid-sheet-container"></div>
                </div>
            </div>
        `;

      const scrollArea =
        shared.DOM.seriesPlayerModal.querySelector("#scrollArea");
      const fixedHeader =
        shared.DOM.seriesPlayerModal.querySelector("#fixedHeader");
      const toggleText =
        shared.DOM.seriesPlayerModal.querySelector("#toggleText");
      const toggleDescBtn =
        shared.DOM.seriesPlayerModal.querySelector("#toggleDescBtn");
      const expandArea =
        shared.DOM.seriesPlayerModal.querySelector("#expandableArea");

      if (scrollArea && fixedHeader && toggleText) {
        // En mobile el scroll vive en el modal/page, no en scrollArea (overflow:visible).
        // Escuchamos ambos para cubrir desktop (scrollArea) y mobile (modal o window).
        const isMobile = () => window.innerWidth <= 768;
        const onScroll = () => {
          const scrollTop = isMobile()
            ? (shared.DOM.seriesPlayerModal?.scrollTop ?? window.scrollY)
            : scrollArea.scrollTop;
          if (scrollTop > 10) {
            toggleText.style.opacity = "0";
            toggleText.style.pointerEvents = "none";
            fixedHeader.classList.add("scrolled");
          } else {
            toggleText.style.opacity = "1";
            toggleText.style.pointerEvents = "auto";
            fixedHeader.classList.remove("scrolled");
          }
        };
        scrollArea.addEventListener("scroll", onScroll);
        if (shared.DOM.seriesPlayerModal)
          shared.DOM.seriesPlayerModal.addEventListener("scroll", onScroll);
        window.addEventListener("scroll", onScroll, { passive: true });
      }

      if (toggleDescBtn && expandArea && toggleText && scrollArea) {
        toggleDescBtn.addEventListener("click", () => {
          if (
            expandArea.style.display === "none" ||
            expandArea.style.display === ""
          ) {
            expandArea.style.display = "block";
            toggleText.innerHTML = "ocultar";
            scrollArea.scrollTo({ top: 0, behavior: "smooth" });
          } else {
            expandArea.style.display = "none";
            toggleText.innerHTML = "... ver más";
          }
        });
      }

      const toggleDescBtnDesktop = shared.DOM.seriesPlayerModal.querySelector(
        "#toggleDescBtnDesktop",
      );
      const toggleArrowDesktop = shared.DOM.seriesPlayerModal.querySelector(
        "#toggleArrowDesktop",
      );
      const synopsisContentDesktop = shared.DOM.seriesPlayerModal.querySelector(
        "#synopsisContentDesktop",
      );

      if (
        toggleDescBtnDesktop &&
        toggleArrowDesktop &&
        synopsisContentDesktop
      ) {
        toggleDescBtnDesktop.addEventListener("click", () => {
          toggleArrowDesktop.classList.toggle("expanded");
          synopsisContentDesktop.classList.toggle("expanded");
        });
      }

      const seasonSelectorBtn =
        shared.DOM.seriesPlayerModal.querySelector("#seasonSelectorBtn");
      const seasonModalSheet =
        shared.DOM.seriesPlayerModal.querySelector("#seasonModalSheet");
      const closeSeasonSheetBtn = shared.DOM.seriesPlayerModal.querySelector(
        "#closeSeasonSheetBtn",
      );
      const seasonGridSheetContainer =
        shared.DOM.seriesPlayerModal.querySelector(
          "#season-grid-sheet-container",
        );

      if (seasonSelectorBtn && seasonsCount <= 1) {
        seasonSelectorBtn.style.setProperty("display", "none", "important");
        const spControls =
          shared.DOM.seriesPlayerModal.querySelector(".sp-controls");
        if (spControls) {
          const hasLang = spControls.querySelector(".cc-custom-lang-wrapper");
          if (hasLang) {
            // Solo idioma: alinear a la derecha
            spControls.style.justifyContent = "flex-end";
          } else {
            // Sin temporada ni idioma: ocultar el bloque para que la lista use ese espacio
            spControls.style.setProperty("display", "none", "important");
          }
        }
      }
      if (
        seasonSelectorBtn &&
        seasonModalSheet &&
        seasonGridSheetContainer &&
        seasonsCount > 1
      ) {
        seasonGridSheetContainer.innerHTML = "";

        const seriesEpisodes =
          shared.appState.content.seriesEpisodes[seriesId] || {};
        const allSeasonPosters =
          shared.appState.content.seasonPosters[seriesId] || {};
        const allSeasonsKeys = [
          ...new Set([
            ...Object.keys(seriesEpisodes),
            ...Object.keys(allSeasonPosters),
          ]),
        ];
        const orderedKeys =
          shared.appState.content.seasonOrder?.[seriesId] || allSeasonsKeys;
        const seasonsMappedSheet = orderedKeys
          .filter((k) => allSeasonsKeys.includes(k))
          .map((k) => ({ key: k, num: !isNaN(k) ? Number(k) : 0 }));

        seasonsMappedSheet.forEach(({ key: sKey, num: sNum }) => {
          const posterEntry = allSeasonPosters[sKey];
          let posterUrl = seriesInfo.poster || "";
          let customLabel = "";

          if (posterEntry && typeof posterEntry === "object") {
            posterUrl =
              posterEntry.posterUrl || posterEntry.poster || posterUrl;
            customLabel = posterEntry.etiqueta || "";
          } else if (posterEntry) {
            posterUrl = posterEntry;
          }

          const _sNombreTmp = String(seriesInfo.nombreTemporadas || "").trim();
          const sLabel = customLabel
            ? customLabel
            : sNum === 0
              ? "Especial/Película"
              : `${_sNombreTmp || "Temporada"} ${sNum}`;
          const isActive = sKey === seasonNum;

          const card = document.createElement("div");
          card.className = `cc-sheet-card ${isActive ? "active-season" : ""}`;
          card.innerHTML = `<img src="${posterUrl}" alt="${sLabel}"><div class="cc-overlay">${sLabel}</div>`;
          card.addEventListener("click", () => {
            seasonModalSheet.classList.remove("active");
            // Mobile: unlock body scroll; Desktop: unlock scrollArea
            if (window.innerWidth <= 768) {
              document.body.style.overflow = "";
            } else if (scrollArea) {
              scrollArea.style.overflowY = "auto";
            }
            if (!isActive) renderEpisodePlayer(seriesId, sKey);
          });
          seasonGridSheetContainer.appendChild(card);
        });

        seasonSelectorBtn.addEventListener("click", () => {
          seasonModalSheet.classList.add("active");
          // Mobile: bloquear scroll del body; Desktop: bloquear scrollArea interno
          if (window.innerWidth <= 768) {
            document.body.style.overflow = "hidden";
          } else if (scrollArea) {
            scrollArea.style.overflowY = "hidden";
          }
        });
        const closeSheet = () => {
          seasonModalSheet.classList.remove("active");
          // Mobile: restaurar scroll del body; Desktop: restaurar scrollArea
          if (window.innerWidth <= 768) {
            document.body.style.overflow = "";
          } else if (scrollArea) {
            scrollArea.style.overflowY = "auto";
          }
        };
        if (closeSeasonSheetBtn)
          closeSeasonSheetBtn.addEventListener("click", closeSheet);
        seasonModalSheet.addEventListener("click", closeSheet);
      }

      const reportBtnB =
        shared.DOM.seriesPlayerModal.querySelector(".vab-btn--report");
      if (reportBtnB) {
        reportBtnB.addEventListener("click", async () => {
          try {
            const rptMod = await import("./features/reports.js");
            rptMod.openReportModal({
              contentId: seriesId,
              contentTitle: seriesInfo.title,
              contentType: "series",
            });
          } catch (e) {
            console.error("Error al abrir reporte:", e);
          }
        });
      }
    }

    // Botón Volver desktop (hero) y botón cerrar mobile → ambos cierran el player
    shared.DOM.seriesPlayerModal
      .querySelectorAll(".streaming-back-btn")
      .forEach((btn) => {
        btn.onclick = closeSeriesPlayerModal;
      });

    const langWrapper = shared.DOM.seriesPlayerModal.querySelector(
      ".cc-custom-lang-wrapper",
    );
    if (langWrapper) {
      const trigger = langWrapper.querySelector(".cc-lang-trigger");
      const menu = langWrapper.querySelector(".cc-lang-menu");
      const options = langWrapper.querySelectorAll(".cc-lang-option");

      // AbortController para limpiar el listener global al renderizar de nuevo
      if (shared._langMenuAbortCtrl) shared._langMenuAbortCtrl.abort();
      shared._langMenuAbortCtrl = new AbortController();
      const { signal } = shared._langMenuAbortCtrl;

      const toggleLangMenu = (e) => {
        e.stopPropagation();
        const isOpen = menu.style.display === "block";
        menu.style.display = isOpen ? "none" : "block";
      };

      // Hover — solo desktop (touch no genera mouseenter)
      const _ac1 = getComputedStyle(document.documentElement)
        .getPropertyValue("--accent-color")
        .trim();
      const _mc1 = getComputedStyle(document.documentElement)
        .getPropertyValue("--text-muted")
        .trim();
      const _lc1 = getComputedStyle(document.documentElement)
        .getPropertyValue("--text-light")
        .trim();
      trigger.addEventListener("mouseenter", () => {
        trigger.querySelectorAll("span").forEach((s) => (s.style.color = _ac1));
        trigger.querySelectorAll("i").forEach((i) => (i.style.color = _ac1));
      });
      trigger.addEventListener("mouseleave", () => {
        trigger.querySelectorAll("span").forEach((s) => (s.style.color = _lc1));
        trigger.querySelectorAll("i").forEach((i) => (i.style.color = _mc1));
      });

      trigger.addEventListener("click", toggleLangMenu);
      // touchend explícito para iOS donde el primer tap a div no siempre
      // genera click (fix para elementos que no son button/a/input)
      trigger.addEventListener(
        "touchend",
        (e) => {
          e.preventDefault();
          toggleLangMenu(e);
        },
        { passive: false },
      );

      document.addEventListener(
        "click",
        () => {
          menu.style.display = "none";
        },
        { signal },
      );

      options.forEach((opt) => {
        // mouseenter/mouseleave no existen en dispositivos touch — el hover
        opt.addEventListener("click", (e) => {
          e.stopPropagation();
          menu.style.display = "none";
          changeLanguage(seriesId, opt.dataset.lang);
        });
        // Soporte táctil explícito: touchend cierra el menú y cambia idioma
        opt.addEventListener(
          "touchend",
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            menu.style.display = "none";
            changeLanguage(seriesId, opt.dataset.lang);
          },
          { passive: false },
        );
      });
    }

    const backButton = shared.DOM.seriesPlayerModal.querySelector(
      ".player-back-link.back-to-seasons",
    );
    if (backButton) backButton.onclick = () => renderSeasonGrid(seriesId);

    const reviewBtn = shared.DOM.seriesPlayerModal.querySelector(
      `#btn-review-player-${seriesId}`,
    );
    if (reviewBtn) {
      reviewBtn.onclick = () => {
        let correctTitle = "";
        let correctType = "movie";
        if (isSpecialContent || isSingleMovie) {
          correctTitle = displayTitle;
          correctType = "movie";
        } else {
          correctTitle = seriesInfo.title || displayTitle;
          correctType = "series";
        }
        if (window.openSmartReviewModal) {
          window.openSmartReviewModal(seriesId, correctType, correctTitle);
        } else {
          console.error(
            "La función window.openSmartReviewModal no está definida en script.js",
          );
        }
      };
    }

    const reportBtnSp =
      shared.DOM.seriesPlayerModal.querySelector(".btn-report-sp");
    if (reportBtnSp) {
      reportBtnSp.onclick = async () => {
        try {
          const rptMod = await import("./features/reports.js");
          rptMod.openReportModal({
            contentId: seriesId,
            contentTitle: displayTitle,
            contentType: "movie",
          });
        } catch (e) {
          console.error("Error al abrir reporte:", e);
        }
      };
    }

    if (isSingleMovie) {
      const synopsisEl = shared.DOM.seriesPlayerModal.querySelector(
        "#cinema-synopsis-sp",
      );
      if (synopsisEl) {
        requestAnimationFrame(() => {
          const isClamped =
            synopsisEl.scrollHeight > synopsisEl.clientHeight + 2;
          if (isClamped) {
            const toggleBtn = document.createElement("button");
            toggleBtn.className = "synopsis-toggle-btn";
            toggleBtn.textContent = "Leer sinopsis ▾";
            toggleBtn.onclick = () => {
              const isExpanded = synopsisEl.classList.toggle("expanded");
              toggleBtn.textContent = isExpanded
                ? "Ver menos ▴"
                : "Leer sinopsis ▾";
            };
            synopsisEl.insertAdjacentElement("afterend", toggleBtn);
          }
        });
      }
    }

    if (!isSingleMovie) populateEpisodeList(seriesId, seasonNum);
    if (!isSingleMovie) populateSeasonTabs(seriesId, seasonNum);
    openEpisode(seriesId, seasonNum, initialEpisodeIndex);
  } catch (e) {
    logError(e, "Player: Render Episode");
    shared.ErrorHandler.show("content", "Error al cargar el episodio.");
  }
}

export function populateEpisodeList(seriesId, seasonNum) {
  const container = shared.DOM.seriesPlayerModal.querySelector(
    `#episode-list-${seriesId}`,
  );
  const episodes =
    shared.appState.content.seriesEpisodes[seriesId]?.[seasonNum];
  if (!container || !episodes) return;

  container.innerHTML = "";

  [...episodes]
    .filter(ep => String(ep?.proximamente || "").trim().toLowerCase() !== "si")
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .forEach((episode, index) => {
      const card = document.createElement("div");
      card.className = "sp-episode-item sp-episode-item-mobile";
      card.id = `episode-card-${seriesId}-${seasonNum}-${index}`;
      card.addEventListener("click", () =>
        openEpisode(seriesId, seasonNum, index),
      );

      const thumbSrc =
        episode.thumbnail || episode.thumb || episode.image || "";
      const epNum = String(episode.episodeNumber || index + 1).padStart(2, "0");
      const desc =
        episode.description || episode.synopsis || episode.desc || "";
      const duration = episode.duration || episode.duracion || "";

      card.innerHTML = `
            <div style="position:relative;flex-shrink:0;">
                ${
                  thumbSrc
                    ? `<div class="sp-ep-thumb"><img src="${thumbSrc}" alt="" loading="lazy" onerror="this.style.display='none'"></div>`
                    : `<div class="sp-ep-thumb"><span class="sp-ep-thumb-num">E${epNum}</span></div>`
                }
                ${duration ? `<span class="sp-ep-duration">${duration}</span>` : ""}
                <div class="sp-ep-play-overlay">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>
                </div>
            </div>
            <div class="sp-ep-info">
                <span class="sp-ep-name"><span class="sp-ep-num-prefix">${epNum}.</span> ${episode.title || ""}</span>
                ${desc ? `<span class="sp-ep-desc">${desc}</span>` : ""}
            </div>
        `;
      container.appendChild(card);
    });
}

function populateSeasonTabs(seriesId, activeSeasonNum) {
  const tabsContainer = shared.DOM.seriesPlayerModal.querySelector(
    `#sp-season-tabs-${seriesId}`,
  );
  const prevBtn = shared.DOM.seriesPlayerModal.querySelector(
    `#sp-carousel-prev-${seriesId}`,
  );
  const nextBtn = shared.DOM.seriesPlayerModal.querySelector(
    `#sp-carousel-next-${seriesId}`,
  );
  if (!tabsContainer) return;

  const seriesEpisodes = shared.appState.content.seriesEpisodes[seriesId] || {};
  const postersData = shared.appState.content.seasonPosters[seriesId] || {};
  const allKeys = [
    ...new Set([...Object.keys(seriesEpisodes), ...Object.keys(postersData)]),
  ];
  const orderedKeys =
    shared.appState.content.seasonOrder?.[seriesId] || allKeys;
  const seasons = orderedKeys.filter((k) => allKeys.includes(k));

  const carousel = shared.DOM.seriesPlayerModal.querySelector(
    ".sp-season-carousel",
  );
  if (carousel) carousel.style.display = seasons.length <= 1 ? "none" : "";
  if (seasons.length <= 1) return;

  tabsContainer.innerHTML = "";

  seasons.forEach((key) => {
    const posterEntry = postersData[key];
    const label =
      (posterEntry?.etiqueta || "").trim() || (isNaN(key) ? key : `T${key}`);

    const tab = document.createElement("button");
    tab.className =
      "sp-season-tab" +
      (String(key) === String(activeSeasonNum) ? " active" : "");

    const posterUrl =
      posterEntry?.posterUrl ||
      posterEntry?.url ||
      posterEntry?.image ||
      posterEntry?.poster ||
      "";
    tab.innerHTML = posterUrl
      ? `<img src="${posterUrl}" alt="${label}" loading="lazy">
         <div class="sp-season-tab-overlay"><span class="sp-season-tab-label">${label}</span></div>`
      : `<div class="sp-season-tab-overlay" style="background:rgba(0,0,0,0.5);justify-content:center;align-items:center;">
           <span class="sp-season-tab-label" style="font-size:0.7rem;">${label}</span>
         </div>`;
    tab.addEventListener("click", () => {
      // Solo actualizar lista y tabs sin regenerar el hero
      shared.appState.player.state[seriesId] = {
        ...shared.appState.player.state[seriesId],
        season: key,
        episodeIndex: 0,
      };
      populateEpisodeList(seriesId, key);
      populateSeasonTabs(seriesId, key);
      openEpisode(seriesId, key, 0);
    });
    tabsContainer.appendChild(tab);
  });

  if (prevBtn && nextBtn) {
    prevBtn.onclick = () =>
      tabsContainer.scrollBy({ left: -120, behavior: "smooth" });
    nextBtn.onclick = () =>
      tabsContainer.scrollBy({ left: 120, behavior: "smooth" });
  }

  const activeTab = tabsContainer.querySelector(".sp-season-tab.active");
  if (activeTab) {
    requestAnimationFrame(() =>
      activeTab.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      }),
    );
  }
}

function openEpisode(seriesId, season, newEpisodeIndex) {
  const episode =
    shared.appState.content.seriesEpisodes[seriesId]?.[season]?.[
      newEpisodeIndex
    ];
  if (!episode) return;

  commitAndClearPendingSave();

  clearTimeout(shared.appState.player.episodeOpenTimer);
  shared.appState.player.pendingHistorySave = null; // limpia inmediatamente

  shared.appState.player.episodeOpenTimer = setTimeout(() => {
    shared.appState.player.pendingHistorySave = {
      contentId: seriesId,
      type: "series",
      episodeInfo: {
        season,
        index: newEpisodeIndex,
        title: episode.title || "",
      },
    };
  }, 3000); // solo confirma si el usuario se queda 3 segundos

  shared.DOM.seriesPlayerModal
    .querySelectorAll(".episode-card.active")
    .forEach((c) => c.classList.remove("active"));
  const activeCard = shared.DOM.seriesPlayerModal.querySelector(
    `#episode-card-${seriesId}-${season}-${newEpisodeIndex}`,
  );
  if (activeCard) {
    activeCard.classList.add("active");
    // iOS Safari tiene bugs con scrollIntoView behavior:'smooth' dentro de
    // contenedores con overflow. En mobile usamos 'instant' para fiabilidad.
    const scrollBehavior = window.innerWidth <= 768 ? "instant" : "smooth";
    activeCard.scrollIntoView({ behavior: scrollBehavior, block: "nearest" });
  }

  shared.appState.player.state[seriesId] = {
    ...shared.appState.player.state[seriesId],
    season,
    episodeIndex: newEpisodeIndex,
  };
  saveProgress(seriesId);

  const container = shared.DOM.seriesPlayerModal.querySelector(
    `#video-container-${seriesId}`,
  );
  const lang = shared.appState.player.state[seriesId]?.lang || "es";

  let videoId;
  if (lang === "en" && episode.videoId_en) videoId = episode.videoId_en;
  else if (lang === "es" && episode.videoId_es) videoId = episode.videoId_es;
  else if (lang === "jp" && (episode.videoId_jp || episode.videoId_alt))
    videoId = episode.videoId_jp || episode.videoId_alt;
  else videoId = episode.videoId;

  if (container) {
    if (shared.appState.player.activeCineInstance) {
      shared.appState.player.activeCineInstance.destroy();
      shared.appState.player.activeCineInstance = null;
    }

    shared.appState.player.activeCineInstance = new CinePlayer(container);

    let subId, subType;
    if (lang === "en" && episode.subId_en) {
      subId = episode.subId_en;
      subType = episode.subType_en || "srt";
    } else if (episode.subId_es) {
      subId = episode.subId_es;
      subType = episode.subType_es || "srt";
    } else {
      const _cfg = ContentManager.getSubtitleConfig(episode);
      subId = _cfg.subId;
      subType = _cfg.subType;
    }

    const _seriesDataForGrayscale = findContentData(seriesId) || {};
    shared.appState.player.activeCineInstance.load({
      videoId,
      subId,
      subType,
      title: episode.title || `Episodio ${newEpisodeIndex + 1}`,
      poster: episode.thumbnail || episode.thumb || episode.image || "",
      grayscale: _seriesDataForGrayscale.blancoynegro === "si",
    });
  }

  const seasonLower = String(season).toLowerCase();
  const isSpecialContent =
    seasonLower.includes("pelicula") ||
    seasonLower.includes("película") ||
    seasonLower.includes("especial") ||
    seasonLower.includes("ova") ||
    seasonLower.includes("movie") ||
    seasonLower.includes("special");

  const episodeNumber = episode.episodeNumber || newEpisodeIndex + 1;

  const subTitleEl = shared.DOM.seriesPlayerModal.querySelector("#subTitle");
  const titleEl = shared.DOM.seriesPlayerModal.querySelector(
    `#cinema-title-${seriesId}`,
  );
  const infoDescEl = shared.DOM.seriesPlayerModal.querySelector(
    `#episode-desc-${seriesId}`,
  );

  const episodeTitleText = episode.title || `Episodio ${episodeNumber}`;

  const postersDataEp =
    shared.appState.content.seasonPosters[seriesId]?.[season] || {};
  const customLabelEp = postersDataEp.etiqueta || "";

  const allSeriesSeasons = Object.keys(
    shared.appState.content.seriesEpisodes[seriesId] || {}
  ).filter(s => {
    const sl = String(s).toLowerCase();
    return !sl.includes("pelicula") && !sl.includes("película") &&
           !sl.includes("especial") && !sl.includes("ova") &&
           !sl.includes("movie") && !sl.includes("special");
  });
  const isSingleSeason = allSeriesSeasons.length <= 1;

  const subTitleText = isSpecialContent
    ? "Especial / Película"
    : customLabelEp
      ? `${customLabelEp} | Ep ${episodeNumber}`
      : isSingleSeason
        ? `Episodio ${episodeNumber}`
        : `Temporada ${String(season).replace("T", "")} | Ep ${episodeNumber}`;

  if (subTitleEl) subTitleEl.textContent = subTitleText;
  if (titleEl) titleEl.textContent = episodeTitleText;
  if (infoDescEl)
    infoDescEl.innerHTML = `<strong>Sinopsis:</strong><br><br>${episode.description || episode.synopsis || episode.desc || "No hay descripción disponible para este episodio."}`;

  const titleDesktopEl = shared.DOM.seriesPlayerModal.querySelector(
    `#cinema-title-desktop-${seriesId}`,
  );
  const subTitleDesktopEl =
    shared.DOM.seriesPlayerModal.querySelector("#subTitleDesktop");
  const descDesktopEl = shared.DOM.seriesPlayerModal.querySelector(
    `#episode-desc-desktop-${seriesId}`,
  );

  if (titleDesktopEl) titleDesktopEl.textContent = episodeTitleText;
  if (subTitleDesktopEl) subTitleDesktopEl.textContent = subTitleText;
  if (descDesktopEl)
    descDesktopEl.innerHTML =
      episode.description ||
      episode.synopsis ||
      episode.desc ||
      "No hay descripción disponible para este episodio.";

  const toggleArrowDesk = shared.DOM.seriesPlayerModal.querySelector(
    "#toggleArrowDesktop",
  );
  const synopsisContentDesk = shared.DOM.seriesPlayerModal.querySelector(
    "#synopsisContentDesktop",
  );
  if (toggleArrowDesk) toggleArrowDesk.classList.remove("expanded");
  if (synopsisContentDesk) synopsisContentDesk.classList.remove("expanded");

  const langWrapper = shared.DOM.seriesPlayerModal.querySelector(
    ".cc-custom-lang-wrapper",
  );
  if (langWrapper) {
    const triggerSpan = langWrapper.querySelector(".cc-lang-trigger span");
    const options = langWrapper.querySelectorAll(".cc-lang-option");

    options.forEach((opt) => {
      if (opt.dataset.lang === lang) {
        opt.style.background = "var(--accent-color)";
        opt.style.color = "#fff";
        opt.classList.add("active");
        if (triggerSpan) triggerSpan.textContent = opt.textContent.trim();
      } else {
        opt.style.background = "transparent";
        opt.style.color = "#aaa";
        opt.classList.remove("active");
      }
    });
  }

  const scrollAreaEp =
    shared.DOM.seriesPlayerModal.querySelector("#scrollArea");
  if (scrollAreaEp && window.innerWidth <= 768) {
    scrollAreaEp.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function navigateEpisode(seriesId, direction) {
  commitAndClearPendingSave();
  const { season, episodeIndex } = shared.appState.player.state[seriesId];
  const newIndex = episodeIndex + direction;
  const seasonEpisodes =
    shared.appState.content.seriesEpisodes[seriesId][season];
  if (newIndex >= 0 && newIndex < seasonEpisodes.length) {
    openEpisode(seriesId, season, newIndex);
  }
}

function updateNavButtons(seriesId, season, episodeIndex) {
  const totalEpisodes =
    shared.appState.content.seriesEpisodes[seriesId][season].length;
  const prevBtn = shared.DOM.seriesPlayerModal.querySelector(
    `#prev-btn-${seriesId}`,
  );
  const nextBtn = shared.DOM.seriesPlayerModal.querySelector(
    `#next-btn-${seriesId}`,
  );

  if (prevBtn) prevBtn.disabled = episodeIndex === 0;
  if (nextBtn) nextBtn.disabled = episodeIndex === totalEpisodes - 1;
}

function changeLanguage(seriesId, lang) {
  shared.appState.player.state[seriesId].lang = lang;

  try {
    let prefs = JSON.parse(localStorage.getItem("seriesLangPrefs")) || {};
    prefs[seriesId] = lang;
    localStorage.setItem("seriesLangPrefs", JSON.stringify(prefs));
  } catch (e) {
    console.warn("No se pudo guardar el idioma");
  }

  const { season, episodeIndex } = shared.appState.player.state[seriesId];
  openEpisode(seriesId, season, episodeIndex);
}

// 6. REPRODUCTOR DE PELÍCULAS
export function openPlayerModal(movieId, movieTitle) {
  try {
    const movieData = findContentData(movieId);

    if (
      !movieData ||
      (movieData.estado && movieData.estado.toLowerCase() === "vetada")
    ) {
      shared.ErrorHandler.show(
        shared.ErrorHandler.types.CONTENT,
        "Película no disponible.",
      );
      return;
    }

    const tracks = getLangTracks(movieData);
    if (tracks.length === 0) return;

    // Respetar idioma elegido por el usuario, inglés por defecto
    const activeLang = window._dvActiveLang || "en";
    const preferredTrack =
      tracks.find((t) => t.lang === activeLang) || tracks[0];

    loadMovieInPlayer(
      preferredTrack.id,
      movieId,
      movieData,
      preferredTrack.lang,
      () => {
        // Se llama una sola vez al llegar al 50% → guardar en historial
        shared.addToHistoryIfLoggedIn(movieId, "movie");
      },
    );

    // Barra de info: usar el track real cargado
    const titleBar = document.getElementById("dv-player-title-bar");
    if (titleBar) titleBar.textContent = movieData.title || movieTitle || "";

    const playerLang = document.getElementById("dv-player-lang");
    if (playerLang) playerLang.textContent = preferredTrack.label;

    const rawDuration = movieData.duration || movieData.duracion || "";
    const playerDur = document.getElementById("dv-player-duration");
    if (playerDur) playerDur.textContent = rawDuration;

    const finishEl = document.getElementById("dv-player-finish-time");
    if (finishEl && rawDuration) {
      const ft = calculateFinishTime(rawDuration);
      finishEl.textContent = ft ? `Termina a las ${ft}` : "";
    }

    // Mostrar sección reproductor con fade
    const playerSection = document.getElementById("dv-player-section");
    if (playerSection) {
      playerSection.style.display = "block";

      // En móvil: ocultar el banner (dv-hero background) y marcar estado playing
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile) {
        const dvHero = document.getElementById("dv-hero");
        if (dvHero) {
          dvHero.classList.add("dv-hero--playing");
          // Copiar el banner al dv-mobile-header para que se vea de fondo
          const mobileHeader = document.querySelector(".dv-mobile-header");
          if (mobileHeader) {
            const bg = dvHero.style.backgroundImage;
            mobileHeader.style.backgroundImage = bg;
            mobileHeader.style.backgroundSize = "cover";
            mobileHeader.style.backgroundPosition = "center";
          }
        }
        const detailView = document.getElementById("detail-view");
        if (detailView) detailView.classList.add("detail-view--playing");
        // Scroll al top para que el player quede visible
        const detailEl = document.getElementById("detail-view");
        if (detailEl) detailEl.scrollTop = 0;

        // ── Botón cerrar flotante (móvil) — visible aunque dv-hero esté oculto ──
        if (!playerSection.querySelector(".dv-inline-player-close")) {
          const closeBtn = document.createElement("button");
          closeBtn.className = "dv-inline-player-close";
          closeBtn.setAttribute("aria-label", "Volver");
          closeBtn.style.cssText = [
            "position:absolute",
            "top:10px",
            "left:10px",
            "z-index:9999",
            "background:rgba(0,0,0,0.65)",
            "border:none",
            "border-radius:50%",
            "width:38px",
            "height:38px",
            "display:flex",
            "align-items:center",
            "justify-content:center",
            "cursor:pointer",
            "color:#fff",
            "font-size:17px",
            "box-shadow:0 2px 8px rgba(0,0,0,0.5)",
          ].join(";");
          closeBtn.innerHTML = '<i class="fas fa-arrow-left"></i>';
          closeBtn.onclick = () =>
            window.closeDetailView && window.closeDetailView();
          playerSection.style.position = "relative";
          playerSection.prepend(closeBtn);
        }
      } else {
        setTimeout(() => {
          playerSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
      }

      setTimeout(() => {
        playerSection.style.opacity = "1";
      }, 80);
    }

    // Sincronizar toggle visual con el idioma real cargado
    if (tracks.length > 1) {
      document.querySelectorAll(".dv-lang-btn").forEach((btn) => {
        const isActive = btn.onclick
          ?.toString()
          .includes(`"${preferredTrack.lang}"`);
        btn.classList.toggle("active", isActive);
      });

      window._dvCurrentMovieId = movieId;
      window._dvCurrentMovieData = movieData;
      window._dvTracks = tracks;
    }
  } catch (e) {
    logError(e, "Player: Open Modal");
  }
}

function loadMovieInPlayer(videoId, movieId, movieData, lang = "es", onHalfway = null) {
  const container = document.getElementById("dv-video-container");
  if (!container) return;

  if (shared.appState.player.activeCineInstance) {
    shared.appState.player.activeCineInstance.destroy();
    shared.appState.player.activeCineInstance = null;
  }
  // ✅ Garantizar que el flag de serie quede limpio para películas
  // (evita que btn-prev-ep / btn-next-ep aparezcan si venías de una serie)
  shared.appState.player.activeSeriesId = null;
  container.innerHTML = "";

  const artContainer = document.createElement("div");
  artContainer.className = "artplayer-container";
  artContainer.style.cssText = "width:100%;height:100%;background:#000";
  container.appendChild(artContainer);

  shared.appState.player.activeCineInstance = new CinePlayer(artContainer);

  // Subs según idioma: inglés usa subId_en/subType_en, español usa subId_es/subType_es
  let subId, subType;
  if (lang === "en" && movieData.subId_en) {
    subId = movieData.subId_en;
    subType = movieData.subType_en || "srt";
  } else if (movieData.subId_es) {
    subId = movieData.subId_es;
    subType = movieData.subType_es || "srt";
  } else {
    const config = ContentManager.getSubtitleConfig(movieData);
    subId = config.subId;
    subType = config.subType;
  }

  shared.appState.player.activeCineInstance.load({
    videoId,
    subId,
    subType,
    title: movieData.title || "",
    poster: movieData.banner || movieData.poster || movieData.image || "",
    grayscale: movieData.blancoynegro === "si",
    onHalfway,
  });
}

// ===========================================================
// REPRODUCTOR SERIES EN DETAIL VIEW (sp-)
// Espejo de openPlayerModal + loadMovieInPlayer con prefijo sp-
// ===========================================================
export async function playSeriesInDetailView(seriesId) {
  try {
    const seriesData = findContentData(seriesId);
    if (!seriesData) {
      shared.ErrorHandler.show(
        shared.ErrorHandler.types?.CONTENT || "content",
        "Serie no disponible.",
      );
      return;
    }
    seriesId = seriesData.id || seriesId;

    // Obtener primer episodio de la primera temporada disponible
    const episodesData = shared.appState.content.seriesEpisodes[seriesId] || {};
    const seasonKeys = Object.keys(episodesData);
    if (seasonKeys.length === 0) {
      shared.ErrorHandler.show("content", "No hay episodios disponibles.");
      return;
    }

    // Respetar orden de temporadas si existe
    let orderedKeys = seasonKeys;
    if (shared.appState.content.seasonOrder?.[seriesId]) {
      orderedKeys = shared.appState.content.seasonOrder[seriesId];
    }

    // ── Buscar progreso: Firebase primero (si hay sesión), luego localStorage ──
    let resumeSeasonKey = orderedKeys[0];
    let resumeEpisodeIndex = 0;

    try {
      const user = shared.auth?.currentUser;
      if (user) {
        // Leer historial de Firebase
        const snap = await shared.db
          .ref(`users/${user.uid}/history/${seriesId}`)
          .once("value");
        const histEntry = snap.val();
        if (
          histEntry &&
          histEntry.season != null &&
          histEntry.lastEpisode != null
        ) {
          const fbSeason = String(histEntry.season);
          const fbIndex = Number(histEntry.lastEpisode);
          // Validar que la temporada y el episodio existen
          const fbEpisodes = episodesData[fbSeason] || [];
          const fbEpisode = Array.isArray(fbEpisodes)
            ? fbEpisodes[fbIndex]
            : Object.values(fbEpisodes)[fbIndex];
          if (fbEpisode) {
            resumeSeasonKey = fbSeason;
            resumeEpisodeIndex = fbIndex;
          }
        }
      } else {
        // Sin sesión: leer de localStorage
        const allProgress =
          JSON.parse(localStorage.getItem("seriesProgress")) || {};
        const seriesProgress = allProgress[seriesId] || {};
        for (const key of orderedKeys) {
          if (seriesProgress[key] != null) {
            resumeSeasonKey = key;
            resumeEpisodeIndex = Number(seriesProgress[key]);
          }
        }
      }
    } catch (e) {
      /* fallback silencioso → T1 E1 */
    }

    const resumeEpisodes = episodesData[resumeSeasonKey] || [];
    const resumeEpisode = Array.isArray(resumeEpisodes)
      ? resumeEpisodes[resumeEpisodeIndex]
      : Object.values(resumeEpisodes)[resumeEpisodeIndex];

    // Si el índice guardado ya no existe (episodio borrado, etc.), caer al primero
    const firstEpisode =
      resumeEpisode ??
      (Array.isArray(resumeEpisodes)
        ? resumeEpisodes[0]
        : Object.values(resumeEpisodes)[0]);
    const firstSeasonKey = resumeEpisode ? resumeSeasonKey : orderedKeys[0];
    const firstEpisodeIndex = resumeEpisode ? resumeEpisodeIndex : 0;

    // Obtener tracks de idioma del episodio
    const tracks = getLangTracks(firstEpisode);
    if (tracks.length === 0) {
      shared.ErrorHandler.show(
        "content",
        "No hay video disponible para este episodio.",
      );
      return;
    }

    // Respetar idioma guardado o usar el primero
    let savedLang = null;
    try {
      const prefs = JSON.parse(localStorage.getItem("seriesLangPrefs")) || {};
      savedLang = prefs[seriesId];
    } catch (e) {}

    const activeLang =
      savedLang && tracks.some((t) => t.lang === savedLang)
        ? savedLang
        : window._spActiveLang || tracks[0].lang;
    const preferredTrack =
      tracks.find((t) => t.lang === activeLang) || tracks[0];

    // Cargar en el contenedor sp-
    loadSeriesInDetailPlayer(
      preferredTrack.id,
      seriesId,
      { ...firstEpisode, _season: firstSeasonKey, _index: firstEpisodeIndex },
      preferredTrack.lang,
    );

    // Barra de info
    const titleBar = document.getElementById("sp-player-title-bar");
    if (titleBar) titleBar.textContent = seriesData.title || "";

    const playerLang = document.getElementById("sp-player-lang");
    if (playerLang) playerLang.textContent = preferredTrack.label;

    const rawDuration =
      firstEpisode.duration ||
      firstEpisode.duracion ||
      seriesData.duration ||
      "";
    const playerDur = document.getElementById("sp-player-duration");
    if (playerDur) playerDur.textContent = rawDuration;

    const finishEl = document.getElementById("sp-player-finish-time");
    if (finishEl && rawDuration) {
      const ft = calculateFinishTime(rawDuration);
      finishEl.textContent = ft ? `Termina a las ${ft}` : "";
    }

    // Mostrar seccion reproductor con fade
    const playerSection = document.getElementById("sp-player-section");
    if (playerSection) {
      playerSection.style.display = "flex";

      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile) {
        const spHero = document.getElementById("sp-hero");
        if (spHero) {
          spHero.classList.add("sp-hero--playing");
          const mobileHeader = document.querySelector(".sp-mobile-header");
          if (mobileHeader) {
            const bg = spHero.style.backgroundImage;
            mobileHeader.style.backgroundImage = bg;
            mobileHeader.style.backgroundSize = "cover";
            mobileHeader.style.backgroundPosition = "center";
          }
        }
        const detailView = document.getElementById("sp-detail-view");
        if (detailView) detailView.classList.add("sp-detail-view--playing");
        const tabBar = document.getElementById("mobileTabBar");
        if (tabBar) tabBar.style.display = "none";
        const detailEl = document.getElementById("sp-detail-view");
        if (detailEl) detailEl.scrollTop = 0;

        // ── Botón cerrar flotante (móvil) — visible aunque sp-hero esté oculto ──
        if (!playerSection.querySelector(".sp-inline-player-close")) {
          const closeBtn = document.createElement("button");
          closeBtn.className = "sp-inline-player-close";
          closeBtn.setAttribute("aria-label", "Volver");
          closeBtn.style.cssText = [
            "position:absolute",
            "top:10px",
            "left:10px",
            "z-index:9999",
            "background:rgba(0,0,0,0.65)",
            "border:none",
            "border-radius:50%",
            "width:38px",
            "height:38px",
            "display:flex",
            "align-items:center",
            "justify-content:center",
            "cursor:pointer",
            "color:#fff",
            "font-size:17px",
            "box-shadow:0 2px 8px rgba(0,0,0,0.5)",
          ].join(";");
          closeBtn.innerHTML = '<i class="fas fa-arrow-left"></i>';
          closeBtn.onclick = () =>
            window.closeSeriesDetailView && window.closeSeriesDetailView();
          playerSection.style.position = "relative";
          playerSection.prepend(closeBtn);
        }
      } else {
        setTimeout(() => {
          playerSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
      }

      setTimeout(() => {
        playerSection.style.opacity = "1";
      }, 80);
    }

    // Sincronizar toggle de idioma si hay multiples tracks
    if (tracks.length > 1) {
      document.querySelectorAll(".sp-lang-btn").forEach((btn) => {
        const isActive = btn.onclick
          ?.toString()
          .includes(`"${preferredTrack.lang}"`);
        btn.classList.toggle("active", isActive);
      });

      window._spCurrentSeriesId = seriesId;
      window._spCurrentSeriesData = seriesData;
      window._spTracks = tracks;
    }

    // ── Llenar panel de episodios y temporadas del nuevo layout ──
    _fillSpPsPanel(
      seriesId,
      firstSeasonKey,
      firstEpisodeIndex,
      preferredTrack.lang,
    );

    // ── Poblar bloque detalles (título original, géneros, idioma) ──
    const _normStr = (s) =>
      String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, "");
    const _rawSecond = seriesData.secondTitle || "";
    const _origTitle =
      _rawSecond && _normStr(_rawSecond) !== _normStr(seriesData.title || "")
        ? _rawSecond
        : "";
    let _genresVal = "";
    if (seriesData.genres) {
      if (Array.isArray(seriesData.genres))
        _genresVal = seriesData.genres.join(", ");
      else if (typeof seriesData.genres === "string")
        _genresVal = seriesData.genres.replace(/;/g, ", ");
    }
    const _langLabel = preferredTrack.label || "";

    const _origRow = document.getElementById("sp-ps-orig-row");
    const _origEl = document.getElementById("sp-ps-orig-title");
    const _genRow = document.getElementById("sp-ps-genres-row");
    const _genEl = document.getElementById("sp-ps-genres");
    const _langRow = document.getElementById("sp-ps-lang-row");
    const _langEl = document.getElementById("sp-ps-lang-full");

    if (_origTitle && _origRow && _origEl) {
      _origEl.textContent = _origTitle;
      _origRow.style.display = "flex";
    }
    if (_genresVal && _genRow && _genEl) {
      _genEl.textContent = _genresVal;
      _genRow.style.display = "flex";
    }
    if (_langLabel && _langRow && _langEl) {
      _langEl.textContent = _langLabel;
      _langRow.style.display = "flex";
    }

    // ── Toggle chevron boceto ──
    const spPsChevronBtn = document.getElementById("sp-ps-chevron");
    const spPsSynopsis = document.getElementById("sp-ps-synopsis-wrap");
    const spPsHeader = document.getElementById("sp-ps-info-toggle");
    if (spPsChevronBtn && spPsSynopsis && spPsHeader) {
      const freshHdr = spPsHeader.cloneNode(true);
      spPsHeader.parentNode.replaceChild(freshHdr, spPsHeader);
      const freshChevron = freshHdr.querySelector(".sp-ps-chevron-icon");
      freshHdr.addEventListener("click", () => {
        const isOpen = spPsSynopsis.classList.contains("sp-ps-expanded");
        spPsSynopsis.classList.toggle("sp-ps-expanded", !isOpen);
        if (freshChevron)
          freshChevron.style.transform = isOpen
            ? "rotate(0deg)"
            : "rotate(180deg)";
      });
    }
  } catch (e) {
    logError(e, "Player: playSeriesInDetailView");
  }
}

// ── Abre el reproductor nuevo (sp-detail-view) en un episodio específico ──
export function playEpisodeInDetailView(seriesId, season, episodeIndex) {
  try {
    const seriesData = findContentData(seriesId);
    if (!seriesData) {
      shared.ErrorHandler.show("content", "Serie no disponible.");
      return;
    }
    seriesId = seriesData.id || seriesId;

    const episodesData = shared.appState.content.seriesEpisodes[seriesId] || {};
    const episodes = episodesData[season] || [];
    const episode = episodes[episodeIndex] ?? episodes[0];
    if (!episode) {
      shared.ErrorHandler.show("content", "No se encontraron episodios.");
      return;
    }

    // Respetar idioma guardado
    let savedLang = null;
    try {
      const prefs = JSON.parse(localStorage.getItem("seriesLangPrefs")) || {};
      savedLang = prefs[seriesId];
    } catch (e) {}

    const tracks = getLangTracks(episode);
    const activeLang =
      savedLang && tracks.some((t) => t.lang === savedLang)
        ? savedLang
        : window._spActiveLang || tracks[0]?.lang || "es";
    const preferredTrack =
      tracks.find((t) => t.lang === activeLang) || tracks[0];
    if (!preferredTrack) {
      shared.ErrorHandler.show("content", "No hay video disponible.");
      return;
    }

    loadSeriesInDetailPlayer(
      preferredTrack.id,
      seriesId,
      { ...episode, _season: season, _index: episodeIndex },
      preferredTrack.lang,
    );

    // Guardar progreso en localStorage para que "Reproducir" retome desde aquí
    try {
      const allProgress =
        JSON.parse(localStorage.getItem("seriesProgress")) || {};
      if (!allProgress[seriesId]) allProgress[seriesId] = {};
      allProgress[seriesId][season] = episodeIndex;
      localStorage.setItem("seriesProgress", JSON.stringify(allProgress));
    } catch (_) {}

    // Panel de temporadas y episodios
    _fillSpPsPanel(seriesId, season, episodeIndex, preferredTrack.lang);

    // Mostrar sección reproductor
    const playerSection = document.getElementById("sp-player-section");
    if (playerSection) {
      playerSection.style.display = "flex";
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile) {
        const spHero = document.getElementById("sp-hero");
        if (spHero) {
          spHero.classList.add("sp-hero--playing");
          const mobileHeader = document.querySelector(".sp-mobile-header");
          if (mobileHeader) {
            const bg = spHero.style.backgroundImage;
            mobileHeader.style.backgroundImage = bg;
            mobileHeader.style.backgroundSize = "cover";
            mobileHeader.style.backgroundPosition = "center";
          }
        }
        const detailView = document.getElementById("sp-detail-view");
        if (detailView) {
          detailView.classList.add("sp-detail-view--playing");
          detailView.scrollTop = 0;

          // ── Mantener .sp-controls-mobile sticky bajo .sp-ps-left (altura dinámica) ──
          // El sp-detail-view usa la estructura estática de index.html (.sp-ps-left),
          // no el template dinámico de player.js (.sp-left-col).
          const leftCol = detailView.querySelector(".sp-ps-left, .sp-left-col");
          if (leftCol && window.matchMedia("(max-width: 768px)").matches) {
            const _updateStickyTop = () => {
              document.documentElement.style.setProperty(
                "--sp-left-h",
                leftCol.offsetHeight + "px",
              );
            };
            _updateStickyTop();
            // Cancela el observer anterior si existe (re-entrada)
            if (detailView._leftColObserver)
              detailView._leftColObserver.disconnect();
            const ro = new ResizeObserver(_updateStickyTop);
            ro.observe(leftCol);
            detailView._leftColObserver = ro;
          }
        }
        const tabBar = document.getElementById("mobileTabBar");
        if (tabBar) tabBar.style.display = "none";

        // ── Botón cerrar flotante (móvil) — visible aunque sp-hero esté oculto ──
        if (!playerSection.querySelector(".sp-inline-player-close")) {
          const closeBtn = document.createElement("button");
          closeBtn.className = "sp-inline-player-close";
          closeBtn.setAttribute("aria-label", "Volver");
          closeBtn.style.cssText = [
            "position:absolute",
            "top:10px",
            "left:10px",
            "z-index:9999",
            "background:rgba(0,0,0,0.65)",
            "border:none",
            "border-radius:50%",
            "width:38px",
            "height:38px",
            "display:flex",
            "align-items:center",
            "justify-content:center",
            "cursor:pointer",
            "color:#fff",
            "font-size:17px",
            "box-shadow:0 2px 8px rgba(0,0,0,0.5)",
          ].join(";");
          closeBtn.innerHTML = '<i class="fas fa-arrow-left"></i>';
          closeBtn.onclick = () =>
            window.closeSeriesDetailView && window.closeSeriesDetailView();
          playerSection.style.position = "relative";
          playerSection.prepend(closeBtn);
        }
      } else {
        setTimeout(
          () =>
            playerSection.scrollIntoView({
              behavior: "smooth",
              block: "start",
            }),
          80,
        );
      }
      setTimeout(() => {
        playerSection.style.opacity = "1";
      }, 80);
    }

    if (tracks.length > 1) {
      window._spCurrentSeriesId = seriesId;
      window._spCurrentSeriesData = seriesData;
      window._spTracks = tracks;
    }

    // ── Toggle chevron sinopsis (mismo que playSeriesInDetailView) ──
    const spPsChevronBtn = document.getElementById("sp-ps-chevron");
    const spPsSynopsis = document.getElementById("sp-ps-synopsis-wrap");
    const spPsHeader = document.getElementById("sp-ps-info-toggle");
    if (spPsChevronBtn && spPsSynopsis && spPsHeader) {
      const freshHdr = spPsHeader.cloneNode(true);
      spPsHeader.parentNode.replaceChild(freshHdr, spPsHeader);
      const freshChevron = freshHdr.querySelector(".sp-ps-chevron-icon");
      freshHdr.addEventListener("click", () => {
        const isOpen = spPsSynopsis.classList.contains("sp-ps-expanded");
        spPsSynopsis.classList.toggle("sp-ps-expanded", !isOpen);
        if (freshChevron)
          freshChevron.style.transform = isOpen
            ? "rotate(0deg)"
            : "rotate(180deg)";
      });
    }
  } catch (e) {
    logError(e, "Player: playEpisodeInDetailView");
  }
}

function _spChangeLang(seriesId, lang) {
  window._spActiveLang = lang;
  try {
    const prefs = JSON.parse(localStorage.getItem("seriesLangPrefs")) || {};
    prefs[seriesId] = lang;
    localStorage.setItem("seriesLangPrefs", JSON.stringify(prefs));
  } catch (e) {}

  const currentEp = window._spCurrentEpisodeData;
  if (!currentEp) return;

  let resolvedVideoId;
  if (lang === "en" && currentEp.videoId_en)
    resolvedVideoId = currentEp.videoId_en;
  else if (lang === "es" && currentEp.videoId_es)
    resolvedVideoId = currentEp.videoId_es;
  else resolvedVideoId = currentEp.videoId;

  loadSeriesInDetailPlayer(resolvedVideoId, seriesId, currentEp, lang);
}

// ── Función auxiliar: llena el panel sp-ps con temporadas y episodios ──
function _fillSpPsPanel(seriesId, activeSeasonKey, activeEpIndex, lang) {
  const episodesData = shared.appState.content.seriesEpisodes[seriesId] || {};
  const postersData = shared.appState.content.seasonPosters[seriesId] || {};
  const orderedKeys = shared.appState.content.seasonOrder?.[seriesId] || [
    ...new Set([...Object.keys(episodesData), ...Object.keys(postersData)]),
  ];

  // ── Temporadas ──────────────────────────────────────────────────────
  const _spPsSeasonCarousel = document.getElementById("sp-ps-season-carousel");
  const tabsContainer = document.getElementById("sp-ps-season-tabs");
  const _seriesInfo = findContentData(seriesId) || {};
  const _nombreTmp = String(_seriesInfo.nombreTemporadas || "").trim();
  const _seasonWordPlural = _nombreTmp ? `${_nombreTmp}s` : "Temporadas";
  const _carouselTitle = _spPsSeasonCarousel?.querySelector(
    ".sp-panel-section-title",
  );
  if (_carouselTitle) _carouselTitle.textContent = _seasonWordPlural;

  if (tabsContainer) {
    tabsContainer.innerHTML = "";
    // Ocultar toda la sección si hay solo una temporada
    if (_spPsSeasonCarousel)
      _spPsSeasonCarousel.style.display = orderedKeys.length <= 1 ? "none" : "";
    orderedKeys.forEach((key) => {
      const posterEntry = postersData[key];
      const label =
        (posterEntry?.etiqueta || "").trim() || (isNaN(key) ? key : `T${key}`);
      const posterUrl =
        posterEntry?.posterUrl ||
        posterEntry?.url ||
        posterEntry?.image ||
        posterEntry?.poster ||
        "";

      const tab = document.createElement("button");
      tab.className =
        "sp-season-tab" +
        (String(key) === String(activeSeasonKey) ? " active" : "");
      tab.innerHTML = posterUrl
        ? `<img src="${posterUrl}" alt="${label}" loading="lazy">
           <div class="sp-season-tab-overlay"><span class="sp-season-tab-label">${label}</span></div>`
        : `<div class="sp-season-tab-overlay" style="background:rgba(0,0,0,0.5);justify-content:center;">
             <span class="sp-season-tab-label" style="font-size:0.7rem;">${label}</span>
           </div>`;
      tab.addEventListener("click", () => {
        _fillSpPsPanel(seriesId, key, 0, lang);
        // También reproducir primer ep de la temporada seleccionada
        const eps =
          shared.appState.content.seriesEpisodes[seriesId]?.[key] || [];
        if (eps[0]) {
          const t = getLangTracks(eps[0]);
          const track = t.find((x) => x.lang === lang) || t[0];
          if (track)
            loadSeriesInDetailPlayer(
              track.id,
              seriesId,
              { ...eps[0], _season: key, _index: 0 },
              track.lang,
            );
          _updateSpPsInfo(eps[0], key, seriesId, track?.label || "");
        }
      });
      tabsContainer.appendChild(tab);
    });

    // Flechas del carrusel
    const prev = document.getElementById("sp-ps-carousel-prev");
    const next = document.getElementById("sp-ps-carousel-next");
    if (prev)
      prev.onclick = () =>
        tabsContainer.scrollBy({ left: -120, behavior: "smooth" });
    if (next)
      next.onclick = () =>
        tabsContainer.scrollBy({ left: 120, behavior: "smooth" });

    // Scroll al tab activo
    requestAnimationFrame(() => {
      tabsContainer.querySelector(".sp-season-tab.active")?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    });
  }

  // DESPUÉS
  // ── Mobile: conectar botón al drawer de temporadas ──
  const mobileSeasonsBtn = document.getElementById("sp-ps-mobile-season-btn");
  // Mostrar/ocultar la fila contenedora (temporada + idioma inline)
  const spControlsRow = document.getElementById("sp-ps-controls-row");
  if (mobileSeasonsBtn) {
    if (Object.keys(episodesData).length <= 1) {
      mobileSeasonsBtn.style.setProperty("display", "none", "important");
      // No tocar spControlsRow — mobile-only en CSS lo gestiona
    } else {
      mobileSeasonsBtn.style.display = "";
      // No tocar spControlsRow — mobile-only en CSS lo gestiona

      // Construir mapa de etiquetas y posters para el drawer
      const _seasonWord = String(
        (findContentData(seriesId) || {}).nombreTemporadas || "",
      ).trim();
      const postersList = {};
      const etiquetasMap = {};
      orderedKeys.forEach((k, i) => {
        const pe = postersData[k];
        postersList[k] =
          pe?.posterUrl || pe?.url || pe?.image || pe?.poster || "";
        const eta = (typeof pe === "object" ? pe?.etiqueta : "") || "";
        etiquetasMap[k] =
          eta.trim() ||
          `${_seasonWord || "Temporada"} ${!isNaN(k) ? Number(k) : i + 1}`;
      });

      // Texto del botón activo: usar etiqueta si existe, sino nombreTemporadas + número
      const _activeLabel =
        etiquetasMap[activeSeasonKey] ||
        (_seasonWord || "Temporada") +
          " " +
          String(activeSeasonKey).replace("T", "");
      mobileSeasonsBtn.innerHTML = `${_activeLabel} <i class="fas fa-chevron-down"></i>`;

      mobileSeasonsBtn.onclick = () => {
        window.openSeasonDrawer(
          orderedKeys,
          postersList,
          activeSeasonKey,
          (selectedKey) => {
            _fillSpPsPanel(seriesId, selectedKey, 0, lang);
            const eps =
              shared.appState.content.seriesEpisodes[seriesId]?.[selectedKey] ||
              [];
            if (eps[0]) {
              const t = getLangTracks(eps[0]);
              const track = t.find((x) => x.lang === lang) || t[0];
              if (track)
                loadSeriesInDetailPlayer(
                  track.id,
                  seriesId,
                  { ...eps[0], _season: selectedKey, _index: 0 },
                  track.lang,
                );
              _updateSpPsInfo(
                eps[0],
                selectedKey,
                seriesId,
                track?.label || "",
              );
            }
          },
          etiquetasMap,
          _seasonWord,
        );
      };
    }
  }

  // ── Selector de idioma (cc-custom-lang-wrapper, igual que renderEpisodePlayer) ──
  const langContainer = document.getElementById("sp-ps-inline-lang");
  if (langContainer) {
    const activeEpForLang = (episodesData[activeSeasonKey] || [])[
      activeEpIndex
    ];
    const tracks = activeEpForLang ? getLangTracks(activeEpForLang) : [];

    if (tracks.length > 1) {
      const currentLabel =
        tracks.find((t) => t.lang === lang)?.label || tracks[0].label;
      const optionsHtml = tracks
        .map(
          (t) => `
      <div class="cc-lang-option ${t.lang === lang ? "active" : ""}" data-lang="${t.lang}"
        style="padding:10px 15px;cursor:pointer;
               color:${t.lang === lang ? "#fff" : "#aaa"};
               background:${t.lang === lang ? "var(--accent-color)" : "transparent"};
               font-size:11px;font-weight:bold;text-transform:uppercase;
               transition:0.2s;border-bottom:1px solid #222;">
        ${t.label}
      </div>`,
        )
        .join("");

      langContainer.innerHTML = `
      <div class="cc-custom-lang-wrapper" style="position:relative;display:inline-block;font-family:'Montserrat',sans-serif;">
        <div class="cc-lang-trigger" style="display:inline-flex;align-items:center;gap:6px;background:none;border:none;padding:0;cursor:pointer;transition:color 0.2s;">
          <i class="fas fa-language" style="font-size:14px;color:var(--text-muted);pointer-events:none;transition:color 0.2s;"></i>
          <span style="color:var(--text-light);font-size:0.9rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;pointer-events:none;transition:color 0.2s;">${currentLabel}</span>
          <i class="fas fa-chevron-down" style="font-size:0.7rem;color:var(--text-muted);pointer-events:none;transition:color 0.2s;"></i>
        </div>
        <div class="cc-lang-menu" style="display:none;position:absolute;top:calc(100% + 5px);right:0;background:#141414;border:1px solid #333;border-radius:8px;overflow:hidden;z-index:999999;min-width:130px;box-shadow:0 10px 25px rgba(0,0,0,0.9);">
          ${optionsHtml}
        </div>
      </div>`;

      const trigger = langContainer.querySelector(".cc-lang-trigger");
      const menu = langContainer.querySelector(".cc-lang-menu");

      // Hover — funciona en desktop, ignorado en touch
      const _ac2 = getComputedStyle(document.documentElement)
        .getPropertyValue("--accent-color")
        .trim();
      const _mc2 = getComputedStyle(document.documentElement)
        .getPropertyValue("--text-muted")
        .trim();
      const _lc2 = getComputedStyle(document.documentElement)
        .getPropertyValue("--text-light")
        .trim();
      trigger.addEventListener("mouseenter", () => {
        trigger.querySelectorAll("span").forEach((s) => (s.style.color = _ac2));
        trigger.querySelectorAll("i").forEach((i) => (i.style.color = _ac2));
      });
      trigger.addEventListener("mouseleave", () => {
        trigger.querySelectorAll("span").forEach((s) => (s.style.color = _lc2));
        trigger.querySelectorAll("i").forEach((i) => (i.style.color = _mc2));
      });

      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        menu.style.display = menu.style.display === "block" ? "none" : "block";
      });
      document.addEventListener("click", () => {
        menu.style.display = "none";
      });

      langContainer.querySelectorAll(".cc-lang-option").forEach((opt) => {
        opt.addEventListener("click", (e) => {
          e.stopPropagation();
          menu.style.display = "none";
          _spChangeLang(seriesId, opt.dataset.lang);
          langContainer.querySelectorAll(".cc-lang-option").forEach((o) => {
            const isActive = o.dataset.lang === opt.dataset.lang;
            o.style.background = isActive
              ? "var(--accent-color)"
              : "transparent";
            o.style.color = isActive ? "#fff" : "#aaa";
            o.classList.toggle("active", isActive);
          });
          const span = trigger.querySelector("span");
          if (span) span.textContent = opt.textContent.trim();
        });
      });

      langContainer.style.display = "";
    } else {
      langContainer.style.display = "none";
    }
  }

  // ── Selector de idioma en desktop (sp-ps-inline-lang-desktop) ──────
  const langContainerDesktop = document.getElementById(
    "sp-ps-inline-lang-desktop",
  );
  if (langContainerDesktop) {
    const activeEpForLangD = (episodesData[activeSeasonKey] || [])[
      activeEpIndex
    ];
    const tracksD = activeEpForLangD ? getLangTracks(activeEpForLangD) : [];

    if (tracksD.length > 1) {
      const currentLabelD =
        tracksD.find((t) => t.lang === lang)?.label || tracksD[0].label;
      const optionsHtmlD = tracksD
        .map(
          (t) => `
        <div class="cc-lang-option ${t.lang === lang ? "active" : ""}" data-lang="${t.lang}"
          style="padding:10px 15px;cursor:pointer;
                 color:${t.lang === lang ? "#fff" : "#aaa"};
                 background:${t.lang === lang ? "var(--accent-color)" : "transparent"};
                 font-size:11px;font-weight:bold;text-transform:uppercase;
                 transition:0.2s;border-bottom:1px solid #222;">
          ${t.label}
        </div>`,
        )
        .join("");

      langContainerDesktop.innerHTML = `
        <div class="cc-custom-lang-wrapper" style="position:relative;display:inline-block;font-family:'Montserrat',sans-serif;">
          <div class="cc-lang-trigger" style="display:inline-flex;align-items:center;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:7px 12px;cursor:pointer;transition:all 0.2s ease;">
            <i class="fas fa-language" style="color:var(--accent-color);font-size:14px;margin-right:8px;pointer-events:none;"></i>
            <span style="color:#fff;font-size:12px;font-weight:700;text-transform:uppercase;padding-right:10px;letter-spacing:0.5px;pointer-events:none;">${currentLabelD}</span>
            <i class="fas fa-chevron-down" style="font-size:10px;color:#aaa;pointer-events:none;"></i>
          </div>
          <div class="cc-lang-menu" style="display:none;position:absolute;top:calc(100% + 5px);right:0;background:#141414;border:1px solid #333;border-radius:8px;overflow:hidden;z-index:999999;min-width:130px;box-shadow:0 10px 25px rgba(0,0,0,0.9);">
            ${optionsHtmlD}
          </div>
        </div>`;

      const triggerD = langContainerDesktop.querySelector(".cc-lang-trigger");
      const menuD = langContainerDesktop.querySelector(".cc-lang-menu");

      triggerD.addEventListener("click", (e) => {
        e.stopPropagation();
        menuD.style.display =
          menuD.style.display === "block" ? "none" : "block";
      });
      document.addEventListener("click", () => {
        menuD.style.display = "none";
      });

      langContainerDesktop
        .querySelectorAll(".cc-lang-option")
        .forEach((opt) => {
          opt.addEventListener("click", (e) => {
            e.stopPropagation();
            menuD.style.display = "none";
            _spChangeLang(seriesId, opt.dataset.lang);
            langContainerDesktop
              .querySelectorAll(".cc-lang-option")
              .forEach((o) => {
                const isActive = o.dataset.lang === opt.dataset.lang;
                o.style.background = isActive
                  ? "var(--accent-color)"
                  : "transparent";
                o.style.color = isActive ? "#fff" : "#aaa";
                o.classList.toggle("active", isActive);
              });
            const span = triggerD.querySelector("span");
            if (span) span.textContent = opt.textContent.trim();
          });
        });

      langContainerDesktop.style.display = "";
    } else {
      langContainerDesktop.style.display = "none";
    }
  }

  // ── Episodios ───────────────────────────────────────────────────────
  const listContainer = document.getElementById("sp-ps-episode-list");
  if (!listContainer) return;
  listContainer.innerHTML = "";

  const episodes = (episodesData[activeSeasonKey] || [])
    .filter(ep => String(ep?.proximamente || "").trim().toLowerCase() !== "si");
  episodes.forEach((ep, idx) => {
    const thumbUrl = ep.thumbnail || ep.thumb || ep.image || "";
    const epNum = ep.episodeNumber || idx + 1;
    const epTitle = ep.title || `Episodio ${epNum}`;
    const epDesc = ep.description || ep.synopsis || ep.desc || "";
    const epDur = ep.duration || ep.duracion || "";
    const isActive = idx === activeEpIndex;

    const item = document.createElement("div");
    item.className =
      "sp-episode-item sp-episode-item-mobile" + (isActive ? " active" : "");
    item.id = `sp-ps-ep-${seriesId}-${activeSeasonKey}-${idx}`;
    item.innerHTML = `
  <div class="sp-ep-thumb">
    ${thumbUrl ? `<img src="${thumbUrl}" alt="${epTitle}" loading="lazy">` : `<span class="sp-ep-thumb-num">E${String(epNum).padStart(2, "0")}</span>`}
    <span class="sp-ep-num">${String(epNum).padStart(2, "0")}</span>
    ${epDur ? `<span class="sp-ep-duration-badge">${epDur}</span>` : ""}
    <div class="sp-ep-play-overlay">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>
    </div>
  </div>
  <div class="sp-ep-info">
    <div class="sp-ep-name">${epTitle}</div>
    ${epDesc ? `<div class="sp-ep-desc">${epDesc}</div>` : ""}
  </div>`;

    item.addEventListener("click", () => {
      // Marcar activo
      listContainer
        .querySelectorAll(".sp-episode-item")
        .forEach((i) => i.classList.remove("active"));
      item.classList.add("active");

      window._spCurrentEpisodeData = {
        ...ep,
        _season: activeSeasonKey,
        _index: idx,
      };

      // Reproducir
      const t = getLangTracks(ep);
      const track = t.find((x) => x.lang === lang) || t[0];
      if (track)
        loadSeriesInDetailPlayer(
          track.id,
          seriesId,
          { ...ep, _season: activeSeasonKey, _index: idx },
          track.lang,
        );
      _updateSpPsInfo(ep, activeSeasonKey, seriesId, track?.label || "", idx);
      item.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    listContainer.appendChild(item);
  });

  // Scroll al episodio activo
  requestAnimationFrame(() => {
    listContainer
      .querySelector(".sp-episode-item.active")
      ?.scrollIntoView({ block: "nearest" });
  });

  // Actualizar strip info con el episodio activo actual
  const activeEp = episodes[activeEpIndex];
  if (activeEp) {
    window._spCurrentEpisodeData = {
      ...activeEp,
      _season: activeSeasonKey,
      _index: activeEpIndex,
    };
    const t = getLangTracks(activeEp);
    const track = t.find((x) => x.lang === lang) || t[0];
    _updateSpPsInfo(
      activeEp,
      activeSeasonKey,
      seriesId,
      track?.label || "",
      activeEpIndex,
    );
  }
}

// ── Actualiza la franja info debajo del video ──
function _updateSpPsInfo(ep, seasonKey, seriesId, langLabel, epIndex = 0) {
  const postersData =
    shared.appState.content.seasonPosters[seriesId]?.[seasonKey] || {};
  const customLabel = postersData.etiqueta || "";
  const isSpecial = [
    "pelicula",
    "película",
    "especial",
    "ova",
    "movie",
    "special",
  ].some((s) => String(seasonKey).toLowerCase().includes(s));
  const epNum = ep.episodeNumber || epIndex + 1;
  const allRealSeasons = Object.keys(
    shared.appState.content.seriesEpisodes[seriesId] || {}
  ).filter(s => {
    const sl = String(s).toLowerCase();
    return !sl.includes("pelicula") && !sl.includes("película") &&
           !sl.includes("especial") && !sl.includes("ova") &&
           !sl.includes("movie") && !sl.includes("special");
  });
  const isSingleSeasonPs = allRealSeasons.length <= 1;
  const seasonLabel = customLabel
    ? `${customLabel} · Ep ${epNum}`
    : isSpecial
      ? "Especial / Película"
      : isSingleSeasonPs
        ? `Episodio ${epNum}`
        : `Temporada ${String(seasonKey).replace("T", "")} · Ep ${epNum}`;

  const titleBar = document.getElementById("sp-player-title-bar");
  const epTitleEl = document.getElementById("sp-ps-ep-title");
  const langEl = document.getElementById("sp-player-lang");
  const durEl = document.getElementById("sp-player-duration");
  const finishEl = document.getElementById("sp-player-finish-time");
  const estrenoEl = document.getElementById("sp-player-estreno");
  const synEl = document.getElementById("sp-ps-synopsis-text");

  if (titleBar) titleBar.textContent = seasonLabel;
  if (epTitleEl) epTitleEl.textContent = ep.title || "";
  if (langEl) langEl.textContent = langLabel;

  // Sincronizar dropdown de idioma inline (sp-ps-inline-lang)
  const _ib1 = document.getElementById("sp-ps-lang-btn-1");
  const _ib2 = document.getElementById("sp-ps-lang-btn-2");
  const _lbLabel = document.getElementById("sp-ps-lang-label");
  if (_ib1 && _ib2 && langLabel) {
    const _lbl = langLabel.toLowerCase();
    const _isEs = ["latino", "español", "castellano", "doblado", "esp"].some(
      (s) => _lbl.includes(s),
    );
    _ib1.classList.toggle("active", !_isEs);
    _ib2.classList.toggle("active", _isEs);
    if (_lbLabel)
      _lbLabel.textContent = _isEs ? _ib2.textContent : _ib1.textContent;
  }
  const rawDur = ep.duration || ep.duracion || "";
  if (durEl) durEl.textContent = rawDur;
  if (estrenoEl) estrenoEl.textContent = "";
  if (finishEl) {
    const ft = rawDur ? calculateFinishTime(rawDur) : null;
    const rawEstreno = ep.fechaEstreno || "";
    let fechaStr = "";
    if (rawEstreno) {
      const meses = [
        "Enero",
        "Febrero",
        "Marzo",
        "Abril",
        "Mayo",
        "Junio",
        "Julio",
        "Agosto",
        "Septiembre",
        "Octubre",
        "Noviembre",
        "Diciembre",
      ];
      let dia, mes, anio;
      if (rawEstreno.includes("T") || rawEstreno.includes("-")) {
        const d = new Date(rawEstreno);
        dia = d.getUTCDate();
        mes = d.getUTCMonth();
        anio = d.getUTCFullYear();
      } else if (rawEstreno.includes("/")) {
        const p = rawEstreno.split("/");
        dia = parseInt(p[0], 10);
        mes = parseInt(p[1], 10) - 1;
        anio = p[2];
      }
      if (dia && meses[mes] && anio)
        fechaStr = `${dia} de ${meses[mes]} de ${anio}`;
    }
    // Desktop: texto completo
    const partesDesktop = [];
    if (fechaStr) partesDesktop.push(`Fecha de emisión: ${fechaStr}`);
    if (ft) partesDesktop.push(`Terminas de ver a las ${ft}`);
    finishEl.textContent = partesDesktop.join(" · ");
    // Móvil: dos líneas
    const finishMobileEl = document.getElementById(
      "sp-player-finish-time-mobile",
    );
    if (finishMobileEl) {
      const lineaMobile = [];
      if (fechaStr) lineaMobile.push(`Emisión: ${fechaStr}`);
      if (ft) lineaMobile.push(`Terminas a las ${ft}`);
      finishMobileEl.innerHTML = lineaMobile.join("<br>");
    }
  }
  if (synEl) synEl.textContent = ep.description || ep.synopsis || ep.desc || "";

  // Colapsar expandible y resetear chevron al cambiar episodio
  const _synWrap = document.getElementById("sp-ps-synopsis-wrap");
  const _chevIcon = document.querySelector(
    "#sp-ps-chevron .sp-ps-chevron-icon",
  );
  if (_synWrap) _synWrap.classList.remove("sp-ps-expanded");
  if (_chevIcon) _chevIcon.style.transform = "rotate(0deg)";

  // Re-medir .sp-ps-left tras inyectar fechas — el ResizeObserver puede llegar tarde
  // en algunos browsers; un rAF garantiza que el layout ya fue calculado.
  if (window.matchMedia("(max-width: 768px)").matches) {
    requestAnimationFrame(() => {
      const dv = document.getElementById("sp-detail-view");
      const lc = dv?.querySelector(".sp-ps-left, .sp-left-col");
      if (lc) {
        document.documentElement.style.setProperty(
          "--sp-left-h",
          lc.offsetHeight + "px",
        );
      }
    });
  }
}

function loadSeriesInDetailPlayer(videoId, seriesId, episodeData, lang = "es") {
  const container = document.getElementById("sp-video-container");
  if (!container) return;

  // ✅ AGREGAR ESTAS LÍNEAS — setean el estado que lee el panel de episodios
  shared.appState.player.activeSeriesId = seriesId;
  if (episodeData?._season !== undefined) {
    shared.appState.player.state[seriesId] = {
      ...shared.appState.player.state[seriesId],
      season: episodeData._season,
      episodeIndex: episodeData._index ?? 0,
      lang,
    };
  }

  // Guardar pendingHistorySave para registrar historial al cerrar
  if (
    episodeData &&
    episodeData._season !== undefined &&
    episodeData._index !== undefined
  ) {
    commitAndClearPendingSave();
    shared.appState.player.pendingHistorySave = {
      contentId: seriesId,
      type: "series",
      episodeInfo: {
        season: episodeData._season,
        index: episodeData._index,
        title: episodeData.title || "",
      },
    };
  }

  if (shared.appState.player.activeCineInstance) {
    shared.appState.player.activeCineInstance.destroy();
    shared.appState.player.activeCineInstance = null;
  }
  container.innerHTML = "";

  // ── NUEVO: Blindaje contra el scroll "aplastante" de móviles ──
  container.style.setProperty("position", "relative", "important");
  container.style.setProperty(
    "flex-shrink",
    "0",
    "important",
  ); /* Prohíbe que se encoja */
  container.style.setProperty(
    "aspect-ratio",
    "16/9",
    "important",
  ); /* Mantiene proporción de cine */

  const artContainer = document.createElement("div");
  artContainer.className = "artplayer-container";
  // Forzamos posición absoluta para que respete milimétricamente a su contenedor padre
  artContainer.style.cssText =
    "position:absolute !important; top:0 !important; left:0 !important; width:100% !important; height:100% !important; background:#000 !important;";
  container.appendChild(artContainer);

  shared.appState.player.activeCineInstance = new CinePlayer(artContainer);

  // Subtitulos segun idioma
  let subId, subType;
  if (lang === "en" && episodeData.subId_en) {
    subId = episodeData.subId_en;
    subType = episodeData.subType_en || "srt";
  } else if (episodeData.subId_es) {
    subId = episodeData.subId_es;
    subType = episodeData.subType_es || "srt";
  } else {
    const config = ContentManager.getSubtitleConfig(episodeData);
    subId = config.subId;
    subType = config.subType;
  }

  const seriesData = findContentData(seriesId) || {};

  shared.appState.player.activeCineInstance.load({
    videoId,
    subId,
    subType,
    title: episodeData.title || seriesData.title || "",
    poster:
      episodeData.thumbnail ||
      episodeData.thumb ||
      episodeData.image ||
      seriesData.poster ||
      seriesData.image ||
      "",
    grayscale: seriesData.blancoynegro === "si",
  });
}

export function loadSeriesTrack(videoId, seriesId, seriesData, lang) {
  const currentEp = window._spCurrentEpisodeData;
  if (currentEp) {
    let resolvedVideoId;
    if (lang === "en" && currentEp.videoId_en)
      resolvedVideoId = currentEp.videoId_en;
    else if (lang === "es" && currentEp.videoId_es)
      resolvedVideoId = currentEp.videoId_es;
    else resolvedVideoId = currentEp.videoId;

    loadSeriesInDetailPlayer(resolvedVideoId, seriesId, currentEp, lang);
    return;
  }

  // Fallback: primer episodio de primera temporada
  const episodesData = shared.appState.content.seriesEpisodes[seriesId] || {};
  const seasonKeys = Object.keys(episodesData);
  const firstSeasonKey = seasonKeys[0];
  const firstEpisodes = episodesData[firstSeasonKey] || [];
  const firstEpisode = Array.isArray(firstEpisodes)
    ? firstEpisodes[0]
    : Object.values(firstEpisodes)[0];

  loadSeriesInDetailPlayer(videoId, seriesId, firstEpisode || seriesData, lang);
}

export function playRandomEpisode(seriesId) {
  const episodesData = shared.appState.content.seriesEpisodes[seriesId];
  if (!episodesData) {
    shared.ErrorHandler.show(
      "content",
      "No hay episodios disponibles para esta serie.",
    );
    return;
  }

  const allEpisodes = Object.entries(episodesData).flatMap(
    ([seasonKey, episodes]) =>
      episodes.map((ep, index) => ({ ...ep, season: seasonKey, index: index })),
  );

  if (allEpisodes.length === 0) {
    shared.ErrorHandler.show(
      "content",
      "No se encontraron episodios registrados.",
    );
    return;
  }

  const randomEpisode =
    allEpisodes[Math.floor(Math.random() * allEpisodes.length)];
  if (typeof openPlayerToEpisode === "function") {
    shared.closeAllModals();
    openPlayerToEpisode(seriesId, randomEpisode.season, randomEpisode.index);
  }
}

export function openSeriesPlayerDirectlyToSeason(seriesId, seasonNum) {
  const seriesInfo = findContentData(seriesId);
  if (!seriesInfo) return;

  shared.closeAllModals();
  _openSeriesPlayerPage();
  renderEpisodePlayer(seriesId, seasonNum);
}

export function openPlayerToEpisode(seriesId, seasonNum, episodeIndex) {
  const seriesInfo = findContentData(seriesId);
  if (!seriesInfo) return;

  shared.closeAllModals();
  _openSeriesPlayerPage();
  renderEpisodePlayer(seriesId, seasonNum, episodeIndex);
}

function calculateFinishTime(durationStr) {
  if (!durationStr) return null;

  let hours = 0,
    minutes = 0,
    seconds = 0;

  durationStr = durationStr.toString().trim();

  if (durationStr.includes(":")) {
    const parts = durationStr.split(":").map(Number);
    if (parts.length === 3) {
      [hours, minutes, seconds] = parts;
    } else if (parts.length === 2) {
      if (parts[0] > 7) {
        [minutes, seconds] = parts;
      } else {
        [hours, minutes] = parts;
      }
    }
  } else {
    const hMatch = durationStr.match(/(\d+)\s*h/);
    const mMatch = durationStr.match(/(\d+)\s*m/);
    if (hMatch) hours = parseInt(hMatch[1]);
    if (mMatch) minutes = parseInt(mMatch[1]);
    if (!hMatch && !mMatch && durationStr.includes("min")) {
      const minOnly = parseInt(durationStr);
      if (!isNaN(minOnly)) minutes = minOnly;
    }
  }

  const now = new Date();
  const durationMs = hours * 3600000 + minutes * 60000 + seconds * 1000;
  const endTime = new Date(now.getTime() + durationMs);

  return endTime.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function loadMovieTrack(videoId, movieId, movieData, lang) {
  loadMovieInPlayer(videoId, movieId, movieData, lang);
}
