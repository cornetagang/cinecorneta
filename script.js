// ===========================================================
// CINE CORNETA - SCRIPT PRINCIPAL (MODULAR)
// Versión: 3.0.0 (Optimizada)
// ===========================================================

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
    const module = await import('./profile.js');
    module.initProfile({
        appState, DOM, auth, db, switchView
    });
    profileModule = module;
    // Llama a la configuración del menú desplegable tan pronto como se cargue el módulo
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
// 🆕 NUEVOS SISTEMAS - GESTIÓN DE ERRORES
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

    show(type, customMessage = null, duration = 5000) {
        const message = customMessage || this.messages[type];
        
        let notification = document.getElementById('error-notification');
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

        notification.classList.add('show', `type-${type}`);

        const timeoutId = setTimeout(() => this.hide(), duration);

        notification.querySelector('.close-notification').onclick = () => {
            clearTimeout(timeoutId);
            this.hide();
        };

        console.error(`[${type.toUpperCase()}]`, message);
    },

    hide() {
        const notification = document.getElementById('error-notification');
        if (notification) notification.classList.remove('show');
    },

    async firebaseOperation(operation, type = this.types.DATABASE) {
        try {
            return await operation();
        } catch (error) {
            console.error('Firebase Error:', error);
            
            if (error.code === 'PERMISSION_DENIED') {
                this.show(this.types.AUTH, 'No tienes permiso para realizar esta acción.');
            } else if (error.code === 'NETWORK_ERROR') {
                this.show(this.types.NETWORK);
            } else {
                this.show(type);
            }
            
            throw error;
        }
    },

    async fetchOperation(url, options = {}) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('Fetch Error:', error);
            if (error.name === 'TypeError') {
                this.show(this.types.NETWORK);
            } else {
                this.show(this.types.CONTENT);
            }
            throw error;
        }
    }
};

// Inyectar estilos de notificaciones
if (!document.getElementById('error-notification-styles')) {
    const errorStyles = document.createElement('style');
    errorStyles.id = 'error-notification-styles';
    errorStyles.textContent = `
        .error-notification {
            position: fixed; top: 80px; right: 20px;
            background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
            color: white; padding: 18px 24px; border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
            display: flex; align-items: center; gap: 15px; z-index: 10000;
            min-width: 320px; max-width: 450px;
            transform: translateX(500px); opacity: 0;
            transition: all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
            border-left: 4px solid var(--primary-red);
        }
        .error-notification.show { transform: translateX(0); opacity: 1; }
        .error-notification i { font-size: 1.5rem; color: var(--primary-red); flex-shrink: 0; }
        .error-notification span { flex-grow: 1; font-size: 0.95rem; line-height: 1.4; }
        .error-notification .close-notification {
            background: transparent; border: none; color: #999;
            font-size: 1.3rem; cursor: pointer; padding: 0;
            width: 24px; height: 24px; display: flex;
            align-items: center; justify-content: center;
            transition: color 0.2s; flex-shrink: 0;
        }
        .error-notification .close-notification:hover { color: white; }
        @media (max-width: 768px) {
            .error-notification {
                top: auto; bottom: 20px; right: 10px; left: 10px;
                min-width: auto; max-width: none;
            }
        }
    `;
    document.head.appendChild(errorStyles);
}

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
        ucm: {},
        seriesEpisodes: {},
        seasonPosters: {},
        metadata: {
            movies: {},
            series: {}
        }
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
        isLoadingMore: false
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
    genreFilter: document.getElementById('genre-filter'),
    sortBy: document.getElementById('sort-by'),
    ucmSortButtonsContainer: document.getElementById('ucm-sort-buttons'),
    ucmSortButtons: document.querySelectorAll('.sort-btn'),
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
    hamburgerBtn: document.getElementById('menu-toggle'),
    mobileNavPanel: document.getElementById('mobile-nav-panel'),
    closeNavBtn: document.querySelector('.close-nav-btn'),
    menuOverlay: document.getElementById('menu-overlay')
};

