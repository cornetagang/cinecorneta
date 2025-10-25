// ===========================================================
// CINE CORNETA - SCRIPT COMPLETO CON MEJORAS INTEGRADAS
// Versión: 2.0.0
// ===========================================================

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
// 1. ESTADO GLOBAL Y CONFIGURACIÓN
// ===========================================================
const appState = {
    content: {
        movies: {},
        series: {},
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

const API_URL = 'https://script.google.com/macros/s/AKfycbwwctEPJQEsLPTkzwD1jgvXEg6QH_QiG12lNCH9sVUVnK08G58pp5ZDAYh8QphOxXje/exec';
const ITEMS_PER_LOAD = 18;

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
    fetchInitialDataWithCache();
});

async function fetchInitialDataWithCache() {
    const processData = (data) => {
        appState.content.movies = data.allMovies || {};
        appState.content.series = data.series || {};
        appState.content.seriesEpisodes = data.episodes || {};
        appState.content.seasonPosters = data.posters || {};
    };

    const setupAndShow = (movieMeta, seriesMeta) => {
        appState.content.metadata.movies = movieMeta || {};
        appState.content.metadata.series = seriesMeta || {};
        
        if (DOM.pageWrapper.style.display !== 'block') {
            setupApp();
            DOM.preloader.classList.add('fade-out');
            DOM.preloader.addEventListener('transitionend', () => DOM.preloader.remove());
            DOM.pageWrapper.style.display = 'block';
        } else {
            setupHero();
            generateCarousels();
            const activeFilter = document.querySelector('.main-nav a.active, .mobile-nav a.active')?.dataset.filter;
            if (activeFilter === 'movie' || activeFilter === 'series') {
                applyAndDisplayFilters(activeFilter);
            }
        }
    };

    // Intentar cargar desde caché
    const cachedContent = cacheManager.get(cacheManager.keys.content);
    const cachedMetadata = cacheManager.get(cacheManager.keys.metadata);

    if (cachedContent) {
        console.log('✓ Cargando UI desde caché...');
        processData(cachedContent);
        
        if (cachedMetadata) {
            appState.content.metadata.movies = cachedMetadata.movies || {};
            appState.content.metadata.series = cachedMetadata.series || {};
        }

        setupAndShow(cachedMetadata?.movies, cachedMetadata?.series);
    }

    // Cargar datos frescos en background
    try {
        console.log('⟳ Cargando datos frescos...');
        
        const [series, episodes, allMovies, posters, movieMeta, seriesMeta] = await Promise.all([
            ErrorHandler.fetchOperation(`${API_URL}?data=series`),
            ErrorHandler.fetchOperation(`${API_URL}?data=episodes`),
            ErrorHandler.fetchOperation(`${API_URL}?data=allMovies&order=desc`),
            ErrorHandler.fetchOperation(`${API_URL}?data=PostersTemporadas`),
            db.ref('movie_metadata').once('value').then(s => s.val() || {}),
            db.ref('series_metadata').once('value').then(s => s.val() || {})
        ]);

        const freshContent = { allMovies, series, episodes, posters };
        const freshMetadata = { movies: movieMeta, series: seriesMeta };

        processData(freshContent);
        appState.content.metadata.movies = freshMetadata.movies;
        appState.content.metadata.series = freshMetadata.series;

        cacheManager.set(cacheManager.keys.content, freshContent);
        cacheManager.set(cacheManager.keys.metadata, freshMetadata);

        console.log('✓ Datos frescos guardados');

        if (cachedContent) {
            setupHero();
            generateCarousels();
            const activeFilter = document.querySelector('.main-nav a.active')?.dataset.filter;
            if (activeFilter === 'movie' || activeFilter === 'series') {
                applyAndDisplayFilters(activeFilter);
            }
        } else {
            setupApp();
            DOM.preloader.classList.add('fade-out');
            setTimeout(() => DOM.preloader.remove(), 500);
            DOM.pageWrapper.style.display = 'block';
        }

        const user = auth.currentUser;
        if (user) {
            db.ref(`users/${user.uid}/history`).orderByChild('viewedAt').once('value', snapshot => {
                if (snapshot.exists()) generateContinueWatchingCarousel(snapshot);
            });
        }

    } catch (error) {
        console.error('✗ Error al cargar datos:', error);
        if (!cachedContent) {
            DOM.preloader.innerHTML = `
                <div style="text-align: center;">
                    <p style="color: white; margin-bottom: 20px;">Error al cargar el contenido</p>
                    <button onclick="location.reload()" style="padding: 10px 20px; background: var(--primary-red); color: white; border: none; border-radius: 5px; cursor: pointer;">
                        Reintentar
                    </button>
                </div>
            `;
        }
    }
}

function setupApp() {
    setupHero();
    generateCarousels();
    setupRouletteLogic();
    setupEventListeners();
    setupAuthListeners();
    setupNavigation();
    setupSearch();
    setupUserDropdown();
    switchView('all');
}

// ===========================================================
// 3. NAVEGACIÓN Y MANEJO DE VISTAS
// ===========================================================
function setupNavigation() {
    const navContainers = document.querySelectorAll('.main-nav ul, .mobile-nav ul, .bottom-nav, #profile-hub-container');
    navContainers.forEach(container => container.addEventListener('click', handleFilterClick));
    
    const openMenu = () => { 
        DOM.mobileNavPanel.classList.add('is-open'); 
        DOM.menuOverlay.classList.add('active'); 
    };
    const closeMenu = () => { 
        DOM.mobileNavPanel.classList.remove('is-open'); 
        DOM.menuOverlay.classList.remove('active'); 
    };

    if (DOM.hamburgerBtn) DOM.hamburgerBtn.addEventListener('click', openMenu);
    if (DOM.closeNavBtn) DOM.closeNavBtn.addEventListener('click', closeMenu);
    if (DOM.menuOverlay) DOM.menuOverlay.addEventListener('click', closeMenu);
}

function handleFilterClick(event) {
    const link = event.target.closest('a');
    if (!link) return;
    event.preventDefault();

    // 🔑 SOLUCIÓN: Usar el Encadenamiento Opcional (?. ) para evitar el error
    DOM.mobileNavPanel?.classList.remove('is-open');
    DOM.menuOverlay?.classList.remove('active');
    
    const filter = link.dataset.filter;
    if (filter === 'roulette') {
        openRouletteModal();
        return;
    }

    if (link.classList.contains('active') && !['history', 'my-list'].includes(filter)) return;

    document.querySelectorAll('.main-nav a, .mobile-nav a, .bottom-nav a').forEach(l => l.classList.remove('active'));
    document.querySelectorAll(`a[data-filter="${filter}"]`).forEach(l => l.classList.add('active'));
    
    DOM.searchInput.value = '';
    switchView(filter);
}

