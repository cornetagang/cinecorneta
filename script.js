// ===========================================================
// CINE CORNETA - SCRIPT PRINCIPAL (MODULAR)
// Versión: 5.3.5 (Optimizada)
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
    const module = await import('./profile.js?v=3'); 
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
    profileContainer: document.getElementById('profile-container'),
    settingsContainer: document.getElementById('settings-container'),
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
    langFilter: document.getElementById('lang-filter'), // <--- 🔥 AGREGADO
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
    myListNavLinkMobile: document.getElementById('my-list-nav-link-mobile'),
    historyNavLinkMobile: document.getElementById('history-nav-link-mobile'),
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

const API_URL = 'https://script.google.com/macros/s/AKfycbxsC8vcvWrCMjx6ryUTLi0UDgU0eMy2oBijsiNCABCcS9LRKHQnUse4gxRSrL-1etNS/exec';
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
    const startLoadTime = Date.now();

    // =========================================================================
    // 📡 SISTEMA DE ACTUALIZACIÓN INTELIGENTE (FIXED & MOBILE READY)
    // =========================================================================
    if (typeof db !== 'undefined') {
        const updatesRef = db.ref('system_metadata/last_update');
        updatesRef.on('value', (snapshot) => {
            // 1. Aseguramos que sean números para evitar errores de comparación
            const serverLastUpdate = Number(snapshot.val()); 
            const localRaw = localStorage.getItem('local_last_update');
            const localLastUpdate = localRaw ? Number(localRaw) : 0;

            console.log(`📡 Señal: Server(${serverLastUpdate}) vs Local(${localLastUpdate})`);

            // Caso: Nueva versión detectada en el servidor
            if (serverLastUpdate > localLastUpdate) {
                console.log('🔄 ADMIN: Nueva versión detectada.');

                // Detectamos si hay un modal abierto (Usuario viendo algo)
                const isWatching = document.body.classList.contains('modal-open');

                if (isWatching) {
                    // A: SI ESTÁ VIENDO ALGO -> Actualizar en silencio (Segundo plano)
                    console.log('🎬 Usuario ocupado. Programando recarga en localStorage...');
                    
                    // 1. Guardamos la "orden" de recargar en el disco (localStorage)
                    // Esto sobrevive aunque el navegador mate el proceso en segundo plano
                    localStorage.setItem('pending_reload', 'true');
                    
                    // 2. Actualizamos la fecha YA para que no vuelva a intentar actualizarse en bucle
                    localStorage.setItem('local_last_update', serverLastUpdate);
                    
                    // 3. Bajamos la data nueva "por debajo" sin molestar
                    refreshDataInBackground(); 
                    
                } else {
                    // B: SI ESTÁ LIBRE -> Recarga inmediata (Hard Reload)
                    console.log('🚀 Aplicando actualización inmediata...');
                    
                    // 1. Primero borramos todo (Caché vieja)
                    if (window.cacheManager) {
                        window.cacheManager.clearAll();
                    } else {
                        localStorage.clear();
                    }
                    
                    // 2. Y LUEGO guardamos la nueva fecha (para que al volver sepa que está al día)
                    localStorage.setItem('local_last_update', serverLastUpdate);

                    // 3. 🔥 EL TRUCO DEL HARD RELOAD EN MÓVIL
                    // Forzamos una navegación a una URL "nueva" agregando la hora actual
                    const url = new URL(window.location.href);
                    url.searchParams.set('force_update', Date.now());
                    window.location.href = url.toString();
                }
            } 
            // Caso: Primera vez que entramos (Sincronización inicial)
            else if (serverLastUpdate && localLastUpdate === 0) {
                localStorage.setItem('local_last_update', serverLastUpdate);
            }
        });
    }

    // =========================================================================
    // ⚙️ FUNCIONES INTERNAS DE PROCESAMIENTO
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
    // 🚀 LÓGICA DE CARGA: CACHÉ VS INTERNET
    // =========================================================================
    const cachedContent = cacheManager.get(cacheManager.keys.content);
    const cachedMetadata = cacheManager.get(cacheManager.keys.metadata);

    // --- OPCIÓN A: USAR CACHÉ (Rápido) ---
    if (cachedContent) {
        console.log('✓ Iniciando desde caché...');
        processData(cachedContent);
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
            
            // 🔥 Guardamos la fecha actual como referencia inicial si no existía
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
    const link = event.target.closest('a');
    if (!link) return;
    event.preventDefault();
    DOM.mobileNavPanel?.classList.remove('is-open');
    DOM.menuOverlay?.classList.remove('active');
    if (DOM.userMenuDropdown) DOM.userMenuDropdown.classList.remove('show');
    
    const filter = link.dataset.filter;

    if (filter === 'roulette') {
        const roulette = await getRouletteModule();
        roulette.openRouletteModal();
        return;
    }

    if (link.classList.contains('active') && !['history', 'my-list'].includes(filter)) return;
    document.querySelectorAll('a[data-filter]').forEach(l => l.classList.remove('active'));
    document.querySelectorAll(`a[data-filter="${filter}"]`).forEach(l => l.classList.add('active'));
    
    DOM.searchInput.value = '';
    switchView(filter);
}

