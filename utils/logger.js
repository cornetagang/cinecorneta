// ===========================================================
// MÓDULO UNIFICADO DE LOGGING Y MANEJO DE ERRORES
// ===========================================================

let dbRef = null;
let authRef = null;

// Inicializar con las dependencias de Firebase
export function initLogger(db, auth) {
    dbRef = db;
    authRef = auth;
}

/**
 * Registra un error en la base de datos de Firebase y en la consola.
 * @param {Error|string} error - El objeto de error o mensaje.
 * @param {string} context - Dónde ocurrió (ej: 'Profile', 'Player', 'Global').
 * @param {string} severity - Nivel de severidad ('error', 'warning', 'info').
 */
export function logError(error, context = 'Unknown', severity = 'error') {
    // 1. Mostrar en consola local para desarrollo
    console.error(`[${context}]`, error);

    // Si no hay base de datos conectada, salimos
    if (!dbRef) return;

    try {
        const user = authRef && authRef.currentUser;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const stackTrace = error instanceof Error ? error.stack : 'No stack trace';

        // 2. Objeto de datos para guardar
        const logData = {
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            date: new Date().toISOString(),
            severity: severity,
            context: context,
            message: errorMessage,
            stack: stackTrace,
            url: window.location.href,
            userAgent: navigator.userAgent,
            screenSize: `${window.screen.width}x${window.screen.height}`,
            userId: user ? user.uid : 'anonymous',
            userEmail: user ? user.email : 'anonymous'
        };

        // 3. Guardar en Firebase (carpeta system_logs)
        dbRef.ref('system_logs').push(logData);

    } catch (loggingError) {
        console.error("Falló el sistema de logging:", loggingError);
    }
}

// ===========================================================
// SISTEMA CENTRALIZADO DE GESTIÓN DE ERRORES
// ===========================================================
export const ErrorHandler = {
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

    currentTimeout: null,

    /**
     * Muestra una notificación visual y registra el error en el sistema de logs.
     * @param {string} type - Tipo de error (usar ErrorHandler.types).
     * @param {string|null} customMessage - Mensaje opcional para sobrescribir el default.
     * @param {number} duration - Duración en ms antes de ocultarse (default 5000).
     */
    show(type, customMessage = null, duration = 5000) {
        const message = customMessage || this.messages[type];
        
        // Registrar en el logger
        logError(message, `UI Notification: ${type.toUpperCase()}`, 'warning');

        // Mostrar notificación visual
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

        notification.className = 'error-notification show';
        notification.classList.add(`type-${type}`);

        if (this.currentTimeout) clearTimeout(this.currentTimeout);
        this.currentTimeout = setTimeout(() => this.hide(), duration);

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
     * Wrapper para operaciones de Firebase.
     */
    async firebaseOperation(operation, type = this.types.DATABASE) {
        try {
            return await operation();
        } catch (error) {
            logError(error, 'Firebase Operation', 'error');
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

    /**
     * Wrapper para operaciones Fetch (API).
     */
    async fetchOperation(url, options = {}) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            return await response.json();
        } catch (error) {
            logError(error, `Fetch: ${url}`, 'error');
            console.error('Fetch Error:', error);
            
            if (error.name === 'TypeError') {
                this.show(this.types.NETWORK);
            } else {
                this.show(this.types.CONTENT, 'Error al obtener datos del servidor.');
            }
            throw error;
        }
    }
};