function switchView(filter) {
    // Primero, oculta todos los contenedores principales.
    [
        DOM.heroSection, DOM.carouselContainer, DOM.gridContainer,
        DOM.myListContainer, DOM.historyContainer, DOM.profileContainer,
        DOM.settingsContainer, document.getElementById('profile-hub-container') // Asegúrate de incluir el nuevo hub aquí
    ].forEach(container => {
        if (container) container.style.display = 'none';
    });

    // Oculta los controles de filtro por defecto.
    if (DOM.filterControls) DOM.filterControls.style.display = 'none';

    // Ahora, muestra el contenedor correcto según el filtro seleccionado.
    if (filter === 'all') {
        if(DOM.heroSection) DOM.heroSection.style.display = 'flex';
        if(DOM.carouselContainer) DOM.carouselContainer.style.display = 'block';
    } else if (filter === 'movie' || filter === 'series') {
        if (DOM.gridContainer) DOM.gridContainer.style.display = 'block';
        if (DOM.filterControls) DOM.filterControls.style.display = 'flex';
        populateFilters(filter);
        applyAndDisplayFilters(filter);
        setupInfiniteScroll(filter);
    } else if (filter === 'my-list') {
        if (DOM.myListContainer) { DOM.myListContainer.style.display = 'block'; displayMyListView(); }
    } else if (filter === 'history') {
        if (DOM.historyContainer) { DOM.historyContainer.style.display = 'block'; renderHistory(); }
    } else if (filter === 'profile-hub') { // <-- CASO AÑADIDO PARA EL MENÚ DE PERFIL MÓVIL
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
        if (DOM.profileContainer) { DOM.profileContainer.style.display = 'block'; renderProfile(); }
    } else if (filter === 'settings') {
        if (DOM.settingsContainer) { DOM.settingsContainer.style.display = 'block'; renderSettings(); }
    }

    // Finalmente, desplaza la vista hacia la parte superior de la página.
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function populateFilters(type) {
    const sourceData = (type === 'movie') ? appState.content.movies : appState.content.series;
    
    if (!DOM.genreFilter || !DOM.sortBy) return;

    const handleFilterChange = () => applyAndDisplayFilters(type);
    DOM.genreFilter.onchange = handleFilterChange;
    DOM.sortBy.onchange = handleFilterChange;

    const genres = new Set(Object.values(sourceData).flatMap(item => item.genres?.split(';').map(g => g.trim()).filter(Boolean) || []));
    
    DOM.genreFilter.innerHTML = `<option value="all">Todos los géneros</option>`;
    Array.from(genres).sort().forEach(genre => {
        DOM.genreFilter.innerHTML += `<option value="${genre}">${genre}</option>`;
    });

    DOM.sortBy.innerHTML = `
        <option value="recent">Recientes</option>
        <option value="title-asc">Título (A - Z)</option>
        <option value="title-desc">Título (Z - A)</option>
        <option value="year-desc">Año (Descendente)</option>
        <option value="year-asc">Año (Ascendente)</option>
        <option value="rating-desc">Calificación (Mejor a peor)</option>
        <option value="rating-asc">Calificación (Peor a mejor)</option>
    `;
}

function applyAndDisplayFilters(type) {
    const sourceData = (type === 'movie') ? appState.content.movies : appState.content.series;
    const gridEl = DOM.gridContainer.querySelector('.grid');
    if (!gridEl) return;
    const selectedGenre = DOM.genreFilter.value;
    const sortByValue = DOM.sortBy.value;

    let content = Object.entries(sourceData);
    if (selectedGenre !== 'all') {
        content = content.filter(([id, item]) => item.genres?.toLowerCase().includes(selectedGenre.toLowerCase()));
    }

    content.sort((a, b) => {
        const aData = a[1], bData = b[1];
        const metadataSource = type === 'movie' ? appState.content.metadata.movies : appState.content.metadata.series;
        const aRating = metadataSource[a[0]]?.avgRating || 0;
        const bRating = metadataSource[b[0]]?.avgRating || 0;

        switch (sortByValue) {
            case 'recent':
                return bData.tr - aData.tr;
            case 'rating-desc':
            case 'rating-asc': {
                if (aRating === 0 && bRating > 0) return 1;
                if (bRating === 0 && aRating > 0) return -1;
                return sortByValue === 'rating-asc' ? aRating - bRating : bRating - aRating;
            }
            case 'title-asc':
                return aData.title.localeCompare(bData.title);
            case 'title-desc':
                return bData.title.localeCompare(aData.title);
            case 'year-desc':
                return (bData.year || 0) - (aData.year || 0);
            case 'year-asc':
                return (aData.year || 0) - (bData.year || 0);
            default:
                return bData.tr - aData.tr;
        }
    });
    
    appState.ui.contentToDisplay = content;
    appState.ui.currentIndex = 0;
    gridEl.innerHTML = '';
    loadMoreContent(type);
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

function setupInfiniteScroll(type) {
    const sentinelId = "infinite-scroll-sentinel";
    let sentinel = document.getElementById(sentinelId);
    if (!sentinel) {
        sentinel = document.createElement("div");
        sentinel.id = sentinelId;
        sentinel.style.height = "1px";
        DOM.gridContainer.appendChild(sentinel);
    }

    if (sentinel._observer) sentinel._observer.disconnect();

    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !appState.flags.isLoadingMore) {
                loadMoreContent(type);
            }
        });
    }, { rootMargin: "200px" });

    observer.observe(sentinel);
    sentinel._observer = observer;
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

// 🆕 HERO CON PRECARGA DE IMÁGENES
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
    DOM.heroSection.innerHTML = `<div class="hero-content"><h1 id="hero-title"></h1><p id="hero-synopsis"></p><div class="hero-buttons"></div></div>`;
    
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

        heroContent.querySelector('.hero-buttons').innerHTML = `
            <button class="btn btn-play" onclick="openPlayerModal('${movieId}', '${movieData.title.replace(/'/g, "\\'")}')"><i class="fas fa-play"></i> Ver Ahora</button>
            <button class="btn btn-info" onclick="openDetailsModal('${movieId}', 'movie')">Más Información</button>
            ${watchlistButtonHTML}
        `;
        heroContent.classList.remove('hero-fading');
        appState.hero.isTransitioning = false;
    }, 300);
}

function generateCarousels() {
    if (!DOM.carouselContainer) return;
    DOM.carouselContainer.querySelectorAll('.carousel').forEach(c => c.remove());
    
    const recentMovieIds = Object.keys(appState.content.movies).sort((a, b) => appState.content.movies[b].tr - appState.content.movies[a].tr).slice(0, 7);
    if (recentMovieIds.length > 0) {
        const carouselEl = document.createElement('div');
        carouselEl.className = 'carousel';
        carouselEl.innerHTML = `<h3 class="carousel-title">Agregadas Recientemente</h3><div class="carousel-track"></div>`;
        const track = carouselEl.querySelector('.carousel-track');
        recentMovieIds.forEach(id => track.appendChild(createMovieCardElement(id, appState.content.movies[id], 'movie')));
        DOM.carouselContainer.appendChild(carouselEl);
    }
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
        const allContent = { ...appState.content.movies, ...appState.content.series };
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
            // 🔧 CAMBIO: lazy = false para que las imágenes carguen inmediatamente en búsqueda
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
        carouselEl.className = 'carousel';
        carouselEl.innerHTML = `<h3 class="carousel-title">Continuar Viendo</h3><div class="carousel-track"></div>`;
        const track = carouselEl.querySelector('.carousel-track');
        itemsToDisplay.forEach(itemData => {
            track.appendChild(createContinueWatchingCard(itemData));
        });
        DOM.carouselContainer.prepend(carouselEl);
    }
}