// ===========================================================
// FUNCIÓN SWITCHVIEW (LIMPIA Y CORREGIDA)
// ===========================================================
async function switchView(filter) {
    // 1. Ocultar todos los contenedores
    const containers = [
        document.getElementById('hero-section'),
        document.getElementById('carousel-container'),
        document.getElementById('full-grid-container'),
        document.getElementById('my-list-container'),
        document.getElementById('history-container'),
        document.getElementById('profile-container'),
        document.getElementById('settings-container'),
        document.getElementById('profile-hub-container'),
        document.getElementById('sagas-hub-container')
    ];

    containers.forEach(el => {
        if (el) el.style.display = 'none';
    });

    const filterControls = document.getElementById('filter-controls');
    if (filterControls) filterControls.style.display = 'none';

    // 2. Lógica del Botón "Volver a Sagas"
    const backBtn = document.getElementById('back-to-sagas-btn');
    
    // Verificamos si estamos DENTRO de una saga (ej: harrypotter)
    // Usamos el objeto sagas para confirmar
    const isDynamicSaga = appState.content.sagas && appState.content.sagas[filter];

    if (backBtn) {
        if (isDynamicSaga) {
            backBtn.style.display = 'flex';
            // Clonamos para limpiar eventos anteriores
            const newBtn = backBtn.cloneNode(true);
            backBtn.parentNode.replaceChild(newBtn, backBtn);
            
            newBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Efecto visual en el menú
                document.querySelectorAll('.main-nav a').forEach(a => a.classList.remove('active'));
                const sagasNav = document.querySelector('a[data-filter="sagas"]');
                if (sagasNav) sagasNav.classList.add('active');
                
                switchView('sagas'); // Volver al Hub
            };
        } else {
            backBtn.style.display = 'none';
        }
    }

    // ============================================================
    // 3. SELECCIÓN DE VISTA
    // ============================================================

    // CASO: INICIO
    if (filter === 'all') {
        const hero = document.getElementById('hero-section');
        const carousel = document.getElementById('carousel-container');
        if (hero) hero.style.display = 'flex';
        if (carousel) carousel.style.display = 'block';
        return;
    }

    // CASO: HUB DE SAGAS (Logos Grandes)
    if (filter === 'sagas') {
        const hub = document.getElementById('sagas-hub-container');
        if (hub) {
            hub.style.display = 'block';
            renderSagasHub(); // Función que pinta los botones negros
        }
        return;
    }

    // CASO: GRILLA DE CONTENIDO (Pelis, Series O Sagas Específicas)
    if (filter === 'movie' || filter === 'series' || isDynamicSaga) {
        const grid = document.getElementById('full-grid-container');
        if (grid) grid.style.display = 'block';
        if (filterControls) filterControls.style.display = 'flex';

        populateFilters(filter);
        applyAndDisplayFilters(filter);
        return;
    }

    // CASO: MI LISTA
    if (filter === 'my-list') {
        const listContainer = document.getElementById('my-list-container');
        if (listContainer) {
            listContainer.style.display = 'block';
            displayMyListView();
        }
        return;
    }

    // CASO: HISTORIAL
    if (filter === 'history') {
        const historyContainer = document.getElementById('history-container');
        if (historyContainer) {
            historyContainer.style.display = 'block';
            renderHistory();
        }
        return;
    }

    // OTROS CASOS (Perfil, Ajustes, Búsqueda)
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

    if (filter === 'search') {
        const grid = document.getElementById('full-grid-container');
        if(grid) grid.style.display = 'block';
        return;
    }
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
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeAllModals();
    });

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('click', handleGlobalClick);
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

