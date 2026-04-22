// ================================================================
// SAFARI iOS PATCH — Complemento JS para safari-ios-fixes.css
// ─────────────────────────────────────────────────────────────────
// CÓMO USAR: Añade al final del <body> en index.html:
// <script type="module" src="js/safari-ios-patch.js" defer></script>
//
// Este archivo importa Device desde device-detect.js para no
// duplicar la lógica de detección.
// ================================================================

import Device from './device-detect.js';

// Solo ejecutar en iOS (Safari, Chrome, Firefox — todos usan WebKit en iOS)
if (Device.isIOS) {
    initIOSPatch();
}

function initIOSPatch() {

    // ─────────────────────────────────────────────────────────────
    // 1. SCROLL LOCK CORRECTO EN SAFARI iOS
    //    position:fixed hace scroll al top. Guardamos y restauramos.
    // ─────────────────────────────────────────────────────────────
    let savedScrollY = 0;

    function lockBodyScroll() {
        savedScrollY = window.scrollY;
        document.body.style.top = `-${savedScrollY}px`;
    }

    function unlockBodyScroll() {
        document.body.style.top = '';
        window.scrollTo(0, savedScrollY);
    }

    const bodyObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class') {
                if (document.body.classList.contains('modal-open')) {
                    lockBodyScroll();
                } else {
                    unlockBodyScroll();
                }
            }
        });
    });

    bodyObserver.observe(document.body, { attributes: true });

    // ─────────────────────────────────────────────────────────────
    // 2. PANTALLA COMPLETA FALSA
    //    requestFullscreen NO funciona en iOS en ningún navegador.
    // ─────────────────────────────────────────────────────────────
    function enterFakeFullscreen(playerContainer) {
        playerContainer._origParent  = playerContainer.parentNode;
        playerContainer._origNextSib = playerContainer.nextSibling;
        playerContainer._origStyle   = playerContainer.getAttribute('style') || '';

        playerContainer.classList.add('fake-fullscreen');
        document.body.classList.add('player-takeover');
        document.body.appendChild(playerContainer);

        const exitBtn = document.createElement('button');
        exitBtn.className = 'fake-fullscreen-exit';
        exitBtn.innerHTML = '<i class="fas fa-compress"></i>';
        exitBtn.setAttribute('aria-label', 'Salir de pantalla completa');
        exitBtn.addEventListener('click', () => exitFakeFullscreen(playerContainer));
        playerContainer.appendChild(exitBtn);

        document.addEventListener('keydown', escExitHandler);
    }

    function exitFakeFullscreen(playerContainer) {
        playerContainer.classList.remove('fake-fullscreen');
        document.body.classList.remove('player-takeover');

        if (playerContainer._origParent) {
            playerContainer._origParent.insertBefore(playerContainer, playerContainer._origNextSib || null);
        }

        if (playerContainer._origStyle) {
            playerContainer.setAttribute('style', playerContainer._origStyle);
        } else {
            playerContainer.removeAttribute('style');
        }

        const exitBtn = playerContainer.querySelector('.fake-fullscreen-exit');
        if (exitBtn) exitBtn.remove();

        document.removeEventListener('keydown', escExitHandler);
    }

    function escExitHandler(e) {
        if (e.key === 'Escape') {
            const fakeFs = document.querySelector('.fake-fullscreen');
            if (fakeFs) exitFakeFullscreen(fakeFs);
        }
    }

    document.addEventListener('click', (e) => {
        const fullscreenBtn = e.target.closest(
            '[title="Pantalla completa"], [aria-label="Pantalla completa"], .fullscreen-btn, [data-fullscreen]'
        );
        if (!fullscreenBtn) return;

        e.preventDefault();
        e.stopPropagation();

        const playerScreen = fullscreenBtn.closest('.screen, .player-container, .movie-player-layout-container');
        if (!playerScreen) return;

        if (playerScreen.classList.contains('fake-fullscreen')) {
            exitFakeFullscreen(playerScreen);
        } else {
            enterFakeFullscreen(playerScreen);
        }
    }, true);

    // ─────────────────────────────────────────────────────────────
    // 3. VIEWPORT HEIGHT DINÁMICO
    //    Actualiza --dvh cuando la barra de Safari aparece/desaparece
    // ─────────────────────────────────────────────────────────────
    function updateViewportHeight() {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--dvh', `${vh}px`);
        document.documentElement.style.setProperty('--vh', `${vh}px`);
    }

    updateViewportHeight();
    window.addEventListener('resize', updateViewportHeight);
    window.addEventListener('orientationchange', () => {
        setTimeout(updateViewportHeight, 300);
    });

    // ─────────────────────────────────────────────────────────────
    // 4. PREVENIR SCROLL LEAK EN CONTENEDORES INTERNOS
    //    El scroll de una lista no debe "escaparse" al body
    // ─────────────────────────────────────────────────────────────
    function preventScrollLeak(container) {
        if (!container) return;

        container.addEventListener('touchstart', (e) => {
            container._touchStartY = e.touches[0].clientY;
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            const deltaY    = e.touches[0].clientY - (container._touchStartY || 0);
            const scrollTop = container.scrollTop;
            const scrollMax = container.scrollHeight - container.clientHeight;

            if ((deltaY > 0 && scrollTop <= 0) || (deltaY < 0 && scrollTop >= scrollMax)) {
                e.preventDefault();
            }
        }, { passive: false });
    }

    function applyScrollFixes() {
        [
            '.episode-list-container',
            '.details-content',
            '.upm-body',
            '.episode-sidebar',
        ].forEach(selector => {
            document.querySelectorAll(selector).forEach(preventScrollLeak);
        });
    }

    applyScrollFixes();
    document.addEventListener('click', () => setTimeout(applyScrollFixes, 500));

    // ─────────────────────────────────────────────────────────────
    // 5. AVISO PARA CHROME EN iOS
    //    Chrome en iOS no puede hacer fullscreen. Sugerimos Safari.
    // ─────────────────────────────────────────────────────────────
    if (Device.isChromeIOS && !sessionStorage.getItem('ios_tip_shown')) {
        const tip = document.createElement('div');
        tip.innerHTML = `
            <span>💡 Para mejor experiencia usa <strong>Safari</strong></span>
            <button id="ios-tip-close">✕</button>
        `;
        Object.assign(tip.style, {
            position: 'fixed',
            bottom: 'calc(70px + env(safe-area-inset-bottom, 0px))',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(20,20,20,0.95)',
            color: '#e6e3db',
            padding: '10px 16px',
            borderRadius: '20px',
            fontSize: '13px',
            fontFamily: "'Montserrat', sans-serif",
            border: '1px solid rgba(255,255,255,0.15)',
            zIndex: '9999',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
        });

        document.body.appendChild(tip);
        sessionStorage.setItem('ios_tip_shown', '1');

        tip.querySelector('#ios-tip-close').addEventListener('click', () => tip.remove());
        setTimeout(() => { if (tip.parentElement) tip.remove(); }, 5000);
    }

    if (window.__DEV__) {
        console.log(`[IOSPatch] Activo — ${Device.getSummary()}`);
    }
}
