// ===========================================================
// CINE CORNETA - SCRIPT PRINCIPAL (MODULAR)
// Versión: 7.0 (Update 30 de Enero 2026)
// ===========================================================

import { logError } from './logger.js';

// ===========================================================
// 🆕 CARGADOR DE MÓDULOS (Code Splitting)
// ===========================================================
let playerModule = null;
let profileModule = null;
let rouletteModule = null;

async function getPlayerModule() {
    if (playerModule) return playerModule;
    const module = await import('./player.js');
    module.initPlayer({
        appState, DOM, ErrorHandler, auth, db,
        addToHistoryIfLoggedIn, closeAllModals, openDetailsModal
    });
    playerModule = module;
    return playerModule;
}

async function getProfileModule() {
    if (profileModule) return profileModule;
    const module = await import('./profile.js?v=7'); 
    module.initProfile({
        appState, DOM, auth, db, switchView
    });
    profileModule = module;
    module.setupUserDropdown();
    return module;
}

async function getRouletteModule() {
    if (rouletteModule) return rouletteModule;
    const module = await import('./roulette.js');
    module.initRoulette({
        appState, DOM, createMovieCardElement, openDetailsModal
    });
    rouletteModule = module;
    return module;
}

// ===========================================================
// SISTEMA CENTRALIZADO DE GESTIÓN DE ERRORES
// ===========================================================
const ErrorHandler = {
    types: {
        NETWORK: 'network',
        AUTH: 'auth',
        DATABASE: 'database',
        CONTENT: 'content',
        UNKNOWN: 'unknown'
    },

    messages: {
        network: 'No se pudo conectar al servidor. Verifica tu conexión.',
        auth: 'Error de autenticación. Intenta iniciar sesión nuevamente.',
        database: 'Error al guardar datos. Tus cambios podrían no haberse guardado.',
        content: 'No se pudo cargar el contenido. Intenta refrescar la página.',
        unknown: 'Ocurrió un error inesperado. Intenta nuevamente.'
    },

    /**
     * Muestra una notificación visual y registra el error en el sistema de logs.
     * @param {string} type - Tipo de error (usar ErrorHandler.types).
     * @param {string|null} customMessage - Mensaje opcional para sobrescribir el default.
     * @param {number} duration - Duración en ms antes de ocultarse (default 5000).
     */
    show(type, customMessage = null, duration = 5000) {
        const message = customMessage || this.messages[type];
        
        // -----------------------------------------------------
        // 1. REGISTRO EN EL LOGGER (FIREBASE)
        // -----------------------------------------------------
        // Esto envía el reporte a tu base de datos para que puedas verlo remotamente
        if (typeof logError === 'function') {
            logError(message, `UI Notification: ${type.toUpperCase()}`, 'warning');
        } else {
            console.warn('[ErrorHandler] logError no está definido. Solo se mostrará en consola.');
            console.error(`[${type.toUpperCase()}] ${message}`);
        }

        // -----------------------------------------------------
        // 2. MOSTRAR NOTIFICACIÓN VISUAL (HTML/CSS)
        // -----------------------------------------------------
        let notification = document.getElementById('error-notification');
        
        // Si no existe el elemento HTML, lo creamos al vuelo
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'error-notification';
            notification.className = 'error-notification';
            document.body.appendChild(notification);
        }

        const icons = {
            network: 'fa-wifi',
            auth: 'fa-user-lock',
            database: 'fa-database',
            content: 'fa-film',
            unknown: 'fa-exclamation-triangle'
        };

        notification.innerHTML = `
            <i class="fas ${icons[type] || icons.unknown}"></i>
            <span>${message}</span> 
            <button class="close-notification">&times;</button>
        `;

        // Añadir clases para animación y color
        notification.className = 'error-notification show'; // Reset de clases base
        notification.classList.add(`type-${type}`);

        // Configurar el temporizador para ocultar
        // Limpiamos cualquier timer anterior para evitar conflictos si salen errores seguidos
        if (this.currentTimeout) clearTimeout(this.currentTimeout);
        
        this.currentTimeout = setTimeout(() => this.hide(), duration);

        // Configurar botón de cierre manual
        notification.querySelector('.close-notification').onclick = () => {
            clearTimeout(this.currentTimeout);
            this.hide();
        };
    },

    hide() {
        const notification = document.getElementById('error-notification');
        if (notification) notification.classList.remove('show');
    },

    /**
     * Wrapper para operaciones de Firebase. Captura errores, los loguea y notifica al usuario.
     */
    async firebaseOperation(operation, type = this.types.DATABASE) {
        try {
            return await operation();
        } catch (error) {
            // Logueamos el error crudo con todo el stack trace
            if (typeof logError === 'function') {
                logError(error, 'Firebase Operation', 'error');
            }

            console.error('Firebase Error:', error);
            
            // Decidimos qué mostrar al usuario según el código de error
            if (error.code === 'PERMISSION_DENIED') {
                this.show(this.types.AUTH, 'No tienes permiso para realizar esta acción.');
            } else if (error.code === 'NETWORK_ERROR') {
                this.show(this.types.NETWORK);
            } else {
                this.show(type);
            }
            
            throw error; // Relanzamos para que la función que llamó sepa que falló
        }
    },

    /**
     * Wrapper para operaciones Fetch (API).
     */
    async fetchOperation(url, options = {}) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            return await response.json();
        } catch (error) {
            // Logueamos el error crudo
            if (typeof logError === 'function') {
                logError(error, `Fetch: ${url}`, 'error');
            }

            console.error('Fetch Error:', error);
            
            if (error.name === 'TypeError') {
                // TypeError en fetch suele ser error de red (offline/DNS)
                this.show(this.types.NETWORK);
            } else {
                this.show(this.types.CONTENT, 'Error al obtener datos del servidor.');
            }
            throw error;
        }
    }
};

// ===========================================================
// 🆕 SISTEMA DE CACHÉ AVANZADO
// ===========================================================
class CacheManager {
    constructor() {
        this.version = '1.2.0';
        this.defaultTTL = 24 * 60 * 60 * 1000;
        this.keys = {
            content: `cineCornetaData_v${this.version}`,
            metadata: `contentMetadata_v${this.version}`
        };
    }

    set(key, data, ttl = this.defaultTTL) {
        try {
            const cacheEntry = {
                data,
                timestamp: Date.now(),
                ttl,
                version: this.version
            };
            localStorage.setItem(key, JSON.stringify(cacheEntry));
            return true;
        } catch (error) {
            console.error('Error al guardar en caché:', error);
            if (error.name === 'QuotaExceededError') {
                this.cleanup(true);
            }
            return false;
        }
    }

    get(key, options = {}) {
        const { ignoreExpiration = false, defaultValue = null } = options;
        try {
            const cached = localStorage.getItem(key);
            if (!cached) return defaultValue;

            const cacheEntry = JSON.parse(cached);

            if (cacheEntry.version !== this.version) {
                this.remove(key);
                return defaultValue;
            }

            if (!ignoreExpiration && cacheEntry.ttl) {
                const age = Date.now() - cacheEntry.timestamp;
                if (age > cacheEntry.ttl) {
                    this.remove(key);
                    return defaultValue;
                }
            }

            return cacheEntry.data;
        } catch (error) {
            console.error('Error al leer caché:', error);
            return defaultValue;
        }
    }

    remove(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            return false;
        }
    }

    cleanup(aggressive = false) {
        try {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key) continue;
                try {
                    const item = localStorage.getItem(key);
                    const parsed = JSON.parse(item);
                    if (parsed.version && parsed.version !== this.version) {
                        keysToRemove.push(key);
                    }
                } catch (e) {
                    if (aggressive) keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
            return keysToRemove.length;
        } catch (error) {
            return 0;
        }
    }

    clearAll() {
        try {
            localStorage.clear();
            return true;
        } catch (error) {
            return false;
        }
    }
}

const cacheManager = new CacheManager();

// ===========================================================
// 🆕 SISTEMA DE LAZY LOADING
// ===========================================================
class LazyImageLoader {
    constructor() {
        this.observer = null;
        this.options = {
            root: null,
            rootMargin: '50px',
            threshold: 0.01
        };
        this.init();
    }

    init() {
        if (!('IntersectionObserver' in window)) {
            this.loadAllImages();
            return;
        }

        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.loadImage(entry.target);
                    this.observer.unobserve(entry.target);
                }
            });
        }, this.options);

        this.observeImages();
    }

    observeImages() {
        const lazyImages = document.querySelectorAll('img[data-src]');
        lazyImages.forEach(img => this.observer.observe(img));
    }

    loadImage(img) {
        const src = img.dataset.src;
        if (!src) return;

        img.classList.add('lazy-loading');
        const tempImg = new Image();
        
        tempImg.onload = () => {
            img.src = src;
            img.classList.remove('lazy-loading');
            img.classList.add('lazy-loaded');
            delete img.dataset.src;
        };

        tempImg.onerror = () => {
            img.classList.remove('lazy-loading');
            img.classList.add('lazy-error');
            console.warn('Error al cargar:', src);
        };

        tempImg.src = src;
    }

    loadAllImages() {
        const lazyImages = document.querySelectorAll('img[data-src]');
        lazyImages.forEach(img => {
            if (img.dataset.src) {
                img.src = img.dataset.src;
                delete img.dataset.src;
            }
        });
    }

    observe(img) {
        if (this.observer) this.observer.observe(img);
    }
}

const lazyLoader = new LazyImageLoader();

// Inyectar estilos de lazy loading
if (!document.getElementById('lazy-loading-styles')) {
    const lazyStyles = document.createElement('style');
    lazyStyles.id = 'lazy-loading-styles';
    lazyStyles.textContent = `
        img[data-src] { filter: blur(5px); transition: filter 0.3s ease; }
        img.lazy-loading {
            background: linear-gradient(135deg, #333 0%, #222 100%);
            animation: pulse 1.5s ease-in-out infinite;
        }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
        img.lazy-loaded { filter: blur(0); animation: fadeIn 0.3s ease-in; }
        @keyframes fadeIn { from { opacity: 0.7; } to { opacity: 1; } }
        img.lazy-error { filter: grayscale(1); opacity: 0.5; }
    `;
    document.head.appendChild(lazyStyles);
}

// ===========================================================
// GESTOR DE ASSETS (ICONOS Y LOGOS AUTOMÁTICOS)
// ===========================================================
const THEME_ASSETS = {
    normal: {
        icon: 'https://res.cloudinary.com/djhgmmdjx/image/upload/v1759209689/u71QEFc_bet4rv.png',
        logo: 'https://res.cloudinary.com/djhgmmdjx/image/upload/v1759209688/vgJjqSM_oicebo.png'
    },
    christmas: {
        icon: 'https://res.cloudinary.com/djhgmmdjx/image/upload/v1762920149/cornenavidad_lxtqh3.webp',
        logo: 'https://res.cloudinary.com/djhgmmdjx/image/upload/v1763875732/NavidadCorneta_pjcdgq.webp'
    }
};

function updateThemeAssets() {
    const isChristmas = document.body.classList.contains('tema-navidad');
    const assets = isChristmas ? THEME_ASSETS.christmas : THEME_ASSETS.normal;

    // 1. Actualizar Logo del Header
    const logoImg = document.getElementById('app-logo');
    if (logoImg) {
        logoImg.src = assets.logo;
    }

    // 2. Actualizar Icono de la Pestaña (Favicon)
    const iconLink = document.getElementById('app-icon');
    if (iconLink) {
        iconLink.href = assets.icon;
    }
}

// ===========================================================
// 1. ESTADO GLOBAL Y CONFIGURACIÓN
// ===========================================================
const appState = {
    content: {
        movies: {},
        series: {},
        sagas: {},       // 🔥 AQUÍ se guardarán UCM, StarWars, HarryPotter, etc. automáticamente
        sagasList: [],   // Lista de botones (orden, logos, colores)
        seriesEpisodes: {},
        seasonPosters: {},
        metadata: { movies: {}, series: {} }
    },
    ui: {
        heroMovieIds: [],
        contentToDisplay: [],
        currentIndex: 0,
        heroInterval: null
    },
    user: {
        watchlist: new Set(),
        historyListenerRef: null
    },
    player: {
        state: {},
        activeSeriesId: null,
        pendingHistorySave: null,
        episodeOpenTimer: null,
        historyUpdateDebounceTimer: null
    },
    flags: {
        isLoadingMore: false,
        pendingUpdate: false
    },
    hero: {
        preloadedImages: new Map(),
        currentIndex: 0,
        isTransitioning: false
    }
};

const DOM = {
    preloader: document.getElementById('preloader'),
    pageWrapper: document.querySelector('.page-wrapper'),
    header: document.querySelector('.main-header'),
    heroSection: document.getElementById('hero-section'),
    carouselContainer: document.getElementById('carousel-container'),
    gridContainer: document.getElementById('full-grid-container'),
    myListContainer: document.getElementById('my-list-container'),
    historyContainer: document.getElementById('history-container'),
    
    // --- SECCIÓN RESEÑAS ---
    reviewsContainer: document.getElementById('reviews-container'),
    reviewsGrid: document.getElementById('reviews-grid'),
    reviewModal: document.getElementById('review-form-modal'),
    reviewForm: document.getElementById('review-submission-form'),
    openReviewBtn: document.getElementById('open-review-modal-btn'),

    detailsModal: document.getElementById('details-modal'),
    cinemaModal: document.getElementById('cinema'),
    rouletteModal: document.getElementById('roulette-modal'),
    seriesPlayerModal: document.getElementById('series-player-modal'),
    authModal: document.getElementById('auth-modal'),
    confirmationModal: document.getElementById('confirmation-modal'),
    searchInput: document.getElementById('search-input'),
    filterControls: document.getElementById('filter-controls'),
    
    // --- FILTROS ---
    genreFilter: document.getElementById('genre-filter'),
    langFilter: document.getElementById('lang-filter'),
    sortBy: document.getElementById('sort-by'),
    ucmSortButtonsContainer: document.getElementById('ucm-sort-buttons'),
    ucmSortButtons: document.querySelectorAll('.sort-btn'),
    
    // --- AUTH ---
    authButtons: document.getElementById('auth-buttons'),
    loginBtnHeader: document.getElementById('login-btn-header'),
    registerBtnHeader: document.getElementById('register-btn-header'),
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    switchAuthModeLink: document.getElementById('switch-auth-mode'),
    loginError: document.getElementById('login-error'),
    registerError: document.getElementById('register-error'),
    registerUsernameInput: document.getElementById('register-username'),
    registerEmailInput: document.getElementById('register-email'),
    registerPasswordInput: document.getElementById('register-password'),
    loginEmailInput: document.getElementById('login-email'),
    loginPasswordInput: document.getElementById('login-password'),
    
    // --- PERFIL ---
    userProfileContainer: document.getElementById('user-profile-container'),
    userGreetingBtn: document.getElementById('user-greeting'),
    userMenuDropdown: document.getElementById('user-menu-dropdown'),
    myListNavLink: document.getElementById('my-list-nav-link'),
    historyNavLink: document.getElementById('history-nav-link'),
    profileUsername: document.getElementById('profile-username'),
    profileEmail: document.getElementById('profile-email'),
    settingsUsernameInput: document.getElementById('settings-username-input'),
    updateUsernameBtn: document.getElementById('update-username-btn'),
    settingsPasswordInput: document.getElementById('settings-password-input'),
    updatePasswordBtn: document.getElementById('update-password-btn'),
    settingsFeedback: document.getElementById('settings-feedback'),
    confirmDeleteBtn: document.getElementById('confirm-delete-btn'),
    cancelDeleteBtn: document.getElementById('cancel-delete-btn'),
    
    // --- MÓVIL ---
    hamburgerBtn: document.getElementById('menu-toggle'),
    mobileNavPanel: document.getElementById('mobile-nav-panel'),
    closeNavBtn: document.querySelector('.close-nav-btn'),
    menuOverlay: document.getElementById('menu-overlay')
};

const API_URL = 'https://script.google.com/macros/s/AKfycbzwYJhV9v9MX1CCTYznjcNNDvssk0edltwl_OhUG3DmR5mN34bLou2vfMavbDTdgWHv/exec';
const ITEMS_PER_LOAD = window.innerWidth < 1600 ? 25 : 24;