function handleGlobalClick(event) {
    if (event.target.closest('.close-btn')) {
        closeAllModals();
        return;
    }
    const watchlistButton = event.target.closest('.btn-watchlist');
    if (watchlistButton) {
        handleWatchlistClick(watchlistButton);
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

        const user = auth.currentUser;
        let watchlistButtonHTML = '';

        if (user) { 
            const isInList = appState.user.watchlist.has(movieId);
            const iconClass = isInList ? 'fa-check' : 'fa-plus';
            const buttonClass = isInList ? 'btn-watchlist in-list' : 'btn-watchlist';
            watchlistButtonHTML = `<button class="${buttonClass}" data-content-id="${movieId}" title="Añadir a Mi Lista"><i class="fas ${iconClass}"></i></button>`;
        }

        const playButton = document.createElement('button');
        playButton.className = 'btn btn-play';
        playButton.innerHTML = '<i class="fas fa-play"></i> Ver Ahora';
        playButton.onclick = async () => { // 🆕 Carga bajo demanda
            const player = await getPlayerModule();
            player.openPlayerModal(movieId, movieData.title.replace(/'/g, "\\'"));
        };

        const infoButton = document.createElement('button');
        infoButton.className = 'btn btn-info';
        infoButton.textContent = 'Más Información';
        infoButton.onclick = () => openDetailsModal(movieId, 'movie');

        const heroButtons = heroContent.querySelector('.hero-buttons');
        heroButtons.innerHTML = watchlistButtonHTML; // Limpia y añade watchlist
        heroButtons.prepend(infoButton); // Añade info
        heroButtons.prepend(playButton); // Añade play al principio

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
        // 🔥 BÚSQUEDA INTELIGENTE UNIVERSAL
        // =========================================================
        let data = null;

        if (appState.content.movies[id]) { 
            data = appState.content.movies[id]; type = 'movie'; 
        }
        else if (appState.content.series[id]) { 
            data = appState.content.series[id]; type = 'series'; 
        }
        else if (appState.content.ucm && appState.content.ucm[id]) { 
            data = appState.content.ucm[id]; 
            type = (data.type === 'series' || appState.content.seriesEpisodes[id]) ? 'series' : 'movie';
        }

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
        // RENDERIZADO
        // =========================================================
        const isSeries = (type === 'series');
        
        document.getElementById('details-title').textContent = data.title || '';
        document.getElementById('details-year').textContent = data.year ? `(${data.year})` : '';
        document.getElementById('details-genres').textContent = data.genres || '';
        document.getElementById('details-synopsis').textContent = data.synopsis || 'Sin descripción.';
        document.getElementById('details-poster-img').src = data.poster || '';

        // 🔥 MOSTRAR IDIOMA (NUEVO)
        const langEl = document.getElementById('details-language');
        if (langEl) {
            if (data.language) {
                langEl.textContent = data.language;
                langEl.style.display = 'inline-block';
            } else {
                langEl.style.display = 'none';
            }
        }

        // Fondo (Banner)
        if (data.banner && data.banner.length > 5) {
            panel.style.backgroundImage = `url(${data.banner})`;
        } else {
            panel.style.backgroundImage = 'none';
            panel.style.backgroundColor = '#1a1a1a';
        }

        // Botones
        detailsButtons.innerHTML = '';

        // 1. Botón PLAY
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

        // 2. Botones de Series
        if (isSeries) {
            const episodes = appState.content.seriesEpisodes[id] || {};
            const seasonCount = Object.keys(episodes).length;

            // Botón Temporadas: Solo si hay MÁS de 1 temporada
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

        // 3. Botón Mi Lista
        if (auth.currentUser) {
            const listBtn = document.createElement('button');
            const inList = appState.user.watchlist.has(id);
            listBtn.className = `btn btn-watchlist ${inList ? 'in-list' : ''}`;
            listBtn.innerHTML = `<i class="fas ${inList ? 'fa-check' : 'fa-plus'}"></i>`;
            listBtn.onclick = () => handleWatchlistClick(listBtn);
            listBtn.setAttribute('data-content-id', id); 
            detailsButtons.appendChild(listBtn);
        }

        modal.classList.add('show');
        document.body.classList.add('modal-open');

        const closeBtn = modal.querySelector('.close-btn');
        if(closeBtn) closeBtn.onclick = closeAllModals;

    } catch (e) {
        console.error(e);
        if(typeof logError === 'function') logError(e, 'Open Details');
    }
}

// ===========================================================
// 6. AUTENTICACIÓN Y DATOS DE USUARIO
// ===========================================================
function setupAuthListeners() {
    // 1. Botones de Ingreso/Registro del Header (PC)
    if (DOM.loginBtnHeader) DOM.loginBtnHeader.addEventListener('click', () => openAuthModal(true));
    if (DOM.registerBtnHeader) DOM.registerBtnHeader.addEventListener('click', () => openAuthModal(false));

    // 2. Link para cambiar entre Login/Registro en el modal
    if (DOM.switchAuthModeLink) {
        DOM.switchAuthModeLink.addEventListener('click', (e) => {
            e.preventDefault();
            const isLoginVisible = DOM.loginForm.style.display === 'flex' || DOM.loginForm.style.display === '';
            openAuthModal(!isLoginVisible);
        });
    }

    // 3. Manejo del Formulario de Registro
    if (DOM.registerForm) {
        DOM.registerForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const username = DOM.registerUsernameInput.value;
            const email = DOM.registerEmailInput.value;
            const password = DOM.registerPasswordInput.value;
            auth.createUserWithEmailAndPassword(email, password)
                .then((userCredential) => userCredential.user.updateProfile({ displayName: username }))
                .then(() => { closeAllModals(); DOM.registerForm.reset(); })
                .catch(error => { DOM.registerError.textContent = error.message; });
        });
    }

    // 4. Manejo del Formulario de Login
    if (DOM.loginForm) {
        DOM.loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = DOM.loginEmailInput.value;
            const password = DOM.loginPasswordInput.value;
            auth.signInWithEmailAndPassword(email, password)
                .then(() => { closeAllModals(); DOM.loginForm.reset(); })
                .catch(error => { DOM.loginError.textContent = error.message; });
        });
    }

    // 5. Listener global de estado
    auth.onAuthStateChanged(updateUIAfterAuthStateChange);

    // 6. Eliminar items del historial
    if (DOM.historyContainer) {
        DOM.historyContainer.addEventListener('click', (event) => {
            const removeButton = event.target.closest('.btn-remove-history');
            if (removeButton) {
                event.stopPropagation();
                const entryKey = removeButton.dataset.key;
                openConfirmationModal(
                    'Eliminar del Historial',
                    '¿Estás seguro de que quieres eliminar este item de tu historial?',
                    () => removeFromHistory(entryKey)
                );
            }
        });
    }

    // 🔥 NUEVO: Lógica del botón "Iniciar Sesión" en el perfil móvil
    const hubLoginBtn = document.getElementById('login-btn-hub');
    if (hubLoginBtn) {
        hubLoginBtn.addEventListener('click', () => {
             openAuthModal(true); // Abre el modal de login
        });
    }

    // LÓGICA DE CERRAR SESIÓN
    const performLogout = (e) => {
        e.preventDefault(); e.stopPropagation();
        auth.signOut().then(() => window.location.reload());
    };

    const logoutBtnHeader = document.getElementById('logout-btn');
    if (logoutBtnHeader) {
        const newBtn = logoutBtnHeader.cloneNode(true);
        logoutBtnHeader.parentNode.replaceChild(newBtn, logoutBtnHeader);
        newBtn.addEventListener('click', performLogout);
    }

    const logoutBtnHub = document.getElementById('logout-btn-hub');
    if (logoutBtnHub) {
        const newBtnHub = logoutBtnHub.cloneNode(true);
        logoutBtnHub.parentNode.replaceChild(newBtnHub, logoutBtnHub);
        newBtnHub.addEventListener('click', performLogout);
    }
}

