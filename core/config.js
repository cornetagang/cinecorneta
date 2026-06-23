// ===========================================================
// CONFIGURACIÓN CENTRALIZADA DE LA APLICACIÓN
// ===========================================================

/**
 * URL del Cloudflare Worker para el Reproductor (ArtPlayer + Subtitles)
 */
export const WORKER_URL = "https://cinecorneta.benja104lokito.workers.dev";

/**
 * Configuración de Firebase
 */
export const firebaseConfig = {
    apiKey: "AIzaSyBgfvfYs-A_-IgAbYoT8GAmoOrSi--cLkw",
    authDomain: "cine-corneta.firebaseapp.com",
    projectId: "cine-corneta",
    storageBucket: "cine-corneta.appspot.com",
    messagingSenderId: "404306744690",
    appId: "1:404306744690:web:28f77ec91347e1f5f6b9eb",
    databaseURL: "https://cine-corneta-default-rtdb.firebaseio.com/"
};

/**
 * URLs de API
 */
export const API_URL = {
    BASE_URL: 'https://script.google.com/macros/s/AKfycbwAJT7ElT1guBUiZpzKaHoI7dr4Zy3D9ZNS9_taqAWZyhGgTq5ttDdWBekVA_kjgnU/exec',
    
    endpoints: {
        series: 'series',
        episodes: 'episodes',
        allMovies: 'allMovies',
        posters: 'PostersTemporadas',
        sagasList: 'sagas_list'
    },
    
    getUrl(endpoint, params = {}) {
        const url = new URL(this.BASE_URL);
        url.searchParams.set('data', this.endpoints[endpoint] || endpoint);
        
        Object.entries(params).forEach(([key, value]) => {
            url.searchParams.set(key, value);
        });
        
        return url.toString();
    }
};

/**
 * Configuración de UI
 */
export const UI = {
    // ── Layout dinámico ──────────────────────────────────────
    CARD_MIN_WIDTH: 200,  // px — coincide con minmax(200px,1fr) del CSS
    GRID_GAP: 20,         // px — coincide con gap: 20px del CSS
    GRID_PADDING_VW: 8,   // vw total (4vw cada lado)
    ROWS_PER_PAGE: 4,     // cuántas filas quieres ver por página

    getColumns() {
        const padding = window.innerWidth * (this.GRID_PADDING_VW / 100);
        const available = window.innerWidth - padding;
        return Math.max(2, Math.floor((available + this.GRID_GAP) / (this.CARD_MIN_WIDTH + this.GRID_GAP)));
    },

    get ITEMS_PER_LOAD() {
        return this.getColumns() * this.ROWS_PER_PAGE;
    },

    HERO_TRANSITION_DELAY: 5000,
    ERROR_NOTIFICATION_DURATION: 5000,
    LAZY_LOAD_MARGIN: '50px',

    breakpoints: {
        mobile: 768,
        tablet: 1024,
        desktop: 1440,
        wide: 1920
    },

    isMobile() { return window.innerWidth <= this.breakpoints.mobile; },
    isTablet()  { return window.innerWidth > this.breakpoints.mobile && window.innerWidth <= this.breakpoints.tablet; },
    isDesktop() { return window.innerWidth > this.breakpoints.tablet; }
};

/**
 * Configuración de Caché
 */
export const CACHE = {
    VERSION: '1.2.0',
    DEFAULT_TTL: 24 * 60 * 60 * 1000, // 24 horas
    
    keys: {
        content: 'cineCornetaData',
        metadata: 'contentMetadata',
        userProgress: 'seriesProgress',
        lastUpdate: 'local_last_update',
        pendingReload: 'pending_reload'
    }
};

/**
 * Configuración de Temas
 */
export const THEMES = {
    normal: {
        name: 'Normal',
        icon: 'https://res.cloudinary.com/djhgmmdjx/image/upload/v1759209689/u71QEFc_bet4rv.png',
        logo: 'https://res.cloudinary.com/djhgmmdjx/image/upload/v1759209688/vgJjqSM_oicebo.png',
        className: ''
    },
    christmas: {
        name: 'Navidad',
        icon: 'https://res.cloudinary.com/djhgmmdjx/image/upload/v1762920149/cornenavidad_lxtqh3.webp',
        logo: 'https://res.cloudinary.com/djhgmmdjx/image/upload/v1763875732/NavidadCorneta_pjcdgq.webp',
        className: 'tema-navidad'
    }
};

/**
 * Configuración de Roles y Permisos
 */