const firebaseConfig = {
    apiKey: "AIzaSyBgfvfYs-A_-IgAbYoT8GAmoOrSi--cLkw",
    authDomain: "cine-corneta.firebaseapp.com",
    projectId: "cine-corneta",
    storageBucket: "cine-corneta.appspot.com",
    messagingSenderId: "404306744690",
    appId: "1:404306744690:web:28f77ec91347e1f5f6b9eb",
    databaseURL: "https://cine-corneta-default-rtdb.firebaseio.com/"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

// ===========================================================
// 2. INICIO Y CARGA DE DATOS (🆕 MEJORADO CON CACHÉ)
// ===========================================================
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('force_update')) {
        const preloader = document.getElementById('preloader');
        if (preloader) {
            // Reemplazamos el spinner simple por un mensaje informativo
            preloader.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
                    <div class="spinner" style="margin-bottom: 20px;"></div>
                    <h2 class="loading-text" style="font-size: 2rem; color: var(--text-light); margin: 0;">REFRESCANDO CONTENIDO</h2>
                    <p style="color: var(--text-muted); margin-top: 10px; font-size: 1.1rem;">Aplicando la última versión...</p>
                </div>
            `;
        }
        // Limpiamos la URL para que si el usuario recarga manual después, no salga el mensaje
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
    }

    updateThemeAssets();
    fetchInitialDataWithCache();
    checkResetPasswordMode();
});

function preloadImage(url) {
    return new Promise((resolve) => {
        if (!url) { resolve(); return; }
        const img = new Image();
        img.src = url;
        img.onload = () => resolve();
        img.onerror = () => resolve(); // Resolvemos aunque falle para no bloquear la app
    });
}

async function fetchInitialDataWithCache() {
    // =========================================================================
    // ⚡ 1. DETECTOR DE HARDWARE (OPTIMIZACIÓN AUTOMÁTICA)
    // =========================================================================
    // Esto detecta si tu PC es "modesta" (4 núcleos o menos, como tu Celeron)
    // y activa la clase 'low-spec' para apagar los efectos pesados.
    const cores = navigator.hardwareConcurrency || 4; // Si el navegador no lo dice, asumimos 4
    if (cores <= 4) {
        console.log(`💻 Hardware modesto detectado (${cores} núcleos): Activando Modo Rendimiento.`);
        document.body.classList.add('low-spec');
    } else {
        console.log(`🚀 Hardware potente detectado (${cores} núcleos): Gráficos en Ultra.`);
        document.body.classList.remove('low-spec');
    }

    const startLoadTime = Date.now();

    // =========================================================================
    // 📡 2. SISTEMA DE ACTUALIZACIÓN INTELIGENTE (Firebase)
    // =========================================================================
    if (typeof db !== 'undefined') {
        const updatesRef = db.ref('system_metadata/last_update');
        updatesRef.on('value', (snapshot) => {
            const serverLastUpdate = Number(snapshot.val()); 
            const localRaw = localStorage.getItem('local_last_update');
            const localLastUpdate = localRaw ? Number(localRaw) : 0;

            console.log(`📡 Señal: Server(${serverLastUpdate}) vs Local(${localLastUpdate})`);

            // Caso: Nueva versión detectada en el servidor
            if (serverLastUpdate > localLastUpdate) {
                console.log('🔄 ADMIN: Nueva versión detectada.');
                const isWatching = document.body.classList.contains('modal-open');

                if (isWatching) {
                    // Si está viendo algo, programamos recarga silenciosa
                    console.log('🎬 Usuario ocupado. Programando recarga en localStorage...');
                    localStorage.setItem('pending_reload', 'true');
                    localStorage.setItem('local_last_update', serverLastUpdate);
                    refreshDataInBackground(); 
                } else {
                    // Si está libre, forzamos recarga inmediata
                    console.log('🚀 Aplicando actualización inmediata...');
                    if (window.cacheManager) {
                        window.cacheManager.clearAll();
                    } else {
                        localStorage.clear();
                    }
                    localStorage.setItem('local_last_update', serverLastUpdate);
                    
                    const url = new URL(window.location.href);
                    url.searchParams.set('force_update', Date.now());
                    window.location.href = url.toString();
                }
            } 
            else if (serverLastUpdate && localLastUpdate === 0) {
                localStorage.setItem('local_last_update', serverLastUpdate);
            }
        });
    }

    // =========================================================================
    // ⚙️ 3. PROCESAMIENTO DE DATOS
    // =========================================================================
    const processData = (data) => {
        appState.content.movies = data.allMovies || {};
        appState.content.series = data.series || {};
        appState.content.seriesEpisodes = data.episodes || {};
        appState.content.seasonPosters = data.posters || {};
        
        // Procesamos la lista de sagas
        appState.content.sagasList = Object.values(data.sagas_list || {});
        
        // Asignamos el contenido de cada saga a su ID dinámicamente
        if (appState.content.sagasList.length > 0) {
            appState.content.sagasList.forEach(saga => {
                if (data[saga.id]) {
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
        setupEventListeners();
        setupNavigation();
        setupAuthListeners();
        setupSearch();
        setupPageVisibilityHandler();

        // Determinar qué vista mostrar según la URL o navegación
        const activeFilter = document.querySelector('.main-nav a.active, .mobile-nav a.active')?.dataset.filter || 'all';
        const isSaga = appState.content.sagas[activeFilter];

        if (['movie', 'series'].includes(activeFilter) || isSaga) {
            applyAndDisplayFilters(activeFilter);
        } else if (activeFilter === 'sagas') {
            switchView('sagas');
        }

        // Transición de entrada suave (fade in)
        const timeElapsed = Date.now() - startLoadTime;
        const remainingTime = Math.max(0, 800 - timeElapsed);
        await new Promise(r => setTimeout(r, remainingTime));

        requestAnimationFrame(() => {
            if (DOM.pageWrapper) DOM.pageWrapper.style.display = 'block';
            setTimeout(() => {
                if (DOM.pageWrapper) DOM.pageWrapper.classList.add('visible'); 
                if (DOM.preloader) DOM.preloader.classList.add('fade-out');
            }, 50);
            setTimeout(() => { if(DOM.preloader) DOM.preloader.remove(); }, 800); 
        });
    };

    // =========================================================================
    // 🚀 4. LÓGICA DE CARGA: CACHÉ VS INTERNET
    // =========================================================================
    const cachedContent = cacheManager.get(cacheManager.keys.content);
    const cachedMetadata = cacheManager.get(cacheManager.keys.metadata);

    // --- OPCIÓN A: USAR CACHÉ (Rápido) ---
    if (cachedContent) {
        console.log('✓ Iniciando desde caché...');
        processData(cachedContent);
        setupRatingsListener();
        await setupAndShow(cachedMetadata?.movies, cachedMetadata?.series);
        refreshDataInBackground(); // Actualiza silenciosamente por si acaso
        
        // Cargar Historial "Continuar Viendo" si hay usuario
        const user = auth.currentUser;
        if (user) {
            db.ref(`users/${user.uid}/history`).orderByChild('viewedAt').once('value', snapshot => {
                if (snapshot.exists()) generateContinueWatchingCarousel(snapshot);
            });
        }
    } 
    // --- OPCIÓN B: DESCARGAR DE INTERNET (Primera vez o caché borrada) ---
    else {
        try {
            console.log('⟳ Descargando base de datos completa...');
            
            // 1. CARGA INICIAL: Estructura base + LISTA DE SAGAS
            const [series, episodes, allMovies, posters, sagasListData, movieMeta, seriesMeta] = await Promise.all([
                ErrorHandler.fetchOperation(`${API_URL}?data=series`),
                ErrorHandler.fetchOperation(`${API_URL}?data=episodes`),
                ErrorHandler.fetchOperation(`${API_URL}?data=allMovies&order=desc`),
                ErrorHandler.fetchOperation(`${API_URL}?data=PostersTemporadas`),
                ErrorHandler.fetchOperation(`${API_URL}?data=sagas_list`),
                db.ref('movie_metadata').once('value').then(s => s.val() || {}),
                db.ref('series_metadata').once('value').then(s => s.val() || {})
            ]);

            // 2. CARGA DINÁMICA DE SAGAS (Una petición por cada saga en la lista)
            const sagasArray = Object.values(sagasListData || {});
            const sagasRequests = sagasArray.map(saga => 
                ErrorHandler.fetchOperation(`${API_URL}?data=${saga.id}`)
                .then(data => ({ id: saga.id, data: data }))
            );

            const sagasResults = await Promise.all(sagasRequests);

            // 3. ARMADO DEL PAQUETE FINAL
            const freshContent = { 
                allMovies, series, episodes, posters, 
                sagas_list: sagasListData 
            };

            // Inyectamos cada saga descargada
            sagasResults.forEach(item => {
                freshContent[item.id] = item.data;
            });
            
            const freshMetadata = { movies: movieMeta, series: seriesMeta };

            // 4. GUARDAR EN CACHÉ Y RENDERIZAR
            processData(freshContent);
            cacheManager.set(cacheManager.keys.content, freshContent);
            cacheManager.set(cacheManager.keys.metadata, freshMetadata);
            setupRatingsListener();
            
            if (!localStorage.getItem('local_last_update')) {
                localStorage.setItem('local_last_update', Date.now());
            }

            await setupAndShow(freshMetadata.movies, freshMetadata.series);
            
            const user = auth.currentUser;
            if (user) {
                db.ref(`users/${user.uid}/history`).orderByChild('viewedAt').once('value', snapshot => {
                    if (snapshot.exists()) generateContinueWatchingCarousel(snapshot);
                });
            }

        } catch (error) {
            console.error('✗ Error crítico en carga inicial:', error);
            if (DOM.preloader) DOM.preloader.innerHTML = `
                <div style="text-align: center; color: white;">
                    <p>Error de conexión</p>
                    <button onclick="location.reload()" class="btn-primary" style="margin-top:10px;">Reintentar</button>
                </div>`;
        }
    }
}

async function refreshDataInBackground() {
    try {
        // 1. Pedimos datos base + lista de sagas
        const [series, episodes, allMovies, posters, sagasListData] = await Promise.all([
            ErrorHandler.fetchOperation(`${API_URL}?data=series`),
            ErrorHandler.fetchOperation(`${API_URL}?data=episodes`),
            ErrorHandler.fetchOperation(`${API_URL}?data=allMovies&order=desc`),
            ErrorHandler.fetchOperation(`${API_URL}?data=PostersTemporadas`),
            ErrorHandler.fetchOperation(`${API_URL}?data=sagas_list`)
        ]);

        // 2. Pedimos las sagas dinámicamente
        const sagasArray = Object.values(sagasListData || {});
        const sagasRequests = sagasArray.map(saga => 
            ErrorHandler.fetchOperation(`${API_URL}?data=${saga.id}`)
            .then(data => ({ id: saga.id, data: data }))
        );

        const sagasResults = await Promise.all(sagasRequests);

        const freshContent = { 
            allMovies, series, episodes, posters, 
            sagas_list: sagasListData 
        };

        sagasResults.forEach(item => {
            freshContent[item.id] = item.data;
        });

        cacheManager.set(cacheManager.keys.content, freshContent);
        console.log('✓ Caché actualizada en segundo plano (Sagas Dinámicas)');
    } catch (e) { console.warn('No se pudo actualizar background', e); }
}

// ===========================================================
// 3. NAVEGACIÓN Y MANEJO DE VISTAS
// ===========================================================
function setupNavigation() {
    // 🔥 FIX: Agregamos '.header-right' a la lista para que detecte el clic en la Ruleta del móvil
    const navContainers = document.querySelectorAll('.main-nav ul, .mobile-nav ul, .bottom-nav, #profile-hub-container, .header-right');
    
    // Asigna el evento a cada contenedor (Delegación de eventos)
    navContainers.forEach(container => {
        if (container) { // Chequeo de seguridad por si alguno no existe
            container.addEventListener('click', handleFilterClick);
        }
    });
    
    // Lógica del menú hamburguesa (Móvil)
    const openMenu = () => { 
        if (DOM.mobileNavPanel) DOM.mobileNavPanel.classList.add('is-open'); 
        if (DOM.menuOverlay) DOM.menuOverlay.classList.add('active'); 
    };
    const closeMenu = () => { 
        if (DOM.mobileNavPanel) DOM.mobileNavPanel.classList.remove('is-open'); 
        if (DOM.menuOverlay) DOM.menuOverlay.classList.remove('active'); 
    };

    if (DOM.hamburgerBtn) DOM.hamburgerBtn.addEventListener('click', openMenu);
    if (DOM.closeNavBtn) DOM.closeNavBtn.addEventListener('click', closeMenu);
    if (DOM.menuOverlay) DOM.menuOverlay.addEventListener('click', closeMenu);
}

async function handleFilterClick(event) {
    // 1. Detectar si el clic fue en un enlace <a>
    const link = event.target.closest('a');
    if (!link) return;

    // 🔥 FIX CRÍTICO: Si el enlace NO tiene data-filter (ej: botón Ingresar/Registro),
    // detenemos la función aquí. Así no se ejecuta switchView() ni se borra el fondo.
    if (!link.dataset.filter) return;

    // 2. Si tiene filtro, prevenimos la navegación estándar del navegador
    event.preventDefault();

    // 3. Cerrar menús móviles y dropdowns si están abiertos
    if (DOM.mobileNavPanel) DOM.mobileNavPanel.classList.remove('is-open');
    if (DOM.menuOverlay) DOM.menuOverlay.classList.remove('active');
    if (DOM.userMenuDropdown) DOM.userMenuDropdown.classList.remove('show');

    const filter = link.dataset.filter;

    // 4. Caso Especial: Ruleta (Carga el módulo y abre modal, no cambia de vista)
    if (filter === 'roulette') {
        const roulette = await getRouletteModule();
        roulette.openRouletteModal();
        return;
    }

    // 5. Optimización: Si ya estamos en esa sección, no recargar (excepto Historial y Lista)
    if (link.classList.contains('active') && !['history', 'my-list'].includes(filter)) return;

    // 6. Actualizar el estado visual (.active) en los menús
    document.querySelectorAll('a[data-filter]').forEach(l => l.classList.remove('active'));
    document.querySelectorAll(`a[data-filter="${filter}"]`).forEach(l => l.classList.add('active'));

    // 7. Limpiar la barra de búsqueda y cambiar la vista principal
    if (DOM.searchInput) DOM.searchInput.value = '';
    switchView(filter);
}

// ===========================================================
// FUNCIÓN SWITCHVIEW (CORREGIDA PARA RULETA)
// ===========================================================

// 1. Función auxiliar para iluminar los botones del menú
function updateActiveNav(filter) {
    // Si es Ruleta, NO tocamos el menú (para que siga iluminado donde estabas)
    if (filter === 'roulette') return;

    document.querySelectorAll('.main-nav a, .bottom-nav .nav-link').forEach(link => {
        link.classList.remove('active');
    });
    
    if (filter) {
        const selector = `.main-nav a[data-filter="${filter}"], .bottom-nav .nav-link[data-filter="${filter}"]`;
        document.querySelectorAll(selector).forEach(link => link.classList.add('active'));
    }
}

// 2. Función Principal de Cambio de Vista
async function switchView(filter) {
    // 🔥 FIX RULETA: Si es ruleta, abrimos el modal y SALIMOS.
    // No ocultamos el fondo (return) para que parezca un popup sobre la web.
    if (filter === 'roulette') {
        const roulette = await getRouletteModule();
        roulette.openRouletteModal();
        return; 
    }

    console.log(`Switched to: ${filter}`);
    appState.currentFilter = filter;
    
    // A. Actualizar botones del menú visualmente
    updateActiveNav(filter);

    // B. Ocultar todo para empezar limpio (SOLO SI NO ES RULETA)
    const containers = [
        document.getElementById('hero-section'),
        document.getElementById('carousel-container'),
        document.getElementById('full-grid-container'),
        document.getElementById('my-list-container'),
        document.getElementById('history-container'),
        document.getElementById('profile-container'),
        document.getElementById('settings-container'),
        document.getElementById('profile-hub-container'),
        document.getElementById('sagas-hub-container'),
        document.getElementById('reviews-container'),
        document.getElementById('live-tv-section')
    ];

    containers.forEach(el => { 
        if(el) el.style.display = 'none'; 
    });

    const filterControls = document.getElementById('filter-controls');
    if (filterControls) filterControls.style.display = 'none';

    // C. DETENER VIDEO EN VIVO (Limpieza)
    const liveVideo = document.getElementById('embedded-live-video');
    if (liveVideo) {
        liveVideo.pause();
        liveVideo.removeAttribute('src'); 
        liveVideo.load();
    }
    if (window.hlsLiveInstance) {
        window.hlsLiveInstance.destroy();
        window.hlsLiveInstance = null;
    }

    // =======================================================
    // D. LÓGICA POR PANTALLA
    // =======================================================

    // 1. FESTIVAL DE VIÑA (EN VIVO) 🎸
    if (filter === 'live') {
        const liveSection = document.getElementById('live-tv-section');
        const bgLayer = document.getElementById('live-bg-image');
        const loading = document.getElementById('live-loading-indicator');
        const videoEl = document.getElementById('embedded-live-video');

        if (liveSection) {
            liveSection.style.display = 'flex'; 
            if (loading) loading.style.display = 'block';

            firebase.database().ref('system_metadata').once('value', (snapshot) => {
                const data = snapshot.val() || {};
                const liveUrl = data.live_festival_url;
                const bgUrl = data.live_background_url;

                if (bgUrl && bgLayer) {
                    bgLayer.style.backgroundImage = `url('${bgUrl}')`;
                    bgLayer.style.backgroundSize = 'cover';
                }

                if (!liveUrl) {
                    if (window.ErrorHandler) ErrorHandler.show('content', 'La señal no está disponible.');
                    if (loading) loading.style.display = 'none';
                    return;
                }

                if (Hls.isSupported()) {
                    window.hlsLiveInstance = new Hls();
                    window.hlsLiveInstance.loadSource(liveUrl);
                    window.hlsLiveInstance.attachMedia(videoEl);
                    window.hlsLiveInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                        videoEl.play().catch(e => console.log("Autoplay bloqueado"));
                        if (loading) loading.style.display = 'none';
                    });
                } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
                    videoEl.src = liveUrl;
                    videoEl.addEventListener('loadedmetadata', () => {
                        videoEl.play();
                        if (loading) loading.style.display = 'none';
                    });
                }
            });
        }
        window.scrollTo(0, 0);
        return;
    }

    // 2. INICIO (HOME)
    if (filter === 'all') {
        if(DOM.heroSection) DOM.heroSection.style.display = 'flex';
        if(DOM.carouselContainer) DOM.carouselContainer.style.display = 'block';
        return;
    } 
    
    // 3. HUB DE UNIVERSOS
    if (filter === 'sagas') {
        const hub = document.getElementById('sagas-hub-container');
        if (hub) {
            hub.style.display = 'block';
            renderSagasHub();
        }
        return;
    }

    // 4. CONTENIDO (Películas, Series o Saga Específica)
    const isDynamicSaga = appState.content.sagas && appState.content.sagas[filter];

    if (filter === 'movie' || filter === 'series' || isDynamicSaga) {
        if(DOM.gridContainer) DOM.gridContainer.style.display = 'block';
        if(filterControls) filterControls.style.display = 'flex';
        
        const backBtn = document.getElementById('back-to-sagas-btn');
        if (backBtn) {
            backBtn.style.display = isDynamicSaga ? 'flex' : 'none';
            backBtn.onclick = () => switchView('sagas');
        }

        populateFilters(filter); 
        applyAndDisplayFilters(filter);
        return;
    }
    
    // 5. MI LISTA
    if (filter === 'my-list') {
        if(document.getElementById('my-list-container')) {
            document.getElementById('my-list-container').style.display = 'block';
            displayMyListView();
        }
        return;
    } 
    
    // 6. HISTORIAL
    if (filter === 'history') {
        if(document.getElementById('history-container')) {
            document.getElementById('history-container').style.display = 'block';
            renderHistory();
        }
        return;
    } 
    
    // 7. RESEÑAS
    if (filter === 'reviews') {
        const reviewsContainer = document.getElementById('reviews-container');
        if(reviewsContainer) {
            reviewsContainer.style.display = 'block';
            if(window.renderReviews) renderReviews(); 
        }
        return;
    }

    // 8. PERFIL Y AJUSTES
    if (filter === 'profile-hub' || filter === 'profile' || filter === 'settings') {
        const containerMap = {
            'profile-hub': 'profile-hub-container',
            'profile': 'profile-container',
            'settings': 'settings-container'
        };
        const container = document.getElementById(containerMap[filter]);
        if (container) {
            container.style.display = 'block';
            if (filter === 'profile') getProfileModule().then(m => m.renderProfile());
            if (filter === 'settings') getProfileModule().then(m => m.renderSettings());
        }
        return;
    }

    // 9. RESULTADOS DE BÚSQUEDA
    if (filter === 'search') {
        if(DOM.gridContainer) DOM.gridContainer.style.display = 'block';
        return;
    }

    // Scroll arriba por defecto
    window.scrollTo(0, 0);
}

function populateFilters(type) {
    let sourceData;
    if (type === 'movie') sourceData = appState.content.movies;
    else if (type === 'series') sourceData = appState.content.series;
    else sourceData = appState.content.sagas[type];

    // 1. LEER CONFIGURACIÓN DEL EXCEL (Modular)
    const sagaConfig = appState.content.sagasList.find(s => s.id === type) || {};
    
    // Configuraciones por defecto (si no es saga, asumimos comportamiento estándar)
    const confGenres = (sagaConfig.genres_filter || 'si').toLowerCase().trim(); // fases, sagas, eras, si, no
    const confSortBtn = (sagaConfig.sort_buttons || 'no').toLowerCase().trim(); // si, no
    const confLang   = (sagaConfig.lang_filter || 'si').toLowerCase().trim();   // si, no

    // Elementos del DOM
    const genreVisual = document.getElementById('genre-dropdown-visual');
    const sortVisual  = document.getElementById('sort-dropdown-visual');
    const langVisual  = document.getElementById('lang-dropdown-visual');
    const ucmButtons  = document.getElementById('ucm-sort-buttons');
    
    const genreList = document.getElementById('genre-menu-list');
    const sortList  = document.getElementById('sort-menu-list');
    const langList  = document.getElementById('lang-menu-list');

    const controlsContainer = document.getElementById('filter-controls');
    if (controlsContainer) controlsContainer.style.display = 'flex';

    // 2. VISIBILIDAD DE CONTROLES (Según Excel)
    
    // A. Filtro de Géneros / Fases / Sagas
    if (genreVisual) genreVisual.style.display = (confGenres !== 'no') ? 'block' : 'none';

    // B. Botones de Cronología (El reemplazo del Sort tradicional)
    if (ucmButtons) {
        ucmButtons.style.display = (confSortBtn === 'si') ? 'flex' : 'none';
        // Si activamos botones, ocultamos el dropdown de sort tradicional
        if (sortVisual) sortVisual.style.display = (confSortBtn === 'si') ? 'none' : 'block';
        
        // Activar lógica de clic en botones
        if (DOM.ucmSortButtons) {
            DOM.ucmSortButtons.forEach(btn => {
                btn.onclick = (e) => {
                    DOM.ucmSortButtons.forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    applyAndDisplayFilters(type);
                };
            });
        }
    } else {
        if (sortVisual) sortVisual.style.display = 'block';
    }

    // C. Filtro de Idioma
    if (langVisual) langVisual.style.display = (confLang === 'si') ? 'block' : 'none';


    // 3. GENERADOR DE ITEMS (Helper)
    const createItem = (value, label, menuType, isGroup = false, imgUrl = null) => {
        const div = document.createElement('div');
        div.className = isGroup ? 'dropdown-group-title' : 'dropdown-item';
        
        if (isGroup && imgUrl) {
            div.innerHTML = `<img src="${imgUrl}" class="dropdown-group-logo" alt="${label}">`;
            div.classList.add('has-logo');
        } else {
            div.textContent = label;
        }

        // Si es grupo con valor (ej: Saga del Infinito), es clicable
        if (isGroup && value) div.style.cursor = "pointer";

        div.onclick = (e) => {
            e.stopPropagation(); 
            if (menuType === 'genre') {
                document.getElementById('genre-text').textContent = label; 
                DOM.genreFilter.value = value; 
                if (genreVisual) genreVisual.classList.remove('open');
            } else if (menuType === 'lang') {
                document.getElementById('lang-text').textContent = label;
                DOM.langFilter.value = value;
                if (langVisual) langVisual.classList.remove('open');
            } else {
                document.getElementById('sort-text').textContent = label;
                DOM.sortBy.value = value;
                if (sortVisual) sortVisual.classList.remove('open');
            }
            applyAndDisplayFilters(type);
        };
        return div;
    };


    // 4. POPULAR LISTA DE GÉNEROS (Lógica Modular)
    if (confGenres !== 'no') {
        genreList.innerHTML = '';
        DOM.genreFilter.innerHTML = `<option value="all">Todos</option>`; 
        
        // CASO: FASES (Tipo Marvel)
        if (confGenres === 'fases') {
            genreList.appendChild(createItem('all', 'Todas las Fases', 'genre'));
            document.getElementById('genre-text').textContent = "Todas las Fases";
            
            // Fases hardcodeadas o dinámicas, aquí uso tu estructura UCM
            const estructuraSagas = [
                { id: 'saga_infinity', titulo: "Saga del Infinito", img: "https://res.cloudinary.com/djhgmmdjx/image/upload/v1764056286/InfinitySaga2_t3ixis.svg", fases: ['1', '2', '3'] },
                { id: 'saga_multiverse', titulo: "Saga del Multiverso", img: "https://res.cloudinary.com/djhgmmdjx/image/upload/v1764056259/MultiverseSaga2_waggse.svg", fases: ['4', '5', '6'] }
            ];

            const fasesDisponibles = new Set(Object.values(sourceData).map(i => String(i.fase || '').trim()).filter(Boolean));

            estructuraSagas.forEach(saga => {
                genreList.appendChild(createItem(saga.id, saga.titulo, 'genre', true, saga.img));
                DOM.genreFilter.innerHTML += `<option value="${saga.id}">${saga.titulo}</option>`;
                saga.fases.forEach(f => { 
                    if(fasesDisponibles.has(f)) {
                        genreList.appendChild(createItem(f, `Fase ${f}`, 'genre'));
                        DOM.genreFilter.innerHTML += `<option value="${f}">Fase ${f}</option>`;
                    }
                });
            });

        // CASO: SAGAS (Tipo Harry Potter)
        } else if (confGenres === 'sagas') {
            genreList.appendChild(createItem('all', 'Todas las Sagas', 'genre'));
            document.getElementById('genre-text').textContent = "Todas las Sagas";
            
            // Aquí personaliza según tus necesidades o lee dinámicamente
            genreList.appendChild(createItem('Harry Potter', 'Harry Potter', 'genre'));
            genreList.appendChild(createItem('Animales Fantásticos', 'Animales Fantásticos', 'genre'));
            DOM.genreFilter.innerHTML += `<option value="Harry Potter">Harry Potter</option>`;
            DOM.genreFilter.innerHTML += `<option value="Animales Fantásticos">Animales Fantásticos</option>`;

        // CASO: ERAS (Tipo Star Wars)
        } else if (confGenres === 'eras') {
            genreList.appendChild(createItem('all', 'Todas las Eras', 'genre'));
            document.getElementById('genre-text').textContent = "Todas las Eras";
            
            const eras = [{ id: 'republic', label: 'La República' }, { id: 'empire', label: 'El Imperio' }, { id: 'rebellion', label: 'La Rebelión' }];
            eras.forEach(e => {
                genreList.appendChild(createItem(e.id, e.label, 'genre'));
                DOM.genreFilter.innerHTML += `<option value="${e.id}">${e.label}</option>`;
            });

        // CASO: ESTÁNDAR (Por géneros de la columna 'genres')
        } else {
            const genres = new Set(Object.values(sourceData).flatMap(i => i.genres ? String(i.genres).split(';') : []));
            genreList.appendChild(createItem('all', 'Todos', 'genre'));
            document.getElementById('genre-text').textContent = "Géneros";
            
            Array.from(genres).sort().forEach(g => {
                const gTrim = g.trim();
                if(gTrim) {
                    genreList.appendChild(createItem(gTrim, gTrim, 'genre'));
                    DOM.genreFilter.innerHTML += `<option value="${gTrim}">${gTrim}</option>`;
                }
            });
        }
    }

    // 5. POPULAR IDIOMAS (Solo si está activado)
    if (confLang === 'si') {
        langList.innerHTML = '';
        DOM.langFilter.innerHTML = `<option value="all">Todos</option>`;
        const languages = new Set(Object.values(sourceData).map(i => i.language ? String(i.language).trim() : '').filter(l => l !== ''));
        langList.appendChild(createItem('all', 'Todos', 'lang'));
        document.getElementById('lang-text').textContent = "Idioma";
        
        Array.from(languages).sort().forEach(l => {
            langList.appendChild(createItem(l, l, 'lang'));
            DOM.langFilter.innerHTML += `<option value="${l}">${l}</option>`;
        });
    }

    // 6. POPULAR SORT TRADICIONAL (Solo si NO hay botones)
    if (confSortBtn === 'no') {
        sortList.innerHTML = '';
        const sortOptions = [
            {val:'recent', label:'Recientes'},
            {val:'year-desc', label:'Año (Des)'},
            {val:'year-asc', label:'Año (Asc)'},
            {val:'title-asc', label:'Título (A-Z)'},
            {val:'title-desc', label:'Título (Z-A)'}
        ];
        sortOptions.forEach(o => {
            sortList.appendChild(createItem(o.val, o.label, 'sort'));
            DOM.sortBy.innerHTML += `<option value="${o.val}">${o.label}</option>`;
        });
    }
    
    // Configuración de Triggers del menú
    const configDropdown = (trigger, visual) => {
        if (!trigger) return;
        const newTrigger = trigger.cloneNode(true);
        trigger.parentNode.replaceChild(newTrigger, trigger);
        newTrigger.onclick = (e) => { 
            e.stopPropagation(); 
            [genreVisual, sortVisual, langVisual].forEach(v => {
                if(v && v !== visual) v.classList.remove('open');
            });
            visual.classList.toggle('open'); 
        };
    };

    if(document.getElementById('genre-trigger')) configDropdown(document.getElementById('genre-trigger'), genreVisual);
    if(document.getElementById('sort-trigger')) configDropdown(document.getElementById('sort-trigger'), sortVisual);
    if(document.getElementById('lang-trigger')) configDropdown(document.getElementById('lang-trigger'), langVisual); 
}

async function applyAndDisplayFilters(type) {
    let sourceData;
    if (type === 'movie') sourceData = appState.content.movies;
    else if (type === 'series') sourceData = appState.content.series;
    else sourceData = appState.content.sagas[type]; 

    const gridEl = DOM.gridContainer.querySelector('.grid');
    if (!gridEl || !sourceData) return;

    // 1. LEER CONFIGURACIÓN (Igual que arriba)
    const sagaConfig = appState.content.sagasList.find(s => s.id === type) || {};
    const confGenres = (sagaConfig.genres_filter || 'si').toLowerCase().trim();
    const confSortBtn = (sagaConfig.sort_buttons || 'no').toLowerCase().trim();
    const confLang   = (sagaConfig.lang_filter || 'si').toLowerCase().trim();

    // Determinar valor de ordenamiento
    let sortByValue;
    if (confSortBtn === 'si') {
        // Si hay botones, miramos cuál está activo
        const activeBtn = document.querySelector('.sort-btn.active');
        sortByValue = activeBtn ? activeBtn.dataset.sort : 'release'; 
    } else {
        // Si no, miramos el dropdown tradicional
        sortByValue = DOM.sortBy.value || 'recent';
    }

    gridEl.innerHTML = `<div style="width:100%;height:60vh;display:flex;justify-content:center;align-items:center;grid-column:1/-1;"><p class="loading-text">Cargando...</p></div>`;

    // 2. OBTENER DATOS (Invertir solo si es saga dinámica para respetar orden Excel)
    let content = Object.entries(sourceData);
    const isDynamicSaga = (type !== 'movie' && type !== 'series');
    if (isDynamicSaga) content = content.reverse();
    content.forEach((item, index) => { item[1]._originalIndex = index; });

    // 3. APLICAR FILTROS
    
    // A. Género / Fase / Saga
    if (confGenres !== 'no' && DOM.genreFilter.value !== 'all') {
        const filterVal = DOM.genreFilter.value.toLowerCase().trim();
        
        content = content.filter(([id, item]) => {
            // Lógica Específica según tipo de configuración
            if (confGenres === 'fases') {
                const fase = String(item.fase || '').trim();
                if (filterVal === 'saga_infinity') return ['1','2','3'].includes(fase);
                if (filterVal === 'saga_multiverse') return ['4','5','6'].includes(fase);
                return fase === filterVal;
            }
            // Búsqueda genérica (Funciona para 'sagas', 'eras' y 'si')
            // Busca en genres O en el título (útil para Harry Potter vs Animales Fantásticos)
            const genresStr = String(item.genres || '').toLowerCase();
            const titleStr = String(item.title || '').toLowerCase();
            return genresStr.includes(filterVal) || titleStr.includes(filterVal);
        });
    }

    // B. Idioma
    if (confLang === 'si' && DOM.langFilter && DOM.langFilter.value !== 'all') {
        const langVal = DOM.langFilter.value.toLowerCase().trim();
        content = content.filter(([id, item]) => {
            return String(item.language || '').toLowerCase().includes(langVal);
        });
    }

    // 4. APLICAR ORDENAMIENTO
    content.sort((a, b) => {
        const idA = a[0]; const idB = b[0];
        const aData = a[1]; const bData = b[1];

        if (sortByValue === 'recent' || sortByValue === 'release') {
            
            // Detectamos tipos
            const typeA = (aData.type === 'series' || appState.content.series[idA]) ? 'series' : 'movie';
            const typeB = (bData.type === 'series' || appState.content.series[idB]) ? 'series' : 'movie';

            // Calculamos el TIEMPO EXACTO (milisegundos)
            const timeA = getLatestUpdateTimestamp(idA, aData, typeA);
            const timeB = getLatestUpdateTimestamp(idB, bData, typeB);

            // 1. SI TIENEN FECHAS DISTINTAS (O HORAS DISTINTAS)
            // Gana el número más alto (el más reciente)
            if (timeA !== timeB) {
                return timeB - timeA; 
            }

            // 2. SI ES EMPATE EXACTO (Mismo día y hora, o sin hora)
            // Aquí usamos tu jerarquía como desempate: Estreno > Temp > Cap
            if (timeA > 0) { 
                const getScore = (id, data, t) => {
                    if (isDateRecent(data.date_added)) return 3; // Estreno
                    if (t === 'series' && hasRecentSeasonFromPosters(id)) return 2; // Temp
                    if (t === 'series' && hasRecentEpisodes(id)) return 1; // Cap
                    return 0;
                };
                return getScore(idB, bData, typeB) - getScore(idA, aData, typeA);
            }

            // 3. SI NO SON NUEVOS -> Ranking Normal
            return (Number(bData.tr) || 0) - (Number(aData.tr) || 0);
        }

        // ... resto de ordenamientos (A-Z, Año, etc) ...
        if (sortByValue === 'chronological') return (Number(aData.cronologia) || 9999) - (Number(bData.cronologia) || 9999);
        if (sortByValue === 'year-asc') return (Number(aData.year) || 9999) - (Number(bData.year) || 9999);
        if (sortByValue === 'year-desc') return (Number(bData.year) || 0) - (Number(aData.year) || 0);
        if (sortByValue === 'title-asc') return (aData.title || '').localeCompare(bData.title || '');
        if (sortByValue === 'title-desc') return (bData.title || '').localeCompare(aData.title || '');

        return 0;
    });

    // 5. EXPANSIÓN CRONOLÓGICA (Solo si se eligió ese orden)
    if (sortByValue === 'chronological') {
        const expandedContent = [];
        content.forEach(([id, item]) => {
            const multiChrono = item.cronologiaMulti || item.cronologia_multi; 
            if (multiChrono) {
                const t1 = { ...item, title: `${item.title} (T1)` };
                expandedContent.push([id, t1]); 
                String(multiChrono).split(',').map(c => c.trim()).forEach((chronoVal, index) => {
                    const tNext = { ...item, title: `${item.title} (T${index + 2})`, cronologia: chronoVal };
                    expandedContent.push([id, tNext]); 
                });
            } else { 
                expandedContent.push([id, item]); 
            }
        });
        expandedContent.sort((a, b) => (Number(a[1].cronologia)||99999) - (Number(b[1].cronologia)||99999));
        content = expandedContent;
    }

    // 6. RENDER FINAL
    appState.ui.contentToDisplay = content;
    appState.ui.currentIndex = 0; 
    setupPaginationControls();

    const firstPageItems = content.slice(0, ITEMS_PER_LOAD);
    const imagePromises = firstPageItems.map(([id, item]) => preloadImage(item.poster));

    try { await Promise.race([Promise.all(imagePromises), new Promise(r => setTimeout(r, 1000))]); } catch (e) {}

    renderCurrentPage();
}

// ===========================================================
// 4. MÓDULOS DE FUNCIONALIDADES (HERO, BÚSQUEDA, ETC.)
// ===========================================================
function setupEventListeners() {
    console.log('⚙️ Configurando Event Listeners...');
    document.addEventListener('click', handleGlobalClick);

    // =======================================================
    // 1. NAVEGACIÓN UNIVERSAL (Header, Footer y DROPDOWN)
    // =======================================================
    // ⚠️ CORRECCIÓN: Ahora incluimos ".user-menu-dropdown a[data-filter]" en la lista
    const navLinks = document.querySelectorAll('.main-nav a, .bottom-nav .nav-link, .profile-hub-menu-item');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            const filter = link.dataset.filter;
            
            // 1. Ejecutar cambio de vista
            switchView(filter);
            
            // 2. Si el clic vino del menú desplegable de usuario, lo cerramos
            const dropdown = document.getElementById('user-menu-dropdown');
            if (dropdown && dropdown.classList.contains('show')) {
                dropdown.classList.remove('show');
            }
        });
    });

    // Botón Ruleta en Móvil (Header)
    const mobileRouletteBtn = document.querySelector('.mobile-roulette-btn');
    if (mobileRouletteBtn) {
        mobileRouletteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('roulette');
        });
    }

    // =======================================================
    // 2. BUSCADOR EN TIEMPO REAL
    // =======================================================
    if (DOM.searchInput) {
        DOM.searchInput.addEventListener('input', (e) => {
            const query = e.target.value;
            if (query.length > 0) {
                const currentDisplay = DOM.fullGridContainer.style.display;
                if (currentDisplay === 'none' && appState.currentFilter !== 'all') {
                    // Opcional: switchView('all'); 
                }
                handleSearch(query);
            } else {
                const currentFilter = document.querySelector('.main-nav a.active')?.dataset.filter || 'all';
                switchView(currentFilter);
            }
        });

        DOM.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                DOM.searchInput.value = '';
                DOM.searchInput.blur();
                const currentFilter = document.querySelector('.main-nav a.active')?.dataset.filter || 'all';
                switchView(currentFilter);
            }
        });
    }

    // =======================================================
    // 3. LOGICA DE FILTROS (DROPDOWNS)
    // =======================================================
    document.addEventListener('click', (e) => {
        const trigger = e.target.closest('.dropdown-trigger');
        const dropdown = e.target.closest('.custom-dropdown');
        
        if (trigger) {
            e.stopPropagation(); 
            const menu = dropdown.querySelector('.dropdown-menu');
            document.querySelectorAll('.dropdown-menu.show').forEach(m => {
                if (m !== menu) m.classList.remove('show');
            });
            if (menu) menu.classList.toggle('show');
        } else {
            document.querySelectorAll('.dropdown-menu.show').forEach(m => {
                m.classList.remove('show');
            });
        }
    });

    const backSagaBtn = document.getElementById('back-to-sagas-btn');
    if (backSagaBtn) {
        backSagaBtn.addEventListener('click', () => switchView('sagas'));
    }

    // =======================================================
    // 4. MODALES
    // =======================================================
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            closeAllModals();
            const cinema = document.getElementById('cinema');
            if (cinema) {
                const iframe = cinema.querySelector('iframe');
                if (iframe) iframe.src = '';
                const video = cinema.querySelector('video');
                if (video) video.pause();
            }
        });
    });

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeAllModals();
        }
    });

    // =======================================================
    // 5. AUTENTICACIÓN (Header)
    // =======================================================
    const loginHeader = document.getElementById('login-btn-header');
    const regHeader = document.getElementById('register-btn-header');

    if (loginHeader) {
        loginHeader.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.openAuthModal) window.openAuthModal(true);
        });
    }
    if (regHeader) {
        regHeader.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.openAuthModal) window.openAuthModal(false);
        });
    }

    // =======================================================
    // 6. ACORDEÓN FESTIVAL DE VIÑA
    // =======================================================
    document.addEventListener('click', (e) => {
        const header = e.target.closest('.accordion-header');
        if (header) {
            const item = header.parentElement;
            const isActive = item.classList.contains('active');
            
            // Cerrar otros del mismo grupo
            const parentAccordion = item.closest('.schedule-accordion');
            if (parentAccordion) {
                parentAccordion.querySelectorAll('.accordion-item').forEach(el => {
                    el.classList.remove('active');
                });
            }
            
            if (!isActive) {
                item.classList.add('active');
            }
        }
    });

    // =======================================================
    // 7. EVENTOS DE SCROLL
    // =======================================================
    window.addEventListener('scroll', () => {
        if (DOM.header) {
            if (window.scrollY > 50) {
                DOM.header.classList.add('scrolled');
            } else {
                DOM.header.classList.remove('scrolled');
            }
        }
    });
}

function handleFullscreenChange() {
    const lockOrientation = async () => {
        try {
            if (screen.orientation && typeof screen.orientation.lock === 'function') {
                await screen.orientation.lock('landscape');
            }
        } catch (err) { 
            console.error('No se pudo bloquear la orientación:', err); 
        }
    };
    const unlockOrientation = () => {
        if (screen.orientation && typeof screen.orientation.unlock === 'function') {
            screen.orientation.unlock();
        }
    };
    if (document.fullscreenElement) {
        lockOrientation();
    } else {
        unlockOrientation();
    }
}

function setupPaginationControls() {
    // Buscamos si ya existe el contenedor, si no, lo creamos
    let paginationContainer = document.getElementById('pagination-controls');
    
    if (!paginationContainer) {
        paginationContainer = document.createElement('div');
        paginationContainer.id = 'pagination-controls';
        paginationContainer.className = 'pagination-container';
        // Lo insertamos DESPUÉS del grid container
        DOM.gridContainer.appendChild(paginationContainer);
    }

    // Renderizamos los botones
    paginationContainer.innerHTML = `
        <button id="prev-page-btn" class="pagination-btn"><i class="fas fa-chevron-left"></i> Anterior</button>
        <span id="page-info" class="pagination-info">Página 1 de 1</span>
        <button id="next-page-btn" class="pagination-btn">Siguiente <i class="fas fa-chevron-right"></i></button>
    `;

    // Asignamos eventos
    document.getElementById('prev-page-btn').onclick = () => changePage(-1);
    document.getElementById('next-page-btn').onclick = () => changePage(1);
}

async function changePage(direction) {
    const totalPages = Math.ceil(appState.ui.contentToDisplay.length / ITEMS_PER_LOAD);
    const newPage = appState.ui.currentIndex + direction;

    if (newPage >= 0 && newPage < totalPages) {
        appState.ui.currentIndex = newPage;

        // 1. Scroll suave hacia arriba antes de cargar
        const headerOffset = 80; 
        const elementPosition = DOM.gridContainer.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
        window.scrollTo({ top: offsetPosition, behavior: "smooth" });

        // 2. Mostrar TEXTO DE CARGA CENTRADO
        const gridEl = DOM.gridContainer.querySelector('.grid');
        if (gridEl) {
            gridEl.innerHTML = `
                <div style="
                    width: 100%; 
                    height: 60vh; 
                    display: flex; 
                    justify-content: center; 
                    align-items: center; 
                    grid-column: 1 / -1; 
                ">
                    <div class="loading-text">Cargando...</div>
                </div>`;
        }

        // 3. Identificar qué imágenes vamos a mostrar en la NUEVA página
        const start = appState.ui.currentIndex * ITEMS_PER_LOAD;
        const end = start + ITEMS_PER_LOAD;
        const nextItems = appState.ui.contentToDisplay.slice(start, end);

        // 4. Precargar esas imágenes en memoria (RAM)
        const imagePromises = nextItems.map(([id, item]) => preloadImage(item.poster));
        
        try {
            await Promise.race([
                Promise.all(imagePromises),
                new Promise(r => setTimeout(r, 3000))
            ]);
        } catch (e) { console.warn("Tardó mucho en cargar página"); }

        // 5. Renderizamos la cascada.
        renderCurrentPage();
    }
}

function renderCurrentPage() {
    const gridEl = DOM.gridContainer.querySelector('.grid');
    if (!gridEl) return;

    gridEl.innerHTML = '';

    const start = appState.ui.currentIndex * ITEMS_PER_LOAD;
    const end = start + ITEMS_PER_LOAD;
    const itemsPage = appState.ui.contentToDisplay.slice(start, end);

    // Obtenemos el filtro activo para saber si estamos en UCM, Series o Películas
    const activeFilter = document.querySelector('.main-nav a.active, .mobile-nav a.active')?.dataset.filter;

    itemsPage.forEach(([id, item], index) => {
        // LÓGICA DINÁMICA DE TIPO (Crucial para UCM y Búsqueda Global)
        let type = 'movie'; // Valor por defecto

        if (activeFilter === 'series') {
            type = 'series';
        } else if (activeFilter === 'ucm') {
            // En UCM, verificamos si el item es serie por propiedad explícita o si tiene episodios
            if (item.type === 'series' || appState.content.seriesEpisodes[id]) {
                type = 'series';
            } else {
                type = 'movie';
            }
        } else {
            // Para Búsqueda global o filtros mixtos, verificamos si existe en la colección de series
            if (appState.content.series[id]) {
                type = 'series';
            }
        }

        // Creamos la tarjeta pasando el tipo correcto (movie o series)
        // lazy = false porque ya hicimos la precarga en changePage/applyFilters
        const card = createMovieCardElement(id, item, type, 'grid', false); 
        
        // Animación en cascada
        const delay = index * 40; 
        card.style.animationDelay = `${delay}ms`;

        gridEl.appendChild(card);
    });

    updatePaginationUI();
}

function updatePaginationUI() {
    const totalPages = Math.ceil(appState.ui.contentToDisplay.length / ITEMS_PER_LOAD);
    const currentPage = appState.ui.currentIndex + 1; // Para mostrar (1-based)
    
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    const pageInfo = document.getElementById('page-info');

    if (pageInfo) pageInfo.textContent = `Página ${currentPage} de ${totalPages}`;
    if (prevBtn) prevBtn.disabled = (currentPage === 1);
    if (nextBtn) nextBtn.disabled = (currentPage === totalPages || totalPages === 0);
    
    // Ocultar paginación si no hay resultados o solo hay 1 página
    const container = document.getElementById('pagination-controls');
    if (container) {
        container.style.display = (totalPages <= 1) ? 'none' : 'flex';
    }
}

// ===========================================================
// MANEJO GLOBAL DE CLICS (Delegación de Eventos)
// ===========================================================
function handleGlobalClick(event) {
    // 1. CERRAR MENÚ DE PERFIL AL CLICAR FUERA
    const profileContainer = document.getElementById('user-profile-container');
    const dropdown = document.getElementById('user-menu-dropdown');
    
    if (dropdown && dropdown.classList.contains('show')) {
        if (!profileContainer.contains(event.target)) {
            dropdown.classList.remove('show');
        }
    }

    // 2. CERRAR RESULTADOS DE BÚSQUEDA AL CLICAR FUERA
    const searchContainer = document.getElementById('search-container');
    const searchInput = document.getElementById('search-input');
    if (searchContainer && !searchContainer.contains(event.target)) {
    }

    // 3. BOTÓN "BORRAR DEL HISTORIAL" (Con Confirmación)
    const removeHistoryBtn = event.target.closest('.btn-remove-history');
    
    if (removeHistoryBtn) {
        event.preventDefault();
        event.stopPropagation();
        
        const entryKey = removeHistoryBtn.dataset.key;
        
        if (entryKey) {
            openConfirmationModal(
                'Borrar del Historial',
                '¿Quieres eliminar este título de tu historial de reproducción?',
                () => removeFromHistory(entryKey)
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
            { type: 'banner', url: movieData.banner },
            { type: 'poster', url: movieData.poster }
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

function setupHero() {
    clearInterval(appState.ui.heroInterval);
    if (!DOM.heroSection) return;
    DOM.heroSection.innerHTML = `<div class="hero-content"><h1 id="hero-title"></h1><p id="hero-synopsis"></p><div class="hero-buttons"></div></div><div class="guirnalda-container"></div>`;
    
    const allMoviesArray = Object.entries(appState.content.movies);
    allMoviesArray.sort((a, b) => b[1].tr - a[1].tr);
    const topHeroMovies = allMoviesArray.slice(0, 7);
    appState.ui.heroMovieIds = topHeroMovies.map(entry => entry[0]);

    if (appState.ui.heroMovieIds.length > 0) {
        shuffleArray(appState.ui.heroMovieIds);
        preloadHeroImages(appState.ui.heroMovieIds);
        changeHeroMovie(appState.ui.heroMovieIds[0]);
        startHeroInterval(); 
    } else {
       DOM.heroSection.style.display = 'none'; 
    }
}

function startHeroInterval() {
    clearInterval(appState.ui.heroInterval);
    let currentHeroIndex = 0;
    if (appState.ui.heroMovieIds.length === 0) return;
    appState.ui.heroInterval = setInterval(() => {
        currentHeroIndex = (currentHeroIndex + 1) % appState.ui.heroMovieIds.length;
        changeHeroMovie(appState.ui.heroMovieIds[currentHeroIndex]);
    }, 8000);
}

function changeHeroMovie(movieId) {
    if (appState.hero.isTransitioning) return;
    
    const heroContent = DOM.heroSection.querySelector('.hero-content');
    const movieData = appState.content.movies[movieId];
    if (!heroContent || !movieData) return;

    appState.hero.isTransitioning = true;
    heroContent.classList.add('hero-fading');

    setTimeout(() => {
        const isMobile = window.innerWidth < 992;
        const imageType = isMobile ? 'poster' : 'banner';
        const cacheKey = `${movieId}_${imageType}`;
        
        const imageUrl = appState.hero.preloadedImages.get(cacheKey) || 
                        (isMobile ? movieData.poster : movieData.banner);
        
        DOM.heroSection.style.backgroundImage = `url(${imageUrl})`;
        
        heroContent.querySelector('#hero-title').textContent = movieData.title;
        heroContent.querySelector('#hero-synopsis').textContent = movieData.synopsis;

        // --- ZONA DE BOTONES CORREGIDA ---
        const heroButtons = heroContent.querySelector('.hero-buttons');
        heroButtons.innerHTML = ''; // Limpiamos todo el contenedor primero

        // 1. Botón Play (Elemento Real)
        const playButton = document.createElement('button');
        playButton.className = 'btn btn-play';
        playButton.innerHTML = '<i class="fas fa-play"></i> Ver Ahora';
        playButton.onclick = async () => { 
            const player = await getPlayerModule();
            player.openPlayerModal(movieId, movieData.title.replace(/'/g, "\\'"));
        };

        // 2. Botón Información (Elemento Real)
        const infoButton = document.createElement('button');
        infoButton.className = 'btn btn-info';
        infoButton.textContent = 'Más Información';
        infoButton.onclick = () => openDetailsModal(movieId, 'movie');

        // Agregamos los botones principales al contenedor
        heroButtons.appendChild(playButton);
        heroButtons.appendChild(infoButton);

        // 3. Botón Mi Lista (SOLO SI ESTÁ LOGUEADO)
        // 🔥 AHORA SE CREA COMO ELEMENTO CON EVENTO, NO COMO TEXTO
        const user = auth.currentUser;
        if (user) { 
            const listBtn = document.createElement('button');
            const isInList = appState.user.watchlist.has(movieId);
            const iconClass = isInList ? 'fa-check' : 'fa-plus';
            
            // Asignamos clases y datos
            listBtn.className = isInList ? 'btn-watchlist in-list' : 'btn-watchlist';
            listBtn.setAttribute('data-content-id', movieId);
            listBtn.title = "Añadir a Mi Lista";
            listBtn.innerHTML = `<i class="fas ${iconClass}"></i>`;
            
            // ✅ ESTA ES LA CLAVE: Asignar el clic manualmente
            listBtn.onclick = (e) => {
                e.stopPropagation(); // Evita conflictos con el fondo
                handleWatchlistClick(listBtn); // Llama a la función que ya gestiona Agrega/Borrar
            };

            heroButtons.appendChild(listBtn);
        }
        // ---------------------------------

        heroContent.classList.remove('hero-fading');
        appState.hero.isTransitioning = false;
    }, 300);
}

function generateCarousels() {
    const container = DOM.carouselContainer;
    container.innerHTML = '';

    createCarouselSection('Películas Nuevas', appState.content.movies);
    createCarouselSection('Series Nuevas', appState.content.series);
}

function createCarouselSection(title, dataSource) {
    if (!dataSource || Object.keys(dataSource).length === 0) return;

    const section = document.createElement('section');
    section.classList.add('carousel');

    // --- ESTAS ERAN LAS LÍNEAS QUE FALTABAN ---
    const titleEl = document.createElement('h2');
    titleEl.classList.add('carousel-title');
    titleEl.textContent = title;
    section.appendChild(titleEl);
    // ------------------------------------------

    const track = document.createElement('div');
    track.classList.add('carousel-track');

    let entries = Object.entries(dataSource);

    // ORDENAMIENTO (CON ESTRENOS DE PELIS Y SERIES)
    entries.sort((a, b) => {
        const idA = a[0]; const idB = b[0];
        const aData = a[1]; const bData = b[1];
        
        // Detectar tipo para usar la función correctamente
        const typeA = title.toLowerCase().includes('serie') ? 'series' : 'movie';
        const typeB = typeA;

        const timeA = getLatestUpdateTimestamp(idA, aData, typeA);
        const timeB = getLatestUpdateTimestamp(idB, bData, typeB);

        // 1. Por Fecha exacta
        if (timeA !== timeB) return timeB - timeA;

        // 2. Por Tipo (Si empatan fecha)
        if (timeA > 0) {
             const getScore = (id, data) => {
                if (isDateRecent(data.date_added)) return 3;
                if (hasRecentSeasonFromPosters(id)) return 2;
                if (hasRecentEpisodes(id)) return 1;
                return 0;
            };
            return getScore(idB, bData) - getScore(idA, aData);
        }

        // 3. Por Ranking
        return (Number(bData.tr) || 0) - (Number(aData.tr) || 0);
    });

    entries.slice(0, 8).forEach(([id, item]) => {
        const type = title.includes('Serie') ? 'series' : 'movie';
        const card = createMovieCardElement(id, item, type, 'carousel', false);
        track.appendChild(card);
    });

    section.appendChild(track);
    DOM.carouselContainer.appendChild(section);
}

function setupSearch() {
    if (!DOM.searchInput) return;
    let isSearchActive = false;
    DOM.searchInput.addEventListener('input', () => {
        const searchTerm = DOM.searchInput.value.toLowerCase().trim();
        if (searchTerm === '') {
            const gridEl = DOM.gridContainer.querySelector('.grid');
            if (gridEl) {
                gridEl.style.display = '';
                gridEl.style.justifyContent = '';
                gridEl.style.alignItems = '';
            }

            if (isSearchActive) {
                const activeNav = document.querySelector('.main-nav a.active, .mobile-nav a.active');
                switchView(activeNav ? activeNav.dataset.filter : 'all');
                isSearchActive = false;
            }
            return;
        }
        isSearchActive = true;
        const allContent = { ...appState.content.movies, ...appState.content.series, ...appState.content.ucm };
        const results = Object.entries(allContent).filter(([id, item]) => item.title.toLowerCase().includes(searchTerm));
        displaySearchResults(results);
    });
}

function displaySearchResults(results) {
    switchView('search');
    const gridEl = DOM.gridContainer.querySelector('.grid');
    
    if (DOM.gridContainer) DOM.gridContainer.style.display = 'block';
    
    if (!gridEl) return;
    gridEl.innerHTML = '';
    
    if (results.length > 0) {
        gridEl.style.display = 'grid';
        results.forEach(([id, item]) => {
            const type = appState.content.series[id] ? 'series' : 'movie';
            gridEl.appendChild(createMovieCardElement(id, item, type, 'grid', false));
        });
    } else {
        gridEl.style.display = 'flex';
        gridEl.style.justifyContent = 'center';
        gridEl.style.alignItems = 'center';
        gridEl.innerHTML = `<p style="color: var(--text-muted); text-align: center;">No se encontraron resultados.</p>`;
    }
}

function generateContinueWatchingCarousel(snapshot) {
    const user = auth.currentUser;
    // Eliminamos si ya existe para no duplicar
    const existingCarousel = document.getElementById('continue-watching-carousel');
    if (existingCarousel) existingCarousel.remove();

    if (!user || !DOM.carouselContainer || !snapshot.exists()) {
        return;
    }

    let historyItems = [];
    snapshot.forEach(child => {
        historyItems.push(child.val());
    });
    historyItems.reverse();

    const itemsToDisplay = [];
    const displayedSeries = new Set();

    for (const item of historyItems) {
        if (item.type === 'series' && !displayedSeries.has(item.contentId)) {
            const seasonEpisodes = appState.content.seriesEpisodes[item.contentId]?.[item.season];
            if (!seasonEpisodes) continue;

            const lastWatchedIndex = item.lastEpisode;

            if (lastWatchedIndex !== null && seasonEpisodes[lastWatchedIndex]) {
                const lastEpisode = seasonEpisodes[lastWatchedIndex];
                const seriesData = appState.content.series[item.contentId];

                itemsToDisplay.push({
                    cardType: 'series',
                    contentId: item.contentId,
                    season: item.season,
                    episodeIndexToOpen: lastWatchedIndex,
                    thumbnail: lastEpisode.thumbnail || seriesData.poster,
                    title: seriesData.title,
                    subtitle: `Visto: T${String(item.season).replace('T', '')} E${lastEpisode.episodeNumber || lastWatchedIndex + 1}`
                });

                displayedSeries.add(item.contentId);
            }
        }
    }

    if (itemsToDisplay.length > 0) {
        const carouselEl = document.createElement('div');
        carouselEl.id = 'continue-watching-carousel';
        // Heredará automáticamente el estilo de fondo crema (.carousel)
        carouselEl.className = 'carousel'; 
        carouselEl.innerHTML = `<h3 class="carousel-title">Continuar Viendo</h3><div class="carousel-track"></div>`;
        const track = carouselEl.querySelector('.carousel-track');
        itemsToDisplay.forEach(itemData => {
            track.appendChild(createContinueWatchingCard(itemData));
        });
        
        // Insertamos el carrusel al principio
        DOM.carouselContainer.prepend(carouselEl);
    }
}

function createContinueWatchingCard(itemData) {
    const card = document.createElement('div');
    card.className = 'continue-watching-card';
    card.onclick = async () => { // 🆕 Carga bajo demanda
        const player = await getPlayerModule();
        player.openPlayerToEpisode(itemData.contentId, itemData.season, itemData.episodeIndexToOpen);
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

// ===========================================================
// 5. MODALES (GENERAL, DETALLES)
// ===========================================================
function closeAllModals() {
    // 1. Cerrar todos los modales visualmente
    document.querySelectorAll('.modal.show').forEach(modal => {
        modal.classList.remove('show');
        const iframe = modal.querySelector('iframe');
        if (iframe) iframe.src = '';
    });
    document.body.classList.remove('modal-open');

    if (typeof shared !== 'undefined' && shared.appState && shared.appState.player) {
         shared.appState.player.activeSeriesId = null;
    }

    // 🔥 FIX MÓVIL: Leemos la bandera desde localStorage (Disco)
    // Así funciona aunque el navegador haya limpiado la RAM durante la película
    if (localStorage.getItem('pending_reload') === 'true') {
        console.log('🔄 Ejecutando actualización pendiente desde disco...');
        
        // Borramos la marca para no entrar en bucle
        localStorage.removeItem('pending_reload');

        // Borramos caché vieja para asegurar datos frescos
        if (window.cacheManager) window.cacheManager.clearAll();
        else localStorage.clear();
        
        // Pequeño delay visual y RECARGA FORZADA
        setTimeout(() => {
            const url = new URL(window.location.href);
            url.searchParams.set('force_update', Date.now());
            window.location.href = url.toString();
        }, 300);
    }
}

async function openDetailsModal(id, type, triggerElement = null) {
    try {
        const modal = DOM.detailsModal;
        const panel = modal.querySelector('.details-panel'); 
        const detailsButtons = document.getElementById('details-buttons');

        // =========================================================
        // 1. BÚSQUEDA INTELIGENTE UNIVERSAL
        // =========================================================
        let data = null;

        // Buscar en películas
        if (appState.content.movies[id]) { 
            data = appState.content.movies[id]; type = 'movie'; 
        }
        // Buscar en series
        else if (appState.content.series[id]) { 
            data = appState.content.series[id]; type = 'series'; 
        }
        // Buscar en UCM (Legacy)
        else if (appState.content.ucm && appState.content.ucm[id]) { 
            data = appState.content.ucm[id]; 
            type = (data.type === 'series' || appState.content.seriesEpisodes[id]) ? 'series' : 'movie';
        }

        // Buscar en Sagas Dinámicas (Star Wars, HP, etc.)
        if (!data && appState.content.sagas) {
            for (const sagaKey in appState.content.sagas) {
                const sagaData = appState.content.sagas[sagaKey];
                if (sagaData && sagaData[id]) {
                    data = sagaData[id];
                    type = (data.type === 'series' || appState.content.seriesEpisodes[id]) ? 'series' : 'movie';
                    break; 
                }
            }
        }

        if (!data) {
            ErrorHandler.show('content', 'No se pudo cargar la información del título.');
            return;
        }

        // =========================================================
        // 2. RENDERIZADO DE TEXTOS E IMÁGENES
        // =========================================================
        const isSeries = (type === 'series');
        
        document.getElementById('details-title').textContent = data.title || '';
        document.getElementById('details-year').textContent = data.year ? `(${data.year})` : '';
        document.getElementById('details-genres').textContent = data.genres || '';
        document.getElementById('details-synopsis').textContent = data.synopsis || 'Sin descripción.';
        document.getElementById('details-poster-img').src = data.poster || '';

        // --- Mostrar Idioma ---
        const langEl = document.getElementById('details-language');
        if (langEl) {
            if (data.language) {
                langEl.textContent = data.language;
                langEl.style.display = 'inline-block';
            } else {
                langEl.style.display = 'none';
            }
        }

        // --- Fondo (Banner) ---
        if (data.banner && data.banner.length > 5) {
            panel.style.backgroundImage = `url(${data.banner})`;
        } else {
            panel.style.backgroundImage = 'none';
            panel.style.backgroundColor = '#1a1a1a';
        }

        // =========================================================
        // 3. INYECTAR ESTRELLAS (RATING PROMEDIO)
        // =========================================================
        const modalRating = appState.content.averages[id];
        const detailsMeta = modal.querySelector('.details-meta');
        
        // Limpiamos nota previa para no duplicar
        const oldRating = detailsMeta.querySelector('.modal-rating-badge');
        if (oldRating) oldRating.remove();

        if (modalRating) {
            const ratingBadge = document.createElement('span');
            ratingBadge.className = 'modal-rating-badge';
            ratingBadge.innerHTML = getStarsHTML(modalRating, false);
            detailsMeta.prepend(ratingBadge); 
        }

        // =========================================================
        // 4. CONFIGURACIÓN DE BOTONES DE ACCIÓN
        // =========================================================
        detailsButtons.innerHTML = '';

        // --- A. Botón VER AHORA (Play) ---
        const playBtn = document.createElement('button');
        playBtn.className = 'btn btn-play';
        playBtn.innerHTML = `<i class="fas fa-play"></i> Ver ahora`;
        playBtn.onclick = async () => {
            closeAllModals();
            const player = await getPlayerModule();
            if (isSeries) player.openSeriesPlayer(id);
            else player.openPlayerModal(id, data.title);
        };
        detailsButtons.appendChild(playBtn);

        // --- B. NUEVO: Botón RESEÑAR DIRECTO ---
        const reviewBtn = document.createElement('button');
        reviewBtn.className = 'btn btn-review';
        reviewBtn.innerHTML = `<i class="fas fa-star"></i> Reseñar`;
        
        reviewBtn.onclick = () => {
            // 1. Verificar si está logueado
            if (!auth.currentUser) {
                openConfirmationModal(
                    "Inicia Sesión",
                    "Necesitas acceder a tu cuenta para dejar una reseña.",
                    () => openAuthModal(true)
                );
                return;
            }

            // 2. Cerrar el modal actual (Detalles)
            closeAllModals();

            // 3. PRE-LLENAR EL BUSCADOR INTELIGENTE
            const searchInput = document.getElementById('review-movie-search');
            const hiddenInput = document.getElementById('review-selected-id');
            const optionsList = document.getElementById('review-movie-options');

            if (searchInput && hiddenInput) {
                searchInput.value = data.title; // Ponemos el nombre visible
                hiddenInput.value = id;         // Ponemos el ID oculto
                
                // Aseguramos que la lista de sugerencias esté cerrada para que se vea limpio
                if(optionsList) {
                    optionsList.classList.remove('show');
                    optionsList.style.display = 'none';
                }
            }

            // 4. Abrir el modal de Reseña
            if (DOM.reviewModal) {
                DOM.reviewModal.classList.add('show');
                document.body.classList.add('modal-open');
            }
        };
        detailsButtons.appendChild(reviewBtn);

        // --- C. Botones Específicos de Series ---
        if (isSeries) {
            const episodes = appState.content.seriesEpisodes[id] || {};
            const seasonCount = Object.keys(episodes).length;

            // Botón Temporadas (solo si hay más de 1)
            if (seasonCount > 1) {
                const infoBtn = document.createElement('button');
                infoBtn.className = 'btn btn-info';
                infoBtn.innerHTML = `<i class="fas fa-list"></i> Temporadas`;
                infoBtn.onclick = async () => {
                    closeAllModals();
                    const player = await getPlayerModule();
                    player.openSeriesPlayer(id, true); 
                };
                detailsButtons.appendChild(infoBtn);
            }

            // Botón Aleatorio
            const randomVal = String(data.random || '').trim().toLowerCase();
            const isRandomEnabled = ['si', 'sí', 'yes', 'true', '1'].includes(randomVal);

            if (isRandomEnabled) {
                 const randomBtn = document.createElement('button');
                 randomBtn.className = 'btn btn-random'; 
                 randomBtn.innerHTML = `<i class="fas fa-random"></i> Aleatorio`;
                 randomBtn.onclick = async () => {
                    closeAllModals();
                    const player = await getPlayerModule();
                    player.playRandomEpisode(id);
                 };
                 detailsButtons.appendChild(randomBtn);
            }
        }

        // --- D. Botón Mi Lista (Watchlist) ---
        if (auth.currentUser) {
            const listBtn = document.createElement('button');
            const inList = appState.user.watchlist.has(id);
            listBtn.className = `btn btn-watchlist ${inList ? 'in-list' : ''}`;
            listBtn.innerHTML = `<i class="fas ${inList ? 'fa-check' : 'fa-plus'}"></i>`;
            listBtn.onclick = () => handleWatchlistClick(listBtn);
            listBtn.setAttribute('data-content-id', id); 
            detailsButtons.appendChild(listBtn);
        }

        // =========================================================
        // 5. MOSTRAR MODAL
        // =========================================================
        modal.classList.add('show');
        document.body.classList.add('modal-open');

        const closeBtn = modal.querySelector('.close-btn');
        if(closeBtn) closeBtn.onclick = closeAllModals;

    } catch (e) {
        console.error("Error en openDetailsModal:", e);
        if(typeof logError === 'function') logError(e, 'Open Details');
    }
}

// ===========================================================
// 6. AUTENTICACIÓN Y DATOS DE USUARIO
// ===========================================================
function setupAuthListeners() {
    // === 1. Lógica del OJO (Ver/Ocultar Password) ===
    const setupPasswordToggle = (inputId, iconId) => {
        const input = document.getElementById(inputId);
        const icon = document.getElementById(iconId);
        if (input && icon) {
            // Clonamos para eliminar listeners viejos si se recarga
            const newIcon = icon.cloneNode(true);
            icon.parentNode.replaceChild(newIcon, icon);
            
            newIcon.addEventListener('click', () => {
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                newIcon.classList.toggle('fa-eye');
                newIcon.classList.toggle('fa-eye-slash');
            });
        }
    };
    setupPasswordToggle('login-password', 'toggle-login-pass');
    setupPasswordToggle('register-password', 'toggle-register-pass');

    // === 2. Navegación del Modal (Login <-> Registro <-> Recuperar) ===
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const recoveryForm = document.getElementById('recovery-form');
    const authSwitch = document.querySelector('.auth-switch');

    // Ir a "Recuperar Contraseña"
    const forgotLink = document.getElementById('forgot-password-link');
    if (forgotLink) {
        forgotLink.onclick = (e) => {
            e.preventDefault();
            loginForm.style.display = 'none';
            registerForm.style.display = 'none';
            recoveryForm.style.display = 'flex'; // Usamos flex para centrar contenido si es necesario
            recoveryForm.style.flexDirection = 'column';
            if (authSwitch) authSwitch.style.display = 'none';
        };
    }

    // Volver a Login desde Recuperar
    const backToLogin = document.getElementById('back-to-login-link');
    if (backToLogin) {
        backToLogin.onclick = (e) => {
            e.preventDefault();
            recoveryForm.style.display = 'none';
            loginForm.style.display = 'flex';
            if (authSwitch) authSwitch.style.display = 'block';
        };
    }

    // Botón Header: Ingresar
    if (DOM.loginBtnHeader) DOM.loginBtnHeader.onclick = (e) => { e.preventDefault(); openAuthModal(true); };
    // Botón Header: Registro
    if (DOM.registerBtnHeader) DOM.registerBtnHeader.onclick = (e) => { e.preventDefault(); openAuthModal(false); };
    
    // Switcher inferior
    if (DOM.switchAuthModeLink) {
        DOM.switchAuthModeLink.onclick = (e) => {
            e.preventDefault();
            const isLogin = loginForm.style.display !== 'none';
            openAuthModal(!isLogin);
        };
    }

    // === 3. Envíos de Formulario (Submits) ===
    
    // LOGIN
    if (DOM.loginForm) {
    DOM.loginForm.onsubmit = (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const pass = document.getElementById('login-password').value;
        
        // Elemento de error
        const errorEl = document.getElementById('login-error'); 
        
        auth.signInWithEmailAndPassword(email, pass)
            .then(() => { 
                closeAllModals(); 
                DOM.loginForm.reset(); 
            })
            .catch(() => { 
                // 🔥 AQUÍ ESTÁ EL CAMBIO:
                errorEl.textContent = "Credenciales incorrectas."; 
                errorEl.style.display = 'block'; // MOSTRAR el espacio ahora
            });
        };
    }

    // REGISTRO
    if (DOM.registerForm) {
        DOM.registerForm.addEventListener('submit', (e) => {
            e.preventDefault(); // Evita que se recargue la página
            const username = document.getElementById('register-username').value;
            const email = document.getElementById('register-email').value;
            const password = document.getElementById('register-password').value;
            
            // Elemento de error
            const errorEl = document.getElementById('register-error');

            // Limpiamos errores previos al intentar de nuevo
            if (errorEl) {
                errorEl.style.display = 'none';
                errorEl.textContent = '';
            }

            auth.createUserWithEmailAndPassword(email, password)
                .then((userCredential) => userCredential.user.updateProfile({ displayName: username }))
                .then(() => { 
                    closeAllModals(); 
                    DOM.registerForm.reset(); 
                    ErrorHandler.show('auth', '¡Cuenta creada con éxito!', 3000);
                })
                .catch((err) => { 
                    // 🔥 AQUÍ ESTÁ EL TRUCO: Solo mostramos el espacio si hay error
                    if (errorEl) {
                        errorEl.textContent = err.message;
                        errorEl.style.display = 'block'; 
                    }
                });
        });
    }
    // RECUPERAR (Firebase Reset)
    if (recoveryForm) {
        recoveryForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('recovery-email-input').value;
            const msgElement = document.getElementById('recovery-message');
            
            // Limpiamos estado previo (ocultamos el espacio)
            if(msgElement) {
                msgElement.style.display = 'none';
                msgElement.textContent = '';
            }
            
            auth.sendPasswordResetEmail(email)
                .then(() => {
                    if (msgElement) {
                        msgElement.style.color = '#4cd137'; // Verde éxito
                        msgElement.textContent = `Enlace enviado a ${email}`;
                        msgElement.style.display = 'block'; // 🔥 AHORA SÍ OCUPA ESPACIO
                    }
                })
                .catch((error) => {
                    if (msgElement) {
                        msgElement.style.color = '#ff4d4d'; // Rojo error
                        if (error.code === 'auth/user-not-found') {
                            msgElement.textContent = "Correo no registrado.";
                        } else {
                            msgElement.textContent = "Error al enviar. Intenta nuevamente.";
                        }
                        msgElement.style.display = 'block'; // 🔥 AHORA SÍ OCUPA ESPACIO
                    }
                });
        });
    }

    // Listeners globales
    auth.onAuthStateChanged(updateUIAfterAuthStateChange);
    
    // Logout Logic
    const handleLogout = (e) => { e.preventDefault(); auth.signOut().then(() => location.reload()); };
    const btnLogout = document.getElementById('logout-btn');
    if (btnLogout) { btnLogout.parentNode.replaceChild(btnLogout.cloneNode(true), btnLogout).addEventListener('click', handleLogout); }
}

function openAuthModal(isLogin) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const recoveryForm = document.getElementById('recovery-form');
    const authSwitch = document.querySelector('.auth-switch');
    const switchLink = document.getElementById('switch-auth-mode');
    const modal = document.getElementById('auth-modal');

    // Siempre ocultar recuperación al abrir de cero
    if (recoveryForm) recoveryForm.style.display = 'none';
    if (authSwitch) authSwitch.style.display = 'block';

    // Mostrar form correcto
    if (loginForm) loginForm.style.display = isLogin ? 'flex' : 'none';
    if (registerForm) registerForm.style.display = isLogin ? 'none' : 'flex';

    // Texto del switcher
    if (switchLink) {
        switchLink.textContent = isLogin ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia Sesión';
    }

    // Limpiar errores y campos de password
    ['login-error', 'register-error', 'recovery-message'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.textContent = '';
        el.style.display = 'none';
    });
    
    // Resetear visibilidad de passwords a oculto
    ['login-error', 'register-error', 'recovery-message'].forEach(id => {
    const el = document.getElementById(id);
        if(el) {
            el.textContent = '';
            el.style.display = 'none'; // <--- Ocultar de nuevo
        }
    });
    
    // Resetear iconos de ojos
    document.querySelectorAll('.toggle-password').forEach(icon => {
        icon.classList.add('fa-eye');
        icon.classList.remove('fa-eye-slash');
    });

    if (modal) modal.classList.add('show');
    document.body.classList.add('modal-open');
}

function updateUIAfterAuthStateChange(user) {
    const loggedInElements = [DOM.userProfileContainer, DOM.myListNavLink, DOM.historyNavLink, DOM.myListNavLinkMobile, DOM.historyNavLinkMobile];
    const loggedOutElements = [DOM.authButtons];

    // Referencias a los nuevos bloques del perfil móvil
    const hubLoggedIn = document.getElementById('hub-logged-in-content');
    const hubGuest = document.getElementById('hub-guest-content');
    const hubEmail = document.getElementById('profile-hub-email');

    // 🔥 FIX VISUAL: Selector correcto para limpiar la barra inferior móvil (.bottom-nav .nav-link)
    const resetNavigationActiveState = () => {
        document.querySelectorAll('.main-nav a, .bottom-nav .nav-link').forEach(l => l.classList.remove('active'));
        document.querySelectorAll('a[data-filter="all"]').forEach(l => l.classList.add('active'));
    };

    if (user) {
        // --- USUARIO CONECTADO ---
        loggedInElements.forEach(el => el && (el.style.display = 'flex'));
        loggedOutElements.forEach(el => el && (el.style.display = 'none'));
        
        const userName = user.displayName || user.email.split('@')[0];
        if (DOM.userGreetingBtn) DOM.userGreetingBtn.textContent = `Hola, ${userName}`;
        
        // Mostrar menú de usuario en móvil
        if (hubLoggedIn) hubLoggedIn.style.display = 'block';
        if (hubGuest) hubGuest.style.display = 'none';
        if (hubEmail) hubEmail.textContent = user.email;

        db.ref(`users/${user.uid}/watchlist`).once('value', snapshot => {
            appState.user.watchlist = snapshot.exists() ? new Set(Object.keys(snapshot.val())) : new Set();
        });

        setupRealtimeHistoryListener(user);
        getProfileModule();

        // Redirección forzada al inicio y corrección visual del botón
        resetNavigationActiveState(); // <--- Aquí aplicamos el fix
        switchView('all'); 

    } else {
        // --- USUARIO DESCONECTADO (INVITADO) ---
        loggedInElements.forEach(el => el && (el.style.display = 'none'));
        loggedOutElements.forEach(el => el && (el.style.display = 'flex'));
        
        // Mostrar menú de invitado en móvil
        if (hubLoggedIn) hubLoggedIn.style.display = 'none';
        if (hubGuest) hubGuest.style.display = 'block';
        if (hubEmail) hubEmail.textContent = 'Visitante';
        
        appState.user.watchlist.clear();
        
        if (appState.user.historyListenerRef) {
            appState.user.historyListenerRef.off('value');
            appState.user.historyListenerRef = null;
        }
        
        const continueWatchingCarousel = document.getElementById('continue-watching-carousel');
        if (continueWatchingCarousel) continueWatchingCarousel.remove();

        // Redirección forzada al inicio y corrección visual del botón
        resetNavigationActiveState(); // <--- Aquí aplicamos el fix
        switchView('all');
    }
}

function addToHistoryIfLoggedIn(contentId, type, episodeInfo = {}) {
    const user = auth.currentUser;
    if (!user) return;

    const isSeries = type.includes('series');
    const itemData = isSeries ? appState.content.series[contentId] : appState.content.movies[contentId];
    if (!itemData) return;

    // 1. Empezamos con el póster general de la serie/película
    let posterUrl = itemData.poster;

    // 2. Si es una serie y estamos viendo una temporada específica, intentamos buscar su póster
    if (isSeries && episodeInfo.season) {
        // Buscamos la entrada en seasonPosters
        const seasonPosterEntry = appState.content.seasonPosters[contentId]?.[episodeInfo.season];

        if (seasonPosterEntry) {
            // === CORRECCIÓN AQUÍ ===
            if (typeof seasonPosterEntry === 'object') {
                // Si es un objeto (ej: { posterUrl: "...", date: "..." }), extraemos solo la URL
                posterUrl = seasonPosterEntry.posterUrl || seasonPosterEntry.poster || posterUrl;
            } else {
                // Si ya es un texto (formato antiguo), lo usamos directamente
                posterUrl = seasonPosterEntry;
            }
        }
    }
    
    // Generamos la clave única para el historial
    const historyKey = isSeries ? `${contentId}_${episodeInfo.season}` : contentId;
    const historyTitle = isSeries ? `${itemData.title}: T${String(episodeInfo.season).replace('T', '')}` : itemData.title;
    
    // Objeto final a guardar en Firebase
    const historyEntry = {
        type,
        contentId,
        title: historyTitle,
        poster: posterUrl, // Ahora aseguramos que esto sea un String URL limpio
        viewedAt: firebase.database.ServerValue.TIMESTAMP,
        season: isSeries ? episodeInfo.season : null,
        lastEpisode: isSeries ? episodeInfo.index : null
    };

    const userHistoryRef = db.ref(`users/${user.uid}/history/${historyKey}`);
    userHistoryRef.set(historyEntry);
}

// ===========================================================
// FUNCIÓN PARA BORRAR DEL HISTORIAL (ANIMACIÓN SUAVE)
// ===========================================================
async function removeFromHistory(entryKey) {
    const user = auth.currentUser;
    if (!user) return;

    // 1. Borrar de la base de datos
    await db.ref(`users/${user.uid}/history/${entryKey}`).remove();

    // 2. Efecto Visual "Soft" (Desvanecer tarjeta)
    const historyGrid = DOM.historyContainer.querySelector('.grid');
    
    // Buscamos el botón específico que se pulsó
    const btnPressed = historyGrid.querySelector(`.btn-remove-history[data-key="${entryKey}"]`);
    
    if (btnPressed) {
        const cardToRemove = btnPressed.closest('.movie-card');
        
        if (cardToRemove) {
            // A) Bloquear clicks
            cardToRemove.style.pointerEvents = 'none';
            
            // B) Animación de salida
            cardToRemove.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
            cardToRemove.style.opacity = '0';
            cardToRemove.style.transform = 'scale(0.8) translateY(20px)';
            
            // C) Borrar del HTML cuando termine la animación
            setTimeout(() => {
                if (cardToRemove.parentNode) cardToRemove.remove();
                
                // Si la lista queda vacía, mostrar mensaje
                if (historyGrid.children.length === 0) {
                    historyGrid.innerHTML = `<p class="empty-message" style="opacity:0; transition: opacity 0.5s;">Tu historial está vacío.</p>`;
                    requestAnimationFrame(() => {
                        const msg = historyGrid.querySelector('.empty-message');
                        if(msg) msg.style.opacity = '1';
                    });
                }
            }, 400); 
        }
    } else {
        // Plan B: Si algo falla, recarga normal
        renderHistory();
    }
}

function handleWatchlistClick(button) {
    const user = auth.currentUser;
    if (!user) {
        openConfirmationModal(
            "Acción Requerida",
            "Debes iniciar sesión para usar esta función.",
            () => openAuthModal(true)
        );
        return;
    }
    
    const contentId = button.dataset.contentId;
    const isInList = appState.user.watchlist.has(contentId);

    if (isInList) {
        openConfirmationModal(
            'Eliminar de Mi Lista',
            '¿Estás seguro de que quieres eliminar este item de tu lista?',
            () => removeFromWatchlist(contentId)
        );
    } else {
        addToWatchlist(contentId);
    }
}

async function addToWatchlist(contentId) {
    const user = auth.currentUser;
    if (!user) return;

    await ErrorHandler.firebaseOperation(async () => {
        await db.ref(`users/${user.uid}/watchlist/${contentId}`).set(true);
        appState.user.watchlist.add(contentId);
        
        document.querySelectorAll(`.btn-watchlist[data-content-id="${contentId}"]`).forEach(button => {
            button.classList.add('in-list');
            button.innerHTML = '<i class="fas fa-check"></i>';
        });
    });
}

async function removeFromWatchlist(contentId) {
    const user = auth.currentUser;
    if (!user) return;
    
    // Convertimos a string por seguridad
    const safeId = String(contentId);

    await ErrorHandler.firebaseOperation(async () => {
        // 1. Borrar de Firebase y actualizar estado local
        await db.ref(`users/${user.uid}/watchlist/${safeId}`).remove();
        appState.user.watchlist.delete(safeId);
        
        // 2. Actualizar visualmente los botones en otras vistas (Inicio, Películas, etc)
        // Buscamos cualquier botón que tenga este ID
        document.querySelectorAll(`.btn-watchlist[data-content-id="${safeId}"]`).forEach(button => {
            button.classList.remove('in-list');
            button.innerHTML = '<i class="fas fa-plus"></i>';
        });
        
        // 3. BORRADO VISUAL EN "MI LISTA" (Lógica Reforzada)
        const myListContainer = document.getElementById('my-list-container');
        
        // Solo actuamos si la sección "Mi Lista" está visible
        if (myListContainer && myListContainer.style.display !== 'none') {
            
            // Buscamos la tarjeta Específica dentro del grid de mi lista
            const cardToRemove = myListContainer.querySelector(`.movie-card[data-content-id="${safeId}"]`);
            
            if (cardToRemove) {
                // A) Bloquear clicks inmediatamente
                cardToRemove.style.pointerEvents = 'none';
                
                // B) Aplicar estilos de salida directamente (sin depender de clases externas)
                cardToRemove.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
                cardToRemove.style.opacity = '0';
                cardToRemove.style.transform = 'scale(0.8) translateY(20px)';
                
                // C) Borrar del DOM al terminar la animación
                setTimeout(() => {
                    if (cardToRemove.parentNode) {
                        cardToRemove.parentNode.removeChild(cardToRemove);
                    }
                    
                    // Chequeo de lista vacía
                    if (appState.user.watchlist.size === 0) {
                        const grid = myListContainer.querySelector('.grid');
                        if (grid) {
                            grid.innerHTML = `<p class="empty-message" style="opacity:0; transition: opacity 0.5s;">Tu lista está vacía.</p>`;
                            requestAnimationFrame(() => {
                                const msg = grid.querySelector('.empty-message');
                                if(msg) msg.style.opacity = '1';
                            });
                        }
                    }
                }, 400); 
            } else {
                // Si por alguna razón no encontró la tarjeta (bug raro), recargamos la lista completa
                console.warn("Tarjeta no encontrada en el DOM, forzando repintado...");
                displayMyListView();
            }
        }
    });
}

// ===========================================================
// 📝 MI LISTA INTELIGENTE (CARGA POR LOTES)
// ===========================================================

// Variables GLOBALES para la paginación de "Mi Lista"
let myListDataCache = [];
let myListRenderedCount = 0;

function displayMyListView() {
    const user = auth.currentUser;
    const myListGrid = DOM.myListContainer.querySelector('.grid');
    
    // Limpieza inicial de botón antiguo si existe
    const existingBtn = document.getElementById('mylist-load-more-btn');
    if (existingBtn) existingBtn.remove();
    
    if (!user) {
        myListGrid.innerHTML = `<p class="empty-message">Debes iniciar sesión para ver tu lista.</p>`;
        return;
    }
    
    if (appState.user.watchlist.size === 0) {
        myListGrid.innerHTML = `<p class="empty-message">Tu lista está vacía. Agrega contenido para verlo aquí.</p>`;
        return;
    }
    
    // Spinner de carga rápida
    myListGrid.innerHTML = `<div class="spinner" style="margin: 50px auto;"></div>`;

    // 1. PREPARACIÓN DE DATOS (SNAPSHOT)
    // Recopilamos toda la info necesaria AHORA para no buscarla luego
    const allContent = { ...appState.content.movies, ...appState.content.series, ...appState.content.ucm };
    
    // Si tienes Sagas dinámicas, las agregamos también para asegurar que encuentre todo
    if (appState.content.sagas) {
        Object.values(appState.content.sagas).forEach(sagaItems => {
            Object.assign(allContent, sagaItems);
        });
    }

    myListDataCache = [];
    
    // Convertimos el Set de IDs a Array y lo invertimos (últimos agregados primero)
    const watchlistIDs = Array.from(appState.user.watchlist).reverse();

    watchlistIDs.forEach(contentId => {
        const data = allContent[contentId];
        if (data) {
            // Determinamos el tipo una sola vez
            let type = 'movie';
            if (appState.content.series[contentId] || data.type === 'series' || appState.content.seriesEpisodes[contentId]) {
                type = 'series';
            }
            
            // Guardamos el objeto listo para renderizar
            myListDataCache.push({ id: contentId, data: data, type: type });
        }
    });

    // 2. Limpiar grid y resetear contador
    myListGrid.innerHTML = '';
    myListRenderedCount = 0;

    // 3. Renderizar el PRIMER lote
    appendMyListBatch();
}

function appendMyListBatch() {
    const myListGrid = DOM.myListContainer.querySelector('.grid');
    const BATCH_SIZE = 24; // Cargar 24 items por vez
    
    // Calcular el siguiente lote
    const nextBatch = myListDataCache.slice(myListRenderedCount, myListRenderedCount + BATCH_SIZE);
    
    if (nextBatch.length === 0) return;

    // 🔥 USAR FRAGMENTO PARA RENDIMIENTO MÁXIMO
    const fragment = document.createDocumentFragment();

    nextBatch.forEach((item, index) => {
        // Pasamos { source: 'my-list' } para que salga la "X" en lugar del "+"
        const card = createMovieCardElement(item.id, item.data, item.type, 'grid', false, { source: 'my-list' });
        
        // Pequeña animación de entrada (solo para los nuevos elementos)
        card.style.animation = `fadeInUp 0.3s ease forwards ${index * 0.05}s`;
        card.style.opacity = '0';
        
        fragment.appendChild(card);
    });

    // Inyectar en el DOM
    myListGrid.appendChild(fragment);
    myListRenderedCount += nextBatch.length;

    // --- GESTIÓN DEL BOTÓN "CARGAR MÁS" ---
    let loadBtn = document.getElementById('mylist-load-more-btn');
    
    if (myListRenderedCount < myListDataCache.length) {
        if (!loadBtn) {
            loadBtn = document.createElement('button');
            loadBtn.id = 'mylist-load-more-btn';
            loadBtn.className = 'btn btn-primary'; 
            loadBtn.innerHTML = 'Cargar más <i class="fas fa-chevron-down"></i>';
            loadBtn.style.cssText = "display: block; margin: 30px auto; min-width: 200px;";
            loadBtn.onclick = appendMyListBatch; 
            DOM.myListContainer.appendChild(loadBtn);
        } else {
            // Asegurar que el botón siempre esté al final
            DOM.myListContainer.appendChild(loadBtn);
        }
    } else {
        if (loadBtn) loadBtn.remove();
    }
}

// ===========================================================
// 🧠 HISTORIAL INTELIGENTE (CARGA POR LOTES)
// ===========================================================

// Variables para controlar la paginación del historial
let historyDataCache = [];
let historyRenderedCount = 0;

function renderHistory() {
    const user = auth.currentUser;
    const historyGrid = DOM.historyContainer.querySelector('.grid');
    
    // Limpieza inicial: Borramos contenido y botón viejo si existe
    const existingBtn = document.getElementById('history-load-more-btn');
    if (existingBtn) existingBtn.remove();
    
    if (!user) {
        historyGrid.innerHTML = `<p class="empty-message">Debes iniciar sesión para ver tu historial.</p>`;
        return;
    }
    
    // Spinner de carga inicial
    historyGrid.innerHTML = `<div class="spinner" style="margin: 50px auto;"></div>`;

    db.ref(`users/${user.uid}/history`).orderByChild('viewedAt').once('value', snapshot => {
        if (!snapshot.exists()) {
            historyGrid.innerHTML = `<p class="empty-message">Tu historial está vacío.</p>`;
            return;
        }

        // 1. Guardamos TODO el historial en memoria (RAM)
        historyDataCache = [];
        snapshot.forEach(child => {
            const item = child.val();
            item.key = child.key; // Guardamos la key para poder borrar después
            historyDataCache.push(item);
        });
        
        // Ordenamos: Lo último visto primero
        historyDataCache.reverse(); 
        
        // 2. Preparamos el Grid limpio
        historyGrid.innerHTML = '';
        historyRenderedCount = 0;

        // 3. Renderizamos el PRIMER lote (los primeros 24)
        appendHistoryBatch();
    });
}

// Función auxiliar que inyecta las tarjetas por partes
function appendHistoryBatch() {
    const historyGrid = DOM.historyContainer.querySelector('.grid');
    const BATCH_SIZE = 24; // Cantidad a cargar por clic (igual que tu grid principal)
    
    // Calculamos qué parte del array toca mostrar ahora
    const nextBatch = historyDataCache.slice(historyRenderedCount, historyRenderedCount + BATCH_SIZE);
    
    if (nextBatch.length === 0) return;

    // 🔥 OPTIMIZACIÓN: Usamos Fragment para pintar todo de una sola vez (0 lag)
    const fragment = document.createDocumentFragment();

    nextBatch.forEach((item) => {
        const options = {
            source: 'history',
            season: item.season
        };
        // Usamos tu función constructora base
        const card = createMovieCardElement(item.contentId, item, item.type, 'grid', false, options);
        
        // --- PERSONALIZACIÓN PARA HISTORIAL ---
        
        // 1. Botón de Borrar (X)
        const removeButton = document.createElement('button');
        removeButton.className = 'btn-remove-history';
        removeButton.dataset.key = item.key;
        removeButton.innerHTML = `<i class="fas fa-times"></i>`;
        card.appendChild(removeButton);

        // 2. Información superpuesta (Título y Fecha)
        const infoOverlay = document.createElement('div');
        infoOverlay.className = 'history-item-overlay';
        const dateStr = item.viewedAt ? new Date(item.viewedAt).toLocaleDateString() : 'Reciente';
        infoOverlay.innerHTML = `<h4 class="history-item-title">${item.title}</h4><p class="history-item-date">Visto: ${dateStr}</p>`;
        card.appendChild(infoOverlay);

        fragment.appendChild(card);
    });

    // Inyectamos el lote en la pantalla
    historyGrid.appendChild(fragment);
    historyRenderedCount += nextBatch.length;

    // --- GESTIÓN DEL BOTÓN "CARGAR MÁS" ---
    let loadBtn = document.getElementById('history-load-more-btn');
    
    // Si todavía quedan items en memoria sin mostrar...
    if (historyRenderedCount < historyDataCache.length) {
        if (!loadBtn) {
            loadBtn = document.createElement('button');
            loadBtn.id = 'history-load-more-btn';
            loadBtn.className = 'btn btn-primary'; 
            loadBtn.innerHTML = 'Cargar más <i class="fas fa-chevron-down"></i>';
            loadBtn.style.cssText = "display: block; margin: 30px auto; min-width: 200px;";
            loadBtn.onclick = appendHistoryBatch; // Al clicar, llama a esta misma función para el siguiente lote
            DOM.historyContainer.appendChild(loadBtn);
        } else {
            // Mover el botón al final siempre
            DOM.historyContainer.appendChild(loadBtn);
        }
    } else {
        // Si ya mostramos todo, quitamos el botón
        if (loadBtn) loadBtn.remove();
    }
}

function setupRealtimeHistoryListener(user) {
    if (appState.user.historyListenerRef) {
        appState.user.historyListenerRef.off('value');
    }

    if (user) {
        appState.user.historyListenerRef = db.ref(`users/${user.uid}/history`).orderByChild('viewedAt');
        
        appState.user.historyListenerRef.on('value', (snapshot) => {
            clearTimeout(appState.player.historyUpdateDebounceTimer);

            appState.player.historyUpdateDebounceTimer = setTimeout(() => {
                generateContinueWatchingCarousel(snapshot);
                if (DOM.historyContainer && DOM.historyContainer.style.display === 'block') {
                    renderHistory();
                }
            }, 250);
        });
    }
}

// ===========================================================
// 7. MODAL DE CONFIRMACIÓN
// ===========================================================
document.addEventListener('DOMContentLoaded', () => {
    if (DOM.confirmDeleteBtn && DOM.cancelDeleteBtn && DOM.confirmationModal) {
        DOM.confirmDeleteBtn.addEventListener('click', () => {
            if (typeof DOM.confirmationModal.onConfirm === 'function') {
                DOM.confirmationModal.onConfirm();
                hideConfirmationModal();
            }
        });

        DOM.cancelDeleteBtn.addEventListener('click', () => hideConfirmationModal());
    }
});

function hideConfirmationModal() {
    DOM.confirmationModal.classList.remove('show');
    DOM.confirmationModal.onConfirm = null;
    document.getElementById('confirm-delete-btn').textContent = "Confirmar";
    if (!document.querySelector('.modal.show')) {
        document.body.classList.remove('modal-open');
    }
}

function openConfirmationModal(title, message, onConfirm) {
    const modal = document.getElementById('confirmation-modal');
    if (!modal) return;

    const titleEl = modal.querySelector('h2');
    const messageEl = modal.querySelector('p');

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;

    DOM.confirmationModal.onConfirm = onConfirm;

    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

// Obtiene el timestamp (fecha en números) del episodio más reciente
function getLatestSeriesDate(seriesId) {
    const allEpisodes = appState.content.seriesEpisodes[seriesId];
    if (!allEpisodes) return 0;

    let flatEpisodes = [];
    if (Array.isArray(allEpisodes)) {
        flatEpisodes = allEpisodes;
    } else {
        flatEpisodes = Object.values(allEpisodes).flat();
    }

    // Buscamos la fecha más alta (la más reciente)
    let maxDate = 0;
    const now = new Date();
    const DAYS_THRESHOLD = 5; // Mismo umbral que usas para la etiqueta

    flatEpisodes.forEach(ep => {
        if (!ep.releaseDate) return;
        const rDate = new Date(ep.releaseDate);
        if (isNaN(rDate.getTime())) return;

        // Solo nos importan fechas que estén dentro del rango de "Novedad"
        // Si es muy vieja, la ignoramos (devuelve 0)
        const diffTime = now - rDate;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        // Si es reciente (menos de 5 días) Y es mayor que la que ya teníamos
        if (diffDays <= DAYS_THRESHOLD && diffDays >= 0 && rDate.getTime() > maxDate) {
            maxDate = rDate.getTime();
        }
    });

    return maxDate;
}

function isDateRecent(dateString) {
    if (!dateString) return false;
    // Intenta convertir la fecha (acepta YYYY-MM-DD)
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return false; // Si está vacía o mal escrita, devuelve falso
    
    const now = new Date();
    const diffTime = now - date;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    // Configuración: 5 días de vigencia
    return diffDays <= 5 && diffDays >= 0; 
}

// -----------------------------------------------------------
// 1. FUNCIÓN AUXILIAR: Detecta fechas recientes en episodios
// -----------------------------------------------------------
// Verifica si una serie tiene alguna TEMPORADA reciente desde la hoja PostersTemporadas
function hasRecentSeasonFromPosters(seriesId) {
    // ⚠️ AQUÍ NO USAMOS 'shared.', USAMOS DIRECTAMENTE 'appState'
    const posters = appState.content.seasonPosters[seriesId];
    if (!posters) return false;

    return Object.values(posters).some(seasonData => {
        // Soporte para formato antiguo (solo URL) y nuevo (Objeto con fecha)
        const date = (typeof seasonData === 'object') ? seasonData.date_added : null;
        return isDateRecent(date);
    });
}

// Verifica si una serie tiene algún episodio reciente
function hasRecentEpisodes(seriesId) {
    // ⚠️ CORRECCIÓN: Quitamos 'shared.' aquí
    const allEpisodes = appState.content.seriesEpisodes[seriesId];
    if (!allEpisodes) return false;

    let flatEpisodes = [];
    if (Array.isArray(allEpisodes)) {
        flatEpisodes = allEpisodes;
    } else {
        flatEpisodes = Object.values(allEpisodes).flat();
    }

    return flatEpisodes.some(ep => isDateRecent(ep.releaseDate));
}

// -----------------------------------------------------------
// 2. FUNCIÓN DE CREACIÓN DE TARJETAS (ACTUALIZADA)
// -----------------------------------------------------------
function createMovieCardElement(id, data, type, layout = 'carousel', lazy = false, options = {}) {
    const card = document.createElement('div');
    card.className = `movie-card ${layout === 'carousel' ? 'carousel-card' : ''}`;
    card.dataset.contentId = id;

    // --- 🏷️ ZONA DE ETIQUETAS (RESTAURADA) ---
    let badgesAccumulator = ''; 
    const isNewContent = isDateRecent(data.date_added);

    if (type === 'series') {
        const hasNewSeason = hasRecentSeasonFromPosters(id); // Detecta si hay temporada nueva
        const hasNewEp = hasRecentEpisodes(id);              // Detecta si hay cap nuevo
        
        if (isNewContent) badgesAccumulator += `<div class="new-episode-badge badge-estreno">ESTRENO</div>`;
        if (hasNewSeason) badgesAccumulator += `<div class="new-episode-badge badge-season">NUEVA TEMP</div>`;
        
        // Solo mostramos "NUEVO CAP" si no estamos mostrando ya "NUEVA TEMP" (para no tapar la imagen)
        if (hasNewEp && !hasNewSeason) badgesAccumulator += `<div class="new-episode-badge badge-episode">NUEVO CAP</div>`;
    } else {
        // Películas
        if (isNewContent) badgesAccumulator += `<div class="new-episode-badge badge-estreno">ESTRENO</div>`;
    }

    let ribbonHTML = badgesAccumulator !== '' ? `<div class="badges-container">${badgesAccumulator}</div>` : '';
    // ----------------------------------------

    // --- Clic Principal (Abrir Detalles o Reproductor) ---
    card.onclick = (e) => {
        // Ignorar si el clic fue en el botón de borrar/lista
        if (e.target.closest('.btn-watchlist') || e.target.closest('.btn-remove-history')) return;
        
        const seasonMatch = data.title.match(/\(T(\d+)\)$/);
        if (seasonMatch) {
            (async () => { const player = await getPlayerModule(); player.openSeriesPlayerDirectlyToSeason(id, seasonMatch[1]); })();
        } else if (options.source === 'history' && type === 'series' && options.season) {
            (async () => { const player = await getPlayerModule(); player.openSeriesPlayerDirectlyToSeason(id, options.season); })();
        } else {
            openDetailsModal(id, type);
        }
    };
    
    // --- Botón de Lista / Borrar ---
    let watchlistBtnHTML = '';
    if(auth.currentUser && options.source !== 'history'){
        const isInList = appState.user.watchlist.has(id);
        
        // Lógica de ícono: X si es Mi Lista, Check si no
        let iconClass = isInList ? 'fa-check' : 'fa-plus';
        if (options.source === 'my-list') iconClass = 'fa-times'; 

        const inListClass = isInList ? 'in-list' : '';
        
        watchlistBtnHTML = `<button class="btn-watchlist ${inListClass}" data-content-id="${id}"><i class="fas ${iconClass}"></i></button>`;
    }

    // --- Imagen ---
    let imageUrl = data.poster;
    if (typeof imageUrl === 'object' && imageUrl?.posterUrl) imageUrl = imageUrl.posterUrl;
    if (!imageUrl) imageUrl = data.banner || '';

    const img = new Image();
    img.onload = () => {
        const placeholder = card.querySelector('.img-container-placeholder');
        if(placeholder) placeholder.replaceWith(img);
        card.classList.add('img-loaded');
    };
    img.src = imageUrl; 
    img.alt = data.title;

    // --- HTML Final ---
    const ratingHTML = `<div class="card-rating-container">${getStarsHTML(appState.content.averages[id], true)}</div>`;

    card.innerHTML = `${ribbonHTML}<div class="img-container-placeholder"></div>${ratingHTML}${watchlistBtnHTML}`;

    // 🔥 ESTO ES LO QUE FALTA: Darle vida al botón
    const watchBtn = card.querySelector('.btn-watchlist');
    if (watchBtn) {
        watchBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation(); // Evita que se abra la película
            handleWatchlistClick(watchBtn);
        };
    }

    return card;
}

// Obtiene el momento exacto (Fecha + Hora) de la última actualización
function getLatestUpdateTimestamp(id, data, type) {
    let maxTimestamp = 0;

    // 1. REVISAR FECHA DE AGREGADO DE LA SERIE/PELI
    if (data.date_added) {
        // El truco: new Date() lee la hora si se la das en el Excel
        const d = new Date(data.date_added); 
        if (!isNaN(d.getTime()) && isDateRecent(data.date_added)) {
            maxTimestamp = Math.max(maxTimestamp, d.getTime());
        }
    }

    // Si es película, terminamos aquí
    if (type === 'movie') return maxTimestamp;

    // 2. REVISAR NUEVAS TEMPORADAS (Posters)
    const posters = appState.content.seasonPosters[id];
    if (posters) {
        Object.values(posters).forEach(p => {
            if (typeof p === 'object' && p.date_added) {
                const d = new Date(p.date_added);
                if (!isNaN(d.getTime()) && isDateRecent(p.date_added)) {
                    maxTimestamp = Math.max(maxTimestamp, d.getTime());
                }
            }
        });
    }

    // 3. REVISAR NUEVOS EPISODIOS
    const allEpisodes = appState.content.seriesEpisodes[id];
    if (allEpisodes) {
        const flatEpisodes = Array.isArray(allEpisodes) ? allEpisodes : Object.values(allEpisodes).flat();
        flatEpisodes.forEach(ep => {
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
// 10. 🎯 EXPORTAR PARA USO GLOBAL (Solo funciones principales)
// ===========================================================
window.ErrorHandler = ErrorHandler;
window.cacheManager = cacheManager;
window.lazyLoader = lazyLoader;
window.showCacheStats = () => {
    const stats = {
        itemCount: localStorage.length,
        version: cacheManager.version,
        contentCached: !!cacheManager.get(cacheManager.keys.content),
        metadataCached: !!cacheManager.get(cacheManager.keys.metadata)
    };
    console.table(stats);
    return stats;
};

// ===========================================================
// GESTIÓN DE VISIBILIDAD (OPTIMIZADA PARA GPU)
// ===========================================================
function setupPageVisibilityHandler() {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // 💤 EL USUARIO SE FUE: MODO AHORRO TOTAL
            
            // 1. Detener carrusel del Hero
            clearInterval(appState.ui.heroInterval);
            
            // 2. Añadir clase para pausar CSS (Luces, brillos, transiciones)
            document.body.classList.add('tab-inactive');
            
        } else {
            // ⚡ EL USUARIO VOLVIÓ: REINICIO SUAVE
            
            // 1. Quitar la pausa CSS
            document.body.classList.remove('tab-inactive');
            
            // 2. NO forzar el Hero inmediatamente. Esperar 1 segundo.
            // Esto da tiempo al navegador a recuperar texturas sin bloquearse.
            setTimeout(() => {
                startHeroInterval();
                
                // Pequeño truco sutil para despertar el renderizado sin ser agresivo
                if (DOM.heroSection) {
                    DOM.heroSection.style.transform = 'translateZ(0)'; 
                }
            }, 1000); 
        }
    });
}

// ===========================================================
// SISTEMA DE RESEÑAS (VERSIÓN ÚNICA Y CORREGIDA)
// ===========================================================

// Exportamos funciones al objeto global para que el HTML las vea
window.closeAllModals = closeAllModals;
window.openFullReview = openFullReview;
window.deleteReview = deleteReview;

function renderReviews() {
    if (!DOM.reviewsGrid) return;
    DOM.reviewsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 50px;"><p class="loading-text">Conectando...</p></div>`;

    db.ref('reviews').limitToLast(30).on('value', snapshot => {
        DOM.reviewsGrid.innerHTML = '';
        if (!snapshot.exists()) {
            DOM.reviewsGrid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">Aún no hay opiniones.</p>`;
            return;
        }

        const reviews = [];
        snapshot.forEach(child => { 
            const data = child.val();
            data.id = child.key;
            reviews.push(data); 
        });

        const ADMIN_EMAIL = 'baquezadat@gmail.com'; 

        reviews.reverse().forEach(rev => {
            const starsHTML = '<i class="fas fa-star"></i>'.repeat(rev.stars) + '<i class="far fa-star"></i>'.repeat(5 - rev.stars);
            const date = rev.timestamp ? new Date(rev.timestamp).toLocaleDateString() : 'Reciente';
            const isAdmin = auth.currentUser && auth.currentUser.email === ADMIN_EMAIL;
            const deleteBtnHTML = isAdmin ? `<button class="btn-delete-review" onclick="deleteReview('${rev.id}')"><i class="fas fa-trash-alt"></i></button>` : '';

            const isLong = rev.text && rev.text.length > 120;
            const readMoreBtn = isLong ? `<button class="btn-read-more" onclick='openFullReview(${JSON.stringify(rev).replace(/'/g, "&apos;")})'>Leer reseña completa</button>` : '';

            const card = document.createElement('div');
            card.className = 'review-card';
            card.innerHTML = `
                <img src="${rev.poster}" class="review-poster" onerror="this.src='https://res.cloudinary.com/djhgmmdjx/image/upload/v1759209689/u71QEFc_bet4rv.png'">
                <div class="review-content">
                    <h3 class="review-movie-title">${rev.contentTitle}</h3>
                    <p class="review-user">@${rev.userName} <span class="review-date-tag">${date}</span></p>
                    <div class="review-stars">${starsHTML}</div>
                    <p class="review-text">"${rev.text}"</p>
                    ${readMoreBtn}
                    ${deleteBtnHTML}
                </div>`;
            DOM.reviewsGrid.appendChild(card);
        });
    });
}

// ===========================================================
// SISTEMA DE CÁLCULO DE PROMEDIOS (RATINGS)
// ===========================================================
appState.content.averages = {}; // Almacenará { contentId: 4.5 }

function setupRatingsListener() {
    // Escuchamos TODO el nodo de reseñas para calcular promedios
    db.ref('reviews').on('value', snapshot => {
        const ratingsData = {}; // { contentId: { totalStars: X, count: Y } }
        
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const rev = child.val();
                if (!ratingsData[rev.contentId]) {
                    ratingsData[rev.contentId] = { sum: 0, count: 0 };
                }
                ratingsData[rev.contentId].sum += rev.stars;
                ratingsData[rev.contentId].count += 1;
            });
        }

        // Convertir sumas en promedios
        const newAverages = {};
        for (const id in ratingsData) {
            newAverages[id] = (ratingsData[id].sum / ratingsData[id].count).toFixed(1);
        }

        appState.content.averages = newAverages;
        
        // Refrescar solo los elementos visuales de ratings sin recargar la grilla
        updateVisibleRatings();
    });
}