function openAuthModal(isLogin) {
    DOM.loginForm.style.display = isLogin ? 'flex' : 'none';
    DOM.registerForm.style.display = isLogin ? 'none' : 'flex';
    DOM.switchAuthModeLink.textContent = isLogin ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia Sesión';
    DOM.loginError.textContent = '';
    DOM.registerError.textContent = '';
    DOM.authModal.classList.add('show');
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

    let posterUrl = itemData.poster;
    if (isSeries && episodeInfo.season) {
        const seasonPosterUrl = appState.content.seasonPosters[contentId]?.[episodeInfo.season];
        if (seasonPosterUrl) {
            posterUrl = seasonPosterUrl;
        }
    }
    
    const historyKey = isSeries ? `${contentId}_${episodeInfo.season}` : contentId;
    const historyTitle = isSeries ? `${itemData.title}: T${String(episodeInfo.season).replace('T', '')}` : itemData.title;
    
    const historyEntry = {
        type,
        contentId,
        title: historyTitle,
        poster: posterUrl,
        viewedAt: firebase.database.ServerValue.TIMESTAMP,
        season: isSeries ? episodeInfo.season : null,
        lastEpisode: isSeries ? episodeInfo.index : null
    };

    const userHistoryRef = db.ref(`users/${user.uid}/history/${historyKey}`);
    userHistoryRef.set(historyEntry);
}