const API_URL = 'https://script.google.com/macros/s/AKfycbx8g8lWN67cwLf8NrYMg_CTDgxkXCdQDE5sMP_HxaBuHoMe9QntdWKKeMhohZu7rUmZ/exec';
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
    
    // 1. Función interna para procesar y asignar datos al estado
    const processData = (data) => {
        appState.content.movies = data.allMovies || {};
        appState.content.series = data.series || {};
        appState.content.ucm = data.ucm || {}; // <--- IMPORTANTE: Asegúrate de que esto esté aquí
        appState.content.seriesEpisodes = data.episodes || {};
        appState.content.seasonPosters = data.posters || {};
    };

    // 2. Lógica de Renderizado + PRECARGA INTELIGENTE DE IMÁGENES
    const setupAndShow = async (movieMeta, seriesMeta) => {
        appState.content.metadata.movies = movieMeta || {};
        appState.content.metadata.series = seriesMeta || {};

        // A. Generamos HTML y Listeners
        setupHero();
        generateCarousels();
        
        setupEventListeners();
        setupNavigation();
        setupAuthListeners();
        setupSearch();
        setupPageVisibilityHandler();

        // Detectamos qué filtro está activo (Inicio, Pelis o Series)
        const activeFilter = document.querySelector('.main-nav a.active, .mobile-nav a.active')?.dataset.filter || 'all';
        
        // Si es Grid (Pelis/Series/UCM), aplicamos filtro y paginación
        if (activeFilter === 'movie' || activeFilter === 'series' || activeFilter === 'ucm') {
            applyAndDisplayFilters(activeFilter);
        }

        // ============================================================
        // 🚀 FASE DE PRECARGA DE IMÁGENES
        // ============================================================
        
        const imagesToPreload = [];

        // 1. SIEMPRE precargar el Hero (Banner gigante)
        if (appState.ui.heroMovieIds.length > 0) {
            const firstHeroId = appState.ui.heroMovieIds[0];
            const movieData = appState.content.movies[firstHeroId];
            if (movieData) {
                const isMobile = window.innerWidth < 992;
                const heroImgUrl = isMobile ? movieData.poster : movieData.banner;
                imagesToPreload.push(heroImgUrl);
            }
        }

        // 2. Precargar contenido según la vista
        if (activeFilter === 'all') {
            // Si estamos en INICIO: Precargar los carruseles (aprox los primeros 10 de cada uno)
            const topMovies = Object.values(appState.content.movies)
                .sort((a, b) => b.tr - a.tr).slice(0, 8).map(m => m.poster);
            const topSeries = Object.values(appState.content.series)
                .sort((a, b) => b.tr - a.tr).slice(0, 8).map(s => s.poster);
            
            imagesToPreload.push(...topMovies, ...topSeries);

        } else if (activeFilter === 'movie' || activeFilter === 'series' || activeFilter === 'ucm') {
            // Si estamos en GRID: Precargar la PRIMERA PÁGINA
            if (appState.ui.contentToDisplay && appState.ui.contentToDisplay.length > 0) {
                const firstPageItems = appState.ui.contentToDisplay.slice(0, ITEMS_PER_LOAD);
                const pagePosters = firstPageItems.map(([id, item]) => item.poster);
                imagesToPreload.push(...pagePosters);
            }
        }

        // 3. Ejecutar la precarga masiva
        const imagePromises = imagesToPreload.map(url => preloadImage(url));
        
        // 4. Esperar (con límite de seguridad de 5s)
        const minLoadTime = 800; // Estético
        const maxWaitTime = new Promise(resolve => setTimeout(resolve, 5000));

        try {
            await Promise.race([
                Promise.all(imagePromises), 
                maxWaitTime
            ]);
            console.log(`✓ Precargadas ${imagesToPreload.length} imágenes críticas.`);
        } catch (e) { 
            console.warn("La precarga de imágenes tardó demasiado, mostrando web de todos modos."); 
        }

        // ============================================================

        // B. Calculamos tiempo estético restante
        const timeElapsed = Date.now() - startLoadTime;
        const remainingTime = Math.max(0, minLoadTime - timeElapsed);
        await new Promise(r => setTimeout(r, remainingTime));

        // C. Transición de entrada
        requestAnimationFrame(() => {
            if (DOM.pageWrapper) DOM.pageWrapper.style.display = 'block';
            
            setTimeout(() => {
                if (DOM.pageWrapper) DOM.pageWrapper.classList.add('visible'); 
                if (DOM.preloader) DOM.preloader.classList.add('fade-out');
            }, 50);

            setTimeout(() => {
                if(DOM.preloader) DOM.preloader.remove();
            }, 800); 
        });
    };

    // --- OBTENCIÓN DE DATOS (CACHÉ VS RED) ---
    const cachedContent = cacheManager.get(cacheManager.keys.content);
    const cachedMetadata = cacheManager.get(cacheManager.keys.metadata);

    if (cachedContent) {
        console.log('✓ Iniciando desde caché...');
        processData(cachedContent);
        await setupAndShow(cachedMetadata?.movies, cachedMetadata?.series);
        refreshDataInBackground(); 
        
        // Cargar historial si hay usuario
        const user = auth.currentUser;
        if (user) {
            db.ref(`users/${user.uid}/history`).orderByChild('viewedAt').once('value', snapshot => {
                if (snapshot.exists()) {
                    generateContinueWatchingCarousel(snapshot);
                }
            });
        }
    } else {
        try {
            console.log('⟳ Descargando base de datos...');
            
            // 🔥 AQUÍ ESTABA EL ERROR: Asegúrate de tener 'ucmData' en la lista de la izquierda
            const [series, episodes, allMovies, posters, ucmData, movieMeta, seriesMeta] = await Promise.all([
                ErrorHandler.fetchOperation(`${API_URL}?data=series`),
                ErrorHandler.fetchOperation(`${API_URL}?data=episodes`),
                ErrorHandler.fetchOperation(`${API_URL}?data=allMovies&order=desc`),
                ErrorHandler.fetchOperation(`${API_URL}?data=PostersTemporadas`),
                ErrorHandler.fetchOperation(`${API_URL}?data=ucm`), // <--- Esta petición llena la variable ucmData
                db.ref('movie_metadata').once('value').then(s => s.val() || {}),
                db.ref('series_metadata').once('value').then(s => s.val() || {})
            ]);

            // 🔥 Ahora sí podemos usar 'ucmData' aquí sin que de error
            const freshContent = { allMovies, series, episodes, posters, ucm: ucmData };
            const freshMetadata = { movies: movieMeta, series: seriesMeta };

            processData(freshContent);
            cacheManager.set(cacheManager.keys.content, freshContent);
            cacheManager.set(cacheManager.keys.metadata, freshMetadata);

            await setupAndShow(freshMetadata.movies, freshMetadata.series);
            
            const user = auth.currentUser;
            if (user) {
                db.ref(`users/${user.uid}/history`).orderByChild('viewedAt').once('value', snapshot => {
                    if (snapshot.exists()) {
                        generateContinueWatchingCarousel(snapshot);
                    }
                });
            }

        } catch (error) {
            console.error('✗ Error crítico:', error);
            if (DOM.preloader) DOM.preloader.innerHTML = `<div style="text-align: center; color: white;"><p>Error de conexión</p><button onclick="location.reload()" class="btn-primary">Reintentar</button></div>`;
        }
    }
}

