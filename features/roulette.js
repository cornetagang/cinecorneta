// ===========================================================
// MÓDULO DE LA RULETA — con Cover-Flow via requestAnimationFrame
// ===========================================================

let shared;
let isInitialized = false;

// Set de IDs vistos en memoria (sincronizado con Firebase)
let watchedMovieIds = new Set();

// Estado del modo personalizado
let customMode = false;
let customPool = []; // Array de { id, data }

// Estado del modo por género
let genreMode     = false;
let selectedGenre = null; // clave normalizada del género elegido (ej. "terror")

// ── Cover-flow state ─────────────────────────────────────────────────────────
const cf = {
    currentX:      0,     // posición X actualmente renderizada
    targetX:       0,     // posición X destino (para idle lerp)
    rafId:         null,  // handle del requestAnimationFrame activo
    isSpinning:    false, // true mientras dure la animación del giro
    spinFrom:      0,
    spinTo:        0,
    spinDuration:  0,
    spinStartTime: 0,
    onSpinEnd:     null,  // callback al terminar el spin
    track:         null,  // referencia al elemento del track actual
    wrapperWidth:  0,
};

// ── Ruleta 3D (opcional) ─────────────────────────────────────────────────────
// Si algo falla (sin WebGL, sin red al CDN, módulo ausente) se usa el cover-flow.
// Para desactivarla:  localStorage.roulette3d = "off"
const r3d = {
    wheel:  null,   // instancia devuelta por createWheel()
    active: false,  // true mientras la rueda 3D es la que está en pantalla
};
let r3dModPromise = null;

function r3dAllowed() {
    try { return localStorage.getItem('roulette3d') !== 'off'; }
    catch (_) { return true; }
}

function loadR3DModule() {
    if (!r3dModPromise) {
        r3dModPromise = import('./roulette3d.js').catch((err) => {
            r3dModPromise = null; // permite reintentar
            throw err;
        });
    }
    return r3dModPromise;
}

// ── UI dentro de la escena 3D (menú de modos + pantalla de carga) ───────────
const sceneUI = {
    root: null, loading: null, bar: null, label: null, modebar: null, panels: null,
    inScene: false,   // true = el menú de modos vive dentro de la escena
    busy: false,      // true mientras se muestra la pantalla de carga
    homes: [],        // dónde estaban los paneles originalmente (para el respaldo)
    sync: null,       // sincroniza el modo activo con los botones
    showLoading() {}, hideLoading() {}, setProgress() {}, enable() {},
};

function injectSceneStyles() {
    if (document.getElementById('roulette-scene-ui-styles')) return;
    const st = document.createElement('style');
    st.id = 'roulette-scene-ui-styles';
    st.textContent = `
    .roulette-modal-content.r3d-ui-on { max-width: 940px; }
    .roulette-modal-content.r3d-ui-on .roulette-mode-toggle { display:none !important; }
    .roulette-modal-content.r3d-ui-on .roulette-carousel-wrapper {
      height: clamp(340px, 56vh, 490px); perspective: none; overflow: hidden; position: relative;
      background: radial-gradient(ellipse at 50% 60%, #1c212c 0%, #0b0d12 75%); }
    .roulette-modal-content.r3d-ui-on .roulette-carousel-wrapper::before,
    .roulette-modal-content.r3d-ui-on .roulette-carousel-wrapper::after { display:none; }
    .roulette-modal-content.r3d-ui-on .roulette-carousel-track,
    .roulette-modal-content.r3d-ui-on .roulette-selector { display:none !important; }

    .r3d-ui { position:absolute; inset:0; z-index:12; pointer-events:none; }
    .r3d-side { position:absolute; top:10px; right:10px; width:188px; align-items:flex-end; max-height:calc(100% - 20px);
      display:flex; flex-direction:column; gap:8px; pointer-events:none; transition:opacity .35s ease; }
    .r3d-modebar { display:flex; flex-direction:column; gap:2px; padding:5px; border-radius:14px; width:100%;
      background:rgba(8,10,14,.74); border:1px solid rgba(255,255,255,.14); backdrop-filter:blur(6px);
      pointer-events:auto; }
    .r3d-modebar button { border:0; cursor:pointer; color:rgba(255,255,255,.7); background:transparent;
      font:600 12px/1 sans-serif; padding:8px 10px; border-radius:9px; text-align:left; white-space:nowrap;
      display:flex; align-items:center; gap:8px; transition:background .2s ease, color .2s ease; }
    .r3d-modebar button::before { content:""; width:6px; height:6px; border-radius:50%; background:rgba(255,255,255,.3); flex:none; }
    .r3d-modebar button:hover { color:#fff; background:rgba(255,255,255,.08); }
    .r3d-modebar button.active { color:#fff; background:rgba(229,9,20,.9); box-shadow:0 0 12px rgba(229,9,20,.35); }
    .r3d-modebar button.active::before { background:#fff; }
    .r3d-modebar .r3d-mode-head { justify-content:space-between; color:#fff; padding:9px 10px; }
    .r3d-modebar .r3d-mode-head::before { display:none; }
    .r3d-mode-head .r3d-mode-cur { display:flex; align-items:center; gap:8px; }
    .r3d-mode-head .r3d-mode-cur::before { content:\"\"; width:6px; height:6px; border-radius:50%; background:#e50914; box-shadow:0 0 8px rgba(229,9,20,.8); }
    .r3d-mode-head .r3d-chev { width:7px; height:7px; border-right:2px solid currentColor; border-bottom:2px solid currentColor;
      transform:rotate(45deg) translate(-2px,-2px); transition:transform .2s ease; opacity:.8; }
    .r3d-modebar.open .r3d-chev { transform:rotate(-135deg) translate(-2px,-2px); }
    .r3d-mode-list { display:none; flex-direction:column; gap:2px; margin-top:2px; padding-top:4px; border-top:1px solid rgba(255,255,255,.1); }
    .r3d-modebar.open .r3d-mode-list { display:flex; }
    .r3d-panels { pointer-events:auto; }
    .r3d-panels > * { background:rgba(8,10,14,.8); border:1px solid rgba(255,255,255,.14);
      border-radius:12px; padding:8px; backdrop-filter:blur(6px); margin:0 !important; font-size:11.5px; }
    .r3d-panels input { font-size:12.5px !important; padding:7px 9px 7px 30px !important; min-height:0 !important; }
    .r3d-panels [id$="-hint"] { font-size:11px !important; margin:6px 2px 0 !important; line-height:1.3; }
    .roulette-carousel-wrapper:has(.r3d-stage[data-state="spinning"]) .r3d-side { opacity:0; pointer-events:none; }

    .r3d-loading { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;
      justify-content:center; gap:14px; padding:0 8%; text-align:center; pointer-events:auto; color:#fff;
      background:radial-gradient(ellipse at 50% 55%, rgba(28,33,44,.96), rgba(8,10,14,.98));
      opacity:0; visibility:hidden; transition:opacity .45s ease, visibility 0s linear .45s; }
    .r3d-loading.on { opacity:1; visibility:visible; transition:opacity .2s ease; }
    .r3d-loading-ring { width:54px; height:54px; border-radius:50%; border:4px solid rgba(255,255,255,.14);
      border-top-color:#e50914; border-right-color:#f5c542; animation:r3dspin 1s linear infinite; }
    @keyframes r3dspin { to { transform:rotate(360deg); } }
    .r3d-loading-label { font:600 14px/1.3 sans-serif; color:rgba(255,255,255,.9); }
    .r3d-loading-bar { width:min(260px, 70%); height:5px; border-radius:99px; background:rgba(255,255,255,.14); overflow:hidden; }
    .r3d-loading-bar > i { display:block; height:100%; width:4%; border-radius:inherit;
      background:linear-gradient(90deg,#e50914,#f5c542); transition:width .35s ease; }
    @media (max-width:560px) { .r3d-side { width:158px; } }
    `;
    document.head.appendChild(st);
}