function createContinueWatchingCard(itemData) {
    const card = document.createElement('div');
    card.className = 'continue-watching-card';
    card.onclick = () => openPlayerToEpisode(itemData.contentId, itemData.season, itemData.episodeIndexToOpen);
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

function setupRouletteLogic() {
    const spinButton = DOM.rouletteModal.querySelector('#spin-roulette-btn');
    if (!DOM.rouletteModal || !spinButton) return;
    
    let selectedMovie = null;

    const loadRouletteMovies = () => {
        const rouletteTrack = DOM.rouletteModal.querySelector('#roulette-carousel-track');
        if (!rouletteTrack) return;
        rouletteTrack.classList.remove('is-spinning');
        spinButton.disabled = false;
        rouletteTrack.style.transition = 'none';
        rouletteTrack.innerHTML = '';

        if (!appState.content.movies || Object.keys(appState.content.movies).length < 15) {
            rouletteTrack.innerHTML = `<p>No hay suficientes películas.</p>`;
            spinButton.disabled = true;
            return;
        }

        const allMovieIds = Object.keys(appState.content.movies);
        const moviesForRoulette = Array.from({ length: 50 }, () => {
            const randomIndex = Math.floor(Math.random() * allMovieIds.length);
            return { id: allMovieIds[randomIndex], data: appState.content.movies[allMovieIds[randomIndex]] };
        });
        const finalPickIndex = Math.floor(Math.random() * (moviesForRoulette.length - 10)) + 5;
        selectedMovie = moviesForRoulette[finalPickIndex];

        moviesForRoulette.forEach((movie, index) => {
        // 🔧 CAMBIO: lazy = false para que las imágenes carguen inmediatamente en la ruleta
        const card = createMovieCardElement(movie.id, movie.data, 'movie', 'roulette', false);
        if (index === finalPickIndex) {
            card.dataset.winner = 'true';
        }
        rouletteTrack.appendChild(card);
    });
        
        setTimeout(() => {
            const wrapperWidth = rouletteTrack.parentElement.offsetWidth;
            const card = rouletteTrack.querySelector('.movie-card');
            if (!card) return;
            const cardTotalWidth = card.offsetWidth + (parseFloat(getComputedStyle(card).marginLeft) * 2);
            const initialOffset = (wrapperWidth / 2) - (cardTotalWidth / 2);
            rouletteTrack.style.transform = `translateX(${initialOffset}px)`;
        }, 100);
    };

    spinButton.addEventListener('click', () => {
        if (!selectedMovie) return;
        spinButton.disabled = true;
        const rouletteTrack = DOM.rouletteModal.querySelector('#roulette-carousel-track');
        rouletteTrack.classList.add('is-spinning');

        const winnerCard = rouletteTrack.querySelector('[data-winner="true"]');
        if (!winnerCard) return;

        const wrapperWidth = rouletteTrack.parentElement.offsetWidth;
        const targetPosition = (wrapperWidth / 2) - winnerCard.offsetLeft - (winnerCard.offsetWidth / 2);
        const randomJitter = Math.floor(Math.random() * (winnerCard.offsetWidth / 4)) - (winnerCard.offsetWidth / 8);
        const finalPosition = targetPosition + randomJitter;
        
        rouletteTrack.style.transition = 'transform 6s cubic-bezier(0.1, 0, 0.2, 1)';
        rouletteTrack.style.transform = `translateX(${finalPosition}px)`;

        rouletteTrack.addEventListener('transitionend', () => {
            rouletteTrack.classList.remove('is-spinning');
            setTimeout(() => {
                closeRouletteModal();
                openDetailsModal(selectedMovie.id, 'movie');
            }, 500);
        }, { once: true });
    });
    
    window.loadRouletteMovies = loadRouletteMovies;
}

function openRouletteModal() {
    if (!appState.content.movies) return;
    if (DOM.rouletteModal) {
        document.body.classList.add('modal-open');
        DOM.rouletteModal.classList.add('show');
        if (window.loadRouletteMovies) window.loadRouletteMovies();
    }
}

function closeRouletteModal() {
    if (DOM.rouletteModal) DOM.rouletteModal.classList.remove('show');
    if (!document.querySelector('.modal.show')) {
        document.body.classList.remove('modal-open');
    }
}

// ===========================================================
// 5. MODALES (GENERAL, DETALLES, REPRODUCTOR)
// ===========================================================
function closeAllModals() {
    document.querySelectorAll('.modal.show').forEach(modal => {
        modal.classList.remove('show');
        const iframe = modal.querySelector('iframe');
        if (iframe) iframe.src = ''; // detiene cualquier video
    });
    document.body.classList.remove('modal-open');
}

let lastFocusedElement = null;

async function openDetailsModal(id, type, triggerElement = null) {
    if (triggerElement) lastFocusedElement = triggerElement;

    const data = type.includes('series') ? appState.content.series[id] : appState.content.movies[id];
    if (!data || !DOM.detailsModal) return;

    DOM.detailsModal.classList.add('show');
    document.body.classList.add('modal-open');

    const detailsPanel = DOM.detailsModal.querySelector('.details-panel');
    if (detailsPanel) {
        const bgImage = data.banner || data.poster;
        detailsPanel.style.backgroundImage = `url(${bgImage})`;
    }
    const posterImg = DOM.detailsModal.querySelector('#details-poster-img');
    if (posterImg) {
        posterImg.src = data.poster;
        posterImg.alt = `Poster de ${data.title}`;
        posterImg.loading = "lazy";
    }
    DOM.detailsModal.querySelector('#details-title').textContent = data.title || "Sin título";
    DOM.detailsModal.querySelector('#details-year').textContent = data.year || "";
    DOM.detailsModal.querySelector('#details-genres').textContent = data.genres || "";
    DOM.detailsModal.querySelector('#details-synopsis').textContent = data.synopsis || "";

    const ratingDisplay = DOM.detailsModal.querySelector('#details-rating-display');
    const metadataSource = type.includes('series') ? appState.content.metadata.series : appState.content.metadata.movies;
    const rating = metadataSource?.[id]?.avgRating || null;
    ratingDisplay.innerHTML = rating ? `<span>⭐ ${rating.toFixed(1)}/5</span>` : `<span>Sin calificación</span>`;

    let playButtonText = "Ver Ahora";
    const user = auth.currentUser;

    if (user && type.includes('series')) {
        const historySnapshot = await db.ref(`users/${user.uid}/history`).once('value');
        if (historySnapshot.exists()) {
            const historyData = historySnapshot.val();
            const hasHistory = Object.values(historyData).some(
                item => item.contentId === id && item.type === 'series'
            );
            if (hasHistory) {
                playButtonText = "Seguir Viendo";
            }
        }
    }

    const buttonsContainer = DOM.detailsModal.querySelector('#details-buttons');
    let watchlistButtonHTML = '';
    if (user) {
        const isInList = appState.user.watchlist.has(id);
        const iconClass = isInList ? 'fa-check' : 'fa-plus';
        const buttonClass = isInList ? 'btn-watchlist in-list' : 'btn-watchlist';
        watchlistButtonHTML = `<button class="${buttonClass}" data-content-id="${id}" title="Añadir a Mi Lista"><i class="fas ${iconClass}"></i></button>`;
    }

    let episodesOrSeasonsBtn = '';
    if (type.includes('series')) {
        const seriesEpisodes = appState.content.seriesEpisodes[id] || {};
        const seasonCount = Object.keys(seriesEpisodes).length;
        if (seasonCount > 1) {
            episodesOrSeasonsBtn = `<button class="btn btn-seasons" onclick="openSeriesPlayer('${id}', true)"><i class="fas fa-layer-group"></i> Temporadas</button>`;
        }
    }

    const playAction = type.includes('series') 
        ? `openSeriesPlayer('${id}')` 
        : `openPlayerModal('${id}', '${data.title.replace(/'/g, "\\'")}')`;

    buttonsContainer.innerHTML = `
        <button class="btn btn-play" onclick="${playAction}">
            <i class="fas fa-play"></i> ${playButtonText}
        </button>
        ${episodesOrSeasonsBtn}
        ${watchlistButtonHTML}
    `;

    const closeBtn = DOM.detailsModal.querySelector('.close-btn');
    if (closeBtn) closeBtn.focus();
}

// ===========================================================
// REPRODUCTOR DE PELÍCULAS CON SELECCIÓN DE IDIOMA
// ===========================================================

/**
 * Abre el modal del reproductor de películas con soporte para múltiples idiomas
 * @param {string} movieId - ID único de la película (ej: "superman-2025")
 * @param {string} movieTitle - Título de la película para mostrar
 */
function openPlayerModal(movieId, movieTitle) {
    closeAllModals();
    addToHistoryIfLoggedIn(movieId, 'movie');

    // 🎬 OBTENER DATOS DE LA PELÍCULA
    const movieData = appState.content.movies[movieId];
    if (!movieData) {
        console.error(`Película no encontrada: ${movieId}`);
        ErrorHandler.show(ErrorHandler.types.CONTENT, 'No se pudo cargar la película.');
        return;
    }

    // 🌐 VERIFICAR DISPONIBILIDAD DE IDIOMAS
    const hasSpanish = !!(movieData.videoId_es && movieData.videoId_es.trim());
    const hasEnglish = !!(movieData.videoId_en && movieData.videoId_en.trim());
    const hasMultipleLangs = hasSpanish && hasEnglish;
    
    // 🎯 DETERMINAR IDIOMA Y VIDEO INICIAL
    let defaultLang, initialVideoId;

    if (hasEnglish) {
        defaultLang = 'en';
        initialVideoId = movieData.videoId_en;
    } else if (hasSpanish) {
        defaultLang = 'es';
        initialVideoId = movieData.videoId_es
    } else {
        defaultLang = 'default';
        initialVideoId = movieId;
        console.warn(`Película ${movieId} no tiene videoId_es ni videoId_en, usando ID como videoId`);
    }

    // 🎥 CONFIGURAR IFRAME DEL REPRODUCTOR
    const iframe = DOM.cinemaModal.querySelector('iframe');
    if (!iframe) {
        console.error('Iframe del reproductor no encontrado');
        return;
    }
    
    iframe.src = `https://drive.google.com/file/d/${initialVideoId}/preview`;

    // 📝 ACTUALIZAR TÍTULO
    const titleElement = DOM.cinemaModal.querySelector('#cinema-title');
    if (titleElement) {
        titleElement.textContent = movieTitle || movieData.title || "Película";
    }

    // 🎛️ CONFIGURAR CONTROLES (Idioma + Mi Lista)
    const cinemaControls = DOM.cinemaModal.querySelector('.cinema-controls');
    
    if (cinemaControls) {
        let controlsHTML = '';

        // Botón de "Mi Lista" (siempre visible si hay usuario)
        const user = auth.currentUser;
        if (user) {
            const isInList = appState.user.watchlist.has(movieId);
            const iconClass = isInList ? 'fa-check' : 'fa-plus';
            const buttonClass = isInList ? 'btn-watchlist in-list' : 'btn-watchlist';
            controlsHTML += `
                <button class="${buttonClass}" data-content-id="${movieId}">
                    <i class="fas ${iconClass}"></i> Mi Lista
                </button>
            `;
        }

        // Controles de idioma (solo si hay múltiples idiomas)
        if (hasMultipleLangs) {
            controlsHTML += `
                <div class="lang-controls-movie">
                    <button class="lang-btn-movie ${defaultLang === 'en' ? 'active' : ''}" 
                            data-lang="en" 
                            data-movie-id="${movieId}"
                            ${!hasEnglish ? 'disabled' : ''}>
                        Original
                    </button>
                    <button class="lang-btn-movie ${defaultLang === 'es' ? 'active' : ''}" 
                            data-lang="es" 
                            data-movie-id="${movieId}"
                            ${!hasSpanish ? 'disabled' : ''}>
                        Español
                    </button>
                </div>
            `;
        }

        cinemaControls.innerHTML = controlsHTML;

        // 🔄 EVENTOS PARA CAMBIAR IDIOMA
        if (hasMultipleLangs) {
            cinemaControls.querySelectorAll('.lang-btn-movie').forEach(btn => {
                btn.addEventListener('click', function() {
                    const selectedLang = this.dataset.lang;
                    const targetMovieId = this.dataset.movieId;
                    const targetMovieData = appState.content.movies[targetMovieId];
                    
                    if (!targetMovieData) {
                        console.error('Datos de película no encontrados al cambiar idioma');
                        return;
                    }

                    // Determinar el videoId según el idioma seleccionado
                    let newVideoId;
                    if (selectedLang === 'es' && targetMovieData.videoId_es) {
                        newVideoId = targetMovieData.videoId_es;
                    } else if (selectedLang === 'en' && targetMovieData.videoId_en) {
                        newVideoId = targetMovieData.videoId_en;
                    } else {
                        // Fallback: usar ID de película si no hay videoId específico
                        newVideoId = targetMovieId;
                        console.warn(`VideoId para idioma ${selectedLang} no encontrado, usando ID de película`);
                    }

                    // Cambiar el video en el iframe
                    const iframe = DOM.cinemaModal.querySelector('iframe');
                    if (iframe) {
                        iframe.src = `https://drive.google.com/file/d/${newVideoId}/preview`;
                    }

                    // Actualizar botones activos
                    cinemaControls.querySelectorAll('.lang-btn-movie').forEach(b => 
                        b.classList.remove('active')
                    );
                    this.classList.add('active');

                    // Log para debugging
                    console.log(`Idioma cambiado a: ${selectedLang}, VideoID: ${newVideoId}`);
                });
            });
        }
    }

    // 📺 MOSTRAR MODAL
    DOM.cinemaModal.classList.add('show');
    document.body.classList.add('modal-open');

    // Log para debugging
    console.log('Película abierta:', {
        id: movieId,
        title: movieTitle,
        hasSpanish,
        hasEnglish,
        defaultLang,
        videoId: initialVideoId
    });
}


// ===========================================================
// FUNCIÓN AUXILIAR: Actualizar botón de watchlist en el reproductor
// ===========================================================

/**
 * Actualiza el estado visual del botón de watchlist
 * @param {string} movieId - ID de la película
 * @param {boolean} isInList - Si la película está en la lista
 */
function updateWatchlistButtonInPlayer(movieId, isInList) {
    const cinemaControls = DOM.cinemaModal.querySelector('.cinema-controls');
    if (!cinemaControls) return;

    const watchlistBtn = cinemaControls.querySelector(`.btn-watchlist[data-content-id="${movieId}"]`);
    if (!watchlistBtn) return;

    if (isInList) {
        watchlistBtn.classList.add('in-list');
        watchlistBtn.innerHTML = '<i class="fas fa-check"></i> En Mi Lista';
    } else {
        watchlistBtn.classList.remove('in-list');
        watchlistBtn.innerHTML = '<i class="fas fa-plus"></i> Mi Lista';
    }
}

// ===========================================================
// 6. AUTENTICACIÓN Y DATOS DE USUARIO (🆕 CON ERROR HANDLER)
// ===========================================================
function setupAuthListeners() {
    // Asigna la función para abrir el modal de autenticación a los botones del encabezado.
    if (DOM.loginBtnHeader) DOM.loginBtnHeader.addEventListener('click', () => openAuthModal(true));
    if (DOM.registerBtnHeader) DOM.registerBtnHeader.addEventListener('click', () => openAuthModal(false));

    // Configura el enlace para cambiar entre el formulario de inicio de sesión y el de registro.
    if (DOM.switchAuthModeLink) {
        DOM.switchAuthModeLink.addEventListener('click', (e) => {
            e.preventDefault();
            const isLoginVisible = DOM.loginForm.style.display === 'flex' || DOM.loginForm.style.display === '';
            openAuthModal(!isLoginVisible);
        });
    }

    // Gestiona el envío del formulario de registro.
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

    // Gestiona el envío del formulario de inicio de sesión.
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

    // Listener principal de Firebase: se activa cuando un usuario inicia o cierra sesión.
    auth.onAuthStateChanged(updateUIAfterAuthStateChange);

    // Gestiona los clics en los botones de eliminar del historial.
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

    // Listener para el nuevo botón de "Cerrar Sesión" en el hub de perfil móvil.
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

// 🆕 CON ERROR HANDLER
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
    const allContent = { ...appState.content.movies, ...appState.content.series };
    appState.user.watchlist.forEach(contentId => {
        const data = allContent[contentId];
        if (data) {
            const type = appState.content.series[contentId] ? 'series' : 'movie';
            // 🔧 CAMBIO: lazy = false para cargar inmediatamente
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
            // 🔧 CAMBIO: lazy = false para cargar inmediatamente
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
// 7. LÓGICA DEL REPRODUCTOR DE SERIES
// ===========================================================
function commitAndClearPendingSave() {
    if (appState.player.pendingHistorySave) {
        addToHistoryIfLoggedIn(
            appState.player.pendingHistorySave.contentId,
            appState.player.pendingHistorySave.type,
            appState.player.pendingHistorySave.episodeInfo
        );
        appState.player.pendingHistorySave = null;
    }
}

function closeSeriesPlayerModal() {
    clearTimeout(appState.player.episodeOpenTimer);
    commitAndClearPendingSave();

    DOM.seriesPlayerModal.classList.remove('show', 'season-grid-view', 'player-layout-view');
    document.body.classList.remove('modal-open');
    const iframe = DOM.seriesPlayerModal.querySelector('iframe');
    if (iframe) iframe.src = '';
    
    appState.player.activeSeriesId = null; 
}

async function openSeriesPlayer(seriesId, forceSeasonGrid = false) {
    closeAllModals();
    const seriesInfo = appState.content.series[seriesId];
    if (!seriesInfo) return;

    document.body.classList.add('modal-open');
    DOM.seriesPlayerModal.classList.add('show');
    DOM.seriesPlayerModal.innerHTML = `<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;"><div class="spinner"></div></div>`;

    const seriesEpisodes = appState.content.seriesEpisodes[seriesId] || {};
    const seasons = Object.keys(seriesEpisodes);

    if (forceSeasonGrid && seasons.length > 1) {
        renderSeasonGrid(seriesId);
        return;
    }

    if (seasons.length === 0) {
        DOM.seriesPlayerModal.innerHTML = `<button class="close-btn" onclick="closeSeriesPlayerModal()">&times;</button><p>No hay episodios disponibles.</p>`;
        return;
    }

    const user = auth.currentUser;
    let lastWatched = null;

    if (user) {
        const historySnapshot = await db.ref(`users/${user.uid}/history`).orderByChild('viewedAt').once('value');
        if (historySnapshot.exists()) {
            let userHistoryForThisSeries = [];
            historySnapshot.forEach(child => {
                const item = child.val();
                if (item.type === 'series' && item.contentId === seriesId) {
                    userHistoryForThisSeries.push(item);
                }
            });
            if (userHistoryForThisSeries.length > 0) {
                lastWatched = userHistoryForThisSeries.pop();
            }
        }
    }

    if (lastWatched) {
        renderEpisodePlayer(seriesId, lastWatched.season, lastWatched.lastEpisode);
    } else {
        const seasonsMapped = seasons.map(k => {
            const numMatch = String(k).replace(/\D/g, '');
            const num = numMatch ? parseInt(numMatch, 10) : 0;
            return { key: k, num };
        }).sort((a, b) => a.num - b.num);

        const firstSeasonKey = seasonsMapped.length > 0 ? seasonsMapped[0].key : seasons[0];
        renderEpisodePlayer(seriesId, firstSeasonKey, 0);
    }
}

function renderSeasonGrid(seriesId) {
    const seriesInfo = appState.content.series[seriesId];
    DOM.seriesPlayerModal.className = 'modal show season-grid-view';
    
    DOM.seriesPlayerModal.innerHTML = `
        <button class="close-btn" onclick="closeSeriesPlayerModal()">&times;</button>
        <div class="season-grid-container">
            <h2 class="player-title">${seriesInfo.title}</h2>
            <div id="season-grid" class="season-grid"></div>
        </div>
    `;
    populateSeasonGrid(seriesId);
    appState.player.activeSeriesId = null;
}

function populateSeasonGrid(seriesId) {
    const container = DOM.seriesPlayerModal.querySelector('#season-grid');
    const data = appState.content.seriesEpisodes[seriesId];
    const seriesInfo = appState.content.series[seriesId];
    if (!container || !data) return;

    container.innerHTML = '';

    const seasonKeys = Object.keys(data);
    const seasonsMapped = seasonKeys.map(k => {
        const numMatch = String(k).replace(/\D/g, '');
        const num = numMatch ? parseInt(numMatch, 10) : 0;
        return { key: k, num };
    }).sort((a, b) => a.num - b.num);

    const seasonCount = seasonsMapped.length;
    let columns = (seasonCount <= 5) ? seasonCount : Math.ceil(seasonCount / 2);
    container.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;

    seasonsMapped.forEach(({ key: seasonKey, num: seasonNum }) => {
        const episodes = Array.isArray(data[seasonKey]) ? data[seasonKey] : Object.values(data[seasonKey] || {});
        const posterUrl = appState.content.seasonPosters[seriesId]?.[seasonKey] || seriesInfo.poster || '';
        const totalEpisodes = episodes.length;

        const lastWatchedIndex = loadProgress(seriesId, seasonKey);
        const watchedEpisodes = lastWatchedIndex > 0 ? lastWatchedIndex + 1 : 0;
        const progressPercent = totalEpisodes > 0 ? Math.round((watchedEpisodes / totalEpisodes) * 100) : 0;

        let progressHTML = '';
        if (progressPercent > 0 && progressPercent < 100) {
            progressHTML = `
                <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPercent}">
                    <div style="width: ${progressPercent}%"></div>
                </div>
            `;
        } else if (progressPercent === 100) {
            progressHTML = `
                <div class="progress-bar complete" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
                    <div style="width: 100%"></div>
                </div>
            `;
        }

        const card = document.createElement('div');
        card.className = 'season-poster-card';
        card.onclick = () => renderEpisodePlayer(seriesId, seasonKey);

        card.innerHTML = `
            <img src="${posterUrl}" alt="Temporada ${seasonNum}">
            <div class="overlay">
                <h3>Temporada ${seasonNum}</h3>
                <p>${totalEpisodes} episodios</p>
            </div>
            ${progressHTML}
        `;

        container.appendChild(card);
    });
}

async function renderEpisodePlayer(seriesId, seasonNum, startAtIndex = null) {
    appState.player.activeSeriesId = seriesId;
    const savedEpisodeIndex = loadProgress(seriesId, seasonNum);
    const initialEpisodeIndex = startAtIndex !== null ? startAtIndex : savedEpisodeIndex;
    appState.player.state[seriesId] = { season: seasonNum, episodeIndex: initialEpisodeIndex, lang: 'es' };
    
    const firstEpisode = appState.content.seriesEpisodes[seriesId]?.[seasonNum]?.[0];
    const hasLangOptions = firstEpisode?.videoId_es?.trim();
    let langControlsHTML = hasLangOptions ? `<div class="lang-controls"><button class="lang-btn active" data-lang="es">Español</button><button class="lang-btn" data-lang="en">Inglés</button></div>` : '';
    
    const seasonsCount = Object.keys(appState.content.seriesEpisodes[seriesId]).length;
    const backButtonHTML = seasonsCount > 1 ? `<button class="player-back-link" onclick="renderSeasonGrid('${seriesId}')"><i class="fas fa-arrow-left"></i> Temporadas</button>` : '';

    DOM.seriesPlayerModal.className = 'modal show player-layout-view';
    DOM.seriesPlayerModal.innerHTML = `
        <button class="close-btn" onclick="closeSeriesPlayerModal()">&times;</button>
        <div class="player-layout-container">
            <div class="player-container">
                <h2 id="cinema-title-${seriesId}" class="player-title"></h2>
                <div class="screen"><iframe id="video-frame-${seriesId}" src="" allowfullscreen></iframe></div>
                <div class="pagination-controls">
                    <button class="episode-nav-btn" id="prev-btn-${seriesId}"><i class="fas fa-chevron-left"></i> Anterior</button>
                    ${langControlsHTML}
                    <button class="episode-nav-btn" id="next-btn-${seriesId}">Siguiente <i class="fas fa-chevron-right"></i></button>
                </div>
            </div>
            <div class="episode-sidebar">
                <div class="sidebar-header"> ${backButtonHTML} <h2>Episodios</h2> </div>
                <div id="episode-list-${seriesId}" class="episode-list-container"></div>
            </div>
        </div>
    `;

    DOM.seriesPlayerModal.querySelector(`#prev-btn-${seriesId}`).onclick = () => navigateEpisode(seriesId, -1);
    DOM.seriesPlayerModal.querySelector(`#next-btn-${seriesId}`).onclick = () => navigateEpisode(seriesId, 1);
    DOM.seriesPlayerModal.querySelectorAll(`.lang-btn`).forEach(btn => {
        btn.onclick = () => changeLanguage(seriesId, btn.dataset.lang);
    });
    
    populateEpisodeList(seriesId, seasonNum);
    openEpisode(seriesId, seasonNum, initialEpisodeIndex);
}

function populateEpisodeList(seriesId, seasonNum) {
    const container = DOM.seriesPlayerModal.querySelector(`#episode-list-${seriesId}`);
    const episodes = appState.content.seriesEpisodes[seriesId]?.[seasonNum];
    if (!container || !episodes) return;
    container.innerHTML = '';

    episodes.sort((a, b) => a.episodeNumber - b.episodeNumber).forEach((episode, index) => {
        const card = document.createElement('div');
        card.className = 'episode-card';
        card.id = `episode-card-${seriesId}-${seasonNum}-${index}`;
        card.onclick = () => openEpisode(seriesId, seasonNum, index);

        card.innerHTML = `
            <img src="${episode.thumbnail || ''}" alt="${episode.title || ''}" class="episode-card-thumb" loading="lazy">
            <div class="episode-card-info">
                <h3>${episode.episodeNumber || index + 1}. ${episode.title || ''}</h3>
                <p class="episode-description">${episode.description || ''}</p>
            </div>`;
            
        container.appendChild(card);

        let hoverTimer;
        card.addEventListener('mouseenter', () => { hoverTimer = setTimeout(() => { card.classList.add('expanded'); }, 1000); });
        card.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); card.classList.remove('expanded'); });
    });
}

function openEpisode(seriesId, season, newEpisodeIndex) {
    const episode = appState.content.seriesEpisodes[seriesId]?.[season]?.[newEpisodeIndex];
    if (!episode) return;
    
    clearTimeout(appState.player.episodeOpenTimer);
    appState.player.pendingHistorySave = null;

    appState.player.episodeOpenTimer = setTimeout(() => {
        appState.player.pendingHistorySave = {
            contentId: seriesId,
            type: 'series',
            episodeInfo: { season: season, index: newEpisodeIndex, title: episode.title || '' }
        };
    }, 20000); 

    DOM.seriesPlayerModal.querySelectorAll(`.episode-card.active`).forEach(c => c.classList.remove('active'));
    const activeCard = DOM.seriesPlayerModal.querySelector(`#episode-card-${seriesId}-${season}-${newEpisodeIndex}`);
    if (activeCard) {
        activeCard.classList.add('active');
        activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    appState.player.state[seriesId] = { ...appState.player.state[seriesId], season, episodeIndex: newEpisodeIndex };
    saveProgress(seriesId);
    
    const iframe = DOM.seriesPlayerModal.querySelector(`#video-frame-${seriesId}`);
    const lang = appState.player.state[seriesId]?.lang || 'es';
    
    let videoId;
    if (lang === 'en' && episode.videoId_en) {
        videoId = episode.videoId_en;
    } else if (lang === 'es' && episode.videoId_es) {
        videoId = episode.videoId_es;
    } else {
        videoId = episode.videoId;
    }

    iframe.src = videoId ? `https://drive.google.com/file/d/${videoId}/preview` : '';
    
    const episodeNumber = episode.episodeNumber || newEpisodeIndex + 1;
    DOM.seriesPlayerModal.querySelector(`#cinema-title-${seriesId}`).textContent = `T${String(season).replace('T', '')} E${episodeNumber} - ${episode.title || ''}`;
    DOM.seriesPlayerModal.querySelectorAll(`.lang-btn`).forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });
    
    updateNavButtons(seriesId, season, newEpisodeIndex);
}

function navigateEpisode(seriesId, direction) {
    commitAndClearPendingSave();

    const { season, episodeIndex } = appState.player.state[seriesId];
    const newIndex = episodeIndex + direction;
    const seasonEpisodes = appState.content.seriesEpisodes[seriesId][season];

    if (newIndex >= 0 && newIndex < seasonEpisodes.length) {
        openEpisode(seriesId, season, newIndex);
    }
}

function updateNavButtons(seriesId, season, episodeIndex) {
    const totalEpisodes = appState.content.seriesEpisodes[seriesId][season].length;
    DOM.seriesPlayerModal.querySelector(`#prev-btn-${seriesId}`).disabled = (episodeIndex === 0);
    DOM.seriesPlayerModal.querySelector(`#next-btn-${seriesId}`).disabled = (episodeIndex === totalEpisodes - 1);
}

function changeLanguage(seriesId, lang) {
    appState.player.state[seriesId].lang = lang;
    const { season, episodeIndex } = appState.player.state[seriesId];
    openEpisode(seriesId, season, episodeIndex);
}

function saveProgress(seriesId) {
    try {
        let allProgress = JSON.parse(localStorage.getItem('seriesProgress')) || {};
        if (!allProgress[seriesId]) allProgress[seriesId] = {};
        allProgress[seriesId][appState.player.state[seriesId].season] = appState.player.state[seriesId].episodeIndex;
        localStorage.setItem('seriesProgress', JSON.stringify(allProgress));
    } catch (e) { console.error("Error al guardar progreso:", e); }
}

function loadProgress(seriesId, seasonNum) {
    try {
        const allProgress = JSON.parse(localStorage.getItem('seriesProgress'));
        return allProgress?.[seriesId]?.[seasonNum] || 0;
    } catch (e) { return 0; }
}

// ===========================================================
// 8. MODAL DE CONFIRMACIÓN
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
// 9. FUNCIONES DE UTILIDAD Y HELPERS
// ===========================================================
function createMovieCardElement(id, data, type, layout = 'carousel', lazy = false, options = {}) {
    const card = document.createElement('div');
    card.className = `movie-card ${layout === 'carousel' ? 'carousel-card' : ''}`;
    card.dataset.contentId = id;

    card.onclick = (e) => {
        if (e.target.closest('.btn-watchlist') || e.target.closest('.btn-remove-history')) {
            return;
        }
        if (options.source === 'history' && type === 'series' && options.season) {
            openSeriesPlayerDirectlyToSeason(id, options.season);
        } else {
            openDetailsModal(id, type);
        }
    };
    
    let watchlistBtnHTML = '';
    if(auth.currentUser){
        const isInList = appState.user.watchlist.has(id);
        const icon = isInList ? 'fa-check' : 'fa-plus';
        const inListClass = isInList ? 'in-list' : '';
        watchlistBtnHTML = `<button class="btn-watchlist ${inListClass}" data-content-id="${id}"><i class="fas ${icon}"></i></button>`;
    }

    let ratingHTML = '';
    const metadata = type === 'movie' ? appState.content.metadata.movies[id] : appState.content.metadata.series[id];
    if (metadata && metadata.avgRating > 0) {
        const avg = metadata.avgRating.toFixed(1);
        ratingHTML = `<div class="card-rating"><i class="fas fa-star"></i> ${avg}</div>`;
    }

    // 🆕 USO DE LAZY LOADING
    const imgHTML = lazy 
        ? `<img data-src="${data.poster}" alt="${data.title}" data-width="200" data-height="300">`
        : `<img src="${data.poster}" alt="${data.title}">`;

    card.innerHTML = `
        ${imgHTML}
        ${watchlistBtnHTML}
        ${ratingHTML}
    `;

    return card;
}

function openSeriesPlayerDirectlyToSeason(seriesId, seasonNum) {
    const seriesInfo = appState.content.series[seriesId];
    if (!seriesInfo) return;

    closeAllModals();
    document.body.classList.add('modal-open');
    DOM.seriesPlayerModal.classList.add('show');
    
    renderEpisodePlayer(seriesId, seasonNum);
}

function openPlayerToEpisode(seriesId, seasonNum, episodeIndex) {
    const seriesInfo = appState.content.series[seriesId];
    if (!seriesInfo) return;
    closeAllModals();
    document.body.classList.add('modal-open');
    DOM.seriesPlayerModal.classList.add('show');
    renderEpisodePlayer(seriesId, seasonNum, episodeIndex);
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// 🆕 CON LAZY LOADING
function loadMoreContent(type) {
    if (appState.flags.isLoadingMore || appState.ui.currentIndex >= appState.ui.contentToDisplay.length) return;
    
    appState.flags.isLoadingMore = true;
    const gridEl = DOM.gridContainer.querySelector('.grid');
    const nextIndex = Math.min(appState.ui.currentIndex + ITEMS_PER_LOAD, appState.ui.contentToDisplay.length);
    for (let i = appState.ui.currentIndex; i < nextIndex; i++) {
        const [id, item] = appState.ui.contentToDisplay[i];
        gridEl.appendChild(createMovieCardElement(id, item, type, 'grid', true));
    }
    
    // 🆕 RE-OBSERVAR NUEVAS IMÁGENES
    lazyLoader.observeImages();
    
    appState.ui.currentIndex = nextIndex;
    appState.flags.isLoadingMore = false;
}

// ===========================================================
// 10. PERFIL Y AJUSTES DE USUARIO
// ===========================================================
function setupUserDropdown() {
    if (DOM.userGreetingBtn && DOM.userMenuDropdown) {
        DOM.userGreetingBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            DOM.userMenuDropdown.classList.toggle('show');
        });

        DOM.userMenuDropdown.addEventListener('click', (e) => {
            const link = e.target.closest('a[data-action]');
            if (!link) return;
            
            e.preventDefault();
            const action = link.dataset.action;

            if (action === 'logout') {
                auth.signOut();
            } else if (action === 'profile' || action === 'settings') {
                document.querySelectorAll('.main-nav a, .mobile-nav a').forEach(l => l.classList.remove('active'));
                switchView(action);
            }
            
            DOM.userMenuDropdown.classList.remove('show');
        });

        document.addEventListener('click', (e) => {
            if (!DOM.userMenuDropdown.contains(e.target) && !DOM.userGreetingBtn.contains(e.target)) {
                DOM.userMenuDropdown.classList.remove('show');
            }
        });
    }
}