async function refreshDataInBackground() {
    try {
        // 🔥 AQUÍ TAMBIÉN: Agregamos 'ucmData' en la izquierda y la petición 'ucm' en la derecha
        const [series, episodes, allMovies, posters, ucmData] = await Promise.all([
            ErrorHandler.fetchOperation(`${API_URL}?data=series`),
            ErrorHandler.fetchOperation(`${API_URL}?data=episodes`),
            ErrorHandler.fetchOperation(`${API_URL}?data=allMovies&order=desc`),
            ErrorHandler.fetchOperation(`${API_URL}?data=PostersTemporadas`),
            ErrorHandler.fetchOperation(`${API_URL}?data=ucm`)
        ]);
        
        const freshContent = { allMovies, series, episodes, posters, ucm: ucmData };
        cacheManager.set(cacheManager.keys.content, freshContent);
        console.log('✓ Caché actualizada en segundo plano');
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

async function handleFilterClick(event) { // 🆕 Convertida en 'async'
    const link = event.target.closest('a');
    if (!link) return;
    event.preventDefault();

    DOM.mobileNavPanel?.classList.remove('is-open');
    DOM.menuOverlay?.classList.remove('active');
    
    const filter = link.dataset.filter;
    
    // 🆕 CARGA BAJO DEMANDA DE RULETA
    if (filter === 'roulette') {
        const roulette = await getRouletteModule();
        roulette.openRouletteModal();
        return;
    }

    if (link.classList.contains('active') && !['history', 'my-list'].includes(filter)) return;

    document.querySelectorAll('.main-nav a, .mobile-nav a, .bottom-nav a').forEach(l => l.classList.remove('active'));
    document.querySelectorAll(`a[data-filter="${filter}"]`).forEach(l => l.classList.add('active'));
    
    DOM.searchInput.value = '';
    switchView(filter);
}

async function switchView(filter) { // 🆕 Convertida en 'async'
    [
        DOM.heroSection, DOM.carouselContainer, DOM.gridContainer,
        DOM.myListContainer, DOM.historyContainer, DOM.profileContainer,
        DOM.settingsContainer, document.getElementById('profile-hub-container')
    ].forEach(container => {
        if (container) container.style.display = 'none';
    });

    if (DOM.filterControls) DOM.filterControls.style.display = 'none';

    if (filter === 'all') {
        if(DOM.heroSection) DOM.heroSection.style.display = 'flex';
        if(DOM.carouselContainer) DOM.carouselContainer.style.display = 'block';
    } else if (filter === 'movie' || filter === 'series' || filter === 'ucm') {
        if (DOM.gridContainer) DOM.gridContainer.style.display = 'block';
        if (DOM.filterControls) DOM.filterControls.style.display = 'flex';
        populateFilters(filter);
        applyAndDisplayFilters(filter);
    } else if (filter === 'my-list') {
        if (DOM.myListContainer) { DOM.myListContainer.style.display = 'block'; displayMyListView(); }
    } else if (filter === 'history') {
        if (DOM.historyContainer) { DOM.historyContainer.style.display = 'block'; renderHistory(); }
    } else if (filter === 'profile-hub') {
        const hubContainer = document.getElementById('profile-hub-container');
        if (hubContainer) {
            hubContainer.style.display = 'block';
            const user = auth.currentUser;
            if (user) {
                const emailEl = document.getElementById('profile-hub-email');
                if(emailEl) emailEl.textContent = user.email;
            }
        }
    } else if (filter === 'profile') {
        // 🆕 CARGA BAJO DEMANDA DE PERFIL
        const profile = await getProfileModule();
        if (DOM.profileContainer) { DOM.profileContainer.style.display = 'block'; profile.renderProfile(); }
    } else if (filter === 'settings') {
        // 🆕 CARGA BAJO DEMANDA DE AJUSTES
        const profile = await getProfileModule();
        if (DOM.settingsContainer) { DOM.settingsContainer.style.display = 'block'; profile.renderSettings(); }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function populateFilters(type) {
    let sourceData;
    if (type === 'movie') sourceData = appState.content.movies;
    else if (type === 'series') sourceData = appState.content.series;
    else if (type === 'ucm') sourceData = appState.content.ucm;

    if (!DOM.genreFilter || !DOM.sortBy || !sourceData) return;

    // Referencias DOM
    const genreVisual = document.getElementById('genre-dropdown-visual');
    const genreList = document.getElementById('genre-menu-list');
    const genreTrigger = document.getElementById('genre-trigger');
    const sortVisual = document.getElementById('sort-dropdown-visual');
    const sortList = document.getElementById('sort-menu-list');
    const sortTrigger = document.getElementById('sort-trigger');

    if (!genreList || !genreVisual) return;

    // Control Visibilidad
    if (type === 'ucm') {
        if (sortVisual) sortVisual.style.display = 'none';
        if (DOM.ucmSortButtonsContainer) DOM.ucmSortButtonsContainer.style.display = 'flex';
        if (DOM.ucmSortButtons) {
            DOM.ucmSortButtons.forEach(btn => {
                btn.onclick = (e) => {
                    DOM.ucmSortButtons.forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    applyAndDisplayFilters('ucm');
                };
            });
        }
    } else {
        if (sortVisual) sortVisual.style.display = 'block';
        if (DOM.ucmSortButtonsContainer) DOM.ucmSortButtonsContainer.style.display = 'none';
    }

    // Función Auxiliar
    const createItem = (value, label, menuType, isGroup = false, imgUrl = null) => {
        const div = document.createElement('div');
        
        if (isGroup) {
            div.className = 'dropdown-group-title';
            if (imgUrl) {
                div.innerHTML = `<img src="${imgUrl}" class="dropdown-group-logo" alt="${label}">`;
                div.classList.add('has-logo');
            } else {
                div.textContent = label;
            }
        } else {
            div.className = 'dropdown-item';
            div.textContent = label;
        }

        if (!isGroup || (isGroup && value)) {
            div.onclick = () => {
                if (menuType === 'genre') {
                    const liveGenreText = document.getElementById('genre-text');
                    if (liveGenreText) liveGenreText.textContent = imgUrl ? label : (div.textContent || label);
                    
                    DOM.genreFilter.value = value; 
                    genreVisual.classList.remove('open');
                } else {
                    const liveSortText = document.getElementById('sort-text');
                    if (liveSortText) liveSortText.textContent = label;
                    DOM.sortBy.value = value;
                    if (sortVisual) sortVisual.classList.remove('open');
                }
                
                const parentList = menuType === 'genre' ? genreList : sortList;
                if (parentList) {
                    parentList.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('selected'));
                    if (!isGroup) div.classList.add('selected');
                }
                
                applyAndDisplayFilters(type);
            };
        }
        return div;
    };

    genreList.innerHTML = '';
    DOM.genreFilter.innerHTML = `<option value="all">Todos</option>`; 

    if (type === 'ucm') {
        const fasesRaw = Object.values(sourceData)
            .map(item => String(item.fase || '').trim())
            .filter(f => f !== '' && f !== 'undefined' && f !== 'null');
        const fasesDisponibles = new Set(fasesRaw);

        genreList.appendChild(createItem('all', 'Todas las Fases', 'genre'));

        const estructuraSagas = [
            { 
                id: 'saga_infinity', 
                titulo: "Saga del Infinito", 
                img: "https://res.cloudinary.com/djhgmmdjx/image/upload/v1764056286/InfinitySaga2_t3ixis.svg",
                fases: ['1', '2', '3'] 
            },
            { 
                id: 'saga_multiverse', 
                titulo: "Saga del Multiverso", 
                img: "https://res.cloudinary.com/djhgmmdjx/image/upload/v1764056259/MultiverseSaga2_waggse.svg",
                fases: ['4', '5', '6'] 
            },
            { 
                id: 'saga_mutant', 
                titulo: "Otros Universos", 
                img: null,
                fases: ['98', '99'] 
            }
        ];

        estructuraSagas.forEach(saga => {
            const fasesEnGrupo = saga.fases.filter(f => fasesDisponibles.has(f));
            if (fasesEnGrupo.length > 0) {
                // 1. Crear el elemento visual del grupo
                genreList.appendChild(createItem(saga.id, saga.titulo, 'genre', true, saga.img));
                
                // 🔥 FIX CRÍTICO: REGISTRAR LA SAGA EN EL SELECT OCULTO
                // Sin esto, DOM.genreFilter.value = 'saga_infinity' no funciona
                DOM.genreFilter.innerHTML += `<option value="${saga.id}">${saga.titulo}</option>`;

                fasesEnGrupo.forEach(faseNum => {
                    let label = `Fase ${faseNum}`;
                    if (faseNum === '98') label = 'Deadpool (2016)';
                    if (faseNum === '99') label = 'Deadpool 2 (2018)';
                    
                    genreList.appendChild(createItem(faseNum, label, 'genre'));
                    DOM.genreFilter.innerHTML += `<option value="${faseNum}">${label}</option>`;
                });
            }
        });
        
        const todasLasDefinidas = new Set(estructuraSagas.flatMap(s => s.fases));
        const huerfanas = [...fasesDisponibles].filter(f => !todasLasDefinidas.has(f));
        if (huerfanas.length > 0) {
            genreList.appendChild(createItem(null, "Otras Fases", 'genre', true));
            huerfanas.sort().forEach(f => {
                genreList.appendChild(createItem(f, `Fase ${f}`, 'genre'));
                DOM.genreFilter.innerHTML += `<option value="${f}">Fase ${f}</option>`;
            });
        }
        
        const currentText = document.getElementById('genre-text');
        if(currentText) currentText.textContent = "Todas las Fases";

    } else {
        // MODO NORMAL
        const genres = new Set(Object.values(sourceData).flatMap(item => item.genres ? String(item.genres).split(';').map(g => g.trim()).filter(Boolean) : []));
        genreList.appendChild(createItem('all', 'Todos los géneros', 'genre'));
        Array.from(genres).sort().forEach(genre => {
            genreList.appendChild(createItem(genre, genre, 'genre'));
            DOM.genreFilter.innerHTML += `<option value="${genre}">${genre}</option>`;
        });
        const currentText = document.getElementById('genre-text');
        if(currentText) currentText.textContent = "Todos los géneros";
    }

    // ORDENAR
    if (type !== 'ucm' && sortList) {
        sortList.innerHTML = '';
        DOM.sortBy.innerHTML = '';
        const sortOptions = [
            { val: 'recent', label: 'Recientes' },
            { val: 'title-asc', label: 'Título (A - Z)' },
            { val: 'title-desc', label: 'Título (Z - A)' },
            { val: 'year-desc', label: 'Año (Descendente)' },
            { val: 'year-asc', label: 'Año (Ascendente)' }
        ];
        sortOptions.forEach(opt => {
            sortList.appendChild(createItem(opt.val, opt.label, 'sort'));
            DOM.sortBy.innerHTML += `<option value="${opt.val}">${opt.label}</option>`;
        });
        const currentSortText = document.getElementById('sort-text');
        if(currentSortText) currentSortText.textContent = 'Recientes';
    }

    // EVENTOS
    if (genreTrigger) {
        const newGenreTrigger = genreTrigger.cloneNode(true);
        genreTrigger.parentNode.replaceChild(newGenreTrigger, genreTrigger);
        newGenreTrigger.onclick = (e) => {
            e.stopPropagation();
            if (sortVisual) sortVisual.classList.remove('open');
            genreVisual.classList.toggle('open');
        };
    }
    if (sortTrigger && type !== 'ucm') {
        const newSortTrigger = sortTrigger.cloneNode(true);
        sortTrigger.parentNode.replaceChild(newSortTrigger, sortTrigger);
        newSortTrigger.onclick = (e) => {
            e.stopPropagation();
            if (genreVisual) genreVisual.classList.remove('open');
            sortVisual.classList.toggle('open');
        };
    }
    document.onclick = (e) => {
        if (genreVisual && !genreVisual.contains(e.target)) genreVisual.classList.remove('open');
        if (sortVisual && !sortVisual.contains(e.target)) sortVisual.classList.remove('open');
    };
}

async function applyAndDisplayFilters(type) {
    // 1. Selección de Fuente
    let sourceData;
    if (type === 'movie') sourceData = appState.content.movies;
    else if (type === 'series') sourceData = appState.content.series;
    else if (type === 'ucm') sourceData = appState.content.ucm;

    const gridEl = DOM.gridContainer.querySelector('.grid');
    if (!gridEl || !sourceData) return;

    // 2. Detectar Criterio
    let sortByValue;
    const selectedFilterValue = DOM.genreFilter.value;

    if (type === 'ucm') {
        const activeBtn = document.querySelector('.sort-btn.active');
        sortByValue = activeBtn ? activeBtn.dataset.sort : 'release';
    } else {
        sortByValue = DOM.sortBy.value;
    }

    // 3. Texto de Carga
    gridEl.innerHTML = `
        <div style="width: 100%; height: 60vh; display: flex; justify-content: center; align-items: center; grid-column: 1 / -1;">
            <div class="loading-text">Cargando...</div>
        </div>`;

    let content = Object.entries(sourceData);

    // 4. Filtrar datos (Fases / Géneros)
    if (selectedFilterValue !== 'all') {
        if (type === 'ucm') {
            content = content.filter(([id, item]) => {
                const faseRaw = String(item.fase || '').trim();
                const faseNum = faseRaw.replace(/\D/g, ''); 

                if (selectedFilterValue === 'saga_infinity') return ['1', '2', '3'].includes(faseNum);
                if (selectedFilterValue === 'saga_multiverse') return ['4', '5', '6'].includes(faseNum);
                if (selectedFilterValue === 'saga_mutant') return ['98', '99'].includes(faseNum);
                
                return faseNum === selectedFilterValue || faseRaw === selectedFilterValue;
            });
        } else {
            // Filtro de géneros (Seguro contra mayúsculas)
            content = content.filter(([id, item]) => 
                String(item.genres || '').toLowerCase().includes(selectedFilterValue.toLowerCase())
            );
        }
    }

    // ============================================================
    // 5. ORDENAMIENTO (BLINDADO)
    // ============================================================
    content.sort((a, b) => {
        const aData = a[1];
        const bData = b[1];

        // Helpers para limpiar datos antes de comparar
        const getTitle = (item) => String(item.title || '').toLowerCase().trim();
        const getYear = (item) => Number(item.year) || 0;
        const getChrono = (item) => Number(item.cronologia) || 999;

        switch (sortByValue) {
            // --- LÓGICA UCM ---
            case 'chronological':
                return getChrono(aData) - getChrono(bData);
            
            case 'release': 
                const yearDiff = getYear(aData) - getYear(bData);
                if (yearDiff === 0) return getChrono(aData) - getChrono(bData);
                return yearDiff;

            // --- LÓGICA PELÍCULAS / SERIES ---
            case 'recent': 
                // Intenta usar 'tr' (timestamp), si no existe, usa ID (orden de agregado) o Año
                if (bData.tr && aData.tr) return bData.tr - aData.tr;
                return getYear(bData) - getYear(aData); // Fallback: Año descendente

            case 'title-asc':
                return getTitle(aData).localeCompare(getTitle(bData));

            case 'title-desc':
                return getTitle(bData).localeCompare(getTitle(aData));

            case 'year-desc':
                return getYear(bData) - getYear(aData);

            case 'year-asc':
                return getYear(aData) - getYear(bData);

            default: 
                // Por defecto, lo más nuevo primero
                return getYear(bData) - getYear(aData);
        }
    });

    // --- LÓGICA DE DESGLOSE TEMPORADAS (Solo UCM Cronológico) ---
    if (type === 'ucm' && sortByValue === 'chronological') {
        const expandedContent = [];
        content.forEach(([id, item]) => {
            const multiChrono = item.cronologiaMulti || item.cronologia_multi; 
            if (multiChrono) {
                const t1 = { ...item }; 
                t1.title = `${item.title} (T1)`;
                expandedContent.push([id, t1]); 

                const extraChronos = String(multiChrono).split(',').map(c => c.trim());
                extraChronos.forEach((chronoVal, index) => {
                    const seasonNum = index + 2;
                    const tNext = { ...item };
                    tNext.title = `${item.title} (T${seasonNum})`;
                    tNext.cronologia = chronoVal; 
                    expandedContent.push([id, tNext]); 
                });
            } else {
                expandedContent.push([id, item]);
            }
        });
        // Volvemos a ordenar porque los clones se añadieron al final
        expandedContent.sort((a, b) => (Number(a[1].cronologia)||999) - (Number(b[1].cronologia)||999));
        content = expandedContent;
    }
    
    // 6. Renderizar
    appState.ui.contentToDisplay = content;
    appState.ui.currentIndex = 0; 
    setupPaginationControls();

    const firstPageItems = content.slice(0, ITEMS_PER_LOAD);
    const imagePromises = firstPageItems.map(([id, item]) => preloadImage(item.poster));

    try {
        await Promise.race([Promise.all(imagePromises), new Promise(r => setTimeout(r, 2000))]);
    } catch (e) {}

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

    const titleEl = document.createElement('h2');
    titleEl.classList.add('carousel-title');
    titleEl.textContent = title;
    section.appendChild(titleEl);

    const track = document.createElement('div');
    track.classList.add('carousel-track');

    Object.entries(dataSource)
        .sort((a, b) => b[1].tr - a[1].tr)
        .slice(0, 8)
        .forEach(([id, item]) => {
            const type = title.includes('Serie') ? 'series' : 'movie';
            // Pasamos lazy=false porque el carrusel carga pocas imágenes (8) 
            // y queremos que se vean nítidas cuanto antes.
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
    document.querySelectorAll('.modal.show').forEach(modal => {
        modal.classList.remove('show');
        const iframe = modal.querySelector('iframe');
        if (iframe) iframe.src = '';
    });
    document.body.classList.remove('modal-open');
}

async function openDetailsModal(id, type, triggerElement = null) {
    try {
        const modal = DOM.detailsModal;
        const panel = modal.querySelector('.details-panel'); 
        
        const detailsPoster = document.getElementById('details-poster-img');
        const detailsTitle = document.getElementById('details-title');
        const detailsYear = document.getElementById('details-year');
        const detailsGenres = document.getElementById('details-genres');
        const detailsSynopsis = document.getElementById('details-synopsis');
        const detailsButtons = document.getElementById('details-buttons');

        // =========================================================
        // 1. CORRECCIÓN DE BÚSQUEDA DE DATOS (Soporte UCM)
        // =========================================================
        let data;
        
        // Primero intentamos buscar según el tipo que nos llega
        if (type === 'movie') data = appState.content.movies[id];
        else if (type === 'series') data = appState.content.series[id];
        else if (type === 'ucm') data = appState.content.ucm ? appState.content.ucm[id] : undefined;

        // 🔥 FIX CRÍTICO: Si no se encontró, buscamos OBLIGATORIAMENTE en UCM
        // Esto arregla el error cuando la grilla dice que es "movie" pero la data vive en "ucm"
        if (!data && appState.content.ucm && appState.content.ucm[id]) {
            data = appState.content.ucm[id];
        }

        // Fallback final: Buscar en cualquier lado si aun no aparece
        if (!data) {
            if (appState.content.movies[id]) { data = appState.content.movies[id]; type = 'movie'; }
            else if (appState.content.series[id]) { data = appState.content.series[id]; type = 'series'; }
        }

        if (!data) {
            ErrorHandler.show('content', 'No se pudo cargar la información del título.');
            return;
        }

        // =========================================================
        // 2. DETERMINAR SI ES CONTENIDO DE SERIE O PELÍCULA
        // =========================================================
        // Verificamos si es serie explícitamente O si es del UCM marcado como serie O si tiene episodios
        const isSeriesContent = type === 'series' || 
                                (data.type === 'series') || 
                                (appState.content.seriesEpisodes[id]);

        detailsButtons.innerHTML = '';
        detailsPoster.src = data.poster || '';
        
        if (data.banner && data.banner.trim() !== '') {
            panel.style.backgroundImage = `url(${data.banner})`;
        } else {
            panel.style.backgroundImage = 'none';
            panel.style.backgroundColor = '#181818';
        }
        
        detailsTitle.textContent = data.title || 'Sin título';
        detailsYear.textContent = data.year ? `(${data.year})` : '';
        detailsGenres.textContent = data.genres || '';
        detailsSynopsis.textContent = data.synopsis || 'Sin descripción disponible.';

        // 3. Botón Mi Lista (Watchlist)
        let listBtn = null; 
        const user = auth.currentUser;
        if (user) {
            const isInList = appState.user.watchlist.has(id);
            listBtn = document.createElement('button');
            listBtn.className = `btn btn-watchlist ${isInList ? 'in-list' : ''}`;
            listBtn.dataset.contentId = id;
            listBtn.innerHTML = `<i class="fas ${isInList ? 'fa-check' : 'fa-plus'}"></i>`; 
            listBtn.addEventListener('click', () => handleWatchlistClick(listBtn));
        }

        // 4. Botón Ver Ahora (Play)
        const playBtn = document.createElement('button');
        playBtn.className = 'btn btn-play';
        playBtn.innerHTML = `<i class="fas fa-play"></i> Ver ahora`;
        playBtn.addEventListener('click', async () => { 
            closeAllModals();
            const player = await getPlayerModule();
            
            if (isSeriesContent) {
                // Si es serie (o serie de Marvel), abrir Player de Series
                player.openSeriesPlayer(id, false);
            } else {
                // Si es película (o peli de Marvel), abrir Player de Películas
                // Pasamos el título para que aparezca en el reproductor
                player.openPlayerModal(id, data.title); 
            }
        });
        detailsButtons.appendChild(playBtn);

        // 5. Botones específicos de Series (Temporadas y Aleatorio)
        if (isSeriesContent) {
            const seriesEpisodes = appState.content.seriesEpisodes[id] || {};
            const seasonCount = Object.keys(seriesEpisodes).length;
            
            // Botón "Temporadas" si hay más de una
            if (seasonCount > 1) { 
                const infoBtn = document.createElement('button');
                infoBtn.className = 'btn btn-info';
                infoBtn.innerHTML = `<i class="fas fa-tv"></i> Temporadas`;
                infoBtn.addEventListener('click', async () => { 
                    closeAllModals();
                    const player = await getPlayerModule();
                    player.openSeriesPlayer(id, true);
                });
                detailsButtons.appendChild(infoBtn);
            }

            // Botón "Aleatorio"
            if (data.random?.toLowerCase() === 'sí') {
                const randomBtn = document.createElement('button');
                randomBtn.className = 'btn btn-random'; 
                randomBtn.innerHTML = `🎲 Aleatorio`;
                randomBtn.addEventListener('click', async () => { 
                    const player = await getPlayerModule();
                    player.playRandomEpisode(id)
                });
                detailsButtons.appendChild(randomBtn);
            }
        }

        // Agregar botón de lista al final
        if (listBtn) {
            detailsButtons.appendChild(listBtn);
        }

        modal.classList.add('show');
        document.body.classList.add('modal-open');

        const closeBtn = modal.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.onclick = () => {
                modal.classList.remove('show');
                document.body.classList.remove('modal-open');
            };
        }
    } catch (error) {
        console.error('Error en openDetailsModal:', error);
        ErrorHandler.show('content', 'Ocurrió un error al abrir los detalles.');
    }
}

// ===========================================================
// 6. AUTENTICACIÓN Y DATOS DE USUARIO
// ===========================================================
function setupAuthListeners() {
    if (DOM.loginBtnHeader) DOM.loginBtnHeader.addEventListener('click', () => openAuthModal(true));
    if (DOM.registerBtnHeader) DOM.registerBtnHeader.addEventListener('click', () => openAuthModal(false));

    if (DOM.switchAuthModeLink) {
        DOM.switchAuthModeLink.addEventListener('click', (e) => {
            e.preventDefault();
            const isLoginVisible = DOM.loginForm.style.display === 'flex' || DOM.loginForm.style.display === '';
            openAuthModal(!isLoginVisible);
        });
    }

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

    auth.onAuthStateChanged(updateUIAfterAuthStateChange);

    if (DOM.historyContainer) {
        DOM.historyContainer.addEventListener('click', (event) => {
            const removeButton = event.target.closest('.btn-remove-history');
            if (removeButton) {
                event.stopPropagation();
                const entryKey = removeButton.dataset.key;
                openConfirmationModal(
                    'Eliminar del Historial',
                    '¿Estás seguro de que quieres eliminar este item de tu historial? Esta acción no se puede deshacer.',
                    () => removeFromHistory(entryKey)
                );
            }
        });
    }

    const logoutBtnHub = document.getElementById('logout-btn-hub');
    if (logoutBtnHub) {
        logoutBtnHub.addEventListener('click', (e) => {
            e.preventDefault();
            auth.signOut();
        });
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

    if (user) {
        loggedInElements.forEach(el => el && (el.style.display = 'flex'));
        loggedOutElements.forEach(el => el && (el.style.display = 'none'));
        const userName = user.displayName || user.email.split('@')[0];
        if (DOM.userGreetingBtn) DOM.userGreetingBtn.textContent = `Hola, ${userName}`;
        
        db.ref(`users/${user.uid}/watchlist`).once('value', snapshot => {
            appState.user.watchlist = snapshot.exists() ? new Set(Object.keys(snapshot.val())) : new Set();
        });

        setupRealtimeHistoryListener(user);
        
        // 🆕 Carga el módulo de perfil/menú en background si el usuario inicia sesión
        getProfileModule();

    } else {
        loggedInElements.forEach(el => el && (el.style.display = 'none'));
        loggedOutElements.forEach(el => el && (el.style.display = 'flex'));
        appState.user.watchlist.clear();
        
        if (appState.user.historyListenerRef) {
            appState.user.historyListenerRef.off('value');
            appState.user.historyListenerRef = null;
        }
        
        const continueWatchingCarousel = document.getElementById('continue-watching-carousel');
        if (continueWatchingCarousel) continueWatchingCarousel.remove();
    }
    
    const activeFilter = document.querySelector('.main-nav a.active, .mobile-nav a.active')?.dataset.filter;
    if (!user && (activeFilter === 'my-list' || activeFilter === 'history')) {
        document.querySelectorAll('.main-nav a, .mobile-nav a').forEach(l => l.classList.remove('active'));
        document.querySelectorAll(`a[data-filter="all"]`).forEach(l => l.classList.add('active'));
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

// ===========================================================
// 8. FUNCIONES DE UTILIDAD Y HELPERS
// ===========================================================
function createMovieCardElement(id, data, type, layout = 'carousel', lazy = false, options = {}) {
    const card = document.createElement('div');
    card.className = `movie-card ${layout === 'carousel' ? 'carousel-card' : ''}`;
    card.dataset.contentId = id;

    card.onclick = (e) => {
        if (e.target.closest('.btn-watchlist') || e.target.closest('.btn-remove-history')) return;
        
        // Si es una serie clonada (T2, T3...) abrimos directamente esa temporada
        // Detectamos si el título termina en (TX)
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

    // --- LÓGICA DE IMAGEN (MEJORADA PARA TEMPORADAS) ---
    let imageUrl = data.poster;

    // Si es una serie clonada en la vista cronológica (Ej: Loki (T2))
    // intentamos buscar su póster específico en seasonPosters
    const seasonMatch = data.title.match(/\(T(\d+)\)$/);
    if (seasonMatch && appState.content.seasonPosters[id]) {
        const seasonNum = seasonMatch[1];
        // Buscamos si existe póster para esa temporada
        if (appState.content.seasonPosters[id][seasonNum]) {
            imageUrl = appState.content.seasonPosters[id][seasonNum];
        }
    }

    const img = new Image();
    img.onload = () => {
        const imgContainer = card.querySelector('.img-container-placeholder');
        if(imgContainer) imgContainer.replaceWith(img);
        card.classList.add('img-loaded');
    };

    img.onerror = () => {
        card.style.display = 'none'; 
        console.warn(`Imagen rota para: ${data.title}`);
    };

    img.src = imageUrl; 
    img.alt = data.title;

    card.innerHTML = `
        <div class="img-container-placeholder"></div>
        ${watchlistBtnHTML}
    `;

    return card;
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
