// ===========================================================
// CINE CORNETA - SCRIPT PRINCIPAL
// Versión: 8.3.5 (14 de Feberero 2026)
// ===========================================================

// ===========================================================
// 1. IMPORTS
// ===========================================================
import { API_URL, firebaseConfig, UI } from './core/config.js';
import { logError, ErrorHandler } from './utils/logger.js';
import CacheManager from './utils/cache-manager.js';
import ModalManager from './utils/modal-manager.js';
import ContentManager from './utils/content-manager.js';
import ThemeManager, { updateThemeAssets } from './utils/theme-manager.js';
import LazyImageLoader from './utils/lazy-loader.js';

// Instancias vacías (se llenan abajo)
let cacheManager;
let modalManager;
let lazyLoader;
let contentManager;

// ==========================================
// PEGAR ESTO ANTES DE 'let playerModule = null;'
// ==========================================
function checkUserLogin() {
    const user = JSON.parse(localStorage.getItem('cineCornetoUser'));
    
    // Mantener estructura de appState.user incluso sin usuario logueado
    if (typeof appState !== 'undefined') {
        if (user) {
            appState.user = {
                ...user,
                watchlist: appState.user?.watchlist || new Set(),
                historyListenerRef: appState.user?.historyListenerRef || null
            };
        } else {
            appState.user = {
                watchlist: new Set(),
                historyListenerRef: null
            };
        }
    }

    // 1. Saludo Escritorio
    if (typeof DOM !== 'undefined' && DOM.userGreeting) {
        DOM.userGreeting.textContent = user ? `Hola, ${user.username}` : '';
    }

    // 2. Email en Profile Hub Móvil
    const profileHubEmail = document.getElementById('profile-hub-email');
    if (profileHubEmail) {
        if (user) {
            profileHubEmail.textContent = user.email;
            profileHubEmail.style.display = 'block';
        } else {
            profileHubEmail.textContent = 'Visitante';
            profileHubEmail.style.display = 'block';
        }
    }

    // 3. Menús
    if (typeof DOM !== 'undefined') {
        if (user) {
            if(DOM.loginBtn) DOM.loginBtn.style.display = 'none';
            if(DOM.userMenuContainer) DOM.userMenuContainer.style.display = 'block';
        } else {
            if(DOM.loginBtn) DOM.loginBtn.style.display = 'block';
            if(DOM.userMenuContainer) DOM.userMenuContainer.style.display = 'none';
            if(DOM.userMenuDropdown && DOM.userMenuDropdown.classList) DOM.userMenuDropdown.classList.remove('show');
        }
    }
}

// Módulos dinámicos
let playerModule = null;
let profileModule = null;
let rouletteModule = null;
let reviewsModule = null; // 🔥 NUEVO

async function getPlayerModule() {
    if (playerModule) return playerModule;
    const module = await import('./features/player.js');
    module.initPlayer({
        appState, DOM, ErrorHandler, auth, db,
        addToHistoryIfLoggedIn, 
        closeAllModals: () => modalManager.closeAll(), 
        openDetailsModal
    });
    playerModule = module;
    return playerModule;
}

async function getProfileModule() {
    if (profileModule) return profileModule;
    const module = await import('./features/profile.js?v=7');
    module.initProfile({
        appState, DOM, auth, db, switchView, ErrorHandler
    });
    profileModule = module;
    module.setupUserDropdown();
    return profileModule;
}

async function getRouletteModule() {
    if (rouletteModule) return rouletteModule;
    const module = await import('./features/roulette.js');
    module.initRoulette({
        appState, DOM, createMovieCardElement, openDetailsModal
    });
    rouletteModule = module;
    return module;
}

async function getReviewsModule() {
    if (reviewsModule) return reviewsModule;
    const module = await import('./features/reviews.js');
    module.initReviews({
        appState, DOM, auth, db, ErrorHandler, ModalManager, openConfirmationModal
    });
    reviewsModule = module;
    return module;
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
        metadata: { movies: {}, series: {} },
        averages: {}     // 🔥 Promedios de ratings (se llena desde el módulo de reviews)
    },
    ui: {
        heroMovieIds: [],
        contentToDisplay: [],
        currentIndex: 0,
        heroInterval: null,
        activeSagaId: null
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

window.appState = appState; // Exponer a módulos


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

    // =========================================================================
    // INICIALIZAR MÓDULOS CORE
    // =========================================================================
    // Inicializar CLASES (con 'new')
    cacheManager = new CacheManager();
    lazyLoader = new LazyImageLoader();
    
    // Asignar OBJETOS (sin 'new')
    modalManager = ModalManager;
    contentManager = ContentManager;

    // Actualizar tema (función standalone)
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
        
        // 🔥 Inicializar módulo de reviews ANTES de setupRatingsListener
        await getReviewsModule();
        
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
                ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=series`),
                ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=episodes`),
                ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=allMovies&order=desc`),
                ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=PostersTemporadas`),
                ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=sagas_list`),
                db.ref('movie_metadata').once('value').then(s => s.val() || {}),
                db.ref('series_metadata').once('value').then(s => s.val() || {})
            ]);

            // 2. CARGA DINÁMICA DE SAGAS (Una petición por cada saga en la lista)
            const sagasArray = Object.values(sagasListData || {});
            const sagasRequests = sagasArray.map(saga => 
                ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=${saga.id}`)
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
            
            // 🔥 Inicializar módulo de reviews
            await getReviewsModule();
            
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
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=series`),
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=episodes`),
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=allMovies&order=desc`),
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=PostersTemporadas`),
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=sagas_list`)
        ]);

        // 2. Pedimos las sagas dinámicamente
        const sagasArray = Object.values(sagasListData || {});
        const sagasRequests = sagasArray.map(saga => 
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=${saga.id}`)
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
    if (link.classList.contains('active') && !['history', 'my-list', 'profile', 'profile-hub', 'settings'].includes(filter)) return;

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

    // 🔥 FIX: Limpiamos la clase 'active' de TODOS los enlaces (incluyendo el dropdown)
    // Antes solo limpiabas .main-nav, por eso el dropdown se quedaba "pegado"
    document.querySelectorAll('a[data-filter]').forEach(link => {
        link.classList.remove('active');
    });
    
    if (filter) {
        // Iluminar el nuevo botón activo
        const selector = `a[data-filter="${filter}"]`;
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

    // 🔥 FIX: Ocultar explícitamente los botones de Sagas/Universos
    // Esto evita que salgan en el buscador o en otras secciones
    const ucmButtons = document.getElementById('ucm-sort-buttons');
    if (ucmButtons) ucmButtons.style.display = 'none';

    const backSagaBtn = document.getElementById('back-to-sagas-btn');
    if (backSagaBtn) backSagaBtn.style.display = 'none';

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
        
        // Guardar el ID de la saga activa para los botones de ordenamiento
        appState.ui.activeSagaId = isDynamicSaga ? filter : null;

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
            // 🔥 Llamar al módulo de reviews
            if (reviewsModule && reviewsModule.renderReviewsGrid) {
                reviewsModule.renderReviewsGrid();
            }
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

        const idsToHide = [
            'filter-controls',
            'genre-dropdown-visual',
            'lang-dropdown-visual',
            'request-dropdown-visual',
            'sort-dropdown-visual',
            'letter-dropdown-visual',
            'ucm-sort-buttons',
            'back-to-sagas-btn',
            'pagination-controls'
        ];

        idsToHide.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.setProperty('display', 'none', 'important');
        });

        return;
    }

    window.scrollTo(0, 0);
}

