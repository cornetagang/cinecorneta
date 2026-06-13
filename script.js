// ===========================================================
// CINE CORNETA - SCRIPT PRINCIPAL
// Versión: 10 The Comeback
// ===========================================================

// ===========================================================
// 1. IMPORTS
// ===========================================================
import { API_URL, firebaseConfig, UI, THEMES, WORKER_URL } from "./core/config.js";
import { logError, ErrorHandler, initLogger } from "./utils/logger.js";
import CacheManager from "./utils/cache-manager.js";
import ModalManager from "./utils/modal-manager.js";
import ContentManager from "./utils/content-manager.js";
import ThemeManager, { updateThemeAssets } from "./utils/theme-manager.js";
import LazyImageLoader, { injectLazyLoadingStyles } from "./utils/lazy-loader.js";
import { initUniverses, renderUniversesHub } from "./features/universes.js";

// Instancias vacías (se llenan abajo)
let cacheManager;
let modalManager;
let lazyLoader;
let contentManager;

function checkUserLogin() {
  const user = JSON.parse(localStorage.getItem("cineCornetoUser"));

  // Mantener estructura de appState.user incluso sin usuario logueado
  if (typeof appState !== "undefined") {
    if (user) {
      appState.user = {
        ...user,
        watchlist: appState.user?.watchlist || new Map(),
        historyListenerRef: appState.user?.historyListenerRef || null,
      };
    } else {
      appState.user = {
        watchlist: new Map(),
        historyListenerRef: null,
      };
    }
  }

  // 1. Saludo Escritorio
  if (typeof DOM !== "undefined" && DOM.userGreetingBtn) {
    DOM.userGreetingBtn.textContent = user ? `Hola, ${user.username}` : "";
  }

  // 2. Email en Profile Hub Móvil
  const profileHubEmail = document.getElementById("profile-hub-email");
  if (profileHubEmail) {
    if (user) {
      profileHubEmail.textContent = user.email;
      profileHubEmail.style.display = "block";
    } else {
      profileHubEmail.textContent = "Visitante";
      profileHubEmail.style.display = "block";
    }
  }

  // 3. Menús
  if (typeof DOM !== "undefined") {
    if (user) {
      if (DOM.loginBtn) DOM.loginBtn.style.display = "none";
      if (DOM.userMenuContainer) DOM.userMenuContainer.style.display = "block";
    } else {
      if (DOM.loginBtn) DOM.loginBtn.style.display = "block";
      if (DOM.userMenuContainer) DOM.userMenuContainer.style.display = "none";
      if (DOM.userMenuDropdown && DOM.userMenuDropdown.classList)
        DOM.userMenuDropdown.classList.remove("show");
    }
  }
}

// Módulos dinámicos
let playerModule = null;
let profileModule = null;
let rouletteModule = null;
let reviewsModule = null;
let universesModule = null;

async function getPlayerModule() {
  if (playerModule) return playerModule;
  const module = await import("./features/player.js?v=27");
  module.initPlayer({
    appState,
    DOM,
    ErrorHandler,
    auth,
    db,
    addToHistoryIfLoggedIn,
    switchView,
    THEMES,
    closeAllModals: () => modalManager.closeAll(),
    openDetailsModal,
  });
  playerModule = module;
  return playerModule;
}

async function getProfileModule() {
  if (profileModule) return profileModule;
  const module = await import("./features/profile.js?v=8");
  module.initProfile({
    appState,
    DOM,
    auth,
    db,
    switchView,
    ErrorHandler,
  });
  profileModule = module;
  module.setupUserDropdown();
  return profileModule;
}

async function getRouletteModule() {
  if (rouletteModule) return rouletteModule;
  const module = await import("./features/roulette.js?v=8");
  module.initRoulette({
    appState,
    DOM,
    createMovieCardElement,
    openDetailsModal,
    auth,
    db,
    getPlayerModule,
    addToHistoryIfLoggedIn,
  });
  rouletteModule = module;
  return module;
}

async function getReviewsModule() {
  if (reviewsModule) return reviewsModule;
  const module = await import("./features/reviews.js?v=8");
  module.initReviews({
    appState,
    DOM,
    auth,
    db,
    ErrorHandler,
    ModalManager,
    openConfirmationModal,
  });
  reviewsModule = module;
  return module;
}

async function getUniversesModule() {
  if (universesModule) return universesModule;
  const module = await import("./features/universes.js?v=8");
  module.initUniverses({
    appState,
    switchView,
    db,
    auth,
    openDetailsModal,
    openSeriesDetailView,
  });
  universesModule = module;
  return module;
}

// ===========================================================
// 1. ESTADO GLOBAL Y CONFIGURACIÓN
// ===========================================================
const appState = {
  content: {
    movies: {},
    series: {},
    sagas: {},
    sagasList: [],
    seriesEpisodes: {},
    seasonPosters: {},
    seasonOrder: {},
    metadata: { movies: {}, series: {} },
    averages: {},
  },
  ui: {
    heroMovieIds: [],
    contentToDisplay: [],
    currentIndex: 0,
    heroInterval: null,
    activeSagaId: null,
  },
  user: {
    watchlist: new Map(),
    historyListenerRef: null,
  },
  player: {
    state: {},
    activeSeriesId: null,
    pendingHistorySave: null,
    episodeOpenTimer: null,
    historyUpdateDebounceTimer: null,
    activeCineInstance: null, // 🔥 NUEVO: Referencia a la instancia de ArtPlayer
  },
  flags: {
    isLoadingMore: false,
    pendingUpdate: false,
  },
  hero: {
    preloadedImages: new Map(),
    currentIndex: 0,
    isTransitioning: false,
  },
};

window.appState = appState; // Exponer a módulos

const DOM = {
  preloader: document.getElementById("preloader"),
  pageWrapper: document.querySelector(".page-wrapper"),
  header: document.querySelector(".main-header"),
  heroSection: document.getElementById("hero-section"),
  carouselContainer: document.getElementById("carousel-container"),
  gridContainer: document.getElementById("full-grid-container"),
  myListContainer: document.getElementById("my-list-container"),
  historyContainer: document.getElementById("history-container"),

  // --- SECCIÓN RESEÑAS ---
  reviewsContainer: document.getElementById("reviews-container"),
  reviewsGrid: document.getElementById("reviews-grid"),
  reviewModal: document.getElementById("review-form-modal"),
  reviewForm: document.getElementById("review-submission-form"),
  openReviewBtn: document.getElementById("open-review-modal-btn"),

  rouletteModal: document.getElementById("roulette-modal"),
  seriesPlayerModal: document.getElementById("series-player-page"),
  authDropdown: document.getElementById("auth-dropdown"),
  confirmationModal: document.getElementById("confirmation-modal"),
  searchInput: document.getElementById("search-input"),
  filterControls: document.getElementById("filter-controls"),

  // --- FILTROS ---
  genreFilter: document.getElementById("genre-filter"),
  langFilter: document.getElementById("lang-filter"),
  sortBy: document.getElementById("sort-by"),
  ucmSortButtonsContainer: document.getElementById("ucm-sort-buttons"),
  ucmSortButtons: document.querySelectorAll(".sort-btn"),

  // --- AUTH ---
  guestAvatarBtn: document.getElementById("guest-avatar-btn"),
  loginForm: document.getElementById("login-form"),
  registerForm: document.getElementById("register-form"),
  switchAuthModeLink: document.getElementById("switch-auth-mode"),
  loginError: document.getElementById("login-error"),
  registerError: document.getElementById("register-error"),
  registerUsernameInput: document.getElementById("register-username"),
  registerEmailInput: document.getElementById("register-email"),
  registerPasswordInput: document.getElementById("register-password"),
  loginEmailInput: document.getElementById("login-email"),
  loginPasswordInput: document.getElementById("login-password"),

  // --- PERFIL ---
  userProfileContainer: document.getElementById("user-profile-container"),
  userGreetingBtn: document.getElementById("user-greeting"),
  userMenuDropdown: document.getElementById("user-menu-dropdown"),
  myListNavLink: document.getElementById("my-list-nav-link"),
  historyNavLink: document.getElementById("history-nav-link"),
  profileUsername: document.getElementById("profile-username"),
  profileEmail: document.getElementById("profile-email"),

  confirmDeleteBtn: document.getElementById("confirm-delete-btn"),
  cancelDeleteBtn: document.getElementById("cancel-delete-btn"),

  // --- MÓVIL ---
  hamburgerBtn: document.getElementById("menu-toggle"),
  mobileNavPanel: document.getElementById("mobile-nav-panel"),
  closeNavBtn: document.querySelector(".close-nav-btn"),
  menuOverlay: document.getElementById("menu-overlay"),
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();
initLogger(db, auth);

// ===========================================================
// 2. INICIO Y CARGA DE DATOS (🆕 MEJORADO CON CACHÉ)
// ===========================================================
document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has("force_update")) {
    const preloader = document.getElementById("preloader");
    if (preloader) {
      preloader.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
                    <div class="spinner" style="margin-bottom: 20px;"></div>
                    <h2 class="loading-text" style="font-size: 2rem; color: var(--text-light); margin: 0;">REFRESCANDO CONTENIDO</h2>
                    <p style="color: var(--text-muted); margin-top: 10px; font-size: 1.1rem;">Aplicando la última versión...</p>
                </div>
            `;
    }
    const newUrl = window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);
  }

  cacheManager = new CacheManager();
  lazyLoader = new LazyImageLoader();
  injectLazyLoadingStyles();

  modalManager = ModalManager;
  contentManager = ContentManager;

  // Parchear ModalManager.closeAll para destruir instancias de Artplayer y timers
  const _originalCloseAll = ModalManager.closeAll.bind(ModalManager);
  ModalManager.closeAll = () => {
    if (appState?.player?.movieHistoryTimer) {
      clearTimeout(appState.player.movieHistoryTimer);
      appState.player.movieHistoryTimer = null;
    }
    // 🔥 NUEVO: Destruir el reproductor si está activo
    if (appState?.player?.activeCineInstance) {
      appState.player.activeCineInstance.destroy();
      appState.player.activeCineInstance = null;
    }
    // Cerrar el auth dropdown si estaba abierto
    const authDd = document.getElementById("auth-dropdown");
    if (authDd) authDd.classList.remove("open");
    _originalCloseAll();
  };

  updateThemeAssets();
  setupPresence();
  trackVisit();
  fetchInitialDataWithCache();
  checkResetPasswordMode();

  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
  document.addEventListener("mozfullscreenchange", handleFullscreenChange);
  document.addEventListener("msfullscreenchange", handleFullscreenChange);
});

function preloadImage(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve();
      return;
    }
    const img = new Image();
    img.src = url;
    img.onload = () => resolve();
    img.onerror = () => resolve();
  });
}

// ===========================================================
// PRESENCIA EN TIEMPO REAL
// Registra la sesión del usuario en Firebase al conectarse.
// Firebase borra el nodo automáticamente con onDisconnect()
// cuando el usuario cierra el tab, pierde internet, etc.
// El nodo /presence/{randomId} solo guarda connectedAt —
// sin nombre, sin email, sin datos personales.
// ===========================================================
function setupPresence() {
  if (typeof db === "undefined") return;

  const connectedRef = db.ref(".info/connected");
  const presenceRef  = db.ref("presence").push();

  connectedRef.on("value", (snap) => {
    if (!snap.val()) return;
    presenceRef.onDisconnect().remove();
    presenceRef.set({ connectedAt: Date.now() });
  });
}

// ===========================================================
// ANALYTICS DE VISITAS — una entrada por usuario por día
// Usa el uid si está logueado, o un ID anónimo persistido en
// localStorage si no lo está. La clave del nodo es
// {visitorId}_{fecha}, así que entrar y salir 10 veces en el
// mismo día cuenta como una sola visita.
// ===========================================================
function getAnonymousId() {
  let id = localStorage.getItem("_cine_anon_id");
  if (!id) {
    id = "anon_" + Math.random().toString(36).slice(2, 11);
    localStorage.setItem("_cine_anon_id", id);
  }
  return id;
}

function trackVisit() {
  if (typeof db === "undefined") return;

  const now       = new Date();
  const date      = now.toISOString().slice(0, 10);       // "2025-01-27"
  const month     = now.toISOString().slice(0, 7);        // "2025-01"
  const hour      = now.getHours();
  const visitorId = auth?.currentUser?.uid || getAnonymousId();
  const visitKey  = `${visitorId}_${date}`.replace(/[.#$/[\]]/g, "_");

  const ref = db.ref(`analytics_visits/${visitKey}`);
  ref.once("value", (snap) => {
    if (!snap.exists()) {
      ref.set({ date, month, hour, ts: Date.now() });
    }
  });
}


// En lugar de borrar todo el localStorage ante cualquier
// cambio del admin, descarga los datos frescos, compara
// clave a clave con el caché actual y solo sobreescribe
// las secciones que realmente cambiaron.
// ===========================================================

/**
 * Compara dos objetos de contenido clave a clave.
 * Devuelve un array con los nombres de las secciones que cambiaron.
 * Usa JSON.stringify para la comparación; es suficientemente rápido
 * porque este diff se hace una sola vez en background, no en cada render.
 */
function detectChanges(oldData, newData) {
  const allKeys = new Set([
    ...Object.keys(oldData || {}),
    ...Object.keys(newData || {}),
  ]);
  const changed = [];
  for (const key of allKeys) {
    // Comparación rápida: si el tamaño del JSON cambia, ya difieren
    const oldStr = JSON.stringify(oldData?.[key] ?? null);
    const newStr = JSON.stringify(newData?.[key] ?? null);
    if (oldStr !== newStr) changed.push(key);
  }
  return changed;
}

/**
 * Descarga los datos frescos desde la API, los compara con el caché
 * actual y solo actualiza las secciones que cambiaron.
 * Si no hay cambios, no toca nada (ni el caché ni la UI).
 * Si hay cambios, parchea appState y re-renderiza suavemente sin
 * recargar la página.
 *
 * @returns {{ changed: boolean, sections: string[] }}
 */
// ── Helper: restaurar "Continuar Viendo" tras regenerar carruseles ──────────
// generateCarousels() hace innerHTML="" en el carousel-container, borrando
// el carrusel de historial. Esta función lo regenera si el usuario está logueado.
function restoreContinueWatchingCarousel() {
  const user = auth.currentUser;
  if (!user) return;
  db.ref(`users/${user.uid}/history`)
    .orderByChild("viewedAt")
    .once("value")
    .then((snap) => {
      if (snap.exists()) generateContinueWatchingCarousel(snap);
    });
}

async function smartRefreshAndPatch() {
  try {
    // 1. Descargar datos frescos en paralelo
    const [series, episodes, allMovies, posters, sagasListData] =
      await Promise.all([
        ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=series`),
        ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=episodes`),
        ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=allMovies&order=desc`),
        ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=PostersTemporadas`),
        ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=sagas_list`),
      ]);

    const sagasArray = Object.values(sagasListData || {});
    const sagasResults = await Promise.all(
      sagasArray.map((saga) =>
        ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=${saga.id}`).then(
          (data) => ({ id: saga.id, data }),
        ),
      ),
    );

    const freshContent = {
      allMovies,
      series,
      episodes,
      posters,
      sagas_list: sagasListData,
    };
    sagasResults.forEach(({ id, data }) => {
      freshContent[id] = data;
    });

    // 2. Comparar con el caché actual
    const cachedContent = cacheManager.get(cacheManager.keys.content);

    if (!cachedContent) {
      // Sin caché previa: guardar directamente y parchear appState
      cacheManager.set(cacheManager.keys.content, freshContent);
      if (window.processDataPublic) window.processDataPublic(freshContent);
      console.log("✓ Caché inicial guardada por smartRefreshAndPatch.");
      return { changed: true, sections: Object.keys(freshContent) };
    }

    const changedSections = detectChanges(cachedContent, freshContent);

    if (changedSections.length === 0) {
      console.log("✓ Sin cambios detectados — caché vigente, sin tocar nada.");
      return { changed: false, sections: [] };
    }

    // 3. Solo actualizar las secciones que cambiaron
    const patchedCache = { ...cachedContent };
    changedSections.forEach((key) => {
      patchedCache[key] = freshContent[key];
    });

    cacheManager.set(cacheManager.keys.content, patchedCache);
    console.log(`✓ Caché actualizada parcialmente. Secciones: [${changedSections.join(", ")}]`);

    // 4. Parchear appState y re-renderizar sin recargar la página
    if (window.processDataPublic) window.processDataPublic(patchedCache);

    const activeNav = document.querySelector(
      ".main-nav a.active, .mobile-nav a.active, .bottom-nav a.active",
    );
    const currentFilter = activeNav?.dataset.filter || "all";
    generateCarousels();
    restoreContinueWatchingCarousel();

    if (["movie", "series"].includes(currentFilter) ||
        appState.content.sagas[currentFilter]) {
      applyAndDisplayFilters(currentFilter);
    }

    if (window.showNotification) {
      window.showNotification("Contenido actualizado", "success");
    }

    return { changed: true, sections: changedSections };
  } catch (err) {
    console.warn("⚠ smartRefreshAndPatch falló, sin tocar el caché:", err);
    return { changed: false, sections: [] };
  }
}

async function fetchInitialDataWithCache() {
  const startLoadTime = Date.now();

  if (typeof db !== "undefined") {
    const updatesRef = db.ref("system_metadata/last_update");
    updatesRef.on("value", (snapshot) => {
      const serverLastUpdate = Number(snapshot.val());
      const localRaw = localStorage.getItem("local_last_update");
      const localLastUpdate = localRaw ? Number(localRaw) : 0;

      if (serverLastUpdate > localLastUpdate) {
        // Actualizar el timestamp local de inmediato para no volver a
        // disparar este bloque si el listener se re-ejecuta antes de
        // que termine el patch.
        localStorage.setItem("local_last_update", serverLastUpdate);

        // Tanto si el usuario está viendo algo como si no, hacemos el
        // diff en background y solo actualizamos lo que cambió.
        // Ya no hay recarga de página ni borrado de caché completo.
        smartRefreshAndPatch().then((result) => {
          if (result.changed) {
            console.log(
              `✓ Actualización silenciosa aplicada. Secciones: [${result.sections.join(", ")}]`,
            );
          }
        });
      } else if (serverLastUpdate && localLastUpdate === 0) {
        localStorage.setItem("local_last_update", serverLastUpdate);
      }
    });
  }

  const processData = (data) => {
    window.processDataPublic = processData;
    // Si Sheets devuelve un error de cuota, abortar silenciosamente
    if (!data || typeof data === "string") {
      console.warn("[processData] Datos inválidos recibidos (posible error de cuota de Sheets):", data);
      return;
    }

    // ── 1. TRADUCTOR UNIVERSAL (Arregla las mayúsculas de la API) ──
    const normalizeItem = (item) => {
      if (!item || typeof item !== "object") return;

      // Textos y tipo
      item.title =
        item.title || item.titulo || item.Titulo || item.Título || "";
      item.type = item.type || item.Tipo || item.tipo || "movie";
      item.year = item.year || item.Año || item.año || item.Year || "";

      // Imágenes (¡CRÍTICO para que no queden invisibles!)
      item.poster = item.poster || item.Poster || item.imagen || "";
      item.banner = item.banner || item.Banner || item.fondo || "";

      // Metadatos adicionales
      item.genres =
        item.genres || item.Generos || item.Géneros || item.generos || "";
      item.language =
        item.language || item.Idioma || item.idioma || item.audio || "";
      item.estado = item.estado || item.Estado || "";
      item.tr = item.tr || item.TR || 0;
      item.admin = (item.admin || item.Admin || "").toString().toLowerCase().trim();

      // Fases y Sagas
      item.fase = item.fase || item.Fase || "";
      item.saga = item.saga || item.Saga || "";

      // Cronología
      let crono =
        item.Cronología ||
        item.cronología ||
        item.Cronologia ||
        item.cronologia ||
        item.cronologiaMulti;
      item.cronologia = crono === null || crono === "" ? null : String(crono);
    };

    // Aplicamos el traductor al catálogo base
    if (data.allMovies) Object.values(data.allMovies).forEach(normalizeItem);
    if (data.series) Object.values(data.series).forEach(normalizeItem);

    appState.content.movies = data.allMovies || {};
    appState.content.series = data.series || {};
    appState.content.seriesEpisodes = data.episodes || {};
    appState.content.seasonPosters = data.posters || {};

    appState.content.seasonOrder = {};

    function smartSeasonSort(keys, postersData) {
      if (postersData) {
        const withOrder = keys.filter(
          (k) =>
            postersData[k]?.orden !== undefined && postersData[k]?.orden !== "",
        );
        if (withOrder.length > 0) {
          return keys.slice().sort((a, b) => {
            const oA =
              postersData[a]?.orden !== undefined &&
              postersData[a]?.orden !== ""
                ? Number(postersData[a].orden)
                : 999;
            const oB =
              postersData[b]?.orden !== undefined &&
              postersData[b]?.orden !== ""
                ? Number(postersData[b].orden)
                : 999;
            return oA - oB;
          });
        }
      }
      const nonNumeric = keys.filter((k) => isNaN(k));
      const numeric = keys
        .filter((k) => !isNaN(k))
        .sort((a, b) => Number(a) - Number(b));
      return [...nonNumeric, ...numeric];
    }

    for (const seriesId in data.episodes) {
      const seasons = data.episodes[seriesId];
      const postersData = data.posters?.[seriesId];
      appState.content.seasonOrder[seriesId] = smartSeasonSort(
        Object.keys(seasons),
        postersData,
      );

      // Ordenar episodios de cada temporada por episodeNumber para que
      // el índice del array coincida siempre con el orden visual.
      // Esto evita el bug donde "Continuar Viendo" abre el episodio equivocado
      // porque populateEpisodeList ordena visualmente pero openEpisode
      // accede por índice del array crudo.
      for (const seasonKey in seasons) {
        const eps = seasons[seasonKey];
        if (Array.isArray(eps) && eps.length > 1) {
          eps.sort((a, b) => {
            const nA = a.episodeNumber ?? a.episode_number ?? Infinity;
            const nB = b.episodeNumber ?? b.episode_number ?? Infinity;
            return nA - nB;
          });
        }
      }
    }

    for (const seriesId in data.posters) {
      const posterSeasons = Object.keys(data.posters[seriesId]);
      const postersData = data.posters[seriesId];
      if (appState.content.seasonOrder[seriesId]) {
        posterSeasons.forEach((key) => {
          if (!appState.content.seasonOrder[seriesId].includes(key)) {
            appState.content.seasonOrder[seriesId].push(key);
          }
        });
        appState.content.seasonOrder[seriesId] = smartSeasonSort(
          appState.content.seasonOrder[seriesId],
          postersData,
        );
      } else {
        appState.content.seasonOrder[seriesId] = smartSeasonSort(
          posterSeasons,
          postersData,
        );
      }
    }

    appState.content.sagasList = Object.values(data.sagas_list || {});

    if (appState.content.sagasList.length > 0) {
      appState.content.sagasList.forEach((saga) => {
        if (data[saga.id]) {
          // ── 2. APLICAR TRADUCTOR A LAS PELÍCULAS DEL UNIVERSO ──
          Object.values(data[saga.id]).forEach(normalizeItem);

          appState.content.sagas[saga.id] = data[saga.id];
        }
      });
    }
  };

  const setupAndShow = async (movieMeta, seriesMeta) => {
    appState.content.metadata.movies = movieMeta || {};
    appState.content.metadata.series = seriesMeta || {};

    setupHero();
    generateCarousels();
    restoreContinueWatchingCarousel();
    setupEventListeners();
    setupNavigation();
    setupAuthListeners();
    setupSearch();
    setupPageVisibilityHandler();

    const activeFilter =
      document.querySelector(".main-nav a.active, .mobile-nav a.active")
        ?.dataset.filter || "all";
    const isSaga = appState.content.sagas[activeFilter];

    if (["movie", "series"].includes(activeFilter) || isSaga) {
      applyAndDisplayFilters(activeFilter);
    } else if (activeFilter === "sagas") {
      switchView("sagas");
    }

    const timeElapsed = Date.now() - startLoadTime;
    const remainingTime = Math.max(0, 800 - timeElapsed);
    await new Promise((r) => setTimeout(r, remainingTime));

    requestAnimationFrame(() => {
      if (DOM.pageWrapper) DOM.pageWrapper.style.display = "block";
      setTimeout(() => {
        if (DOM.pageWrapper) DOM.pageWrapper.classList.add("visible");
        if (DOM.preloader) DOM.preloader.classList.add("fade-out");
      }, 50);
      setTimeout(() => {
        if (DOM.preloader) DOM.preloader.remove();
      }, 800);
    });
  };

  const cachedContent = cacheManager.get(cacheManager.keys.content);
  const cachedMetadata = cacheManager.get(cacheManager.keys.metadata);

  if (cachedContent) {
    console.log("✓ Iniciando desde caché...");
    processData(cachedContent);
    await getReviewsModule();
    await setupAndShow(cachedMetadata?.movies, cachedMetadata?.series);
    refreshDataInBackground();

    const user = auth.currentUser;
    if (user) {
      db.ref(`users/${user.uid}/history`)
        .orderByChild("viewedAt")
        .once("value", (snapshot) => {
          if (snapshot.exists()) generateContinueWatchingCarousel(snapshot);
        });
    }
  } else {
    try {
      console.log("⟳ Descargando base de datos completa...");
      const [
        series,
        episodes,
        allMovies,
        posters,
        sagasListData,
        movieMeta,
        seriesMeta,
      ] = await Promise.all([
        ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=series`),
        ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=episodes`),
        ErrorHandler.fetchOperation(
          `${API_URL.BASE_URL}?data=allMovies&order=desc`,
        ),
        ErrorHandler.fetchOperation(
          `${API_URL.BASE_URL}?data=PostersTemporadas`,
        ),
        ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=sagas_list`),
        db
          .ref("movie_metadata")
          .once("value")
          .then((s) => s.val() || {}),
        db
          .ref("series_metadata")
          .once("value")
          .then((s) => s.val() || {}),
      ]);

      const sagasArray = Object.values(sagasListData || {});
      const sagasRequests = sagasArray.map((saga) =>
        ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=${saga.id}`).then(
          (data) => ({ id: saga.id, data: data }),
        ),
      );

      const sagasResults = await Promise.all(sagasRequests);

      const freshContent = {
        allMovies,
        series,
        episodes,
        posters,
        sagas_list: sagasListData,
      };

      sagasResults.forEach((item) => {
        freshContent[item.id] = item.data;
      });

      const freshMetadata = { movies: movieMeta, series: seriesMeta };

      processData(freshContent);
      cacheManager.set(cacheManager.keys.content, freshContent);
      cacheManager.set(cacheManager.keys.metadata, freshMetadata);

      await getReviewsModule();

      if (!localStorage.getItem("local_last_update")) {
        localStorage.setItem("local_last_update", Date.now());
      }

      await setupAndShow(freshMetadata.movies, freshMetadata.series);

      const user = auth.currentUser;
      if (user) {
        db.ref(`users/${user.uid}/history`)
          .orderByChild("viewedAt")
          .once("value", (snapshot) => {
            if (snapshot.exists()) generateContinueWatchingCarousel(snapshot);
          });
      }
    } catch (error) {
      console.error("✗ Error crítico en carga inicial:", error);
      if (DOM.preloader)
        DOM.preloader.innerHTML = `
                <div style="text-align: center; color: white;">
                    <p>Error de conexión</p>
                    <button onclick="location.reload()" class="btn-primary" style="margin-top:10px;">Reintentar</button>
                </div>`;
    }
  }
}

// refreshDataInBackground ahora es un alias de smartRefreshAndPatch.
// Antes sobreescribía el caché entero sin comparar; ahora solo toca
// las secciones que realmente cambiaron.
async function refreshDataInBackground() {
  await smartRefreshAndPatch();
}

// ===========================================================
// TIEMPO REAL — listeners directos sobre los nodos de Firebase
// que el panel de admin modifica al agregar/editar contenido.
// Cuando cualquiera de estos nodos cambia, se dispara un diff
// automático sin necesidad de tocar "ACTUALIZAR TODO".
// Se usa un debounce de 2s para agrupar cambios en ráfaga
// (por ejemplo, cuando el admin guarda varios campos seguidos).
// ===========================================================
(function setupRealtimeContentListeners() {
  if (typeof db === "undefined") return;

  let _realtimeDebounceTimer = null;

  function _onContentChanged(nodeName) {
    clearTimeout(_realtimeDebounceTimer);
    _realtimeDebounceTimer = setTimeout(async () => {
      console.log(`🔴 Cambio en Firebase (${nodeName}) → aplicando diff...`);
      await smartRefreshAndPatch();
    }, 2000);
  }

  // Escuchar solo el primer nivel de cada nodo para detectar
  // altas/bajas/modificaciones sin descargar el árbol completo.
  // Firebase dispara "value" al conectarse y cada vez que hay cambios.
  // Usamos una flag para ignorar el disparo inicial (ya tenemos el
  // caché cargado desde fetchInitialDataWithCache).
  const watchedNodes = [
    "system_metadata/last_update", // disparo manual del admin
    "movie_metadata",              // metadata de películas
    "series_metadata",             // metadata de series
  ];

  watchedNodes.forEach((nodePath) => {
    let isFirstCall = true;
    db.ref(nodePath).on("value", () => {
      if (isFirstCall) { isFirstCall = false; return; } // ignorar disparo inicial
      _onContentChanged(nodePath);
    });
  });
})();

// ===========================================================
// 3. NAVEGACIÓN Y MANEJO DE VISTAS
// ===========================================================
function setupNavigation() {
  const navContainers = document.querySelectorAll(
    ".main-nav ul, .mobile-nav ul, .bottom-nav, #profile-hub-container, .header-right, #navDropdown",
  );

  navContainers.forEach((container) => {
    if (container) {
      container.addEventListener("click", handleFilterClick);
    }
  });

  const openMenu = () => {
    if (DOM.mobileNavPanel) DOM.mobileNavPanel.classList.add("is-open");
    if (DOM.menuOverlay) DOM.menuOverlay.classList.add("active");
  };
  const closeMenu = () => {
    if (DOM.mobileNavPanel) DOM.mobileNavPanel.classList.remove("is-open");
    if (DOM.menuOverlay) DOM.menuOverlay.classList.remove("active");
  };

  if (DOM.hamburgerBtn) DOM.hamburgerBtn.addEventListener("click", openMenu);
  if (DOM.closeNavBtn) DOM.closeNavBtn.addEventListener("click", closeMenu);
  if (DOM.menuOverlay) DOM.menuOverlay.addEventListener("click", closeMenu);
}

async function handleFilterClick(event) {
  const link = event.target.closest("a");
  if (!link || !link.dataset.filter) return;

  event.preventDefault();

  if (DOM.mobileNavPanel) DOM.mobileNavPanel.classList.remove("is-open");
  if (DOM.menuOverlay) DOM.menuOverlay.classList.remove("active");
  if (DOM.userMenuDropdown) DOM.userMenuDropdown.classList.remove("show");
  const navDd = document.getElementById("navDropdown");
  if (navDd) navDd.classList.remove("open");

  const filter = link.dataset.filter;

  if (filter === "roulette") {
    const roulette = await getRouletteModule();
    roulette.openRouletteModal();
    return;
  }

  if (
    link.classList.contains("active") &&
    !["history", "my-list", "profile", "profile-hub", "settings"].includes(
      filter,
    )
  )
    return;

  document
    .querySelectorAll("a[data-filter]")
    .forEach((l) => l.classList.remove("active"));
  document
    .querySelectorAll(`a[data-filter="${filter}"]`)
    .forEach((l) => l.classList.add("active"));

  if (DOM.searchInput) DOM.searchInput.value = "";
  switchView(filter);
}

function updateActiveNav(filter) {
  if (filter === "roulette") return;

  document.querySelectorAll("a[data-filter]").forEach((link) => {
    link.classList.remove("active");
  });

  if (filter) {
    const selector = `a[data-filter="${filter}"]`;
    document
      .querySelectorAll(selector)
      .forEach((link) => link.classList.add("active"));
  }

  // Sincronizar bottom tab bar móvil (usa data-tab en vez de data-filter)
  document.querySelectorAll(".mobile-tab-item").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === filter);
  });
}

async function switchView(filter) {
  if (filter === "roulette") {
    const roulette = await getRouletteModule();
    roulette.openRouletteModal();
    return;
  }

  appState.currentFilter = filter;


  updateActiveNav(filter);

  const containers = [
    document.getElementById("hero-section"),
    document.getElementById("carousel-container"),
    document.getElementById("full-grid-container"),
    document.getElementById("my-list-container"),
    document.getElementById("history-container"),
    document.getElementById("profile-container"),
    document.getElementById("settings-container"),
    document.getElementById("profile-hub-container"),
    document.getElementById("sagas-hub-container"),
    document.getElementById("reviews-container"),
    document.getElementById("live-tv-section"),
    document.getElementById("iptv-section"),
    document.getElementById("series-player-page"),
    document.getElementById("detail-view"), // ← cerrar vista de detalle al navegar
    document.getElementById("sp-detail-view"),
  ];

  containers.forEach((el) => {
    if (el) { el.style.display = "none"; el.classList.remove("prf-visible"); }
  });

  // Si el detail-view estaba activo, limpiar su estado
  const detailView = document.getElementById("detail-view");
  if (detailView && detailView.classList.contains("visible")) {
    detailView.classList.remove("visible");
    if (appState?.player?.activeCineInstance) {
      appState.player.activeCineInstance.destroy();
      appState.player.activeCineInstance = null;
    }
    const videoContainer = document.getElementById("dv-video-container");
    if (videoContainer) videoContainer.innerHTML = "";
    const mainEl = document.querySelector("main");
    if (mainEl) mainEl.style.display = "";
  }

  // Si sp-detail-view estaba activo, guardar historial y cerrarlo sin redirigir
  const spDetailView = document.getElementById("sp-detail-view");
  if (spDetailView && spDetailView.classList.contains("visible")) {
    if (appState?.player?.pendingHistorySave) {
      const { contentId, type, episodeInfo } =
        appState.player.pendingHistorySave;
      addToHistoryIfLoggedIn(contentId, type, episodeInfo);
      appState.player.pendingHistorySave = null;
      // ✅ FIX: Regenerar carrusel "Continuar Viendo" después de guardar historial
      const user = auth.currentUser;
      if (user) {
        db.ref(`users/${user.uid}/history`)
          .orderByChild("viewedAt")
          .once("value", (snapshot) => {
            const existing = document.getElementById(
              "continue-watching-carousel",
            );
            if (existing) existing.remove();
            if (snapshot.exists()) generateContinueWatchingCarousel(snapshot);
          });
      }
    }
    spDetailView.classList.remove("visible", "sp-detail-view--playing");
    if (appState?.player?.activeCineInstance) {
      appState.player.activeCineInstance.destroy();
      appState.player.activeCineInstance = null;
    }
    const spVideo = document.getElementById("sp-video-container");
    if (spVideo) spVideo.innerHTML = "";
    const mainEl2 = document.querySelector("main");
    if (mainEl2) mainEl2.style.display = "";
  }

  const filterControls = document.getElementById("filter-controls");
  if (filterControls) filterControls.style.display = "none";
  document.body.classList.remove("has-saga-bg");
  document.body.style.removeProperty("--saga-banner");

  const ucmButtons = document.getElementById("ucm-sort-buttons");
  if (ucmButtons) ucmButtons.style.display = "none";

  const backSagaBtn = document.getElementById("back-to-sagas-btn");
  if (backSagaBtn) backSagaBtn.style.display = "none";

  const liveVideo = document.getElementById("embedded-live-video");
  if (liveVideo) {
    liveVideo.pause();
    liveVideo.removeAttribute("src");
    liveVideo.load();
  }
  if (window.hlsLiveInstance) {
    window.hlsLiveInstance.destroy();
    window.hlsLiveInstance = null;
  }

  if (filter === "all") {
    if (DOM.heroSection) DOM.heroSection.style.display = "flex";
    if (DOM.carouselContainer) DOM.carouselContainer.style.display = "block";
    return;
  }

  if (filter === "sagas") {
    const hub = document.getElementById("sagas-hub-container");
    if (hub) {
      hub.style.display = "block";
      getUniversesModule().then((m) => {
        m.renderUniversesHub();
        // Si venía desde un universo, restaurarlo
        const fromSagaId = appState.ui._fromUniverse;
        if (fromSagaId) {
          appState.ui._fromUniverse = null;
          setTimeout(() => m.restoreUniverseOverlay(fromSagaId), 50);
        }
      });
    }
    return;
  }

  // ── NUEVO: película o serie individual (desde Universos) ──
  if (appState.content.movies?.[filter]) {
    openDetailsModal(filter, "movie");
    return;
  }
  if (appState.content.series?.[filter]) {
    openSeriesDetailView(filter);
    return;
  }

  const isDynamicSaga =
    appState.content.sagas && appState.content.sagas[filter];

  if (filter === "movie" || filter === "series" || isDynamicSaga) {
    if (DOM.gridContainer) DOM.gridContainer.style.display = "block";
    if (filterControls) filterControls.style.display = "flex";

    if (isDynamicSaga) {
      const sagaConfig = appState.content.sagasList.find(
        (s) => s.id === filter,
      );
      if (sagaConfig?.banner) {
        document.body.style.setProperty(
          "--saga-banner",
          `url(${sagaConfig.banner})`,
        );
        document.body.classList.add("has-saga-bg");
      }
    }

    const backBtn = document.getElementById("back-to-sagas-btn");
    if (backBtn) {
      backBtn.style.display = isDynamicSaga ? "flex" : "none";
      backBtn.onclick = () => switchView("sagas");
    }

    appState.ui.activeSagaId = isDynamicSaga ? filter : null;

    // Marcar el body para CSS del drawer de géneros
    document.body.classList.toggle("active-saga-view", !!isDynamicSaga);

    // Sincronizar botón trigger del genre drawer en mobile
    setTimeout(() => {
      if (window.syncGenreDrawerTrigger) window.syncGenreDrawerTrigger();
    }, 120);

    // ── Catalog header: activar modo y título según tipo ──
    if (DOM.gridContainer) {
      DOM.gridContainer.classList.remove(
        "catalog-mode-movie",
        "catalog-mode-series",
      );
      if (filter === "movie")
        DOM.gridContainer.classList.add("catalog-mode-movie");
      else if (filter === "series")
        DOM.gridContainer.classList.add("catalog-mode-series");
    }

    if (DOM.sortBy) DOM.sortBy.value = "recent";
    const sortText = document.getElementById("sort-text");
    if (sortText) sortText.textContent = "Recientes";
    const requestFilterEl = document.getElementById("request-filter");
    const requestTextEl = document.getElementById("request-text");
    if (requestFilterEl) requestFilterEl.value = "all";
    if (requestTextEl) requestTextEl.textContent = "Pedidos";

    // Ocultar filtro de "Pedidos" en vistas de saga — no aplica en ese contexto
    const requestVisualEl = document.getElementById("request-dropdown-visual");
    if (requestVisualEl)
      requestVisualEl.style.display = isDynamicSaga ? "none" : "";

    // ── Limpiar indicador visual de filtros activos ──
    document
      .querySelectorAll("#filter-controls .custom-dropdown")
      .forEach((el) => {
        el.classList.remove("has-active-filter");
      });
    populateFilters(filter);
    applyAndDisplayFilters(filter);
    return;
  }

  if (filter === "my-list") {
    if (document.getElementById("my-list-container")) {
      document.getElementById("my-list-container").style.display = "block";
      displayMyListView();
    }
    return;
  }

  if (filter === "history") {
    if (document.getElementById("history-container")) {
      document.getElementById("history-container").style.display = "block";
      renderHistory();
    }
    return;
  }

  if (filter === "reviews") {
    const reviewsContainer = document.getElementById("reviews-container");
    if (reviewsContainer) {
      reviewsContainer.style.display = "block";
      reviewsContainer.style.marginTop = "0";
    }
    // Cargar módulo siempre (inicializa el composer inline + renderiza el grid)
    getReviewsModule().then((mod) => {
      if (mod && mod.renderReviewsGrid) mod.renderReviewsGrid();
    });
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }

  if (
    filter === "profile-hub" ||
    filter === "profile" ||
    filter === "settings"
  ) {
    const containerMap = {
      "profile-hub": "profile-hub-container",
      profile: "profile-container",
      settings: "settings-container",
    };
    const container = document.getElementById(containerMap[filter]);
    if (container) {
      if (filter === "profile") {
        // Remove inline display so @media CSS controls grid vs block
        container.style.removeProperty("display");
        container.classList.add("prf-visible");
      } else {
        container.style.display = "block";
      }
      if (filter === "profile")
        getProfileModule().then((m) => m.renderProfile());
      if (filter === "settings")
        getProfileModule().then((m) => {
          m.renderSettings();
          // Inyectar contador de usuarios online en el panel de admin
          // después de que renderSettings() pueble el DOM.
          setTimeout(injectOnlineCounter, 300);
        });
    }
    return;
  }

  if (filter === "search") {
    if (DOM.gridContainer) DOM.gridContainer.style.display = "block";

    const idsToHide = [
      "filter-controls",
      "genre-dropdown-visual",
      "lang-dropdown-visual",
      "sort-dropdown-visual",
      "letter-dropdown-visual",
      "request-dropdown-visual",
      "ucm-sort-buttons",
      "back-to-sagas-btn",
      "pagination-controls",
    ];

    idsToHide.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.setProperty("display", "none", "important");
    });

    return;
  }

  window.scrollTo(0, 0);
}

// ==========================================
// FILTROS EN CASCADA
// ==========================================
function refreshDependentFilters(type, activeGenre, activeLang) {
  let sourceData;
  if (type === "movie") sourceData = appState.content.movies;
  else if (type === "series") sourceData = appState.content.series;
  else sourceData = appState.content.sagas?.[type];
  if (!sourceData) return;

  const sagaConfig =
    appState.content.sagasList?.find((s) => s.id === type) || {};
  const confGenres = (sagaConfig.genres_filter || "si").toLowerCase().trim();

  let filtered = Object.entries(sourceData);

  if (confGenres !== "no" && activeGenre && activeGenre !== "all") {
    const gVal = activeGenre.toLowerCase().trim();
    filtered = filtered.filter(([, item]) => {
      if (confGenres === "fases") {
        const fase = String(item.fase || "").trim();
        if (gVal === "saga_infinity") return ["1", "2", "3"].includes(fase);
        if (gVal === "saga_multiverse") return ["4", "5", "6"].includes(fase);
        return fase === gVal;
      }
      const genresStr = String(item.genres || "").toLowerCase();
      const titleStr = String(item.title || "").toLowerCase();
      return genresStr.includes(gVal) || titleStr.includes(gVal);
    });
  }

  let filteredByLang = filtered;
  if (activeLang && activeLang !== "all") {
    const lVal = activeLang.toLowerCase().trim();
    filteredByLang = filtered.filter(([, item]) => {
      const lang = String(
        item.language || item.idioma || item.audio || "",
      ).toLowerCase();
      return lang.includes(lVal);
    });
  }

  const langList = document.getElementById("lang-menu-list");
  const langFilter = DOM.langFilter;
  if (langList && langFilter) {
    langList.innerHTML = "";
    langFilter.innerHTML = '<option value="all">Todos</option>';
    langList.appendChild(_makeFilterItem("all", "Todos", "lang"));

    const langs = new Set();
    filtered.forEach(([, item]) => {
      const raw = item.language || item.idioma || item.audio || "";
      String(raw)
        .split(";")
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((l) => langs.add(l));
    });
    Array.from(langs)
      .sort()
      .forEach((lang) => {
        langList.appendChild(_makeFilterItem(lang, lang, "lang"));
        langFilter.innerHTML += `<option value="${lang}">${lang}</option>`;
      });
  }
}

function _makeFilterItem(value, label, menuType) {
  const div = document.createElement("div");
  div.className = "dropdown-item";
  if (value) div.dataset.value = value;
  div.textContent = label;
  div.onclick = (e) => {
    e.stopPropagation();
    const currentType =
      appState.ui.activeSagaId || appState.currentFilter || "movie";
    if (menuType === "lang") {
      document.getElementById("lang-text").textContent =
        label === "Todos" ? "Idioma" : label.split(" (")[0];
      DOM.langFilter.value = value;
      document.getElementById("lang-dropdown-visual")?.classList.remove("open");
      applyAndDisplayFilters(currentType);
    }
  };
  return div;
}

// ==========================================
// FUNCIÓN: POPULAR FILTROS
// ==========================================
function populateFilters(type) {
  let sourceData;
  if (type === "movie") sourceData = appState.content.movies;
  else if (type === "series") sourceData = appState.content.series;
  else sourceData = appState.content.sagas[type];

  const sagaConfig =
    appState.content.sagasList.find((s) => s.id === type) || {};
  const confGenres = (sagaConfig.genres_filter || "si").toLowerCase().trim();
  const confSortBtn = (sagaConfig.sort_buttons || "no").toLowerCase().trim();
  const confLang = (sagaConfig.lang_filter || "si").toLowerCase().trim();

  const genreVisual = document.getElementById("genre-dropdown-visual");
  const sortVisual = document.getElementById("sort-dropdown-visual");
  const langVisual = document.getElementById("lang-dropdown-visual");
  const letterVisual = document.getElementById("letter-dropdown-visual");

  const genreList = document.getElementById("genre-menu-list");
  const langList = document.getElementById("lang-menu-list");
  const letterList = document.getElementById("letter-menu-list");
  const requestList = document.getElementById("request-menu-list");

  const letterSelect = document.getElementById("letter-filter");
  const requestSelect = document.getElementById("request-filter");
  const requestVisual = document.getElementById("request-dropdown-visual");

  const controlsContainer = document.getElementById("filter-controls");
  if (controlsContainer) controlsContainer.style.display = "flex";

  const createItem = (
    value,
    label,
    menuType,
    isGroup = false,
    imgUrl = null,
  ) => {
    const div = document.createElement("div");
    div.className = isGroup ? "dropdown-group-title" : "dropdown-item";
    if (value) div.dataset.value = value;

    if (isGroup && imgUrl) {
      div.innerHTML = `<img src="${imgUrl}" class="dropdown-group-logo" alt="${label}">`;
      div.classList.add("has-logo");
    } else {
      div.textContent = label;
    }

    if (isGroup && value) div.style.cursor = "pointer";

    div.onclick = (e) => {
      e.stopPropagation();

      if (menuType === "genre") {
        document.getElementById("genre-text").textContent =
          label === "Todos" ? "Géneros" : label.split(" (")[0];
        DOM.genreFilter.value = value;
        if (genreVisual) {
          genreVisual.classList.remove("open");
          genreVisual.classList.toggle("has-active-filter", value !== "all");
        }
      } else if (menuType === "lang") {
        document.getElementById("lang-text").textContent =
          label === "Todos" ? "Idioma" : label.split(" (")[0];
        DOM.langFilter.value = value;
        if (langVisual) {
          langVisual.classList.remove("open");
          langVisual.classList.toggle("has-active-filter", value !== "all");
        }
      } else if (menuType === "request") {
        document.getElementById("request-text").textContent =
          label === "Todos" ? "Pedidos" : label.split(" (")[0];
        if (requestSelect) requestSelect.value = value;
        if (requestVisual) {
          requestVisual.classList.remove("open");
          requestVisual.classList.toggle("has-active-filter", value !== "all");
        }
      } else {
        document.getElementById("sort-text").textContent = label;
        DOM.sortBy.value = value;
        if (sortVisual) sortVisual.classList.remove("open");
      }

      if (menuType !== "sort" && menuType !== "letter") {
        const activeGenre = DOM.genreFilter?.value || "all";
        const activeLang = DOM.langFilter?.value || "all";
        const activeRequest = requestSelect?.value || "all";

        const sub = (g, l, r) => {
          let items = Object.entries(sourceData);
          if (confGenres !== "no" && g !== "all") {
            const gv = g.toLowerCase().trim();
            items = items.filter(([, d]) => {
              if (confGenres === "fases") {
                const f = String(d.fase || "").trim();
                if (gv === "saga_infinity") return ["1", "2", "3"].includes(f);
                if (gv === "saga_multiverse")
                  return ["4", "5", "6"].includes(f);
                return f === gv;
              }
              return (
                String(d.genres || "")
                  .toLowerCase()
                  .includes(gv) ||
                String(d.title || "")
                  .toLowerCase()
                  .includes(gv)
              );
            });
          }
          if (l !== "all") {
            const lv = l.toLowerCase().trim();
            items = items.filter(([, d]) =>
              String(d.language || d.idioma || d.audio || "")
                .toLowerCase()
                .includes(lv),
            );
          }
          if (r !== "all") {
            items = items.filter(([, d]) => (d.pedido || "").trim() === r);
          }
          return items;
        };

        if (confLang === "si" && langList && DOM.langFilter) {
          const langCounts = new Map();
          sub(activeGenre, "all", activeRequest).forEach(([, d]) =>
            String(d.language || d.idioma || d.audio || "")
              .split(";")
              .map((s) => s.trim())
              .filter(Boolean)
              .forEach((l) => {
                langCounts.set(l, (langCounts.get(l) || 0) + 1);
              }),
          );
          langList.innerHTML = "";
          DOM.langFilter.innerHTML = '<option value="all">Todos</option>';
          langList.appendChild(createItem("all", "Todos", "lang"));
          [...langCounts.keys()].sort().forEach((l) => {
            const lbl = `${l} (${langCounts.get(l)})`;
            langList.appendChild(createItem(l, lbl, "lang"));
            DOM.langFilter.innerHTML += `<option value="${l}">${lbl}</option>`;
          });
          if (activeLang !== "all" && !langCounts.has(activeLang)) {
            DOM.langFilter.value = "all";
            document.getElementById("lang-text").textContent = "Idioma";
          } else {
            DOM.langFilter.value = activeLang;
          }
        }

        if (requestList && requestSelect) {
          const requestCounts = new Map();
          sub(activeGenre, activeLang, "all").forEach(([, d]) => {
            const p = d.pedido?.trim();
            if (p) requestCounts.set(p, (requestCounts.get(p) || 0) + 1);
          });
          requestList.innerHTML = "";
          requestSelect.innerHTML = '<option value="all">Todos</option>';
          requestList.appendChild(createItem("all", "Todos", "request"));
          [...requestCounts.keys()].sort().forEach((n) => {
            const lbl = `${n} (${requestCounts.get(n)})`;
            requestList.appendChild(createItem(n, lbl, "request"));
            requestSelect.innerHTML += `<option value="${n}">${lbl}</option>`;
          });
          if (requestVisual)
            requestVisual.style.display =
              requestCounts.size === 0 ? "none" : "block";
          if (activeRequest !== "all" && !requestCounts.has(activeRequest)) {
            requestSelect.value = "all";
            document.getElementById("request-text").textContent = "Pedidos";
          } else {
            requestSelect.value = activeRequest;
          }
        }

        if (
          (type === "movie" || type === "series") &&
          confGenres !== "no" &&
          confGenres !== "fases" &&
          genreList
        ) {
          const genreCounts = new Map();
          sub("all", activeLang, activeRequest).forEach(([, d]) =>
            String(d.genres || "")
              .split(";")
              .map((s) => s.trim())
              .filter(Boolean)
              .forEach((g) => {
                genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
              }),
          );
          genreList.innerHTML = "";
          DOM.genreFilter.innerHTML = '<option value="all">Todos</option>';
          genreList.appendChild(createItem("all", "Todos", "genre"));
          [...genreCounts.keys()].sort().forEach((g) => {
            const lbl = `${g} (${genreCounts.get(g)})`;
            genreList.appendChild(createItem(g, lbl, "genre"));
            DOM.genreFilter.innerHTML += `<option value="${g}">${lbl}</option>`;
          });
          if (activeGenre !== "all" && !genreCounts.has(activeGenre)) {
            DOM.genreFilter.value = "all";
            document.getElementById("genre-text").textContent = "Géneros";
          } else {
            DOM.genreFilter.value = activeGenre;
          }
        }
      }

      applyAndDisplayFilters(type);
    };
    return div;
  };

  if (genreVisual)
    genreVisual.style.display = confGenres !== "no" ? "block" : "none";
  if (langVisual)
    langVisual.style.display = confLang === "si" ? "block" : "none";
  if (letterVisual) letterVisual.style.display = "block";
  if (requestVisual)
    requestVisual.style.display =
      type === "movie" || type === "series" ? "block" : "none";

  const ucmButtons = document.getElementById("ucm-sort-buttons");
  const isDynamicSaga = type !== "movie" && type !== "series";

  if (ucmButtons) {
    ucmButtons.style.display = confSortBtn === "si" ? "flex" : "none";
    if (sortVisual) {
      if (confSortBtn === "si") {
        sortVisual.style.display = "none";
      } else if (isDynamicSaga && confSortBtn === "no") {
        sortVisual.style.display = "none";
      } else {
        sortVisual.style.display = "block";
      }
    }
  } else {
    if (sortVisual) {
      sortVisual.style.display =
        isDynamicSaga && confSortBtn === "no" ? "none" : "block";
    }
  }

  if (confGenres !== "no") {
    genreList.innerHTML = "";
    DOM.genreFilter.innerHTML = `<option value="all">Todos</option>`;

    if (confGenres === "fases") {
      genreList.appendChild(createItem("all", "Todas las Fases", "genre"));
      document.getElementById("genre-text").textContent = "Todas las Fases";

      const estructuraSagas = [
        {
          id: "saga_infinity",
          titulo: "Saga del Infinito",
          img: "https://res.cloudinary.com/djhgmmdjx/image/upload/v1764056286/InfinitySaga2_t3ixis.svg",
          fases: ["1", "2", "3"],
        },
        {
          id: "saga_multiverse",
          titulo: "Saga del Multiverso",
          img: "https://res.cloudinary.com/djhgmmdjx/image/upload/v1764056259/MultiverseSaga2_waggse.svg",
          fases: ["4", "5", "6"],
        },
      ];

      const fasesDisponibles = new Set(
        Object.values(sourceData)
          .map((i) => String(i.fase || "").trim())
          .filter(Boolean),
      );

      estructuraSagas.forEach((saga) => {
        genreList.appendChild(
          createItem(saga.id, saga.titulo, "genre", true, saga.img),
        );
        DOM.genreFilter.innerHTML += `<option value="${saga.id}">${saga.titulo}</option>`;
        saga.fases.forEach((f) => {
          if (fasesDisponibles.has(f)) {
            genreList.appendChild(createItem(f, `Fase ${f}`, "genre"));
            DOM.genreFilter.innerHTML += `<option value="${f}">Fase ${f}</option>`;
          }
        });
      });
    } else if (confGenres === "sagas") {
      genreList.appendChild(createItem("all", "Todas las Sagas", "genre"));
      document.getElementById("genre-text").textContent = "Todas las Sagas";

      genreList.appendChild(
        createItem("Harry Potter", "Harry Potter", "genre"),
      );
      genreList.appendChild(
        createItem("Animales Fantásticos", "Animales Fantásticos", "genre"),
      );
      DOM.genreFilter.innerHTML += `<option value="Harry Potter">Harry Potter</option>`;
      DOM.genreFilter.innerHTML += `<option value="Animales Fantásticos">Animales Fantásticos</option>`;
    } else if (confGenres === "eras") {
      genreList.appendChild(createItem("all", "Todas las Eras", "genre"));
      document.getElementById("genre-text").textContent = "Todas las Eras";

      const eras = [
        { id: "republic", label: "La República" },
        { id: "empire", label: "El Imperio" },
        { id: "rebellion", label: "La Rebelión" },
      ];
      eras.forEach((e) => {
        genreList.appendChild(createItem(e.id, e.label, "genre"));
        DOM.genreFilter.innerHTML += `<option value="${e.id}">${e.label}</option>`;
      });
    } else {
      const genreCounts = new Map();
      Object.values(sourceData).forEach((item) => {
        String(item.genres || "")
          .split(";")
          .map((g) => g.trim())
          .filter(Boolean)
          .forEach((g) => {
            genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
          });
      });
      genreList.appendChild(createItem("all", "Todos", "genre"));
      document.getElementById("genre-text").textContent = "Géneros";

      [...genreCounts.keys()].sort().forEach((g) => {
        const lbl = `${g} (${genreCounts.get(g)})`;
        genreList.appendChild(createItem(g, lbl, "genre"));
        DOM.genreFilter.innerHTML += `<option value="${g}">${lbl}</option>`;
      });
    }
  }

  if (confLang === "si" && langList) {
    langList.innerHTML = "";
    DOM.langFilter.innerHTML = `<option value="all">Todos</option>`;

    langList.appendChild(createItem("all", "Todos", "lang"));
    document.getElementById("lang-text").textContent = "Idioma";

    const langCounts = new Map();
    Object.values(sourceData).forEach((item) => {
      const rawLang = item.language || item.idioma || item.audio || "";
      if (rawLang && String(rawLang).trim() !== "") {
        String(rawLang)
          .split(";")
          .map((l) => l.trim())
          .filter(Boolean)
          .forEach((lang) => {
            langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
          });
      }
    });

    [...langCounts.keys()].sort().forEach((lang) => {
      const lbl = `${lang} (${langCounts.get(lang)})`;
      langList.appendChild(createItem(lang, lbl, "lang"));
      DOM.langFilter.innerHTML += `<option value="${lang}">${lbl}</option>`;
    });
  }

  const sortList = document.getElementById("sort-menu-list");

  if (confSortBtn === "si") {
    const btnRelease = document.querySelector('.sort-btn[data-sort="release"]');
    const btnChrono = document.querySelector(
      '.sort-btn[data-sort="chronological"]',
    );

    if (btnRelease && btnChrono) {
      document
        .querySelectorAll(".sort-btn")
        .forEach((b) => b.classList.remove("active"));
      btnRelease.classList.add("active");

      if (DOM.sortBy) DOM.sortBy.value = "release";
    }
  }

  if (confSortBtn === "no" && sortList) {
    sortList.innerHTML = "";

    if (DOM.sortBy) DOM.sortBy.innerHTML = "";

    const sortOptions = [
      { val: "recent", label: "Recientes" },
      { val: "title-asc", label: "Título (A-Z)" },
      { val: "title-desc", label: "Título (Z-A)" },
      { val: "year-desc", label: "Año (Desc.)" },
      { val: "year-asc", label: "Año (Asc.)" },
    ];

    if (type !== "series") {
      sortOptions.push(
        { val: "duration-asc", label: "- Duración" },
        { val: "duration-desc", label: "+ Duración" },
      );
    }

    sortOptions.push(
      { val: "rating-desc", label: "★ Mayor Reseña" },
      { val: "rating-asc", label: "★ Menor Reseña" },
    );

    sortOptions.forEach((o) => {
      sortList.appendChild(createItem(o.val, o.label, "sort"));

      if (DOM.sortBy) {
        const option = document.createElement("option");
        option.value = o.val;
        option.textContent = o.label;
        DOM.sortBy.appendChild(option);
      }
    });
  }

  if (letterList && letterSelect) {
    letterList.innerHTML = "";
    letterSelect.innerHTML = `<option value="all">Todas</option>`;

    letterList.appendChild(createItem("all", "Todas", "letter"));

    const firstLetters = new Set();
    let hasNumbers = false;

    Object.values(sourceData).forEach((item) => {
      if (item.title) {
        const firstChar = String(item.title).trim().charAt(0).toUpperCase();
        if (firstChar) {
          if (!isNaN(parseInt(firstChar))) {
            hasNumbers = true;
          } else if (/[A-Z]/.test(firstChar)) {
            firstLetters.add(firstChar);
          }
        }
      }
    });

    if (hasNumbers) {
      letterList.appendChild(createItem("#", "0-9", "letter"));
      letterSelect.innerHTML += `<option value="#">0-9</option>`;
    }

    Array.from(firstLetters)
      .sort()
      .forEach((letter) => {
        letterList.appendChild(createItem(letter, letter, "letter"));
        letterSelect.innerHTML += `<option value="${letter}">${letter}</option>`;
      });
  }

  if (requestList && requestSelect) {
    document.getElementById("request-text").textContent = "Pedidos";
    requestList.innerHTML = "";
    requestSelect.innerHTML = '<option value="all">Todos</option>';
    requestList.appendChild(createItem("all", "Todos", "request"));

    const requestCounts = new Map();
    Object.values(sourceData).forEach((item) => {
      const p = item.pedido?.trim();
      if (p) requestCounts.set(p, (requestCounts.get(p) || 0) + 1);
    });

    [...requestCounts.keys()].sort().forEach((name) => {
      const lbl = `${name} (${requestCounts.get(name)})`;
      requestList.appendChild(createItem(name, lbl, "request"));
      requestSelect.innerHTML += `<option value="${name}">${lbl}</option>`;
    });

    if (requestVisual)
      requestVisual.style.display = requestCounts.size === 0 ? "none" : "block";
  }

  const configDropdown = (trigger, visual) => {
    if (!trigger) return;
    const newTrigger = trigger.cloneNode(true);
    trigger.parentNode.replaceChild(newTrigger, trigger);
    newTrigger.onclick = (e) => {
      e.stopPropagation();
      [
        genreVisual,
        sortVisual,
        langVisual,
        letterVisual,
        requestVisual,
      ].forEach((v) => {
        if (v && v !== visual) v.classList.remove("open");
      });
      visual.classList.toggle("open");
    };
  };

  if (document.getElementById("genre-trigger"))
    configDropdown(document.getElementById("genre-trigger"), genreVisual);
  if (document.getElementById("sort-trigger"))
    configDropdown(document.getElementById("sort-trigger"), sortVisual);
  if (document.getElementById("lang-trigger"))
    configDropdown(document.getElementById("lang-trigger"), langVisual);
  if (document.getElementById("letter-trigger"))
    configDropdown(document.getElementById("letter-trigger"), letterVisual);
  if (document.getElementById("request-trigger"))
    configDropdown(document.getElementById("request-trigger"), requestVisual);
}

// ==========================================
// FUNCIÓN: APLICAR Y MOSTRAR
// ==========================================
// ── Contenido exclusivo de admin ─────────────────────────────────────────────
// Si un item tiene admin:"si" solo lo ve el correo administrador.
const ADMIN_EMAIL = "baquezadat@gmail.com";
function isAdminUser() {
  const u = typeof auth !== "undefined" ? auth.currentUser : null;
  return !!(u && u.email === ADMIN_EMAIL);
}

/**
 * Envía un embed al canal de Discord vía webhook.
 * Solo se llama desde el botón Discord del popover (admin only).
 */
async function notifyDiscordNewContent({ title, year, poster, type, season, episode, episodeTitle, totalSeasons, lastEpisodeType, requestedBy, seasonWord }) {
  // Palabra para nombrar las "temporadas" de esta serie (ej. "Parte" para
  // JoJo's Bizarre Adventure, que se divide en Partes y no en Temporadas).
  // Por defecto "Temporada".
  const _word = String(seasonWord || "").trim() || "Temporada";
  const wordCap = _word.charAt(0).toUpperCase() + _word.slice(1).toLowerCase();
  const wordLower = _word.toLowerCase();

  const configs = {
    "movie": {
      emoji: "🎬",
      label: "Película",
      description: "¡Ya está disponible en el cine! 🍿"
    },
    "series-new": {
      emoji: "📺",
      label: "Serie",
      description: "¡Nueva serie disponible en el cine! 🍿"
    },
    "series-episode": {
      emoji: "🆕",
      label: "Serie",
      description: "¡Nuevo capítulo disponible! 🎬"
    },
    "series-season": {
      emoji: "📅",
      label: "Serie",
      description: `¡Nueva ${wordLower} disponible! 🎬`
    }
  };

  const { emoji, label, description } = configs[type] || configs["movie"];

  // Color del embed según tipo de cierre
  const embedColor = lastEpisodeType === "series"
    ? 0xFF4444   // rojo — fin de serie
    : lastEpisodeType === "season"
      ? 0xFFB400  // amarillo — fin de temporada
      : 0x00D4FF; // azul — normal

  // Construir fields para series-episode
  const fields = [];

  // Field "Pedida por" para películas y series nuevas
  if ((type === "movie" || type === "series-new") && requestedBy) {
    fields.push({ name: "🙋 Pedida por", value: requestedBy, inline: false });
  }

  if (type === "series-episode" && (season || episode)) {
    // Field temporada/parte (inline)
    if (season && totalSeasons > 1) {
      fields.push({ name: `📅 ${wordCap}`, value: `${season}`, inline: true });
    }
    // Field episodio (inline)
    if (episode) {
      fields.push({ name: "🎞️ Episodio", value: `${episode}`, inline: true });
    }
    // Field título del episodio (ancho completo)
    if (episodeTitle) {
      fields.push({ name: "📝 Título", value: episodeTitle, inline: false });
    }
    // Field cierre si aplica
    if (lastEpisodeType === "season") {
      fields.push({ name: "\u200b", value: `🏁 **¡Último capítulo de la ${wordLower}!**`, inline: false });
    } else if (lastEpisodeType === "series") {
      fields.push({ name: "\u200b", value: "🎬 **¡Último capítulo de la serie!**", inline: false });
    }
  } else if (type === "series-season" && season) {
    fields.push({ name: `📅 ${wordCap}`, value: `${season}`, inline: true });
  }

  const payload = {
    embeds: [{
      author: {
        name: "Cine Corneta",
        url: "https://cornetagang.github.io/cinecorneta/"
      },
      title: `${emoji} ${title} (${year || "?????"})`  ,
      description,
      fields: fields.length ? fields : undefined,
      color: embedColor,
      thumbnail: poster ? { url: poster } : undefined,
      footer: { text: label },
      timestamp: new Date().toISOString()
    }]
  };

  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("No autenticado");

  const res = await fetch(`${WORKER_URL}/discord-notify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(`Webhook error: ${res.status}`);
}

// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// Mini modal para avisos de Discord (series) — con lista real de eps
// ─────────────────────────────────────────────────────────────────
function openDiscordNotifyModal({ initialType, seriesData, seriesId }) {
  document.getElementById("dc-notify-modal")?.remove();

  // ── Estilos ──────────────────────────────────────────────────
  if (!document.getElementById("dc-modal-style")) {
    const s = document.createElement("style");
    s.id = "dc-modal-style";
    s.textContent = `
      @keyframes dcFadeIn  { from{opacity:0} to{opacity:1} }
      @keyframes dcScaleIn { from{opacity:0;transform:scale(.93) translateY(10px)} to{opacity:1;transform:scale(1) translateY(0)} }
      #dc-notify-modal .dc-ep-row:hover    { background:rgba(114,137,218,.13) !important; }
      #dc-notify-modal .dc-season-row:hover{ background:rgba(114,137,218,.13) !important; }
    `;
    document.head.appendChild(s);
  }

  const DISC_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`;

  const TYPES = [
    { type: "series-new",     emoji: "📺", label: "Serie nueva"    },
    { type: "series-episode", emoji: "🆕", label: "Nuevo capítulo" },
    { type: "series-season",  emoji: "📅", label: "Nueva temporada"},
  ];

  let selectedType = initialType;
  let selectedItem = null; // { season, episode?, label }

  const posterUrl   = seriesData.poster || seriesData.image || seriesData.banner || "";
  const episodesRaw = (seriesId && appState?.content?.seriesEpisodes?.[seriesId]) || {};
  const seasons     = Object.keys(episodesRaw).sort((a, b) =>
    (parseInt(a.replace(/\D/g,""))||0) - (parseInt(b.replace(/\D/g,""))||0)
  );
  const realSeasonCount = seasons.filter(s => {
    const sl = String(s).toLowerCase();
    return !sl.includes("pelicula") && !sl.includes("película") &&
           !sl.includes("especial") && !sl.includes("ova") &&
           !sl.includes("movie") && !sl.includes("special");
  }).length;

  // Algunas series (ej. JoJo's Bizarre Adventure) se dividen en "Partes" y no
  // en "Temporadas". El campo custom "nombreTemporadas" de la serie indica
  // qué palabra usar (ej. "Parte"); si no está definido, se usa "Temporada".
  const seasonWordRaw  = String(seriesData.nombreTemporadas || "").trim();
  const seasonWord     = seasonWordRaw || "Temporada";
  const seasonWordCap  = seasonWord.charAt(0).toUpperCase() + seasonWord.slice(1).toLowerCase();
  const seasonWordLower = seasonWord.toLowerCase();
  const seasonAbbr     = (seasonWord[0] || "T").toUpperCase();

  // Posters/etiquetas por temporada (ej. seasonPosters[id]["temporada4"].etiqueta = "Parte 5")
  const seasonPostersData = (seriesId && appState?.content?.seasonPosters?.[seriesId]) || {};

  // Devuelve { label, num, abbr } para una temporada: usa la "etiqueta" custom
  // si existe (ej. "Parte 5"), si no arma "{seasonWordCap} {sNum}".
  function getSeasonMeta(sKey, sNum) {
    const entry = seasonPostersData[sKey];
    const etiqueta = (typeof entry === "object" ? (entry?.etiqueta || "") : "").trim();
    if (etiqueta) {
      const numMatch = etiqueta.match(/\d+/);
      return {
        label: etiqueta,
        num: numMatch ? numMatch[0] : sNum,
        abbr: `${etiqueta[0].toUpperCase()}${numMatch ? numMatch[0] : ""}`
      };
    }
    return { label: `${seasonWordCap} ${sNum}`, num: sNum, abbr: `${seasonAbbr}${sNum}` };
  }

  // ── Overlay ──────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.id = "dc-notify-modal";
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:99999;
    display:flex; align-items:center; justify-content:center;
    background:rgba(0,0,0,0.58); backdrop-filter:blur(6px);
    animation:dcFadeIn .15s ease;`;
  overlay.onclick = () => overlay.remove();

  const card = document.createElement("div");
  card.style.cssText = `
    background:#1a1d27; border:1px solid rgba(255,255,255,.1);
    border-radius:16px; padding:20px; width:380px; max-width:94vw;
    box-shadow:0 24px 64px rgba(0,0,0,.75);
    animation:dcScaleIn .22s cubic-bezier(.34,1.56,.64,1);`;
  card.onclick = e => e.stopPropagation();
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ── Helpers de construcción ───────────────────────────────────
  function mkHeader(backCb, title) {
    const h = document.createElement("div");
    h.style.cssText = `display:flex; align-items:center; gap:9px; margin-bottom:16px;`;
    if (backCb) {
      const b = document.createElement("button");
      b.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>`;
      b.style.cssText = `background:none;border:none;color:rgba(255,255,255,.45);cursor:pointer;padding:0;display:flex;align-items:center;transition:color .15s;`;
      b.onmouseenter = () => b.style.color = "#fff";
      b.onmouseleave = () => b.style.color = "rgba(255,255,255,.45)";
      b.onclick = backCb;
      h.appendChild(b);
    } else {
      const icon = document.createElement("span");
      icon.style.color = "#7289da";
      icon.innerHTML = DISC_ICON;
      h.appendChild(icon);
    }
    const t = document.createElement("span");
    t.style.cssText = `font-size:14px;font-weight:700;color:#fff;letter-spacing:.01em;`;
    t.textContent = title || "Avisar en Discord";
    h.appendChild(t);
    const x = document.createElement("button");
    x.innerHTML = "×";
    x.style.cssText = `margin-left:auto;background:none;border:none;color:rgba(255,255,255,.3);cursor:pointer;font-size:22px;line-height:1;padding:0;transition:color .15s;`;
    x.onmouseenter = () => x.style.color = "rgba(255,255,255,.8)";
    x.onmouseleave = () => x.style.color = "rgba(255,255,255,.3)";
    x.onclick = () => overlay.remove();
    h.appendChild(x);
    return h;
  }

  function mkSeriesRow() {
    const row = document.createElement("div");
    row.style.cssText = `
      display:flex; align-items:center; gap:11px; margin-bottom:16px;
      padding:10px 12px; background:rgba(255,255,255,.05);
      border-radius:10px; border:1px solid rgba(255,255,255,.07);`;
    row.innerHTML = posterUrl
      ? `<img src="${posterUrl}" style="width:34px;height:50px;object-fit:cover;border-radius:5px;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.5);">`
      : `<div style="width:34px;height:50px;border-radius:5px;background:rgba(255,255,255,.08);flex-shrink:0;"></div>`;
    const info = document.createElement("div");
    info.style.cssText = "overflow:hidden;";
    info.innerHTML = `
      <div style="font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${seriesData.title}</div>
      <div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:3px;">${seriesData.year || seriesData.anio || ""}</div>`;
    row.appendChild(info);
    return row;
  }

  function mkPills() {
    const row = document.createElement("div");
    row.style.cssText = `display:flex; gap:6px; margin-bottom:16px;`;
    TYPES.forEach(({ type, emoji, label }) => {
      const p = document.createElement("button");
      const on = type === selectedType;
      const displayLabel = type === "series-season" ? `Nueva ${seasonWordCap}` : label;
      p.dataset.type = type;
      p.style.cssText = `
        flex:1; display:flex; align-items:center; justify-content:center; gap:4px;
        padding:6px 4px; border-radius:20px; font-size:11px; cursor:pointer;
        transition:all .15s; text-align:center;
        border:1px solid ${on ? "rgba(114,137,218,.65)" : "rgba(255,255,255,.1)"};
        background:${on ? "rgba(114,137,218,.3)"      : "rgba(255,255,255,.06)"};
        color:${on ? "#fff" : "rgba(255,255,255,.5)"};
        font-weight:${on ? "600" : "400"};`;
      p.innerHTML = `${emoji} ${displayLabel}`;
      p.onclick = () => { selectedType = type; selectedItem = null; renderMain(); };
      row.appendChild(p);
    });
    return row;
  }

  // ── Lista de episodios ────────────────────────────────────────
  function mkEpisodeList() {
    const wrap = document.createElement("div");
    wrap.style.cssText = `
      max-height:260px; overflow-y:auto; border-radius:10px;
      border:1px solid rgba(255,255,255,.07); margin-bottom:16px;
      scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.15) transparent;`;

    if (!seasons.length) {
      wrap.innerHTML = `<div style="padding:24px;text-align:center;color:rgba(255,255,255,.3);font-size:12px;">Sin episodios disponibles</div>`;
      return wrap;
    }

    seasons.forEach((sKey, si) => {
      const raw  = episodesRaw[sKey];
      const eps  = Array.isArray(raw) ? raw : Object.values(raw || {});
      const sNum = parseInt(sKey.replace(/\D/g,"")) || (si + 1);
      const meta = getSeasonMeta(sKey, sNum);

      // Cabecera de temporada/parte
      const sh = document.createElement("div");
      sh.style.cssText = `
        padding:7px 13px; font-size:10px; font-weight:700; letter-spacing:.09em;
        text-transform:uppercase; color:rgba(255,255,255,.35);
        background:rgba(0,0,0,.25);
        ${si > 0 ? "border-top:1px solid rgba(255,255,255,.06);" : ""}`;
      sh.textContent = meta.label;
      wrap.appendChild(sh);

      eps.forEach((ep, idx) => {
        const epNum   = ep.episode || ep.numero || ep.ep || (idx + 1);
        const epTitle = ep.title   || ep.titulo || ep.name || "";
        const row = document.createElement("div");
        row.className = "dc-ep-row";
        row.style.cssText = `
          display:flex; align-items:center; gap:10px; padding:9px 13px;
          cursor:pointer; border-bottom:1px solid rgba(255,255,255,.04);
          transition:background .12s;`;
        row.innerHTML = `
          <span style="font-size:11px;font-weight:700;color:rgba(114,137,218,.85);min-width:30px;flex-shrink:0;">E${epNum}</span>
          <span style="font-size:12px;color:rgba(255,255,255,.78);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${epTitle || `Episodio ${epNum}`}</span>
          <span style="margin-left:auto;font-size:11px;color:rgba(255,255,255,.2);flex-shrink:0;">›</span>`;
        row.onclick = () => {
          selectedItem = { season: meta.num, episode: epNum, episodeTitle: epTitle || "", label: realSeasonCount > 1 ? `${meta.abbr} · E${epNum}${epTitle ? " — " + epTitle : ""}` : `Episodio ${epNum}${epTitle ? " — " + epTitle : ""}` };
          renderConfirm();
        };
        wrap.appendChild(row);
      });
    });
    return wrap;
  }

  // ── Lista de temporadas ───────────────────────────────────────
  function mkSeasonList() {
    const wrap = document.createElement("div");
    wrap.style.cssText = `display:flex; flex-direction:column; gap:7px; margin-bottom:16px;`;

    if (!seasons.length) {
      wrap.innerHTML = `<div style="padding:24px;text-align:center;color:rgba(255,255,255,.3);font-size:12px;">Sin temporadas disponibles</div>`;
      return wrap;
    }

    seasons.forEach((sKey, si) => {
      const raw   = episodesRaw[sKey];
      const eps   = Array.isArray(raw) ? raw : Object.values(raw || {});
      const sNum  = parseInt(sKey.replace(/\D/g,"")) || (si + 1);
      const meta  = getSeasonMeta(sKey, sNum);
      const row   = document.createElement("div");
      row.className = "dc-season-row";
      row.style.cssText = `
        display:flex; align-items:center; justify-content:space-between;
        padding:12px 14px; border-radius:10px; cursor:pointer;
        background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.07);
        transition:background .12s;`;
      row.innerHTML = `
        <span style="font-size:13px;font-weight:600;color:#fff;">📅 ${meta.label}</span>
        <span style="font-size:11px;color:rgba(255,255,255,.3);">${eps.length} eps ›</span>`;
      row.onclick = () => {
        selectedItem = { season: meta.num, label: meta.label };
        renderConfirm();
      };
      wrap.appendChild(row);
    });
    return wrap;
  }

  // ── Vista de confirmación ─────────────────────────────────────
  let lastEpisodeType = null; // null | "season" | "series"

  function mkConfirmContent() {
    const t = TYPES.find(x => x.type === selectedType);
    const frag = document.createDocumentFragment();

    // Preview del embed
    const preview = document.createElement("div");
    preview.id = "dc-preview-box";
    const accentColor = () => lastEpisodeType === "series" ? "#FF4444" : lastEpisodeType === "season" ? "#FFB400" : "#00D4FF";
    const updatePreviewAccent = () => { preview.style.borderLeftColor = accentColor(); };
    preview.style.cssText = `
      padding:14px 14px 14px 16px; border-radius:10px; margin-bottom:16px;
      background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08);
      border-left:4px solid ${accentColor()};`;

    const buildPreviewHTML = () => {
      const epNum    = selectedItem?.episode ?? null;
      const epSeason = (selectedItem?.season && realSeasonCount > 1) ? selectedItem.season : null;
      const epTitle  = selectedItem?.episodeTitle || "";
      const closeBadge = lastEpisodeType === "season"
        ? `<div style="margin-top:6px;font-size:11px;font-weight:700;color:#FFB400;">🏁 Último capítulo de la ${seasonWordLower}</div>`
        : lastEpisodeType === "series"
          ? `<div style="margin-top:6px;font-size:11px;font-weight:700;color:#FF4444;">🎬 Último capítulo de la serie</div>`
          : "";
      const fieldsHTML = (epSeason || epNum) ? `
        <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;">
          ${epSeason ? `<div style="background:rgba(255,255,255,.06);border-radius:6px;padding:4px 9px;">
            <div style="font-size:9px;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px;">${seasonWordCap}</div>
            <div style="font-size:12px;font-weight:700;color:#fff;">${epSeason}</div>
          </div>` : ""}
          ${epNum ? `<div style="background:rgba(255,255,255,.06);border-radius:6px;padding:4px 9px;">
            <div style="font-size:9px;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px;">Episodio</div>
            <div style="font-size:12px;font-weight:700;color:#fff;">${epNum}</div>
          </div>` : ""}
        </div>
        ${epTitle ? `<div style="margin-top:6px;font-size:11px;color:rgba(255,255,255,.5);font-style:italic;">${epTitle}</div>` : ""}
        ${closeBadge}` : "";
      const TYPE_DESC = {
        "movie":          "¡Ya está disponible en el cine! 🍿",
        "series-new":     "¡Nueva serie disponible en el cine! 🍿",
        "series-episode": "¡Nuevo capítulo disponible! 🎬",
        "series-season":  `¡Nueva ${seasonWordLower} disponible! 🎬`
      };
      return `
        <div style="font-size:10px;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.09em;margin-bottom:10px;">Vista previa del aviso</div>
        <div style="display:flex;align-items:flex-start;gap:10px;">
          ${posterUrl ? `<img src="${posterUrl}" style="width:30px;height:44px;object-fit:cover;border-radius:4px;flex-shrink:0;">` : ""}
          <div style="flex:1;min-width:0;">
            <div style="font-size:11px;color:rgba(255,255,255,.35);margin-bottom:3px;">${t.emoji} ${seriesData.title}</div>
            <div style="font-size:13px;font-weight:700;color:#fff;">${TYPE_DESC[selectedType] || ""}</div>
            ${fieldsHTML}
          </div>
        </div>`;
    };
    preview.innerHTML = buildPreviewHTML();
    frag.appendChild(preview);

    // Selector "Último capítulo" — solo para series-episode
    if (selectedType === "series-episode") {
      const wrap = document.createElement("div");
      wrap.style.cssText = `margin-bottom:14px;`;

      const sectionLabel = document.createElement("div");
      sectionLabel.style.cssText = `font-size:10px;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.09em;margin-bottom:7px;`;
      sectionLabel.textContent = "¿Es el último capítulo?";
      wrap.appendChild(sectionLabel);

      const btnRow = document.createElement("div");
      btnRow.style.cssText = `display:flex; gap:7px;`;

      const OPTIONS = [
        { value: null,     emoji: "—",  label: "No"                   },
        { value: "season", emoji: "🏁", label: `De la ${seasonWordLower}` },
        { value: "series", emoji: "🎬", label: "De la serie"          },
      ];

      OPTIONS.forEach(opt => {
        const btn = document.createElement("button");
        const isActive = () => lastEpisodeType === opt.value;
        const getStyle = () => `
          flex:1; padding:8px 6px; border-radius:8px; border:1px solid;
          font-size:11px; font-weight:600; cursor:pointer; transition:all .15s;
          border-color:${isActive() ? (opt.value === "series" ? "rgba(255,80,80,.7)" : opt.value === "season" ? "rgba(255,180,0,.6)" : "rgba(255,255,255,.15)") : "rgba(255,255,255,.08)"};
          background:${isActive() ? (opt.value === "series" ? "rgba(255,80,80,.15)" : opt.value === "season" ? "rgba(255,180,0,.12)" : "rgba(255,255,255,.08)") : "rgba(255,255,255,.04)"};
          color:${isActive() ? "#fff" : "rgba(255,255,255,.45)"};`;
        btn.style.cssText = getStyle();
        btn.innerHTML = `${opt.emoji}<br><span style="font-size:10px;">${opt.label}</span>`;
        btn.onclick = () => {
          lastEpisodeType = opt.value;
          btnRow.querySelectorAll("button").forEach(b => b.style.cssText = getStyle.call(b));
          // re-aplicar estilos a todos
          Array.from(btnRow.children).forEach((b, i) => {
            const o = OPTIONS[i];
            const active = lastEpisodeType === o.value;
            b.style.cssText = `
              flex:1; padding:8px 6px; border-radius:8px; border:1px solid;
              font-size:11px; font-weight:600; cursor:pointer; transition:all .15s;
              border-color:${active ? (o.value === "series" ? "rgba(255,80,80,.7)" : o.value === "season" ? "rgba(255,180,0,.6)" : "rgba(255,255,255,.15)") : "rgba(255,255,255,.08)"};
              background:${active ? (o.value === "series" ? "rgba(255,80,80,.15)" : o.value === "season" ? "rgba(255,180,0,.12)" : "rgba(255,255,255,.08)") : "rgba(255,255,255,.04)"};
              color:${active ? "#fff" : "rgba(255,255,255,.45)"};`;
          });
          document.getElementById("dc-preview-box").style.borderLeftColor = accentColor();
          document.getElementById("dc-preview-box").innerHTML = buildPreviewHTML();
        };
        btnRow.appendChild(btn);
      });

      wrap.appendChild(btnRow);
      frag.appendChild(wrap);
    }

    // Botones
    const actions = document.createElement("div");
    actions.style.cssText = `display:flex; gap:8px;`;

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancelar";
    cancelBtn.style.cssText = `
      flex:1; padding:10px; border-radius:9px;
      border:1px solid rgba(255,255,255,.1);
      background:rgba(255,255,255,.05); color:rgba(255,255,255,.6);
      font-size:13px; cursor:pointer; transition:background .15s;`;
    cancelBtn.onmouseenter = () => cancelBtn.style.background = "rgba(255,255,255,.1)";
    cancelBtn.onmouseleave = () => cancelBtn.style.background = "rgba(255,255,255,.05)";
    cancelBtn.onclick = () => { selectedItem = null; lastEpisodeType = null; renderMain(); };

    const sendBtn = document.createElement("button");
    sendBtn.textContent = "Confirmar y enviar";
    sendBtn.style.cssText = `
      flex:1.4; padding:10px; border-radius:9px; border:none;
      background:linear-gradient(135deg,#7289da,#5b6eae);
      color:#fff; font-size:13px; font-weight:700;
      cursor:pointer; transition:opacity .15s;`;
    sendBtn.onmouseenter = () => sendBtn.style.opacity = ".85";
    sendBtn.onmouseleave = () => sendBtn.style.opacity = "1";
    sendBtn.onclick = async () => {
      sendBtn.textContent = "Enviando…";
      sendBtn.disabled = true; cancelBtn.disabled = true;
      try {
        await notifyDiscordNewContent({
          title:         seriesData.title,
          year:          seriesData.year || seriesData.anio,
          poster:        posterUrl || null,
          type:          selectedType,
          season:        selectedItem?.season        ?? null,
          episode:       selectedItem?.episode       ?? null,
          episodeTitle:  selectedItem?.episodeTitle  ?? "",
          totalSeasons:  realSeasonCount,
          lastEpisodeType: selectedType === "series-episode" ? lastEpisodeType : null,
          seasonWord:    seasonWord
        });
        sendBtn.textContent = "✓ Enviado";
        sendBtn.style.background = "linear-gradient(135deg,#43b581,#3aa36e)";
        setTimeout(() => overlay.remove(), 1400);
      } catch (err) {
        console.error("[Discord]", err);
        sendBtn.textContent = "✗ Error al enviar";
        sendBtn.style.background = "linear-gradient(135deg,#f04747,#d93535)";
        sendBtn.disabled = false; cancelBtn.disabled = false;
        setTimeout(() => {
          sendBtn.textContent = "Confirmar y enviar";
          sendBtn.style.background = "linear-gradient(135deg,#7289da,#5b6eae)";
        }, 3000);
      }
    };

    actions.append(cancelBtn, sendBtn);
    frag.appendChild(actions);
    return frag;
  }

  // ── Renderizados ──────────────────────────────────────────────
  function renderMain() {
    card.innerHTML = "";
    card.appendChild(mkHeader(null, "Avisar en Discord"));
    card.appendChild(mkSeriesRow());
    card.appendChild(mkPills());

    if (selectedType === "series-new") {
      // Botón directo sin lista
      const sendBtn = document.createElement("button");
      sendBtn.textContent = "Enviar aviso";
      sendBtn.style.cssText = `
        width:100%; padding:11px; border-radius:9px; border:none;
        background:linear-gradient(135deg,#7289da,#5b6eae);
        color:#fff; font-size:13px; font-weight:700;
        cursor:pointer; transition:opacity .15s;`;
      sendBtn.onmouseenter = () => sendBtn.style.opacity = ".85";
      sendBtn.onmouseleave = () => sendBtn.style.opacity = "1";
      sendBtn.onclick = async () => {
        sendBtn.textContent = "Enviando…"; sendBtn.disabled = true;
        try {
          await notifyDiscordNewContent({
            title: seriesData.title, year: seriesData.year || seriesData.anio,
            poster: posterUrl || null, type: "series-new",
            requestedBy: seriesData.pedido || seriesData.requestedBy || seriesData.pedidaPor || seriesData.pedida_por || ""
          });
          sendBtn.textContent = "✓ Enviado";
          sendBtn.style.background = "linear-gradient(135deg,#43b581,#3aa36e)";
          setTimeout(() => overlay.remove(), 1400);
        } catch (err) {
          console.error("[Discord]", err);
          sendBtn.textContent = "✗ Error";
          sendBtn.style.background = "linear-gradient(135deg,#f04747,#d93535)";
          sendBtn.disabled = false;
          setTimeout(() => {
            sendBtn.textContent = "Enviar aviso";
            sendBtn.style.background = "linear-gradient(135deg,#7289da,#5b6eae)";
          }, 3000);
        }
      };
      card.appendChild(sendBtn);

    } else if (selectedType === "series-episode") {
      card.appendChild(mkEpisodeList());

    } else if (selectedType === "series-season") {
      card.appendChild(mkSeasonList());
    }
  }

  function renderConfirm() {
    card.innerHTML = "";
    card.appendChild(mkHeader(() => { selectedItem = null; renderMain(); }, "Confirmar aviso"));
    card.appendChild(mkSeriesRow());
    card.appendChild(mkConfirmContent());
  }

  renderMain();
}
function isAdminContent(item) {
  return item && (item.admin === "si" || item.admin === "yes" || item.admin === "true");
}
// Filtro reutilizable: excluye contenido admin para no-admins
function filterAdminContent(entries) {
  if (isAdminUser()) return entries;
  return entries.filter(([, item]) => !isAdminContent(item));
}

async function applyAndDisplayFilters(type) {
  let sourceData;
  if (type === "movie") sourceData = appState.content.movies;
  else if (type === "series") sourceData = appState.content.series;
  else sourceData = appState.content.sagas[type];

  const gridEl = DOM.gridContainer.querySelector(".grid");
  if (!gridEl || !sourceData) return;

  const sagaConfig =
    appState.content.sagasList.find((s) => s.id === type) || {};
  const confGenres = (sagaConfig.genres_filter || "si").toLowerCase().trim();
  const confSortBtn = (sagaConfig.sort_buttons || "no").toLowerCase().trim();
  const confLang = (sagaConfig.lang_filter || "si").toLowerCase().trim();

  let sortByValue =
    confSortBtn === "si"
      ? document.querySelector(".sort-btn.active")?.dataset.sort || "release"
      : DOM.sortBy.value || "recent";

  const letterFilterVal =
    document.getElementById("letter-filter")?.value || "all";
  const requestFilterVal =
    document.getElementById("request-filter")?.value || "all";

  gridEl.innerHTML = `<div style="width:100%;height:60vh;display:flex;justify-content:center;align-items:center;grid-column:1/-1;"><p class="loading-text">Cargando...</p></div>`;

  let content = filterAdminContent(Object.entries(sourceData));
  const isDynamicSaga = type !== "movie" && type !== "series";

  if (isDynamicSaga) content.reverse();

  content.forEach((item, index) => {
    item[1]._originalIndex = index;
  });

  if (confGenres !== "no" && DOM.genreFilter.value !== "all") {
    const filterVal = DOM.genreFilter.value.toLowerCase().trim();

    content = content.filter(([id, item]) => {
      if (confGenres === "fases") {
        const fase = String(item.fase || "").trim();
        if (filterVal === "saga_infinity")
          return ["1", "2", "3"].includes(fase);
        if (filterVal === "saga_multiverse")
          return ["4", "5", "6"].includes(fase);
        return fase === filterVal;
      }
      const genresStr = String(item.genres || "").toLowerCase();
      const titleStr = String(item.title || "").toLowerCase();
      return genresStr.includes(filterVal) || titleStr.includes(filterVal);
    });
  }

  if (confLang === "si" && DOM.langFilter && DOM.langFilter.value !== "all") {
    const langVal = DOM.langFilter.value.toLowerCase().trim();
    content = content.filter(([id, item]) => {
      const itemLang = String(
        item.language || item.idioma || item.audio || "",
      ).toLowerCase();
      return itemLang.includes(langVal);
    });
  }

  if (letterFilterVal !== "all") {
    content = content.filter(([id, item]) => {
      const firstChar = String(item.title || "")
        .trim()
        .charAt(0)
        .toUpperCase();
      if (letterFilterVal === "#") return !isNaN(parseInt(firstChar));
      return firstChar === letterFilterVal;
    });
  }

  if (requestFilterVal !== "all") {
    content = content.filter(
      ([, item]) => (item.pedido || "").trim() === requestFilterVal,
    );
  }

  if (sortByValue === "rating-desc" || sortByValue === "rating-asc") {
    content = content.filter(([id]) => {
      const rating = parseFloat(appState.content.averages[id]);
      return rating > 0;
    });
  }

  content.sort((a, b) => {
    const idA = a[0];
    const idB = b[0];
    const aData = a[1];
    const bData = b[1];

    let result = 0;

    if (isDynamicSaga) {
      const getOrderValue = (data) => {
        const orderVal =
          data.order || data.number || data.id || data.stage || data.episode;
        if (orderVal !== undefined) {
          const numVal = Number(orderVal);
          if (!isNaN(numVal)) return numVal;
        }
        return data._originalIndex || 0;
      };

      result = getOrderValue(aData) - getOrderValue(bData);

      if (result !== 0) return result;
    }

    if (sortByValue === "recent" || sortByValue === "release") {
      const typeA =
        aData.type === "series" || appState.content.series[idA]
          ? "series"
          : "movie";
      const typeB =
        bData.type === "series" || appState.content.series[idB]
          ? "series"
          : "movie";

      const timeA = getLatestUpdateTimestamp(idA, aData, typeA);
      const timeB = getLatestUpdateTimestamp(idB, bData, typeB);

      if (timeA !== timeB) {
        result = timeB - timeA;
      } else if (timeA > 0) {
        const getScore = (id, data, t) => {
          if (isDateRecent(data.date_added)) return 3;
          if (t === "series" && hasRecentSeasonFromPosters(id)) return 2;
          if (t === "series" && hasRecentEpisodes(id)) return 1;
          return 0;
        };
        result = getScore(idB, bData, typeB) - getScore(idA, aData, typeA);
      } else {
        result = (Number(bData.tr) || 0) - (Number(aData.tr) || 0);
      }
    } else if (sortByValue === "chronological") {
      result =
        (Number(aData.cronologia) || 9999) - (Number(bData.cronologia) || 9999);
    } else if (sortByValue === "year-asc") {
      result = (Number(aData.year) || 9999) - (Number(bData.year) || 9999);
    } else if (sortByValue === "year-desc") {
      result = (Number(bData.year) || 0) - (Number(aData.year) || 0);
    } else if (sortByValue === "title-asc") {
      result = (aData.title || "").localeCompare(bData.title || "");
    } else if (sortByValue === "title-desc") {
      result = (bData.title || "").localeCompare(aData.title || "");
    } else if (
      sortByValue === "duration-asc" ||
      sortByValue === "duration-desc"
    ) {
      const getMinutes = (item) => {
        const d = String(item.duration || item.duracion || "")
          .toLowerCase()
          .trim();
        if (!d) return 0;

        let minutes = 0;
        const h = d.match(/(\d+)\s*h/);
        const m = d.match(/(\d+)\s*m/);
        if (h) minutes += parseInt(h[1]) * 60;
        if (m) minutes += parseInt(m[1]);

        if (!h && !m) {
          const num = parseInt(d.replace(/\D/g, ""));
          if (!isNaN(num)) minutes = num;
        }
        return minutes;
      };

      const minA = getMinutes(aData);
      const minB = getMinutes(bData);

      if (sortByValue === "duration-asc") result = minA - minB;
      if (sortByValue === "duration-desc") result = minB - minA;
    } else if (sortByValue === "rating-desc" || sortByValue === "rating-asc") {
      const ratingA = parseFloat(appState.content.averages[idA]) || 0;
      const ratingB = parseFloat(appState.content.averages[idB]) || 0;
      const hasA = ratingA > 0;
      const hasB = ratingB > 0;
      if (!hasA && !hasB) result = 0;
      else if (!hasA) result = 1;
      else if (!hasB) result = -1;
      else if (sortByValue === "rating-desc") result = ratingB - ratingA;
      else result = ratingA - ratingB;
    }

    return result;
  });

  if (sortByValue === "chronological") {
    const expandedContent = [];

    content.forEach(([id, item]) => {
      const multiChrono = item.cronologiaMulti || item.cronologia_multi;

      if (multiChrono) {
        const seriesPosters = appState.content.seasonPosters[id] || {};

        const getSeasonPoster = (num) => {
          const p = seriesPosters[num];
          if (!p) return item.poster;
          return typeof p === "object" ? p.posterUrl : p;
        };

        const t1 = {
          ...item,
          title: `${item.title} (T1)`,
          poster: getSeasonPoster(1),
        };
        expandedContent.push([id, t1]);

        String(multiChrono)
          .split(",")
          .map((c) => c.trim())
          .forEach((chronoVal, index) => {
            const sNum = index + 2;
            const tNext = {
              ...item,
              title: `${item.title} (T${sNum})`,
              cronologia: chronoVal,
              poster: getSeasonPoster(sNum),
            };
            expandedContent.push([id, tNext]);
          });
      } else {
        expandedContent.push([id, item]);
      }
    });

    expandedContent.sort(
      (a, b) =>
        (Number(a[1].cronologia) || 99999) - (Number(b[1].cronologia) || 99999),
    );
    content = expandedContent;
  }

  appState.ui.contentToDisplay = content;

  appState.ui.currentIndex = 0;

  // Mostrar skeletons mientras se renderizan las cards
  showGridSkeletons(Math.min(content.length, UI.ITEMS_PER_LOAD || 24));

  // ── Actualizar contador del catalog header ──
  const catalogCountEl = document.getElementById("catalog-count");
  if (catalogCountEl) {
    const label = type === "series" ? "series" : "películas";
    catalogCountEl.textContent = `${content.length} ${label} disponibles`;
  }

  setupPaginationControls();

  const firstPageItems = content.slice(0, UI.ITEMS_PER_LOAD);
  const imagePromises = firstPageItems.map(([id, item]) =>
    preloadImage(item.poster),
  );

  try {
    await Promise.race([
      Promise.all(imagePromises),
      new Promise((r) => setTimeout(r, 1000)),
    ]);
  } catch (e) {}

  renderCurrentPage();
}

function setupEventListeners() {
  console.log("⚙️ Configurando Event Listeners...");
  document.addEventListener("click", handleGlobalClick);

  const navLinks = document.querySelectorAll(
    ".main-nav a, .bottom-nav .nav-link, .profile-hub-menu-item",
  );

  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();

      const filter = link.dataset.filter;

      const detailView = document.getElementById("detail-view");
      if (detailView && detailView.style.display !== "none") {
        const isLogo = link.classList.contains("logo") || filter === "all";
        if (isLogo) {
          // Logo: cerrar detalle e ir a inicio
          closeDetailView();
          switchView("all");
        } else {
          // Otros links del nav: solo volver al catálogo (como el botón Volver)
          closeDetailView();
        }
        return;
      }

      switchView(filter);

      const dropdown = document.getElementById("user-menu-dropdown");
      if (dropdown && dropdown.classList.contains("show")) {
        dropdown.classList.remove("show");
      }
    });
  });

  const mobileRouletteBtn = document.querySelector(".mobile-roulette-btn");
  if (mobileRouletteBtn) {
    mobileRouletteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      switchView("roulette");
    });
  }

  DOM.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      DOM.searchInput.value = "";
      DOM.searchInput.blur();
      const currentFilter =
        document.querySelector(".main-nav a.active")?.dataset.filter || "all";
      switchView(currentFilter);
    }
  });

  document.addEventListener("click", (e) => {
    const trigger = e.target.closest(".dropdown-trigger");
    const dropdown = e.target.closest(".custom-dropdown");

    if (trigger) {
      e.stopPropagation();
      const menu = dropdown.querySelector(".dropdown-menu");

      document.querySelectorAll(".dropdown-menu.show").forEach((m) => {
        if (m !== menu) m.classList.remove("show");
      });

      if (menu) menu.classList.toggle("show");
    } else {
      document.querySelectorAll(".dropdown-menu.show").forEach((m) => {
        m.classList.remove("show");
      });
    }
  });

  document.addEventListener("click", (e) => {
    const item = e.target.closest(".dropdown-item");
    if (!item) return;

    const dropdown = item.closest(".custom-dropdown");
    if (!dropdown) return;

    let selectId = "";
    let triggerTextId = "";

    if (dropdown.id === "genre-dropdown-visual") {
      selectId = "genre-filter";
      triggerTextId = "genre-text";
    } else if (dropdown.id === "lang-dropdown-visual") {
      selectId = "lang-filter";
      triggerTextId = "lang-text";
    } else if (dropdown.id === "sort-dropdown-visual") {
      selectId = "sort-by";
      triggerTextId = "sort-text";
    }

    if (!selectId) return;

    dropdown
      .querySelectorAll(".dropdown-item")
      .forEach((i) => i.classList.remove("selected"));
    item.classList.add("selected");

    const triggerText = document.getElementById(triggerTextId);
    if (triggerText) triggerText.textContent = item.textContent;

    const hiddenSelect = document.getElementById(selectId);
    if (hiddenSelect) {
      hiddenSelect.value = item.dataset.value;

      const currentType = appState.ui.activeSagaId || "movie";
      let sourceData = null;

      if (currentType === "movie") sourceData = appState.content.movies;
      else if (currentType === "series") sourceData = appState.content.series;
      else if (currentType === "ucm") sourceData = appState.content.ucm;
      else if (appState.content.sagas[currentType])
        sourceData = appState.content.sagas[currentType];

      if (sourceData) {
        applyAndDisplayFilters(currentType);
      }
    }
  });

  const backSagaBtn = document.getElementById("back-to-sagas-btn");
  if (backSagaBtn) {
    backSagaBtn.addEventListener("click", () => switchView("sagas"));
  }

  document.querySelectorAll(".close-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      if (btn.closest("#review-form-modal")) {
        e.preventDefault();
        e.stopPropagation();
        const reviewModal = document.getElementById("review-form-modal");
        if (reviewModal) reviewModal.classList.remove("show");
        document.body.classList.remove("modal-open");
        return;
      }

      ModalManager.closeAll();
    });
  });

  window.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal")) {
      if (e.target.id === "review-form-modal") {
        e.target.classList.remove("show");
        document.body.classList.remove("modal-open");
        return;
      }

      if (e.target.id === "series-player-page") return;

      ModalManager.closeAll();
    }
  });

  const loginBtnHub = document.getElementById("login-btn-hub");
  if (loginBtnHub) {
    loginBtnHub.addEventListener("click", (e) => {
      e.preventDefault();
      if (window.openAuthModal) window.openAuthModal(true);
    });
  }

  const registerBtnHub = document.getElementById("register-btn-hub");
  if (registerBtnHub) {
    registerBtnHub.addEventListener("click", (e) => {
      e.preventDefault();
      if (window.openAuthModal) window.openAuthModal(false);
    });
  }

  document.addEventListener("click", (e) => {
    const header = e.target.closest(".accordion-header");
    if (header) {
      const item = header.parentElement;
      const isActive = item.classList.contains("active");

      const parentAccordion = item.closest(".schedule-accordion");
      if (parentAccordion) {
        parentAccordion.querySelectorAll(".accordion-item").forEach((el) => {
          el.classList.remove("active");
        });
      }

      if (!isActive) {
        item.classList.add("active");
      }
    }
  });

  window.addEventListener("scroll", () => {
    if (DOM.header) {
      if (window.scrollY > 50) {
        DOM.header.classList.add("scrolled");
      } else {
        DOM.header.classList.remove("scrolled");
      }
    }
  });

  const sortButtons = document.querySelectorAll(".sort-btn");
  if (sortButtons.length > 0) {
    sortButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        sortButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        const currentSagaId = appState.ui.activeSagaId;

        if (currentSagaId) {
          const sagaData =
            appState.content.sagas[currentSagaId] || appState.content.ucm;
          if (sagaData) {
            applyAndDisplayFilters(currentSagaId);
          }
        }
      });
    });
  }
}

function handleFullscreenChange() {
  const lockOrientation = async () => {
    try {
      if (screen.orientation && typeof screen.orientation.lock === "function") {
        await screen.orientation.lock("landscape");
      }
    } catch (err) {
      console.error("No se pudo bloquear la orientación:", err);
    }
  };
  const unlockOrientation = () => {
    if (screen.orientation && typeof screen.orientation.unlock === "function") {
      screen.orientation.unlock();
    }
  };
  if (document.fullscreenElement) {
    lockOrientation();
  } else {
    unlockOrientation();
  }

  let _lastColumns = UI.getColumns();
  let _resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      const newCols = UI.getColumns();
      if (newCols !== _lastColumns) {
        _lastColumns = newCols;
        if (
          appState.ui.contentToDisplay &&
          appState.ui.contentToDisplay.length > 0
        ) {
          appState.ui.currentIndex = 0;
          setupPaginationControls();
          renderCurrentPage();
        }
      }
    }, 250);
  });
}

function setupPaginationControls() {
  // Contenedor de abajo (ya existente)
  let paginationContainer = document.getElementById("pagination-controls");
  if (!paginationContainer) {
    paginationContainer = document.createElement("div");
    paginationContainer.id = "pagination-controls";
    paginationContainer.className = "pagination-container";
    DOM.gridContainer.appendChild(paginationContainer);
  }

  // Contenedor de arriba (solo mobile)
  let paginationTop = document.getElementById("pagination-controls-top");
  if (!paginationTop) {
    paginationTop = document.createElement("div");
    paginationTop.id = "pagination-controls-top";
    paginationTop.className = "pagination-container pagination-container--top";
    DOM.gridContainer.insertBefore(
      paginationTop,
      DOM.gridContainer.querySelector(".grid"),
    );
  }
}

async function changePage(direction) {
  const totalPages = Math.ceil(
    appState.ui.contentToDisplay.length / UI.ITEMS_PER_LOAD,
  );
  const newPage = appState.ui.currentIndex + direction;

  if (newPage >= 0 && newPage < totalPages) {
    appState.ui.currentIndex = newPage;

    const headerOffset = 80;
    const elementPosition = DOM.gridContainer.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
    window.scrollTo({ top: offsetPosition, behavior: "smooth" });

    showGridSkeletons(UI.ITEMS_PER_LOAD || 24);

    const start = appState.ui.currentIndex * UI.ITEMS_PER_LOAD;
    const end = start + UI.ITEMS_PER_LOAD;
    const nextItems = appState.ui.contentToDisplay.slice(start, end);

    const imagePromises = nextItems.map(([id, item]) =>
      preloadImage(item.poster),
    );

    try {
      await Promise.race([
        Promise.all(imagePromises),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    } catch (e) {
      console.warn("Tardó mucho en cargar página");
    }

    renderCurrentPage();
  }
}

function showGridSkeletons(count = 24) {
  const gridEl = DOM.gridContainer?.querySelector(".grid");
  if (!gridEl) return;
  gridEl.innerHTML = Array.from({ length: count })
    .map(() => '<div class="skeleton-card"></div>')
    .join("");
}

function renderCurrentPage() {
  const gridEl = DOM.gridContainer.querySelector(".grid");
  if (!gridEl) return;

  const start = appState.ui.currentIndex * UI.ITEMS_PER_LOAD;
  const end = start + UI.ITEMS_PER_LOAD;
  const itemsPage = appState.ui.contentToDisplay.slice(start, end);

  const activeFilter = document.querySelector(
    ".main-nav a.active, .mobile-nav a.active",
  )?.dataset.filter;

  // Si no hay skeletons previos, limpiar directamente
  const hasSkeleton = gridEl.querySelector(".skeleton-card");
  if (!hasSkeleton) gridEl.innerHTML = "";

  const skeletons = hasSkeleton
    ? [...gridEl.querySelectorAll(".skeleton-card")]
    : [];

  itemsPage.forEach(([id, item], index) => {
    let type = "movie";

    if (activeFilter === "series") {
      type = "series";
    } else if (activeFilter === "ucm") {
      if (item.type === "series" || appState.content.seriesEpisodes[id]) {
        type = "series";
      } else {
        type = "movie";
      }
    } else {
      if (
        appState.content.series[id] ||
        item.type === "series" ||
        item.type === "serie"
      ) {
        type = "series";
      }
    }

    const card = createMovieCardElement(id, item, type, "grid", false);
    card.style.opacity = "0";
    card.style.animationDelay = `${index * 40}ms`;

    if (skeletons[index]) {
      skeletons[index].replaceWith(card);
    } else {
      gridEl.appendChild(card);
    }

    // Fade-in tras un frame para que el navegador pinte primero
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        card.style.transition = "opacity 0.3s ease";
        card.style.opacity = "1";
      });
    });
  });

  // Limpiar skeletons sobrantes si la página tiene menos items que la anterior
  gridEl.querySelectorAll(".skeleton-card").forEach((s) => s.remove());

  updatePaginationUI();
}

function updatePaginationUI() {
  const totalPages = Math.ceil(
    appState.ui.contentToDisplay.length / UI.ITEMS_PER_LOAD,
  );
  const currentPage = appState.ui.currentIndex + 1;

  const container = document.getElementById("pagination-controls");
  if (!container) return;

  if (totalPages <= 1) {
    container.style.display = "none";
    const containerTopEarly = document.getElementById(
      "pagination-controls-top",
    );
    if (containerTopEarly) containerTopEarly.style.display = "none";
    return;
  }
  container.style.display = "flex";

  /* POR esto: */
  // 1 … [prev] [current] [next] … última  (ventana dinámica)
  const delta = 1; // páginas a cada lado del actual
  const range = [];

  for (
    let p = Math.max(2, currentPage - delta);
    p <= Math.min(totalPages - 1, currentPage + delta);
    p++
  ) {
    range.push(p);
  }

  let html = "";

  // Primera siempre
  html += `<button class="catalog-page-pill ${currentPage === 1 ? "active" : ""}" data-page="1">1</button>`;

  if (range[0] > 2) html += `<span class="catalog-page-dots">…</span>`;

  for (const p of range) {
    html += `<button class="catalog-page-pill ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>`;
  }

  if (range[range.length - 1] < totalPages - 1)
    html += `<span class="catalog-page-dots">…</span>`;

  // Última siempre (si hay más de 1 página)
  if (totalPages > 1) {
    html += `<button class="catalog-page-pill ${currentPage === totalPages ? "active" : ""}" data-page="${totalPages}">${totalPages}</button>`;
  }

  container.innerHTML = html;

  container.querySelectorAll(".catalog-page-pill[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = parseInt(btn.dataset.page) - 1;
      const diff = target - appState.ui.currentIndex;
      if (diff !== 0) changePage(diff);
    });
  });

  const containerTop = document.getElementById("pagination-controls-top");
  if (containerTop) {
    containerTop.style.display =
      window.innerWidth <= 767 ? container.style.display : "none";
    containerTop.innerHTML = html;
    containerTop
      .querySelectorAll(".catalog-page-pill[data-page]")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const target = parseInt(btn.dataset.page) - 1;
          const diff = target - appState.ui.currentIndex;
          if (diff !== 0) changePage(diff);
        });
      });
  }
}

function handleGlobalClick(event) {
  const profileContainer = document.getElementById("user-profile-container");
  const dropdown = document.getElementById("user-menu-dropdown");

  if (dropdown && dropdown.classList.contains("show")) {
    if (!profileContainer.contains(event.target)) {
      dropdown.classList.remove("show");
    }
  }

  const searchContainer = document.getElementById("search-container");
  const searchInput = document.getElementById("search-input");

  const removeHistoryBtn = event.target.closest(".btn-remove-history");

  if (removeHistoryBtn) {
    event.preventDefault();
    event.stopPropagation();

    const entryKey = removeHistoryBtn.dataset.key;

    if (entryKey) {
      openConfirmationModal(
        "Borrar del Historial",
        "¿Quieres eliminar este título de tu historial de reproducción?",
        () => removeFromHistory(entryKey),
      );
    }
    return;
  }
}

function preloadHeroImages(movieIds) {
  movieIds.forEach((movieId) => {
    const movieData = appState.content.movies[movieId];
    if (!movieData) return;
    const imagesToPreload = [
      { type: "banner", url: movieData.banner },
      { type: "poster", url: movieData.poster },
    ];
    imagesToPreload.forEach(({ type, url }) => {
      if (!url) return;
      const img = new Image();
      img.onload = () => {
        const key = `${movieId}_${type}`;
        appState.hero.preloadedImages.set(key, url);
      };
      img.src = url;
    });
  });
}

// ===========================================================
// BENTO HERO — Paso 4
// Reemplaza setupHero, startHeroInterval, changeHeroMovie,
// generateCarousels y createCarouselSection.
// Los IDs #hero-section y #carousel-container se mantienen
// intactos para que switchView() siga funcionando.
// ===========================================================

// ── Helpers de fecha ────────────────────────────────────────
function _bentoLatest(obj, type) {
  // Devuelve el item más reciente de un objeto {id: data}
  if (!obj) return null;
  const entries = Object.entries(obj);
  if (!entries.length) return null;
  entries.sort((a, b) => {
    const tsA = getLatestUpdateTimestamp(a[0], a[1], type);
    const tsB = getLatestUpdateTimestamp(b[0], b[1], type);
    return tsB - tsA;
  });
  return { id: entries[0][0], data: entries[0][1] };
}

function _bentoDailyPick(movies, series, watchedIds = new Set(), topGenres = []) {
  const _badStates = ["vetada", "mantenimiento"];
  const _isPlayable = (d) =>
    !d.estado || !_badStates.includes(d.estado.toLowerCase().trim());

  const _adminOk = isAdminUser();
  const pool = [
    ...Object.entries(movies || {})
      .filter(([, d]) => _isPlayable(d) && (_adminOk || !isAdminContent(d)))
      .map(([id, d]) => ({ id, data: d, type: "movie" })),
    ...Object.entries(series || {})
      .filter(([, d]) => _isPlayable(d) && (_adminOk || !isAdminContent(d)))
      .map(([id, d]) => ({ id, data: d, type: "series" })),
  ];
  if (!pool.length) return null;

  const hoy = new Date();
  const seed =
    hoy.getFullYear() * 10000 + (hoy.getMonth() + 1) * 100 + hoy.getDate();

  // Excluir siempre lo que el usuario ya tiene en su historial.
  // Fallback al pool completo solo si vio casi todo (< 3 no vistos).
  const unwatched = watchedIds.size > 0
    ? pool.filter(({ id }) => !watchedIds.has(id))
    : pool;
  const candidates = unwatched.length >= 3 ? unwatched : pool;

  // Sin géneros: pick por semilla sobre los no vistos
  if (!topGenres.length) return candidates[seed % candidates.length];

  // Con géneros: scoring de afinidad sobre los candidatos
  // El género más visto vale más que el 5to
  const scoreItem = ({ data }) => {
    const genres = String(data.genres || data.generos || "")
      .toLowerCase()
      .split(/[;,]+/)
      .map((g) => g.trim())
      .filter(Boolean);
    return genres.reduce((acc, g) => {
      const rank = topGenres.indexOf(g);
      return acc + (rank >= 0 ? topGenres.length - rank : 0);
    }, 0);
  };

  const scored = candidates
    .map((item) => ({ item, score: scoreItem(item) }))
    .sort((a, b) => b.score - a.score);

  const highAffinity = scored.filter(({ score }) => score > 0).map(({ item }) => item);
  const rest        = scored.filter(({ score }) => score === 0).map(({ item }) => item);

  // Elegir con semilla diaria del pool de alta afinidad (o del resto si no hay)
  const pickPool = highAffinity.length ? highAffinity : rest;
  return pickPool[seed % pickPool.length];
}

// Extrae los top géneros del historial de Firebase del usuario
function _extractTopGenresFromHistory(snapshot, movies, series, limit = 5) {
  const genreCount = {};
  snapshot.forEach((child) => {
    const { contentId } = child.val();
    if (!contentId) return;
    const data = (movies || {})[contentId] || (series || {})[contentId];
    if (!data) return;
    String(data.genres || data.generos || "")
      .toLowerCase()
      .split(/[;,]+/)
      .map((g) => g.trim())
      .filter(Boolean)
      .forEach((g) => { genreCount[g] = (genreCount[g] || 0) + 1; });
  });
  return Object.entries(genreCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([g]) => g);
}

// ── Etiquetas de serie ────────────────────────────────────────
const _SERIE_STATUS_LABELS = {
  estreno: { text: "Estreno", dot: "#22c55e" },
  nuevo_capitulo: { text: "Nuevo capítulo", dot: "#f59e0b" },
  nueva_temporada: { text: "Nueva temporada", dot: "#3b82f6" },
};

function _bentoSideTypeHTML(data, type, id) {
  if (type === "series") {
    // Determinar estado usando las mismas funciones que usan las tarjetas
    let info;
    if (id) {
      const isNew = isDateRecent(data.date_added);
      const hasNewSeason = hasRecentSeasonFromPosters(id);
      const hasNewEp = hasRecentEpisodes(id);

      if (isNew) {
        info = { text: "Estreno", dot: "#22c55e" };
      } else if (hasNewSeason) {
        info = { text: "Nueva temporada", dot: "#3b82f6" };
      } else if (hasNewEp) {
        info = { text: "Nuevo cap.", dot: "#f59e0b" };
      }
    }
    // Fallback: campo del backend o "Serie"
    if (!info) {
      const status = data.seriesStatus || data.series_status;
      info = _SERIE_STATUS_LABELS[status] || {
        text: "Serie",
        dot: "var(--accent-color)",
      };
    }

    const dot = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${info.dot};margin-right:6px;vertical-align:middle;"></span>`;

    // Detalle: no mostrar cuando es estreno o nueva temporada
    const _isNewSeason = id ? hasRecentSeasonFromPosters(id) : false;
    const _isNewEntry = isDateRecent(data.date_added);
    let detail = data.seriesDetail || data.series_detail || "";
    if (!detail && id && !_isNewSeason && !_isNewEntry) {
      try {
        const episodesData = (appState.content.seriesEpisodes || {})[id] || {};
        const seasonOrder =
          (appState.content.seasonOrder || {})[id] || Object.keys(episodesData);
        const totalSeasons = seasonOrder.length;
        if (totalSeasons > 0) {
          const lastKey = seasonOrder[totalSeasons - 1];
          const lastSeason = episodesData[lastKey];
          let epCount = 0;
          if (Array.isArray(lastSeason)) {
            epCount = lastSeason.filter((ep) => ep && ep.title).length;
          } else if (lastSeason && typeof lastSeason === "object") {
            epCount = Object.values(lastSeason).filter(
              (ep) => ep && ep.title,
            ).length;
          }
          if (epCount > 0) {
            const epPart = `Episodio ${epCount}`;
            detail =
              totalSeasons > 1 ? `Temp. ${totalSeasons} — ${epPart}` : epPart;
          }
        }
      } catch (_) {}
    }

    const sub = detail
      ? `<div style="font-size:0.62rem;color:rgba(255,255,255,0.75);margin-top:3px;letter-spacing:0.5px;font-weight:600;text-transform:none">${detail}</div>`
      : "";
    return { main: dot + info.text, sub };
  }
  return { main: "Película", sub: "" };
}

// ── Poblar panel principal ────────────────────────────────────
function _bentoPopulateMain(id, data, type) {
  const el = document.getElementById("bentoMain");
  if (!el) return;
  el.style.backgroundImage = `url('${data.banner || data.poster || ""}')`;

  // Logo o título
  const logo = document.getElementById("bentoLogo");
  const titleEl = document.getElementById("bentoTitleText");
  if (data.logoUrl) {
    setLogoSrc(logo, data.logoUrl);
    logo.alt = data.title;
    logo.style.display = "block";
    if (titleEl) titleEl.style.display = "none";
  } else {
    if (logo) logo.style.display = "none";
    if (titleEl) {
      titleEl.textContent = data.title;
      titleEl.style.display = "block";
    }
  }

  // Descripción
  const desc = document.getElementById("bentoDesc");
  if (desc) desc.textContent = data.synopsis || data.desc || "";

  // Rating: mostrar si hay reseñas
  const rating = document.getElementById("bentoRating");
  if (rating) {
    const avg = appState.content.averages?.[id];
    rating.textContent = avg ? `★ ${avg}` : `★ —`;
    rating.style.display = "inline-flex";
  }

  // Meta: serie → temporadas · caps · géneros | peli → año · duración · géneros
  const dur = document.getElementById("bentoDuration");
  const genres = document.getElementById("bentoGenres");

  if (type === "series") {
    const episodesData = appState.content.seriesEpisodes[id] || {};

    const totalSeasons = Object.keys(episodesData).length;
    let totalEpisodes = 0;
    Object.values(episodesData).forEach((season) => {
      if (Array.isArray(season)) {
        totalEpisodes += season.filter((ep) => ep && ep.title).length;
      } else if (typeof season === "object" && season !== null) {
        totalEpisodes += Object.values(season).filter(
          (ep) => ep && ep.title,
        ).length;
      }
    });

    const seasons = totalSeasons > 0 ? `${totalSeasons} temp.` : "";
    const eps = totalEpisodes > 0 ? `${totalEpisodes} caps.` : "";
    if (dur) dur.textContent = [seasons, eps].filter(Boolean).join(" · ");
    const bentoYearSeries = document.getElementById("bentoYear");
    if (bentoYearSeries) bentoYearSeries.textContent = data.year || "";
    const dotGenresSeries = document.querySelector(".bento-dot-genres");
    if (dotGenresSeries) dotGenresSeries.style.display = data.year ? "" : "none";
  } else {
    const year = data.year || "";
    const duration = data.duration || "";
    const bentoYear = document.getElementById("bentoYear");
    if (bentoYear) bentoYear.textContent = year;
    if (dur) dur.textContent = duration;
    const dotGenres = document.querySelector(".bento-dot-genres");
    const dotDuration = document.querySelector(".bento-dot-duration");
    if (dotDuration) dotDuration.style.display = duration ? "" : "none";
    if (dotGenres) dotGenres.style.display = year ? "" : "none";
  }

  if (genres) {
    const g = data.genres || data.genre;
    genres.textContent = Array.isArray(g)
      ? g.slice(0, 2).join(" · ")
      : typeof g === "string"
        ? g.replace(/;/g, " · ").split(" · ").slice(0, 2).join(" · ")
        : "";
  }

  // Tag: motivo por el que aparece en el bento
  const tagTextEl = document.getElementById("bentoTagText");
  const tagDot = document.querySelector("#bentoTag circle");
  if (tagTextEl) {
    if (type === "series") {
      const status = data.seriesStatus || data.series_status;
      const info = _SERIE_STATUS_LABELS[status];
      if (info) {
        tagTextEl.textContent = info.text;
        if (tagDot) tagDot.setAttribute("fill", info.dot);
      } else {
        tagTextEl.textContent = "Recomendación del día";
        if (tagDot) tagDot.setAttribute("fill", "var(--accent-color)");
      }
    } else {
      const status = data.seriesStatus || data.series_status;
      const info = _SERIE_STATUS_LABELS[status];
      if (info) {
        tagTextEl.textContent = info.text;
        if (tagDot) tagDot.setAttribute("fill", info.dot);
      } else {
        tagTextEl.textContent = "Recomendación del día";
        if (tagDot) tagDot.setAttribute("fill", "var(--accent-color)");
      }
    }
  }

  // Botones
  const playBtn = document.getElementById("bentoPlayBtn");
  playBtn.onclick = async () => {
    const player = await getPlayerModule();
    if (type === "series") {
      // Primero abrir la vista de detalle y luego reproducir
      await openSeriesDetailView(id);
      setTimeout(() => player.playSeriesInDetailView(id), 100);
    } else {
      // Primero abrir la vista de detalle (donde vive el contenedor del player)
      await openDetailsModal(id, type);
      setTimeout(() => player.openPlayerModal(id, data.title), 100);
    }
  };
  const infoBtn = document.getElementById("bentoInfoBtn");
  if (infoBtn) infoBtn.onclick = () => openDetailsModal(id, type);

  // ── Espejo en hero móvil ──────────────────────────────────────
  _populateMobileHero(id, data, type);
}

function _populateMobileHero(id, data, type) {
  const banner = document.getElementById("mobileHeroBanner");
  if (!banner) return;

  // ── Backdrop (lado derecho) ──────────────────────────────────
  banner.style.backgroundImage = `url('${data.banner || data.poster || ""}')`;

  // ── Poster (lado izquierdo) ──────────────────────────────────
  const poster = document.getElementById("mobileHeroPoster");
  if (poster) {
    poster.src = data.poster || data.image || data.banner || "";
    poster.alt = data.title || "";
  }

  // ── Logo o título ────────────────────────────────────────────
  const logo = document.getElementById("mobileHeroLogo");
  const titleEl = document.getElementById("mobileHeroTitle");
  if (logo) {
    if (data.logoUrl) {
      setLogoSrc(logo, data.logoUrl);
      logo.alt = data.title || "";
      logo.style.display = "block";
      if (titleEl) titleEl.style.display = "none";
    } else {
      logo.style.display = "none";
      if (titleEl) {
        titleEl.textContent = data.title || "";
        titleEl.style.display = "block";
      }
    }
  }

  // ── Año / tipo ───────────────────────────────────────────────
  const yearEl = document.getElementById("mobileHeroYear");
  if (yearEl) {
    if (type === "series") {
      const episodesData = appState.content.seriesEpisodes[id] || {};
      const totalSeasons = Object.keys(episodesData).length;
      yearEl.textContent =
        totalSeasons > 0
          ? `Serie · ${totalSeasons} temporada${totalSeasons > 1 ? "s" : ""}`
          : "Serie";
    } else {
      yearEl.textContent = data.year ? `(${data.year})` : "";
    }
  }

  // ── Anillo de puntuación ─────────────────────────────────────
  const ratingEl = document.getElementById("mobileHeroRating");
  const ringFill = document.getElementById("mhRingFill");
  const avg = appState.content.averages?.[id];
  if (avg) {
    // avg es sobre 5 → convertir a porcentaje sobre 100
    const pct = Math.min(100, Math.round((parseFloat(avg) / 5) * 100));
    if (ratingEl) ratingEl.textContent = `${pct}%`;
    if (ringFill) {
      // Circunferencia con r=15.9 ≈ 100 → dasharray directo
      ringFill.style.strokeDasharray = `${pct} ${100 - pct}`;
      // Color según puntuación
      ringFill.style.stroke =
        pct >= 70 ? "#21d07a" : pct >= 45 ? "var(--accent-color)" : "#d2222d";
    }
  } else {
    if (ratingEl) ratingEl.textContent = "—";
    if (ringFill) ringFill.style.strokeDasharray = "0 100";
  }

  // ── Descripción ──────────────────────────────────────────────
  const desc = document.getElementById("mobileHeroDesc");
  if (desc) desc.textContent = data.synopsis || data.desc || "";

  // ── Meta: duración y géneros ─────────────────────────────────
  const dur = document.getElementById("mobileHeroDuration");
  const genres = document.getElementById("mobileHeroGenres");
  if (dur) {
    if (type === "series") {
      const episodesData = appState.content.seriesEpisodes[id] || {};
      let totalEps = 0;
      Object.values(episodesData).forEach((s) => {
        if (Array.isArray(s)) totalEps += s.filter((ep) => ep?.title).length;
      });
      dur.textContent = totalEps > 0 ? `${totalEps} eps.` : "";
    } else {
      dur.textContent = data.duration || "";
    }
  }
  if (genres) {
    const g = data.genres || data.genre;
    genres.textContent = Array.isArray(g)
      ? g.slice(0, 2).join(" · ")
      : typeof g === "string"
        ? g.replace(/;/g, " · ").split(" · ").slice(0, 2).join(" · ")
        : "";
  }

  // ── Tag pill ─────────────────────────────────────────────────
  const tagText = document.getElementById("mobileHeroTagText");
  if (tagText) {
    const status = data.seriesStatus || data.series_status;
    const info = _SERIE_STATUS_LABELS[status];
    tagText.textContent = info ? info.text : "Recomendación del día";
  }

  // ── Botones ──────────────────────────────────────────────────
  const playBtn = document.getElementById("mobileHeroPlayBtn");
  if (playBtn) {
    playBtn.onclick = async () => {
      const player = await getPlayerModule();
      if (type === "series") {
        // Abrir vista de detalle (el usuario puede ver info y luego play)
        openSeriesDetailView(id);
      } else {
        // Primero abrir la vista de detalle donde vive el contenedor del player
        await openDetailsModal(id, type);
        setTimeout(() => player.openPlayerModal(id, data.title || ""), 100);
      }
    };
  }
  const infoBtn = document.getElementById("mobileHeroInfoBtn");
  if (infoBtn) infoBtn.onclick = () => openDetailsModal(id, type);
}

// ── Poblar panel lateral ──────────────────────────────────────
function _bentoPopulateSide(sideId, typeId, titleId, id, data, type) {
  const el = document.getElementById(sideId);
  if (!el) return;
  el.style.backgroundImage = `url('${data.banner || data.poster || ""}')`;
  el.style.cursor = "pointer";
  el.onclick = () => openDetailsModal(id, type);

  const typeEl = document.getElementById(typeId);
  const titleEl = document.getElementById(titleId);
  if (typeEl) {
    const { main, sub } = _bentoSideTypeHTML(data, type, id);
    typeEl.innerHTML = main + sub;
  }
  if (titleEl) titleEl.textContent = data.title || "";
}

// ── Cache del pick diario ─────────────────────────────────────
// El pick se calcula una vez y se guarda en localStorage con clave
// bento_pick_YYYYMMDD (invitado) o bento_pick_{uid}_YYYYMMDD (usuario).
// Al día siguiente la clave no coincide → se recalcula automáticamente.
//
// Esto evita que agregar/quitar contenido al catálogo durante el día
// cambie la recomendación (pool.length cambia → seed%pool cambia).

function _bentoDayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}${mm}${dd}`;
}

function _getBentoCachedPick(uid, movies, series) {
  const key = `bento_pick_${uid || "guest"}_${_bentoDayStr()}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { id, type } = JSON.parse(raw);
    const data = type === "movie" ? movies[id] : series[id];
    return data ? { id, data, type } : null; // null si el contenido fue borrado
  } catch (_) {
    return null;
  }
}

function _setBentoCachedPick(uid, pick) {
  const today = _bentoDayStr();
  const key   = `bento_pick_${uid || "guest"}_${today}`;
  try {
    // Limpiar claves de días anteriores para no acumular basura en localStorage
    Object.keys(localStorage)
      .filter((k) => k.startsWith("bento_pick_") && !k.endsWith(`_${today}`))
      .forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(key, JSON.stringify({ id: pick.id, type: pick.type }));
  } catch (_) {}
}

// ── setupHero → initBento ─────────────────────────────────────
function setupHero() {
  clearInterval(appState.ui.heroInterval);
  if (!DOM.heroSection) return;

  const movies = appState.content.movies || {};
  const series = appState.content.series || {};

  // ── Panel principal ──────────────────────────────────────────
  // 1. Intentar mostrar el pick ya cacheado del día (invitado).
  //    Si existe, no se recalcula aunque el catálogo haya cambiado.
  const guestCached = _getBentoCachedPick(null, movies, series);
  if (guestCached) {
    _bentoPopulateMain(guestCached.id, guestCached.data, guestCached.type);
  } else {
    // Primera carga del día: calcular y cachear
    const pick = _bentoDailyPick(movies, series);
    if (pick) {
      _bentoPopulateMain(pick.id, pick.data, pick.type);
      _setBentoCachedPick(null, pick);
    }
  }

  // 2. Si hay usuario logueado, verificar su cache personal.
  //    Solo consulta Firebase si no hay cache del día para ese usuario.
  const user = auth.currentUser;
  if (user) {
    const userCached = _getBentoCachedPick(user.uid, movies, series);
    if (userCached) {
      // Ya tiene su pick personal del día → mostrarlo directo, sin Firebase
      _bentoPopulateMain(userCached.id, userCached.data, userCached.type);
    } else {
      // Primera carga del día con este usuario → calcular pick personal y cachearlo
      db.ref(`users/${user.uid}/history`)
        .once("value")
        .then((snap) => {
          if (!snap.exists()) return;
          const watchedIds = new Set();
          snap.forEach((child) => {
            const { contentId } = child.val();
            if (contentId) watchedIds.add(contentId);
          });
          // Pasar siempre watchedIds — _bentoDailyPick excluye vistos
          // aunque no haya géneros identificables
          const topGenres = _extractTopGenresFromHistory(snap, movies, series);
          const personalPick = _bentoDailyPick(movies, series, watchedIds, topGenres);
          if (personalPick) {
            _bentoPopulateMain(personalPick.id, personalPick.data, personalPick.type);
            _setBentoCachedPick(user.uid, personalPick);
          }
        })
        .catch(() => {}); // si falla Firebase, queda el pick de invitado
    }
  }

  // Panel lado 1: última película
  const latestMovie = _bentoLatest(movies, "movie");
  if (latestMovie)
    _bentoPopulateSide(
      "bentoSide1",
      "bentoSide1Type",
      "bentoSide1Title",
      latestMovie.id,
      latestMovie.data,
      "movie",
    );

  // Panel lado 2: última serie
  const latestSerie = _bentoLatest(series, "series");
  if (latestSerie)
    _bentoPopulateSide(
      "bentoSide2",
      "bentoSide2Type",
      "bentoSide2Title",
      latestSerie.id,
      latestSerie.data,
      "series",
    );
}

// ── SEARCH OVERLAY MÓVIL ─────────────────────────────────────
window.toggleMobileSearch = function () {
  const overlay = document.getElementById("mobileSearchOverlay");
  if (!overlay) return;
  const isOpening = !overlay.classList.contains("open");
  overlay.classList.toggle("open");
  if (isOpening) {
    setTimeout(() => {
      document.getElementById("mobileSearchInput")?.focus();
    }, 350);
  } else {
    // Al cerrar, limpiar búsqueda
    const mInput = document.getElementById("mobileSearchInput");
    if (mInput) mInput.value = "";
    const mResults = document.getElementById("mobile-search-results");
    if (mResults) { mResults.innerHTML = ""; mResults.style.display = "none"; }
    if (DOM.searchInput) {
      DOM.searchInput.value = "";
      DOM.searchInput.dispatchEvent(new Event("input"));
    }
  }
};

// ── BOTTOM TAB BAR ───────────────────────────────────────────
window.switchMobileTab = function (filter) {
  // Actualizar estado visual de los tabs
  document.querySelectorAll(".mobile-tab-item").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === filter);
  });
  // Reutilizar la lógica de navegación existente
  switchView(filter);
  // Limpiar búsqueda móvil si estaba abierta
  const overlay = document.getElementById("mobileSearchOverlay");
  if (overlay?.classList.contains("open")) toggleMobileSearch();
};

// Sincronizar input móvil con la lógica de búsqueda existente
document.addEventListener("DOMContentLoaded", () => {
  const mInput = document.getElementById("mobileSearchInput");
  if (!mInput) return;

  const mResults = document.getElementById("mobile-search-results");

  const norm = (str) =>
    String(str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, "");

  const closeMobileResults = () => {
    if (mResults) {
      mResults.innerHTML = "";
      mResults.style.display = "none";
    }
  };

  mInput.addEventListener("input", () => {
    // Sincronizar con el buscador de escritorio
    if (DOM.searchInput) {
      DOM.searchInput.value = mInput.value;
      DOM.searchInput.dispatchEvent(new Event("input"));
    }

    if (!mResults) return;
    const raw = mInput.value.trim();
    if (!raw) {
      closeMobileResults();
      return;
    }

    const searchTerm = norm(raw);
    let allContent = {
      ...appState.content.movies,
      ...appState.content.series,
    };
    if (appState.content.sagas)
      Object.values(appState.content.sagas).forEach(
        (s) => s && Object.assign(allContent, s),
      );
    if (appState.content.ucm) Object.assign(allContent, appState.content.ucm);

    const seenTitles = new Set();
    const results = Object.entries(allContent)
      .filter(([, item]) => isAdminUser() || !isAdminContent(item))
      .filter(([id, item]) => {
        const titleKey = norm(item.title || "").trim();
        if (seenTitles.has(titleKey)) return false;
        const isSerie =
          !!appState.content.series[id] ||
          !!appState.content.seriesEpisodes[id] ||
          item.type === "series" ||
          item.type === "serie";
        const match =
          norm(item.title || "").includes(searchTerm) ||
          (isSerie && norm(item.secondTitle || "").includes(searchTerm)) ||
          norm(id).includes(searchTerm);
        if (match) seenTitles.add(titleKey);
        return match;
      })
      .slice(0, 10);

    mResults.style.display = "block";
    renderSearchDropdown(mResults, results, norm, () => {
      closeMobileResults();
      toggleMobileSearch();
    });
  });
});

// startHeroInterval ya no rota (bento estático diario)
function startHeroInterval() {
  /* no-op: bento no rota */
}

// changeHeroMovie ya no se usa, se mantiene para compatibilidad
function changeHeroMovie(itemObj) {
  /* no-op: reemplazado por bento */
}

// ── generateCarousels → estilo bento ─────────────────────────
function generateCarousels() {
  const container = DOM.carouselContainer;
  if (!container) return;
  container.innerHTML = "";

  // ── Novedades (todas las pantallas) ──
  _initNovedadesSection();

  _bentoCreateCarousel("Películas", appState.content.movies, "movie");
  _bentoCreateCarousel("Series", appState.content.series, "series");
  _bentoCreateUniversosCarousel();
}

function _initNovedadesSection() {
  const container = DOM.carouselContainer;
  if (!container) return;

  const movies = appState.content.movies || {};
  const series = appState.content.series || {};
  const allEps = appState.content.seriesEpisodes || {};
  const allOrd = appState.content.seasonOrder || {};
  const allPosters = appState.content.seasonPosters || {};

  // ── Películas con date_added ─────────────────────────────────
  const movieItems = Object.entries(movies)
    .filter(([, d]) => d.date_added)
    .map(([id, d]) => ({
      id,
      data: d,
      type: "movie",
      typeLabel: "Estreno",
      typeColor: "#22c55e",
      sortDate: new Date(d.date_added),
      epThumb: d.banner || d.poster || "",
      epDetail: null,
      lastSeason: null,
      lastEpIdx: null,
    }));

  // ── Series: temporadas con date_added en PostersTemporadas ──
  const seriesItems = Object.entries(series).flatMap(([id, d]) => {
    const episodesData = allEps[id] || {};
    const seasonOrder = allOrd[id] || Object.keys(episodesData);
    const posters = allPosters[id] || {};

    const seasonEntries = Object.entries(posters)
      .filter(([, s]) => typeof s === "object" && s.date_added)
      .map(([seasonKey, s]) => ({
        seasonKey,
        date: new Date(s.date_added),
        seasonData: s,
      }));

    if (!seasonEntries.length) return [];

    return seasonEntries.map(({ seasonKey, date, seasonData }) => {
      const seasonNum = seasonOrder.indexOf(seasonKey) + 1;
      const seasonEps = episodesData[seasonKey];
      const epList = Array.isArray(seasonEps)
        ? seasonEps
        : Object.values(seasonEps || {});
      const firstEp = epList.find((ep) => ep?.title);
      const epThumb =
        d.banner ||
        d.poster ||
        seasonData.poster ||
        seasonData.posterUrl ||
        firstEp?.thumbnail ||
        firstEp?.poster ||
        "";

      const typeLabel = seasonNum > 1 ? "Nueva temp." : "Estreno";
      const typeColor = seasonNum > 1 ? "#3b82f6" : "#22c55e";

      // Calcular el índice del último episodio válido de esta temporada
      const lastEpIdxInSeason = epList.length > 0 ? epList.length - 1 : 0;

      return {
        id,
        data: d,
        type: "series",
        typeLabel,
        typeColor,
        sortDate: date,
        epThumb,
        epDetail: null,
        lastSeason: seasonKey,
        lastEpIdx: lastEpIdxInSeason,
      };
    });
  });

  // ── Series: nuevos capítulos con releaseDate (sin nueva temporada) ──
  // Agrupa por serie las temporadas que ya aparecen en seriesItems para no duplicar
  const seriesWithNewSeason = new Set(
    seriesItems
      .filter((item) => isDateRecent(item.sortDate))
      .filter((item) => isAdminUser() || !isAdminContent(item.data))
      .map((item) => item.id),
  );

  const newEpisodeItems = Object.entries(series).flatMap(([id, d]) => {
    // Si esta serie ya tiene una temporada nueva en la fila, no la duplicamos
    const seriesStatus = (
      d.seriesStatus ||
      d.series_status ||
      ""
    ).toLowerCase();
    if (seriesWithNewSeason.has(id) && seriesStatus !== "nuevo_capitulo")
      return [];

    const episodesData = allEps[id] || {};
    const seasonOrder = allOrd[id] || Object.keys(episodesData);
    const posters = allPosters[id] || {};

    // Buscar el capítulo más reciente con releaseDate en toda la serie
    let latestEp = null;
    let latestDate = null;
    let latestSeasonKey = null;
    let latestEpIdx = null;

    for (const seasonKey of seasonOrder) {
      const seasonEps = episodesData[seasonKey];
      if (!seasonEps) continue;
      const epList = Array.isArray(seasonEps)
        ? seasonEps
        : Object.values(seasonEps);

      epList.forEach((ep, idx) => {
        if (!ep?.releaseDate) return;

        // 🛠️ TRADUCTOR DE FECHAS (Convierte DD/MM/YYYY a MM/DD/YYYY para JS)
        let dateString = ep.releaseDate;
        if (typeof dateString === "string" && dateString.includes("/")) {
          const spaceSplit = dateString.trim().split(" ");
          const dmy = spaceSplit[0].split("/"); // Separa [Día, Mes, Año]

          // Si tiene 3 partes, lo rearmamos al estilo gringo para que JavaScript no llore
          if (dmy.length === 3) {
            dateString =
              `${dmy[1]}/${dmy[0]}/${dmy[2]} ${spaceSplit[1] || ""}`.trim();
          }
        }

        const epDate = new Date(dateString);

        // Si la fecha sigue siendo inválida, la saltamos
        if (isNaN(epDate.getTime())) return;

        if (!latestDate || epDate > latestDate) {
          latestDate = epDate;
          latestEp = ep;
          latestSeasonKey = seasonKey;
          latestEpIdx = idx;
        }
      });
    }

    // Fallback: si ningún ep tiene releaseDate, usar el último ep de la última temporada
    // y la fecha date_added de la serie como referencia
    if (!latestEp) {
      for (let i = seasonOrder.length - 1; i >= 0; i--) {
        const sk = seasonOrder[i];
        const sEps = episodesData[sk];
        if (!sEps) continue;
        const sList = Array.isArray(sEps) ? sEps : Object.values(sEps);
        const lastIdx = [...sList]
          .map((ep, i) => ({ ep, i }))
          .reverse()
          .find(({ ep }) => ep?.title);
        if (lastIdx) {
          latestEp = lastIdx.ep;
          latestSeasonKey = sk;
          latestEpIdx = lastIdx.i;
          latestDate = d.date_added ? new Date(d.date_added) : null;
          break;
        }
      }
    }

    const isNewByStatus = seriesStatus === "nuevo_capitulo";
    if (!latestEp) return [];

    // Si el ep más reciente tiene releaseDate propio, siempre aparece
    // en Novedades (sin expiración de días) — la fecha solo ordena.
    // Si vino del fallback (sin releaseDate), sí aplicamos isDateRecent
    // para no mostrar series viejas sin caps nuevos.
    const epHasOwnReleaseDate = !!latestEp.releaseDate;
    if (!epHasOwnReleaseDate && !isDateRecent(latestDate) && !isNewByStatus)
      return [];

    if (!latestDate) latestDate = new Date(d.date_added || Date.now());

    const seasonNum = seasonOrder.indexOf(latestSeasonKey) + 1; // ← sigue directo aquí
    const epNum = latestEpIdx + 1;
    const posterData = posters[latestSeasonKey];
    const epThumb =
      latestEp.thumbnail ||
      latestEp.poster ||
      posterData?.poster ||
      posterData?.posterUrl ||
      d.banner ||
      d.poster ||
      "";

    return [
      {
        id,
        data: d,
        type: "series",
        typeLabel: isDateRecent(d.date_added) ? "Nueva serie" : "Nuevo cap.",
        typeColor: isDateRecent(d.date_added) ? "#22c55e" : "#f59e0b",
        sortDate: latestDate,
        epThumb,
        epDetail:
          seasonOrder.length > 1
            ? `T${seasonNum} · E${epNum}`
            : `Episodio ${epNum}`,
        lastSeason: latestSeasonKey,
        latestEpIdx,
      },
    ];
  });

  // ── Universos (sagas) con date_added en sagas_list ───────────
  const sagasList = appState.content.sagasList || [];
  const sagaItems = sagasList
    .filter((s) => s.date_added)
    .map((s) => ({
      id: s.id,
      data: { title: s.titulo || s.title || "" },
      type: "saga",
      typeLabel: "Universo",
      typeColor: "#a855f7",
      sortDate: new Date(s.date_added),
      epThumb: s.banner || "",
      epDetail: null,
      lastSeason: null,
      lastEpIdx: null,
    }));

  const all = [...movieItems, ...seriesItems, ...newEpisodeItems, ...sagaItems]
    .sort((a, b) => b.sortDate - a.sortDate)
    .slice(0, 10);

  if (!all.length) return;

  const block = document.createElement("div");
  block.className = "section-block";
  block.innerHTML = `
  <div class="section-header">
    <div class="section-title-group">
      <h2 class="section-title">Novedades</h2>
      <span class="section-count">${all.length} nuevas</span>
    </div>
    <div class="section-nav">
      <button class="scroll-btn" onclick="scrollRow('bento-row-novedades',-1)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <button class="scroll-btn" onclick="scrollRow('bento-row-novedades',1)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </div>
  </div>`;

  const row = document.createElement("div");
  row.className = "cards-wide";
  row.id = "bento-row-novedades";

  all.forEach(
    ({
      id,
      data,
      type,
      typeLabel,
      typeColor,
      epThumb,
      epDetail,
      lastSeason,
      lastEpIdx,
    }) => {
      const isSeries = type === "series";
      const bgImage = epThumb || data.banner || data.poster || "";
      const labelHTML = `<span style="display:inline-flex;align-items:center;gap:5px">
        <span style="width:6px;height:6px;border-radius:50%;background:${typeColor};display:inline-block"></span>
        ${typeLabel}
      </span>`;
      const subLabel =
        isSeries && epDetail
          ? `<div style="font-size:0.6rem;color:rgba(255,255,255,0.6);margin-top:2px;font-weight:600">${epDetail}</div>`
          : "";

      const card = document.createElement("div");
      card.className = "card-wide";
      card.style.backgroundImage = `url('${bgImage}')`;
      card.style.cursor = "pointer";
      card.innerHTML = `
      <div class="card-wide-content">
        <div>
          <div class="card-wide-type" style="color:${typeColor}">${labelHTML}</div>
          <div class="card-wide-title">${data.title || ""}</div>
          ${subLabel}
        </div>
        <div class="card-wide-play">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M5 3l14 9-14 9V3z"/></svg>
        </div>
      </div>`;

      card.onclick = async () => {
        if (type === "saga") {
          appState.ui._fromUniverse = id;
          switchView("sagas");
        } else if (isSeries && lastSeason != null && lastEpIdx != null) {
          await openSeriesDetailView(id);
          const player = await getPlayerModule();
          player.playEpisodeInDetailView(id, lastSeason, lastEpIdx);
        } else if (!isSeries) {
          const href = data.link || data.href;
          if (href) window.location.href = href;
          else openDetailsModal(id, "movie");
        } else {
          openDetailsModal(id, "series");
        }
      };

      row.appendChild(card);
    },
  );

  block.appendChild(row);
  container.appendChild(block);
}

function _bentoCreateUniversosCarousel() {
  const sagas = appState.content.sagasList;
  if (!sagas || !sagas.length) return;
  const container = DOM.carouselContainer;

  // Ordenar por recientes (orden inverso al campo order)
  const sorted = [...sagas]
    .sort((a, b) => (Number(b.order) || 0) - (Number(a.order) || 0))
    .slice(0, 8);
  const rowId = "bento-row-universos";

  const block = document.createElement("div");
  block.className = "section-block";
  block.innerHTML = `
    <div class="section-header">
      <div class="section-title-group">
        <h2 class="section-title">Universos</h2>
        <span class="section-count">Últimos agregados</span>
      </div>
      <div class="section-nav">
        <button class="scroll-btn" onclick="scrollRow('${rowId}',-1)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button class="scroll-btn" onclick="scrollRow('${rowId}',1)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
    </div>`;

  const row = document.createElement("div");
  row.className = "univ-row";
  row.id = rowId;

  sorted.forEach((saga) => {
    const card = document.createElement("div");
    card.className = "univ-card";
    if (saga.color) card.style.setProperty("--uc-color", saga.color);
    if (saga.banner) card.style.backgroundImage = `url('${saga.banner}')`;
    card.onclick = () => {
      appState.ui._fromUniverse = saga.id;
      switchView("sagas");
    };

    const logoWrap = document.createElement("div");
    logoWrap.className = "univ-card-logo";
    if (saga.logo) {
      const img = document.createElement("img");
      img.src = saga.logo;
      img.alt = saga.titulo || saga.title || "";
      logoWrap.appendChild(img);
    } else {
      logoWrap.innerHTML = `<span style="color:#fff;font-weight:900;font-size:1rem;text-align:center">${saga.titulo || saga.title || ""}</span>`;
    }

    const badge = document.createElement("div");
    badge.className = "univ-card-badge";
    badge.textContent = "Ver universo";

    card.appendChild(logoWrap);
    card.appendChild(badge);

    if (isDateRecent(saga.date_added)) {
      const ribbon = document.createElement("div");
      ribbon.className = "badges-container";
      ribbon.innerHTML = `<div class="new-episode-badge badge-estreno">NUEVO</div>`;
      card.appendChild(ribbon);
    }

    row.appendChild(card);
  });

  block.appendChild(row);

  const divider = document.createElement("div");
  divider.className = "section-divider";
  container.appendChild(divider);
  container.appendChild(block);
}

function _bentoCreateCarousel(title, dataSource, type) {
  if (!dataSource || !Object.keys(dataSource).length) return;
  const container = DOM.carouselContainer;

  const entries = Object.entries(dataSource).sort((a, b) => {
    const tA = getLatestUpdateTimestamp(a[0], a[1], type);
    const tB = getLatestUpdateTimestamp(b[0], b[1], type);
    return tB - tA;
  });

  // Sección wrapper
  const block = document.createElement("div");
  block.className = "section-block";

  // Header con título + botones de scroll
  const rowId = `bento-row-${type}`;
  block.innerHTML = `
    <div class="section-header">
      <div class="section-title-group">
        <h2 class="section-title">${title}</h2>
        <span class="section-count">${entries.length} disponibles</span>
      </div>
      <div class="section-nav">
        <button class="scroll-btn" onclick="scrollRow('${rowId}',-1)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button class="scroll-btn" onclick="scrollRow('${rowId}',1)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
    </div>`;

  const row = document.createElement("div");
  row.className = "cards-row";
  row.id = rowId;

  entries.slice(0, 11).forEach(([id, item]) => {
    const card = document.createElement("div");
    card.className = "card-poster";
    card.style.backgroundImage = `url('${item.poster || item.banner || ""}')`;

    // ── Etiquetas (estreno / nueva temp / nuevo cap) ──────────
    let badgeHTML = "";
    const seriesStatus = (
      item.seriesStatus ||
      item.series_status ||
      ""
    ).toLowerCase();
    const isNew = isDateRecent(item.date_added);

    if (type === "series") {
      const hasNewSeason = hasRecentSeasonFromPosters(id);
      const hasNewEp = hasRecentEpisodes(id);
      if (isNew || seriesStatus === "estreno")
        badgeHTML += `<div class="new-episode-badge badge-estreno">ESTRENO</div>`;
      if (hasNewSeason || seriesStatus === "nueva_temporada")
        badgeHTML += `<div class="new-episode-badge badge-season">NUEVA TEMP</div>`;
      if ((hasNewEp && !hasNewSeason) || seriesStatus === "nuevo_capitulo")
        badgeHTML += `<div class="new-episode-badge badge-episode">NUEVO CAP</div>`;
    } else {
      if (item.estado && item.estado.toLowerCase() === "vetada") {
        badgeHTML += `<div class="new-episode-badge badge-vetada">VETADA</div>`;
      } else if (item.estado && item.estado.toLowerCase() === "mantenimiento") {
        badgeHTML += `<div class="new-episode-badge badge-mantenimiento">MANT.</div>`;
      } else if (item.estado && item.estado.trim() !== "") {
        badgeHTML += `<div class="new-episode-badge badge-proximamente">PRÓXIMO</div>`;
      } else if (isNew || seriesStatus === "estreno") {
        badgeHTML += `<div class="new-episode-badge badge-estreno">ESTRENO</div>`;
      }
    }

    const ribbonHTML = badgeHTML
      ? `<div class="badges-container">${badgeHTML}</div>`
      : "";

    let infoHTML = "";
    if (type === "series") {
      const epData = appState.content.seriesEpisodes[id] || {};
      const totalSeasons = Object.keys(epData).length;
      let totalEps = 0;
      Object.values(epData).forEach((s) => {
        totalEps += Array.isArray(s)
          ? s.filter((e) => e && e.title).length
          : Object.values(s || {}).filter((e) => e && e.title).length;
      });
      const parts = [];
      if (!item.miniserie && totalSeasons > 1)
        parts.push(`${totalSeasons} temp.`);
      if (totalEps > 0) parts.push(`${totalEps} caps.`);
      if (item.miniserie) parts.unshift("Miniserie");
      if (parts.length)
        infoHTML = `<div class="card-overlay-info">${parts.join(" · ")}</div>`;
    } else {
      const parts = [];
      if (item.year) parts.push(item.year);
      if (item.duration) parts.push(item.duration);
      if (parts.length)
        infoHTML = `<div class="card-overlay-info">${parts.join(" · ")}</div>`;
    }
    card.innerHTML = `${ribbonHTML}<div class="card-overlay">${infoHTML}</div>`;
    card.onclick = () => openDetailsModal(id, type);
    row.appendChild(card);
  });

  block.appendChild(row);

  // Divider antes de cada sección
  const divider = document.createElement("div");
  divider.className = "section-divider";
  container.appendChild(divider);
  container.appendChild(block);
}

// Scroll de filas (usado por scroll-btn en carruseles y universos)
window.scrollRow = function scrollRow(id, dir) {
  const el = document.getElementById(id);
  if (el) el.scrollBy({ left: dir * 420, behavior: "smooth" });
};

// Alias para compatibilidad interna
function createCarouselSection(title, dataSource) {
  const type = title.toLowerCase().includes("serie") ? "series" : "movie";
  _bentoCreateCarousel(title, dataSource, type);
}

/* ── SEARCH DROPDOWN ─────────────────────────────────────── */
function setupSearch() {
  if (!DOM.searchInput) return;

  const norm = (str) =>
    String(str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, "");

  // Crear el dropdown una sola vez
  let dropdown = document.getElementById("search-dropdown");
  if (!dropdown) {
    dropdown = document.createElement("div");
    dropdown.id = "search-dropdown";
    dropdown.className = "search-dropdown";
    const container = document.getElementById("search-container");
    if (container) container.appendChild(dropdown);
  }

  let debounceTimer = null;

  const closeDropdown = () => {
    dropdown.classList.remove("open");
    // Limpiar el innerHTML en el próximo tick para no cancelar
    // un click que ya está en curso sobre un resultado del dropdown.
    setTimeout(() => { dropdown.innerHTML = ""; }, 0);
  };

  DOM.searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const raw = DOM.searchInput.value.trim();
    if (!raw) {
      closeDropdown();
      return;
    }

    debounceTimer = setTimeout(() => {
      const searchTerm = norm(raw);

      let allContent = {
        ...appState.content.movies,
        ...appState.content.series,
      };
      if (appState.content.sagas)
        Object.values(appState.content.sagas).forEach(
          (s) => s && Object.assign(allContent, s),
        );
      if (appState.content.ucm) Object.assign(allContent, appState.content.ucm);

      const seenTitles = new Set();
      const results = Object.entries(allContent)
        .filter(([, item]) => isAdminUser() || !isAdminContent(item))
        .filter(([id, item]) => {
          const titleKey = norm(item.title || "").trim();
          if (seenTitles.has(titleKey)) return false;
          const isSerie =
            !!appState.content.series[id] ||
            !!appState.content.seriesEpisodes[id] ||
            item.type === "series" ||
            item.type === "serie";
          const match =
            norm(item.title || "").includes(searchTerm) ||
            (isSerie && norm(item.secondTitle || "").includes(searchTerm)) ||
            norm(id).includes(searchTerm);
          if (match) seenTitles.add(titleKey);
          return match;
        })
        .slice(0, 10);

      renderSearchDropdown(dropdown, results, norm, closeDropdown);
    }, 120);
  });

  DOM.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      DOM.searchInput.value = "";
      DOM.searchInput.blur();
      closeDropdown();
    }
  });

  // Usamos mousedown en lugar de click para detectar el intento de cierre
  // ANTES de que el blur del input cancele el click del resultado.
  // Si el mousedown es dentro del dropdown (sd-item), lo ignoramos para
  // que el click del row se complete normalmente.
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest("#search-container")) closeDropdown();
  });
}

function renderSearchDropdown(dropdown, results, norm, closeDropdown) {
  dropdown.innerHTML = "";

  if (results.length === 0) {
    dropdown.innerHTML = `<div class="sd-empty">Sin resultados</div>`;
    dropdown.classList.add("open");
    return;
  }

  const isSerie = (id, item) =>
    !!appState.content.series[id] ||
    !!appState.content.seriesEpisodes[id] ||
    item.type === "series" ||
    item.type === "serie";
  const movies = results.filter(([id, item]) => !isSerie(id, item));
  const series = results.filter(([id, item]) => isSerie(id, item));
  const rest = [];

  const renderGroup = (label, items) => {
    if (!items.length) return;
    const header = document.createElement("div");
    header.className = "sd-group-label";
    header.textContent = label;
    dropdown.appendChild(header);

    items.forEach(([id, item]) => {
      const isSerie =
        !!appState.content.series[id] ||
        !!appState.content.seriesEpisodes[id] ||
        item.type === "series" ||
        item.type === "serie";
      const row = document.createElement("div");
      row.className = "sd-item";

      let posterUrl = item.poster;
      if (typeof posterUrl === "object" && posterUrl?.posterUrl)
        posterUrl = posterUrl.posterUrl;
      if (!posterUrl) posterUrl = item.banner || "";

      row.innerHTML = `
        <div class="sd-poster">
          ${posterUrl ? `<img src="${posterUrl}" alt="" loading="lazy">` : `<div class="sd-poster-placeholder"><i class="fas fa-film"></i></div>`}
        </div>
        <div class="sd-info">
          <span class="sd-title">${item.title || id}</span>
          ${item.year || item.anio ? `<span class="sd-year">${item.year || item.anio}</span>` : ""}
        </div>
        <span class="sd-type-badge">${isSerie ? "Serie" : "Película"}</span>
      `;

      row.addEventListener("click", () => {
        closeDropdown();
        DOM.searchInput.value = "";
        openDetailsModal(id, isSerie ? "series" : "movie");
      });

      dropdown.appendChild(row);
    });
  };

  renderGroup("Películas", movies);
  renderGroup("Series", series);
  renderGroup("Universos", rest);

  dropdown.classList.add("open");
}

// Stub vacío para compatibilidad
function displaySearchResults(_results) {}

function generateContinueWatchingCarousel(snapshot) {
  const user = auth.currentUser;

  const existingCarousel = document.getElementById(
    "continue-watching-carousel",
  );
  if (existingCarousel) existingCarousel.remove();

  const carouselContainer = document.getElementById("carousel-container");
  if (!user || !carouselContainer || !snapshot.exists()) return;

  let historyItems = [];
  snapshot.forEach((child) => {
    historyItems.push({ key: child.key, ...child.val() });
  });
  historyItems.reverse();

  const SPECIAL_KEYWORDS = [
    "pelicula",
    "película",
    "especial",
    "tespecial",
    "movie",
    "special",
    "ova",
  ];
  const isSpecialSeason = (season) => {
    if (season == null) return false;
    const s = String(season).toLowerCase();
    return SPECIAL_KEYWORDS.some((kw) => s.includes(kw));
  };

  const seriesToShow = historyItems
    .filter((item) => item.type === "series" && !isSpecialSeason(item.season))
    .slice(0, 15);

  if (seriesToShow.length === 0) return;

  // Wrapper con nuevo sistema visual
  const carouselEl = document.createElement("div");
  carouselEl.id = "continue-watching-carousel";
  carouselEl.className = "section-block";

  const rowId = "cw-row";
  carouselEl.innerHTML = `
    <div class="section-header">
      <div class="section-title-group">
        <h2 class="section-title">Continuar Viendo</h2>
      </div>
      <div class="section-nav">
        <button class="scroll-btn" onclick="scrollRow('${rowId}',-1)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button class="scroll-btn" onclick="scrollRow('${rowId}',1)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
    </div>
    <div class="carousel-track cw-track" id="${rowId}"></div>
  `;

  const track = carouselEl.querySelector(`#${rowId}`);

  seriesToShow.forEach((historyItem) => {
    const seriesData = findContentData(historyItem.contentId);
    if (!seriesData) return;

    let episodeThumbnail = null;
    let episodeTitle = null;
    let episodeNombreEspecial = null;

    if (historyItem.season != null && historyItem.lastEpisode != null) {
      const seriesEpisodes =
        appState.content.seriesEpisodes[historyItem.contentId];
      if (seriesEpisodes?.[historyItem.season]?.[historyItem.lastEpisode]) {
        const ep = seriesEpisodes[historyItem.season][historyItem.lastEpisode];
        episodeThumbnail = ep.thumbnail || ep.poster;
        episodeTitle = ep.title;
        episodeNombreEspecial = ep.nombreEspecial || null;
      }
    }

    const totalSeasons = Object.keys(
      appState.content.seriesEpisodes[historyItem.contentId] || {},
    ).length;

    const card = createMovieCardElement(
      historyItem.contentId,
      seriesData,
      "series",
      "carousel",
      false,
      {
        source: "continuar-viendo",
        season: historyItem.season,
        lastEpisode: historyItem.lastEpisode,
        episodeThumbnail,
        episodeTitle,
        seriesTitle: seriesData.title,
        historyKey: historyItem.key,
        totalSeasons,
        nombreTemporadas: String(seriesData.nombreTemporadas || "").trim(),
        nombreEspecial: episodeNombreEspecial,
        progress: historyItem.progress,
      },
    );

    track.appendChild(card);
  });

  carouselContainer.prepend(carouselEl);
}

window.generateContinueWatchingCarousel = generateContinueWatchingCarousel;

function createContinueWatchingCard(itemData) {
  const card = document.createElement("div");
  card.className = "continue-watching-card";
  card.onclick = async () => {
    const player = await getPlayerModule();
    player.openPlayerToEpisode(
      itemData.contentId,
      itemData.season,
      itemData.episodeIndexToOpen,
    );
  };
  card.innerHTML = `
        <img src="${itemData.thumbnail}" class="cw-card-thumbnail" alt="">
        <div class="cw-card-overlay"></div>
        <div class="cw-card-info">
            <h4 class="cw-card-title">${itemData.title}</h4>
            <p class="cw-card-subtitle">${itemData.subtitle}</p>
        </div>
        <div class="cw-card-play-icon"><i class="fas fa-play"></i></div>
    `;
  return card;
}

function closeAllModals() {
  const seriesPage = document.getElementById("series-player-page");
  if (seriesPage && seriesPage.classList.contains("active")) {
    seriesPage.classList.remove(
      "active",
      "season-grid-view",
      "player-layout-view",
    );
    seriesPage.style.display = "none";
    if (appState?.player) appState.player.activeSeriesId = null;
    if (typeof switchView === "function")
      switchView(appState?.currentFilter || "all");
  }

  document.querySelectorAll(".modal.show").forEach((modal) => {
    modal.classList.remove("show");
    const iframe = modal.querySelector("iframe");
    if (iframe) iframe.src = "";

    // 🔥 Destruir ArtPlayer globalmente
    if (appState?.player?.activeCineInstance) {
      appState.player.activeCineInstance.destroy();
      appState.player.activeCineInstance = null;
    }
  });
  document.body.classList.remove("modal-open");

  if (
    typeof shared !== "undefined" &&
    shared.appState &&
    shared.appState.player
  ) {
    shared.appState.player.activeSeriesId = null;
    if (shared.appState.player.movieHistoryTimer) {
      clearTimeout(shared.appState.player.movieHistoryTimer);
      shared.appState.player.movieHistoryTimer = null;
    }
  }

  // pending_reload ya no se usa: smartRefreshAndPatch aplica los
  // cambios en vivo sin necesidad de recargar la página.
  localStorage.removeItem("pending_reload");
}

async function openDetailsModal(id, type, triggerElement = null) {
  try {
    let data = findContentData(id);
    if (!data) {
      if (appState.content.movies[id]) data = appState.content.movies[id];
      else if (appState.content.series[id]) data = appState.content.series[id];
      if (!data) {
        ErrorHandler.show(
          "content",
          "No se pudo cargar la información del título.",
        );
        return;
      }
    }
    id = data.id || id;

    if (appState.content.series[id])
      data = { ...data, ...appState.content.series[id] };

    const isSeries =
      type === "series" ||
      !!appState.content.series[id] ||
      !!appState.content.seriesEpisodes[id] ||
      data.type === "series" ||
      data.type === "serie";

    if (isSeries) {
      openSeriesDetailView(id);
      return;
    }

    const view = document.getElementById("detail-view");
    if (!view) return;

    // ── Ocultar catálogo ──────────────────────────────────────
    const main = document.querySelector("main");
    const heroSection = document.getElementById("hero-section");
    const carouselContainer = document.getElementById("carousel-container");
    const gridContainer = document.getElementById("full-grid-container");
    const sagasHub = document.getElementById("sagas-hub-container");
    if (main) main.style.display = "none";
    if (heroSection) heroSection.style.display = "none";
    if (carouselContainer) carouselContainer.style.display = "none";
    if (gridContainer) gridContainer.style.display = "none";
    if (sagasHub) sagasHub.style.display = "none";

    // ── Resetear reproductor ──────────────────────────────────
    const playerSection = document.getElementById("dv-player-section");
    const videoContainer = document.getElementById("dv-video-container");
    if (playerSection) {
      playerSection.style.display = "none";
      playerSection.style.opacity = "0";
    }
    if (videoContainer) videoContainer.innerHTML = "";
    if (appState?.player?.activeCineInstance) {
      appState.player.activeCineInstance.destroy();
      appState.player.activeCineInstance = null;
    }

    // ── Hero: fondo ───────────────────────────────────────────
    const hero = document.getElementById("dv-hero");
    const heroBanner = document.getElementById("dv-hero-banner");
    const bannerUrl =
      data.banner && data.banner.length > 5 ? data.banner : data.poster || "";
    if (heroBanner) heroBanner.style.backgroundImage = `url(${bannerUrl})`;

    // ── Logo o título ─────────────────────────────────────────
    const logoEl = document.getElementById("dv-logo");
    const titleEl = document.getElementById("dv-title");
    if (data.logoUrl) {
      if (logoEl) {
        setLogoSrc(logoEl, data.logoUrl);
        logoEl.style.display = "block";
      }
      if (titleEl) titleEl.style.display = "none";
    } else {
      if (logoEl) logoEl.style.display = "none";
      if (titleEl) {
        titleEl.textContent = data.title || "";
        titleEl.style.display = "block";
      }
    }

    // ── Géneros ───────────────────────────────────────────────
    const genresEl = document.getElementById("dv-genres");
    if (genresEl) {
      let genresVal = "";
      if (data.genres) {
        if (Array.isArray(data.genres)) genresVal = data.genres.join(", ");
        else if (typeof data.genres === "string")
          genresVal = data.genres.replace(/;/g, ", ");
      }
      genresEl.textContent = genresVal.toUpperCase();
    }

    // ── Título original ───────────────────────────────────────────
    const origTitleEl = document.getElementById("dv-orig-title");
    if (origTitleEl) {
      const _normStr = (s) =>
        String(s || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9\s]/g, "");
      const rawOrig = data.id || "";
      const showOrig =
        rawOrig && _normStr(rawOrig) !== _normStr(data.title || "");
      if (showOrig) {
        origTitleEl.textContent = rawOrig;
        origTitleEl.style.display = "";
      } else {
        origTitleEl.style.display = "none";
      }
    }

    // ── Rating ────────────────────────────────────────────────
    const ratingEl = document.getElementById("dv-rating");
    const avg = appState.content.averages?.[id];
    if (ratingEl) {
      ratingEl.textContent = avg ? `★ ${avg}` : `★ —`;
      ratingEl.style.display = "inline-flex";
    }

    // ── Año ───────────────────────────────────────────────────
    const yearEl = document.getElementById("dv-year");
    if (yearEl) yearEl.textContent = data.year || "";

    // ── Duración con tooltip ──────────────────────────────────
    const durationText = document.getElementById("dv-duration-text");
    const durationTooltip = document.getElementById("dv-duration-tooltip");
    const durationBadge = document.getElementById("dv-duration");
    const rawDuration = data.duration || data.duracion || "";
    if (rawDuration) {
      if (durationText) durationText.textContent = rawDuration;
      if (durationBadge) durationBadge.style.display = "inline-flex";
      // Calcular hora de término si el formato es HH:MM:SS o similar
      if (durationTooltip) {
        try {
          const parts = rawDuration
            .replace("h", ":")
            .replace("min", "")
            .replace(/\s/g, "")
            .split(":");
          if (parts.length >= 2) {
            const now = new Date();
            now.setHours(now.getHours() + parseInt(parts[0] || 0));
            now.setMinutes(now.getMinutes() + parseInt(parts[1] || 0));
            durationTooltip.textContent =
              "Termina aprox. a las " +
              now.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }) +
              " hrs";
          }
        } catch (e) {}
      }
    } else {
      if (durationBadge) durationBadge.style.display = "none";
    }

    // ── Toggle de idioma (solo si hay 2 idiomas) ──────────────
    const langToggle = document.getElementById("dv-lang-toggle");
    const hasMultiLang = !!(data.videoId_es && data.videoId_en);
    if (langToggle) {
      langToggle.style.display = hasMultiLang ? "flex" : "none";
      const langBadge = document.getElementById("dv-lang-badge");
      if (langBadge) {
        if (!hasMultiLang && data.language) {
          langBadge.textContent = data.language;
          langBadge.style.display = "inline-flex";
        } else {
          langBadge.style.display = "none";
        }
      }
      if (hasMultiLang) {
        const latBtn = document.getElementById("dv-lang-btn-latino");
        const engBtn = document.getElementById("dv-lang-btn-ingles");
        const rawLang = (data.language || "").trim();
        const langParts = rawLang
          .split(/[-;|]/)
          .map((l) => l.trim())
          .filter(Boolean);
        const SPANISH = ["latino", "español", "castellano", "doblado", "esp"];
        const isSpanish = (l) =>
          SPANISH.some((s) => l.toLowerCase().includes(s));
        const esLabel = langParts.find((l) => isSpanish(l)) || "Latino";
        const enLabel = langParts.find((l) => !isSpanish(l)) || "Inglés";

        if (latBtn) {
          latBtn.textContent = enLabel;
          latBtn.classList.add("active"); // inglés activo por defecto
        }
        if (engBtn) {
          engBtn.textContent = esLabel;
          engBtn.classList.remove("active");
        }

        if (latBtn) latBtn.onclick = () => window.dvSetLang("en", latBtn);
        if (engBtn) engBtn.onclick = () => window.dvSetLang("es", engBtn);

        // Guardar tracks para dvSetLang aunque no se haya reproducido aún
        const tempTracks = [];
        if (data.videoId_en)
          tempTracks.push({ id: data.videoId_en, lang: "en", label: enLabel });
        if (data.videoId_es)
          tempTracks.push({ id: data.videoId_es, lang: "es", label: esLabel });
        window._dvTracks = tempTracks;
        window._dvCurrentMovieId = id;
        window._dvCurrentMovieData = data;
        window._dvActiveLang = "en";
      }
    }

    // ── Poster mobile ─────────────────────────────────────────
    const posterImg = document.getElementById("dv-poster-img");
    if (posterImg) posterImg.src = data.poster || bannerUrl;

    // ── Score ring mobile (TMDB-style) ────────────────────────
    const mobRingFill = document.getElementById("dvMobRingFill");
    const mobRingNum = document.getElementById("dv-mob-rating-num");
    const _avg = appState.content.averages?.[id];
    if (_avg) {
      const _pct = Math.min(100, Math.round((parseFloat(_avg) / 5) * 100));
      if (mobRingNum) mobRingNum.textContent = `${_pct}%`;
      if (mobRingFill) {
        mobRingFill.style.strokeDasharray = `${_pct} ${100 - _pct}`;
        mobRingFill.style.stroke =
          _pct >= 70
            ? "#21d07a"
            : _pct >= 45
              ? "var(--accent-color)"
              : "#d2222d";
      }
    } else {
      if (mobRingNum) mobRingNum.textContent = "—";
      if (mobRingFill) mobRingFill.style.strokeDasharray = "0 100";
    }

    // ── Botón Ver más tarde inline (score row, solo mobile) ───────────
    const mobListBtn = document.getElementById("dv-mob-list-btn");
    if (mobListBtn) {
      const updateMobListBtn = () => {
        const inList =
          appState.user.watchlist && appState.user.watchlist.has(id);
        mobListBtn.innerHTML = inList
          ? `<i class="fas fa-check"></i><span>Ver más tarde</span>`
          : `<i class="fas fa-plus"></i><span>Ver más tarde</span>`;
        mobListBtn.classList.toggle("in-list", !!inList);
      };
      updateMobListBtn();
      mobListBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!auth.currentUser) {
          openConfirmationModal(
            "Inicia Sesión",
            "Necesitas cuenta para usar Ver más tarde.",
            () => openAuthModal(true),
          );
          return;
        }
        await handleWatchlistClick(mobListBtn);
        updateMobListBtn();
      };
    }

    // ── Botón Reproducir inline (score row) ───────────────────
    const mobPlayInline = document.getElementById("dv-mob-play-inline");
    if (mobPlayInline) {
      mobPlayInline.onclick = async () => {
        const player = await getPlayerModule();
        player.openPlayerModal(id, data.title);
      };
    }

    // ── Selector idioma mobile ────────────────────────────────
    const langSection = document.getElementById("dv-lang-section");
    const langOpt1 = document.getElementById("dv-lang-opt-1");
    const langOpt2 = document.getElementById("dv-lang-opt-2");
    if (langSection) {
      if (hasMultiLang && langOpt1 && langOpt2) {
        const _rawLang = (data.language || "").trim();
        const _parts = _rawLang
          .split(/[-;|]/)
          .map((l) => l.trim())
          .filter(Boolean);
        const _SPANISH = ["latino", "español", "castellano", "doblado", "esp"];
        const _isSpanish = (l) =>
          _SPANISH.some((s) => l.toLowerCase().includes(s));
        const _esLabel = _parts.find((l) => _isSpanish(l)) || "Latino";
        const _enLabel = _parts.find((l) => !_isSpanish(l)) || "Inglés";
        langOpt1.textContent = _enLabel;
        langOpt2.textContent = _esLabel;
        // Inglés activo por defecto
        langOpt1.classList.add("active");
        langOpt2.classList.remove("active");
        langOpt1.onclick = () => {
          window.dvSetLang("en", langOpt1);
          document
            .querySelectorAll(".dv-lang-option")
            .forEach((b) => b.classList.remove("active"));
          langOpt1.classList.add("active");
        };
        langOpt2.onclick = () => {
          window.dvSetLang("es", langOpt2);
          document
            .querySelectorAll(".dv-lang-option")
            .forEach((b) => b.classList.remove("active"));
          langOpt2.classList.add("active");
        };
        langSection.classList.add("dv-lang-section--visible");
        langSection.style.display = ""; // Dejar que CSS controle según breakpoint
      } else {
        langSection.classList.remove("dv-lang-section--visible");
        langSection.style.display = "";
      }
    }

    // ── Sinopsis ──────────────────────────────────────────────
    const synopsisEl = document.getElementById("dv-synopsis");
    if (synopsisEl)
      synopsisEl.textContent = data.synopsis || "Sin descripción.";

    // ── Pedida por ────────────────────────────────────────────
    const pedidoWrap = document.getElementById("dv-pedido");
    const pedidoUser = document.getElementById("dv-pedido-user");
    const requestedBy =
      data.pedido ||
      data.requestedBy ||
      data.pedidaPor ||
      data.pedida_por ||
      "";
    if (pedidoWrap) {
      if (requestedBy) {
        pedidoUser.textContent = requestedBy;
        pedidoWrap.style.display = "flex";
      } else {
        pedidoWrap.style.display = "none";
      }
    }

    // ── Botones ───────────────────────────────────────────────
    const btnGroup = document.getElementById("dv-btn-group");
    if (btnGroup) {
      btnGroup.innerHTML = "";

      const isVetada =
        !isSeries && data.estado && data.estado.toLowerCase() === "vetada";
      const isMantenimiento =
        !isSeries &&
        data.estado &&
        data.estado.toLowerCase() === "mantenimiento";
      const getProxLabel = (estado) => {
        if (!estado) return null;
        const v = estado.trim();
        const l = v.toLowerCase();
        if (l === "vetada" || l === "mantenimiento") return null;
        if (l === "proximamente" || l === "próximamente") return "Próximamente";
        if (/\d/.test(v)) return `Próximamente el ${v}`;
        return `Próximamente en ${v}`;
      };
      const proxLabel =
        !isSeries && data.estado ? getProxLabel(data.estado) : null;

      if (isVetada) {
        const msg = document.createElement("div");
        msg.className = "dv-estado-msg dv-estado-vetada";
        msg.innerHTML = `<i class="fas fa-lock"></i> No disponible`;
        btnGroup.appendChild(msg);
      } else if (proxLabel) {
        const msg = document.createElement("div");
        msg.className = "dv-estado-msg dv-estado-proximamente";
        msg.innerHTML = `<i class="fas fa-clock"></i> ${proxLabel}`;
        btnGroup.appendChild(msg);
      } else if (isMantenimiento) {
        const msg = document.createElement("div");
        msg.className = "dv-estado-msg dv-estado-mantenimiento";
        msg.innerHTML = `<i class="fas fa-wrench"></i> En mantenimiento`;
        btnGroup.appendChild(msg);
      } else {
        // Botón Reproducir (solo desktop — en mobile lo tiene el score-row)
        const isMobile = window.innerWidth < 768;
        if (!isMobile) {
          const playBtn = document.createElement("button");
          playBtn.className = "dv-btn dv-btn-play dv-btn-play--desktop";
          playBtn.title = "Reproducir";
          playBtn.innerHTML = `<i class="fas fa-play"></i><span class="dv-play-text">Reproducir</span>`;
          playBtn.onclick = async () => {
            const player = await getPlayerModule();
            if (isSeries) {
              await player.playSeriesInDetailView(id);
            } else {
              player.openPlayerModal(id, data.title);
            }
          };
          btnGroup.appendChild(playBtn);
        }

        // Botón Ver más tarde (solo desktop y logueado)
        if (!isMobile && auth.currentUser) {
          const inList = appState.user.watchlist.has(id);
          const listBtn = document.createElement("button");
          listBtn.className = `dv-btn-icon ${inList ? "in-list" : ""}`;
          listBtn.innerHTML = `<i class="fas ${inList ? "fa-check" : "fa-plus"}"></i>`;
          listBtn.title = inList ? "En ver más tarde" : "+ Ver más tarde";
          listBtn.dataset.contentId = id;
          listBtn.onclick = (e) => {
            e.stopPropagation();
            handleWatchlistClick(listBtn);
          };
          btnGroup.appendChild(listBtn);
        }

        // ── Botón ⋮ "Más opciones" con popover ───────────────
        const moreWrap = document.createElement("div");
        moreWrap.className = "dv-more-wrap";

        const moreBtn = document.createElement("button");
        moreBtn.className = "dv-more-btn";
        moreBtn.title = "Más opciones";
        moreBtn.innerHTML = `<i class="fas fa-ellipsis"></i>`;

        const popover = document.createElement("div");
        popover.className = "dv-more-popover";

        // — Ítem Reseña —
        const popStar = document.createElement("button");
        popStar.className = "dv-more-popover-item pop-star";
        popStar.innerHTML = `<span class="dv-pop-icon"><i class="fas fa-star"></i></span><span>Reseñar</span>`;
        popStar.onclick = async () => {
          popover.classList.remove("open");
          moreBtn.classList.remove("active");
          if (!auth.currentUser) {
            openConfirmationModal(
              "Inicia Sesión",
              "Necesitas cuenta para reseñar.",
              () => openAuthModal(true),
            );
            return;
          }
          const reviews = await getReviewsModule();
          setTimeout(() => {
            reviews.openReviewModal(true, {
              contentId: id,
              contentTitle: data.title,
              contentType: isSeries ? "series" : "movie",
            });
          }, 100);
        };
        popover.appendChild(popStar);

        // — Ítem Ojo (solo películas logueadas) —
        if (!isSeries && auth.currentUser) {
          const roulette = await getRouletteModule();
          const isWatched = roulette.isMovieWatched
            ? roulette.isMovieWatched(id)
            : false;

          const divider1 = document.createElement("div");
          divider1.className = "dv-more-popover-divider";
          popover.appendChild(divider1);

          const popEye = document.createElement("button");
          popEye.className = `dv-more-popover-item pop-eye${isWatched ? " is-watched" : ""}`;
          popEye.innerHTML = `<span class="dv-pop-icon"><i class="fas ${isWatched ? "fa-eye" : "fa-eye-slash"}"></i></span><span>${isWatched ? "Quitar de vistas" : "Marcar como vista"}</span>`;
          popEye.onclick = async () => {
            popover.classList.remove("open");
            moreBtn.classList.remove("active");
            const nowWatched = popEye.classList.contains("is-watched");
            if (nowWatched) {
              await roulette.unmarkMovieFromRoulette(id);
              popEye.classList.remove("is-watched");
              popEye.innerHTML = `<span class="dv-pop-icon"><i class="fas fa-eye-slash"></i></span><span>Marcar como vista</span>`;
            } else {
              await roulette.markMovieAsWatched(id);
              popEye.classList.add("is-watched");
              popEye.innerHTML = `<span class="dv-pop-icon"><i class="fas fa-eye"></i></span><span>Quitar de vistas</span>`;
            }
          };
          popover.appendChild(popEye);
        }

        // — Ítem Discord (solo admin) —
        if (isAdminUser()) {
          const divider2 = document.createElement("div");
          divider2.className = "dv-more-popover-divider";
          popover.appendChild(divider2);

          const popDiscord = document.createElement("button");
          popDiscord.className = "dv-more-popover-item pop-discord";
          popDiscord.innerHTML = `<span class="dv-pop-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg></span><span>Avisar en Discord</span>`;
          popDiscord.onclick = async () => {
            popover.classList.remove("open");
            moreBtn.classList.remove("active");
            const label = popDiscord.querySelector("span:last-child");
            try {
              label.textContent = "Enviando...";
              await notifyDiscordNewContent({
                title: data.title,
                year: data.year,
                poster: data.poster || data.image || data.banner || null,
                type: "movie",
                requestedBy: data.pedido || data.requestedBy || data.pedidaPor || data.pedida_por || ""
              });
              label.textContent = "✓ Enviado";
            } catch (err) {
              console.error("[Discord]", err);
              label.textContent = "✗ Error";
            } finally {
              setTimeout(() => { label.textContent = "Avisar en Discord"; }, 3000);
            }
          };
          popover.appendChild(popDiscord);
        }

        // — Toggle popover —
        moreBtn.onclick = (e) => {
          e.stopPropagation();
          const isOpen = popover.classList.contains("open");
          // Cerrar cualquier otro popover abierto
          document
            .querySelectorAll(".dv-more-popover.open")
            .forEach((p) => p.classList.remove("open"));
          document
            .querySelectorAll(".dv-more-btn.active")
            .forEach((b) => b.classList.remove("active"));
          if (!isOpen) {
            popover.classList.add("open");
            moreBtn.classList.add("active");
          }
        };

        // — Cerrar al tocar fuera —
        document.addEventListener("click", function closePopover(e) {
          if (!moreWrap.contains(e.target)) {
            popover.classList.remove("open");
            moreBtn.classList.remove("active");
          }
        });

        moreWrap.appendChild(moreBtn);
        moreWrap.appendChild(popover);

        if (isMobile) {
          // En mobile: agregar al score-row junto a los botones principales
          const mobScoreRow = document.getElementById("dv-mob-score-row");
          if (mobScoreRow) {
            // Limpiar dividers y botones "..." de la película anterior
            mobScoreRow.querySelectorAll(".dv-mob-score-divider, .dv-more-wrap").forEach(el => el.remove());
            const mobDivider = document.createElement("div");
            mobDivider.className = "dv-mob-score-divider";
            mobScoreRow.appendChild(mobDivider);
            mobScoreRow.appendChild(moreWrap);
          } else {
            btnGroup.appendChild(moreWrap);
          }
        } else {
          btnGroup.appendChild(moreWrap);
        }
      }
    }

    // ── Guardar estado para el botón Volver ───────────────────
    view.dataset.fromFilter = appState.currentFilter || "all";


    // ── Mostrar vista ─────────────────────────────────────────
    view.style.display = "block";
    requestAnimationFrame(() => {
      view.classList.add("visible");
      view.scrollTop = 0;
    });

    // ── Botón Volver ──────────────────────────────────────────
    const backBtn = document.getElementById("dv-back-btn");
    if (backBtn) {
      backBtn.onclick = (e) => {
        e.preventDefault();
        closeDetailView();
      };
    }
  } catch (e) {
    console.error("Error abriendo detalle:", e);
    if (window.logError) window.logError(e, "Open Detail View");
  }
}

function closeDetailView() {
  const view = document.getElementById("detail-view");
  if (!view) return;

  // Destruir player si estaba activo
  if (appState?.player?.activeCineInstance) {
    appState.player.activeCineInstance.destroy();
    appState.player.activeCineInstance = null;
  }

  // Restaurar dv-hero si fue ocultado en mobile
  const dvHero = document.getElementById("dv-hero");
  if (dvHero) {
    dvHero.style.display = "";
    dvHero.classList.remove("dv-hero--playing");
  }
  const detailView2 = document.getElementById("detail-view");
  if (detailView2) detailView2.classList.remove("detail-view--playing");
  const mobileHeader = document.querySelector(".dv-mobile-header");
  if (mobileHeader) {
    mobileHeader.style.backgroundImage = "";
    mobileHeader.style.backgroundSize = "";
    mobileHeader.style.backgroundPosition = "";
  }

  // Restaurar detail-view al tamaño original
  const detailView = document.querySelector(".detail-view");
  if (detailView) {
    detailView.style.height = "";
    detailView.style.minHeight = "";
  }

  // Limpiar video
  const videoContainer = document.getElementById("dv-video-container");
  if (videoContainer) videoContainer.innerHTML = "";

  // Ocultar vista
  view.classList.remove("visible");
  view.style.display = "none";

  // Restaurar catálogo
  const main = document.querySelector("main");
  const heroSection = document.getElementById("hero-section");
  const carouselContainer = document.getElementById("carousel-container");
  const gridContainer = document.getElementById("full-grid-container");
  if (main) main.style.display = "";
  if (heroSection) heroSection.style.display = "";
  if (carouselContainer) carouselContainer.style.display = "";
  if (gridContainer) gridContainer.style.display = "";

  // Restaurar filtro activo y página
  const lastFilter = view.dataset.fromFilter || "all";
  switchView(lastFilter);
}

window.closeDetailView = closeDetailView;
window.openDetailsModal = openDetailsModal;

// ===========================================================
// VISTA DETALLE SERIES (sp-) — espejo de openDetailsModal/closeDetailView
// ===========================================================
async function openSeriesDetailView(id) {
  try {
    let data = findContentData(id) || appState.content.series[id];
    if (!data) {
      ErrorHandler.show(
        "content",
        "No se pudo cargar la información de la serie.",
      );
      return;
    }
    id = data.id || id;

    const view = document.getElementById("sp-detail-view");
    if (!view) return;


    // ── Ocultar catálogo ──────────────────────────────────────
    const main = document.querySelector("main");
    const heroSection = document.getElementById("hero-section");
    const carouselContainer = document.getElementById("carousel-container");
    const gridContainer = document.getElementById("full-grid-container");
    const sagasHub = document.getElementById("sagas-hub-container");
    if (main) main.style.display = "none";
    if (heroSection) heroSection.style.display = "none";
    if (carouselContainer) carouselContainer.style.display = "none";
    if (gridContainer) gridContainer.style.display = "none";
    if (sagasHub) sagasHub.style.display = "none";

    // ── Resetear reproductor ──────────────────────────────────
    const playerSection = document.getElementById("sp-player-section");
    const videoContainer = document.getElementById("sp-video-container");
    if (playerSection) {
      playerSection.style.display = "none";
      playerSection.style.opacity = "0";
    }
    if (videoContainer) videoContainer.innerHTML = "";
    if (appState?.player?.activeCineInstance) {
      appState.player.activeCineInstance.destroy();
      appState.player.activeCineInstance = null;
    }

    // ── Hero: fondo ───────────────────────────────────────────
    const hero = document.getElementById("sp-hero");
    const heroBanner = document.getElementById("sp-hero-banner");
    const bannerUrl =
      data.banner && data.banner.length > 5 ? data.banner : data.poster || "";
    if (heroBanner) heroBanner.style.backgroundImage = `url(${bannerUrl})`;

    // ── Logo o título ─────────────────────────────────────────
    const logoEl = document.getElementById("sp-logo");
    const titleEl = document.getElementById("sp-title");
    if (data.logoUrl) {
      if (logoEl) {
        setLogoSrc(logoEl, data.logoUrl);
        logoEl.style.display = "block";
      }
      if (titleEl) titleEl.style.display = "none";
    } else {
      if (logoEl) logoEl.style.display = "none";
      if (titleEl) {
        titleEl.textContent = data.title || "";
        titleEl.style.display = "block";
      }
    }

    // ── Géneros ───────────────────────────────────────────────
    const genresEl = document.getElementById("sp-genres");
    if (genresEl) {
      let genresVal = "";
      if (data.genres) {
        if (Array.isArray(data.genres)) genresVal = data.genres.join(", ");
        else if (typeof data.genres === "string")
          genresVal = data.genres.replace(/;/g, ", ");
      }
      genresEl.textContent = genresVal.toUpperCase();
    }

    // ── Rating ────────────────────────────────────────────────
    const ratingEl = document.getElementById("sp-rating");
    const avg = appState.content.averages?.[id];
    if (ratingEl) {
      ratingEl.textContent = avg ? `★ ${avg}` : `★ —`;
      ratingEl.style.display = "inline-flex";
    }

    // ── Año ───────────────────────────────────────────────────
    const yearEl = document.getElementById("sp-year");
    if (yearEl) yearEl.textContent = data.year || data.anio || "";

    // ── Temporadas ────────────────────────────────────────────
    const seasonsEl = document.getElementById("sp-seasons");
    if (seasonsEl) {
      const spKeys = new Set([
        ...Object.keys(appState.content.seasonPosters[id] || {}),
        ...Object.keys(appState.content.seriesEpisodes[id] || {}),
      ]);
      const cnt = spKeys.size;
      if (cnt > 0) {
        // nombreTemporadas: campo custom en serie (ej: "Parte", "Stage"); si no, "Temporada"
        const _seasonWord =
          String(data.nombreTemporadas || "").trim() || "Temporada";
        // totalSeasons: campo explícito en serie para casos donde el conteo de posters no refleja la realidad
        const _total = data.totalSeasons ? Number(data.totalSeasons) : cnt;
        seasonsEl.textContent = `${_total} ${_seasonWord}${_total !== 1 ? "s" : ""}`;
        seasonsEl.style.display = "inline-flex";
      } else {
        seasonsEl.style.display = "none";
      }

      // ── Duración por episodio ─────────────────────────────────
      const epDurEl = document.getElementById("sp-ep-duration");
      if (epDurEl) {
        const allEpisodes = Object.values(
          appState.content.seriesEpisodes[id] || {},
        ).flat();
        const withDuration = allEpisodes.filter(
          (ep) => ep.duration || ep.duracion,
        );

        if (withDuration.length > 0) {
          const toMinutes = (str) => {
            str = String(str).trim();
            if (str.includes(":")) {
              const parts = str.split(":").map(Number);
              return parts.length === 3
                ? parts[0] * 60 + parts[1]
                : parts[0] > 7
                  ? parts[0]
                  : parts[0] * 60 + parts[1];
            }
            const h = str.match(/(\d+)\s*h/);
            const m = str.match(/(\d+)\s*m/);
            return (
              (h ? parseInt(h[1]) * 60 : 0) + (m ? parseInt(m[1]) : 0) ||
              parseInt(str) ||
              0
            );
          };

          const total = withDuration.reduce(
            (sum, ep) => sum + toMinutes(ep.duration || ep.duracion),
            0,
          );
          const avg = Math.round(total / withDuration.length);

          if (avg > 0) {
            epDurEl.textContent = `~${avg} min / ep`;
            epDurEl.style.display = "inline-flex";
          } else {
            epDurEl.style.display = "none";
          }
        } else {
          epDurEl.style.display = "none";
        }
      }
    }

    // ── Detectar multi-idioma (campos están en episodios, no en el objeto serie) ──
    const _spFirstEp = (() => {
      const eps = appState.content.seriesEpisodes[id] || {};
      const firstSeason = Object.values(eps)[0];
      if (!firstSeason) return null;
      const epList = Array.isArray(firstSeason)
        ? firstSeason
        : Object.values(firstSeason);
      return epList.find((ep) => ep) || null;
    })();
    const hasMultiLang = !!(
      _spFirstEp &&
      _spFirstEp.videoId_es &&
      _spFirstEp.videoId_en
    );

    // ── Idioma: badge informativo (siempre visible) ───────────
    const langBadgeEl = document.getElementById("sp-lang-badge");
    if (langBadgeEl) {
      const rawLang = (data.language || data.idioma || data.audio || "").trim();
      const SPANISH = ["latino", "español", "castellano", "doblado", "esp"];
      const isSpanish = (l) => SPANISH.some((s) => l.toLowerCase().includes(s));
      const parts = rawLang
        .split(/[-;|,]/)
        .map((l) => l.trim())
        .filter(Boolean);

      let label = "";
      if (parts.length >= 2) {
        label = parts.join(" · ");
      } else if (parts.length === 1) {
        label = parts[0];
      } else if (hasMultiLang) {
        label = "Latino · Inglés";
      } else if (_spFirstEp?.videoId_es) {
        label = "Latino";
      } else if (_spFirstEp?.videoId_en) {
        label = "Inglés";
      }

      if (label) {
        langBadgeEl.innerHTML =
          '<style="font-size:11px;margin-right:4px;opacity:0.8;"></style=>' +
          label;
        langBadgeEl.style.display = "inline-flex";
      } else {
        langBadgeEl.style.display = "none";
      }
    }

    // ── Duración con tooltip ──────────────────────────────────
    const durationText = document.getElementById("sp-duration-text");
    const durationTooltip = document.getElementById("sp-duration-tooltip");
    const durationBadge = document.getElementById("sp-duration");
    const rawDuration = data.duration || data.duracion || "";
    if (rawDuration) {
      if (durationText) durationText.textContent = rawDuration;
      if (durationBadge) durationBadge.style.display = "inline-flex";
      if (durationTooltip) {
        try {
          const parts = rawDuration
            .replace("h", ":")
            .replace("min", "")
            .replace(/\s/g, "")
            .split(":");
          if (parts.length >= 2) {
            const now = new Date();
            now.setHours(now.getHours() + parseInt(parts[0] || 0));
            now.setMinutes(now.getMinutes() + parseInt(parts[1] || 0));
            durationTooltip.textContent =
              "Termina aprox. a las " +
              now.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }) +
              " hrs";
          }
        } catch (e) {}
      }
    } else {
      if (durationBadge) durationBadge.style.display = "none";
    }

    // ── Toggle de idioma (oculto: la selección está en el reproductor) ──
    const langToggle = document.getElementById("sp-lang-toggle");
    if (langToggle) langToggle.style.display = "none";

    // ── Poster mobile ─────────────────────────────────────────
    const posterImg = document.getElementById("sp-poster-img");
    if (posterImg) posterImg.src = data.poster || bannerUrl;

    // Mostrar la fila de controles (temporada + idioma) en móvil
    const controlsRow = document.getElementById("sp-ps-controls-row");
    if (controlsRow) controlsRow.style.display = "";

    // ── Sinopsis ──────────────────────────────────────────────
    const synopsisEl = document.getElementById("sp-synopsis");
    if (synopsisEl)
      synopsisEl.textContent = data.synopsis || data.desc || "Sin descripción.";

    // ── Pedida por ────────────────────────────────────────────
    const pedidoWrap = document.getElementById("sp-pedido");
    const pedidoUser = document.getElementById("sp-pedido-user");
    const requestedBy =
      data.pedido ||
      data.requestedBy ||
      data.pedidaPor ||
      data.pedida_por ||
      "";
    if (pedidoWrap) {
      if (requestedBy) {
        pedidoUser.textContent = requestedBy;
        pedidoWrap.style.display = "flex";
      } else {
        pedidoWrap.style.display = "none";
      }
    }

    // ── Botones score row mobile (Reproducir | Ver más tarde) ─────────
    const spMobListBtn = document.getElementById("sp-mob-list-btn");
    if (spMobListBtn) {
      spMobListBtn.dataset.contentId = id;
      const updateSpMobListBtn = () => {
        const inList =
          appState.user.watchlist && appState.user.watchlist.has(id);
        spMobListBtn.innerHTML = inList
          ? `<i class="fas fa-check"></i><span>Ver más tarde</span>`
          : `<i class="fas fa-plus"></i><span>Ver más tarde</span>`;
        spMobListBtn.classList.toggle("in-list", !!inList);
      };
      updateSpMobListBtn();
      spMobListBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!auth.currentUser) {
          openConfirmationModal(
            "Inicia Sesión",
            "Necesitas cuenta para usar Ver más tarde.",
            () => openAuthModal(true),
          );
          return;
        }
        await handleWatchlistClick(spMobListBtn);
        updateSpMobListBtn();
      };
    }

    const spMobPlayInline = document.getElementById("sp-mob-play-inline");
    if (spMobPlayInline) {
      spMobPlayInline.onclick = async () => {
        const player = await getPlayerModule();
        await player.playSeriesInDetailView(id);
      };
    }

    // ── Botones ───────────────────────────────────────────────
    const btnGroup = document.getElementById("sp-btn-group");
    if (btnGroup) {
      btnGroup.innerHTML = "";

      const isMobile = window.innerWidth < 768;

      // En mobile los botones play y lista están en sp-mob-score-row
      if (!isMobile) {
        // Botón Reproducir
        const playBtn = document.createElement("button");
        playBtn.className = "sp-btn sp-btn-play sp-btn-play--desktop";
        playBtn.innerHTML = `<i class="fas fa-play"></i><span class="sp-play-text">Reproducir</span>`;
        playBtn.onclick = async () => {
          const player = await getPlayerModule();
          await player.playSeriesInDetailView(id);
        };
        btnGroup.appendChild(playBtn);

        // Botón Ver más tarde (solo si está logueado)
        if (auth.currentUser) {
          const inList = appState.user.watchlist.has(id);
          const listBtn = document.createElement("button");
          listBtn.className = `sp-btn-icon ${inList ? "in-list" : ""}`;
          listBtn.innerHTML = `<i class="fas ${inList ? "fa-check" : "fa-plus"}"></i>`;
          listBtn.title = inList ? "En ver más tarde" : "+ Ver más tarde";
          listBtn.dataset.contentId = id;
          listBtn.onclick = (e) => {
            e.stopPropagation();
            handleWatchlistClick(listBtn);
          };
          btnGroup.appendChild(listBtn);
        }
      }

      // ── Botón Episodio Random (solo si data.random === "si") ──────
      const _randomVal = String(data.random ?? "").trim().toLowerCase();
      if (_randomVal === "si" || _randomVal === "sí" || _randomVal === "yes" || _randomVal === "true" || _randomVal === "1") {
        const randomBtn = document.createElement("button");
        randomBtn.className = "sp-btn-icon";
        randomBtn.title = "Episodio al azar";
        randomBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>`;
        randomBtn.onclick = async () => {
          const player = await getPlayerModule();
          const episodesData = appState.content.seriesEpisodes[id] || {};
          const allEps = Object.entries(episodesData).flatMap(
            ([season, eps]) => (Array.isArray(eps) ? eps : Object.values(eps))
              .map((ep, idx) => ({ season, idx }))
          ).filter(Boolean);
          if (!allEps.length) return;
          const pick = allEps[Math.floor(Math.random() * allEps.length)];
          player.playEpisodeInDetailView(id, pick.season, pick.idx);
        };

        if (isMobile) {
          const mobMoreSlot = document.getElementById("sp-mob-more-wrap");
          if (mobMoreSlot) {
            mobMoreSlot.innerHTML = "";
            mobMoreSlot.appendChild(randomBtn);
          }
        } else {
          btnGroup.appendChild(randomBtn);
        }
      }

      // ── Botón ⋮ "Más opciones" con popover — Series ─────────
      const spMoreWrap = document.createElement("div");
      spMoreWrap.className = "dv-more-wrap";

      const spMoreBtn = document.createElement("button");
      spMoreBtn.className = "dv-more-btn";
      spMoreBtn.title = "Más opciones";
      spMoreBtn.innerHTML = `<i class="fas fa-ellipsis"></i>`;

      const spPopover = document.createElement("div");
      spPopover.className = "dv-more-popover";

      // — Ítem Reseña —
      const spPopStar = document.createElement("button");
      spPopStar.className = "dv-more-popover-item pop-star";
      spPopStar.innerHTML = `<span class="dv-pop-icon"><i class="fas fa-star"></i></span><span>Reseñar</span>`;
      spPopStar.onclick = async () => {
        spPopover.classList.remove("open");
        spMoreBtn.classList.remove("active");
        if (!auth.currentUser) {
          openConfirmationModal(
            "Inicia Sesión",
            "Necesitas cuenta para reseñar.",
            () => openAuthModal(true),
          );
          return;
        }
        const reviews = await getReviewsModule();
        setTimeout(() => {
          reviews.openReviewModal(true, {
            contentId: id,
            contentTitle: data.title,
            contentType: "series",
          });
        }, 100);
      };
      spPopover.appendChild(spPopStar);

      // — Ítem Discord (solo admin) —
      if (isAdminUser()) {
        const spDivider = document.createElement("div");
        spDivider.className = "dv-more-popover-divider";
        spPopover.appendChild(spDivider);

        const DISCORD_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`;

        // — Botón directo → abre el modal —
        const spPopDiscord = document.createElement("button");
        spPopDiscord.className = "dv-more-popover-item pop-discord";
        spPopDiscord.innerHTML = `
          <span class="dv-pop-icon">${DISCORD_SVG}</span>
          <span>Avisar en Discord</span>`;
        spPopDiscord.onclick = () => {
          spPopover.classList.remove("open");
          spMoreBtn.classList.remove("active");
          openDiscordNotifyModal({ initialType: "series-episode", seriesData: data, seriesId: id });
        };

        spPopover.appendChild(spPopDiscord);
      }

      // — Toggle —
      spMoreBtn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = spPopover.classList.contains("open");
        document
          .querySelectorAll(".dv-more-popover.open")
          .forEach((p) => p.classList.remove("open"));
        document
          .querySelectorAll(".dv-more-btn.active")
          .forEach((b) => b.classList.remove("active"));
        if (!isOpen) {
          spPopover.classList.add("open");
          spMoreBtn.classList.add("active");
        }
      };

      document.addEventListener("click", function closeSpPopover(e) {
        if (!spMoreWrap.contains(e.target)) {
          spPopover.classList.remove("open");
          spMoreBtn.classList.remove("active");
        }
      });

      spMoreWrap.appendChild(spMoreBtn);
      spMoreWrap.appendChild(spPopover);

      // En mobile el ... va dentro del score row; en desktop en btn-group
      if (isMobile) {
        const mobMoreSlot = document.getElementById("sp-mob-more-wrap");
        if (mobMoreSlot) {
          mobMoreSlot.innerHTML = "";
          mobMoreSlot.appendChild(spMoreBtn);
          mobMoreSlot.appendChild(spPopover);
        }
      } else {
        btnGroup.appendChild(spMoreWrap);
      }
    }

    // ── Guardar estado para el botón Volver ───────────────────
    view.dataset.fromFilter = appState.currentFilter || "all";


    // ── Mostrar vista ─────────────────────────────────────────
    view.style.display = "block";
    requestAnimationFrame(() => {
      view.classList.add("visible");
      view.scrollTop = 0;
    });

    // ── Botón Volver ──────────────────────────────────────────
    const backBtn = document.getElementById("sp-back-btn");
    if (backBtn) {
      backBtn.onclick = (e) => {
        e.preventDefault();
        closeSeriesDetailView();
      };
    }
  } catch (e) {
    console.error("Error abriendo detalle de serie:", e);
    if (window.logError) window.logError(e, "Open Series Detail View");
  }
}

function closeSeriesDetailView() {
  const view = document.getElementById("sp-detail-view");
  if (!view) return;

  // Guardar historial antes de destruir el player
  if (appState?.player?.pendingHistorySave) {
    const { contentId, type, episodeInfo } = appState.player.pendingHistorySave;
    addToHistoryIfLoggedIn(contentId, type, episodeInfo);
    appState.player.pendingHistorySave = null;
    const user = auth.currentUser;
    if (user) {
      db.ref(`users/${user.uid}/history`)
        .orderByChild("viewedAt")
        .once("value", (snapshot) => {
          const existing = document.getElementById(
            "continue-watching-carousel",
          );
          if (existing) existing.remove();
          if (snapshot.exists()) generateContinueWatchingCarousel(snapshot);
        });
    }
  }

  // Destruir player si estaba activo
  if (appState?.player?.activeCineInstance) {
    appState.player.activeCineInstance.destroy();
    appState.player.activeCineInstance = null;
  }

  // Restaurar sp-hero si fue ocultado en mobile
  const spHero = document.getElementById("sp-hero");
  if (spHero) {
    spHero.style.display = "";
    spHero.classList.remove("sp-hero--playing");
  }
  view.classList.remove("sp-detail-view--playing");
  const tabBar = document.getElementById("mobileTabBar");
  if (tabBar) tabBar.style.display = "";

  const mobileHeader = view.querySelector(".sp-mobile-header");
  if (mobileHeader) {
    mobileHeader.style.backgroundImage = "";
    mobileHeader.style.backgroundSize = "";
    mobileHeader.style.backgroundPosition = "";
  }

  // Restaurar tamaño original
  view.style.height = "";
  view.style.minHeight = "";

  // Limpiar video
  const videoContainer = document.getElementById("sp-video-container");
  if (videoContainer) videoContainer.innerHTML = "";

  // Ocultar vista
  view.classList.remove("visible");
  view.style.display = "none";

  // Restaurar catálogo
  const main = document.querySelector("main");
  const heroSection = document.getElementById("hero-section");
  const carouselContainer = document.getElementById("carousel-container");
  const gridContainer = document.getElementById("full-grid-container");
  if (main) main.style.display = "";
  if (heroSection) heroSection.style.display = "";
  if (carouselContainer) carouselContainer.style.display = "";
  if (gridContainer) gridContainer.style.display = "";

  // Restaurar filtro y URL
  const lastFilter = view.dataset.fromFilter || "all";
  switchView(lastFilter);
}

window.closeSeriesDetailView = closeSeriesDetailView;
window.openSeriesDetailView = openSeriesDetailView;

// spSetLang — equivalente a dvSetLang para series
window.spSetLang = async function (lang, btn) {
  if (!window._spTracks || !window._spCurrentSeriesData) return;
  const track = window._spTracks.find((t) => t.lang === lang);
  if (!track) return;

  document
    .querySelectorAll(".sp-lang-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  window._spActiveLang = lang;

  const playerLang = document.getElementById("sp-player-lang");
  if (playerLang) playerLang.textContent = track.label;

  const player = await getPlayerModule();
  player.loadSeriesTrack(
    track.id,
    window._spCurrentSeriesId,
    window._spCurrentSeriesData,
    track.lang,
  );
};

window.dvSetLang = async function (lang, btn) {
  if (!window._dvTracks || !window._dvCurrentMovieData) return;
  const track = window._dvTracks.find((t) => t.lang === lang);
  if (!track) return;

  document
    .querySelectorAll(".dv-lang-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");

  window._dvActiveLang = lang; // ← guardar idioma elegido

  const playerLang = document.getElementById("dv-player-lang");
  if (playerLang) playerLang.textContent = track.label;

  const player = await getPlayerModule();
  player.loadMovieTrack(
    track.id,
    window._dvCurrentMovieId,
    window._dvCurrentMovieData,
    track.lang,
  );
};

// ===========================================================
// 6. AUTENTICACIÓN Y DATOS DE USUARIO
// ===========================================================
function setupAuthListeners() {
  const setupPasswordToggle = (inputId, iconId) => {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if (input && icon) {
      const newIcon = icon.cloneNode(true);
      icon.parentNode.replaceChild(newIcon, icon);

      newIcon.addEventListener("click", () => {
        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";
        newIcon.classList.toggle("fa-eye");
        newIcon.classList.toggle("fa-eye-slash");
      });
    }
  };
  setupPasswordToggle("login-password", "toggle-login-pass");
  setupPasswordToggle("register-password", "toggle-register-pass");

  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const recoveryForm = document.getElementById("recovery-form");
  const authSwitch = document.querySelector(".auth-switch");

  const forgotLink = document.getElementById("forgot-password-link");
  if (forgotLink) {
    forgotLink.onclick = (e) => {
      e.preventDefault();
      loginForm.style.display = "none";
      registerForm.style.display = "none";
      recoveryForm.style.display = "flex";
      recoveryForm.style.flexDirection = "column";
      if (authSwitch) authSwitch.style.display = "none";
    };
  }

  const backToLogin = document.getElementById("back-to-login-link");
  if (backToLogin) {
    backToLogin.onclick = (e) => {
      e.preventDefault();
      recoveryForm.style.display = "none";
      loginForm.style.display = "flex";
      if (authSwitch) authSwitch.style.display = "block";
    };
  }

  if (DOM.switchAuthModeLink) {
    DOM.switchAuthModeLink.onclick = (e) => {
      e.preventDefault();
      const isLogin = loginForm.style.display !== "none";
      openAuthModal(!isLogin);
    };
  }

  if (DOM.loginForm) {
    DOM.loginForm.onsubmit = (e) => {
      e.preventDefault();
      const email = document.getElementById("login-email").value;
      const pass = document.getElementById("login-password").value;

      const errorEl = document.getElementById("login-error");

      auth
        .signInWithEmailAndPassword(email, pass)
        .then(() => {
          ModalManager.closeAll();
          DOM.loginForm.reset();
        })
        .catch(() => {
          errorEl.textContent = "Credenciales incorrectas.";
          errorEl.style.display = "block";
        });
    };
  }

  if (DOM.registerForm) {
    DOM.registerForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const username = document.getElementById("register-username").value;
      const email = document.getElementById("register-email").value;
      const password = document.getElementById("register-password").value;

      const errorEl = document.getElementById("register-error");

      if (errorEl) {
        errorEl.style.display = "none";
        errorEl.textContent = "";
      }

      auth
        .createUserWithEmailAndPassword(email, password)
        .then((userCredential) =>
          userCredential.user.updateProfile({ displayName: username }),
        )
        .then(() => {
          ModalManager.closeAll();
          DOM.registerForm.reset();
          ErrorHandler.show("auth", "¡Cuenta creada con éxito!", 3000);
        })
        .catch((err) => {
          if (errorEl) {
            errorEl.textContent = err.message;
            errorEl.style.display = "block";
          }
        });
    });
  }

  if (recoveryForm) {
    recoveryForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = document.getElementById("recovery-email-input").value;
      const msgElement = document.getElementById("recovery-message");

      if (msgElement) {
        msgElement.style.display = "none";
        msgElement.textContent = "";
      }

      auth
        .sendPasswordResetEmail(email)
        .then(() => {
          if (msgElement) {
            msgElement.style.color = "#4cd137";
            msgElement.textContent = `Enlace enviado a ${email}`;
            msgElement.style.display = "block";
          }
        })
        .catch((error) => {
          if (msgElement) {
            msgElement.style.color = "#ff4d4d";
            if (error.code === "auth/user-not-found") {
              msgElement.textContent = "Correo no registrado.";
            } else {
              msgElement.textContent = "Error al enviar. Intenta nuevamente.";
            }
            msgElement.style.display = "block";
          }
        });
    });
  }

  auth.onAuthStateChanged(updateUIAfterAuthStateChange);

  const handleLogout = (e) => {
    e.preventDefault();
    auth.signOut().then(() => location.reload());
  };
  const btnLogout = document.getElementById("logout-btn");
  if (btnLogout) {
    btnLogout.parentNode
      .replaceChild(btnLogout.cloneNode(true), btnLogout)
      .addEventListener("click", handleLogout);
  }

  // Configurar auth mobile inline
  setupMobileAuth();
}

// ── Helper: toggle eye icon ────────────────────────────────
function _setupMobPassToggle(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon  = document.getElementById(iconId);
  if (!input || !icon) return;
  const fresh = icon.cloneNode(true);
  icon.parentNode.replaceChild(fresh, icon);
  fresh.addEventListener("click", () => {
    const isPw = input.type === "password";
    input.type = isPw ? "text" : "password";
    fresh.classList.toggle("fa-eye",       !isPw);
    fresh.classList.toggle("fa-eye-slash",  isPw);
  });
}

// ── Mobile auth inline ─────────────────────────────────────
function setupMobileAuth() {
  _setupMobPassToggle("mob-login-password",    "mob-toggle-login-pass");
  _setupMobPassToggle("mob-register-password", "mob-toggle-register-pass");

  const mobLoginForm    = document.getElementById("mob-login-form");
  const mobRegisterForm = document.getElementById("mob-register-form");
  const mobRecoveryForm = document.getElementById("mob-recovery-form");

  // Olvidé contraseña
  const forgotLink = document.getElementById("mob-forgot-password-link");
  if (forgotLink) {
    forgotLink.onclick = (e) => {
      e.preventDefault();
      const panel = document.getElementById("mob-auth-panel");
      if (panel) panel.classList.add("open");
      if (mobLoginForm)    { mobLoginForm.style.display    = "none"; }
      if (mobRegisterForm) { mobRegisterForm.style.display = "none"; }
      if (mobRecoveryForm) { mobRecoveryForm.style.display = "flex"; mobRecoveryForm.style.flexDirection = "column"; }
      const btnLogin = document.getElementById("mob-btn-login");
      const btnReg   = document.getElementById("mob-btn-register");
      if (btnLogin) btnLogin.classList.remove("primary");
      if (btnReg)   btnReg.classList.remove("primary");
    };
  }

  // Volver a login desde recovery
  const backToLogin = document.getElementById("mob-back-to-login-link");
  if (backToLogin) {
    backToLogin.onclick = (e) => {
      e.preventDefault();
      const panel = document.getElementById("mob-auth-panel");
      if (panel) panel.classList.add("open");
      const rec = document.getElementById("mob-recovery-form");
      const lf  = document.getElementById("mob-login-form");
      const rf  = document.getElementById("mob-register-form");
      if (rec) rec.style.display = "none";
      if (lf)  { lf.style.display = "flex"; lf.style.flexDirection = "column"; }
      if (rf)  rf.style.display = "none";
      const btnLogin = document.getElementById("mob-btn-login");
      const btnReg   = document.getElementById("mob-btn-register");
      if (btnLogin) btnLogin.classList.add("primary");
      if (btnReg)   btnReg.classList.remove("primary");
    };
  }

  // Submit: login
  if (mobLoginForm) {
    mobLoginForm.onsubmit = (e) => {
      e.preventDefault();
      const email   = document.getElementById("mob-login-email").value;
      const pass    = document.getElementById("mob-login-password").value;
      const errorEl = document.getElementById("mob-login-error");
      if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }
      auth.signInWithEmailAndPassword(email, pass)
        .then(() => { window.closeMobileDrawer && closeMobileDrawer(); mobLoginForm.reset(); })
        .catch(() => {
          if (errorEl) { errorEl.textContent = "Credenciales incorrectas."; errorEl.style.display = "block"; }
        });
    };
  }

  // Submit: registro
  if (mobRegisterForm) {
    mobRegisterForm.onsubmit = (e) => {
      e.preventDefault();
      const username = document.getElementById("mob-register-username").value;
      const email    = document.getElementById("mob-register-email").value;
      const password = document.getElementById("mob-register-password").value;
      const errorEl  = document.getElementById("mob-register-error");
      if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }
      auth.createUserWithEmailAndPassword(email, password)
        .then((uc) => uc.user.updateProfile({ displayName: username }))
        .then(() => {
          window.closeMobileDrawer && closeMobileDrawer();
          mobRegisterForm.reset();
          ErrorHandler.show("auth", "¡Cuenta creada con éxito!", 3000);
        })
        .catch((err) => {
          if (errorEl) { errorEl.textContent = err.message; errorEl.style.display = "block"; }
        });
    };
  }

  // Submit: recovery
  if (mobRecoveryForm) {
    mobRecoveryForm.onsubmit = (e) => {
      e.preventDefault();
      const email = document.getElementById("mob-recovery-email").value;
      const msgEl = document.getElementById("mob-recovery-message");
      if (msgEl) { msgEl.style.display = "none"; msgEl.textContent = ""; }
      auth.sendPasswordResetEmail(email)
        .then(() => {
          if (msgEl) { msgEl.style.color = "#4cd137"; msgEl.textContent = `Enlace enviado a ${email}`; msgEl.style.display = "block"; }
        })
        .catch(() => {
          if (msgEl) { msgEl.style.color = "#ff4d4d"; msgEl.textContent = "Error al enviar. Intenta nuevamente."; msgEl.style.display = "block"; }
        });
    };
  }
}

// Expuesta globalmente — acordeón: toca el mismo botón para cerrar, el otro para cambiar
window.toggleMobileAuthForm = function (mode) {
  const panel    = document.getElementById("mob-auth-panel");
  const loginF   = document.getElementById("mob-login-form");
  const registerF= document.getElementById("mob-register-form");
  const recoveryF= document.getElementById("mob-recovery-form");
  const btnLogin = document.getElementById("mob-btn-login");
  const btnReg   = document.getElementById("mob-btn-register");

  const isOpen   = panel && panel.classList.contains("open");
  const activeForm = loginF && loginF.style.display !== "none" ? "login" : "register";

  // Si ya está abierto con el mismo form → cerrar (toggle)
  if (isOpen && activeForm === mode) {
    panel.classList.remove("open");
    if (btnLogin)  btnLogin.classList.remove("primary");
    if (btnReg)    btnReg.classList.remove("primary");
    return;
  }

  // Abrir y mostrar el form correcto
  if (panel) panel.classList.add("open");

  if (loginF)    { loginF.style.display    = mode === "login"    ? "flex" : "none"; if (mode === "login")    loginF.style.flexDirection    = "column"; }
  if (registerF) { registerF.style.display = mode === "register" ? "flex" : "none"; if (mode === "register") registerF.style.flexDirection = "column"; }
  if (recoveryF) recoveryF.style.display = "none";

  // Estado visual de botones
  if (btnLogin)  btnLogin.classList.toggle("primary",  mode === "login");
  if (btnReg)    btnReg.classList.toggle("primary",    mode === "register");

  // Limpiar errores
  ["mob-login-error", "mob-register-error"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ""; el.style.display = "none"; }
  });
};

// Compatibilidad: showMobileAuthForm redirige a toggleMobileAuthForm
window.showMobileAuthForm = window.toggleMobileAuthForm;

function openAuthModal(isLogin) {
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const recoveryForm = document.getElementById("recovery-form");
  const authSwitch = document.querySelector(".auth-switch");
  const switchLink = document.getElementById("switch-auth-mode");
  const authDropdown = document.getElementById("auth-dropdown");

  if (recoveryForm) recoveryForm.style.display = "none";
  if (authSwitch) authSwitch.style.display = "block";

  if (loginForm) loginForm.style.display = isLogin ? "flex" : "none";
  if (registerForm) registerForm.style.display = isLogin ? "none" : "flex";

  if (switchLink) {
    switchLink.textContent = isLogin
      ? "¿No tienes cuenta? Regístrate"
      : "¿Ya tienes cuenta? Inicia Sesión";
  }

  ["login-error", "register-error", "recovery-message"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = "";
      el.style.display = "none";
    }
  });

  document.querySelectorAll(".toggle-password").forEach((icon) => {
    icon.classList.add("fa-eye");
    icon.classList.remove("fa-eye-slash");
  });

  // Cerrar otros paneles
  const userDd = document.getElementById("navDropdown");
  if (userDd) userDd.classList.remove("open");
  const colorPanel = document.getElementById("colorPanel");
  if (colorPanel) colorPanel.classList.remove("open");

  // Abrir el dropdown de auth
  if (authDropdown) authDropdown.classList.add("open");
}

window.openAuthModal = openAuthModal;

function updateUIAfterAuthStateChange(user) {
  const loggedInElements = [
    DOM.userProfileContainer,
    DOM.myListNavLink,
    DOM.historyNavLink,
    DOM.myListNavLinkMobile,
    DOM.historyNavLinkMobile,
  ];
  const loggedOutElements = [DOM.guestAvatarBtn];

  const mobileGuestBtn       = document.getElementById("mobileGuestBtn");
  const mobileDrawerUser     = document.getElementById("mobileDrawerUser");
  const mobileDrawerGuest    = document.getElementById("mobileDrawerGuest");
  const mobileDrawerLoggedIn = document.getElementById("mobileDrawerLoggedIn");

  const hubLoggedIn = document.getElementById("hub-logged-in-content");
  const hubGuest = document.getElementById("hub-guest-content");
  const hubEmail = document.getElementById("profile-hub-email");

  const resetNavigationActiveState = () => {
    document
      .querySelectorAll(".main-nav a, .bottom-nav .nav-link")
      .forEach((l) => l.classList.remove("active"));
    document
      .querySelectorAll('a[data-filter="all"]')
      .forEach((l) => l.classList.add("active"));
  };

  if (user) {
    loggedInElements.forEach((el) => el && (el.style.display = "flex"));
    loggedOutElements.forEach((el) => el && (el.style.display = "none"));
    // Cerrar el dropdown de auth si estaba abierto
    const authDd = document.getElementById("auth-dropdown");
    if (authDd) authDd.classList.remove("open");

    const userName = user.displayName || user.email.split("@")[0];
    if (DOM.userGreetingBtn) {
      const _initials = userName.slice(0, 2).toUpperCase();
      const _photo = user.photoURL || null;
      // Aplica foto o iniciales a todos los avatares del sitio
      syncAllAvatars(_photo, _initials, userName);
      const _mobileAvatar = document.getElementById("mobileAvatarBtn");
      if (_mobileAvatar) _mobileAvatar.style.display = "flex";
      if (mobileGuestBtn)        mobileGuestBtn.style.display        = "none";
      if (mobileDrawerGuest)     mobileDrawerGuest.style.display     = "none";
      if (mobileDrawerUser)      mobileDrawerUser.style.display      = "flex";
      if (mobileDrawerLoggedIn)  mobileDrawerLoggedIn.style.display  = "block";
    }

    if (hubLoggedIn) hubLoggedIn.style.display = "block";
    if (hubGuest) hubGuest.style.display = "none";
    if (hubEmail) hubEmail.textContent = user.email;

    db.ref(`users/${user.uid}/watchlist`).once("value", (snapshot) => {
      if (snapshot.exists()) {
        const raw = snapshot.val();
        appState.user.watchlist = new Map(
          Object.entries(raw).map(([id, val]) => [id, typeof val === 'number' ? val : 0])
        );
      } else {
        appState.user.watchlist = new Map();
      }
    });

    setupRealtimeHistoryListener(user);
    getProfileModule();

    const ADMIN_EMAIL = "baquezadat@gmail.com";

    // Ajustes — solo visible para el admin
    const isAdmin = user.email === ADMIN_EMAIL;
    document.querySelectorAll('[data-filter="settings"]').forEach(el => {
      el.style.display = isAdmin ? "" : "none";
    });
    const settingsMobileDrawer = document.querySelector('.mobile-drawer-item[onclick*="settings"]');
    if (settingsMobileDrawer) settingsMobileDrawer.style.display = isAdmin ? "" : "none";

    resetNavigationActiveState();
    // No redirigir si hay un guardado de perfil en curso (condición de carrera:
    // updateProfile() dispara onAuthStateChanged antes de que los awaits terminen).
    if (!window._profileSaving) switchView("all");
  } else {
    loggedInElements.forEach((el) => el && (el.style.display = "none"));
    loggedOutElements.forEach((el) => el && (el.style.display = "flex"));

    const _mobileAvatarOut = document.getElementById("mobileAvatarBtn");
    if (_mobileAvatarOut) _mobileAvatarOut.style.display = "none";
    if (mobileGuestBtn)        mobileGuestBtn.style.display        = "flex";
    if (mobileDrawerGuest)     mobileDrawerGuest.style.display     = "flex";
    if (mobileDrawerUser)      mobileDrawerUser.style.display      = "none";
    if (mobileDrawerLoggedIn)  mobileDrawerLoggedIn.style.display  = "none";

    if (hubLoggedIn) hubLoggedIn.style.display = "none";
    if (hubGuest) hubGuest.style.display = "block";
    if (hubEmail) hubEmail.textContent = "Visitante";

    appState.user.watchlist.clear();

    if (appState.user.historyListenerRef) {
      appState.user.historyListenerRef.off("value");
      appState.user.historyListenerRef = null;
    }

    const continueWatchingCarousel = document.getElementById(
      "continue-watching-carousel",
    );
    if (continueWatchingCarousel) continueWatchingCarousel.remove();

    resetNavigationActiveState();
    switchView("all");
  }
}

function addToHistoryIfLoggedIn(contentId, type, episodeInfo = {}) {
  const user = auth.currentUser;
  if (!user) return;

  let itemData = null;
  if (typeof findContentData === "function") {
    itemData = findContentData(contentId);
  }
  if (!itemData && appState.content.series[contentId]) {
    itemData = appState.content.series[contentId];
  }
  if (!itemData && appState.content.movies[contentId]) {
    itemData = appState.content.movies[contentId];
  }
  if (!itemData) return;

  let posterUrl = itemData.poster;
  const isSeries = type === "series" || type === "serie";

  let seasonPosterEntry = null;
  if (isSeries && episodeInfo.season) {
    seasonPosterEntry =
      appState.content.seasonPosters[contentId]?.[episodeInfo.season];
    if (seasonPosterEntry) {
      posterUrl =
        typeof seasonPosterEntry === "object"
          ? seasonPosterEntry.posterUrl
          : seasonPosterEntry;
    }
  }

  const historyKey = contentId;

  const totalSeasonsForTitle = Object.keys(
    appState.content.seriesEpisodes[contentId] || {},
  ).length;

  // Sufijo de temporada/parte para el título del historial.
  // Por defecto: prefijo de nombreTemporadas (ej. "P") + número interno
  // de temporada (ej. "P4").
  let seasonSuffix = `${(itemData.nombreTemporadas?.[0]?.toUpperCase()) || 'T'}${episodeInfo.season}`;

  // Algunas series (ej. JoJo's Bizarre Adventure) numeran sus "Partes" de
  // forma distinta a como están ordenadas las temporadas internamente — una
  // Parte puede abarcar el contenido de varias "temporadas" del sitio, así
  // que el número de temporada interno no coincide con el número de Parte
  // que ve el usuario (S4 interno = "Parte 5", por ejemplo). Si esa
  // temporada tiene una "etiqueta" custom definida (ej. "Parte 5"), la
  // usamos en vez de asumir season == parte.
  const etiqueta =
    typeof seasonPosterEntry === "object"
      ? (seasonPosterEntry.etiqueta || "").trim()
      : "";
  if (etiqueta) {
    const firstLetter = etiqueta[0].toUpperCase();
    const numMatch = etiqueta.match(/\d+/);
    seasonSuffix = numMatch ? `${firstLetter}${numMatch[0]}` : etiqueta;
  }

  const historyTitle = isSeries
    ? totalSeasonsForTitle > 1
      ? `${itemData.title}: ${seasonSuffix}`
      : itemData.title
    : itemData.title;

  const historyEntry = {
    type: isSeries ? "series" : "movie",
    contentId: contentId,
    title: historyTitle,
    poster: posterUrl,
    viewedAt: firebase.database.ServerValue.TIMESTAMP,
    season: isSeries ? episodeInfo.season : null,
    lastEpisode: isSeries ? episodeInfo.index : null,
    progress:
      typeof episodeInfo.progress === "number"
        ? Math.min(1, Math.max(0, episodeInfo.progress))
        : 0,
  };

  db.ref(`users/${user.uid}/history/${historyKey}`).set(historyEntry);
}

// ===========================================================
// FUNCIÓN PARA BORRAR DEL HISTORIAL (ANIMACIÓN SUAVE)
// ===========================================================
async function removeFromHistory(entryKey) {
  const user = auth.currentUser;
  if (!user) return;

  await Promise.all([
    db.ref(`users/${user.uid}/history/${entryKey}`).remove(),
    db.ref(`users/${user.uid}/roulette_watched/${entryKey}`).remove(),
  ]);
  try {
    const roulette = await getRouletteModule();
    if (roulette.unmarkMovieFromRoulette)
      await roulette.unmarkMovieFromRoulette(entryKey);
  } catch (e) {}

  const historyGrid = DOM.historyContainer.querySelector(".grid");

  const btnPressed = historyGrid.querySelector(
    `.btn-remove-history[data-key="${entryKey}"]`,
  );

  if (btnPressed) {
    const cardToRemove = btnPressed.closest(".movie-card");

    if (cardToRemove) {
      cardToRemove.style.pointerEvents = "none";

      cardToRemove.style.transition = "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)";
      cardToRemove.style.opacity = "0";
      cardToRemove.style.transform = "scale(0.8) translateY(20px)";

      setTimeout(() => {
        if (cardToRemove.parentNode) cardToRemove.remove();

        if (historyGrid.children.length === 0) {
          historyGrid.innerHTML = `<p class="empty-message" style="opacity:0; transition: opacity 0.5s;">Tu historial está vacío.</p>`;
          requestAnimationFrame(() => {
            const msg = historyGrid.querySelector(".empty-message");
            if (msg) msg.style.opacity = "1";
          });
        }
      }, 400);
    }
  } else {
    renderHistory();
  }
}

function handleWatchlistClick(button) {
  const user = auth.currentUser;
  if (!user) {
    openConfirmationModal(
      "Acción Requerida",
      "Debes iniciar sesión para usar esta función.",
      () => openAuthModal(true),
    );
    return;
  }

  const contentId = button.dataset.contentId;
  const isInList = appState.user.watchlist.has(contentId);

  if (isInList) {
    openConfirmationModal(
      "Quitar de Ver más tarde",
      "¿Estás seguro de que quieres eliminar este item de Ver Más Tarde?",
      () => removeFromWatchlist(contentId),
    );
  } else {
    addToWatchlist(contentId, button);
  }
}

async function addToWatchlist(contentId, clickedBtn = null) {
  const user = auth.currentUser;
  if (!user) return;

  const ts = Date.now();

  // Helper: update any watchlist button regardless of its class
  const setWatchlistBtnState = (btn, inList) => {
    if (!btn) return;
    btn.classList.toggle("in-list", inList);
    const hasSpan = btn.querySelector("span");
    const spanText = hasSpan ? hasSpan.textContent : null;
    const icon = `<i class="fas ${inList ? "fa-check" : "fa-plus"}"></i>`;
    btn.innerHTML = spanText ? `${icon}<span>${spanText}</span>` : icon;
    if (btn.title) btn.title = inList ? "En ver más tarde" : "+ Ver más tarde";
  };

  // Optimistic UI: update immediately
  if (clickedBtn) setWatchlistBtnState(clickedBtn, true);
  document.querySelectorAll(`.btn-watchlist[data-content-id="${contentId}"]`).forEach(btn => {
    setWatchlistBtnState(btn, true);
  });
  appState.user.watchlist.set(contentId, ts);

  try {
    await db.ref(`users/${user.uid}/watchlist/${contentId}`).set(ts);
  } catch (err) {
    // Revert on failure
    appState.user.watchlist.delete(contentId);
    if (clickedBtn) setWatchlistBtnState(clickedBtn, false);
    document.querySelectorAll(`.btn-watchlist[data-content-id="${contentId}"]`).forEach(btn => {
      setWatchlistBtnState(btn, false);
    });
    logError("addToWatchlist", err);
  }
}

async function removeFromWatchlist(contentId) {
  const user = auth.currentUser;
  if (!user) return;

  const safeId = String(contentId);

  await ErrorHandler.firebaseOperation(async () => {
    await db.ref(`users/${user.uid}/watchlist/${safeId}`).remove();
    appState.user.watchlist.delete(safeId);

    document
      .querySelectorAll(`.btn-watchlist[data-content-id="${safeId}"]`)
      .forEach((button) => {
        button.classList.remove("in-list");
        button.innerHTML = '<i class="fas fa-plus"></i>';
      });

    const myListContainer = document.getElementById("my-list-container");

    if (myListContainer && myListContainer.style.display !== "none") {
      const cardToRemove = myListContainer.querySelector(
        `.movie-card[data-content-id="${safeId}"]`,
      );

      if (cardToRemove) {
        cardToRemove.style.pointerEvents = "none";

        cardToRemove.style.transition = "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)";
        cardToRemove.style.opacity = "0";
        cardToRemove.style.transform = "scale(0.8) translateY(20px)";

        setTimeout(() => {
          if (cardToRemove.parentNode) {
            cardToRemove.parentNode.removeChild(cardToRemove);
          }

          if (appState.user.watchlist.size === 0) {
            const grid = myListContainer.querySelector(".grid");
            if (grid) {
              grid.innerHTML = `<p class="empty-message" style="opacity:0; transition: opacity 0.5s;">Tu lista de Ver Más Tarde está vacía.</p>`;
              requestAnimationFrame(() => {
                const msg = grid.querySelector(".empty-message");
                if (msg) msg.style.opacity = "1";
              });
            }
          }
        }, 400);
      } else {
        console.warn("Tarjeta no encontrada en el DOM, forzando repintado...");
        displayMyListView();
      }
    }
  });
}

// ===========================================================
// 📝 VER MÁS TARDE
// ===========================================================
let myListDataCache = [];
let myListRenderedCount = 0;
let myListActiveFilter = "all";
let myListActiveSort   = "recent";

function displayMyListView() {
  const user = auth.currentUser;
  const myListGrid = DOM.myListContainer.querySelector(".grid");
  const countEl    = document.getElementById("ml-count");

  const existingBtn = document.getElementById("mylist-load-more-btn");
  if (existingBtn) existingBtn.remove();
  const existingEmpty = DOM.myListContainer.querySelector(".ml-empty");
  if (existingEmpty) existingEmpty.remove();

  if (!user) {
    myListGrid.innerHTML = "";
    DOM.myListContainer.insertAdjacentHTML("beforeend", _mlEmptyHTML("fa-lock", "Inicia sesión", "Debes tener una cuenta para guardar contenido en Ver Más Tarde.", false));
    if (countEl) countEl.textContent = "";
    _mlSetupControls();
    return;
  }

  if (!appState.user.watchlist || appState.user.watchlist.size === 0) {
    myListGrid.innerHTML = "";
    DOM.myListContainer.insertAdjacentHTML("beforeend", _mlEmptyHTML("fa-bookmark", "Ver Más Tarde vacío", "Explora el catálogo y agrega películas o series que quieras ver.", true));
    if (countEl) countEl.textContent = "";
    _mlSetupControls();
    return;
  }

  myListGrid.innerHTML = `<div class="spinner" style="margin: 50px auto;"></div>`;

  let allContent = {
    ...appState.content.movies,
    ...appState.content.series,
  };

  if (appState.content.sagas) {
    Object.values(appState.content.sagas).forEach((sagaItems) => {
      if (sagaItems) Object.assign(allContent, sagaItems);
    });
  }

  myListDataCache = [];
  // Sort entries by timestamp descending (most recent first)
  const watchlistEntries = Array.from(appState.user.watchlist.entries())
    .sort((a, b) => b[1] - a[1]);

  watchlistEntries.forEach(([contentId]) => {
    const data = allContent[contentId];
    if (data) {
      let type = "movie";
      if (
        appState.content.series[contentId] ||
        data.type === "series" ||
        appState.content.seriesEpisodes[contentId]
      ) {
        type = "series";
      }
      const addedAt = appState.user.watchlist.get(contentId) || 0;
      myListDataCache.push({ id: contentId, data: data, type: type, addedAt });
    }
  });

  // Update header stats
  const totalMovies = myListDataCache.filter(i => i.type === "movie").length;
  const totalSeries = myListDataCache.filter(i => i.type === "series").length;
  if (countEl) {
    countEl.textContent = `${myListDataCache.length} título${myListDataCache.length !== 1 ? "s" : ""}`;
  }

  // Render stats chips
  let statsEl = DOM.myListContainer.querySelector(".ml-stats");
  if (!statsEl) {
    statsEl = document.createElement("div");
    statsEl.className = "ml-stats";
    const countElParent = countEl && countEl.parentElement;
    if (countElParent) countElParent.appendChild(statsEl);
  }
  statsEl.innerHTML = `
    ${totalMovies > 0 ? `<span class="ml-stat-chip"><i class="fas fa-film" style="margin-right:4px;opacity:.6"></i>${totalMovies} Película${totalMovies !== 1 ? "s" : ""}</span>` : ""}
    ${totalSeries > 0 ? `<span class="ml-stat-chip"><i class="fas fa-tv" style="margin-right:4px;opacity:.6"></i>${totalSeries} Serie${totalSeries !== 1 ? "s" : ""}</span>` : ""}
  `;

  myListGrid.innerHTML = "";
  myListRenderedCount = 0;

  if (myListDataCache.length === 0) {
    myListGrid.innerHTML = _mlEmptyHTML("fa-exclamation-circle", "Sin resultados", "No se encontraron los ítems guardados.", false);
    return;
  }

  _mlSetupControls();
  _mlRenderFiltered();
}

function _mlEmptyHTML(icon, title, subtitle, showCTA) {
  return `<div class="ml-empty">
    <div class="ml-empty-icon"><i class="fas ${icon}"></i></div>
    <h3>${title}</h3>
    <p>${subtitle}</p>
    ${showCTA ? `<button class="ml-empty-cta" onclick="document.querySelector('a[data-filter=\\"all\\"]').click()"><i class="fas fa-compass" style="margin-right:6px"></i>Explorar catálogo</button>` : ""}
  </div>`;
}

function _mlGetFilteredSorted() {
  let data = [...myListDataCache];
  // Filter
  if (myListActiveFilter !== "all") {
    data = data.filter(i => i.type === myListActiveFilter);
  }
  // Sort
  if (myListActiveSort === "az") {
    data.sort((a, b) => (a.data.title || "").localeCompare(b.data.title || ""));
  } else if (myListActiveSort === "za") {
    data.sort((a, b) => (b.data.title || "").localeCompare(a.data.title || ""));
  } else if (myListActiveSort === "rating") {
    data.sort((a, b) => (parseFloat(b.data.rating) || 0) - (parseFloat(a.data.rating) || 0));
  }
  // "recent" sorts by addedAt timestamp descending
  if (myListActiveSort === "recent") {
    data.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }
  return data;
}

function _mlRenderFiltered() {
  const myListGrid = DOM.myListContainer.querySelector(".grid");
  const existingBtn = document.getElementById("mylist-load-more-btn");
  if (existingBtn) existingBtn.remove();
  const existingEmpty = DOM.myListContainer.querySelector(".ml-empty");
  if (existingEmpty) existingEmpty.remove();

  const filtered = _mlGetFilteredSorted();
  myListGrid.innerHTML = "";
  myListRenderedCount = 0;

  if (filtered.length === 0) {
    const existingEmpty2 = DOM.myListContainer.querySelector(".ml-empty");
    if (existingEmpty2) existingEmpty2.remove();
    const label = myListActiveFilter === "movie" ? "películas" : "series";
    DOM.myListContainer.insertAdjacentHTML("beforeend", _mlEmptyHTML("fa-filter", "Sin resultados", `No tienes ${label} en Ver Más Tarde todavía.`, false));
    return;
  }

  const BATCH_SIZE = UI.ITEMS_PER_LOAD || 24;
  const batch = filtered.slice(0, BATCH_SIZE);
  const fragment = document.createDocumentFragment();
  batch.forEach((item) => {
    const card = createMovieCardElement(item.id, item.data, item.type, "grid", false, { source: "my-list" });
    fragment.appendChild(card);
  });
  myListGrid.appendChild(fragment);
  myListRenderedCount = batch.length;

  if (myListRenderedCount < filtered.length) {
    const loadBtn = document.createElement("button");
    loadBtn.id = "mylist-load-more-btn";
    loadBtn.className = "btn btn-primary";
    loadBtn.innerHTML = 'Cargar más <i class="fas fa-chevron-down"></i>';
    loadBtn.style.cssText = "display: block; margin: 30px auto; min-width: 200px;";
    loadBtn.onclick = () => {
      const nextBatch = _mlGetFilteredSorted().slice(myListRenderedCount, myListRenderedCount + BATCH_SIZE);
      const frag = document.createDocumentFragment();
      nextBatch.forEach(item => {
        frag.appendChild(createMovieCardElement(item.id, item.data, item.type, "grid", false, { source: "my-list" }));
      });
      myListGrid.appendChild(frag);
      myListRenderedCount += nextBatch.length;
      if (myListRenderedCount >= _mlGetFilteredSorted().length) loadBtn.remove();
    };
    DOM.myListContainer.appendChild(loadBtn);
  }
}

function _mlSetupControls() {
  // Filter pills
  document.querySelectorAll(".ml-pill").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".ml-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      myListActiveFilter = btn.dataset.mlFilter;
      _mlRenderFiltered();
    };
  });

  // Custom sort dropdown
  const dd      = document.getElementById("ml-sort-dropdown");
  const trigger = document.getElementById("ml-sort-trigger");
  const menu    = document.getElementById("ml-sort-menu");
  const label   = document.getElementById("ml-sort-label");

  if (!dd || !trigger || !menu) return;

  // Toggle open/close
  trigger.onclick = (e) => {
    e.stopPropagation();
    const isOpen = dd.classList.contains("open");
    if (isOpen) {
      dd.classList.remove("open");
      return;
    }
    // Position menu using fixed coords to escape any stacking context
    const rect = trigger.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top  = (rect.bottom + 6) + "px";
    menu.style.left = rect.left + "px";
    menu.style.zIndex = "9999";
    dd.classList.add("open");
  };

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (!dd.contains(e.target)) dd.classList.remove("open");
  }, { capture: false });

  // Option selection
  menu.querySelectorAll(".ml-sort-option").forEach(opt => {
    // Restore active state
    if (opt.dataset.value === myListActiveSort) opt.classList.add("active");
    opt.onclick = () => {
      menu.querySelectorAll(".ml-sort-option").forEach(o => o.classList.remove("active"));
      opt.classList.add("active");
      myListActiveSort = opt.dataset.value;
      if (label) label.textContent = opt.textContent;
      dd.classList.remove("open");
      _mlRenderFiltered();
    };
  });
}

// ===========================================================
// 🧠 HISTORIAL INTELIGENTE
// ===========================================================
let historyDataCache = [];
let historyRenderedCount = 0;
let historyActiveFilter = "all";
let historyActiveSort = "recent";

function getHistoryFiltered() {
  let items = historyActiveFilter === "all"
    ? historyDataCache
    : historyDataCache.filter((i) => i.type === historyActiveFilter);

  if (historyActiveSort === "az") {
    items = [...items].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  } else if (historyActiveSort === "za") {
    items = [...items].sort((a, b) => (b.title || "").localeCompare(a.title || ""));
  }
  return items;
}

function updateHistoryHeader() {
  const total = historyDataCache.length;
  const movies = historyDataCache.filter((i) => i.type === "movie").length;
  const series = historyDataCache.filter((i) => i.type === "series").length;

  const countEl = document.getElementById("history-count");
  if (countEl) countEl.textContent = `${total} título${total !== 1 ? "s" : ""}`;

  const statsEl = document.getElementById("history-stats");
  if (statsEl) {
    statsEl.innerHTML = "";
    if (movies > 0) {
      const chip = document.createElement("span");
      chip.className = "ml-stat-chip";
      chip.innerHTML = `<i class="fas fa-film" style="margin-right:5px;"></i>${movies} Película${movies !== 1 ? "s" : ""}`;
      statsEl.appendChild(chip);
    }
    if (series > 0) {
      const chip = document.createElement("span");
      chip.className = "ml-stat-chip";
      chip.innerHTML = `<i class="fas fa-tv" style="margin-right:5px;"></i>${series} Serie${series !== 1 ? "s" : ""}`;
      statsEl.appendChild(chip);
    }
  }
}

function setupHistoryControls() {
  document.querySelectorAll("[data-history-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      historyActiveFilter = btn.dataset.historyFilter;
      document.querySelectorAll("[data-history-filter]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderHistoryGrid();
    });
  });

  const trigger = document.getElementById("history-sort-trigger");
  const dropdown = document.getElementById("history-sort-dropdown");
  if (trigger && dropdown) {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("open");
    });
    document.addEventListener("click", () => dropdown.classList.remove("open"));
  }

  document.querySelectorAll("[data-history-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      historyActiveSort = btn.dataset.historySort;
      document.querySelectorAll("[data-history-sort]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const labelEl = document.getElementById("history-sort-label");
      if (labelEl) labelEl.textContent = btn.textContent;
      renderHistoryGrid();
    });
  });
}

function renderHistoryGrid() {
  const historyGrid = DOM.historyContainer.querySelector(".grid");
  const existingBtn = document.getElementById("history-load-more-btn");
  if (existingBtn) existingBtn.remove();
  historyGrid.innerHTML = "";
  historyRenderedCount = 0;
  appendHistoryBatch();
}

function renderHistory() {
  const user = auth.currentUser;
  const historyGrid = DOM.historyContainer.querySelector(".grid");

  const existingBtn = document.getElementById("history-load-more-btn");
  if (existingBtn) existingBtn.remove();

  if (!user) {
    historyGrid.innerHTML = `<p class="empty-message">Debes iniciar sesión para ver tu historial.</p>`;
    return;
  }

  historyGrid.innerHTML = `<div class="spinner" style="margin: 50px auto;"></div>`;

  db.ref(`users/${user.uid}/history`)
    .orderByChild("viewedAt")
    .once("value", (snapshot) => {
      if (!snapshot.exists()) {
        historyGrid.innerHTML = `<p class="empty-message">Tu historial está vacío.</p>`;
        const countEl = document.getElementById("history-count");
        if (countEl) countEl.textContent = "0 títulos";
        const statsEl = document.getElementById("history-stats");
        if (statsEl) statsEl.innerHTML = "";
        return;
      }

      historyDataCache = [];
      snapshot.forEach((child) => {
        const item = child.val();
        item.key = child.key;
        historyDataCache.push(item);
      });

      historyDataCache.reverse();
      historyActiveFilter = "all";
      historyActiveSort = "recent";

      document.querySelectorAll("[data-history-filter]").forEach((b) => b.classList.remove("active"));
      const allPill = document.querySelector("[data-history-filter='all']");
      if (allPill) allPill.classList.add("active");
      document.querySelectorAll("[data-history-sort]").forEach((b) => b.classList.remove("active"));
      const recentOpt = document.querySelector("[data-history-sort='recent']");
      if (recentOpt) recentOpt.classList.add("active");
      const labelEl = document.getElementById("history-sort-label");
      if (labelEl) labelEl.textContent = "Más recientes";

      updateHistoryHeader();
      setupHistoryControls();

      historyGrid.innerHTML = "";
      historyRenderedCount = 0;
      appendHistoryBatch();
    });
}

function appendHistoryBatch() {
  const historyGrid = DOM.historyContainer.querySelector(".grid");
  const BATCH_SIZE = 24;

  const filtered = getHistoryFiltered();
  const nextBatch = filtered.slice(historyRenderedCount, historyRenderedCount + BATCH_SIZE);

  if (nextBatch.length === 0) return;

  const fragment = document.createDocumentFragment();

  nextBatch.forEach((item) => {
    const options = {
      source: "history",
      season: item.season,
      lastEpisode: item.lastEpisode,
    };
    const card = createMovieCardElement(
      item.contentId,
      item,
      item.type,
      "grid",
      false,
      options,
    );

    const removeButton = document.createElement("button");
    removeButton.className = "btn-remove-history";
    removeButton.dataset.key = item.key;
    removeButton.innerHTML = `<i class="fas fa-times"></i>`;
    card.appendChild(removeButton);

    const infoOverlay = document.createElement("div");
    infoOverlay.className = "history-item-overlay";
    const dateStr = item.viewedAt
      ? new Date(item.viewedAt).toLocaleDateString()
      : "Reciente";
    infoOverlay.innerHTML = `<h4 class="history-item-title">${item.title}</h4><p class="history-item-date">Visto: ${dateStr}</p>`;
    card.appendChild(infoOverlay);

    fragment.appendChild(card);
  });

  historyGrid.appendChild(fragment);
  historyRenderedCount += nextBatch.length;

  let loadBtn = document.getElementById("history-load-more-btn");

  if (historyRenderedCount < filtered.length) {
    if (!loadBtn) {
      loadBtn = document.createElement("button");
      loadBtn.id = "history-load-more-btn";
      loadBtn.className = "btn btn-primary";
      loadBtn.innerHTML = 'Cargar más <i class="fas fa-chevron-down"></i>';
      loadBtn.style.cssText = "display: block; margin: 30px auto; min-width: 200px;";
      loadBtn.onclick = appendHistoryBatch;
      DOM.historyContainer.appendChild(loadBtn);
    } else {
      DOM.historyContainer.appendChild(loadBtn);
    }
  } else {
    if (loadBtn) loadBtn.remove();
  }
}

function setupRealtimeHistoryListener(user) {
  if (appState.user.historyListenerRef) {
    appState.user.historyListenerRef.off("value");
  }

  if (user) {
    appState.user.historyListenerRef = db
      .ref(`users/${user.uid}/history`)
      .orderByChild("viewedAt");

    appState.user.historyListenerRef.on("value", (snapshot) => {
      console.log("🔔 Historial actualizado - Regenerando carrusel...");
      clearTimeout(appState.player.historyUpdateDebounceTimer);

      appState.player.historyUpdateDebounceTimer = setTimeout(() => {
        console.log("📺 Items en historial:", snapshot.numChildren());
        generateContinueWatchingCarousel(snapshot);
        if (
          DOM.historyContainer &&
          DOM.historyContainer.style.display === "block"
        ) {
          renderHistory();
        }
      }, 250);
    });
  }
}

// ===========================================================
// 7. MODAL DE CONFIRMACIÓN
// ===========================================================
document.addEventListener("DOMContentLoaded", () => {
  if (DOM.confirmDeleteBtn && DOM.cancelDeleteBtn && DOM.confirmationModal) {
    DOM.confirmDeleteBtn.addEventListener("click", () => {
      if (typeof DOM.confirmationModal.onConfirm === "function") {
        DOM.confirmationModal.onConfirm();
        hideConfirmationModal();
      }
    });

    DOM.cancelDeleteBtn.addEventListener("click", () =>
      hideConfirmationModal(),
    );
  }
});

function hideConfirmationModal() {
  DOM.confirmationModal.classList.remove("show");
  DOM.confirmationModal.onConfirm = null;
  document.getElementById("confirm-delete-btn").textContent = "Confirmar";
  if (!document.querySelector(".modal.show")) {
    document.body.classList.remove("modal-open");
  }
}

function openConfirmationModal(title, message, onConfirm) {
  const modal = document.getElementById("confirmation-modal");
  if (!modal) return;

  const titleEl = modal.querySelector("h2");
  const messageEl = modal.querySelector("p");

  if (titleEl) titleEl.textContent = title;
  if (messageEl) messageEl.textContent = message;

  DOM.confirmationModal.onConfirm = onConfirm;

  modal.classList.add("show");
  document.body.classList.add("modal-open");
}

function getLatestSeriesDate(seriesId) {
  const allEpisodes = appState.content.seriesEpisodes[seriesId];
  if (!allEpisodes) return 0;

  let flatEpisodes = [];
  if (Array.isArray(allEpisodes)) {
    flatEpisodes = allEpisodes;
  } else {
    flatEpisodes = Object.values(allEpisodes).flat();
  }

  let maxDate = 0;
  const now = new Date();
  const DAYS_THRESHOLD = 5;

  flatEpisodes.forEach((ep) => {
    if (!ep.releaseDate) return;
    const rDate = new Date(ep.releaseDate);
    if (isNaN(rDate.getTime())) return;

    const diffTime = now - rDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (
      diffDays <= DAYS_THRESHOLD &&
      diffDays >= 0 &&
      rDate.getTime() > maxDate
    ) {
      maxDate = rDate.getTime();
    }
  });

  return maxDate;
}

function isDateRecent(dateString) {
  if (!dateString) return false;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return false;

  const now = new Date();
  const diffTime = now - date;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays <= 5 && diffDays >= 0;
}

function hasRecentSeasonFromPosters(seriesId) {
  const posters = appState.content.seasonPosters[seriesId];
  if (!posters) return false;

  return Object.values(posters).some((seasonData) => {
    const date = typeof seasonData === "object" ? seasonData.date_added : null;
    return isDateRecent(date);
  });
}

function hasRecentEpisodes(seriesId) {
  const allEpisodes = appState.content.seriesEpisodes[seriesId];
  if (!allEpisodes) return false;

  let flatEpisodes = [];
  if (Array.isArray(allEpisodes)) {
    flatEpisodes = allEpisodes;
  } else {
    flatEpisodes = Object.values(allEpisodes).flat();
  }

  return flatEpisodes.some((ep) => isDateRecent(ep.releaseDate));
}

// -----------------------------------------------------------
// 2. FUNCIÓN DE CREACIÓN DE TARJETAS (ACTUALIZADA)
// -----------------------------------------------------------
function createMovieCardElement(
  id,
  data,
  type,
  layout = "carousel",
  lazy = false,
  options = {},
) {
  const card = document.createElement("div");
  card.className = `movie-card ${layout === "carousel" ? "carousel-card" : ""}`;
  card.dataset.contentId = id;

  let badgesAccumulator = "";
  const isNewContent = isDateRecent(data.date_added);
  const seriesStatus = (
    data.seriesStatus ||
    data.series_status ||
    ""
  ).toLowerCase();

  if (options.source !== "continuar-viendo") {
    if (type === "series") {
      const hasNewSeason = hasRecentSeasonFromPosters(id);
      const hasNewEp = hasRecentEpisodes(id);

      if (isNewContent || seriesStatus === "estreno")
        badgesAccumulator += `<div class="new-episode-badge badge-estreno">ESTRENO</div>`;

      if (hasNewSeason || seriesStatus === "nueva_temporada")
        badgesAccumulator += `<div class="new-episode-badge badge-season">NUEVA TEMP</div>`;

      if ((hasNewEp && !hasNewSeason) || seriesStatus === "nuevo_capitulo")
        badgesAccumulator += `<div class="new-episode-badge badge-episode">NUEVO CAP</div>`;
    } else {
      if (data.estado && data.estado.toLowerCase() === "vetada") {
        badgesAccumulator += `<div class="new-episode-badge badge-vetada">VETADA</div>`;
      } else if (data.estado && data.estado.toLowerCase() === "mantenimiento") {
        badgesAccumulator += `<div class="new-episode-badge badge-mantenimiento">MANT.</div>`;
      } else if (data.estado && data.estado.trim() !== "") {
        badgesAccumulator += `<div class="new-episode-badge badge-proximamente">PRÓXIMO</div>`;
      } else if (isNewContent || seriesStatus === "estreno") {
        badgesAccumulator += `<div class="new-episode-badge badge-estreno">ESTRENO</div>`;
      }
    }
  }

  let ribbonHTML =
    badgesAccumulator !== ""
      ? `<div class="badges-container">${badgesAccumulator}</div>`
      : "";

  card.onclick = (e) => {
    if (
      e.target.closest(".btn-watchlist") ||
      e.target.closest(".btn-remove-history") ||
      e.target.closest(".btn-remove-continue-watching")
    )
      return;

    const seasonMatch = data.title.match(/\(T(\d+)\)$/);
    if (seasonMatch) {
      (async () => {
        const player = await getPlayerModule();
        player.openSeriesPlayerDirectlyToSeason(id, seasonMatch[1]);
      })();
    } else if (
      options.source === "continuar-viendo" &&
      type === "series" &&
      options.season != null &&
      options.lastEpisode != null
    ) {
      (async () => {
        await openSeriesDetailView(id);
        const player = await getPlayerModule();
        player.playEpisodeInDetailView(id, options.season, options.lastEpisode); // ← usa la función correcta
      })();
    } else if (
      options.source === "history" &&
      type === "series" &&
      options.season
    ) {
      (async () => {
        const player = await getPlayerModule();
        player.playEpisodeInDetailView(id, options.season, options.lastEpisode);
      })();
    } else {
      openDetailsModal(id, type);
    }
  };

  let watchlistBtnHTML = "";

  if (options.source === "continuar-viendo" && options.historyKey) {
    watchlistBtnHTML = `<button class="btn-remove-continue-watching" data-history-key="${options.historyKey}"><i class="fas fa-times"></i></button>`;
  } else if (auth.currentUser && options.source !== "history") {
    // En grid/catálogo se oculta el botón — la lista se gestiona desde el modal/reproductor
    const isInList = appState.user.watchlist.has(id);
    const isGridLayout = layout === "grid";

    if (!isGridLayout || options.source === "my-list") {
      let iconClass = isInList ? "fa-check" : "fa-plus";
      if (options.source === "my-list") iconClass = "fa-times";
      const inListClass = isInList ? "in-list" : "";
      const extraClass = options.source === "my-list" ? " btn-remove-from-list" : "";
      watchlistBtnHTML = `<button class="btn-watchlist${extraClass} ${inListClass}" data-content-id="${id}"><i class="fas ${iconClass}"></i></button>`;
    }
  }

  let imageUrl = data.poster;

  if (options.source === "continuar-viendo" && options.episodeThumbnail) {
    imageUrl = options.episodeThumbnail;
  }

  if (typeof imageUrl === "object" && imageUrl?.posterUrl)
    imageUrl = imageUrl.posterUrl;
  if (!imageUrl) imageUrl = data.banner || "";

  const img = new Image();
  img.alt = data.title;
  img.addEventListener("load", () => {
    // Quitar el posicionamiento temporal usado mientras estaba dentro del placeholder
    img.style.position = "";
    img.style.inset = "";
    img.style.width = "";
    img.style.height = "";
    img.style.objectFit = "";

    const placeholder = card.querySelector(".img-container-placeholder");
    if (placeholder) placeholder.replaceWith(img);
    card.classList.add("img-loaded");

    const isVetada =
      type === "movie" && data.estado && data.estado.toLowerCase() === "vetada";
    if (isVetada) {
      img.style.filter = "grayscale(100%)";
    }
  });

  const ratingHTML =
    reviewsModule && reviewsModule.getStarsHTML
      ? `<div class="card-rating-container">${reviewsModule.getStarsHTML(appState.content.averages[id], true)}</div>`
      : '<div class="card-rating-container"></div>';

  card.innerHTML = `${ribbonHTML}<div class="img-container-placeholder"></div>${ratingHTML}${watchlistBtnHTML}`;

  // La imagen se coloca dentro del placeholder (con tamaño real para que el
  // IntersectionObserver pueda detectarla) y solo se descarga cuando entra
  // en viewport gracias a lazyLoader.observe().
  const imgPlaceholder = card.querySelector(".img-container-placeholder");
  if (imgPlaceholder) {
    imgPlaceholder.style.position = "relative";
    img.style.position = "absolute";
    img.style.inset = "0";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    imgPlaceholder.appendChild(img);
  }

  img.dataset.src = imageUrl;
  if (lazyLoader && imageUrl) {
    lazyLoader.observe(img);
  } else {
    img.src = imageUrl;
  }

  if (
    options.source === "continuar-viendo" &&
    (options.episodeTitle || options.seriesTitle)
  ) {
    const overlay = document.createElement("div");
    overlay.className = "continue-watching-overlay";

    let episodeInfo = "";
    if (options.season != null && options.lastEpisode != null) {
      const episodeNum = parseInt(options.lastEpisode) + 1;
      if (options.nombreEspecial) {
        // "Parte 2" → "P2 E3", "Stage 3" → "S3 E5"
        const firstLetter = options.nombreEspecial[0].toUpperCase();
        const numMatch = options.nombreEspecial.match(/\d+/);
        const abbr = numMatch ? `${firstLetter}${numMatch[0]}` : firstLetter;
        episodeInfo = `${abbr} E${episodeNum}`;
      } else if (options.totalSeasons > 1) {
        const _word = options.nombreTemporadas || "";
        const _prefix = _word ? _word[0].toUpperCase() : "T";
        episodeInfo = `${_prefix}${options.season} E${episodeNum}`;
      } else {
        episodeInfo = `Episodio ${episodeNum}`;
      }
    }

    overlay.innerHTML = `
            <div class="cw-overlay-content">
                <p class="cw-series-title">${options.seriesTitle || data.title}</p>
                <p class="cw-episode-number">${episodeInfo}</p>
                ${options.episodeTitle ? `<p class="cw-episode-title">${options.episodeTitle}</p>` : ""}
            </div>
        `;
    card.appendChild(overlay);

    // ─── Barra de progreso exacta ──────────────────────────────────────
    // Muestra cuánto del capítulo ya se vio, basado en el % de avance
    // guardado junto con la entrada del historial (currentTime / duration).
    const progressRatio =
      typeof options.progress === "number"
        ? Math.min(1, Math.max(0, options.progress))
        : 0;
    if (progressRatio > 0) {
      const progressBar = document.createElement("div");
      progressBar.className = "cw-progress-bar";
      progressBar.innerHTML = `<div class="cw-progress-fill" style="width:${(progressRatio * 100).toFixed(2)}%"></div>`;
      card.appendChild(progressBar);
    }
  }

  const watchBtn = card.querySelector(".btn-watchlist");
  if (watchBtn) {
    watchBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleWatchlistClick(watchBtn);
    };
  }

  const removeBtn = card.querySelector(".btn-remove-continue-watching");
  if (removeBtn) {
    removeBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const seriesTitle = options.seriesTitle || data.title;
      openConfirmationModal(
        "Eliminar de Continuar Viendo",
        `¿Estás seguro de que quieres eliminar "${seriesTitle}" de tu historial?`,
        () => removeFromContinueWatching(removeBtn.dataset.historyKey, card),
      );
    };
  }

  return card;
}

async function removeFromContinueWatching(historyKey, cardElement) {
  const user = auth.currentUser;
  if (!user || !historyKey) return;

  try {
    cardElement.style.transition = "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)";
    cardElement.style.opacity = "0";
    cardElement.style.transform = "scale(0.8) translateY(20px)";

    await db.ref(`users/${user.uid}/history/${historyKey}`).remove();

    setTimeout(() => {
      if (cardElement.parentNode) {
        cardElement.remove();
      }

      const carousel = document.getElementById("continue-watching-carousel");
      if (carousel) {
        const track = carousel.querySelector(".carousel-track");
        if (track && track.children.length === 0) {
          carousel.remove();
        }
      }
    }, 400);

    console.log("✅ Removido de Continuar Viendo:", historyKey);
  } catch (error) {
    console.error("❌ Error al remover de Continuar Viendo:", error);
  }
}

function getLatestUpdateTimestamp(id, data, type) {
  let maxTimestamp = 0;

  if (data.date_added) {
    const d = new Date(data.date_added);
    if (!isNaN(d.getTime()) && isDateRecent(data.date_added)) {
      maxTimestamp = Math.max(maxTimestamp, d.getTime());
    }
  }

  if (type === "movie") return maxTimestamp;

  const posters = appState.content.seasonPosters[id];
  if (posters) {
    Object.values(posters).forEach((p) => {
      if (typeof p === "object" && p.date_added) {
        const d = new Date(p.date_added);
        if (!isNaN(d.getTime()) && isDateRecent(p.date_added)) {
          maxTimestamp = Math.max(maxTimestamp, d.getTime());
        }
      }
    });
  }

  const allEpisodes = appState.content.seriesEpisodes[id];
  if (allEpisodes) {
    const flatEpisodes = Array.isArray(allEpisodes)
      ? allEpisodes
      : Object.values(allEpisodes).flat();
    flatEpisodes.forEach((ep) => {
      if (ep.releaseDate) {
        const d = new Date(ep.releaseDate);
        if (!isNaN(d.getTime()) && isDateRecent(ep.releaseDate)) {
          maxTimestamp = Math.max(maxTimestamp, d.getTime());
        }
      }
    });
  }

  return maxTimestamp;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// ===========================================================
// 10. 🎯 EXPORTAR PARA USO GLOBAL
// ===========================================================
window.ErrorHandler = ErrorHandler;
window.cacheManager = cacheManager;
window.lazyLoader = lazyLoader;
window.showCacheStats = () => {
  const stats = {
    itemCount: localStorage.length,
    version: cacheManager.version,
    contentCached: !!cacheManager.get(cacheManager.keys.content),
    metadataCached: !!cacheManager.get(cacheManager.keys.metadata),
  };
  console.table(stats);
  return stats;
};

function setupPageVisibilityHandler() {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearInterval(appState.ui.heroInterval);
      document.body.classList.add("tab-inactive");
    } else {
      document.body.classList.remove("tab-inactive");

      setTimeout(() => {
        startHeroInterval();

        if (DOM.heroSection) {
          DOM.heroSection.style.transform = "translateZ(0)";
        }
      }, 1000);
    }
  });
}

window.closeAllModals = closeAllModals;

function getStarsHTML(rating, isSmall = true) {
  if (reviewsModule && reviewsModule.getStarsHTML) {
    return reviewsModule.getStarsHTML(rating, isSmall);
  }
  if (!rating || rating === "0.0" || rating === 0) return "";
  return `
        <div class="star-rating-display ${isSmall ? "small" : "large"}" 
             title="${rating} de 5 estrellas">
            <i class="fas fa-star"></i>
            <span class="rating-number">${rating}</span>
        </div>
    `;
}

function updateVisibleRatings() {
  document.querySelectorAll(".movie-card").forEach((card) => {
    const contentId = card.dataset.contentId;
    const ratingContainer = card.querySelector(".card-rating-container");

    if (ratingContainer && contentId && appState.content.averages) {
      const rating = appState.content.averages[contentId];
      ratingContainer.innerHTML = getStarsHTML(rating, true);
    }
  });
}

window.showNotification = function (message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const icon = type === "success" ? "fa-check-circle" : "fa-exclamation-circle";
  const color = type === "success" ? "#2ecc71" : "#e74c3c";

  toast.innerHTML = `
        <i class="fas ${icon} toast-icon" style="color: ${color}"></i>
        <span class="toast-message">${message}</span>
    `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "fadeOutToast 0.5s ease forwards";
    setTimeout(() => toast.remove(), 500);
  }, 3000);
};

window.openSmartReviewModal = async (contentId, type, title) => {
  if (!firebase.auth().currentUser) {
    if (window.openConfirmationModal) {
      window.openConfirmationModal(
        "Inicia Sesión",
        "Necesitas una cuenta para escribir reseñas.",
        () => window.openAuthModal(true),
      );
    }
    return;
  }

  const module = await import("./features/reviews.js?v=8");

  module.initReviews({
    appState,
    DOM,
    auth,
    db,
    ErrorHandler: window.ErrorHandler,
    ModalManager: window.ModalManager,
  });

  setTimeout(() => {
    module.openReviewModal(true, {
      contentId: contentId,
      contentTitle: title,
      contentType: type,
    });
  }, 50);
};

// ===========================================================
// 🚪 LOGOUT
// ===========================================================

function mostrarModalLogout() {
  const confirmModal = document.getElementById("confirmation-modal");
  if (!confirmModal) {
    console.error("❌ Modal no encontrado");
    if (confirm("¿Cerrar sesión?")) {
      ejecutarLogout();
    }
    return;
  }

  const confirmTitle = confirmModal.querySelector("h2");
  const confirmText = confirmModal.querySelector("p");
  const confirmBtn = document.getElementById("confirm-delete-btn");
  const cancelBtn = document.getElementById("cancel-delete-btn");
  const modalContent = confirmModal.querySelector(
    ".confirmation-modal-content",
  );

  if (confirmTitle) confirmTitle.textContent = "¿Cerrar sesión?";
  if (confirmText)
    confirmText.textContent =
      "Se cerrará tu sesión y volverás al modo invitado.";
  if (confirmBtn) confirmBtn.textContent = "Cerrar Sesión";

  if (modalContent) {
    modalContent.onclick = (e) => {
      e.stopPropagation();
    };
  }

  confirmModal.style.display = "flex";
  confirmModal.style.zIndex = "99999";
  confirmModal.style.pointerEvents = "auto";

  setTimeout(() => {
    document.body.classList.add("modal-open");
    confirmModal.classList.add("show");
  }, 10);

  if (confirmBtn) {
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

    let confirmExecuted = false;

    const executeConfirm = (e) => {
      if (confirmExecuted) return;
      confirmExecuted = true;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      cerrarModal(confirmModal);
      ejecutarLogout();
    };

    newConfirmBtn.addEventListener("touchstart", executeConfirm, {
      passive: false,
    });
    newConfirmBtn.addEventListener("click", executeConfirm, true);
    newConfirmBtn.onclick = executeConfirm;
  }

  if (cancelBtn) {
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    let cancelExecuted = false;

    const executeCancel = (e) => {
      if (cancelExecuted) return;
      cancelExecuted = true;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      cerrarModal(confirmModal);
    };

    newCancelBtn.addEventListener("touchstart", executeCancel, {
      passive: false,
    });
    newCancelBtn.addEventListener("click", executeCancel, true);
    newCancelBtn.onclick = executeCancel;
  }

  confirmModal.onclick = (e) => {
    if (e.target === confirmModal) {
      cerrarModal(confirmModal);
    }
  };
}

function cerrarModal(confirmModal) {
  if (!confirmModal) return;

  confirmModal.classList.remove("show");
  document.body.classList.remove("modal-open");

  setTimeout(() => {
    confirmModal.style.display = "none";
    confirmModal.style.pointerEvents = "none";
  }, 300);
}

function ejecutarLogout() {
  if (typeof auth === "undefined" || !auth) {
    console.warn("⚠️ Auth no disponible, limpiando solo localStorage");
    localStorage.removeItem("cineCornetoUser");
    window.location.reload();
    return;
  }

  auth
    .signOut()
    .then(() => {
      localStorage.removeItem("cineCornetoUser");

      if (typeof appState !== "undefined") {
        appState.user = {
          watchlist: new Map(),
          historyListenerRef: null,
        };

        if (appState.user.historyListenerRef) {
          appState.user.historyListenerRef.off();
          appState.user.historyListenerRef = null;
        }
      }

      const profileHubEmail = document.getElementById("profile-hub-email");
      if (profileHubEmail) profileHubEmail.textContent = "Visitante";

      const hubLoggedIn = document.getElementById("hub-logged-in-content");
      const hubGuest = document.getElementById("hub-guest-content");
      if (hubLoggedIn) hubLoggedIn.style.display = "none";
      if (hubGuest) hubGuest.style.display = "block";

      setTimeout(() => window.location.reload(), 500);
    })
    .catch((error) => {
      console.error("❌ Error:", error);
      localStorage.removeItem("cineCornetoUser");
      window.location.reload();
    });
}

document.addEventListener(
  "click",
  function (e) {
    const target = e.target;

    const logoutBtn =
      target.closest("#logout-btn") ||
      target.closest("#logout-btn-hub") ||
      target.closest("#mobile-logout-btn") ||
      target.closest(".logout-action") ||
      target.closest('a[href="#"][id*="logout"]') ||
      target.closest(".profile-hub-menu-item.logout");

    if (logoutBtn) {
      e.preventDefault();
      e.stopPropagation();
      mostrarModalLogout();
      return;
    }
  },
  true,
);

function attachDirectListeners() {
  const ids = ["logout-btn", "logout-btn-hub", "mobile-logout-btn"];

  ids.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.removeEventListener("click", handleLogoutClick);
      btn.addEventListener("click", handleLogoutClick, true);

      btn.removeEventListener("touchstart", handleLogoutClick);
      btn.addEventListener("touchstart", handleLogoutClick, { passive: false });
    }
  });

  const logoutLinks = document.querySelectorAll(
    ".profile-hub-menu-item.logout",
  );
  logoutLinks.forEach((link) => {
    link.removeEventListener("click", handleLogoutClick);
    link.addEventListener("click", handleLogoutClick, true);

    link.removeEventListener("touchstart", handleLogoutClick);
    link.addEventListener("touchstart", handleLogoutClick, { passive: false });
  });
}

function handleLogoutClick(e) {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  mostrarModalLogout();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attachDirectListeners);
} else {
  attachDirectListeners();
}

setTimeout(attachDirectListeners, 1000);

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType === 1) {
        if (
          node.id === "logout-btn-hub" ||
          node.id === "logout-btn" ||
          node.classList?.contains("logout")
        ) {
          attachDirectListeners();
        }
        const logoutBtns = node.querySelectorAll?.(
          "#logout-btn, #logout-btn-hub, .logout",
        );
        if (logoutBtns?.length > 0) {
          attachDirectListeners();
        }
      }
    });
  });
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// ===========================================================
// LOGO SETTINGS
// ===========================================================
window._heroEditPaused = false;

function getLogoSlot(base) {
  const device = window.innerWidth <= 768 ? "mobile" : "desktop";
  return base + "-" + device;
}

// ── Logo SVG: ajuste automático de viewBox para recortar espacios vacíos ──────
const _svgTrimCache = new Map();

async function _getTrimmedSvgUrl(url) {
  if (!url || !url.toLowerCase().endsWith(".svg")) return url;
  if (_svgTrimCache.has(url)) return _svgTrimCache.get(url);

  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const svgText = await res.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg) return url;

    const CANVAS_W = 800,
      CANVAS_H = 310;
    svg.setAttribute("width", CANVAS_W);
    svg.setAttribute("height", CANVAS_H);
    svg.setAttribute("viewBox", "0 0 800 310");

    const svgBlob = new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    });
    const blobUrl = URL.createObjectURL(svgBlob);

    const bounds = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = CANVAS_W;
        canvas.height = CANVAS_H;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
        URL.revokeObjectURL(blobUrl);
        const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
        let minX = CANVAS_W,
          minY = CANVAS_H,
          maxX = 0,
          maxY = 0,
          found = false;
        for (let y = 0; y < CANVAS_H; y++) {
          for (let x = 0; x < CANVAS_W; x++) {
            if (data[(y * CANVAS_W + x) * 4 + 3] > 10) {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
              found = true;
            }
          }
        }
        resolve(found ? { minX, minY, maxX, maxY } : null);
      };
      img.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        resolve(null);
      };
      img.src = blobUrl;
    });

    if (!bounds) return url;
    const pad = 6;
    const vx = Math.max(0, bounds.minX - pad);
    const vy = Math.max(0, bounds.minY - pad);
    const vw = Math.min(CANVAS_W, bounds.maxX + pad) - vx;
    const vh = Math.min(CANVAS_H, bounds.maxY + pad) - vy;
    if (vw <= 0 || vh <= 0) return url;

    svg.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
    svg.removeAttribute("width");
    svg.removeAttribute("height");

    const objectUrl = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: "image/svg+xml",
      }),
    );
    _svgTrimCache.set(url, objectUrl);
    return objectUrl;
  } catch (e) {
    console.warn("[setLogoSrc] No se pudo trimar SVG:", e);
    return url;
  }
}

/**
 * Asigna el src de un logo <img> trimando automáticamente el viewBox
 * del SVG para eliminar espacios vacíos a los lados.
 * Para PNG/otros formatos actúa igual que asignar .src directamente.
 */
async function setLogoSrc(imgEl, url) {
  if (!imgEl || !url) return;
  imgEl.src = url; // mostrar de inmediato para evitar flash vacío
  const trimmedUrl = await _getTrimmedSvgUrl(url);
  if (imgEl.isConnected) imgEl.src = trimmedUrl;
}

function loadLogoSettings(id, container, callback, slot = "modal-desktop") {
  const slotRef = db.ref("logoSettings/" + id + "/" + slot);
  const legacyRef = db.ref("logoSettings/" + id);

  slotRef
    .once("value")
    .then((snap) => {
      const s = snap.val();
      if (s && (s.x !== undefined || s.scale !== undefined)) {
        applyLogoTransform(container, s);
        if (callback) callback();
      } else {
        legacyRef
          .once("value")
          .then((legacySnap) => {
            const legacy = legacySnap.val();
            if (legacy && legacy.x !== undefined) {
              const slots = [
                "hero-desktop",
                "hero-mobile",
                "modal-desktop",
                "modal-mobile",
              ];
              const updates = {};
              slots.forEach((k) => {
                updates[k] = legacy;
              });
              db.ref("logoSettings/" + id)
                .update(updates)
                .catch(() => {});
              applyLogoTransform(container, legacy);
            }
            if (callback) callback();
          })
          .catch(() => {
            if (callback) callback();
          });
      }
    })
    .catch(() => {
      if (callback) callback();
    });
}

function applyLogoTransform(container, s) {
  const { x = 0, y = 0, scale = 1, zIndex = 0 } = s;
  const img = container.querySelector(".details-logo-img, .hero-logo-img");
  if (img) {
    img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    img.style.transformOrigin = "left bottom";
  }
  container.style.position = "relative";
  container.style.zIndex = zIndex !== 0 ? zIndex : "";
}

function initLogoEditor(id, container, slot = "modal") {
  if (container.dataset.editorActive) return;
  container.dataset.editorActive = "true";

  let state = { x: 0, y: 0, scale: 1, zIndex: 0 };
  const img = container.querySelector(".details-logo-img, .hero-logo-img");

  const readState = () => {
    try {
      const t = img.style.transform || "";
      const tMatch = t.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
      const sMatch = t.match(/scale\(([^)]+)\)/);
      if (tMatch) {
        state.x = parseFloat(tMatch[1]);
        state.y = parseFloat(tMatch[2]);
      }
      if (sMatch) state.scale = parseFloat(sMatch[1]);
      state.zIndex = parseInt(container.style.zIndex) || 0;
    } catch (e) {}
  };
  readState();

  const editToggle = document.createElement("button");
  editToggle.className = "logo-edit-toggle";
  editToggle.title = "Editar logo";
  editToggle.innerHTML = '<i class="fas fa-pen"></i>';

  const heroButtons = document.querySelector(".hero-buttons");
  const detailsButtonsRow = document.getElementById("details-buttons");
  if (slot && slot.includes("hero") && heroButtons) {
    heroButtons.appendChild(editToggle);
  } else if (detailsButtonsRow) {
    detailsButtonsRow.appendChild(editToggle);
  } else {
    container.appendChild(editToggle);
  }

  const panel = document.createElement("div");
  panel.className = "logo-editor-panel";
  panel.innerHTML = `
        <div class="lep-header">
            <span class="lep-slot-label">${slot.includes("hero") ? "🖼" : "🎬"} ${slot.includes("hero") ? "Hero" : "Modal"} · ${slot.includes("mobile") ? "📱 Móvil" : "🖥 PC"}</span>
            <button class="lep-close-btn" title="Cerrar editor">✕</button>
        </div>
        <div class="lep-grid">
            <span class="lep-label">Escala</span>
            <button class="lep-btn" data-action="scale-down">−</button>
            <span class="lep-value" id="lep-scale">${state.scale.toFixed(2)}</span>
            <button class="lep-btn" data-action="scale-up">+</button>

            <span class="lep-label">X</span>
            <button class="lep-btn" data-action="x-left">←</button>
            <span class="lep-value" id="lep-x">${Math.round(state.x)}</span>
            <button class="lep-btn" data-action="x-right">→</button>

            <span class="lep-label">Y</span>
            <button class="lep-btn" data-action="y-up">↑</button>
            <span class="lep-value" id="lep-y">${Math.round(state.y)}</span>
            <button class="lep-btn" data-action="y-down">↓</button>

            <span class="lep-label">Capa</span>
            <button class="lep-btn" data-action="z-down">−</button>
            <span class="lep-value" id="lep-z">${state.zIndex}</span>
            <button class="lep-btn" data-action="z-up">+</button>
        </div>
        <div class="lep-actions">
            <button class="lep-reset-btn">↺ Reset</button>
            <button class="lep-save-btn">Guardar</button>
        </div>
    `;
  document.body.appendChild(panel);

  const updateDisplay = () => {
    panel.querySelector("#lep-scale").textContent = state.scale.toFixed(2);
    panel.querySelector("#lep-x").textContent = Math.round(state.x);
    panel.querySelector("#lep-z").textContent = state.zIndex;
    panel.querySelector("#lep-y").textContent = Math.round(state.y);
    applyLogoTransform(container, state);
  };

  let editMode = false;
  editToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    editMode = !editMode;
    readState();
    panel.classList.toggle("lep-visible", editMode);
    img.classList.toggle("logo-editing", editMode);
    editToggle.classList.toggle("lep-active", editMode);
    editToggle.innerHTML = editMode ? "✕" : '<i class="fas fa-pen"></i>';
    updateDisplay();

    if (slot.includes("hero")) {
      window._heroEditPaused = editMode;
      if (!editMode) {
        clearInterval(appState.ui.heroInterval);
        appState.ui.heroInterval = setInterval(() => {
          if (window._heroEditPaused) return;
          const items = appState.ui.heroItems;
          if (!items || items.length === 0) return;
          appState.ui.currentHeroIndex =
            ((appState.ui.currentHeroIndex || 0) + 1) % items.length;
          changeHeroMovie(items[appState.ui.currentHeroIndex]);
        }, 8000);
      }
    }
  });

  const STEP = 5;
  panel.addEventListener("click", (e) => {
    e.stopPropagation();
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "scale-up")
      state.scale = Math.min(4, +(state.scale + 0.05).toFixed(2));
    if (action === "scale-down")
      state.scale = Math.max(0.1, +(state.scale - 0.05).toFixed(2));
    if (action === "x-right") state.x += STEP;
    if (action === "x-left") state.x -= STEP;
    if (action === "y-down") state.y += STEP;
    if (action === "y-up") state.y -= STEP;
    if (action === "z-up") state.zIndex = Math.min(5, state.zIndex + 1);
    if (action === "z-down") state.zIndex = Math.max(-5, state.zIndex - 1);
    updateDisplay();
  });

  let isDragging = false,
    dragSX,
    dragSY,
    dragOX,
    dragOY;
  img.addEventListener("mousedown", (e) => {
    if (!editMode) return;
    isDragging = true;
    dragSX = e.clientX;
    dragSY = e.clientY;
    dragOX = state.x;
    dragOY = state.y;
    img.style.cursor = "grabbing";
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    state.x = dragOX + (e.clientX - dragSX);
    state.y = dragOY + (e.clientY - dragSY);
    updateDisplay();
  });
  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      img.style.cursor = editMode ? "grab" : "";
    }
  });

  panel.querySelector(".lep-reset-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    state = { x: 0, y: 0, scale: 1, zIndex: 0 };
    updateDisplay();
  });

  panel.querySelector(".lep-close-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    editToggle.click();
  });

  const saveBtn = panel.querySelector(".lep-save-btn");
  saveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    saveBtn.disabled = true;
    saveBtn.textContent = "...";
    db.ref("logoSettings/" + id + "/" + slot)
      .set(state)
      .then(() => {
        saveBtn.textContent = "✓ Guardado";
        saveBtn.classList.add("lep-saved");
        setTimeout(() => {
          saveBtn.textContent = "Guardar";
          saveBtn.classList.remove("lep-saved");
          saveBtn.disabled = false;
        }, 2000);
      })
      .catch(() => {
        saveBtn.textContent = "Error";
        saveBtn.disabled = false;
      });
  });

  const cleanup = () => {
    editToggle.remove();
    panel.remove();
    container.style.zIndex = "";
    container.style.position = "";
    window._heroEditPaused = false;
    delete container.dataset.editorActive;
  };

  const modalEl = container.closest(".modal");
  if (modalEl) {
    const modalObserver = new MutationObserver(() => {
      if (!modalEl.classList.contains("show")) {
        cleanup();
        modalObserver.disconnect();
      }
    });
    modalObserver.observe(modalEl, {
      attributes: true,
      attributeFilter: ["class"],
    });
  } else {
    const heroObserver = new MutationObserver(() => {
      if (
        !document.body.contains(container) ||
        !container.querySelector(".hero-logo-img")
      ) {
        cleanup();
        heroObserver.disconnect();
      }
    });
    heroObserver.observe(document.body, { childList: true, subtree: true });
  }
}

function renderSagasHub() {
  const container = document.getElementById("sagas-grid-dynamic");
  if (!container) return;
  const sagas = Object.values(appState.content.sagasList || {});
  sagas.sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99));
  container.innerHTML = "";
  sagas.forEach((saga) => {
    const card = document.createElement("div");
    card.className = "saga-card";
    card.style.setProperty("--hover-color", saga.color || "#fff");
    if (saga.banner) card.style.backgroundImage = `url('${saga.banner}')`;
    card.onclick = () => {
      appState.ui._fromUniverse = saga.id;
      switchView("sagas");
    };
    card.innerHTML = `<img src="${saga.logo}" alt="${saga.title}" class="saga-logo">`;
    container.appendChild(card);
  });
}

export function findContentData(id) {
  // 🔥 Usamos el nuevo gestor de contenido centralizado!
  return ContentManager.findById(id, appState);
}

// ===========================================================
// DASHBOARD DE ANALYTICS — solo visible para el admin
// Layout: izquierda = herramientas admin | derecha = dashboard
// ===========================================================
let _presenceListener = null;

function injectOnlineCounter() {
  const user = typeof auth !== "undefined" ? auth.currentUser : null;
  if (!user || user.email !== "baquezadat@gmail.com") return;
  if (typeof db === "undefined") return;
  if (document.getElementById("admin-dashboard")) return;

  const container = document.getElementById("settings-container");
  if (!container) return;

  // ── Estilos ──────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    /* ── Ocultar elementos del settings-container que no son del admin ── */
    #settings-container:has(#admin-layout-wrapper) .catalog-header,
    #settings-container:has(#admin-layout-wrapper) .content-header,
    #settings-container:has(#admin-layout-wrapper) .settings-form-wrapper {
      display: none !important;
    }

    /* ── Contenedor principal ─────────────────────────────────── */
    #settings-container:has(#admin-layout-wrapper) {
      max-width: 1280px;
      padding-top: 90px;
    }
    #admin-layout-wrapper {
      display: grid;
      grid-template-columns: 380px 1fr;
      gap: 24px;
      align-items: start;
    }
    @media (max-width: 960px) {
      #settings-container:has(#admin-layout-wrapper) { max-width: 100%; }
      #admin-layout-wrapper { grid-template-columns: 1fr; }
      #admin-dashboard-col  { order: -1; }
    }

    /* ── Dashboard columna derecha ────────────────────────────── */
    #admin-dashboard { display: flex; flex-direction: column; gap: 16px; }

    .adash-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    @media (max-width: 600px) {
      .adash-stats { grid-template-columns: 1fr 1fr; }
      .adash-stat--online { grid-column: 1 / -1; }
    }
    .adash-stat {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 16px;
      padding: 20px 20px 16px;
      display: flex; flex-direction: column; gap: 6px;
      position: relative; overflow: hidden;
      transition: background .2s, transform .2s;
    }
    .adash-stat:hover {
      background: rgba(255,255,255,0.055);
      transform: translateY(-2px);
    }
    .adash-stat--online { border-color: rgba(34,197,94,0.25); }
    .adash-stat--online::after {
      content: '';
      position: absolute; top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, #22c55e, #16a34a);
      border-radius: 16px 16px 0 0;
    }
    .adash-stat__label {
      font-size: .65rem; font-weight: 700; letter-spacing: .1em;
      text-transform: uppercase; color: var(--text-muted, #888);
      display: flex; align-items: center; gap: 6px;
    }
    .adash-stat__value {
      font-size: 2.4rem; font-weight: 800;
      color: var(--text-light, #fff); line-height: 1;
      letter-spacing: -1px;
    }
    .adash-stat--online .adash-stat__value { color: #22c55e; }
    .adash-stat__sub { font-size: .7rem; color: var(--text-muted, #666); }
    .adash-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 0 3px rgba(34,197,94,.25);
      display: inline-block; flex-shrink: 0;
      animation: adash-pulse 2s ease-in-out infinite;
    }
    @keyframes adash-pulse {
      0%, 100% { box-shadow: 0 0 0 3px rgba(34,197,94,.25); }
      50%       { box-shadow: 0 0 0 6px rgba(34,197,94,.08); }
    }
    .adash-chart-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 16px; padding: 22px 24px;
    }
    .adash-chart-header {
      display: flex; align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 20px; flex-wrap: wrap; gap: 10px;
    }
    .adash-chart-title {
      font-size: .65rem; font-weight: 700; letter-spacing: .1em;
      text-transform: uppercase; color: var(--text-muted, #888);
    }
    .adash-chart-sub { font-size: .8rem; color: var(--text-muted, #666); margin-top: 4px; }
    .adash-period-btns { display: flex; gap: 6px; }
    .adash-period-btn {
      padding: 5px 13px; border-radius: 20px; font-size: .7rem; font-weight: 600;
      border: 1px solid rgba(255,255,255,0.1);
      background: transparent; color: var(--text-muted, #888);
      cursor: pointer; transition: all .15s;
    }
    .adash-period-btn:hover { color: var(--text-light, #fff); border-color: rgba(255,255,255,0.2); }
    .adash-period-btn.active {
      background: var(--accent, #f5c518); color: #000;
      border-color: transparent; font-weight: 700;
    }
  `;
  document.head.appendChild(style);

  // ── Separar header del resto del contenido ───────────────────
  // El .content-header ("Panel de Admin") queda fuera del grid,
  // solo wrapeamos .admin-zone-desktop junto al dashboard.
  const contentHeader = container.querySelector(".content-header");
  const adminZone     = container.querySelector(".admin-zone-desktop");

  if (!adminZone) return; // profile.js aún no terminó de renderizar

  // ── Columna derecha: dashboard ───────────────────────────────
  const rightCol = document.createElement("div");
  rightCol.id = "admin-dashboard-col";
  rightCol.innerHTML = `
    <div id="admin-dashboard">
      <div class="adash-stats">
        <div class="adash-stat adash-stat--online">
          <div class="adash-stat__label"><span class="adash-dot"></span> Conectados ahora</div>
          <div class="adash-stat__value" id="adash-online">—</div>
          <div class="adash-stat__sub">usuarios con la página abierta</div>
        </div>
        <div class="adash-stat">
          <div class="adash-stat__label">
            <i class="fas fa-calendar-day" style="color:var(--accent,#f5c518);font-size:.8rem;"></i> Hoy
          </div>
          <div class="adash-stat__value" id="adash-today">—</div>
          <div class="adash-stat__sub">visitas únicas</div>
        </div>
        <div class="adash-stat">
          <div class="adash-stat__label">
            <i class="fas fa-calendar-week" style="color:#818cf8;font-size:.8rem;"></i> Este mes
          </div>
          <div class="adash-stat__value" id="adash-month">—</div>
          <div class="adash-stat__sub">visitas únicas</div>
        </div>
      </div>
      <div class="adash-chart-card">
        <div class="adash-chart-header">
          <div>
            <div class="adash-chart-title">Actividad de visitas</div>
            <div class="adash-chart-sub" id="adash-chart-sub">Visitas únicas por día</div>
          </div>
          <div class="adash-period-btns">
            <button class="adash-period-btn active" data-period="week">7 días</button>
            <button class="adash-period-btn" data-period="month">30 días</button>
            <button class="adash-period-btn" data-period="year">12 meses</button>
          </div>
        </div>
        <div style="position:relative;height:220px;">
          <canvas id="adash-canvas"></canvas>
        </div>
        <div id="adash-empty" style="display:none;text-align:center;
          padding:40px 0;color:var(--text-muted,#888);font-size:.85rem;">
          <i class="fas fa-chart-bar" style="font-size:1.8rem;opacity:.2;display:block;margin-bottom:8px;"></i>
          Sin datos todavía
        </div>
      </div>
      <div class="adash-discord-card" id="adash-discord-card">
        <div class="adash-discord-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;opacity:.7"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
          <span>Mensaje personalizado al cine</span>
        </div>
        <div class="adash-discord-body">
          <div class="adash-discord-row adash-dc-webhook-row">
            <label class="adash-discord-label" for="adash-dc-webhook">Webhook URL (Discord)</label>
            <div class="adash-dc-webhook-inputwrap">
              <input id="adash-dc-webhook" class="adash-dc-input" type="password" placeholder="https://discord.com/api/webhooks/...">
              <button id="adash-dc-webhook-toggle" class="adash-dc-webhook-icon-btn" title="Mostrar/ocultar" type="button">
                <i class="fas fa-eye"></i>
              </button>
            </div>
            <div class="adash-dc-webhook-actions">
              <button id="adash-dc-webhook-save" class="adash-dc-webhook-save-btn" type="button">Guardar</button>
              <span id="adash-dc-webhook-status" class="adash-dc-webhook-status"></span>
            </div>
          </div>
          <div class="adash-discord-row">
            <label class="adash-discord-label">Tipo</label>
            <div class="adash-discord-type-btns" id="adash-dc-types">
              <button class="adash-dc-type active" data-color="#00D4FF" data-emoji="📢">📢 Aviso</button>
              <button class="adash-dc-type" data-color="#FFB400" data-emoji="🔧">🔧 Mantenimiento</button>
              <button class="adash-dc-type" data-color="#43b581" data-emoji="✅">✅ Novedad</button>
              <button class="adash-dc-type" data-color="#FF4444" data-emoji="🚨">🚨 Urgente</button>
            </div>
          </div>
          <div class="adash-discord-row">
            <label class="adash-discord-label" for="adash-dc-title">Título</label>
            <input id="adash-dc-title" class="adash-dc-input" type="text" placeholder="Ej: Mantenimiento programado">
          </div>
          <div class="adash-discord-row">
            <label class="adash-discord-label" for="adash-dc-msg">Mensaje</label>
            <textarea id="adash-dc-msg" class="adash-dc-input adash-dc-textarea" rows="3" placeholder="Escribe el aviso para los usuarios del cine..."></textarea>
          </div>
          <div class="adash-discord-preview" id="adash-dc-preview">
            <div class="adash-dc-preview-label">Vista previa</div>
            <div class="adash-dc-preview-embed" id="adash-dc-embed">
              <div class="adash-dc-embed-title" id="adash-dc-embed-title">📢 Aviso</div>
              <div class="adash-dc-embed-desc" id="adash-dc-embed-desc"><span style="opacity:.3;font-style:italic;">Sin mensaje todavía...</span></div>
            </div>
          </div>
          <button class="adash-dc-send-btn" id="adash-dc-send">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            Enviar al cine
          </button>
        </div>
      </div>
    </div>
  `;

  // ── Columna izquierda: solo las herramientas ─────────────────
  const leftCol = document.createElement("div");
  leftCol.id = "admin-tools-col";
  leftCol.appendChild(adminZone);

  // ── Wrapper de dos columnas ──────────────────────────────────
  const wrapper = document.createElement("div");
  wrapper.id = "admin-layout-wrapper";
  wrapper.appendChild(leftCol);
  wrapper.appendChild(rightCol);
  container.appendChild(wrapper);

  // ── Presencia en tiempo real ─────────────────────────────────
  if (_presenceListener) db.ref("presence").off("value", _presenceListener);
  _presenceListener = db.ref("presence").on("value", (snap) => {
    const el = document.getElementById("adash-online");
    if (el) el.textContent = snap.numChildren();
  });

  // ── Stats: hoy y este mes ────────────────────────────────────
  db.ref("analytics_visits").once("value", (snap) => {
    const data  = Object.values(snap.val() || {});
    const today = new Date().toISOString().slice(0, 10);
    const month = new Date().toISOString().slice(0, 7);
    const elT = document.getElementById("adash-today");
    const elM = document.getElementById("adash-month");
    if (elT) elT.textContent = data.filter(v => v.date  === today).length;
    if (elM) elM.textContent = data.filter(v => v.month === month).length;
  });

  // ── Gráfico ──────────────────────────────────────────────────
  let _chart = null;

  function buildPeriod(period) {
    const labels = [], keys = [], now = new Date();
    if (period === "year") {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        keys.push(d.toISOString().slice(0, 7));
        labels.push(d.toLocaleString("es", { month: "short", year: "2-digit" }));
      }
    } else {
      const days = period === "month" ? 30 : 7;
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now); d.setDate(now.getDate() - i);
        keys.push(d.toISOString().slice(0, 10));
        labels.push(period === "month"
          ? d.toLocaleString("es", { day: "numeric", month: "short" })
          : d.toLocaleString("es", { weekday: "short", day: "numeric" }));
      }
    }
    return { labels, keys };
  }

  function renderChart(period) {
    document.querySelectorAll(".adash-period-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.period === period));
    const sub = document.getElementById("adash-chart-sub");
    if (sub) sub.textContent = period === "year" ? "Visitas únicas por mes" : "Visitas únicas por día";

    db.ref("analytics_visits").once("value", (snap) => {
      const data = Object.values(snap.val() || {});
      const { labels, keys } = buildPeriod(period);
      const counts = keys.map(k =>
        data.filter(v => (period === "year" ? v.month : v.date) === k).length
      );
      const canvas  = document.getElementById("adash-canvas");
      const empty   = document.getElementById("adash-empty");
      const hasData = counts.some(c => c > 0);
      canvas.style.display = hasData ? "block" : "none";
      if (empty) empty.style.display = hasData ? "none" : "block";
      if (!hasData) { if (_chart) { _chart.destroy(); _chart = null; } return; }

      const accent = getComputedStyle(document.documentElement)
        .getPropertyValue("--accent").trim() || "#f5c518";

      if (_chart) _chart.destroy();
      _chart = new Chart(canvas, {
        type: "bar",
        data: {
          labels,
          datasets: [{
            data: counts,
            backgroundColor: accent + "28",
            borderColor: accent,
            borderWidth: 2,
            borderRadius: 8,
            hoverBackgroundColor: accent + "55",
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "rgba(0,0,0,.85)",
              titleColor: "#fff", bodyColor: "#aaa",
              callbacks: { label: ctx => ` ${ctx.parsed.y} visita${ctx.parsed.y !== 1 ? "s" : ""}` }
            }
          },
          scales: {
            x: { grid: { color: "rgba(255,255,255,0.04)" }, ticks: { color: "#666", font: { size: 11 } } },
            y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.04)" }, ticks: { color: "#666", precision: 0, font: { size: 11 } } }
          }
        }
      });
    });
  }

  rightCol.addEventListener("click", e => {
    const btn = e.target.closest(".adash-period-btn");
    if (btn) renderChart(btn.dataset.period);
  });

  renderChart("week");

  // ── Estilos del bloque de mensaje personalizado ───────────────
  if (!document.getElementById("adash-discord-style")) {
    const s = document.createElement("style");
    s.id = "adash-discord-style";
    s.textContent = `
      .adash-discord-card {
        background: rgba(255,255,255,.03);
        border: 1px solid rgba(255,255,255,.07);
        border-radius: 14px;
        overflow: hidden;
        margin-top: 14px;
      }
      .adash-discord-header {
        display: flex; align-items: center; gap: 8px;
        padding: 12px 16px 10px;
        font-size: 11px; font-weight: 700; letter-spacing: .07em;
        text-transform: uppercase; color: rgba(255,255,255,.35);
        border-bottom: 1px solid rgba(255,255,255,.05);
      }
      .adash-discord-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px; }
      .adash-discord-row  { display: flex; flex-direction: column; gap: 6px; }
      .adash-discord-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: rgba(255,255,255,.3); }
      .adash-discord-type-btns { display: flex; gap: 6px; flex-wrap: wrap; }
      .adash-dc-type {
        padding: 5px 11px; border-radius: 7px; border: 1px solid rgba(255,255,255,.1);
        background: rgba(255,255,255,.04); color: rgba(255,255,255,.45);
        font-size: 11px; font-weight: 600; cursor: pointer; transition: all .15s;
      }
      .adash-dc-type.active {
        border-color: var(--adash-dc-color, #00D4FF);
        background: color-mix(in srgb, var(--adash-dc-color, #00D4FF) 15%, transparent);
        color: #fff;
      }
      .adash-dc-input {
        width: 100%; padding: 8px 10px; border-radius: 8px; box-sizing: border-box;
        background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09);
        color: #fff; font-size: 12px; outline: none; transition: border-color .15s;
        font-family: inherit; resize: none;
      }
      .adash-dc-input:focus { border-color: rgba(255,255,255,.25); }
      .adash-dc-textarea { line-height: 1.5; }
      .adash-discord-preview { background: rgba(0,0,0,.2); border-radius: 9px; padding: 10px 12px; }
      .adash-dc-preview-label { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: rgba(255,255,255,.25); margin-bottom: 8px; }
      .adash-dc-preview-embed {
        border-left: 3px solid var(--adash-dc-color, #00D4FF);
        padding: 8px 10px; border-radius: 0 6px 6px 0;
        background: rgba(255,255,255,.04);
      }
      .adash-dc-embed-title { font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 5px; }
      .adash-dc-embed-desc  { font-size: 12px; color: rgba(255,255,255,.6); line-height: 1.4; white-space: pre-wrap; word-break: break-word; }
      .adash-dc-send-btn {
        display: flex; align-items: center; justify-content: center; gap: 7px;
        padding: 10px; border-radius: 9px; border: none; cursor: pointer;
        background: linear-gradient(135deg, #7289da, #5b6eae);
        color: #fff; font-size: 13px; font-weight: 700; transition: opacity .15s;
      }
      .adash-dc-send-btn:hover { opacity: .85; }
      .adash-dc-send-btn:disabled { opacity: .5; cursor: not-allowed; }
      .adash-dc-webhook-row { padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,.08); margin-bottom: 4px; }
      .adash-dc-webhook-inputwrap { position: relative; display: flex; }
      .adash-dc-webhook-inputwrap .adash-dc-input { flex: 1; padding-right: 38px; }
      .adash-dc-webhook-icon-btn {
        position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
        background: none; border: none; color: rgba(255,255,255,.4); cursor: pointer;
        width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
        border-radius: 6px; font-size: 12px;
      }
      .adash-dc-webhook-icon-btn:hover { color: rgba(255,255,255,.8); background: rgba(255,255,255,.06); }
      .adash-dc-webhook-actions { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
      .adash-dc-webhook-save-btn {
        padding: 7px 14px; border-radius: 8px; border: none; cursor: pointer;
        background: rgba(255,255,255,.08); color: #fff; font-size: 12px; font-weight: 700;
        transition: background .15s;
      }
      .adash-dc-webhook-save-btn:hover { background: rgba(255,255,255,.14); }
      .adash-dc-webhook-save-btn:disabled { opacity: .5; cursor: not-allowed; }
      .adash-dc-webhook-status { font-size: 11px; color: rgba(255,255,255,.45); }
      .adash-dc-webhook-status.ok { color: #43b581; }
      .adash-dc-webhook-status.err { color: #FF4444; }
    `;
    document.head.appendChild(s);
  }

  // ── Lógica del mensaje personalizado ─────────────────────────
  let _dcActiveType = { emoji: "📢", color: "#00D4FF", label: "Aviso" };

  const dcTypes   = document.getElementById("adash-dc-types");
  const dcTitle   = document.getElementById("adash-dc-title");
  const dcMsg     = document.getElementById("adash-dc-msg");
  const dcEmbed   = document.getElementById("adash-dc-embed");
  const dcEmbedT  = document.getElementById("adash-dc-embed-title");
  const dcEmbedD  = document.getElementById("adash-dc-embed-desc");
  const dcSendBtn = document.getElementById("adash-dc-send");

  function dcUpdatePreview() {
    const title = dcTitle.value.trim();
    const msg   = dcMsg.value.trim();
    dcEmbedT.textContent = _dcActiveType.emoji + " " + (title || _dcActiveType.label);
    dcEmbedD.innerHTML   = msg
      ? msg.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      : '<span style="opacity:.3;font-style:italic;">Sin mensaje todavía...</span>';
    dcEmbed.style.setProperty("--adash-dc-color", _dcActiveType.color);
    document.getElementById("adash-discord-card").style.setProperty("--adash-dc-color", _dcActiveType.color);
  }

  dcTypes.addEventListener("click", e => {
    const btn = e.target.closest(".adash-dc-type");
    if (!btn) return;
    dcTypes.querySelectorAll(".adash-dc-type").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    _dcActiveType = {
      emoji: btn.dataset.emoji,
      color: btn.dataset.color,
      label: btn.textContent.replace(btn.dataset.emoji, "").trim()
    };
    dcUpdatePreview();
  });

  dcTitle.addEventListener("input", dcUpdatePreview);
  dcMsg.addEventListener("input", dcUpdatePreview);

  document.getElementById("adash-discord-card").style.setProperty("--adash-dc-color", _dcActiveType.color);

  // ── Configuración del Webhook de Discord (guardado en Firebase) ──
  const dcWebhookInput  = document.getElementById("adash-dc-webhook");
  const dcWebhookToggle = document.getElementById("adash-dc-webhook-toggle");
  const dcWebhookSave   = document.getElementById("adash-dc-webhook-save");
  const dcWebhookStatus = document.getElementById("adash-dc-webhook-status");

  // Cargar el valor actual (solo admins pueden leer esta ruta según las reglas de Firebase)
  db.ref("config/discord_webhook").once("value")
    .then(snap => {
      const val = snap.val();
      if (val) dcWebhookInput.value = val;
    })
    .catch(err => console.warn("No se pudo leer config/discord_webhook:", err));

  dcWebhookToggle.addEventListener("click", () => {
    const showing = dcWebhookInput.type === "text";
    dcWebhookInput.type = showing ? "password" : "text";
    dcWebhookToggle.innerHTML = showing
      ? '<i class="fas fa-eye"></i>'
      : '<i class="fas fa-eye-slash"></i>';
  });

  dcWebhookSave.addEventListener("click", async () => {
    const url = dcWebhookInput.value.trim();

    if (url && !/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(url)) {
      dcWebhookStatus.textContent = "URL inválida";
      dcWebhookStatus.className = "adash-dc-webhook-status err";
      return;
    }

    dcWebhookSave.disabled = true;
    dcWebhookStatus.textContent = "Guardando…";
    dcWebhookStatus.className = "adash-dc-webhook-status";

    try {
      await db.ref("config/discord_webhook").set(url || null);
      dcWebhookStatus.textContent = "Guardado ✓";
      dcWebhookStatus.className = "adash-dc-webhook-status ok";
    } catch (err) {
      console.error("Error guardando webhook:", err);
      dcWebhookStatus.textContent = "Error al guardar";
      dcWebhookStatus.className = "adash-dc-webhook-status err";
    } finally {
      dcWebhookSave.disabled = false;
      setTimeout(() => { dcWebhookStatus.textContent = ""; dcWebhookStatus.className = "adash-dc-webhook-status"; }, 3000);
    }
  });

  dcSendBtn.addEventListener("click", async () => {
    const title = dcTitle.value.trim();
    const msg   = dcMsg.value.trim();
    if (!msg) {
      dcMsg.focus();
      dcMsg.style.borderColor = "#FF4444";
      setTimeout(() => dcMsg.style.borderColor = "", 1500);
      return;
    }
    dcSendBtn.disabled = true;
    dcSendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg> Enviando\u2026';
    const colorInt = parseInt(_dcActiveType.color.replace("#", ""), 16);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error("No autenticado");

      const res = await fetch(`${WORKER_URL}/discord-notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({
          embeds: [{
            author: { name: "Cine Corneta", url: "https://cornetagang.github.io/cinecorneta/" },
            title: _dcActiveType.emoji + " " + (title || _dcActiveType.label),
            description: msg,
            color: colorInt,
            footer: { text: "Aviso del cine" },
            timestamp: new Date().toISOString()
          }]
        })
      });
      if (!res.ok) throw new Error(res.status);
      dcSendBtn.innerHTML = "\u2713 Enviado";
      dcSendBtn.style.background = "linear-gradient(135deg,#43b581,#3aa36e)";
      setTimeout(() => {
        dcTitle.value = "";
        dcMsg.value   = "";
        dcUpdatePreview();
        dcSendBtn.disabled = false;
        dcSendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg> Enviar al cine';
        dcSendBtn.style.background = "";
      }, 2000);
    } catch (err) {
      console.error("[Discord custom]", err);
      dcSendBtn.innerHTML = "\u2717 Error al enviar";
      dcSendBtn.style.background = "linear-gradient(135deg,#f04747,#d93535)";
      dcSendBtn.disabled = false;
      setTimeout(() => {
        dcSendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg> Enviar al cine';
        dcSendBtn.style.background = "";
      }, 3000);
    }
  });
}

window.adminForceUpdate = async () => {
  // Buscar el botón que disparó esta función para actualizar su estado visual
  const btn = document.querySelector("[onclick*='adminForceUpdate']");
  const originalHTML = btn ? btn.innerHTML : null;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando...';
  }

  try {
    await smartRefreshAndPatch();
  } finally {
    // Siempre restaurar el botón, haya fallado o no
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHTML;
    }
  }
};

window.adminLocalRefresh = async () => {
  const btn = document.getElementById("admin-local-refresh-btn");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  }
  try {
    const [series, episodes, allMovies, posters, sagasListData] =
      await Promise.all([
        ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=series`),
        ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=episodes`),
        ErrorHandler.fetchOperation(
          `${API_URL.BASE_URL}?data=allMovies&order=desc`,
        ),
        ErrorHandler.fetchOperation(
          `${API_URL.BASE_URL}?data=PostersTemporadas`,
        ),
        ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=sagas_list`),
      ]);

    const sagasArray = Object.values(sagasListData || {});
    const sagasResults = await Promise.all(
      sagasArray.map((saga) =>
        ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=${saga.id}`).then(
          (data) => ({ id: saga.id, data }),
        ),
      ),
    );

    const freshContent = {
      allMovies,
      series,
      episodes,
      posters,
      sagas_list: sagasListData,
    };
    sagasResults.forEach((item) => {
      freshContent[item.id] = item.data;
    });

    processDataPublic(freshContent);
    cacheManager.set(cacheManager.keys.content, freshContent);

    const activeNav = document.querySelector("[data-filter].active");
    const currentFilter = activeNav?.dataset.filter || "all";
    switchView(currentFilter);
    restoreContinueWatchingCarousel();

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    }
    ErrorHandler.show("content", "✓ Datos actualizados localmente", 2000);
    console.log("✓ Refresh local completado");
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    }
    console.error("Error en refresh local:", e);
  }
};

function safeClearStorage() {
  const preserve = [];
  const saved = {};
  preserve.forEach((k) => {
    try {
      saved[k] = localStorage.getItem(k);
    } catch {}
  });
  localStorage.clear();
  preserve.forEach((k) => {
    if (saved[k] != null) localStorage.setItem(k, saved[k]);
  });
}
window.safeClearStorage = safeClearStorage;

function checkResetPasswordMode() {
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get("mode");
  const actionCode = urlParams.get("oobCode");

  if (mode === "resetPassword" && actionCode) {
    window.history.replaceState({}, document.title, window.location.pathname);

    const modal = document.getElementById("new-password-modal");
    if (modal) {
      modal.classList.add("show");
      document.body.classList.add("modal-open");
    }

    const toggleIcon = document.getElementById("toggle-new-pass");
    const inputPass = document.getElementById("new-password-input");

    if (toggleIcon && inputPass) {
      const newToggle = toggleIcon.cloneNode(true);
      toggleIcon.parentNode.replaceChild(newToggle, toggleIcon);

      newToggle.addEventListener("click", () => {
        const isPass = inputPass.type === "password";
        inputPass.type = isPass ? "text" : "password";
        newToggle.classList.toggle("fa-eye");
        newToggle.classList.toggle("fa-eye-slash");
      });
    }

    const form = document.getElementById("new-password-form");
    const feedback = document.getElementById("new-pass-feedback");

    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const newPassword = inputPass.value;
        const btn = form.querySelector("button");

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
        feedback.textContent = "";

        try {
          await auth.confirmPasswordReset(actionCode, newPassword);

          feedback.style.color = "#4cd137";
          feedback.textContent = "¡Contraseña actualizada correctamente!";
          btn.textContent = "¡Listo!";

          setTimeout(() => {
            modal.classList.remove("show");
            if (window.openAuthModal) window.openAuthModal(true);
          }, 2000);
        } catch (error) {
          console.error("Error reset password:", error);
          btn.disabled = false;
          btn.textContent = "Guardar Nueva Contraseña";
          feedback.style.color = "#ff4d4d";

          if (error.code === "auth/expired-action-code") {
            feedback.textContent = "El enlace ha expirado. Solicita uno nuevo.";
          } else if (error.code === "auth/invalid-action-code") {
            feedback.textContent = "El enlace ya fue usado o no es válido.";
          } else if (error.code === "auth/weak-password") {
            feedback.textContent =
              "La contraseña es muy débil (mínimo 6 caracteres).";
          } else {
            feedback.textContent = "Ocurrió un error. Intenta nuevamente.";
          }
        }
      };
    }
  }
}

window.closeAllModals = () => ModalManager.closeAll();
window.switchView = switchView;
window.ErrorHandler = ErrorHandler;
window.ContentManager = ContentManager;
window.cacheManager = cacheManager;

// ===========================================================
// COLOR PICKER — Paso 3
// Personalización del color de acento por el usuario.
// No toca ninguna función existente, solo añade nuevas.
// ===========================================================

const COLOR_PRESETS = [
  { name: "Azul", hex: "#3b82f6" },
  { name: "Índigo", hex: "#6366f1" },
  { name: "Violeta", hex: "#8b5cf6" },
  { name: "Rosa", hex: "#ec4899" },
  { name: "Rojo", hex: "#ef4444" },
  { name: "Naranja", hex: "#f97316" },
  { name: "Verde", hex: "#10b981" },
  { name: "Teal", hex: "#14b8a6" },
];

function _cpHexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function _cpDarken(hex, factor = 0.55) {
  const { r, g, b } = _cpHexToRgb(hex);
  return (
    "#" +
    [r, g, b]
      .map((c) =>
        Math.round(c * factor)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function applyColor(hex) {
  const { r, g, b } = _cpHexToRgb(hex);
  const root = document.documentElement;
  root.style.setProperty("--accent-color", hex);
  root.style.setProperty("--accent-rgb", `${r}, ${g}, ${b}`);
  root.style.setProperty("--accent-dark", _cpDarken(hex));
  const customInput = document.getElementById("customColor");
  if (customInput) customInput.value = hex;
  document
    .querySelectorAll(".color-swatch")
    .forEach((s) => s.classList.toggle("active", s.dataset.hex === hex));
  try {
    localStorage.setItem("cinemaColor", hex);
  } catch {}
}

window.toggleColorPanel = function toggleColorPanel() {
  const panel = document.getElementById("colorPanel");
  if (panel) panel.classList.toggle("open");
  // Cerrar dropdown de usuario y auth si estaban abiertos
  const dd = document.getElementById("navDropdown");
  if (dd) dd.classList.remove("open");
  const authDd = document.getElementById("auth-dropdown");
  if (authDd) authDd.classList.remove("open");
};

function toggleUserDropdown() {
  const dd = document.getElementById("navDropdown");
  if (dd) dd.classList.toggle("open");
  // Cerrar color panel y auth dropdown si estaban abiertos
  const panel = document.getElementById("colorPanel");
  if (panel) panel.classList.remove("open");
  const authDd = document.getElementById("auth-dropdown");
  if (authDd) authDd.classList.remove("open");
}

// Inicializar swatches y restaurar color guardado
document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("colorSwatches");
  if (container) {
    COLOR_PRESETS.forEach(({ name, hex }) => {
      const btn = document.createElement("button");
      btn.className = "color-swatch";
      btn.dataset.hex = hex;
      btn.title = name;
      btn.style.background = hex;
      btn.onclick = () => applyColor(hex);
      container.appendChild(btn);
    });
  }

  let savedColor = "#3b82f6";
  try {
    savedColor = localStorage.getItem("cinemaColor") || savedColor;
  } catch {}
  applyColor(savedColor);
});

// Cierre al click fuera
document.addEventListener("click", (e) => {
  if (
    !e.target.closest(".color-panel") &&
    !e.target.closest(".color-picker-btn")
  ) {
    const panel = document.getElementById("colorPanel");
    if (panel) panel.classList.remove("open");
  }
  if (
    !e.target.closest(".nav-dropdown") &&
    !e.target.closest(".nav-avatar-btn")
  ) {
    const dd = document.getElementById("navDropdown");
    if (dd) dd.classList.remove("open");
  }
  if (
    !e.target.closest("#auth-dropdown") &&
    !e.target.closest("#guest-avatar-btn")
  ) {
    const authDd = document.getElementById("auth-dropdown");
    if (authDd) authDd.classList.remove("open");
  }
});

// Exponer funciones al HTML (onclick="...")
window.applyColor = applyColor;
window.toggleColorPanel = toggleColorPanel;
window.toggleUserDropdown = toggleUserDropdown;

// ── MOBILE DRAWER ─────────────────────────────────────────────────────────
window.toggleMobileDrawer = function () {
  const drawer = document.getElementById("mobileUserDrawer");
  const backdrop = document.getElementById("mobileDrawerBackdrop");
  if (!drawer) return;
  drawer.classList.toggle("open");
  backdrop.classList.toggle("open");
};

window.closeMobileDrawer = function () {
  const drawer = document.getElementById("mobileUserDrawer");
  const backdrop = document.getElementById("mobileDrawerBackdrop");
  if (drawer) drawer.classList.remove("open");
  if (backdrop) backdrop.classList.remove("open");
};

// Sincronizar datos de usuario en el drawer móvil
// ── Aplica foto de perfil o iniciales a TODOS los avatares del sitio ──
function syncAllAvatars(photoURL, initials, userName) {
  const imgStyle = "width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;";

  function _setAvatar(el, isImg) {
    if (!el) return;
    if (isImg) {
      el.innerHTML = `<img src="${photoURL}" alt="avatar" style="${imgStyle}">`;
      el.style.padding = "0";
      el.style.overflow = "hidden";
    } else {
      el.innerHTML = "";
      el.textContent = initials;
      el.style.padding = "";
      el.style.overflow = "";
    }
  }

  const hasPhoto = !!photoURL;

  _setAvatar(DOM.userGreetingBtn, hasPhoto);
  _setAvatar(document.getElementById("dropdownAvatar"), hasPhoto);

  const _dn = document.getElementById("dropdownName");
  if (_dn) _dn.textContent = userName;
  const _dh = document.getElementById("dropdownHandle");
  if (_dh) _dh.textContent = `@${userName.toLowerCase().replace(/\s+/g, "")}`;

  const mobileInitialsEl = document.getElementById("mobileAvatarInitials");
  if (mobileInitialsEl) {
    if (hasPhoto) {
      mobileInitialsEl.innerHTML = `<img src="${photoURL}" alt="avatar" style="${imgStyle}">`;
    } else {
      mobileInitialsEl.innerHTML = "";
      mobileInitialsEl.textContent = initials;
    }
  }

  syncMobileDrawerUser(userName, initials, photoURL);

  ["wrt-avatar", "wrt-avatar-exp"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (hasPhoto) {
      el.innerHTML = `<img src="${photoURL}" alt="avatar" style="${imgStyle}">`;
      el.style.padding = "0";
      el.style.overflow = "hidden";
    } else {
      el.innerHTML = `<span>${initials}</span>`;
    }
  });
}
window.syncAllAvatars = syncAllAvatars;

function syncMobileDrawerUser(userName, initials, photoURL) {
  const avatar = document.getElementById("mobileDrawerAvatar");
  const name = document.getElementById("mobileDrawerName");
  const handle = document.getElementById("mobileDrawerHandle");
  const imgStyle = "width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;";
  if (avatar) {
    if (photoURL) {
      avatar.innerHTML = `<img src="${photoURL}" alt="avatar" style="${imgStyle}">`;
      avatar.style.padding = "0";
      avatar.style.overflow = "hidden";
    } else {
      avatar.innerHTML = "";
      avatar.textContent = initials;
    }
  }
  if (name) name.textContent = userName;
  if (handle)
    handle.textContent = `@${userName.toLowerCase().replace(/\s+/g, "")}`;
}
window.syncMobileDrawerUser = syncMobileDrawerUser;

// Inicializar swatches del drawer móvil
document.addEventListener("DOMContentLoaded", () => {
  const mobileContainer = document.getElementById("mobileColorSwatches");
  if (mobileContainer) {
    COLOR_PRESETS.forEach(({ name, hex }) => {
      const btn = document.createElement("button");
      btn.className = "mobile-color-swatch";
      btn.dataset.hex = hex;
      btn.title = name;
      btn.style.background = hex;
      btn.onclick = () => {
        applyColor(hex);
        // Sincronizar estado activo en swatches del drawer
        document
          .querySelectorAll(".mobile-color-swatch")
          .forEach((s) => s.classList.toggle("active", s.dataset.hex === hex));
      };
      mobileContainer.appendChild(btn);
    });
  }
});

window.openSeasonDrawer = function (
  seasons,
  posters,
  currentSeason,
  onSelect,
  labels,
  titleLabel,
) {
  const drawer = document.getElementById("seasonDrawer");
  const backdrop = document.getElementById("seasonDrawerBackdrop");
  const grid = document.getElementById("seasonDrawerGrid");
  if (!drawer || !grid) return;

  // Actualizar título dinámico (ej: "PARTES", "TEMPORADAS", etc.)
  const drawerTitle = document.getElementById("seasonDrawerTitle");
  if (drawerTitle) {
    const word = String(titleLabel || "").trim();
    drawerTitle.textContent = word ? (word + "S").toUpperCase() : "TEMPORADAS";
  }

  grid.innerHTML = "";
  seasons.forEach((key, i) => {
    const card = document.createElement("div");
    card.className =
      "sp-season-drawer-card" + (key === currentSeason ? " active" : "");
    const poster = posters?.[key] || "";
    // Usar etiqueta custom si existe, si no "Temporada N"
    const label = (labels?.[key] || "").trim() || `Temporada ${i + 1}`;
    card.innerHTML = `
      ${poster ? `<img src="${poster}" alt="${label}"/>` : `<div style="aspect-ratio:2/3;background:rgba(255,255,255,0.05);border-radius:8px"></div>`}
      <span class="sp-season-drawer-label">${label}</span>
    `;
    card.onclick = () => {
      onSelect(key);
      closeSeasonDrawer();
    };
    grid.appendChild(card);
  });

  drawer.classList.add("open");
  backdrop.classList.add("open");
};

window.closeSeasonDrawer = function () {
  document.getElementById("seasonDrawer")?.classList.remove("open");
  document.getElementById("seasonDrawerBackdrop")?.classList.remove("open");
};

console.log("✅ Cine Corneta v10 cargado correctamente");

// ── Catalog scroll-to-top ─────────────────────────────────────
(function () {
  const btn = document.getElementById("catalog-scroll-top");
  if (!btn) return;

  window.addEventListener(
    "scroll",
    () => {
      const gridVisible = DOM.gridContainer?.style.display !== "none";
      btn.classList.toggle("visible", gridVisible && window.scrollY > 400);
    },
    { passive: true },
  );

  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();
// ===========================================================
// GENRE DRAWER — Drawer de sagas/fases/géneros (mobile)
// ===========================================================

window.openGenreDrawer = function () {
  const drawer = document.getElementById("genreDrawer");
  const backdrop = document.getElementById("genreDrawerBackdrop");
  if (!drawer) return;
  drawer.classList.add("open");
  backdrop.classList.add("open");
};

window.closeGenreDrawer = function () {
  document.getElementById("genreDrawer")?.classList.remove("open");
  document.getElementById("genreDrawerBackdrop")?.classList.remove("open");
};

/**
 * Rellena el drawer con las mismas opciones que tiene el
 * dropdown #genre-menu-list en ese momento, y lo abre.
 * Funciona para fases, sagas, géneros y cualquier otro modo.
 */
window.openGenreDrawerFromMenu = function () {
  const list = document.getElementById("genreDrawerList");
  const title = document.getElementById("genreDrawerTitle");
  const source = document.getElementById("genre-menu-list");
  const trigger = document.getElementById("genre-drawer-trigger-btn");
  if (!list || !source) return;

  // Título del drawer según el texto actual del dropdown
  const currentText =
    document.getElementById("genre-text")?.textContent || "Filtrar";
  title.textContent = currentText.toUpperCase();

  // Valor activo actual
  const activeValue = document.getElementById("genre-filter")?.value || "all";

  list.innerHTML = "";

  // Recorremos los nodos del dropdown y los convertimos en ítems del drawer
  source
    .querySelectorAll(".dropdown-item, .dropdown-group-title")
    .forEach((node) => {
      const value = node.dataset.value || "all";
      const isGroup = node.classList.contains("dropdown-group-title");
      const logoImg = node.querySelector("img");

      if (isGroup && logoImg) {
        // Ítem de grupo con imagen (Saga Infinito / Multiverso)
        const el = document.createElement("div");
        el.className =
          "genre-drawer-group" + (value === activeValue ? " active" : "");
        el.innerHTML = `<img src="${logoImg.src}" alt="${logoImg.alt}"><span>${logoImg.alt}</span>`;
        el.onclick = () => _selectGenreDrawer(value, logoImg.alt, trigger);
        list.appendChild(el);
      } else if (isGroup) {
        // Grupo sin imagen → divisor visual
        const div = document.createElement("div");
        div.className = "genre-drawer-divider";
        list.appendChild(div);
      } else {
        // Ítem normal
        const label = node.textContent.trim();
        // Detectar si es sub-ítem (fases dentro de una saga)
        const isSub =
          node.closest(".dropdown-group-title") !== null ||
          node.previousElementSibling?.classList.contains(
            "dropdown-group-title",
          );

        const el = document.createElement("button");
        el.className =
          "genre-drawer-item" +
          (isSub ? " genre-drawer-subitem" : "") +
          (value === activeValue ? " active" : "");
        el.innerHTML = `
        <span>${label}</span>
        <i class="fas fa-check genre-drawer-check"></i>
      `;
        el.onclick = () => _selectGenreDrawer(value, label, trigger);
        list.appendChild(el);
      }
    });

  openGenreDrawer();
};

function _selectGenreDrawer(value, label, triggerBtn) {
  // 1. Actualizar el select oculto y disparar change para que applyAndDisplayFilters lo pesque
  const genreSelect = document.getElementById("genre-filter");
  if (genreSelect) {
    genreSelect.value = value;
    genreSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // 2. Actualizar el texto del dropdown original (sincronía desktop↔mobile)
  const genreText = document.getElementById("genre-text");
  if (genreText) {
    genreText.textContent =
      label === "Todos" || value === "all" ? "Géneros" : label;
  }

  // 3. Actualizar el botón trigger del drawer
  if (triggerBtn) {
    const span = triggerBtn.querySelector("span");
    if (span)
      span.textContent =
        value === "all" ? genreText?.textContent || "Filtrar" : label;
    triggerBtn.classList.toggle("has-active-filter", value !== "all");
  }

  // 4. Marcar el visual dropdown con filtro activo
  const genreVisual = document.getElementById("genre-dropdown-visual");
  if (genreVisual)
    genreVisual.classList.toggle("has-active-filter", value !== "all");

  closeGenreDrawer();
}

/**
 * Inyecta el botón trigger en el filter-controls SOLO en mobile,
 * cuando el universo/saga tiene filtro de géneros/sagas/fases activo.
 * Se llama desde applyAndDisplayFilters (o al montar la vista de saga).
 */
window.syncGenreDrawerTrigger = function () {
  // Solo en mobile
  if (window.innerWidth > 600) return;

  const filterControls = document.getElementById("filter-controls");
  const genreVisual = document.getElementById("genre-dropdown-visual");
  if (!filterControls || !genreVisual) return;

  // Solo activar en vistas de saga/universo
  const isSagaView = !!appState?.ui?.activeSagaId;

  // Si el dropdown original está oculto o no estamos en saga, limpiar trigger
  const genreHidden = genreVisual.style.display === "none";
  if (!isSagaView || genreHidden) {
    document.getElementById("genre-drawer-trigger-btn")?.remove();
    return;
  }

  let btn = document.getElementById("genre-drawer-trigger-btn");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "genre-drawer-trigger-btn";
    btn.className = "genre-drawer-trigger";
    btn.onclick = () => window.openGenreDrawerFromMenu();
    const backBtn = document.getElementById("back-to-sagas-btn");
    if (backBtn && backBtn.nextSibling) {
      filterControls.insertBefore(btn, backBtn.nextSibling);
    } else {
      filterControls.prepend(btn);
    }
  }

  // Actualizar texto del trigger
  const activeValue = document.getElementById("genre-filter")?.value || "all";
  const genreText =
    document.getElementById("genre-text")?.textContent || "Filtrar";
  btn.innerHTML = `<span>${genreText}</span><i class="fas fa-chevron-down"></i>`;
  btn.classList.toggle("has-active-filter", activeValue !== "all");
};

// Llamar syncGenreDrawerTrigger cada vez que cambia el tipo de vista
// Nos enganchamos al evento 'change' del genre-filter y al resize
document.addEventListener("DOMContentLoaded", () => {
  const genreFilter = document.getElementById("genre-filter");
  if (genreFilter) {
    genreFilter.addEventListener("change", () => {
      setTimeout(window.syncGenreDrawerTrigger, 50);
    });
  }
  window.addEventListener("resize", window.syncGenreDrawerTrigger, {
    passive: true,
  });
});
/* ════════════════════════════════════════════════════════════════
   DRAWER DE FILTROS — lógica completa
   ════════════════════════════════════════════════════════════════ */

/* Mapa: tab-key → { sourceId, selectId, textId, defaultLabel } */
const FD_CONFIG = {
  genre:   { sourceId: "genre-menu-list",   selectId: "genre-filter",   textId: "genre-text",   defaultLabel: "Géneros"  },
  lang:    { sourceId: "lang-menu-list",    selectId: "lang-filter",    textId: "lang-text",    defaultLabel: "Idioma"   },
  request: { sourceId: "request-menu-list", selectId: "request-filter", textId: "request-text", defaultLabel: "Pedidos"  },
  sort:    { sourceId: "sort-menu-list",    selectId: "sort-by",        textId: "sort-text",    defaultLabel: "Recientes" },
};

/** Construye los items de un panel leyendo la fuente original */
function fdBuildPanel(tab) {
  const cfg    = FD_CONFIG[tab];
  const panel  = document.getElementById(`fd-panel-${tab}`);
  const source = document.getElementById(cfg.sourceId);
  if (!panel || !source) return;

  panel.innerHTML = "";

  const select       = document.getElementById(cfg.selectId);
  const currentValue = select ? select.value : "all";

  [...source.children].forEach((srcItem) => {
    const value = srcItem.dataset?.value ?? "";
    const label = srcItem.textContent?.trim() ?? "";

    const btn = document.createElement("button");
    btn.className  = "fd-item";
    btn.dataset.value = value;
    if (value === currentValue) btn.classList.add("fd-item--selected");

    btn.innerHTML = `<span>${label}</span><i class="fas fa-check fd-item-check"></i>`;

    btn.onclick = () => {
      /* Dispara la lógica original del dropdown */
      srcItem.click();
      /* Actualiza estado visual del panel */
      panel.querySelectorAll(".fd-item").forEach(i => i.classList.remove("fd-item--selected"));
      btn.classList.add("fd-item--selected");
      /* Actualiza badge del tab */
      fdUpdateBadge(tab);
      /* Cierra el drawer */
      closeFiltersDrawer();
    };

    panel.appendChild(btn);
  });
}

/** Muestra/oculta el badge de punto en el tab según si hay filtro activo */
function fdUpdateBadge(tab) {
  const cfg    = FD_CONFIG[tab];
  const select = document.getElementById(cfg.selectId);
  const badge  = document.getElementById(`fd-badge-${tab}`);
  if (!badge) return;
  const value  = select ? select.value : "all";
  const isSort = tab === "sort";
  const active = isSort ? (value !== "recent" && value !== "") : value !== "all";
  badge.classList.toggle("visible", active);
}

/** Reconstruye todos los paneles y actualiza badges */
function fdSync() {
  Object.keys(FD_CONFIG).forEach(tab => {
    fdBuildPanel(tab);
    fdUpdateBadge(tab);
  });
}

window.openFiltersDrawer = function () {
  const drawer   = document.getElementById("filtersDrawer");
  const backdrop = document.getElementById("filtersDrawerBackdrop");
  if (!drawer) return;
  fdSync();
  drawer.classList.add("open");
  backdrop.classList.add("open");
  document.body.classList.add("modal-open");
};

window.closeFiltersDrawer = function () {
  document.getElementById("filtersDrawer")?.classList.remove("open");
  document.getElementById("filtersDrawerBackdrop")?.classList.remove("open");
  document.body.classList.remove("modal-open");
};


document.addEventListener("DOMContentLoaded", () => {
  /* Botón que abre el drawer */
  document.getElementById("catalog-filters-btn")
    ?.addEventListener("click", window.openFiltersDrawer);

  /* Navegación entre tabs */
  document.getElementById("filtersDrawer")
    ?.addEventListener("click", (e) => {
      const tab = e.target.closest(".fd-tab");
      if (!tab) return;
      const key = tab.dataset.tab;

      document.querySelectorAll(".fd-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".fd-panel").forEach(p => p.classList.remove("active"));

      tab.classList.add("active");
      document.getElementById(`fd-panel-${key}`)?.classList.add("active");
    });
});