/** Oculta la rueda 3D y devuelve el modal al aspecto del cover-flow */
function leave3D() {
    r3d.active = false;
    if (r3d.wheel) r3d.wheel.hide();
    shared?.DOM?.rouletteModal
        ?.querySelector('.roulette-modal-content')
        ?.classList.remove('r3d-on');
}

function dispose3D() {
    leave3D();
    if (r3d.wheel) {
        try { r3d.wheel.dispose(); } catch (_) { /* nada */ }
        r3d.wheel = null;
    }
}

/** Easing ease-in-out cúbico — simula slot machine */
function easeSpin(t) {
    return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Aplica las transformaciones 3D cover-flow a cada tarjeta en base a su
 *  distancia al centro del wrapper. Se llama en cada frame del rAF. */
function applyCoverFlow() {
    if (!cf.track || !cf.wrapperWidth) return;
    const cards = cf.track.querySelectorAll('.movie-card');
    const center  = cf.wrapperWidth / 2;
    const maxDist = 540; // px desde el centro hasta donde la tarjeta queda "aplastada"

    cards.forEach(card => {
        // posición del centro de la tarjeta en el espacio del wrapper
        const cardCenter = card.offsetLeft + card.offsetWidth / 2 + cf.currentX;
        const dist    = cardCenter - center;
        const absDist = Math.abs(dist);
        const t       = Math.min(absDist / maxDist, 1);

        const scale      = 1 - t * 0.38;                                 // 1 → 0.62
        const rotateY    = Math.sign(dist) * Math.min(absDist / 11, 28); // ±0 → ±28 °
        const translateZ = -t * 75;                                       // 0 → -75px
        const opacity    = Math.max(1 - t * 0.55, 0.1);

        card.style.transform = `perspective(900px) translateZ(${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`;
        card.style.opacity   = String(opacity);
        card.style.zIndex    = String(Math.round((1 - t) * 10));
    });
}

/** Tick principal del rAF — maneja tanto el spin como el idle lerp */
function coverFlowTick(now) {
    if (cf.isSpinning) {
        const elapsed  = now - cf.spinStartTime;
        const progress = Math.min(elapsed / cf.spinDuration, 1);
        const eased    = easeSpin(progress);
        cf.currentX    = cf.spinFrom + (cf.spinTo - cf.spinFrom) * eased;

        if (progress >= 1) {
            cf.isSpinning = false;
            cf.currentX   = cf.spinTo;
            cf.targetX    = cf.spinTo;
            const cb = cf.onSpinEnd;
            cf.onSpinEnd = null;
            if (cb) cb();
        }
    } else {
        // idle: suave interpolación hacia el punto inicial (settle al cargar)
        const delta = cf.targetX - cf.currentX;
        if (Math.abs(delta) > 0.1) {
            cf.currentX += delta * 0.14;
        } else {
            cf.currentX = cf.targetX;
        }
    }

    if (cf.track) {
        cf.track.style.transform = `translateX(${cf.currentX}px)`;
    }
    applyCoverFlow();

    cf.rafId = requestAnimationFrame(coverFlowTick);
}

/** Inicia (o reinicia) el loop del cover-flow */
function startCoverFlowLoop(track, wrapperWidth) {
    cf.track        = track;
    cf.wrapperWidth = wrapperWidth;
    stopCoverFlowLoop();
    cf.rafId = requestAnimationFrame(coverFlowTick);
}

/** Detiene el loop del cover-flow */
function stopCoverFlowLoop() {
    if (cf.rafId !== null) {
        cancelAnimationFrame(cf.rafId);
        cf.rafId = null;
    }
}

/** Reinicia el estado de posición del cover-flow (sin detener el loop) */
function resetCoverFlowState(startX = 0) {
    cf.isSpinning   = false;
    cf.onSpinEnd    = null;
    cf.currentX     = startX;
    cf.targetX      = startX;
}

// ── Exports ──────────────────────────────────────────────────────────────────

export function initRoulette(dependencies) {
    if (isInitialized) return;
    shared = dependencies;
    setupRouletteLogic();
    isInitialized = true;
    ensureWatchedLoaded();
}

// Carga única por usuario. Antes solo se cargaba al abrir el modal de la
// ruleta, así que el ojo del detalle de película mostraba "Marcar como vista"
// aunque ya lo estuviera.
let watchedLoadedFor = null;
let watchedReadyPromise = null;

function ensureWatchedLoaded() {
    const uid = shared?.auth?.currentUser?.uid;
    if (!uid) return Promise.resolve();
    if (watchedLoadedFor === uid && watchedReadyPromise) return watchedReadyPromise;
    watchedReadyPromise = loadWatchedFromFirebase().then(() => { watchedLoadedFor = uid; });
    return watchedReadyPromise;
}

async function loadWatchedFromFirebase() {
    const user = shared.auth?.currentUser;
    if (!user || !shared.db) return;
    try {
        const snap = await shared.db.ref(`users/${user.uid}/roulette_watched`).once('value');
        watchedMovieIds = snap.exists() ? new Set(Object.keys(snap.val())) : new Set();
    } catch (e) {
        console.warn('No se pudo cargar roulette_watched:', e);
    }
}

async function markAsWatched(movieId) {
    const user = shared.auth?.currentUser;
    if (!user || !shared.db) return;
    watchedMovieIds.add(movieId);

    let movieData = shared.appState.content.movies?.[movieId];
    if (!movieData && shared.appState.content.sagas) {
        for (const sagaData of Object.values(shared.appState.content.sagas)) {
            if (sagaData?.[movieId]) { movieData = sagaData[movieId]; break; }
        }
    }

    await Promise.all([
        shared.db.ref(`users/${user.uid}/roulette_watched/${movieId}`).set(true),
        shared.db.ref(`users/${user.uid}/history/${movieId}`).set({
            type:        'movie',
            contentId:   movieId,
            title:       movieData?.title || movieId,
            poster:      movieData?.poster || '',
            viewedAt:    firebase.database.ServerValue.TIMESTAMP,
            season:      null,
            lastEpisode: null,
            progress:    1
        })
    ]);
}

async function unmarkAsWatched(movieId) {
    const user = shared.auth?.currentUser;
    if (!user || !shared.db) return;
    watchedMovieIds.delete(movieId);
    await Promise.all([
        shared.db.ref(`users/${user.uid}/roulette_watched/${movieId}`).remove(),
        shared.db.ref(`users/${user.uid}/history/${movieId}`).remove()
    ]);
}

function closeRouletteModal() {
    stopCoverFlowLoop(); // liberar recursos al cerrar
    if (r3d.wheel) r3d.wheel.pause();
    if (shared.DOM.rouletteModal) shared.DOM.rouletteModal.classList.remove('show');
    if (!document.querySelector('.modal.show')) document.body.classList.remove('modal-open');
}

function setupRouletteLogic() {
    const spinButton = shared.DOM.rouletteModal?.querySelector('#spin-roulette-btn');
    const btnVer     = shared.DOM.rouletteModal?.querySelector('#roulette-btn-ver');
    const btnVista   = shared.DOM.rouletteModal?.querySelector('#roulette-btn-vista');
    if (!shared.DOM.rouletteModal || !spinButton) return;

    let selectedMovie = null;
    let spinDone      = false;

    const setActionButtons = (enabled) => {
        if (btnVer)   btnVer.disabled   = !enabled;
        if (btnVista) btnVista.disabled = !enabled || customMode;
    };

    // ── Modo toggle ─────────────────────────────────────────────────────────
    const btnModeNormal = shared.DOM.rouletteModal.querySelector('#roulette-mode-normal');
    const btnModeCustom = shared.DOM.rouletteModal.querySelector('#roulette-mode-custom');
    const btnModeGenre  = shared.DOM.rouletteModal.querySelector('#roulette-mode-genre');
    const customPanel   = shared.DOM.rouletteModal.querySelector('#custom-roulette-panel');
    const genrePanel    = shared.DOM.rouletteModal.querySelector('#genre-roulette-panel');
    const rouletteTitle = shared.DOM.rouletteModal.querySelector('#roulette-title');

    // ── UI dentro de la escena: menú de modos + pantalla de carga ───────────
    const setupSceneUI = () => {
        const wrapper = shared.DOM.rouletteModal.querySelector('.roulette-carousel-wrapper');
        const content = shared.DOM.rouletteModal.querySelector('.roulette-modal-content');
        if (!wrapper || !content || sceneUI.root) return;
        injectSceneStyles();
        if (getComputedStyle(wrapper).position === 'static') wrapper.style.position = 'relative';

        const root = document.createElement('div');
        root.className = 'r3d-ui';

        const modebar = document.createElement('div');
        modebar.className = 'r3d-modebar';
        const modeLabels = { normal: 'Normal', custom: 'Personalizada', genre: 'Por género' };

        // Botón principal (muestra el modo actual y despliega/pliega la lista)
        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'r3d-mode-head';
        head.setAttribute('aria-haspopup', 'true');
        head.setAttribute('aria-expanded', 'false');
        head.innerHTML = '<span class="r3d-mode-cur"></span><span class="r3d-chev"></span>';
        const headLabel = head.querySelector('.r3d-mode-cur');
        const setOpen = (open) => {
            modebar.classList.toggle('open', open);
            head.setAttribute('aria-expanded', String(open));
        };
        head.addEventListener('click', () => setOpen(!modebar.classList.contains('open')));
        // Cerrar al hacer clic fuera del menú
        document.addEventListener('click', (e) => {
            if (!modebar.contains(e.target)) setOpen(false);
        });

        const list = document.createElement('div');
        list.className = 'r3d-mode-list';
        Object.entries(modeLabels).forEach(([m, label]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.dataset.mode = m;
            b.textContent = label;
            b.addEventListener('click', () => {
                setOpen(false);
                if (sceneUI.busy) return;
                const cur = customMode ? 'custom' : genreMode ? 'genre' : 'normal';
                if (m !== cur) setMode(m);
            });
            list.appendChild(b);
        });
        modebar.append(head, list);

        const panels = document.createElement('div');
        panels.className = 'r3d-panels';

        const loading = document.createElement('div');
        loading.className = 'r3d-loading';
        loading.innerHTML = '<div class="r3d-loading-ring"></div><div class="r3d-loading-label"></div>'
                          + '<div class="r3d-loading-bar"><i></i></div>';

        const side = document.createElement('div');
        side.className = 'r3d-side';
        side.append(modebar, panels);
        root.append(side, loading);
        wrapper.appendChild(root);

        sceneUI.root    = root;
        sceneUI.modebar = modebar;
        sceneUI.panels  = panels;
        sceneUI.loading = loading;
        sceneUI.label   = loading.querySelector('.r3d-loading-label');
        sceneUI.bar     = loading.querySelector('.r3d-loading-bar > i');

        sceneUI.sync = () => {
            const cur = customMode ? 'custom' : genreMode ? 'genre' : 'normal';
            list.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === cur));
            headLabel.textContent = modeLabels[cur];
        };
        sceneUI.showLoading = (text = 'Cargando la ruleta…', p = 0.05) => {
            if (!sceneUI.inScene) return;
            sceneUI.busy = true;
            loading.classList.add('on');
            sceneUI.setProgress(p, text);
        };
        sceneUI.setProgress = (p, text) => {
            if (text && sceneUI.label) sceneUI.label.textContent = text;
            if (sceneUI.bar) sceneUI.bar.style.width = Math.max(4, Math.min(100, Math.round(p * 100))) + '%';
        };
        sceneUI.hideLoading = () => {
            sceneUI.busy = false;
            loading.classList.remove('on');
        };
        // Mueve los paneles de búsqueda dentro de la escena (o los devuelve a su sitio)
        sceneUI.enable = (on) => {
            if (on === sceneUI.inScene) return;
            sceneUI.inScene = on;
            content.classList.toggle('r3d-ui-on', on);
            root.style.display = on ? '' : 'none';
            const list = [customPanel, genrePanel].filter(Boolean);
            if (on) {
                sceneUI.homes = list.map((el) => ({ el, parent: el.parentNode, next: el.nextSibling }));
                list.forEach((el) => panels.appendChild(el));
                sceneUI.sync();
            } else {
                sceneUI.hideLoading();
                sceneUI.homes.forEach(({ el, parent, next }) => {
                    if (parent && parent.isConnected) parent.insertBefore(el, next && next.parentNode === parent ? next : null);
                });
                sceneUI.homes = [];
            }
        };

        if (r3dAllowed()) {
            sceneUI.enable(true);
            // Si no hay WebGL o falla el módulo, se vuelve al menú de siempre
            loadR3DModule()
                .then((mod) => { if (!mod.webglAvailable()) sceneUI.enable(false); })
                .catch(() => sceneUI.enable(false));
        } else {
            root.style.display = 'none';
        }
    };

    const setMode = (mode) => {
        customMode    = mode === 'custom';
        genreMode     = mode === 'genre';
        selectedGenre = null;
        btnModeNormal?.classList.toggle('active', mode === 'normal');
        btnModeCustom?.classList.toggle('active', customMode);
        btnModeGenre?.classList.toggle('active', genreMode);
        sceneUI.sync?.();
        if (customPanel)   customPanel.style.display = customMode ? 'block' : 'none';
        if (genrePanel)    genrePanel.style.display  = genreMode  ? 'block' : 'none';
        if (btnVista)      btnVista.style.display    = customMode ? 'none'  : '';
        if (rouletteTitle) {
            rouletteTitle.textContent = customMode ? 'Ruleta Personalizada'
                                      : genreMode  ? 'Ruleta por Género'
                                      :              'Película Aleatoria';
        }

        buildToken++;
        leave3D();
        sceneUI.hideLoading();
        spinDone      = false;
        selectedMovie = null;
        setActionButtons(false);

        const track = shared.DOM.rouletteModal.querySelector('#roulette-carousel-track');
        if (track) {
            stopCoverFlowLoop();
            resetCoverFlowState(0);
            track.style.transform = 'translateX(0px)';
            track.innerHTML = '';
        }
        spinButton.disabled = false;

        const _sel = shared.DOM.rouletteModal.querySelector('.roulette-selector');

        if (customMode) {
            customPool = [];
            const _chips  = shared.DOM.rouletteModal.querySelector('#crp-chips');
            const _hint   = shared.DOM.rouletteModal.querySelector('#crp-hint');
            const _search = shared.DOM.rouletteModal.querySelector('#crp-search-input');
            const _sugg   = shared.DOM.rouletteModal.querySelector('#crp-suggestions');
            if (_chips)  _chips.innerHTML  = '';
            if (_hint)   _hint.textContent = 'Agrega al menos 2 películas para girar';
            if (_search) _search.value     = '';
            if (_sugg)   _sugg.style.display = 'none';
            if (_sel)    _sel.style.visibility = 'hidden';
            spinButton.disabled = true;
        } else if (genreMode) {
            if (_sel) _sel.style.visibility = 'hidden';
            spinButton.disabled = true;
            if (genreInputEl) genreInputEl.value = '';
            hideGenreSuggestions();
            updateGenreHint();
        } else {
            if (_sel) _sel.style.visibility = 'visible';
            loadRouletteMovies();
        }
    };

    btnModeNormal?.addEventListener('click', () => { if (customMode || genreMode) setMode('normal'); });
    btnModeCustom?.addEventListener('click', () => { if (!customMode) setMode('custom'); });
    btnModeGenre?.addEventListener('click',  () => { if (!genreMode)  setMode('genre');  });
    setupSceneUI();

    // ── Buscador (modo personalizado) ────────────────────────────────────────
    const searchInput   = shared.DOM.rouletteModal.querySelector('#crp-search-input');
    const suggestionsEl = shared.DOM.rouletteModal.querySelector('#crp-suggestions');
    const chipsEl       = shared.DOM.rouletteModal.querySelector('#crp-chips');
    const hintEl        = shared.DOM.rouletteModal.querySelector('#crp-hint');

    const getFullPool = () => {
        const pool = { ...shared.appState.content.movies };
        if (shared.appState.content.sagas) {
            for (const sagaData of Object.values(shared.appState.content.sagas)) {
                if (!sagaData) continue;
                for (const [id, item] of Object.entries(sagaData)) {
                    if ((item.type || 'movie') === 'movie') pool[id] = item;
                }
            }
        }
        return pool;
    };

    const updateCustomHint = () => {
        if (!hintEl) return;
        if (customPool.length === 0) {
            hintEl.textContent = 'Agrega al menos 2 películas para girar';
        } else if (customPool.length === 1) {
            hintEl.textContent = 'Agrega al menos 1 película más para girar';
        } else {
            hintEl.textContent = `${customPool.length} películas en la ruleta`;
        }
        spinButton.disabled = customPool.length < 2;
    };

    // ── Modo por género ──────────────────────────────────────────────────────
    const genreInputEl = shared.DOM.rouletteModal.querySelector('#grp-search-input');
    const genreSuggEl  = shared.DOM.rouletteModal.querySelector('#grp-suggestions');
    const genreHintEl  = shared.DOM.rouletteModal.querySelector('#grp-hint');

    const normGenre = (g) => String(g).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const parseGenres = (item) =>
        String(item?.genres || item?.generos || '').split(/[;,]/).map(g => g.trim()).filter(Boolean);
    const isAvailable = (id, item) =>
        !watchedMovieIds.has(id) && String(item?.estado || '').toLowerCase() !== 'vetada';

    // Géneros con películas disponibles (sin vistas ni vetadas), de mayor a menor
    const getGenreList = () => {
        const map = new Map();
        for (const [id, item] of Object.entries(getFullPool())) {
            if (!isAvailable(id, item)) continue;
            const seen = new Set();
            for (const g of parseGenres(item)) {
                const key = normGenre(g);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                const entry = map.get(key);
                if (entry) entry.count++;
                else map.set(key, { key, name: g, count: 1 });
            }
        }
        return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    };

    const getGenrePool = () =>
        Object.entries(getFullPool())
            .filter(([id, item]) => isAvailable(id, item) &&
                parseGenres(item).some(g => normGenre(g) === selectedGenre))
            .map(([id, data]) => ({ id, data }));

    // Texto de ayuda según el género elegido
    const updateGenreHint = () => {
        if (!genreHintEl) return;
        const genres  = getGenreList();
        const current = genres.find(g => g.key === selectedGenre);
        genreHintEl.textContent = !genres.length
            ? 'No hay géneros disponibles'
            : current
                ? `${current.count} película${current.count !== 1 ? 's' : ''} de ${current.name} disponible${current.count !== 1 ? 's' : ''}`
                : 'Escribe un género para armar la ruleta';
    };

    const hideGenreSuggestions = () => {
        if (genreSuggEl) genreSuggEl.style.display = 'none';
    };

    const pickGenre = ({ key, name }) => {
        selectedGenre = key;
        if (genreInputEl) genreInputEl.value = name;
        if (rouletteTitle) rouletteTitle.textContent = `Ruleta de ${name}`;
        hideGenreSuggestions();
        loadRouletteMovies();
    };

    // Sugerencias que coinciden con lo escrito (o todas si el campo está vacío)
    const getGenreMatches = () => {
        const q = normGenre(genreInputEl?.value || '');
        return getGenreList().filter(g => !q || g.key.includes(q)).slice(0, 12);
    };

    const showGenreSuggestions = () => {
        if (!genreSuggEl) return;
        const matches = getGenreMatches();
        if (!matches.length) { hideGenreSuggestions(); return; }
        genreSuggEl.innerHTML = matches.map(g => `
            <div class="crp-suggestion-item" data-key="${g.key}">
                <span>${g.name}</span>
                <span class="grp-sugg-count">${g.count}</span>
            </div>`).join('');
        genreSuggEl.style.display = 'block';
        genreSuggEl.querySelectorAll('.crp-suggestion-item').forEach(el => {
            el.addEventListener('click', () => {
                const g = matches.find(m => m.key === el.dataset.key);
                if (g) pickGenre(g);
            });
        });
    };

    if (genreInputEl) {
        genreInputEl.addEventListener('input', showGenreSuggestions);
        genreInputEl.addEventListener('focus', showGenreSuggestions);
        genreInputEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const q = normGenre(genreInputEl.value);
            const matches = getGenreMatches();
            const pick = matches.find(g => g.key === q) || matches[0];
            if (pick) pickGenre(pick);
        });
        document.addEventListener('click', (e) => {
            if (genreSuggEl && !genreInputEl.contains(e.target) && !genreSuggEl.contains(e.target)) {
                hideGenreSuggestions();
            }
        });
    }

    const renderChips = () => {
        if (!chipsEl) return;
        chipsEl.innerHTML = '';
        customPool.forEach(({ id, data }) => {
            const chip = document.createElement('div');
            chip.className = 'crp-chip';
            chip.innerHTML = `
                <img src="${data.poster || ''}" alt="">
                <span class="crp-chip-title">${data.title || id}</span>
                <button class="crp-chip-remove" title="Quitar"><i class="fas fa-times"></i></button>
            `;
            chip.querySelector('.crp-chip-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                customPool = customPool.filter(m => m.id !== id);
                renderChips();
                updateCustomHint();
                spinDone      = false;
                selectedMovie = null;
                setActionButtons(false);
                loadRouletteMovies();
            });
            chipsEl.appendChild(chip);
        });
    };

    const addToCustomPool = (id, data) => {
        if (customPool.some(m => m.id === id)) return;
        customPool.push({ id, data });
        renderChips();
        updateCustomHint();
        if (searchInput)   searchInput.value       = '';
        if (suggestionsEl) suggestionsEl.style.display = 'none';
        spinDone      = false;
        selectedMovie = null;
        setActionButtons(false);
        loadRouletteMovies();
    };

    if (searchInput) {
        const normalize = str => str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        searchInput.addEventListener('input', () => {
            const q = normalize(searchInput.value.trim());
            if (!q || q.length < 2) {
                if (suggestionsEl) suggestionsEl.style.display = 'none';
                return;
            }
            const pool = getFullPool();
            const results = Object.entries(pool)
                .filter(([, d]) => normalize(d.title || '').includes(q))
                .slice(0, 10);

            if (!results.length) {
                if (suggestionsEl) suggestionsEl.style.display = 'none';
                return;
            }
            suggestionsEl.innerHTML = results.map(([id, d]) => {
                const already = customPool.some(m => m.id === id);
                return `
                    <div class="crp-suggestion-item" data-id="${id}">
                        <img src="${d.poster || ''}" alt="" loading="lazy">
                        <span>${d.title || id}</span>
                        ${already ? '<span class="crp-suggestion-already">✓</span>' : ''}
                    </div>`;
            }).join('');
            suggestionsEl.style.display = 'block';

            suggestionsEl.querySelectorAll('.crp-suggestion-item').forEach(item => {
                item.addEventListener('click', () => {
                    const id   = item.dataset.id;
                    const pool = getFullPool();
                    addToCustomPool(id, pool[id]);
                });
            });
        });

        document.addEventListener('click', (e) => {
            if (suggestionsEl && !searchInput.contains(e.target) && !suggestionsEl.contains(e.target)) {
                suggestionsEl.style.display = 'none';
            }
        });
    }

    // ── Ruleta 3D: montaje con respaldo automático ──────────────────────────
    let buildToken = 0; // se incrementa en cada recarga/cambio de modo

    /** Devuelve true si la rueda 3D quedó (o quedará) en pantalla. */
    const mount3D = async (entries, winnerId) => {
        if (!r3dAllowed()) return false;
        const token   = buildToken;
        const content = shared.DOM.rouletteModal.querySelector('.roulette-modal-content');
        const wrapper = shared.DOM.rouletteModal.querySelector('.roulette-carousel-wrapper');
        if (!content || !wrapper) return false;
        try {
            sceneUI.showLoading('Cargando motor 3D…', 0.08);
            const mod = await loadR3DModule();
            if (!mod.webglAvailable()) { sceneUI.enable(false); return false; }
            if (token !== buildToken) return true;
            if (getComputedStyle(wrapper).position === 'static') wrapper.style.position = 'relative';
            if (r3d.wheel && r3d.wheel.isDead()) dispose3D();
            if (!r3d.wheel) {
                sceneUI.setProgress(0.2, 'Armando la ruleta…');
                r3d.wheel = await mod.createWheel(wrapper);
            }
            if (token !== buildToken) return true; // otra carga más reciente se encarga
            const { items, winnerIndex } = mod.prepareWheelItems(entries, winnerId);

            // La pantalla de carga se quita cuando la mayoría de pósters ya está lista
            let finished = false;
            let timer = null;
            const finish = () => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                if (token === buildToken) sceneUI.hideLoading();
            };
            timer = setTimeout(finish, 8000); // nunca se queda atascada
            sceneUI.setProgress(0.4, 'Cargando pósters…');
            r3d.wheel.setItems(items, winnerIndex, (done, total) => {
                if (finished || token !== buildToken) return;
                sceneUI.setProgress(0.4 + 0.6 * (done / total), `Cargando pósters ${done} de ${total}`);
                if (done >= total) setTimeout(finish, 250);
            });
            content.classList.add('r3d-on');
            r3d.wheel.show();
            r3d.active = true;
            return true;
        } catch (err) {
            console.warn('[Ruleta 3D] usando cover-flow:', err);
            dispose3D();
            sceneUI.enable(false);
            return false;
        }
    };

    // Arma el carrusel a partir de un array de { id, data } (repite si hay pocas)
    const buildFromPool = async (poolArr, rouletteTrack) => {
        const _sel = shared.DOM.rouletteModal.querySelector('.roulette-selector');
        if (_sel) _sel.style.visibility = 'visible';

        const shuffled = [...poolArr].sort(() => Math.random() - 0.5);
        const repeated = [];
        while (repeated.length < 35) {
            for (const item of shuffled) {
                repeated.push(item);
                if (repeated.length >= 35) break;
            }
        }
        const finalPickIndex = Math.floor(repeated.length * 0.6);
        selectedMovie = repeated[finalPickIndex];

        const winnerEntry = selectedMovie;
        if (await mount3D(
            poolArr.map((m) => ({ id: m.id, title: m.data?.title, poster: m.data?.poster })),
            winnerEntry.id
        )) return;
        sceneUI.hideLoading();

        repeated.forEach((item, index) => {
            const card = shared.createMovieCardElement(item.id, item.data, 'movie', 'roulette', false);
            if (index === finalPickIndex) card.dataset.winner = 'true';
            rouletteTrack.appendChild(card);
        });

        setTimeout(() => {
            const wrapperWidth = rouletteTrack.parentElement.offsetWidth;
            const card = rouletteTrack.querySelector('.movie-card');
            if (!card) return;
            const cardWidth   = card.offsetWidth + 20;
            const startOffset = wrapperWidth / 2 - cardWidth * 2.5;

            resetCoverFlowState(startOffset);
            startCoverFlowLoop(rouletteTrack, wrapperWidth);
        }, 50);
    };

    // ── Cargar carrusel (normal, personalizado o por género) ─────────────────
    const loadRouletteMovies = async () => {
        const rouletteTrack = shared.DOM.rouletteModal.querySelector('#roulette-carousel-track');
        if (!rouletteTrack) return;

        buildToken++;
        leave3D();
        spinDone      = false;
        selectedMovie = null;
        setActionButtons(false);

        if (btnVista) btnVista.innerHTML = `<i class="fas fa-eye-slash"></i> Vista`;

        // Detener loop anterior y resetear
        stopCoverFlowLoop();
        resetCoverFlowState(0);
        rouletteTrack.classList.remove('is-spinning');
        rouletteTrack.style.transform = 'translateX(0px)';
        rouletteTrack.innerHTML = '';
        spinButton.disabled = false;
        if (!customMode && !genreMode) sceneUI.showLoading('Cargando la ruleta…', 0.05);
        else sceneUI.hideLoading();

        // ── MODO PERSONALIZADO ────────────────────────────────────────────────
        if (customMode) {
            if (customPool.length < 2) {
                spinButton.disabled = true;
                return;
            }
            await buildFromPool(customPool, rouletteTrack);
            return;
        }

        // ── MODO POR GÉNERO ───────────────────────────────────────────────────
        if (genreMode) {
            updateGenreHint();
            if (!selectedGenre) {
                spinButton.disabled = true;
                return;
            }
            const genrePool = getGenrePool();
            if (genrePool.length < 2) {
                const _sel = shared.DOM.rouletteModal.querySelector('.roulette-selector');
                if (_sel) _sel.style.visibility = 'hidden';
                rouletteTrack.innerHTML = `<p style="color:var(--text-muted);padding:20px;text-align:center;">${
                    genrePool.length === 0
                        ? 'Ya viste todas las películas de este género 🎉'
                        : 'Solo queda 1 película de este género sin ver.'
                }</p>`;
                spinButton.disabled = true;
                return;
            }
            await buildFromPool(genrePool, rouletteTrack);
            return;
        }

        // ── MODO NORMAL ───────────────────────────────────────────────────────
        if (!shared.appState.content.movies || Object.keys(shared.appState.content.movies).length < 10) {
            sceneUI.hideLoading();
            rouletteTrack.innerHTML = `<p>No hay suficientes películas.</p>`;
            spinButton.disabled = true;
            return;
        }

        // Solo películas sueltas (allmovies): los universos/sagas ya no entran al sorteo normal
        const fullPool = { ...shared.appState.content.movies };

        const availableIds = Object.keys(fullPool).filter(id => {
            if (watchedMovieIds.has(id)) return false;
            const estado = fullPool[id]?.estado;
            if (estado && estado.toLowerCase() === 'vetada') return false;
            return true;
        });

        if (availableIds.length < 5) {
            sceneUI.hideLoading();
            rouletteTrack.innerHTML = `<p style="color:var(--text-muted);padding:20px;text-align:center;">Ya viste todas las películas disponibles 🎉</p>`;
            spinButton.disabled = true;
            return;
        }

        const shuffled      = [...availableIds].sort(() => Math.random() - 0.5);
        const batchIds      = shuffled.slice(0, Math.min(35, availableIds.length));
        const finalPickIndex = Math.floor(batchIds.length * 0.6);
        selectedMovie = { id: batchIds[finalPickIndex], data: fullPool[batchIds[finalPickIndex]] };

        if (await mount3D(
            batchIds.map((id) => ({ id, title: fullPool[id]?.title, poster: fullPool[id]?.poster })),
            selectedMovie.id
        )) return;
        sceneUI.hideLoading();

        batchIds.forEach((id, index) => {
            const card = shared.createMovieCardElement(id, fullPool[id], 'movie', 'roulette', false);
            if (index === finalPickIndex) card.dataset.winner = 'true';
            rouletteTrack.appendChild(card);
        });

        setTimeout(() => {
            const wrapperWidth = rouletteTrack.parentElement.offsetWidth;
            const card = rouletteTrack.querySelector('.movie-card');
            if (!card) return;
            const cardWidth   = card.offsetWidth + 20;
            const startOffset = wrapperWidth / 2 - cardWidth * 2.5;

            resetCoverFlowState(startOffset);
            startCoverFlowLoop(rouletteTrack, wrapperWidth);
        }, 50);
    };

    // ── GIRAR ────────────────────────────────────────────────────────────────
    spinButton.addEventListener('click', async () => {
        if (sceneUI.busy) return; // la ruleta aún se está cargando
        if (spinDone || !selectedMovie) {
            spinDone = false;
            setActionButtons(false);
            await loadRouletteMovies();
            await new Promise(r => setTimeout(r, 80));
        }
        if (!selectedMovie) return;

        spinButton.disabled = true;
        setActionButtons(false);

        const finishSpin = () => {
            spinDone            = true;
            spinButton.disabled = false;

            if (btnVista) {
                const yaVista = watchedMovieIds.has(selectedMovie.id);
                btnVista.innerHTML = yaVista
                    ? `<i class="fas fa-eye"></i> Quitar`
                    : `<i class="fas fa-eye-slash"></i> Vista`;
            }
            setActionButtons(true);
        };

        // Rueda 3D: la ganadora ya está decidida, la rueda solo se detiene en ella
        if (r3d.active && r3d.wheel) {
            r3d.wheel.spin(finishSpin);
            return;
        }

        const rouletteTrack = shared.DOM.rouletteModal.querySelector('#roulette-carousel-track');
        rouletteTrack.classList.add('is-spinning');

        const winnerCard = rouletteTrack.querySelector('[data-winner="true"]');
        if (!winnerCard) return;

        const wrapperWidth  = rouletteTrack.parentElement.offsetWidth;
        const cardWidth     = winnerCard.offsetWidth;
        const centerPosition = (wrapperWidth / 2) - winnerCard.offsetLeft - (cardWidth / 2);
        const maxOffset     = Math.floor(cardWidth * 0.50);
        const randomJitter  = Math.floor(Math.random() * (maxOffset * 2 + 1)) - maxOffset;
        const duration      = 4200 + Math.floor(Math.random() * 800);

        // Arrancar animación via rAF (sin CSS transition)
        cf.spinFrom      = cf.currentX;
        cf.spinTo        = centerPosition + randomJitter;
        cf.spinDuration  = duration;
        cf.spinStartTime = performance.now();
        cf.isSpinning    = true;
        cf.wrapperWidth  = wrapperWidth; // por si el modal fue resizado

        cf.onSpinEnd = () => {
            rouletteTrack.classList.remove('is-spinning');
            finishSpin();
        };
    });

    // ── VER ──────────────────────────────────────────────────────────────────
    if (btnVer) {
        btnVer.addEventListener('click', async () => {
            if (!selectedMovie || !spinDone) return;
            closeRouletteModal();

            const movieId    = selectedMovie.id;
            const movieTitle = selectedMovie.data.title;

            // Ya no hay temporizador de 30 min: el player guarda en historial
            // al 50% y marca como vista (ruleta incluida) al 75% del video real.
            if (shared.appState.player.movieHistoryTimer) {
                clearTimeout(shared.appState.player.movieHistoryTimer);
                shared.appState.player.movieHistoryTimer = null;
            }

            const player = await shared.getPlayerModule();
            player.openPlayerModal(movieId, movieTitle);
        });
    }

    // ── VISTA ─────────────────────────────────────────────────────────────────
    if (btnVista) {
        btnVista.addEventListener('click', async () => {
            if (!selectedMovie || !spinDone) return;
            const user = shared.auth?.currentUser;
            if (!user) {
                if (window.openAuthModal) window.openAuthModal(true);
                return;
            }
            const yaVista = watchedMovieIds.has(selectedMovie.id);
            if (yaVista) {
                await unmarkAsWatched(selectedMovie.id);
                btnVista.innerHTML = `<i class="fas fa-eye-slash"></i> Vista`;
            } else {
                await markAsWatched(selectedMovie.id);
                btnVista.innerHTML = `<i class="fas fa-eye"></i> Quitar`;
                setTimeout(() => loadRouletteMovies(), 600);
            }
        });
    }

    window.loadRouletteMovies = loadRouletteMovies;
}