function renderProfile() {
    const user = auth.currentUser;
    if (!user) {
        switchView('all');
        return;
    }

    DOM.profileUsername.textContent = user.displayName || 'Usuario';
    DOM.profileEmail.textContent = user.email;

    const tabs = document.querySelectorAll('.profile-tab');
    const tabContents = document.querySelectorAll('.profile-tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const tabName = tab.dataset.tab;
            tabContents.forEach(content => {
                content.classList.toggle('active', content.id === `${tabName}-tab`);
            });

            if (tabName === 'activity') {
                calculateAndDisplayUserStats();
            } else if (tabName === 'ratings') {
                renderRatingsHistory();
            }
        });
    });

    if (tabs.length > 0) {
        tabs[0].click();
    }
}

function renderSettings() {
    const user = auth.currentUser;
    if (!user) {
        switchView('all');
        return;
    }

    DOM.settingsUsernameInput.value = user.displayName || '';

    DOM.updateUsernameBtn.onclick = async () => {
        const newUsername = DOM.settingsUsernameInput.value.trim();
        if (newUsername && newUsername !== user.displayName) {
            try {
                await user.updateProfile({ displayName: newUsername });
                db.ref(`users/${user.uid}/profile/displayName`).set(newUsername);
                showFeedbackMessage('Nombre de usuario actualizado correctamente.', 'success');
                DOM.userGreetingBtn.textContent = `Hola, ${newUsername}`;
            } catch (error) {
                console.error("Error al actualizar nombre:", error);
                showFeedbackMessage(`Error: ${error.message}`, 'error');
            }
        } else {
            showFeedbackMessage('Por favor, ingresa un nombre válido y diferente.', 'error');
        }
    };

    DOM.updatePasswordBtn.onclick = async () => {
        const newPassword = DOM.settingsPasswordInput.value;
        if (newPassword.length >= 6) {
            try {
                await user.updatePassword(newPassword);
                showFeedbackMessage('Contraseña actualizada correctamente.', 'success');
                DOM.settingsPasswordInput.value = '';
            } catch (error) {
                console.error("Error al actualizar contraseña:", error);
                showFeedbackMessage(`Error: ${error.message}`, 'error');
            }
        } else {
            showFeedbackMessage('La contraseña debe tener al menos 6 caracteres.', 'error');
        }
    };
}

