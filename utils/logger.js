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
// Control anti-spam: evita llenar system_logs con el mismo error repetido
const _recentLogs = new Map();      // clave -> último timestamp
const LOG_DEDUPE_MS = 30000;        // mismo error: máx. 1 vez cada 30 s
const LOG_MAX_PER_SESSION = 25;     // tope por carga de página
let _logCount = 0;
let _isLogging = false;

const _cut = (value, max) => String(value ?? '').slice(0, max);

export function logError(error, context = 'Unknown', severity = 'error') {
    // 1. Mostrar en consola local para desarrollo
    console.error(`[${context}]`, error);

    // Si no hay base de datos conectada, salimos
    if (!dbRef || _isLogging) return;

    try {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Throttle: mismo contexto + mensaje repetido, o demasiados logs en esta sesión
        const key = `${context}|${errorMessage}`;
        const now = Date.now();
        if (_logCount >= LOG_MAX_PER_SESSION) return;
        if (now - (_recentLogs.get(key) || 0) < LOG_DEDUPE_MS) return;
        _recentLogs.set(key, now);
        _logCount++;

        _isLogging = true;
        const user = authRef && authRef.currentUser;
        const stackTrace = error instanceof Error ? error.stack : 'No stack trace';

        // 2. Objeto de datos para guardar (con límites de tamaño)
        const logData = {
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            date: new Date().toISOString(),
            severity: _cut(severity, 20),
            context: _cut(context, 200),
            message: _cut(errorMessage, 500),
            stack: _cut(stackTrace, 2000),
            url: _cut(window.location.href, 300),
            userAgent: _cut(navigator.userAgent, 300),
            screenSize: `${window.screen.width}x${window.screen.height}`,
            userId: user ? user.uid : 'anonymous',
            userEmail: user ? (user.email || 'sin-email') : 'anonymous'
        };

        // 3. Guardar en Firebase (carpeta system_logs). El catch evita rechazos sin manejar.
        dbRef.ref('system_logs').push(logData).catch(() => {});

    } catch (loggingError) {
        console.error("Falló el sistema de logging:", loggingError);
    } finally {
        _isLogging = false;
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
        UNKNOWN: 'unknown',
        SUCCESS: 'success',
        INFO: 'info'
    },

    messages: {
        network: 'No se pudo conectar al servidor. Verifica tu conexión.',
        auth: 'Error de autenticación. Intenta iniciar sesión nuevamente.',
        database: 'Error al guardar datos. Tus cambios podrían no haberse guardado.',
        content: 'No se pudo cargar el contenido. Intenta refrescar la página.',
        unknown: 'Ocurrió un error inesperado. Intenta nuevamente.',
        success: 'Listo.',
        info: ''
    },

    // Solo estos tipos se registran en system_logs (son fallos reales).
    // Validaciones ("Selecciona una película") y éxitos NO deben llenar los logs.
    LOGGED_TYPES: ['network', 'database', 'unknown'],

    currentTimeout: null,

    /**
     * Muestra una notificación visual y registra el error en el sistema de logs.
     * @param {string} type - Tipo de error (usar ErrorHandler.types).
     * @param {string|null} customMessage - Mensaje opcional para sobrescribir el default.
     * @param {number} duration - Duración en ms antes de ocultarse (default 5000).
     */
    show(type, customMessage = null, duration = 5000) {
        const message = customMessage || this.messages[type] || this.messages.unknown;

        // Registrar en el logger solo los fallos reales
        if (this.LOGGED_TYPES.includes(type)) {
            logError(message, `UI Notification: ${String(type).toUpperCase()}`, 'warning');
        }

        // Mostrar notificación visual
        let notification = document.getElementById('error-notification');

        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'error-notification';
            notification.setAttribute('role', 'alert');
            notification.setAttribute('aria-live', 'polite');
            document.body.appendChild(notification);
        }

        const icons = {
            network: 'fa-wifi',
            auth: 'fa-user-lock',
            database: 'fa-database',
            content: 'fa-film',
            success: 'fa-check-circle',
            info: 'fa-info-circle',
            unknown: 'fa-exclamation-triangle'
        };

        // Se construye con DOM (textContent) para que el mensaje nunca se interprete como HTML
        const icon = document.createElement('i');
        icon.className = `fas ${icons[type] || icons.unknown}`;

        const text = document.createElement('span');
        text.className = 'error-notification-text';
        text.textContent = message;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'close-notification';
        closeBtn.setAttribute('aria-label', 'Cerrar');
        closeBtn.innerHTML = '&times;';

        notification.replaceChildren(icon, text, closeBtn);

        // Reiniciar clases (y la animación si ya estaba visible)
        notification.className = 'error-notification';
        void notification.offsetWidth;
        notification.classList.add('show', `type-${type}`);

        if (this.currentTimeout) clearTimeout(this.currentTimeout);
        this.currentTimeout = setTimeout(() => this.hide(), duration);

        closeBtn.onclick = () => {
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
            
            if (error.code === 'PERMISSION_DENIED' || error.code === 'permission-denied') {
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
     * @param {Function|null} onProgress - Opcional: recibe los bytes descargados hasta el momento.
     */
    async fetchOperation(url, options = {}, onProgress = null) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

            // Con onProgress se lee el cuerpo por trozos para informar los bytes recibidos.
            // Si el navegador no soporta streams, se cae al método normal.
            if (typeof onProgress === 'function' && response.body && response.body.getReader) {
                const reader = response.body.getReader();
                const chunks = [];
                let loaded = 0;
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    loaded += value.length;
                    onProgress(loaded);
                }
                return JSON.parse(await new Blob(chunks).text());
            }

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