function removeFromHistory(entryKey) {
    const user = auth.currentUser;
    if (!user) return;
    db.ref(`users/${user.uid}/history/${entryKey}`).remove().then(() => renderHistory());
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
    
    await ErrorHandler.firebaseOperation(async () => {
        await db.ref(`users/${user.uid}/watchlist/${contentId}`).remove();
        appState.user.watchlist.delete(contentId);
        
        document.querySelectorAll(`.btn-watchlist[data-content-id="${contentId}"]`).forEach(button => {
            button.classList.remove('in-list');
            button.innerHTML = '<i class="fas fa-plus"></i>';
        });
        
        const activeFilter = document.querySelector('.main-nav a.active, .mobile-nav a.active')?.dataset.filter;
        if (activeFilter === 'my-list') {
            const cardToRemove = DOM.myListContainer.querySelector(`.movie-card[data-content-id="${contentId}"]`);
            if (cardToRemove) {
                cardToRemove.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                cardToRemove.style.opacity = '0';
                cardToRemove.style.transform = 'scale(0.9)';
                setTimeout(() => {
                    cardToRemove.remove();
                    if (appState.user.watchlist.size === 0) {
                        DOM.myListContainer.querySelector('.grid').innerHTML = `<p class="empty-message">Tu lista está vacía. Agrega contenido para verlo aquí.</p>`;
                    }
                }, 300);
            }
        }
    });
}

function displayMyListView() {
    const user = auth.currentUser;
    const myListGrid = DOM.myListContainer.querySelector('.grid');
    if (!user) {
        myListGrid.innerHTML = `<p class="empty-message">Debes iniciar sesión para ver tu lista.</p>`;
        return;
    }
    if (appState.user.watchlist.size === 0) {
        myListGrid.innerHTML = `<p class="empty-message">Tu lista está vacía. Agrega contenido para verlo aquí.</p>`;
        return;
    }
    myListGrid.innerHTML = '';
    const allContent = { ...appState.content.movies, ...appState.content.series, ...appState.content.ucm };
    appState.user.watchlist.forEach(contentId => {
        const data = allContent[contentId];
        if (data) {
            const type = appState.content.series[contentId] ? 'series' : 'movie';
            myListGrid.appendChild(createMovieCardElement(contentId, data, type, 'grid', false));
        }
    });
}