// ==========================================
// FUNCIÓN: POPULAR FILTROS (CON PEDIDOS)
// ==========================================
function populateFilters(type) {
    let sourceData;
    if (type === 'movie') sourceData = appState.content.movies;
    else if (type === 'series') sourceData = appState.content.series;
    else sourceData = appState.content.sagas[type];

    // LEER CONFIGURACIÓN
    const sagaConfig = appState.content.sagasList.find(s => s.id === type) || {};
    const confGenres = (sagaConfig.genres_filter || 'si').toLowerCase().trim();
    const confSortBtn = (sagaConfig.sort_buttons || 'no').toLowerCase().trim();
    const confLang = (sagaConfig.lang_filter || 'si').toLowerCase().trim();

    // Elementos del DOM
    const genreVisual = document.getElementById('genre-dropdown-visual');
    const sortVisual  = document.getElementById('sort-dropdown-visual');
    const langVisual  = document.getElementById('lang-dropdown-visual');
    const letterVisual = document.getElementById('letter-dropdown-visual');
    const requestVisual = document.getElementById('request-dropdown-visual'); // 🔥 NUEVO

    const genreList = document.getElementById('genre-menu-list');
    const langList  = document.getElementById('lang-menu-list');
    const letterList = document.getElementById('letter-menu-list');
    const requestList = document.getElementById('request-menu-list'); // 🔥 NUEVO
    
    // Selects ocultos
    const requestSelect = document.getElementById('request-filter'); // 🔥 NUEVO
    const letterSelect = document.getElementById('letter-filter');

    const controlsContainer = document.getElementById('filter-controls');
    if (controlsContainer) controlsContainer.style.display = 'flex';

    // Helper para crear items
    const createItem = (value, label, menuType, isGroup = false, imgUrl = null) => {
        const div = document.createElement('div');
        div.className = isGroup ? 'dropdown-group-title' : 'dropdown-item';
        
        // MANTÉN ESTA LÍNEA, ES EL ARREGLO:
        if (value) div.dataset.value = value; 

        if (isGroup && imgUrl) {
            div.innerHTML = `<img src="${imgUrl}" class="dropdown-group-logo" alt="${label}">`;
            div.classList.add('has-logo');
        } else {
            div.textContent = label;
        }

        if (isGroup && value) div.style.cursor = "pointer";

        div.onclick = (e) => {
            e.stopPropagation(); 
            
            // (Aquí borraste el console.log de CLICK DETECTADO)

            if (menuType === 'genre') {
                document.getElementById('genre-text').textContent = label; 
                DOM.genreFilter.value = value; 
                if (genreVisual) genreVisual.classList.remove('open');
            } else if (menuType === 'lang') {
            // 1. Cambiar el texto visual del botón
            document.getElementById('lang-text').textContent = label;
            
            // 2. Actualizar el valor del selector oculto (el cerebro)
            DOM.langFilter.value = value;
            
            // 3. Cerrar el menú
            if (langVisual) langVisual.classList.remove('open');
            
            // 4. ¡IMPORTANTE! Aplicar el filtro inmediatamente
            applyAndDisplayFilters(appState.ui.activeSagaId || appState.currentFilter || 'movie');

            } else if (menuType === 'request') { 
                document.getElementById('request-text').textContent = label === 'Todos' ? 'Pedidos' : label;
                if(requestSelect) requestSelect.value = value;
                if (requestVisual) requestVisual.classList.remove('open');
            } else {
                // (Aquí borraste el console.log de CAMBIANDO ORDEN)
                document.getElementById('sort-text').textContent = label;
                DOM.sortBy.value = value;
                if (sortVisual) sortVisual.classList.remove('open');
            }
            applyAndDisplayFilters(type);
        };
        return div;
    };

    // --- VISIBILIDAD DE FILTROS ---
    if (genreVisual) genreVisual.style.display = (confGenres !== 'no') ? 'block' : 'none';
    if (langVisual) langVisual.style.display = (confLang === 'si') ? 'block' : 'none';
    if (letterVisual) letterVisual.style.display = 'block';
    
    // VISIBILIDAD PEDIDOS (Siempre visible en pelis/series)
    if (requestVisual) {
        // Si estamos en 'movie' o 'series' lo mostramos, si es Saga lo ocultamos
        if (type === 'movie' || type === 'series') {
            requestVisual.style.display = 'block';
        } else {
            requestVisual.style.display = 'none';
        }
    }

    // Sort Buttons
    const ucmButtons = document.getElementById('ucm-sort-buttons');
    if (ucmButtons) {
        ucmButtons.style.display = (confSortBtn === 'si') ? 'flex' : 'none';
        if (sortVisual) sortVisual.style.display = (confSortBtn === 'si') ? 'none' : 'block';
    } else {
        if (sortVisual) sortVisual.style.display = 'block';
    }

    // --- POBLAR LISTAS ---

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

    // 5. POPULAR IDIOMAS (DINÁMICO - Solo si está activado)
    if (confLang === 'si' && langList) {
        langList.innerHTML = '';
        DOM.langFilter.innerHTML = `<option value="all">Todos</option>`;
    
    // Opción "Todos"
    langList.appendChild(createItem('all', 'Todos', 'lang'));
    document.getElementById('lang-text').textContent = "Idioma";
    
    // Extraer idiomas únicos del contenido
    const languages = new Set();
    Object.values(sourceData).forEach(item => {
        // 🔥 CORRECCIÓN: Busca 'language', 'idioma' o 'audio'
        const rawLang = item.language || item.idioma || item.audio || ""; 
        
        if (rawLang && String(rawLang).trim() !== "") {
            // Manejar múltiples idiomas separados por punto y coma
            const langs = String(rawLang).split(';').map(l => l.trim()).filter(Boolean);
            langs.forEach(lang => languages.add(lang));
        }
    });
    
    // Crear opciones ordenadas alfabéticamente
    Array.from(languages).sort().forEach(lang => {
            langList.appendChild(createItem(lang, lang, 'lang'));
            DOM.langFilter.innerHTML += `<option value="${lang}">${lang}</option>`;
        });
    }

    // 3. SORT - Menú de Ordenamiento Completo
    const sortList = document.getElementById('sort-menu-list');
    
    // ✅ BLOQUE NUEVO PARA RESETEAR BOTONES DE SAGAS
    if (confSortBtn === 'si') {
        const btnRelease = document.querySelector('.sort-btn[data-sort="release"]');
        const btnChrono = document.querySelector('.sort-btn[data-sort="chronological"]');
        
        // Si existen los botones, forzamos que "Release" sea el activo por defecto
        if (btnRelease && btnChrono) {
            // Quitamos activo de todos y ponemos en release
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            btnRelease.classList.add('active');
            
            // Actualizamos la variable global (si la usas)
            if (DOM.sortBy) DOM.sortBy.value = 'release';
        }
    }

    if (confSortBtn === 'no' && sortList) {
        sortList.innerHTML = '';

        if (DOM.sortBy) DOM.sortBy.innerHTML = ''; 
        
        const sortOptions = [
            {val:'recent', label:'Recientes'},
            {val:'title-asc', label:'Título (A-Z)'}, 
            {val:'title-desc', label:'Título (Z-A)'},
            {val:'year-desc', label:'Año (Desc.)'}, 
            {val:'year-asc', label:'Año (Asc.)'}
        ];

        if (type !== 'series') {
            sortOptions.push(
                {val:'duration-asc', label:'- Duración'}, 
                {val:'duration-desc', label:'+ Duración'}
            );
        }
        
        sortOptions.forEach(o => {
            sortList.appendChild(createItem(o.val, o.label, 'sort'));

            if (DOM.sortBy) {
                const option = document.createElement('option');
                option.value = o.val;
                option.textContent = o.label;
                DOM.sortBy.appendChild(option);
            }
        });
    }

    // 4. FILTRO DE LETRAS (DINÁMICO - Solo letras que existen)
    if (letterList && letterSelect) {
        letterList.innerHTML = '';
        letterSelect.innerHTML = `<option value="all">Todas</option>`;
        
        // Opción "Todas"
        letterList.appendChild(createItem('all', 'Todas', 'letter'));
        
        // Extraer las primeras letras de todos los títulos
        const firstLetters = new Set();
        let hasNumbers = false;
        
        Object.values(sourceData).forEach(item => {
            if (item.title) {
                const firstChar = String(item.title).trim().charAt(0).toUpperCase();
                if (firstChar) {
                    // Verificar si es número
                    if (!isNaN(parseInt(firstChar))) {
                        hasNumbers = true;
                    } else if (/[A-Z]/.test(firstChar)) {
                        // Solo agregar si es letra A-Z
                        firstLetters.add(firstChar);
                    }
                }
            }
        });
        
        // Agregar opción "0-9" solo si hay títulos que empiecen con número
        if (hasNumbers) {
            letterList.appendChild(createItem('#', '0-9', 'letter'));
            letterSelect.innerHTML += `<option value="#">0-9</option>`;
        }
        
        // Agregar letras que realmente existen, ordenadas alfabéticamente
        Array.from(firstLetters).sort().forEach(letter => {
            letterList.appendChild(createItem(letter, letter, 'letter'));
            letterSelect.innerHTML += `<option value="${letter}">${letter}</option>`;
        });
    }

    // 🔥 5. FILTRO DE PEDIDOS (NUEVO)
    if (requestList && requestSelect) {
        
        // --- AGREGA ESTA LÍNEA AQUÍ ---
        document.getElementById('request-text').textContent = "Pedidos"; 
        // ------------------------------

        requestList.innerHTML = '';
        requestSelect.innerHTML = `<option value="all">Todos</option>`;
        
        // Opción "Todos"
        requestList.appendChild(createItem('all', 'Todos', 'request'));

        // Extraer Nombres Únicos de la columna 'pedido'
        const requestNames = new Set();
        Object.values(sourceData).forEach(item => {
            if (item.pedido && item.pedido.trim() !== "") {
                requestNames.add(item.pedido.trim());
            }
        });

        // Crear opciones ordenadas
        Array.from(requestNames).sort().forEach(name => {
            requestList.appendChild(createItem(name, name, 'request'));
            requestSelect.innerHTML += `<option value="${name}">${name}</option>`;
        });
        
        // Si no hay pedidos, ocultamos el filtro para que no estorbe
        if (requestNames.size === 0) {
            requestVisual.style.display = 'none';
        }
    }
    
    // Triggers
    const configDropdown = (trigger, visual) => {
        if (!trigger) return;
        const newTrigger = trigger.cloneNode(true);
        trigger.parentNode.replaceChild(newTrigger, trigger);
        newTrigger.onclick = (e) => { 
            e.stopPropagation(); 
            [genreVisual, sortVisual, langVisual, letterVisual, requestVisual].forEach(v => {
                if(v && v !== visual) v.classList.remove('open');
            });
            visual.classList.toggle('open'); 
        };
    };

    if(document.getElementById('genre-trigger')) configDropdown(document.getElementById('genre-trigger'), genreVisual);
    if(document.getElementById('sort-trigger')) configDropdown(document.getElementById('sort-trigger'), sortVisual);
    if(document.getElementById('lang-trigger')) configDropdown(document.getElementById('lang-trigger'), langVisual); 
    if(document.getElementById('letter-trigger')) configDropdown(document.getElementById('letter-trigger'), letterVisual);
    if(document.getElementById('request-trigger')) configDropdown(document.getElementById('request-trigger'), requestVisual); // 🔥 NUEVO
}

