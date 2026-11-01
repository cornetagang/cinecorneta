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
     * Un único intento de fetch (sin reintentos, sin notificaciones).
     *
     * Con `timing` evita que una petición colgada deje la app esperando para siempre:
     *   timeout - ms máximos hasta que el servidor empieza a responder (0 = sin límite).
     *   stall   - ms máximos sin recibir datos una vez que empezó la descarga (0 = sin límite).
     * Una descarga lenta pero que sigue avanzando NO se corta: el límite se reinicia con cada trozo.
     */
    async _fetchOnce(url, options = {}, onProgress = null, timing = {}) {
        const { signal: outerSignal, ...fetchOptions } = options;
        const ttfb = timing.timeout || 0;
        const stall = timing.stall || 0;
        const ctrl = new AbortController();
        let timer = null;
        let timedOut = false;
        const arm = (ms) => {
            clearTimeout(timer);
            if (ms > 0) timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms);
        };
        if (outerSignal) {
            if (outerSignal.aborted) ctrl.abort();
            else outerSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
        }

        try {
            arm(ttfb);
            const response = await fetch(url, { ...fetchOptions, signal: ctrl.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

            // Se lee el cuerpo por trozos: sirve para informar los bytes recibidos y para
            // detectar una descarga detenida. Si el navegador no soporta streams, se cae al método normal.
            if (response.body && response.body.getReader) {
                const reader = response.body.getReader();
                const chunks = [];
                let loaded = 0;
                arm(stall);
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    loaded += value.length;
                    if (typeof onProgress === 'function') onProgress(loaded);
                    arm(stall);
                }
                return JSON.parse(await new Blob(chunks).text());
            }

            return await response.json();
        } catch (error) {
            if (timedOut) {
                const e = new Error('Tiempo de espera agotado: el servidor no respondió a tiempo.');
                e.name = 'TimeoutError';
                throw e;
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    },

    /**
     * ¿La respuesta es el aviso de error del Apps Script ({ "error": "..." } con HTTP 200)?
     */
    _isApiError(data) {
        return !!data && typeof data === 'object' && !Array.isArray(data) &&
            typeof data.error === 'string' && Object.keys(data).length === 1;
    },

    /**
     * Wrapper para operaciones Fetch (API).
     * @param {Function|null} onProgress - Opcional: recibe los bytes descargados hasta el momento.
     *
     * Además de las opciones normales de fetch, acepta:
     *   retries    - reintentos tras el primer fallo (default 0 = comportamiento anterior).
     *   retryDelay - espera base en ms; se duplica en cada reintento (default 1500).
     *   silent     - true: no muestra la notificación visual (el error igual se registra).
     *   timeout    - ms hasta que el servidor empieza a responder (default 45000; 0 = sin límite).
     *   stall      - ms máximos sin recibir datos durante la descarga (default 25000; 0 = sin límite).
     *   rejectApiErrors - true: una respuesta { error: "..." } del Apps Script cuenta como fallo
     *                (se reintenta) en vez de tomarse como datos válidos.
     *
     * El error solo se registra/notifica cuando se agotaron todos los intentos.
     */
    async fetchOperation(url, options = {}, onProgress = null) {
        const {
            retries = 0, retryDelay = 1500, silent = false,
            timeout = 45000, stall = 25000, rejectApiErrors = false,
            ...fetchOptions
        } = options;
        let lastError;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const data = await ErrorHandler._fetchOnce(url, fetchOptions, onProgress, { timeout, stall });
                if (rejectApiErrors && ErrorHandler._isApiError(data)) {
                    const e = new Error(`API: ${data.error}`);
                    // "La hoja ... no fue encontrada" no se arregla reintentando
                    e.permanent = /no fue encontrada|Falta el par/i.test(data.error);
                    throw e;
                }
                return data;
            } catch (error) {
                lastError = error;
                if (error && error.permanent) break;
                if (attempt < retries) {
                    // Espera exponencial con algo de azar para no reintentar todos a la vez
                    const wait = retryDelay * 2 ** attempt + Math.random() * 400;
                    await new Promise((resolve) => setTimeout(resolve, wait));
                }
            }
        }

        logError(lastError, `Fetch: ${url}`, 'error');
        console.error('Fetch Error:', lastError);

        if (!silent) {
            if (lastError && lastError.name === 'TypeError') {
                this.show(this.types.NETWORK);
            } else {
                this.show(this.types.CONTENT, 'Error al obtener datos del servidor.');
            }
        }
        throw lastError;
    }
};