function getStarsHTML(rating, isSmall = true) {
    if (!rating || rating === "0.0") return '';
    
    return `
        <div class="star-rating-display ${isSmall ? 'small' : 'large'}" title="${rating} de 5 estrellas">
            <i class="fas fa-star"></i>
            <span class="rating-number">${rating}</span>
        </div>`;
}

function updateVisibleRatings() {
    // Actualizar ratings en tarjetas visibles
    document.querySelectorAll('.movie-card').forEach(card => {
        const id = card.dataset.contentId;
        const ratingContainer = card.querySelector('.card-rating-container');
        if (ratingContainer) {
            ratingContainer.innerHTML = getStarsHTML(appState.content.averages[id], true);
        }
    });
}

function setupReviewSystem() {
    if (!DOM.openReviewBtn) return;

    // 1. Elementos del buscador
    const searchInput = document.getElementById('review-movie-search');
    const optionsList = document.getElementById('review-movie-options');
    const hiddenInput = document.getElementById('review-selected-id');
    const wrapper = document.querySelector('.custom-select-wrapper');

    // 2. Lógica de Estrellas
    const stars = document.querySelectorAll('.star-option');
    stars.forEach(star => {
        star.onclick = (e) => {
            const val = parseInt(star.dataset.value);
            document.getElementById('review-rating-value').value = val;
            stars.forEach(s => s.classList.toggle('selected', parseInt(s.dataset.value) <= val));
        };
    });

    // 3. Lógica Visual del Buscador
    if (searchInput) {
        const showList = (e) => {
            e.stopPropagation();
            if(optionsList) optionsList.classList.add('show');
        };

        searchInput.addEventListener('click', showList);
        searchInput.addEventListener('focus', showList);
        
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            if(optionsList) optionsList.classList.add('show');
            
            const options = optionsList.querySelectorAll('.custom-option');
            options.forEach(opt => {
                const text = opt.textContent.toLowerCase();
                opt.style.display = text.includes(term) ? 'block' : 'none';
            });
        });

        document.addEventListener('click', (e) => {
            if (wrapper && !wrapper.contains(e.target)) {
                if(optionsList) optionsList.classList.remove('show');
            }
        });
    }

    // 4. ABRIR MODAL Y CARGAR DATOS (¡AQUÍ ESTÁ LA MAGIA!)
    DOM.openReviewBtn.onclick = () => {
        if (!auth.currentUser) { 
            openConfirmationModal("Inicia Sesión", "Necesitas cuenta para reseñar.", () => openAuthModal(true));
            return; 
        }

        // Limpieza
        if(searchInput) searchInput.value = '';
        if(hiddenInput) hiddenInput.value = '';
        if(optionsList) optionsList.innerHTML = ''; 

        // --- 🔥 RECOLECCIÓN TOTAL DE CONTENIDO ---
        let allContent = { ...appState.content.movies, ...appState.content.series };

        // A. Agregar contenido de Universos/Sagas Dinámicas
        if (appState.content.sagas) {
            Object.values(appState.content.sagas).forEach(sagaContent => {
                // Mezclamos el contenido de cada saga en la lista principal
                allContent = { ...allContent, ...sagaContent };
            });
        }

        // B. Agregar UCM (Si existe como legado)
        if (appState.content.ucm) {
            allContent = { ...allContent, ...appState.content.ucm };
        }
        // ------------------------------------------

        // Convertir a array y ordenar alfabéticamente
        const sorted = Object.entries(allContent).sort((a, b) => a[1].title.localeCompare(b[1].title));

        // Generar la lista visual
        sorted.forEach(([id, item]) => {
            const div = document.createElement('div');
            div.className = 'custom-option';
            div.textContent = item.title;
            
            div.onclick = () => {
                searchInput.value = item.title;
                hiddenInput.value = id;
                optionsList.classList.remove('show');
            };
            
            if(optionsList) optionsList.appendChild(div);
        });
            
        DOM.reviewModal.classList.add('show');
        document.body.classList.add('modal-open');
    };

    // 5. Enviar Formulario (Lógica Inteligente para encontrar el item)
    DOM.reviewForm.onsubmit = async (e) => {
        e.preventDefault();
        const user = auth.currentUser;
        const contentId = hiddenInput ? hiddenInput.value : null;
        const rating = document.getElementById('review-rating-value').value;
        const text = document.getElementById('review-text-input').value.trim();

        if (!contentId) return ErrorHandler.show('content', 'Selecciona una película de la lista.');
        if (rating === "0" || text.length < 2) return ErrorHandler.show('content', 'Falta calificación o texto.');

        try {
            // Validar duplicados
            const existing = await db.ref('reviews').orderByChild('userId').equalTo(user.uid).once('value');
            let duplicado = false;
            existing.forEach(child => { if (child.val().contentId === contentId) duplicado = true; });

            if (duplicado) {
                openConfirmationModal(
                    "¡Ya opinaste!",
                    "Ya has publicado una reseña para este título anteriormente. Solo se permite una opinión por usuario.",
                () => {
                    // Si le da a "Confirmar/Entendido", cerramos el formulario de reseña
                    DOM.reviewModal.classList.remove('show'); 
                }
            );
                // Opcional: Cambiar texto del botón del modal temporalmente (truco visual)
                document.getElementById('confirm-delete-btn').textContent = "Entendido";
                return;
            }

            // 🔥 BÚSQUEDA PROFUNDA DE DATOS (Para guardar título y poster correcto)
            let item = appState.content.movies[contentId] || appState.content.series[contentId];
            
            // Si no está en las listas normales, buscar en Sagas
            if (!item && appState.content.sagas) {
                for (const key in appState.content.sagas) {
                    if (appState.content.sagas[key][contentId]) {
                        item = appState.content.sagas[key][contentId];
                        break;
                    }
                }
            }
            // Si sigue sin aparecer, buscar en UCM
            if (!item && appState.content.ucm) item = appState.content.ucm[contentId];

            if (!item) return ErrorHandler.show('content', 'Error al identificar el título.');

            // Guardar en Firebase
            await db.ref('reviews').push({
                userId: user.uid, userName: user.displayName || 'Usuario',
                contentId, contentTitle: item.title, poster: item.poster,
                stars: parseInt(rating), text, timestamp: firebase.database.ServerValue.TIMESTAMP
            });

            ErrorHandler.show('content', '¡Reseña publicada!', 3000);
            closeAllModals();
            DOM.reviewForm.reset();
            
            if(searchInput) searchInput.value = '';
            if(hiddenInput) hiddenInput.value = '';
            stars.forEach(s => s.classList.remove('selected'));
            document.getElementById('review-rating-value').value = "0";
        } catch (error) { ErrorHandler.show('database', 'Error al publicar.'); }
    };
}