// ==========================================
// FUNCIÓN: APLICAR Y MOSTRAR (CON FILTRO PEDIDOS)
// ==========================================
async function applyAndDisplayFilters(type) {
    let sourceData;
    if (type === 'movie') sourceData = appState.content.movies;
    else if (type === 'series') sourceData = appState.content.series;
    else sourceData = appState.content.sagas[type]; 

    const gridEl = DOM.gridContainer.querySelector('.grid');
    if (!gridEl || !sourceData) return;

    // CONFIGURACIÓN
    const sagaConfig = appState.content.sagasList.find(s => s.id === type) || {};
    const confGenres = (sagaConfig.genres_filter || 'si').toLowerCase().trim();
    const confSortBtn = (sagaConfig.sort_buttons || 'no').toLowerCase().trim();
    const confLang   = (sagaConfig.lang_filter || 'si').toLowerCase().trim();

    // Valores de filtros
    let sortByValue = (confSortBtn === 'si') ? 
        (document.querySelector('.sort-btn.active')?.dataset.sort || 'release') : 
        (DOM.sortBy.value || 'recent');
        
    const letterFilterVal = document.getElementById('letter-filter')?.value || 'all';

    const requestFilterVal = document.getElementById('request-filter')?.value || 'all';

    gridEl.innerHTML = `<div style="width:100%;height:60vh;display:flex;justify-content:center;align-items:center;grid-column:1/-1;"><p class="loading-text">Cargando...</p></div>`;

    // Datos
    let content = Object.entries(sourceData);
    const isDynamicSaga = (type !== 'movie' && type !== 'series');
    
    // 🔄 Para universos: invertir para respetar orden de arriba hacia abajo del Excel
    if (isDynamicSaga) content.reverse();
    
    // 🔥 SOLUCIÓN SIMPLE: Guardar el orden tal como viene del Excel
    // JavaScript moderno garantiza que Object.entries() mantiene el orden de inserción
    content.forEach((item, index) => { item[1]._originalIndex = index; });

    // --- APLICAR FILTROS ---
    
    // 1. GÉNERO / FASE / SAGA
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

    // 2. IDIOMA
    if (confLang === 'si' && DOM.langFilter && DOM.langFilter.value !== 'all') {
    const langVal = DOM.langFilter.value.toLowerCase().trim();
    content = content.filter(([id, item]) => {
        // 🔥 CORRECCIÓN: Busca en todas las posibles columnas de idioma
            const itemLang = String(item.language || item.idioma || item.audio || '').toLowerCase();
            return itemLang.includes(langVal);
        });
    }

    // 3. FILTRO POR INICIAL (A-Z)
    if (letterFilterVal !== 'all') {
        content = content.filter(([id, item]) => {
            const firstChar = String(item.title || '').trim().charAt(0).toUpperCase();
            if (letterFilterVal === '#') return !isNaN(parseInt(firstChar));
            return firstChar === letterFilterVal;
        });
    }

    // 🔥 4. FILTRO POR PEDIDOS (NUEVO)
    if (requestFilterVal !== 'all') {
        content = content.filter(([id, item]) => {
            // Comparamos el nombre exacto del pedido
            return String(item.pedido || '').trim() === requestFilterVal;
        });
    }

    // 5. ORDENAMIENTO
    content.sort((a, b) => {
        const idA = a[0]; const idB = b[0];
        const aData = a[1]; const bData = b[1];

        let result = 0; // Variable para almacenar el resultado del ordenamiento

        // 🔥 PARA SAGAS DINÁMICAS: Usar el orden del Excel como criterio PRINCIPAL
        if (isDynamicSaga) {
            // Función para obtener el valor de ordenamiento
            const getOrderValue = (data) => {
                const orderVal = data.order || data.number || data.id || data.stage || data.episode;
                if (orderVal !== undefined) {
                    // Si es número, usarlo directamente
                    const numVal = Number(orderVal);
                    if (!isNaN(numVal)) return numVal;
                }
                // Si no hay columna de orden o es texto (como "pelicula"), usar el índice original
                return data._originalIndex || 0;
            };
            
            result = getOrderValue(aData) - getOrderValue(bData);
            
            // Si ya hay un resultado claro, devolverlo sin aplicar otros criterios
            if (result !== 0) return result;
        }

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
                result = timeB - timeA; 
            }

            // 2. SI ES EMPATE EXACTO (Mismo día y hora, o sin hora)
            // Aquí usamos tu jerarquía como desempate: Estreno > Temp > Cap
            else if (timeA > 0) { 
                const getScore = (id, data, t) => {
                    if (isDateRecent(data.date_added)) return 3; // Estreno
                    if (t === 'series' && hasRecentSeasonFromPosters(id)) return 2; // Temp
                    if (t === 'series' && hasRecentEpisodes(id)) return 1; // Cap
                    return 0;
                };
                result = getScore(idB, bData, typeB) - getScore(idA, aData, typeA);
            }

            // 3. SI NO SON NUEVOS -> Ranking Normal
            else {
                result = (Number(bData.tr) || 0) - (Number(aData.tr) || 0);
            }
        }

        // ... resto de ordenamientos (A-Z, Año, etc) ...
        else if (sortByValue === 'chronological') {
            result = (Number(aData.cronologia) || 9999) - (Number(bData.cronologia) || 9999);
        }
        else if (sortByValue === 'year-asc') {
            result = (Number(aData.year) || 9999) - (Number(bData.year) || 9999);
        }
        else if (sortByValue === 'year-desc') {
            result = (Number(bData.year) || 0) - (Number(aData.year) || 0);
        }
        else if (sortByValue === 'title-asc') {
            result = (aData.title || '').localeCompare(bData.title || '');
        }
        else if (sortByValue === 'title-desc') {
            result = (bData.title || '').localeCompare(aData.title || '');
        }
        else if (sortByValue === 'duration-asc' || sortByValue === 'duration-desc') {
            const getMinutes = (item) => {
                // Buscamos la duración en cualquier columna posible
                const d = String(item.duration || item.duracion || '').toLowerCase().trim();
                if (!d) return 0;

                let minutes = 0;
                // Caso 1: Formato "1h 45m"
                const h = d.match(/(\d+)\s*h/);
                const m = d.match(/(\d+)\s*m/);
                if (h) minutes += parseInt(h[1]) * 60;
                if (m) minutes += parseInt(m[1]);

                // Caso 2: Formato "105 min" o solo numero "105"
                if (!h && !m) {
                    const num = parseInt(d.replace(/\D/g, '')); // Quita letras, deja números
                    if (!isNaN(num)) minutes = num;
                }
                return minutes;
            };

            const minA = getMinutes(aData);
            const minB = getMinutes(bData);

            if (sortByValue === 'duration-asc') result = minA - minB; // Cortas primero
            if (sortByValue === 'duration-desc') result = minB - minA; // Largas primero
        }

        return result;
    });


    // 5.5 EXPANSIÓN CRONOLÓGICA (Solo si se eligió ese orden)
    if (sortByValue === 'chronological') {
        const expandedContent = [];
        
        content.forEach(([id, item]) => {
            const multiChrono = item.cronologiaMulti || item.cronologia_multi; 
            
            if (multiChrono) {
                // 🔥 1. Obtenemos los pósters específicos de esta serie
                const seriesPosters = appState.content.seasonPosters[id] || {};

                // 🔥 2. Función helper para extraer la URL correcta (soporta objetos o texto)
                const getSeasonPoster = (num) => {
                    const p = seriesPosters[num];
                    if (!p) return item.poster; // Si no hay poster específico, usa el general
                    return (typeof p === 'object') ? p.posterUrl : p;
                };

                // --- TEMPORADA 1 ---
                const t1 = { 
                    ...item, 
                    title: `${item.title} (T1)`,
                    poster: getSeasonPoster(1) // 🔥 APLICAR PÓSTER T1
                };
                expandedContent.push([id, t1]); 

                // --- TEMPORADAS SIGUIENTES (2, 3, etc) ---
                String(multiChrono).split(',').map(c => c.trim()).forEach((chronoVal, index) => {
                    const sNum = index + 2; // T2, T3...
                    const tNext = { 
                        ...item, 
                        title: `${item.title} (T${sNum})`, 
                        cronologia: chronoVal,
                        poster: getSeasonPoster(sNum) // 🔥 APLICAR PÓSTER TX
                    };
                    expandedContent.push([id, tNext]); 
                });

            } else { 
                expandedContent.push([id, item]); 
            }
        });

        // Ordenar por el número de cronología
        expandedContent.sort((a, b) => (Number(a[1].cronologia)||99999) - (Number(b[1].cronologia)||99999));
        content = expandedContent;
    }

    // 6. RENDER
    appState.ui.contentToDisplay = content;
    appState.ui.currentIndex = 0; 
    setupPaginationControls();

    const firstPageItems = content.slice(0, UI.ITEMS_PER_LOAD);
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
        DOM.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                DOM.searchInput.value = '';
                DOM.searchInput.blur();
                const currentFilter = document.querySelector('.main-nav a.active')?.dataset.filter || 'all';
                switchView(currentFilter);
            }
        });

    // =======================================================
    // 3. LOGICA DE FILTROS (DROPDOWNS) - ¡CORREGIDO!
    // =======================================================
    
    // A. Abrir/Cerrar menús
    document.addEventListener('click', (e) => {
        const trigger = e.target.closest('.dropdown-trigger');
        const dropdown = e.target.closest('.custom-dropdown');
        
        if (trigger) {
            e.stopPropagation(); 
            const menu = dropdown.querySelector('.dropdown-menu');
            
            // Cierra otros abiertos
            document.querySelectorAll('.dropdown-menu.show').forEach(m => {
                if (m !== menu) m.classList.remove('show');
            });
            
            // Alterna el actual
            if (menu) menu.classList.toggle('show');
        } else {
            // Cierra todo si clic fuera
            document.querySelectorAll('.dropdown-menu.show').forEach(m => {
                m.classList.remove('show');
            });
        }
    });

    // B. Detectar clic en una OPCIÓN (Idioma, Género, Pedido, etc.)
    document.addEventListener('click', (e) => {
        const item = e.target.closest('.dropdown-item');
        if (!item) return;

        const dropdown = item.closest('.custom-dropdown');
        if (!dropdown) return;

        // 1. Identificar qué filtro es (Género, Idioma, Pedido...)
        let selectId = '';
        let triggerTextId = '';

        if (dropdown.id === 'genre-dropdown-visual') {
            selectId = 'genre-filter';
            triggerTextId = 'genre-text';
        } else if (dropdown.id === 'lang-dropdown-visual') {
            selectId = 'lang-filter';
            triggerTextId = 'lang-text';
        } else if (dropdown.id === 'sort-dropdown-visual') {
            selectId = 'sort-by';
            triggerTextId = 'sort-text';
        } else if (dropdown.id === 'request-dropdown-visual') { // 🔥 NUEVO: Pedidos
            selectId = 'request-filter';
            triggerTextId = 'request-text';
        }

        if (!selectId) return;

        // 2. Actualizar visualmente
        dropdown.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        
        const triggerText = document.getElementById(triggerTextId);
        if (triggerText) triggerText.textContent = item.textContent;

        // 3. Actualizar el <select> oculto (el cerebro real)
        const hiddenSelect = document.getElementById(selectId);
        if (hiddenSelect) {
            hiddenSelect.value = item.dataset.value;
            
            // 4. ¡DISPARAR LA RECARGA!
            // Usamos la saga activa guardada
            const currentType = appState.ui.activeSagaId || 'movie'; 
            let sourceData = null;

            if (currentType === 'movie') sourceData = appState.content.movies;
            else if (currentType === 'series') sourceData = appState.content.series;
            else if (currentType === 'ucm') sourceData = appState.content.ucm;
            else if (appState.content.sagas[currentType]) sourceData = appState.content.sagas[currentType];

            if (sourceData) {
                applyAndDisplayFilters(currentType);
            }
        }
    });

    const backSagaBtn = document.getElementById('back-to-sagas-btn');
    if (backSagaBtn) {
        backSagaBtn.addEventListener('click', () => switchView('sagas'));
    }

    // =======================================================
    // 4. MODALES (Lógica corregida para Reseñas)
    // =======================================================
    
    // A. Botones de cerrar (La "X")
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // 🔥 EXCEPCIÓN: Si es el modal de reseñas, SOLO cierra ese y no toca el resto
            if (btn.closest('#review-form-modal')) {
                e.preventDefault();
                e.stopPropagation(); // Evita que el evento suba y cierre todo
                const reviewModal = document.getElementById('review-form-modal');
                if (reviewModal) reviewModal.classList.remove('show');
                return; // Terminamos aquí, el reproductor de fondo sigue vivo
            }

            // Comportamiento normal para el resto (cierra todo)
            ModalManager.closeAll();
            const cinema = document.getElementById('cinema');
            if (cinema) {
                const iframe = cinema.querySelector('iframe');
                if (iframe) iframe.src = '';
                const video = cinema.querySelector('video');
                if (video) video.pause();
            }
        });
    });

    // B. Clic en el fondo oscuro (Backdrop)
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            // 🔥 EXCEPCIÓN: Si clicamos fuera del modal de reseñas
            if (e.target.id === 'review-form-modal') {
                e.target.classList.remove('show');
                // IMPORTANTE: No quitamos 'modal-open' del body porque el reproductor sigue abajo
                return; 
            }

            ModalManager.closeAll();
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

    // Botón de login en el profile hub (móvil)
    const loginBtnHub = document.getElementById('login-btn-hub');
    if (loginBtnHub) {
        loginBtnHub.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.openAuthModal) window.openAuthModal(true);
        });
    }

    // Botón de registro en el profile hub (móvil)
    const registerBtnHub = document.getElementById('register-btn-hub');
    if (registerBtnHub) {
        registerBtnHub.addEventListener('click', (e) => {
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

    // =======================================================
    // 8. BOTONES DE ORDENAMIENTO (SAGAS / UCM) - 🔥 NUEVO
    // =======================================================
    const sortButtons = document.querySelectorAll('.sort-btn');
    if (sortButtons.length > 0) {
        sortButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                // 1. Cambiar estado visual (Clase active)
                sortButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // 2. Identificar qué saga estamos viendo
                // (Usamos la variable global activeSagaId si existe, o buscamos el título)
                const currentSagaId = appState.ui.activeSagaId; 
                
                if (currentSagaId) {
                    // Recargar la cuadrícula de la saga actual con el nuevo orden
                    const sagaData = appState.content.sagas[currentSagaId] || appState.content.ucm;
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
    const totalPages = Math.ceil(appState.ui.contentToDisplay.length / UI.ITEMS_PER_LOAD);
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
        const start = appState.ui.currentIndex * UI.ITEMS_PER_LOAD;
        const end = start + UI.ITEMS_PER_LOAD;
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

    const start = appState.ui.currentIndex * UI.ITEMS_PER_LOAD;
    const end = start + UI.ITEMS_PER_LOAD;
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
            // 🔥 CORRECCIÓN: Detectamos si es serie mirando la lista principal O la propiedad 'type' del item
            // Esto arregla series dentro de Universos (como Ben 10)
            if (appState.content.series[id] || item.type === 'series' || item.type === 'serie') {
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
    const totalPages = Math.ceil(appState.ui.contentToDisplay.length / UI.ITEMS_PER_LOAD);
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
    
    // --- FUNCIÓN DE PUNTAJE (Novedad mata Ranking) ---
    const getHeroScore = (id, item, type) => {
        const tr = Number(item.tr) || 0;
        
        // Obtenemos la fecha de lo último (capítulo, temporada o estreno)
        const lastUpdate = getLatestUpdateTimestamp(id, item, type);
        const now = Date.now();
        const diffDays = (now - lastUpdate) / (1000 * 60 * 60 * 24);
        
        // Si tiene menos de 7 días de novedad, le damos un BONUS GIGANTE
        // Así aseguramos que 'Fallout' con cap nuevo le gane a 'Breaking Bad' con ranking alto
        if (diffDays <= 7 && diffDays >= 0) {
            return tr + 100000; // Bonus de Novedad
        }
        return tr; // Si es viejo, compite solo por ranking
    };

    // 1. Obtener Top Películas (Ordenadas por Novedad + Ranking)
    const topMovies = Object.entries(appState.content.movies)
        .map(([id, item]) => ({ 
            id, 
            type: 'movie', 
            score: getHeroScore(id, item, 'movie') 
        }))
        .sort((a, b) => b.score - a.score); // Mayor puntaje primero

    // 2. Obtener Top Series (Ordenadas por Novedad + Ranking)
    const topSeries = Object.entries(appState.content.series)
        .map(([id, item]) => ({ 
            id, 
            type: 'series', 
            score: getHeroScore(id, item, 'series') 
        }))
        .sort((a, b) => b.score - a.score);

    // 3. Intercalar: Peli - Serie (Total 16 items: 8 pares)
    const mixedHeroItems = [];
    const itemsPerCategory = 8; 
    
    for (let i = 0; i < itemsPerCategory; i++) {
        // Agregamos la mejor película disponible
        if (topMovies[i]) mixedHeroItems.push(topMovies[i]);

        // Agregamos la mejor serie disponible
        if (topSeries[i]) mixedHeroItems.push(topSeries[i]);
    }

    // Guardar
    appState.ui.heroItems = mixedHeroItems;

    // Iniciar
    if (mixedHeroItems.length > 0) {
        preloadHeroImages(mixedHeroItems);
        changeHeroMovie(mixedHeroItems[0]); 
        startHeroInterval(); 
    } else {
       DOM.heroSection.style.display = 'none'; 
    }
}

function startHeroInterval() {
    clearInterval(appState.ui.heroInterval);
    let currentHeroIndex = 0;
    // Usamos la nueva variable 'heroItems'
    if (!appState.ui.heroItems || appState.ui.heroItems.length === 0) return;
    
    appState.ui.heroInterval = setInterval(() => {
        currentHeroIndex = (currentHeroIndex + 1) % appState.ui.heroItems.length;
        changeHeroMovie(appState.ui.heroItems[currentHeroIndex]);
    }, 8000); // 8 segundos por turno
}

function changeHeroMovie(itemObj) {
    if (appState.hero.isTransitioning || !itemObj) return;
    
    const { id, type } = itemObj; // Extraemos ID y TIPO
    const heroContent = DOM.heroSection.querySelector('.hero-content');
    
    // Buscar los datos reales
    let data = null;
    if (type === 'movie') data = appState.content.movies[id];
    else if (type === 'series') data = appState.content.series[id];

    if (!heroContent || !data) return;

    appState.hero.isTransitioning = true;
    heroContent.classList.add('hero-fading');

    setTimeout(() => {
        const isMobile = window.innerWidth < 992;
        const imageType = isMobile ? 'poster' : 'banner';
        const cacheKey = `${id}_${imageType}`;
        
        const imageUrl = appState.hero.preloadedImages.get(cacheKey) || 
                        (isMobile ? data.poster : data.banner);
        
        DOM.heroSection.style.backgroundImage = `url(${imageUrl})`;
        
        heroContent.querySelector('#hero-title').textContent = data.title;
        heroContent.querySelector('#hero-synopsis').textContent = data.synopsis;

        // --- ZONA DE BOTONES INTELIGENTE ---
        const heroButtons = heroContent.querySelector('.hero-buttons');
        heroButtons.innerHTML = ''; 

        // 1. Botón Play (Detecta si es Serie o Película)
        const playButton = document.createElement('button');
        playButton.className = 'btn btn-play';
        playButton.innerHTML = '<i class="fas fa-play"></i> Ver Ahora';
        playButton.onclick = async () => { 
            const player = await getPlayerModule();
            if (type === 'series') {
                // Si es serie, usa el reproductor de series (que gestiona temporadas)
                player.openSeriesPlayer(id);
            } else {
                // Si es película, usa el reproductor simple
                player.openPlayerModal(id, data.title.replace(/'/g, "\\'"));
            }
        };

        // 2. Botón Información
        const infoButton = document.createElement('button');
        infoButton.className = 'btn btn-info';
        infoButton.textContent = 'Más Información';
        infoButton.onclick = () => openDetailsModal(id, type);

        heroButtons.appendChild(playButton);
        heroButtons.appendChild(infoButton);

        // 3. Botón Mi Lista (Para usuarios conectados)
        const user = auth.currentUser;
        if (user) { 
            const listBtn = document.createElement('button');
            const isInList = appState.user.watchlist.has(id);
            const iconClass = isInList ? 'fa-check' : 'fa-plus';
            
            listBtn.className = isInList ? 'btn-watchlist in-list' : 'btn-watchlist';
            listBtn.setAttribute('data-content-id', id);
            listBtn.title = "Añadir a Mi Lista";
            listBtn.innerHTML = `<i class="fas ${iconClass}"></i>`;
            
            listBtn.onclick = (e) => {
                e.stopPropagation(); 
                handleWatchlistClick(listBtn);
            };

            heroButtons.appendChild(listBtn);
        }

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
        
        // 1. Empezamos con lo básico
        let allContent = { ...appState.content.movies, ...appState.content.series };

        // 2. 🔥 AGREGAMOS TODAS LAS SAGAS AL BUSCADOR
        if (appState.content.sagas) {
            Object.values(appState.content.sagas).forEach(sagaItems => {
                if (sagaItems) {
                    Object.assign(allContent, sagaItems);
                }
            });
        }

        // 3. (Opcional) Si usas UCM antiguo
        if (appState.content.ucm) Object.assign(allContent, appState.content.ucm);

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

// ==========================================
// GENERAR CARRUSEL "CONTINUAR VIENDO" (CORREGIDO)
// ==========================================
function generateContinueWatchingCarousel(snapshot) {
    const user = auth.currentUser;
    
    // 1. Limpieza preventiva
    const existingCarousel = document.getElementById('continue-watching-carousel');
    if (existingCarousel) existingCarousel.remove();

    const carouselContainer = document.getElementById('carousel-container');
    
    // 2. Validaciones de Seguridad
    if (!user || !carouselContainer || !snapshot.exists()) return;
    
    // 3. CHECK CRÍTICO: ¿Ya se descargaron las series/sagas?
    // Si appState está vacío, no intentamos renderizar aún (se ejecutará de nuevo cuando carguen los datos)
    const contentReady = (appState.content.series && Object.keys(appState.content.series).length > 0) || 
                         (appState.content.sagas && Object.keys(appState.content.sagas).length > 0);
                         
    if (!contentReady) {
        console.log('⏳ Esperando datos de contenido para generar Continuar Viendo...');
        return; 
    }

    let historyItems = [];
    snapshot.forEach(child => historyItems.push(child.val()));
    historyItems.reverse(); // Más reciente primero

    const itemsToDisplay = [];
    const displayedIds = new Set();

    for (const item of historyItems) {
        // Solo procesamos Series
        if (item.type === 'series') {
            
            if (displayedIds.has(item.contentId)) continue; 

            // A. BÚSQUEDA ROBUSTA DE LA SERIE (Series Base o Sagas)
            let seriesInfo = appState.content.series[item.contentId];
            
            // Si no está en series normales, buscar en Sagas
            if (!seriesInfo && appState.content.sagas) {
                for (const key in appState.content.sagas) {
                    if (appState.content.sagas[key][item.contentId]) {
                        seriesInfo = appState.content.sagas[key][item.contentId];
                        break;
                    }
                }
            }

            // Si encontramos la serie, procedemos
            if (seriesInfo) {
                // B. DATOS DEL EPISODIO
                const allEpisodes = appState.content.seriesEpisodes || {};
                const seriesEpisodesData = allEpisodes[item.contentId];
                
                // Intentamos obtener datos del episodio, pero NO nos detenemos si fallan
                let episode = null;
                let seasonKey = item.season;
                let epIndex = item.lastEpisode || 0;

                if (seriesEpisodesData && seriesEpisodesData[seasonKey]) {
                    episode = seriesEpisodesData[seasonKey][epIndex];
                }

                // C. TÍTULO Y SUBTÍTULO
                let titleDisplay = seriesInfo.title;
                let subtitleDisplay = '';

                // Detectar si es especial/película dentro de serie
                const seasonStr = String(seasonKey).toLowerCase().trim();
                const isSpecial = seasonStr.includes('pelicula') || seasonStr.includes('especial') || seasonStr === '0';

                if (isSpecial) {
                    subtitleDisplay = episode ? (episode.title || 'Especial') : 'Película/Especial';
                } else {
                    const epNumDisplay = episode ? (episode.episodeNumber || (epIndex + 1)) : (epIndex + 1);
                    // Si tenemos el título del capítulo lo mostramos, si no, solo el número
                    const epTitle = episode ? `: ${episode.title}` : ''; 
                    subtitleDisplay = `T${String(seasonKey).replace(/\D/g,'')} E${epNumDisplay}${epTitle}`;
                }
                
                // Si el subtítulo quedó muy largo, lo cortamos
                if(subtitleDisplay.length > 40) subtitleDisplay = subtitleDisplay.substring(0, 37) + '...';

                // D. LÓGICA DE IMAGEN (Prioridad: Miniatura Cap > Poster Temporada > Poster Serie)
                let imageDisplay = seriesInfo.poster; // Fallback base
                
                // 1. Intentar miniatura del capítulo (La mejor opción para "Continuar Viendo")
                if (episode && episode.thumbnail && episode.thumbnail.length > 5) {
                    imageDisplay = episode.thumbnail;
                } 
                // 2. Si no hay miniatura, buscar poster de temporada
                else {
                    const rawPostersMap = appState.content.seasonPosters[item.contentId] || {};
                    // Normalizar keys para evitar errores de mayúsculas/espacios
                    const cleanPostersMap = {};
                    Object.keys(rawPostersMap).forEach(k => cleanPostersMap[String(k).toLowerCase().trim()] = rawPostersMap[k]);

                    let specificPosterEntry = cleanPostersMap[seasonStr];
                    
                    if (!specificPosterEntry && isSpecial) {
                        specificPosterEntry = cleanPostersMap['pelicula'] || cleanPostersMap['especial'] || cleanPostersMap['0'];
                    }

                    if (specificPosterEntry) {
                        imageDisplay = (typeof specificPosterEntry === 'object') ? specificPosterEntry.posterUrl : specificPosterEntry;
                    }
                }

                itemsToDisplay.push({
                    contentId: item.contentId,
                    season: item.season,
                    episodeIndexToOpen: epIndex,
                    thumbnail: imageDisplay,
                    title: titleDisplay,
                    subtitle: subtitleDisplay
                });
                
                displayedIds.add(item.contentId);
            }
        }
        
        if (itemsToDisplay.length >= 15) break;
    }

    // 4. RENDERIZADO AL DOM
    if (itemsToDisplay.length > 0) {
        const carouselEl = document.createElement('div');
        carouselEl.id = 'continue-watching-carousel';
        carouselEl.className = 'carousel'; 
        // Animación de entrada
        carouselEl.style.animation = 'fadeIn 0.5s ease-out';
        
        carouselEl.innerHTML = `
            <h3 class="carousel-title">Continuar Viendo</h3>
            <div class="carousel-track"></div>
        `;
        
        const track = carouselEl.querySelector('.carousel-track');
        
        itemsToDisplay.forEach(item => {
            const card = document.createElement('div');
            card.className = 'continue-watching-card'; // Asegúrate de tener CSS para esta clase
            
            // Clic para abrir reproductor directo
            card.onclick = async () => {
                const player = await getPlayerModule();
                // Pequeño feedback visual al click
                card.style.opacity = '0.7';
                player.openPlayerToEpisode(item.contentId, item.season, item.episodeIndexToOpen);
                setTimeout(() => card.style.opacity = '1', 500);
            };

            // HTML de la tarjeta (Miniatura horizontal)
            card.innerHTML = `
                <div class="cw-img-wrapper">
                    <img src="${item.thumbnail}" class="cw-card-thumbnail" alt="${item.title}" loading="lazy">
                    <div class="cw-progress-bar"><div class="cw-progress-fill" style="width: ${Math.random() * (90 - 20) + 20}%"></div></div>
                    <div class="cw-play-overlay"><i class="fas fa-play"></i></div>
                </div>
                <div class="cw-card-info">
                    <h4 class="cw-card-title">${item.title}</h4>
                    <p class="cw-card-subtitle">${item.subtitle}</p>
                </div>
            `;
            track.appendChild(card);
        });
        
        // Insertar al principio del contenedor principal
        carouselContainer.prepend(carouselEl);
    }
}

// 🔧 Exponer función globalmente para debugging
window.generateContinueWatchingCarousel = generateContinueWatchingCarousel;

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
        const posterImg = document.getElementById('details-poster-img');

        // 1. BÚSQUEDA INTELIGENTE DE DATOS
        let data = findContentData(id);

        if (!data) {
            // Fallbacks
            if (appState.content.movies[id]) data = appState.content.movies[id];
            else if (appState.content.series[id]) data = appState.content.series[id];
            
            if (!data) {
                ErrorHandler.show('content', 'No se pudo cargar la información del título.');
                return;
            }
        }
        
        // 🔥 FIX: Si es serie, obtener datos directamente de appState.content.series para asegurar que tenemos TODOS los campos
        if (appState.content.series[id]) {
            data = { ...data, ...appState.content.series[id] };
        }
        
        // 🔍 DEBUG: Verificar que el campo random esté presente
        console.log('📊 DATA DESPUÉS DE COMBINAR:', {
            id: id,
            title: data.title,
            hasRandom: 'random' in data,
            randomValue: data.random,
            allKeys: Object.keys(data)
        });

        // 2. RENDERIZADO BÁSICO
        const isSeries = (type === 'series' || !!appState.content.series[id] || data.type === 'series' || data.type === 'serie');
        
        document.getElementById('details-title').textContent = data.title || '';
        
        // --- LÓGICA SINOPSIS MIXTA ---
        let fullSynopsis = data.synopsis || 'Sin descripción.';
        
        // Solo recortamos si es PELÍCULA (isSeries es falso)
        if (!isSeries) {
            const maxChars = 280; 
            if (fullSynopsis.length > maxChars) {
                fullSynopsis = fullSynopsis.substring(0, maxChars).trim() + "...";
            }
        }
        // Si es SERIE, dejamos la sinopsis completa (pasa directo)

        document.getElementById('details-synopsis').textContent = fullSynopsis;
        
        if (posterImg) posterImg.src = data.poster || '';

        // 3. GESTIÓN DE METADATOS (Diferente para Series y Pelis)
        const detailsMeta = modal.querySelector('.details-meta');
        
        if (detailsMeta) {
            detailsMeta.innerHTML = ''; 

            // A. Rating (Para todos igual)
            const modalRating = appState.content.averages[id];
            if (modalRating) {
                const ratingBadge = document.createElement('span');
                ratingBadge.className = 'modal-rating-badge';
                if (reviewsModule && reviewsModule.getStarsHTML) {
                    ratingBadge.innerHTML = reviewsModule.getStarsHTML(modalRating, false);
                } else {
                    ratingBadge.innerHTML = `<i class="fas fa-star" style="color:#ffd700"></i> ${modalRating}`;
                }
                detailsMeta.appendChild(ratingBadge); 
            }

            // --- EXCEPCIÓN: SOLO SERIES MUESTRAN PEDIDO Y AÑO AQUÍ ---
            if (isSeries) {
                // B. PEDIDO
                if (data.pedido) {
                    const requestPill = document.createElement('span');
                    requestPill.className = 'meta-pill request-pill'; 
                    requestPill.innerHTML = `<i class="fas fa-user-circle" style="margin-right:5px; color:#ffd700;"></i> ${data.pedido}`;
                    detailsMeta.appendChild(requestPill);
                }

                // C. AÑO
                if (data.year) {
                    const yearPill = document.createElement('span');
                    yearPill.className = 'meta-pill';
                    yearPill.textContent = data.year;
                    detailsMeta.appendChild(yearPill);
                }
            }

            // D. IDIOMA Y GÉNEROS (Para todos)
            const langVal = data.language || data.idioma || data.audio;

            const metaItems = [
                { val: langVal, class: 'meta-pill' }, // Aquí pasamos el valor encontrado
                { val: data.genres ? data.genres.replace(/;/g, ', ') : null, class: 'meta-pill' }
            ];

            metaItems.forEach(item => {
                if(item.val) {
                    const span = document.createElement('span');
                    span.className = item.class;
                    span.textContent = item.val;
                    detailsMeta.appendChild(span);
                }
            });
        }

        // 4. FONDO (BANNER)
        if (panel) {
            if (data.banner && data.banner.length > 5) {
                panel.style.backgroundImage = `url(${data.banner})`;
            } else {
                panel.style.backgroundImage = 'none';
                panel.style.backgroundColor = '#1a1a1a';
            }
        }

        // 5. CONFIGURACIÓN DE BOTONES
        if (detailsButtons) {
            detailsButtons.innerHTML = '';

            // --- BOTÓN 1: REPRODUCIR ---
            const playBtn = document.createElement('button');
            playBtn.className = 'btn btn-play';
            playBtn.innerHTML = `<i class="fas fa-play"></i> Ver ahora`;
            playBtn.onclick = async () => {
                ModalManager.closeAll();
                const player = await getPlayerModule();
                
                if (isSeries) {
                    player.openSeriesPlayer(id);
                } else {
                    player.openPlayerModal(id, data.title);
                }
            };
            detailsButtons.appendChild(playBtn);

            // --- BOTÓN 2: TEMPORADAS O RANDOM (Solo Series) ---
            if (isSeries) {
                const episodes = appState.content.seriesEpisodes[id] || {};
                
                // Botón Random - Validación flexible (busca random o randomValue)
                const randomVal = String(data.randomValue || data.random || '').trim().toLowerCase();
                const isRandomEnabled = ['si', 'sí', 'yes', 'true', '1'].includes(randomVal);
                
                if (isRandomEnabled) {
                    const randomBtn = document.createElement('button');
                    randomBtn.className = 'btn btn-random';
                    randomBtn.innerHTML = `<i class="fas fa-random"></i> Aleatorio`;
                    randomBtn.onclick = async () => {
                        const allEpisodes = [];
                        const episodesData = appState.content.seriesEpisodes[id] || {};
                        
                        Object.keys(episodesData).forEach(seasonKey => {
                            const episodesArray = episodesData[seasonKey];
                            if (Array.isArray(episodesArray)) {
                                episodesArray.forEach((episode, index) => {
                                    if (episode && episode.videoId) {
                                        allEpisodes.push({
                                            season: seasonKey,
                                            episodeIndex: index,
                                            episodeNum: index + 1,
                                            data: episode
                                        });
                                    }
                                });
                            }
                        });

                        if (allEpisodes.length === 0) {
                            ErrorHandler.show('content', 'No hay episodios disponibles.');
                            return;
                        }

                        const randomIndex = Math.floor(Math.random() * allEpisodes.length);
                        const selected = allEpisodes[randomIndex];

                        ModalManager.closeAll();
                        const player = await getPlayerModule();
                        player.playEpisode(id, selected.season, selected.episodeNum);
                    };
                    detailsButtons.appendChild(randomBtn);
                }
                
                // Botón Temporadas - Si tiene más de 1 temporada
                if (Object.keys(episodes).length > 1) {
                    const infoBtn = document.createElement('button');
                    infoBtn.className = 'btn btn-info';
                    infoBtn.innerHTML = `<i class="fas fa-list"></i> Temporadas`;
                    infoBtn.onclick = async () => {
                        ModalManager.closeAll();
                        const player = await getPlayerModule();
                        player.openSeriesPlayer(id, true);
                    };
                    detailsButtons.appendChild(infoBtn);
                }
            }

            // --- BOTÓN 3: MI LISTA ---
            if (auth.currentUser) {
                const inList = appState.user.watchlist.has(id);
                const listBtn = document.createElement('button');
                listBtn.className = `btn btn-watchlist ${inList ? 'in-list' : ''}`;
                listBtn.innerHTML = `<i class="fas ${inList ? 'fa-check' : 'fa-plus'}"></i>`;
                listBtn.dataset.contentId = id;
                
                listBtn.onclick = (e) => {
                    e.stopPropagation();
                    handleWatchlistClick(listBtn);
                };
                detailsButtons.appendChild(listBtn);
            }

            // --- BOTÓN 4: RESEÑAR (CIRCULAR AL LADO DE MI LISTA) ---
            const reviewBtn = document.createElement('button');
            reviewBtn.className = 'btn btn-review btn-icon-only';
            reviewBtn.innerHTML = `<i class="fas fa-star"></i>`;
            reviewBtn.title = 'Reseñar'; // Tooltip
            
            reviewBtn.onclick = async () => {
                // 1. Validar login
                if (!auth.currentUser) {
                    openConfirmationModal("Inicia Sesión", "Necesitas cuenta para reseñar.", () => openAuthModal(true));
                    return;
                }

                // 2. Preparar módulo
                const reviews = await getReviewsModule();

                // 3. Cerrar modal actual
                ModalManager.closeAll();

                // 4. Abrir modal de reseñas (Contextual) con delay visual
                setTimeout(() => {
                    reviews.openReviewModal(true, {
                        contentId: id,
                        contentTitle: data.title,
                        contentType: isSeries ? 'series' : 'movie'
                    });
                }, 100);
            };
            detailsButtons.appendChild(reviewBtn);
        }

        modal.classList.add('show');
        document.body.classList.add('modal-open');

    } catch (e) {
        // Usamos el logger o un console.error simple
        console.error("Error abriendo detalles:", e);
        if (window.logError) window.logError(e, 'Open Details');
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
                ModalManager.closeAll(); 
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
                    ModalManager.closeAll(); 
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

// Exportar openAuthModal al scope global para que los event listeners puedan accederla
window.openAuthModal = openAuthModal;

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
    
    // 🔥 CORRECCIÓN: Usamos el buscador inteligente para encontrar pelis dentro de sagas
    // Asegúrate de que findContentData sea accesible aquí (está al final del archivo)
    let itemData = findContentData(contentId); 

    if (!itemData) {
        // Fallback manual por si acaso
        if (isSeries) itemData = appState.content.series[contentId];
        else itemData = appState.content.movies[contentId];
    }

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
// 📝 MI LISTA INTELIGENTE (CORREGIDO Y VISIBLE)
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
    
    if (!appState.user.watchlist || appState.user.watchlist.size === 0) {
        myListGrid.innerHTML = `<p class="empty-message">Tu lista está vacía. Agrega contenido para verlo aquí.</p>`;
        return;
    }
    
    // Spinner de carga rápida
    myListGrid.innerHTML = `<div class="spinner" style="margin: 50px auto;"></div>`;

    // 1. PREPARACIÓN DE DATOS (SNAPSHOT)
    // 🔥 CORRECCIÓN 1: Unificamos Pelis y Series (sin UCM antiguo)
    let allContent = { 
        ...appState.content.movies, 
        ...appState.content.series 
    };
    
    // Agregamos Sagas Dinámicas (Aquí viene ahora Marvel, Star Wars, etc.)
    if (appState.content.sagas) {
        Object.values(appState.content.sagas).forEach(sagaItems => {
            if (sagaItems) {
                Object.assign(allContent, sagaItems);
            }
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
            // Si está en series o tiene episodios, es serie
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

    if (myListDataCache.length === 0) {
        myListGrid.innerHTML = `<p class="empty-message">No se encontraron datos (¿Quizás los items ya no existen?).</p>`;
        return;
    }

    // 3. Renderizar el PRIMER lote
    appendMyListBatch();
}

function appendMyListBatch() {
    const myListGrid = DOM.myListContainer.querySelector('.grid');
    const BATCH_SIZE = UI.ITEMS_PER_LOAD || 24;
    
    // Calcular el siguiente lote a mostrar
    const nextBatch = myListDataCache.slice(myListRenderedCount, myListRenderedCount + BATCH_SIZE);
    
    if (nextBatch.length === 0) return;

    // 🔥 Usamos un Fragmento para que sea ultra rápido
    const fragment = document.createDocumentFragment();

    nextBatch.forEach((item) => {
        // Creamos la tarjeta pasando { source: 'my-list' } para que el botón sea una "X"
        const card = createMovieCardElement(item.id, item.data, item.type, 'grid', false, { source: 'my-list' });
        
        // ✅ CORRECCIÓN: Se eliminaron las líneas de 'animation' y 'opacity' 
        // para asegurar que las tarjetas sean visibles al instante.
        
        fragment.appendChild(card);
    });

    // Inyectar en el DOM
    myListGrid.appendChild(fragment);
    myListRenderedCount += nextBatch.length;

    // --- GESTIÓN DEL BOTÓN "CARGAR MÁS" ---
    let loadBtn = document.getElementById('mylist-load-more-btn');
    
    // Si todavía queda contenido oculto en la caché...
    if (myListRenderedCount < myListDataCache.length) {
        if (!loadBtn) {
            // Crear el botón si no existe
            loadBtn = document.createElement('button');
            loadBtn.id = 'mylist-load-more-btn';
            loadBtn.className = 'btn btn-primary'; 
            loadBtn.innerHTML = 'Cargar más <i class="fas fa-chevron-down"></i>';
            loadBtn.style.cssText = "display: block; margin: 30px auto; min-width: 200px;";
            loadBtn.onclick = appendMyListBatch; 
            DOM.myListContainer.appendChild(loadBtn);
        } else {
            // Si ya existe, lo movemos al final
            DOM.myListContainer.appendChild(loadBtn);
        }
    } else {
        // Si ya mostramos todo, borramos el botón
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
    // 🔥 Usar función del módulo de reviews si está disponible
    const ratingHTML = reviewsModule && reviewsModule.getStarsHTML
        ? `<div class="card-rating-container">${reviewsModule.getStarsHTML(appState.content.averages[id], true)}</div>`
        : '<div class="card-rating-container"></div>';

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
// 🔥 openFullReview y deleteReview ahora están en el módulo de reviews


// ===========================================================
// SISTEMA DE CÁLCULO DE PROMEDIOS (RATINGS)
// ===========================================================




// ===========================================================
// SISTEMA DE RESEÑAS (CONFIGURACIÓN BLINDADA)
// ===========================================================

// ===========================================================
// 🆕 FUNCIÓN: openReviewModal (Contextual)
// ===========================================================

// ===========================================================
// 🆕 FUNCIÓN AUXILIAR: Cargar todas las opciones de contenido
// ===========================================================




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

export function findContentData(id) {
    const c = appState.content;
    // 1. Buscar en películas y series base
    if (c.movies[id]) return c.movies[id];
    if (c.series[id]) return c.series[id];
    // 2. Buscar en el hub de sagas dinámicas (Star Wars, Marvel, HP, etc.)
    if (c.sagas) {
        for (const sagaKey in c.sagas) {
            if (c.sagas[sagaKey][id]) return c.sagas[sagaKey][id];
        }
    }
    // 3. Fallback para UCM (si aún se usa como objeto separado)
    if (c.ucm && c.ucm[id]) return c.ucm[id];
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
// EXPORTS GLOBALES (Para compatibilidad)
// ===========================================================
window.closeAllModals = () => ModalManager.closeAll();
window.ErrorHandler = ErrorHandler;
window.ContentManager = ContentManager;
window.cacheManager = cacheManager;

console.log('✅ Cine Corneta v8.3.5 cargado correctamente');
// ===========================================================
// COMPATIBILIDAD: Funciones que ahora están en el módulo
// ===========================================================

function setupRatingsListener() {
    console.log('ℹ️ setupRatingsListener: Ya configurado en el módulo de reviews');
}

function getStarsHTML(rating, isSmall = true) {
    // Usar la función del módulo si está disponible
    if (reviewsModule && reviewsModule.getStarsHTML) {
        return reviewsModule.getStarsHTML(rating, isSmall);
    }
    // Fallback simple si el módulo no está listo
    if (!rating || rating === "0.0" || rating === 0) return '';
    return `
        <div class="star-rating-display ${isSmall ? 'small' : 'large'}" 
             title="${rating} de 5 estrellas">
            <i class="fas fa-star"></i>
            <span class="rating-number">${rating}</span>
        </div>
    `;
}

function updateVisibleRatings() {
    // Esta función también está en el módulo, pero por compatibilidad
    document.querySelectorAll('.movie-card').forEach(card => {
        const contentId = card.dataset.contentId;
        const ratingContainer = card.querySelector('.card-rating-container');
        
        if (ratingContainer && contentId && appState.content.averages) {
            const rating = appState.content.averages[contentId];
            ratingContainer.innerHTML = getStarsHTML(rating, true);
        }
    });
}

// ===========================================================
// SISTEMA DE NOTIFICACIONES (TOASTS)
// ===========================================================
window.showNotification = function(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Crear elemento
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Icono según tipo
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    const color = type === 'success' ? '#2ecc71' : '#e74c3c';

    toast.innerHTML = `
        <i class="fas ${icon} toast-icon" style="color: ${color}"></i>
        <span class="toast-message">${message}</span>
    `;

    // Agregar al DOM
    container.appendChild(toast);

    // Eliminar automáticamente después de 3 segundos
    setTimeout(() => {
        toast.style.animation = 'fadeOutToast 0.5s ease forwards';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
};

// ===========================================================
// ✅ FUNCIÓN GLOBAL PARA ABRIR RESEÑAS DESDE CUALQUIER LADO
// ===========================================================
window.openSmartReviewModal = async (contentId, type, title) => {
    // 1. Verificar Auth
    if (!firebase.auth().currentUser) {
        if (window.openConfirmationModal) {
            window.openConfirmationModal(
                "Inicia Sesión", 
                "Necesitas una cuenta para escribir reseñas.", 
                () => window.openAuthModal(true)
            );
        }
        return;
    }

    // 2. Cargar módulo dinámicamente (si no está cargado)
    // Nota: Usamos la variable reviewsModule que definiste arriba en script.js
    // Si no tienes acceso a ella directamente aquí, importamos de nuevo es seguro.
    const module = await import('./features/reviews.js');
    
    // 3. Cerrar modales que estorben (opcional, pero recomendado)
    // Si quieres que el reproductor se cierre al reseñar:
    // window.closeAllModals(); 
    // O si prefieres que se quede abierto de fondo, comenta la línea de arriba.

    // 4. Abrir el modal con los datos pre-cargados
    // true = modo contextual (pre-seleccionado)
    module.initReviews({ appState, DOM, auth, db, ErrorHandler: window.ErrorHandler, ModalManager: window.ModalManager }); // Re-init rápido por seguridad
    
    // Pequeño delay para asegurar que el DOM esté listo
    setTimeout(() => {
        module.openReviewModal(true, {
            contentId: contentId,
            contentTitle: title,
            contentType: type
        });
    }, 50);
};

// ===========================================================
// 🚪 LOGOUT - VERSIÓN ULTRA FINAL QUE EJECUTA EN TOUCH
// ===========================================================

// Función para mostrar el modal de logout
function mostrarModalLogout() {
    console.log('🚀 Mostrando modal de logout');
    
    const confirmModal = document.getElementById('confirmation-modal');
    if (!confirmModal) {
        console.error('❌ Modal no encontrado');
        if (confirm('¿Cerrar sesión?')) {
            ejecutarLogout();
        }
        return;
    }

    const confirmTitle = confirmModal.querySelector('h2');
    const confirmText = confirmModal.querySelector('p');
    const confirmBtn = document.getElementById('confirm-delete-btn');
    const cancelBtn = document.getElementById('cancel-delete-btn');
    const modalContent = confirmModal.querySelector('.confirmation-modal-content');

    // Configurar texto
    if (confirmTitle) confirmTitle.textContent = '¿Cerrar sesión?';
    if (confirmText) confirmText.textContent = 'Se cerrará tu sesión y volverás al modo invitado.';
    if (confirmBtn) confirmBtn.textContent = 'Cerrar Sesión';
    
    // Evitar que los clicks en el contenido se propaguen
    if (modalContent) {
        modalContent.onclick = (e) => {
            e.stopPropagation();
        };
    }
    
    // Mostrar modal
    confirmModal.style.display = 'flex';
    confirmModal.style.zIndex = '99999';
    confirmModal.style.pointerEvents = 'auto';
    
    setTimeout(() => {
        document.body.classList.add('modal-open');
        confirmModal.classList.add('show');
    }, 10);

    // ✅ BOTÓN CONFIRMAR
    if (confirmBtn) {
        // Limpiar listeners previos clonando el botón
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        
        // Variable para evitar doble ejecución
        let confirmExecuted = false;
        
        const executeConfirm = (e) => {
            if (confirmExecuted) return;
            confirmExecuted = true;
            
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            console.log('✅ Logout confirmado - EJECUTANDO');
            cerrarModal(confirmModal);
            ejecutarLogout();
        };
        
        // Método 1: touchstart (PRIMARIO en móvil)
        newConfirmBtn.addEventListener('touchstart', executeConfirm, { passive: false });
        
        // Método 2: click (BACKUP para desktop)
        newConfirmBtn.addEventListener('click', executeConfirm, true);
        
        // Método 3: onclick directo (EXTRA BACKUP)
        newConfirmBtn.onclick = executeConfirm;
    }

    // ✅ BOTÓN CANCELAR  
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
            
            console.log('❌ Logout cancelado - EJECUTANDO');
            cerrarModal(confirmModal);
        };
        
        newCancelBtn.addEventListener('touchstart', executeCancel, { passive: false });
        newCancelBtn.addEventListener('click', executeCancel, true);
        newCancelBtn.onclick = executeCancel;
    }
    
    // Cerrar al hacer click en el fondo oscuro
    confirmModal.onclick = (e) => {
        if (e.target === confirmModal) {
            console.log('🖱️ Click en fondo - cerrando');
            cerrarModal(confirmModal);
        }
    };
}

// Función para cerrar el modal
function cerrarModal(confirmModal) {
    if (!confirmModal) return;
    
    confirmModal.classList.remove('show');
    document.body.classList.remove('modal-open');
    
    setTimeout(() => {
        confirmModal.style.display = 'none';
        confirmModal.style.pointerEvents = 'none';
    }, 300);
}

// Función para ejecutar el logout
function ejecutarLogout() {
    console.log('🔓 Ejecutando logout');
    
    if (typeof auth === 'undefined' || !auth) {
        console.warn('⚠️ Auth no disponible, limpiando solo localStorage');
        localStorage.removeItem('cineCornetoUser');
        window.location.reload();
        return;
    }
    
    auth.signOut().then(() => {
        console.log('✅ Sesión cerrada en Firebase');
        localStorage.removeItem('cineCornetoUser');
        
        if (typeof appState !== 'undefined') {
            appState.user = {
                watchlist: new Set(),
                historyListenerRef: null
            };
            
            if (appState.user.historyListenerRef) {
                appState.user.historyListenerRef.off();
                appState.user.historyListenerRef = null;
            }
        }
        
        const profileHubEmail = document.getElementById('profile-hub-email');
        if (profileHubEmail) profileHubEmail.textContent = 'Visitante';
        
        const hubLoggedIn = document.getElementById('hub-logged-in-content');
        const hubGuest = document.getElementById('hub-guest-content');
        if (hubLoggedIn) hubLoggedIn.style.display = 'none';
        if (hubGuest) hubGuest.style.display = 'block';
        
        setTimeout(() => window.location.reload(), 500);
        
    }).catch((error) => {
        console.error('❌ Error:', error);
        localStorage.removeItem('cineCornetoUser');
        window.location.reload();
    });
}

// MÉTODO 1: Event delegation con MÚLTIPLES selectores
document.addEventListener('click', function(e) {
    const target = e.target;
    
    // Buscar si el elemento o algún padre es un botón de logout
    const logoutBtn = target.closest('#logout-btn') || 
                      target.closest('#logout-btn-hub') || 
                      target.closest('#mobile-logout-btn') ||
                      target.closest('.logout-action') ||
                      target.closest('a[href="#"][id*="logout"]') ||
                      target.closest('.profile-hub-menu-item.logout');
    
    if (logoutBtn) {
        e.preventDefault();
        e.stopPropagation();
        mostrarModalLogout();
        return;
    }
    
    // También buscar por texto
    if (target.innerText && target.innerText.includes('Cerrar Sesión')) {
        e.preventDefault();
        e.stopPropagation();
        mostrarModalLogout();
        return;
    }
}, true);

// MÉTODO 2: Listeners directos (BACKUP)
function attachDirectListeners() {
    const ids = ['logout-btn', 'logout-btn-hub', 'mobile-logout-btn'];
    
    ids.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.removeEventListener('click', handleLogoutClick);
            btn.addEventListener('click', handleLogoutClick, true);
            
            // ✅ AGREGAR TOUCH SUPPORT
            btn.removeEventListener('touchstart', handleLogoutClick);
            btn.addEventListener('touchstart', handleLogoutClick, { passive: false });
        }
    });
    
    const logoutLinks = document.querySelectorAll('.profile-hub-menu-item.logout');
    logoutLinks.forEach(link => {
        link.removeEventListener('click', handleLogoutClick);
        link.addEventListener('click', handleLogoutClick, true);
        
        link.removeEventListener('touchstart', handleLogoutClick);
        link.addEventListener('touchstart', handleLogoutClick, { passive: false });
    });
}

function handleLogoutClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    mostrarModalLogout();
}

// Ejecutar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachDirectListeners);
} else {
    attachDirectListeners();
}

// Re-ejecutar después de 1 segundo
setTimeout(attachDirectListeners, 1000);

// MÉTODO 3: Observador de mutaciones
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
                if (node.id === 'logout-btn-hub' || 
                    node.id === 'logout-btn' || 
                    node.classList?.contains('logout')) {
                    attachDirectListeners();
                }
                const logoutBtns = node.querySelectorAll?.('#logout-btn, #logout-btn-hub, .logout');
                if (logoutBtns?.length > 0) {
                    attachDirectListeners();
                }
            }
        });
    });
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});
