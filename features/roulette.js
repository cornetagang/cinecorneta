// ===========================================================
// MÓDULO DE LA RULETA
// ===========================================================

let shared;
let isInitialized = false;

// Set de IDs vistos en memoria (sincronizado con Firebase)
let watchedMovieIds = new Set();

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
        if (btnVista) btnVista.disabled = !enabled;
    };

    const loadRouletteMovies = async () => {
        const rouletteTrack = shared.DOM.rouletteModal.querySelector('#roulette-carousel-track');
        if (!rouletteTrack) return;

        spinDone = false;
        setActionButtons(false);
        selectedMovie = null;

        // Resetear texto del botón "Vista" al estado neutro
        if (btnVista) btnVista.innerHTML = `<i class="fas fa-eye-slash"></i> Vista`;

        rouletteTrack.classList.remove('is-spinning');
        spinButton.disabled = false;
        rouletteTrack.style.transition = 'none';
        rouletteTrack.style.transform = 'translateX(0px)';
        rouletteTrack.innerHTML = '';

        if (!shared.appState.content.movies || Object.keys(shared.appState.content.movies).length < 10) {
            rouletteTrack.innerHTML = `<p>No hay suficientes películas.</p>`;
            spinButton.disabled = true;
            return;
        }

        // Pool completo: movies + sagas con type movie
        const fullPool = { ...shared.appState.content.movies };
        if (shared.appState.content.sagas) {
            for (const sagaData of Object.values(shared.appState.content.sagas)) {
                if (!sagaData) continue;
                for (const [id, item] of Object.entries(sagaData)) {
                    if ((item.type || 'movie') === 'movie') fullPool[id] = item;
                }
            }
        }

        // Excluir vistas
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

        // Mezclar y tomar hasta 35 sin repetir
        const shuffled = [...availableIds].sort(() => Math.random() - 0.5);
        const batchIds = shuffled.slice(0, Math.min(35, availableIds.length));

        // Ganador al 60% del array para que haya pelis a la izquierda
        const finalPickIndex = Math.floor(batchIds.length * 0.6);
        selectedMovie = { id: batchIds[finalPickIndex], data: fullPool[batchIds[finalPickIndex]] };

        batchIds.forEach((id, index) => {
            const card = shared.createMovieCardElement(id, fullPool[id], 'movie', 'roulette', false);
            if (index === finalPickIndex) card.dataset.winner = 'true';
            rouletteTrack.appendChild(card);
        });

        // Posición inicial mostrando varias pelis a la izquierda
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
        // Si ya giró antes, recargar lote nuevo antes de animar
        if (spinDone) {
            spinDone = false;
            setActionButtons(false);
            await loadRouletteMovies();
            // Pequeña pausa para que el DOM se actualice
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