function openFullReview(data) {
    const modal = document.getElementById('full-review-modal');
    if (!modal) return;
    document.getElementById('read-review-header').style.backgroundImage = `url(${data.poster})`;
    document.getElementById('read-review-poster').src = data.poster;
    document.getElementById('read-review-movie-title').textContent = data.contentTitle;
    document.getElementById('read-review-user').textContent = `@${data.userName}`;
    document.getElementById('read-review-date').textContent = data.timestamp ? new Date(data.timestamp).toLocaleDateString() : 'Reciente';
    document.getElementById('read-review-text').textContent = data.text;
    document.getElementById('read-review-stars').innerHTML = '<i class="fas fa-star"></i>'.repeat(data.stars) + '<i class="far fa-star"></i>'.repeat(5 - data.stars);
    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

function deleteReview(reviewId) {
    openConfirmationModal(
        "Eliminar Reseña", 
        "¿Estás seguro de que deseas eliminar esta reseña permanentemente?", 
        () => {
            // Esta función se ejecuta solo si le dan a "Confirmar"
            db.ref(`reviews/${reviewId}`).remove()
                .then(() => ErrorHandler.show('content', 'Reseña eliminada correctamente.'))
                .catch(() => ErrorHandler.show('database', 'Error al eliminar.'));
        }
    );
}
function renderSagasHub() {
    const container = document.getElementById('sagas-grid-dynamic');
    if (!container) return;
    const sagas = Object.values(appState.content.sagasList || {});
    sagas.sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99));
    container.innerHTML = '';
    sagas.forEach(saga => {
        const card = document.createElement('div');
        card.className = 'saga-card';
        card.style.setProperty('--hover-color', saga.color || '#fff');
        if (saga.banner) card.style.backgroundImage = `url('${saga.banner}')`;
        card.onclick = () => switchView(saga.id);
        card.innerHTML = `<img src="${saga.logo}" alt="${saga.title}" class="saga-logo">`;
        container.appendChild(card);
    });
}