export async function openRouletteModal() {
    if (!shared.appState.content.movies) return;
    if (shared.DOM.rouletteModal) {
        document.body.classList.add('modal-open');
        shared.DOM.rouletteModal.classList.add('show');

        customMode    = false;
        customPool    = [];
        genreMode     = false;
        selectedGenre = null;
        const btnModeNormal = shared.DOM.rouletteModal.querySelector('#roulette-mode-normal');
        const btnModeCustom = shared.DOM.rouletteModal.querySelector('#roulette-mode-custom');
        const customPanel   = shared.DOM.rouletteModal.querySelector('#custom-roulette-panel');
        const btnVista      = shared.DOM.rouletteModal.querySelector('#roulette-btn-vista');
        const rouletteTitle = shared.DOM.rouletteModal.querySelector('#roulette-title');
        if (btnModeNormal) btnModeNormal.classList.add('active');
        if (btnModeCustom) btnModeCustom.classList.remove('active');
        const btnModeGenre = shared.DOM.rouletteModal.querySelector('#roulette-mode-genre');
        const genrePanel   = shared.DOM.rouletteModal.querySelector('#genre-roulette-panel');
        if (btnModeGenre)  btnModeGenre.classList.remove('active');
        if (genrePanel)    genrePanel.style.display    = 'none';
        const genreInput   = shared.DOM.rouletteModal.querySelector('#grp-search-input');
        if (genreInput)    genreInput.value            = '';
        if (customPanel)   customPanel.style.display  = 'none';
        if (btnVista)      btnVista.style.display      = '';
        if (rouletteTitle) rouletteTitle.textContent   = 'Película Aleatoria';

        const chipsEl  = shared.DOM.rouletteModal.querySelector('#crp-chips');
        const hintEl   = shared.DOM.rouletteModal.querySelector('#crp-hint');
        const searchEl = shared.DOM.rouletteModal.querySelector('#crp-search-input');
        if (chipsEl)  chipsEl.innerHTML  = '';
        if (hintEl)   hintEl.textContent = 'Agrega al menos 2 películas para girar';
        if (searchEl) searchEl.value     = '';
        sceneUI.sync?.();
        sceneUI.showLoading('Cargando la ruleta…', 0.05);
        loadR3DModule().then((m) => m.preload && m.preload()).catch(() => {});

        await loadWatchedFromFirebase();
        if (window.loadRouletteMovies) window.loadRouletteMovies();
    }
}

export async function unmarkMovieFromRoulette(movieId) {
    await unmarkAsWatched(movieId);
}

export function whenWatchedReady() {
    return ensureWatchedLoaded();
}

export function isMovieWatched(movieId) {
    return watchedMovieIds.has(movieId);
}

export async function markMovieAsWatched(movieId) {
    await markAsWatched(movieId);
}