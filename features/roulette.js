// ===========================================================
// MÓDULO DE LA RULETA
// ===========================================================

let shared;
let isInitialized = false;

// Set de IDs vistos en memoria (sincronizado con Firebase)
let watchedMovieIds = new Set();

// Estado del modo personalizado
let customMode = false;
let customPool = []; // Array de { id, data }

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
    // Guardar en roulette_watched Y en historial
    const movieData = shared.appState.content.movies?.[movieId];
    await Promise.all([
        shared.db.ref(`users/${user.uid}/roulette_watched/${movieId}`).set(true),
        shared.db.ref(`users/${user.uid}/history/${movieId}`).set({
            type: 'movie',
            contentId: movieId,
            title: movieData?.title || movieId,
            poster: movieData?.poster || '',
            viewedAt: firebase.database.ServerValue.TIMESTAMP,
            season: null,
            lastEpisode: null
        })
    ]);
}

async function unmarkAsWatched(movieId) {
    const user = shared.auth?.currentUser;
    if (!user || !shared.db) return;
    watchedMovieIds.delete(movieId);
    // Borrar de roulette_watched Y del historial
    await Promise.all([
        shared.db.ref(`users/${user.uid}/roulette_watched/${movieId}`).remove(),
        shared.db.ref(`users/${user.uid}/history/${movieId}`).remove()
    ]);
}

function closeRouletteModal() {
    if (shared.DOM.rouletteModal) shared.DOM.rouletteModal.classList.remove('show');
    if (!document.querySelector('.modal.show')) document.body.classList.remove('modal-open');
}