function findContentData(id) {
    const c = appState.content;
    if (c.movies[id]) return c.movies[id];
    if (c.series[id]) return c.series[id];
    for (const k in c.sagas) { if (c.sagas[k][id]) return c.sagas[k][id]; }
    return null;
}

window.adminForceUpdate = () => { localStorage.clear(); location.reload(); };

// ==========================================
// 8. MANEJO DE RECUPERACIÓN DE CONTRASEÑA (NIVEL PROFESIONAL)
// ==========================================

function checkResetPasswordMode() {
    // 1. Verificamos si la URL tiene los parámetros mágicos de Firebase
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');      // Debe ser 'resetPassword'
    const actionCode = urlParams.get('oobCode'); // El código único de seguridad

    // Si detectamos que el usuario viene del correo...
    if (mode === 'resetPassword' && actionCode) {
        
        // A. Limpiamos la URL para que no se vea fea (quita los parámetros visualmente)
        window.history.replaceState({}, document.title, window.location.pathname);

        // B. Abrimos el modal especial
        const modal = document.getElementById('new-password-modal');
        if (modal) {
            modal.classList.add('show');
            document.body.classList.add('modal-open');
        }

        // C. Configuramos el ojo para ver la contraseña (reutilizando lógica)
        const toggleIcon = document.getElementById('toggle-new-pass');
        const inputPass = document.getElementById('new-password-input');
        
        if(toggleIcon && inputPass) {
            // Clonamos para asegurar limpieza de eventos
            const newToggle = toggleIcon.cloneNode(true);
            toggleIcon.parentNode.replaceChild(newToggle, toggleIcon);
            
            newToggle.addEventListener('click', () => {
                const isPass = inputPass.type === 'password';
                inputPass.type = isPass ? 'text' : 'password';
                newToggle.classList.toggle('fa-eye');
                newToggle.classList.toggle('fa-eye-slash');
            });
        }

        // D. Manejamos el envío del formulario
        const form = document.getElementById('new-password-form');
        const feedback = document.getElementById('new-pass-feedback');
        
        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                const newPassword = inputPass.value;
                const btn = form.querySelector('button');

                // Estado de carga
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
                feedback.textContent = "";

                try {
                    // 🔥 LA MAGIA: Confirmamos el cambio en Firebase usando el código
                    await auth.confirmPasswordReset(actionCode, newPassword);
                    
                    // Éxito visual
                    feedback.style.color = '#4cd137'; // Verde
                    feedback.textContent = "¡Contraseña actualizada correctamente!";
                    btn.textContent = "¡Listo!";
                    
                    // Esperar 2 segundos y abrir el login normal para que entre
                    setTimeout(() => {
                        modal.classList.remove('show'); // Cerrar modal de reset
                        if(window.openAuthModal) window.openAuthModal(true); // Abrir login
                    }, 2000);

                } catch (error) {
                    console.error("Error reset password:", error);
                    btn.disabled = false;
                    btn.textContent = "Guardar Nueva Contraseña";
                    feedback.style.color = '#ff4d4d'; // Rojo
                    
                    // Mensajes de error amigables
                    if (error.code === 'auth/expired-action-code') {
                        feedback.textContent = "El enlace ha expirado. Solicita uno nuevo.";
                    } else if (error.code === 'auth/invalid-action-code') {
                        feedback.textContent = "El enlace ya fue usado o no es válido.";
                    } else if (error.code === 'auth/weak-password') {
                        feedback.textContent = "La contraseña es muy débil (mínimo 6 caracteres).";
                    } else {
                        feedback.textContent = "Ocurrió un error. Intenta nuevamente.";
                    }
                }
            };
        }
    }
}