function showFeedbackMessage(message, type) {
    const feedbackElement = document.getElementById('settings-feedback');
    feedbackElement.textContent = message;
    feedbackElement.className = `feedback-message ${type}`;
    feedbackElement.style.display = 'block';
    
    setTimeout(() => {
        feedbackElement.style.display = 'none';
        feedbackElement.textContent = '';
        feedbackElement.className = 'feedback-message';
    }, 5000);
}

function generateStaticStars(rating) {
    const totalStars = 5;
    let starsHTML = '';
    const fullStars = Math.floor(rating);
    const halfStar = rating % 1 >= 0.3;
    const emptyStars = totalStars - fullStars - (halfStar ? 1 : 0);

    for (let i = 0; i < fullStars; i++) starsHTML += '<i class="fas fa-star"></i>';
    if (halfStar) starsHTML += '<i class="fas fa-star-half-alt"></i>';
    for (let i = 0; i < emptyStars; i++) starsHTML += '<i class="far fa-star"></i>';
    
    return starsHTML;
}

async function calculateAndDisplayUserStats() {
    const user = auth.currentUser;
    if (!user) return;

    const [historySnapshot, ratingsSnapshot] = await Promise.all([
        db.ref(`users/${user.uid}/history`).once('value'),
        db.ref('ratings').once('value')
    ]);

    if (!historySnapshot.exists()) {
        document.querySelector('.stats-container').innerHTML = `<p class="empty-message">Aún no tienes actividad para mostrar estadísticas.</p>`;
        return;
    }

    const history = historySnapshot.val();
    const allRatings = ratingsSnapshot.val() || {};

    let moviesWatched = 0;
    const seriesWatched = new Set();
    let genreCounts = {};
    let userTotalRating = 0;
    let userRatingCount = 0;
    let totalItemsInHistory = 0;

    for (const item of Object.values(history)) {
        totalItemsInHistory++;
        if (item.type === 'movie') {
            moviesWatched++;
        } else if (item.type === 'series') {
            seriesWatched.add(item.contentId);
        }

        const content = appState.content.movies[item.contentId] || appState.content.series[item.contentId];
        if (content && content.genres) {
            content.genres.split(';').forEach(genreStr => {
                const genre = genreStr.trim();
                if (genre) {
                    genreCounts[genre] = (genreCounts[genre] || 0) + 1;
                }
            });
        }
    }

    Object.values(allRatings).forEach(contentRatings => {
        if (contentRatings[user.uid]) {
            userTotalRating += contentRatings[user.uid];
            userRatingCount++;
        }
    });

    document.getElementById('stat-movies-watched').textContent = moviesWatched;
    document.getElementById('stat-series-watched').textContent = seriesWatched.size;
    document.getElementById('stat-total-items').textContent = totalItemsInHistory;
    document.getElementById('stat-avg-rating').textContent = userRatingCount > 0 ? (userTotalRating / userRatingCount).toFixed(1) : 'N/A';

    const genreStatsContainer = document.getElementById('genre-stats-container');
    genreStatsContainer.innerHTML = '';
    const sortedGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxCount = sortedGenres.length > 0 ? sortedGenres[0][1] : 0;

    sortedGenres.forEach(([genre, count]) => {
        const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;
        const barHtml = `
            <div class="genre-stat-bar">
                <span class="genre-label">${genre}</span>
                <div class="genre-progress">
                    <div class="genre-progress-fill" style="width: ${percentage}%;"></div>
                </div>
                <span class="genre-count">${count}</span>
            </div>`;
        genreStatsContainer.insertAdjacentHTML('beforeend', barHtml);
    });
}

