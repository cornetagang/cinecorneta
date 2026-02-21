// ===========================================================
// CONFIGURACIÓN CENTRALIZADA DE LA APLICACIÓN
// ===========================================================

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
    BASE_URL: 'https://script.google.com/macros/s/AKfycbx9pTTPbBj2GPIeUKmXDbmvxdiAgIjOJwhQI_XMGr4G-PVn29TIRqR7pn9CM-5sMGw2/exec',
    
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
    ITEMS_PER_LOAD: window.innerWidth < 1600 ? 25 : 24,
    HERO_TRANSITION_DELAY: 5000, // 5 segundos
    ERROR_NOTIFICATION_DURATION: 5000,
    LAZY_LOAD_MARGIN: '50px',
    
    breakpoints: {
        mobile: 768,
        tablet: 1024,
        desktop: 1440,
        wide: 1920
    },
    
    isMobile() {
        return window.innerWidth <= this.breakpoints.mobile;
    },
    
    isTablet() {
        return window.innerWidth > this.breakpoints.mobile && 
               window.innerWidth <= this.breakpoints.tablet;
    },
    
    isDesktop() {
        return window.innerWidth > this.breakpoints.tablet;
    }
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
    HISTORY_DEBOUNCE_MS: 3000, // 3 segundos antes de guardar en historial
    EPISODE_OPEN_DELAY: 1000, // 1 segundo antes de abrir episodio
    MIN_WATCH_TIME: 30, // 30 segundos mínimos para contar como visto
    
    providers: {
        hls: 'HLS',
        iframe: 'IFRAME'
    }
};

/**
 * Configuración de Validación
 */
export const VALIDATION = {
    username: {
        minLength: 3,
        maxLength: 20,
        pattern: /^[a-zA-Z0-9_]+$/,
        message: 'El nombre debe tener entre 3 y 20 caracteres (solo letras, números y guión bajo)'
    },
    
    password: {
        minLength: 6,
        message: 'La contraseña debe tener al menos 6 caracteres'
    },
    
    email: {
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        message: 'Ingresa un email válido'
    },
    
    review: {
        minLength: 2,
        maxLength: 1000,
        message: 'La reseña debe tener entre 2 y 1000 caracteres'
    }
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
    TOTAL_ITEMS: 35, // Número de items en el carrusel
    WINNER_OFFSET: 5, // Posición del ganador desde el final
    SPIN_DURATION: 4500, // Duración de la animación en ms
    SPIN_CURVE: 'cubic-bezier(0.1, 0.7, 0.1, 1)', // Curva de animación
    PAUSE_BEFORE_DETAILS: 800, // Pausa antes de abrir detalles (ms)
    MIN_MOVIES_REQUIRED: 10 // Mínimo de películas para activar ruleta
};

/**
 * Configuración de Performance
 */
export const PERFORMANCE = {
    LOW_SPEC_CORES: 4, // Si tiene 4 núcleos o menos, activar modo low-spec
    PRELOAD_IMAGES: true,
    ENABLE_LAZY_LOADING: true,
    DEBOUNCE_SEARCH_MS: 300,
    THROTTLE_SCROLL_MS: 100
};

/**
 * Feature Flags (para habilitar/deshabilitar funcionalidades)
 */
export const FEATURES = {
    ENABLE_REVIEWS: true,
    ENABLE_ROULETTE: true,
    ENABLE_FESTIVAL: false, // Activar solo durante eventos
    ENABLE_CHRISTMAS_THEME: false, // Activar en diciembre
    ENABLE_ADVANCED_SEARCH: true,
    ENABLE_WATCHLIST: true,
    ENABLE_HISTORY: true,
    ENABLE_RECOMMENDATIONS: false // Para futuro
};

/**
 * Configuración de Analytics (si lo implementas en el futuro)
 */
export const ANALYTICS = {
    ENABLED: false,
    TRACK_PAGE_VIEWS: true,
    TRACK_ERRORS: true,
    TRACK_USER_ACTIONS: true
};

// Exportar todo como objeto único también
export default {
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