// ===========================================================
// 11. MÓDULO DE RESEÑAS (LOGICA FALTANTE)
// ===========================================================

// Función principal para renderizar
window.renderReviews = async function() {
    const grid = document.getElementById('reviews-grid');
    if (!grid) return;

    grid.innerHTML = '<div class="spinner" style="margin: 50px auto;"></div>';

    try {
        // 1. Obtener reseñas de Firebase
        const snapshot = await db.ref('reviews').once('value');
        const reviewsData = snapshot.val();

        grid.innerHTML = ''; // Limpiar cargador

        if (!reviewsData) {
            grid.innerHTML = `
                <div style="text-align:center; width:100%; color:#888; margin-top:50px;">
                    <i class="fas fa-comment-slash" style="font-size:3rem; margin-bottom:20px;"></i>
                    <p>Aún no hay reseñas. ¡Sé el primero en opinar!</p>
                </div>`;
            return;
        }

        // 2. Convertir a array y ordenar (más recientes primero)
        const reviews = Object.entries(reviewsData)
            .map(([id, data]) => ({ id, ...data }))
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        // 3. Crear tarjetas
        reviews.forEach(review => {
            // Buscar datos de la película para el poster
            let movieData = null;
            if (appState.content.movies && appState.content.movies[review.contentId]) {
                movieData = appState.content.movies[review.contentId];
            } else if (appState.content.series && appState.content.series[review.contentId]) {
                movieData = appState.content.series[review.contentId];
            }

            // Si no encontramos la peli (quizás se borró), usamos imagen genérica
            const posterUrl = movieData ? movieData.poster : 'https://via.placeholder.com/300x450?text=No+Image';
            const title = movieData ? movieData.title : (review.contentTitle || 'Título Desconocido');

            // Generar Estrellas HTML
            let starsHtml = '';
            for (let i = 1; i <= 5; i++) {
                if (i <= review.rating) starsHtml += '<i class="fas fa-star" style="color: #ffd700;"></i>';
                else starsHtml += '<i class="far fa-star" style="color: #444;"></i>';
            }

            // Crear elemento HTML
            const card = document.createElement('div');
            card.className = 'review-card';
            card.innerHTML = `
                <div class="review-poster">
                    <img src="${posterUrl}" alt="${title}" loading="lazy">
                </div>
                <div class="review-content">
                    <div class="review-header">
                        <h3 class="review-movie-title">${title}</h3>
                        <div class="review-rating">${starsHtml}</div>
                    </div>
                    <p class="review-snippet">"${review.text}"</p>
                    <div class="review-footer">
                        <span class="review-author"><i class="fas fa-user-circle"></i> ${review.userEmail ? review.userEmail.split('@')[0] : 'Anónimo'}</span>
                        <span class="review-date">${new Date(review.timestamp).toLocaleDateString()}</span>
                    </div>
                </div>
            `;

            // Click para abrir modal de lectura completa
            card.onclick = () => openReadReviewModal(review, movieData);
            
            grid.appendChild(card);
        });

    } catch (error) {
        console.error("Error cargando reseñas:", error);
        grid.innerHTML = '<p style="text-align:center; color:red;">Error al cargar las reseñas.</p>';
    }
};

// Función para abrir el modal de lectura
function openReadReviewModal(review, movieData) {
    const modal = document.getElementById('full-review-modal');
    if (!modal) return;

    const posterUrl = movieData ? movieData.poster : '';
    const title = movieData ? movieData.title : (review.contentTitle || 'Desconocido');

    document.getElementById('read-review-poster').src = posterUrl;
    document.getElementById('read-review-movie-title').textContent = title;
    document.getElementById('read-review-user').textContent = `Reseña de: ${review.userEmail.split('@')[0]}`;
    document.getElementById('read-review-text').textContent = review.text;
    document.getElementById('read-review-date').textContent = new Date(review.timestamp).toLocaleDateString();

    // Estrellas en el modal
    let starsHtml = '';
    for (let i = 1; i <= 5; i++) {
        starsHtml += i <= review.rating ? '<i class="fas fa-star"></i>' : '<i class="far fa-star"></i>';
    }
    document.getElementById('read-review-stars').innerHTML = starsHtml;

    document.body.classList.add('modal-open');
    modal.classList.add('show');
}


