// ===========================================================
// CINE CORNETA - SCRIPT PRINCIPAL (MODULAR)
// Versión: 5.0.0 (Optimizada)
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

    // Función para procesar los datos principales
    const processData = (data) => {
        appState.content.movies = data.allMovies || {};
        appState.content.series = data.series || {};
        appState.content.seriesEpisodes = data.episodes || {};
        appState.content.seasonPosters = data.posters || {};
        
        // Procesamos la lista de sagas
        appState.content.sagasList = Object.values(data.sagas_list || {});
        
        // 🔥 MAGIA DINÁMICA: Asignamos el contenido de cada saga a su ID
        // Si data.ucm existe, se guarda en appState.content.sagas.ucm
        if (appState.content.sagasList.length > 0) {
            appState.content.sagasList.forEach(saga => {
                if (data[saga.id]) {
                    appState.content.sagas[saga.id] = data[saga.id];
                }
            });
        }
    };

    // Función de renderizado (Igual que antes)
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

        const activeFilter = document.querySelector('.main-nav a.active, .mobile-nav a.active')?.dataset.filter || 'all';
        
        // Verificamos si el filtro activo es una de nuestras sagas dinámicas
        const isSaga = appState.content.sagas[activeFilter];

        if (['movie', 'series'].includes(activeFilter) || isSaga) {
            applyAndDisplayFilters(activeFilter);
        } else if (activeFilter === 'sagas') {
            switchView('sagas');
        }

        // TRANSICIÓN DE ENTRADA
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

    // --- CARGA DE DATOS ---
    const cachedContent = cacheManager.get(cacheManager.keys.content);
    const cachedMetadata = cacheManager.get(cacheManager.keys.metadata);

    if (cachedContent) {
        console.log('✓ Iniciando desde caché...');
        processData(cachedContent);
        await setupAndShow(cachedMetadata?.movies, cachedMetadata?.series);
        refreshDataInBackground(); 
        
        // Historial
        const user = auth.currentUser;
        if (user) {
            db.ref(`users/${user.uid}/history`).orderByChild('viewedAt').once('value', snapshot => {
                if (snapshot.exists()) generateContinueWatchingCarousel(snapshot);
            });
        }
    } else {
        try {
            console.log('⟳ Descargando base de datos inteligente...');
            
            // 1. CARGA INICIAL: Estructura base + LISTA DE SAGAS
            const [series, episodes, allMovies, posters, sagasListData, movieMeta, seriesMeta] = await Promise.all([
                ErrorHandler.fetchOperation(`${API_URL}?data=series`),
                ErrorHandler.fetchOperation(`${API_URL}?data=episodes`),
                ErrorHandler.fetchOperation(`${API_URL}?data=allMovies&order=desc`),
                ErrorHandler.fetchOperation(`${API_URL}?data=PostersTemporadas`),
                ErrorHandler.fetchOperation(`${API_URL}?data=sagas_list`), // Pedimos la lista primero
                db.ref('movie_metadata').once('value').then(s => s.val() || {}),
                db.ref('series_metadata').once('value').then(s => s.val() || {})
            ]);

            // 2. CARGA DINÁMICA DE SAGAS
            // Usamos la lista descargada para saber qué más pedir
            const sagasArray = Object.values(sagasListData || {});
            const sagasRequests = sagasArray.map(saga => 
                ErrorHandler.fetchOperation(`${API_URL}?data=${saga.id}`)
                .then(data => ({ id: saga.id, data: data })) // Retornamos ID y datos juntos
            );

            // Esperamos a que lleguen todas las sagas
            const sagasResults = await Promise.all(sagasRequests);

            // 3. ARMADO DEL PAQUETE FINAL
            const freshContent = { 
                allMovies, series, episodes, posters, 
                sagas_list: sagasListData 
            };

            // Inyectamos cada saga en el paquete content
            sagasResults.forEach(item => {
                freshContent[item.id] = item.data;
            });
            
            const freshMetadata = { movies: movieMeta, series: seriesMeta };

            processData(freshContent);
            cacheManager.set(cacheManager.keys.content, freshContent);
            cacheManager.set(cacheManager.keys.metadata, freshMetadata);

            await setupAndShow(freshMetadata.movies, freshMetadata.series);
            
            // Historial
            const user = auth.currentUser;
            if (user) {
                db.ref(`users/${user.uid}/history`).orderByChild('viewedAt').once('value', snapshot => {
                    if (snapshot.exists()) generateContinueWatchingCarousel(snapshot);
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

    if (!DOM.genreFilter || !DOM.sortBy || !sourceData) return;

    const genreVisual = document.getElementById('genre-dropdown-visual');
    const sortVisual = document.getElementById('sort-dropdown-visual');
    const ucmButtons = document.getElementById('ucm-sort-buttons');
    const controlsContainer = document.getElementById('filter-controls');
    
    if (controlsContainer) controlsContainer.style.display = 'flex';

    // CONFIGURACIÓN VISIBILIDAD
    const sagaConfig = appState.content.sagasList.find(s => s.id === type);
    const mode = String(sagaConfig ? (sagaConfig.filters || 'si') : 'si').toLowerCase().trim();

    // Reset
    if (genreVisual) genreVisual.style.display = 'block';
    
    // CASO "NO"
    if (mode === 'no') {
        if (genreVisual) genreVisual.style.display = 'none';
        if (sortVisual) sortVisual.style.display = 'none';
        if (ucmButtons) ucmButtons.style.display = 'none';
        return; 
    }

    // CASO "BOTONES"
    if (mode === 'botones') {
        if (genreVisual) genreVisual.style.display = 'none';
        DOM.genreFilter.value = 'all'; 
    }

    // GENERAR MENÚS
    const genreList = document.getElementById('genre-menu-list');
    const sortList = document.getElementById('sort-menu-list');
    
    const createItem = (value, label, menuType, isGroup = false, imgUrl = null) => {
        const div = document.createElement('div');
        div.className = isGroup ? 'dropdown-group-title' : 'dropdown-item';
        
        if (isGroup && imgUrl) {
            div.innerHTML = `<img src="${imgUrl}" class="dropdown-group-logo" alt="${label}">`;
            div.classList.add('has-logo');
        } else {
            div.textContent = label;
        }

        if (isGroup && value) div.style.cursor = "pointer";

        div.onclick = (e) => {
            e.stopPropagation(); 
            if (menuType === 'genre') {
                document.getElementById('genre-text').textContent = label; 
                DOM.genreFilter.value = value; 
                genreVisual.classList.remove('open');
            } else {
                document.getElementById('sort-text').textContent = label;
                DOM.sortBy.value = value;
                if (sortVisual) sortVisual.classList.remove('open');
            }
            applyAndDisplayFilters(type);
        };
        return div;
    };

    if (mode !== 'botones') {
        genreList.innerHTML = '';
        DOM.genreFilter.innerHTML = `<option value="all">Todos</option>`; 
    }

    // --- MARVEL / STAR WARS ---
    if (type === 'ucm' || type === 'starwars') {
        if (mode !== 'botones' && type === 'ucm') {
            const fasesRaw = Object.values(sourceData).map(item => String(item.fase || '').trim()).filter(Boolean);
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
                }
            ];
            
            estructuraSagas.forEach(saga => {
                 // 1. Crear el elemento visual (Imagen)
                 genreList.appendChild(createItem(saga.id, saga.titulo, 'genre', true, saga.img));
                 
                 // 🔥 FIX CRUCIAL: Agregar la opción al SELECT oculto para que funcione el filtro
                 DOM.genreFilter.innerHTML += `<option value="${saga.id}">${saga.titulo}</option>`;

                 // 2. Crear las fases hijas
                 saga.fases.forEach(f => { 
                     if(fasesDisponibles.has(f)) {
                         genreList.appendChild(createItem(f, `Fase ${f}`, 'genre'));
                         DOM.genreFilter.innerHTML += `<option value="${f}">Fase ${f}</option>`;
                     }
                 });
            });
            document.getElementById('genre-text').textContent = "Todas las Fases";
        }
        else if (mode !== 'botones' && type === 'starwars') {
             genreList.appendChild(createItem('all', 'Toda la Galaxia', 'genre'));
             const eras = [{ id: 'republic', label: 'La República' }, { id: 'empire', label: 'El Imperio' }];
             eras.forEach(e => {
                 genreList.appendChild(createItem(e.id, e.label, 'genre'));
                 DOM.genreFilter.innerHTML += `<option value="${e.id}">${e.label}</option>`;
             });
             document.getElementById('genre-text').textContent = "Toda la Galaxia";
        }

        if (sortVisual) sortVisual.style.display = 'none';
        if (ucmButtons) ucmButtons.style.display = 'flex';
        
    } else {
        // GÉNERICO
        if (mode !== 'botones') {
            const genres = new Set(Object.values(sourceData).flatMap(i => i.genres ? String(i.genres).split(';') : []));
            genreList.appendChild(createItem('all', 'Todos', 'genre'));
            Array.from(genres).forEach(g => {
                const gTrim = g.trim();
                if(gTrim) {
                    genreList.appendChild(createItem(gTrim, gTrim, 'genre'));
                    DOM.genreFilter.innerHTML += `<option value="${gTrim}">${gTrim}</option>`;
                }
            });
            document.getElementById('genre-text').textContent = "Todos";
        }

        if (sortVisual) sortVisual.style.display = 'block';
        if (ucmButtons) ucmButtons.style.display = 'none';
        
        sortList.innerHTML = '';
        const sortOptions = [{val:'recent', label:'Recientes'}, {val:'year-asc', label:'Año (Asc)'}, {val:'title-asc', label:'A-Z'}];
        sortOptions.forEach(o => {
            sortList.appendChild(createItem(o.val, o.label, 'sort'));
            DOM.sortBy.innerHTML += `<option value="${o.val}">${o.label}</option>`;
        });
    }
    
    // Configurar eventos
    const configDropdown = (trigger, visual) => {
        const newTrigger = trigger.cloneNode(true);
        trigger.parentNode.replaceChild(newTrigger, trigger);
        newTrigger.onclick = (e) => { e.stopPropagation(); visual.classList.toggle('open'); };
    };
    if(document.getElementById('genre-trigger')) configDropdown(document.getElementById('genre-trigger'), genreVisual);
    if(document.getElementById('sort-trigger')) configDropdown(document.getElementById('sort-trigger'), sortVisual);
    
    if(DOM.ucmSortButtons) DOM.ucmSortButtons.forEach(btn => {
        btn.onclick = (e) => {
            DOM.ucmSortButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            applyAndDisplayFilters(type);
        };
    });
}

async function applyAndDisplayFilters(type) {
    let sourceData;
    if (type === 'movie') sourceData = appState.content.movies;
    else if (type === 'series') sourceData = appState.content.series;
    else sourceData = appState.content.sagas[type]; 

    const gridEl = DOM.gridContainer.querySelector('.grid');
    if (!gridEl || !sourceData) return;

    // Config Excel
    const sagaConfig = appState.content.sagasList.find(s => s.id === type);
    const mode = String(sagaConfig ? (sagaConfig.filters || 'si') : 'si').toLowerCase().trim();
    const filtersDisabled = (mode === 'no');

    // Determinar Orden
    let sortByValue;
    if (filtersDisabled) {
        sortByValue = 'release'; 
    } else {
        if (type === 'ucm' || type === 'starwars') {
            const activeBtn = document.querySelector('.sort-btn.active');
            sortByValue = activeBtn ? activeBtn.dataset.sort : 'release';
        } else {
            sortByValue = DOM.sortBy.value;
        }
    }

    gridEl.innerHTML = `<div style="width:100%;height:60vh;display:flex;justify-content:center;align-items:center;grid-column:1/-1;"><p class="loading-text">Cargando...</p></div>`;

    let content = Object.entries(sourceData);

    // 🔥 FIX ORDEN: Invertimos para que coincida con las filas del Excel (1, 2, 3...)
    // Si te salen al revés (Endgame primero), BORRA ESTA LÍNEA.
    content.reverse(); 

    // FILTRADO
    if (!filtersDisabled && mode !== 'botones' && DOM.genreFilter.value !== 'all') {
        const filterVal = DOM.genreFilter.value.toLowerCase().trim(); 
        
        content = content.filter(([id, item]) => {
            if (type === 'ucm') {
                const fase = String(item.fase || '').trim();
                
                if (filterVal === 'saga_infinity') return ['1','2','3'].includes(fase);
                if (filterVal === 'saga_multiverse') return ['4','5','6'].includes(fase);
                
                return fase === filterVal;
            }
            return String(item.genres || '').toLowerCase().includes(filterVal);
        });
    }

    // ORDENAMIENTO
    if (sortByValue === 'recent') {
        content.reverse(); 
    } else {
        content.sort((a, b) => {
            const aData = a[1];
            const bData = b[1];

            if (sortByValue === 'release') return 0;

            if (sortByValue === 'chronological') {
                return (Number(aData.cronologia) || 9999) - (Number(bData.cronologia) || 9999);
            }
            if (sortByValue === 'year-asc') {
                return (Number(aData.year) || 9999) - (Number(bData.year) || 9999);
            }
            if (sortByValue === 'title-asc') {
                return (aData.title || '').localeCompare(bData.title || '');
            }
            return 0;
        });
    }

    // Expansión Temporadas
    if ((type === 'ucm' || type === 'starwars') && sortByValue === 'chronological') {
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
        expandedContent.sort((a, b) => (Number(a[1].cronologia)||999) - (Number(b[1].cronologia)||999));
        content = expandedContent;
    }

    // Render
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
        const detailsButtons = document.getElementById('details-buttons');

        // =========================================================
        // 🔥 BÚSQUEDA INTELIGENTE UNIVERSAL
        // =========================================================
        let data = null;

        // 1. Buscar en listas estándar
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

        // 2. 🔥 BUSCAR EN SAGAS DINÁMICAS (Harry Potter, Star Wars, etc.)
        if (!data && appState.content.sagas) {
            // Recorremos cada saga (ej: 'harrypotter', 'starwars')
            for (const sagaKey in appState.content.sagas) {
                const sagaData = appState.content.sagas[sagaKey];
                if (sagaData && sagaData[id]) {
                    data = sagaData[id];
                    // Si el Excel tiene columna 'type', lo usamos. Si no, asumimos movie.
                    type = (data.type === 'series' || appState.content.seriesEpisodes[id]) ? 'series' : 'movie';
                    break; // Encontrado, dejamos de buscar
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
        
        // Textos e Imagen
        document.getElementById('details-title').textContent = data.title || '';
        document.getElementById('details-year').textContent = data.year ? `(${data.year})` : '';
        document.getElementById('details-genres').textContent = data.genres || '';
        document.getElementById('details-synopsis').textContent = data.synopsis || 'Sin descripción.';
        document.getElementById('details-poster-img').src = data.poster || '';

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

        // 2. Botón Temporadas (Solo Series)
        if (isSeries) {
            const episodes = appState.content.seriesEpisodes[id] || {};
            if (Object.keys(episodes).length > 0) {
                const infoBtn = document.createElement('button');
                infoBtn.className = 'btn btn-info';
                infoBtn.innerHTML = `<i class="fas fa-list"></i> Temporadas`;
                infoBtn.onclick = async () => {
                    closeAllModals();
                    const player = await getPlayerModule();
                    player.openSeriesPlayer(id, true); // true = forzar vista de temporadas
                };
                detailsButtons.appendChild(infoBtn);
            }
        }

        // 3. Botón Mi Lista
        if (auth.currentUser) {
            const listBtn = document.createElement('button');
            const inList = appState.user.watchlist.has(id);
            listBtn.className = `btn btn-watchlist ${inList ? 'in-list' : ''}`;
            listBtn.innerHTML = `<i class="fas ${inList ? 'fa-check' : 'fa-plus'}"></i>`;
            listBtn.onclick = () => handleWatchlistClick(listBtn);
            // Truco para dataset
            listBtn.setAttribute('data-content-id', id); 
            detailsButtons.appendChild(listBtn);
        }

        // Mostrar Modal
        modal.classList.add('show');
        document.body.classList.add('modal-open');

        // Configurar cerrar
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