function setupRouletteLogic() {
    const spinButton = shared.DOM.rouletteModal?.querySelector('#spin-roulette-btn');
    const btnVer     = shared.DOM.rouletteModal?.querySelector('#roulette-btn-ver');
    const btnVista   = shared.DOM.rouletteModal?.querySelector('#roulette-btn-vista');
    if (!shared.DOM.rouletteModal || !spinButton) return;

    let selectedMovie = null;
    let spinDone = false;

    const setActionButtons = (enabled) => {
        if (btnVer)   btnVer.disabled   = !enabled;
        if (btnVista) btnVista.disabled = !enabled || customMode;
    };

    // -------------------------------------------------------
    // MODO TOGGLE
    // -------------------------------------------------------
    const btnModeNormal = shared.DOM.rouletteModal.querySelector('#roulette-mode-normal');
    const btnModeCustom = shared.DOM.rouletteModal.querySelector('#roulette-mode-custom');
    const customPanel   = shared.DOM.rouletteModal.querySelector('#custom-roulette-panel');
    const rouletteTitle = shared.DOM.rouletteModal.querySelector('#roulette-title');

    const switchMode = (toCustom) => {
        customMode = toCustom;
        btnModeNormal?.classList.toggle('active', !toCustom);
        btnModeCustom?.classList.toggle('active', toCustom);
        if (customPanel) customPanel.style.display = toCustom ? 'block' : 'none';
        if (btnVista)    btnVista.style.display     = toCustom ? 'none'  : '';
        if (rouletteTitle) rouletteTitle.textContent = toCustom ? 'Ruleta Personalizada' : 'Película Aleatoria';

        // Limpiar carrusel y estado al cambiar modo
        spinDone = false;
        selectedMovie = null;
        setActionButtons(false);
        const track = shared.DOM.rouletteModal.querySelector('#roulette-carousel-track');
        if (track) {
            track.style.transition = 'none';
            track.style.transform  = 'translateX(0px)';
            track.innerHTML = '';
        }
        spinButton.disabled = false;

        if (toCustom) {
            updateCustomHint();
        } else {
            loadRouletteMovies();
        }
    };

    btnModeNormal?.addEventListener('click', () => { if (customMode) switchMode(false); });
    btnModeCustom?.addEventListener('click', () => { if (!customMode) switchMode(true); });

    // -------------------------------------------------------
    // LÓGICA DEL BUSCADOR (modo personalizado)
    // -------------------------------------------------------
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
                // Actualizar carrusel en tiempo real
                spinDone = false;
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
        if (searchInput) searchInput.value = '';
        if (suggestionsEl) suggestionsEl.style.display = 'none';
        // Actualizar carrusel en tiempo real
        spinDone = false;
        selectedMovie = null;
        setActionButtons(false);
        loadRouletteMovies();
    };

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const q = searchInput.value.trim().toLowerCase();
            if (!q || q.length < 2) {
                if (suggestionsEl) suggestionsEl.style.display = 'none';
                return;
            }
            const pool = getFullPool();
            const results = Object.entries(pool)
                .filter(([, d]) => (d.title || '').toLowerCase().includes(q))
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
                    const id = item.dataset.id;
                    const pool = getFullPool();
                    addToCustomPool(id, pool[id]);
                });
            });
        });

        // Cerrar sugerencias al hacer click fuera
        document.addEventListener('click', (e) => {
            if (suggestionsEl && !searchInput.contains(e.target) && !suggestionsEl.contains(e.target)) {
                suggestionsEl.style.display = 'none';
            }
        });
    }

    // -------------------------------------------------------
    // CARGAR CARRUSEL (normal o personalizado)
    // -------------------------------------------------------
    const loadRouletteMovies = async () => {
        const rouletteTrack = shared.DOM.rouletteModal.querySelector('#roulette-carousel-track');
        if (!rouletteTrack) return;

        spinDone = false;
        setActionButtons(false);
        selectedMovie = null;

        if (btnVista) btnVista.innerHTML = `<i class="fas fa-eye-slash"></i> Vista`;

        rouletteTrack.classList.remove('is-spinning');
        spinButton.disabled = false;
        rouletteTrack.style.transition = 'none';
        rouletteTrack.style.transform = 'translateX(0px)';
        rouletteTrack.innerHTML = '';

        // ---- MODO PERSONALIZADO ----
        if (customMode) {
            if (customPool.length < 2) {
                spinButton.disabled = true;
                return;
            }
            const shuffled = [...customPool].sort(() => Math.random() - 0.5);
            // Repetir el pool hasta tener ~35 elementos para la animación
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
                const cardWidth = card.offsetWidth + 20;
                const startOffset = wrapperWidth / 2 - cardWidth * 2.5;
                rouletteTrack.style.transform = `translateX(${startOffset}px)`;
            }, 50);
            return;
        }

        // ---- MODO NORMAL ----
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

        const shuffled = [...availableIds].sort(() => Math.random() - 0.5);
        const batchIds = shuffled.slice(0, Math.min(35, availableIds.length));
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
            const cardWidth = card.offsetWidth + 20;
            const startOffset = wrapperWidth / 2 - cardWidth * 2.5;
            rouletteTrack.style.transform = `translateX(${startOffset}px)`;
        }, 50);
    };

    // GIRAR
    spinButton.addEventListener('click', async () => {
        // Si ya giró antes O si no hay película seleccionada aún, recargar carrusel
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

        const wrapperWidth = rouletteTrack.parentElement.offsetWidth;
        const cardWidth = winnerCard.offsetWidth;
        const targetPosition = (wrapperWidth / 2) - winnerCard.offsetLeft - (cardWidth / 2);
        const randomJitter = Math.floor(Math.random() * 20) - 10;

        rouletteTrack.style.transition = 'transform 4.5s cubic-bezier(0.1, 0.7, 0.1, 1)';
        rouletteTrack.style.transform = `translateX(${targetPosition + randomJitter}px)`;

        rouletteTrack.addEventListener('transitionend', () => {
            rouletteTrack.classList.remove('is-spinning');
            spinDone = true;
            spinButton.disabled = false;

            if (btnVista) {
                const yaVista = watchedMovieIds.has(selectedMovie.id);
                btnVista.innerHTML = yaVista
                    ? `<i class="fas fa-eye"></i> Quitar`
                    : `<i class="fas fa-eye-slash"></i> Vista`;
            }

            setActionButtons(true);
        }, { once: true });
    });

    // VER — abre reproductor directamente y arranca timer de 30 min
    if (btnVer) {
        btnVer.addEventListener('click', async () => {
            if (!selectedMovie || !spinDone) return;
            closeRouletteModal();

            const movieId = selectedMovie.id;
            const movieTitle = selectedMovie.data.title;

            // Arrancar timer de 30 min (igual que "Ver ahora" en detalles)
            if (shared.appState.player.movieHistoryTimer) {
                clearTimeout(shared.appState.player.movieHistoryTimer);
            }
            const THIRTY_MINUTES = 30 * 60 * 1000;
            shared.appState.player.movieHistoryTimer = setTimeout(async () => {
                shared.addToHistoryIfLoggedIn(movieId, 'movie');
                await markAsWatched(movieId);
                shared.appState.player.movieHistoryTimer = null;
            }, THIRTY_MINUTES);

            // Abrir reproductor directamente
            const player = await shared.getPlayerModule();
            player.openPlayerModal(movieId, movieTitle);
        });
    }

    // VISTA — toggle marcar/desmarcar
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

        // Resetear a modo normal cada vez que se abre
        customMode = false;
        customPool = []; // Limpiar películas de la sesión anterior
        const btnModeNormal = shared.DOM.rouletteModal.querySelector('#roulette-mode-normal');
        const btnModeCustom = shared.DOM.rouletteModal.querySelector('#roulette-mode-custom');
        const customPanel   = shared.DOM.rouletteModal.querySelector('#custom-roulette-panel');
        const btnVista      = shared.DOM.rouletteModal.querySelector('#roulette-btn-vista');
        const rouletteTitle = shared.DOM.rouletteModal.querySelector('#roulette-title');
        if (btnModeNormal) btnModeNormal.classList.add('active');
        if (btnModeCustom) btnModeCustom.classList.remove('active');
        if (customPanel)   customPanel.style.display = 'none';
        if (btnVista)      btnVista.style.display = '';
        if (rouletteTitle) rouletteTitle.textContent = 'Película Aleatoria';
        // Limpiar chips y hint del modo personalizado
        const chipsEl = shared.DOM.rouletteModal.querySelector('#crp-chips');
        const hintEl  = shared.DOM.rouletteModal.querySelector('#crp-hint');
        const searchEl = shared.DOM.rouletteModal.querySelector('#crp-search-input');
        if (chipsEl) chipsEl.innerHTML = '';
        if (hintEl)  hintEl.textContent = 'Agrega al menos 2 películas para girar';
        if (searchEl) searchEl.value = '';

        await loadWatchedFromFirebase();
        if (window.loadRouletteMovies) window.loadRouletteMovies();
    }
}

export async function unmarkMovieFromRoulette(movieId) {
    await unmarkAsWatched(movieId);
}

// Funciones públicas para uso desde script.js (botón ojo en detalles)
export function isMovieWatched(movieId) {
    return watchedMovieIds.has(movieId);
}

export async function markMovieAsWatched(movieId) {
    await markAsWatched(movieId);
}
