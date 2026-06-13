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
            lastEpisode: null
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
    const customPanel   = shared.DOM.rouletteModal.querySelector('#custom-roulette-panel');
    const rouletteTitle = shared.DOM.rouletteModal.querySelector('#roulette-title');

    const switchMode = (toCustom) => {
        customMode = toCustom;
        btnModeNormal?.classList.toggle('active', !toCustom);
        btnModeCustom?.classList.toggle('active', toCustom);
        if (customPanel)   customPanel.style.display = toCustom ? 'block' : 'none';
        if (btnVista)      btnVista.style.display    = toCustom ? 'none'  : '';
        if (rouletteTitle) rouletteTitle.textContent  = toCustom ? 'Ruleta Personalizada' : 'Película Aleatoria';

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

        if (toCustom) {
            customPool = [];
            const _chips  = shared.DOM.rouletteModal.querySelector('#crp-chips');
            const _hint   = shared.DOM.rouletteModal.querySelector('#crp-hint');
            const _search = shared.DOM.rouletteModal.querySelector('#crp-search-input');
            const _sugg   = shared.DOM.rouletteModal.querySelector('#crp-suggestions');
            const _sel    = shared.DOM.rouletteModal.querySelector('.roulette-selector');
            if (_chips)  _chips.innerHTML  = '';
            if (_hint)   _hint.textContent = 'Agrega al menos 2 películas para girar';
            if (_search) _search.value     = '';
            if (_sugg)   _sugg.style.display = 'none';
            if (_sel)    _sel.style.visibility = 'hidden';
            spinButton.disabled = true;
        } else {
            const _sel = shared.DOM.rouletteModal.querySelector('.roulette-selector');
            if (_sel) _sel.style.visibility = 'visible';
            loadRouletteMovies();
        }
    };

    btnModeNormal?.addEventListener('click', () => { if (customMode)  switchMode(false); });
    btnModeCustom?.addEventListener('click', () => { if (!customMode) switchMode(true);  });

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

    // ── Cargar carrusel (normal o personalizado) ─────────────────────────────
    const loadRouletteMovies = async () => {
        const rouletteTrack = shared.DOM.rouletteModal.querySelector('#roulette-carousel-track');
        if (!rouletteTrack) return;

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

        // ── MODO PERSONALIZADO ────────────────────────────────────────────────
        if (customMode) {
            if (customPool.length < 2) {
                spinButton.disabled = true;
                return;
            }
            const _sel = shared.DOM.rouletteModal.querySelector('.roulette-selector');
            if (_sel) _sel.style.visibility = 'visible';

            const shuffled = [...customPool].sort(() => Math.random() - 0.5);
            const repeated = [];
            while (repeated.length < 35) {
                for (const item of shuffled) {
                    repeated.push(item);
                    if (repeated.length >= 35) break;
                }
            }
            const finalPickIndex = Math.floor(repeated.length * 0.6);
            selectedMovie = repeated[finalPickIndex];

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
            return;
        }

        // ── MODO NORMAL ───────────────────────────────────────────────────────
        if (!shared.appState.content.movies || Object.keys(shared.appState.content.movies).length < 10) {
            rouletteTrack.innerHTML = `<p>No hay suficientes películas.</p>`;
            spinButton.disabled = true;
            return;
        }

        const fullPool = { ...shared.appState.content.movies };
        if (shared.appState.content.sagas) {
            for (const sagaData of Object.values(shared.appState.content.sagas)) {
                if (!sagaData) continue;
                for (const [id, item] of Object.entries(sagaData)) {
                    if ((item.type || 'movie') === 'movie') fullPool[id] = item;
                }
            }
        }

        const availableIds = Object.keys(fullPool).filter(id => {
            if (watchedMovieIds.has(id)) return false;
            const estado = fullPool[id]?.estado;
            if (estado && estado.toLowerCase() === 'vetada') return false;
            return true;
        });

        if (availableIds.length < 5) {
            rouletteTrack.innerHTML = `<p style="color:var(--text-muted);padding:20px;text-align:center;">Ya viste todas las películas disponibles 🎉</p>`;
            spinButton.disabled = true;
            return;
        }

        const shuffled      = [...availableIds].sort(() => Math.random() - 0.5);
        const batchIds      = shuffled.slice(0, Math.min(35, availableIds.length));
        const finalPickIndex = Math.floor(batchIds.length * 0.6);
        selectedMovie = { id: batchIds[finalPickIndex], data: fullPool[batchIds[finalPickIndex]] };

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
        if (spinDone || !selectedMovie) {
            spinDone = false;
            setActionButtons(false);
            await loadRouletteMovies();
            await new Promise(r => setTimeout(r, 80));
        }
        if (!selectedMovie) return;

        spinButton.disabled = true;
        setActionButtons(false);

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
    });

    // ── VER ──────────────────────────────────────────────────────────────────
    if (btnVer) {
        btnVer.addEventListener('click', async () => {
            if (!selectedMovie || !spinDone) return;
            closeRouletteModal();

            const movieId    = selectedMovie.id;
            const movieTitle = selectedMovie.data.title;

            if (shared.appState.player.movieHistoryTimer) {
                clearTimeout(shared.appState.player.movieHistoryTimer);
            }
            const THIRTY_MINUTES = 30 * 60 * 1000;
            shared.appState.player.movieHistoryTimer = setTimeout(async () => {
                shared.addToHistoryIfLoggedIn(movieId, 'movie');
                await markAsWatched(movieId);
                shared.appState.player.movieHistoryTimer = null;
            }, THIRTY_MINUTES);

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

        customMode = false;
        customPool = [];
        const btnModeNormal = shared.DOM.rouletteModal.querySelector('#roulette-mode-normal');
        const btnModeCustom = shared.DOM.rouletteModal.querySelector('#roulette-mode-custom');
        const customPanel   = shared.DOM.rouletteModal.querySelector('#custom-roulette-panel');
        const btnVista      = shared.DOM.rouletteModal.querySelector('#roulette-btn-vista');
        const rouletteTitle = shared.DOM.rouletteModal.querySelector('#roulette-title');
        if (btnModeNormal) btnModeNormal.classList.add('active');
        if (btnModeCustom) btnModeCustom.classList.remove('active');
        if (customPanel)   customPanel.style.display  = 'none';
        if (btnVista)      btnVista.style.display      = '';
        if (rouletteTitle) rouletteTitle.textContent   = 'Película Aleatoria';

        const chipsEl  = shared.DOM.rouletteModal.querySelector('#crp-chips');
        const hintEl   = shared.DOM.rouletteModal.querySelector('#crp-hint');
        const searchEl = shared.DOM.rouletteModal.querySelector('#crp-search-input');
        if (chipsEl)  chipsEl.innerHTML  = '';
        if (hintEl)   hintEl.textContent = 'Agrega al menos 2 películas para girar';
        if (searchEl) searchEl.value     = '';

        await loadWatchedFromFirebase();
        if (window.loadRouletteMovies) window.loadRouletteMovies();
    }
}

export async function unmarkMovieFromRoulette(movieId) {
    await unmarkAsWatched(movieId);
}

export function isMovieWatched(movieId) {
    return watchedMovieIds.has(movieId);
}

export async function markMovieAsWatched(movieId) {
    await markAsWatched(movieId);
}