async function renderRatingsHistory() {
    const user = auth.currentUser;
    if (!user) return;

    const ratingsSnapshot = await db.ref('ratings').once('value');
    const container = document.getElementById('ratings-history-container');
    container.innerHTML = '';

    if (!ratingsSnapshot.exists()) {
        container.innerHTML = `<p class="empty-message">Aún no has calificado ningún título.</p>`;
        return;
    }

    const allRatings = ratingsSnapshot.val();
    const userRatings = [];

    for (const [contentId, ratings] of Object.entries(allRatings)) {
        if (ratings[user.uid]) {
            const contentType = appState.content.movies[contentId] ? 'movie' : 'series';
            const contentData = appState.content.movies[contentId] || appState.content.series[contentId];
            if (contentData) {
                userRatings.push({
                    id: contentId,
                    title: contentData.title,
                    poster: contentData.poster,
                    rating: ratings[user.uid],
                    type: contentType
                });
            }
        }
    }

    if (userRatings.length === 0) {
        container.innerHTML = `<p class="empty-message">Aún no has calificado ningún título.</p>`;
        return;
    }

    userRatings.forEach(item => {
        const ratingHtml = `
            <div class="rating-item">
                <img src="${item.poster}" alt="${item.title}" class="rating-item-poster">
                <div class="rating-item-info">
                    <h5 class="rating-item-title">${item.title}</h5>
                    <div class="rating-item-stars">${generateStaticStars(item.rating)}</div>
                </div>
                <button class="btn-delete-rating" data-content-id="${item.id}" data-rating-value="${item.rating}" data-content-type="${item.type}" title="Eliminar calificación">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>`;
        container.insertAdjacentHTML('beforeend', ratingHtml);
    });

    container.querySelectorAll('.btn-delete-rating').forEach(button => {
        button.addEventListener('click', (e) => {
            const currentButton = e.currentTarget;
            const contentId = currentButton.dataset.contentId;
            const ratingValue = parseInt(currentButton.dataset.ratingValue);
            const contentType = currentButton.dataset.contentType;
            
            openConfirmationModal(
                'Eliminar Calificación',
                '¿Estás seguro de que quieres eliminar tu calificación para este título? Podrás volver a calificarlo más tarde.',
                () => deleteRating(contentId, ratingValue, contentType)
            );
        });
    });
}