export const PERMISSIONS = {
    ADMIN_EMAILS: ['baquezadat@gmail.com'],
    
    isAdmin(email) {
        return this.ADMIN_EMAILS.includes(email);
    },
    
    canAccessAdminPanel(user) {
        return user && this.isAdmin(user.email);
    }
};

/**
 * Configuración del Reproductor
 */
export const PLAYER = {
    HISTORY_DEBOUNCE_MS: 3000, 
    EPISODE_OPEN_DELAY: 1000, 
    MIN_WATCH_TIME: 30, 
    
    providers: {
        hls: 'HLS',
        iframe: 'IFRAME',
        artplayer: 'ARTPLAYER' // Añadido como referencia
    }
};

/**
 * Configuración de Validación
 */
export const VALIDATION = {
    username: { minLength: 3, maxLength: 20, pattern: /^[a-zA-Z0-9_]+$/, message: 'El nombre debe tener entre 3 y 20 caracteres (solo letras, números y guión bajo)' },
    password: { minLength: 6, message: 'La contraseña debe tener al menos 6 caracteres' },
    email: { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Ingresa un email válido' },
    review: { minLength: 2, maxLength: 1000, message: 'La reseña debe tener entre 2 y 1000 caracteres' }
};

/**
 * Mensajes del Sistema
 */
export const MESSAGES = {
    errors: {
        network: 'No se pudo conectar al servidor. Verifica tu conexión.',
        auth: 'Error de autenticación. Intenta iniciar sesión nuevamente.',
        database: 'Error al guardar datos. Tus cambios podrían no haberse guardado.',
        content: 'No se pudo cargar el contenido. Intenta refrescar la página.',
        unknown: 'Ocurrió un error inesperado. Intenta nuevamente.',
        notFound: 'El contenido solicitado no existe.',
        unauthorized: 'No tienes permiso para realizar esta acción.',
        serverError: 'Error del servidor. Intenta más tarde.'
    },
    success: {
        login: 'Bienvenido de vuelta',
        register: 'Cuenta creada exitosamente',
        logout: 'Sesión cerrada',
        passwordUpdated: 'Contraseña actualizada correctamente',
        profileUpdated: 'Perfil actualizado',
        reviewPosted: 'Reseña publicada exitosamente',
        addedToList: 'Agregado a Mi Lista',
        removedFromList: 'Eliminado de Mi Lista'
    },
    info: {
        loading: 'Cargando contenido...',
        searching: 'Buscando...',
        processing: 'Procesando...',
        noResults: 'No se encontraron resultados',
        emptyList: 'Tu lista está vacía',
        emptyHistory: 'No tienes historial de visualización',
        checkSpam: 'Si no recibes el correo, revisa tu carpeta de Spam'
    }
};

/**
 * Configuración de Ruleta
 */
export const ROULETTE = {
    TOTAL_ITEMS: 35, WINNER_OFFSET: 5, SPIN_DURATION: 4500, SPIN_CURVE: 'cubic-bezier(0.1, 0.7, 0.1, 1)', PAUSE_BEFORE_DETAILS: 800, MIN_MOVIES_REQUIRED: 10
};

/**
 * Configuración de Performance
 */
export const PERFORMANCE = {
    LOW_SPEC_CORES: 4, PRELOAD_IMAGES: true, ENABLE_LAZY_LOADING: true, DEBOUNCE_SEARCH_MS: 300, THROTTLE_SCROLL_MS: 100
};

/**
 * Feature Flags
 */
export const FEATURES = {
    ENABLE_REVIEWS: true, ENABLE_ROULETTE: true, ENABLE_FESTIVAL: false, ENABLE_CHRISTMAS_THEME: false, ENABLE_ADVANCED_SEARCH: true, ENABLE_WATCHLIST: true, ENABLE_HISTORY: true, ENABLE_RECOMMENDATIONS: false
};

/**
 * Configuración de Analytics
 */
export const ANALYTICS = { ENABLED: false, TRACK_PAGE_VIEWS: true, TRACK_ERRORS: true, TRACK_USER_ACTIONS: true };

/**
 * Notas de seguridad:
 * El webhook de Discord ya NO se expone en el frontend.
 * El envío se hace vía WORKER_URL + "/discord-notify",
 * que verifica el token de Firebase del usuario antes de reenviar
 * al webhook real (guardado como secret en Cloudflare).
 */

// Exportar todo como objeto único también
export default {
    WORKER_URL,
    firebaseConfig,
    API_URL,
    UI,
    CACHE,
    THEMES,
    PERMISSIONS,
    PLAYER,
    VALIDATION,
    MESSAGES,
    ROULETTE,
    PERFORMANCE,
    FEATURES,
    ANALYTICS
};