function renderHistory() {
    const user = auth.currentUser;
    const historyGrid = DOM.historyContainer.querySelector('.grid');
    if (!user) {
        historyGrid.innerHTML = `<p class="empty-message">Debes iniciar sesión para ver tu historial.</p>`;
        return;
    }
    historyGrid.innerHTML = `<p>Cargando tu historial...</p>`;
    db.ref(`users/${user.uid}/history`).orderByChild('viewedAt').once('value', snapshot => {
        if (!snapshot.exists()) {
            historyGrid.innerHTML = `<p class="empty-message">Tu historial está vacío.</p>`;
            return;
        }
        const historyData = [];
        snapshot.forEach(child => {
            const item = child.val();
            item.key = child.key;
            historyData.push(item);
        });
        historyGrid.innerHTML = '';
        historyData.reverse().forEach((item) => {
            const options = {
                source: 'history',
                season: item.season
            };
            const card = createMovieCardElement(item.contentId, item, item.type, 'grid', false, options);
            
            const removeButton = document.createElement('button');
            removeButton.className = 'btn-remove-history';
            removeButton.dataset.key = item.key;
            removeButton.innerHTML = `<i class="fas fa-times"></i>`;
            card.appendChild(removeButton);

            const infoOverlay = document.createElement('div');
            infoOverlay.className = 'history-item-overlay';
            infoOverlay.innerHTML = `<h4 class="history-item-title">${item.title}</h4><p class="history-item-date">Visto: ${new Date(item.viewedAt).toLocaleDateString()}</p>`;
            card.appendChild(infoOverlay);

            historyGrid.appendChild(card);
        });
    });
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

    let badgesAccumulator = ''; // Usamos esto para juntar varias etiquetas
    
    const isNewContent = isDateRecent(data.date_added);

    if (type === 'series') {
        const hasNewSeason = hasRecentSeasonFromPosters(id);
        const hasNewEp = hasRecentEpisodes(id);

        // 1. ¿Es Estreno?
        if (isNewContent) {
            badgesAccumulator += `<div class="new-episode-badge badge-estreno">ESTRENO</div>`;
        }

        // 2. ¿Tiene Nueva Temporada? (Ahora se agrega DEBAJO, no reemplaza)
        if (hasNewSeason) {
            badgesAccumulator += `<div class="new-episode-badge badge-season">NUEVA TEMP</div>`;
        }

        // 3. ¿Tiene Nuevo Cap? 
        // Lógica opcional: Si ya mostramos "Nueva Temp", quizás "Nuevo Cap" sea redundante.
        // Pero si quieres que salga también, quita la parte de "&& !hasNewSeason"
        if (hasNewEp && !hasNewSeason) {
            badgesAccumulator += `<div class="new-episode-badge badge-episode">NUEVO CAP</div>`;
        }
    } 
    else if (type === 'movie') {
        if (isNewContent) {
            badgesAccumulator += `<div class="new-episode-badge badge-estreno">ESTRENO</div>`;
        }
    }

    // Si hay alguna etiqueta, la envolvemos en el contenedor nuevo
    let ribbonHTML = '';
    if (badgesAccumulator !== '') {
        ribbonHTML = `<div class="badges-container">${badgesAccumulator}</div>`;
    }

    card.onclick = (e) => {
        if (e.target.closest('.btn-watchlist') || e.target.closest('.btn-remove-history')) return;
        
        const seasonMatch = data.title.match(/\(T(\d+)\)$/);
        if (seasonMatch) {
            const seasonNum = seasonMatch[1];
            (async () => {
                const player = await getPlayerModule();
                player.openSeriesPlayerDirectlyToSeason(id, seasonNum);
            })();
        } else if (options.source === 'history' && type === 'series' && options.season) {
            (async () => {
                const player = await getPlayerModule();
                player.openSeriesPlayerDirectlyToSeason(id, options.season);
            })();
        } else {
            openDetailsModal(id, type);
        }
    };
    
    let watchlistBtnHTML = '';
    if(auth.currentUser && options.source !== 'history'){
        const isInList = appState.user.watchlist.has(id);
        const icon = isInList ? 'fa-check' : 'fa-plus';
        const inListClass = isInList ? 'in-list' : '';
        watchlistBtnHTML = `<button class="btn-watchlist ${inListClass}" data-content-id="${id}"><i class="fas ${icon}"></i></button>`;
    }

    let imageUrl = data.poster; 

    // 2. Intentamos buscar un póster específico de temporada si aplica
    const seasonMatch = data.title.match(/\(T(\d+)\)$/);
    if (seasonMatch && appState.content.seasonPosters[id]) {
        const seasonNum = seasonMatch[1];
        
        // Buscamos en seasonPosters con seguridad
        const posterEntry = appState.content.seasonPosters[id][seasonNum];
        
        if (posterEntry) {
            // Si es objeto (nuevo formato), usamos .posterUrl o .poster
            if (typeof posterEntry === 'object') {
                imageUrl = posterEntry.posterUrl || posterEntry.poster || imageUrl;
            } 
            // Si es string (viejo formato), lo usamos directo
            else if (typeof posterEntry === 'string') {
                imageUrl = posterEntry;
            }
        }
    }
    
    // 3. Fallback final de seguridad: si imageUrl es null/undefined, intentar usar banner
    if (!imageUrl) {
        imageUrl = data.banner || ''; // Último recurso para evitar vacío total
    }

    const img = new Image();
    img.onload = () => {
        const imgContainer = card.querySelector('.img-container-placeholder');
        if(imgContainer) imgContainer.replaceWith(img);
        card.classList.add('img-loaded');
    };
    img.onerror = () => {
        // Si falla la carga, intentamos poner el póster general si no era el que estábamos usando
        if (imageUrl !== data.poster && data.poster) {
            img.src = data.poster;
        } else {
            card.classList.add('img-error');
            console.warn(`Imagen rota para: ${data.title} (URL: ${imageUrl})`);
        }
    };

    img.src = imageUrl; 
    img.alt = data.title;

    // Aquí inyectamos el 'ribbonHTML' antes de la imagen
    card.innerHTML = `
        ${ribbonHTML}
        <div class="img-container-placeholder"></div>
        ${watchlistBtnHTML}
    `;

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
// 🔥 RENDERIZADO DE HUB SAGAS (CON BANNERS)
// ===========================================================
function renderSagasHub() {
    const container = document.getElementById('sagas-grid-dynamic');
    if (!container) return;
    
    // Obtenemos la lista y la ordenamos por la columna 'order'
    // Aseguramos que sea un array
    const sagas = Array.isArray(appState.content.sagasList) 
        ? appState.content.sagasList 
        : Object.values(appState.content.sagasList || {});

    // Ordenar (si el campo order está vacío, lo manda al final)
    sagas.sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99));

    container.innerHTML = '';

    if (sagas.length === 0) {
        container.innerHTML = '<p class="loading-text" style="font-size:1.5rem">Cargando sagas...</p>';
        return;
    }

    sagas.forEach(saga => {
        const card = document.createElement('div');
        card.className = 'saga-card';
        card.dataset.saga = saga.id;
        
        // Color y Banner
        const color = saga.color || '#ffffff';
        card.style.setProperty('--hover-color', color);

        if (saga.banner && saga.banner.trim() !== "") {
            card.style.backgroundImage = `url('${saga.banner}')`;
        }

        // Clic
        card.onclick = () => {
            switchView(saga.id); 
        };

        // 🔥 SIN FILTROS RAROS: Se verá el dorado original
        card.innerHTML = `
            <img src="${saga.logo}" alt="${saga.title}" class="saga-logo">
        `;

        container.appendChild(card);
    });
}

// ===========================================================
// 10. 🎯 EXPORTAR PARA USO GLOBAL
// ===========================================================
window.ErrorHandler = ErrorHandler;
window.cacheManager = cacheManager;
window.lazyLoader = lazyLoader;

// 🔥 NUEVO: Función para el botón Maestro del Admin
window.adminForceUpdate = () => {
    console.log('👑 ADMIN: Forzando actualización de datos...');
    
    // 1. Borrar toda la caché local
    if (window.cacheManager) {
        window.cacheManager.clearAll();
    } else {
        localStorage.clear();
    }

    // 2. Recargar la página para traer datos frescos de Google Script
    // El setTimeout es solo para que veas el efecto visual del botón un momento
    setTimeout(() => {
        location.reload(); 
    }, 500);
};
