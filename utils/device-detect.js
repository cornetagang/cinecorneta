// ===========================================================
// DEVICE DETECTION — Cine Corneta
// ===========================================================
// Detecta el dispositivo/plataforma y:
//   1. Añade clases al <body> para que el CSS pueda reaccionar
//   2. Exporta flags para usar en cualquier módulo JS
//
// Clases que añade al body:
//   .device-ios        → iPhone / iPad / iPod
//   .device-android    → Android
//   .device-desktop    → PC / Mac / Linux
//   .browser-safari    → Safari (iOS o macOS)
//   .browser-chrome    → Chrome (incluye Chrome en iOS = CriOS)
//   .browser-firefox   → Firefox
//   .touch-device      → Cualquier dispositivo táctil
//   .standalone        → Instalada como PWA (Add to Home Screen)
//
// Uso en CSS:
//   body.device-ios .mi-elemento { ... }
//   body.device-android .mi-elemento { ... }
//
// Uso en JS:
//   import { Device } from './utils/device-detect.js';
//   if (Device.isIOS) { ... }
//   if (Device.isAndroid) { ... }
// ===========================================================

const ua = navigator.userAgent;

export const Device = {
    // ── Sistemas Operativos ───────────────────────────────────
    isIOS:     /iPad|iPhone|iPod/.test(ua) && !window.MSStream,
    isAndroid: /Android/.test(ua),
    isMac:     /Macintosh|MacIntel|MacPPC|Mac68K/.test(ua) && !(/iPad|iPhone|iPod/.test(ua)),
    isWindows: /Win32|Win64|Windows/.test(ua),
    isLinux:   /Linux/.test(ua) && !/Android/.test(ua),

    // ── Navegadores ───────────────────────────────────────────
    // Safari: tiene "Safari" en el UA pero NO tiene "Chrome", "CriOS", "FxiOS", etc.
    isSafari:  /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgA|OPiOS/.test(ua),
    // Chrome en iOS se identifica por "CriOS"
    isChromeIOS: /CriOS/.test(ua),
    // Chrome normal (no iOS)
    isChrome:  /Chrome/.test(ua) && !/Edg|OPR/.test(ua),
    // Firefox en iOS = FxiOS, en Android/Desktop = Firefox
    isFirefox: /Firefox|FxiOS/.test(ua),
    // Edge
    isEdge:    /Edg\//.test(ua),

    // ── Tipo de dispositivo ───────────────────────────────────
    isMobile:  /Mobi|Android|iPhone|iPod/.test(ua),
    isTablet:  /iPad/.test(ua) || (/Android/.test(ua) && !/Mobi/.test(ua)),
    isDesktop: !/Mobi|Android|iPhone|iPod|iPad/.test(ua),

    // ── Touch ─────────────────────────────────────────────────
    isTouch: ('ontouchstart' in window) || navigator.maxTouchPoints > 0,

    // ── PWA (Add to Home Screen) ──────────────────────────────
    isStandalone: window.matchMedia('(display-mode: standalone)').matches
                  || window.navigator.standalone === true,

    // ── Helpers compuestos ────────────────────────────────────
    // Safari en iOS específicamente (no macOS Safari)
    get isSafariIOS() { return this.isIOS && this.isSafari; },
    // Cualquier navegador en iOS (todos usan WebKit por restricción de Apple)
    get isAnyIOS()    { return this.isIOS; },

    // ── Info del viewport ─────────────────────────────────────
    get screenWidth()  { return window.screen.width; },
    get screenHeight() { return window.screen.height; },
    get viewportWidth()  { return window.innerWidth; },
    get viewportHeight() { return window.innerHeight; },

    /**
     * Aplica clases al <body> y al <html> basadas en la detección.
     * Llamar una sola vez al cargar la página.
     */
    applyBodyClasses() {
        const body = document.body;

        // Sistema operativo
        if (this.isIOS)     body.classList.add('device-ios');
        if (this.isAndroid) body.classList.add('device-android');
        if (this.isMac)     body.classList.add('device-mac');
        if (this.isWindows) body.classList.add('device-windows');
        if (this.isDesktop) body.classList.add('device-desktop');

        // Tipo de dispositivo
        if (this.isMobile)  body.classList.add('device-mobile');
        if (this.isTablet)  body.classList.add('device-tablet');

        // Navegador
        if (this.isSafari)    body.classList.add('browser-safari');
        if (this.isChromeIOS) body.classList.add('browser-chrome-ios');
        if (this.isChrome)    body.classList.add('browser-chrome');
        if (this.isFirefox)   body.classList.add('browser-firefox');
        if (this.isEdge)      body.classList.add('browser-edge');

        // Touch y PWA
        if (this.isTouch)      body.classList.add('touch-device');
        if (this.isStandalone) body.classList.add('standalone');

        // Safari en iOS específicamente
        if (this.isSafariIOS) body.classList.add('safari-ios');

        // Atributo data para debug
        body.dataset.device   = this.isIOS ? 'ios' : this.isAndroid ? 'android' : 'desktop';
        body.dataset.browser  = this.isSafari ? 'safari' : this.isChromeIOS ? 'chrome-ios' : this.isChrome ? 'chrome' : this.isFirefox ? 'firefox' : 'other';
        body.dataset.touch    = this.isTouch ? 'true' : 'false';
    },

    /**
     * Devuelve un resumen legible del dispositivo (útil para debug/logs).
     */
    getSummary() {
        const os      = this.isIOS ? 'iOS' : this.isAndroid ? 'Android' : this.isMac ? 'macOS' : this.isWindows ? 'Windows' : 'Linux';
        const type    = this.isMobile ? 'Mobile' : this.isTablet ? 'Tablet' : 'Desktop';
        const browser = this.isSafari ? 'Safari' : this.isChromeIOS ? 'Chrome iOS' : this.isChrome ? 'Chrome' : this.isFirefox ? 'Firefox' : this.isEdge ? 'Edge' : 'Unknown';
        return `${os} / ${type} / ${browser}`;
    }
};

// Aplicar clases automáticamente al importar el módulo
Device.applyBodyClasses();

export default Device;