async function deleteRating(contentId, oldRating, type) {
    const user = auth.currentUser;
    if (!user) return;

    try {
        await db.ref(`ratings/${contentId}/${user.uid}`).remove();

        const metadataRef = db.ref(`${type}_metadata/${contentId}`);
        await metadataRef.transaction(currentData => {
            if (currentData === null) return null;

            let newTotalScore = (currentData.totalScore || 0) - oldRating;
            let newRatingCount = (currentData.ratingCount || 0) - 1;

            if (newRatingCount <= 0) {
                return null;
            }

            const newAvgRating = newTotalScore / newRatingCount;
            return { avgRating: newAvgRating, ratingCount: newRatingCount, totalScore: newTotalScore };
        });

        const updatedMetadata = (await metadataRef.once('value')).val();
        if (type === 'movie') { 
            appState.content.metadata.movies[contentId] = updatedMetadata; 
        } else { 
            appState.content.metadata.series[contentId] = updatedMetadata; 
        }

        renderRatingsHistory();
        
    } catch (error) {
        console.error("Error al eliminar la calificación:", error);
    } finally {
        closeAllModals();
    }
}

// ===========================================================
// 🎯 EXPORTAR PARA USO GLOBAL
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
// 📝 NOTAS DE IMPLEMENTACIÓN
// ===========================================================
/*
CAMBIOS PRINCIPALES EN ESTA VERSIÓN:

✅ IMPLEMENTADO:
1. Sistema de gestión de errores (ErrorHandler)
   - Notificaciones elegantes para el usuario
   - Manejo automático de errores de Firebase y Fetch
   
2. Sistema de caché avanzado (CacheManager)
   - Versionado automático
   - TTL (Time To Live)
   - Limpieza automática
   - Carga instantánea en visitas repetidas

3. Lazy Loading inteligente (LazyImageLoader)
   - Efecto blur-up mientras carga
   - IntersectionObserver para detección
   - Placeholders automáticos en errores

4. Optimización del Hero
   - Precarga de imágenes
   - Transiciones suaves sin parpadeos
   - Cache de imágenes precargadas

5. Mejoras en watchlist y historial
   - Manejo de errores mejorado
   - Feedback visual inmediato

CÓMO USAR:

1. Reemplaza tu script.js actual con este archivo
2. Configura Firebase Security Rules (ver artifact "firebase_functions")
3. Prueba la aplicación:
   - Primera carga: debería ver spinner
   - Segunda carga: UI instantánea
   - Sin internet: mensaje de error elegante
   
FUNCIONES ÚTILES EN CONSOLA:

- showCacheStats() → Ver estado del caché
- cacheManager.clearAll() → Limpiar todo el caché
- ErrorHandler.show('network', 'Mensaje personalizado') → Probar notificaciones

PRÓXIMOS PASOS OPCIONALES:

1. Implementar Cloud Functions (ver artifact "firebase_functions")
2. Añadir Accesibilidad (ver artifact "accessibility_improvements")
3. Implementar Analytics (ver artifact "analytics_system")
4. Sistema de Modales unificado (ver artifact "modal_manager")

IMPORTANTE:
- Las Firebase Security Rules SON CRÍTICAS → Implementar YA
- Este código es compatible con tu HTML y CSS existentes
- No necesitas cambiar index.html ni style.css
- Los estilos se inyectan automáticamente desde JS

SOPORTE:
Si algo no funciona:
1. Abre DevTools (F12)
2. Busca errores en la pestaña Console
3. Verifica que Firebase esté configurado
4. Confirma que las URLs de API sean correctas

VERSIÓN: 2.0.0
ÚLTIMA ACTUALIZACIÓN: 2025-01-07
COMPATIBILIDAD: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
*/



