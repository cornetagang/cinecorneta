// ===========================================================
// MÓDULO DE LOGS DE ERROR (logger.js)
// ===========================================================

let dbRef = null;
let authRef = null;

// Inicializamos con las dependencias de Firebase
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
            userAgent: navigator.userAgent, // Info del navegador/dispositivo
            screenSize: `${window.screen.width}x${window.screen.height}`,
            userId: user ? user.uid : 'anonymous',
            userEmail: user ? user.email : 'anonymous'
        };

        // 3. Guardar en Firebase (carpeta system_logs)
        // Usamos push() para generar una ID única por error
        dbRef.ref('system_logs').push(logData);

    } catch (loggingError) {
        console.error("Falló el sistema de logging:", loggingError);
    }
}
