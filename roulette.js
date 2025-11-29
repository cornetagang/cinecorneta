// ===========================================================
// MÓDULO DE LA RULETA (Cargado bajo demanda)
// ===========================================================

let shared; // Para almacenar las dependencias (appState, DOM, etc.)
let isInitialized = false;

// Esta función es llamada por el módulo principal para inyectar las dependencias
export function initRoulette(dependencies) {
    if (isInitialized) return;
    shared = dependencies;
    setupRouletteLogic(); // Configura la lógica de la ruleta la primera vez que se carga
    isInitialized = true;
}

// Cierra el modal de la ruleta
function closeRouletteModal() {
    if (shared.DOM.rouletteModal) shared.DOM.rouletteModal.classList.remove('show');
    if (!document.querySelector('.modal.show')) {
        document.body.classList.remove('modal-open');
    }
}

// Configura toda la lógica interna de la ruleta
function setupRouletteLogic() {
    const spinButton = shared.DOM.rouletteModal.querySelector('#spin-roulette-btn');
    if (!shared.DOM.rouletteModal || !spinButton) return;
    
    let selectedMovie = null;

    const loadRouletteMovies = () => {
        const rouletteTrack = shared.DOM.rouletteModal.querySelector('#roulette-carousel-track');
        if (!rouletteTrack) return;
        rouletteTrack.classList.remove('is-spinning');
        spinButton.disabled = false;
        rouletteTrack.style.transition = 'none';
        rouletteTrack.innerHTML = '';

        if (!shared.appState.content.movies || Object.keys(shared.appState.content.movies).length < 15) {
            rouletteTrack.innerHTML = `<p>No hay suficientes películas.</p>`;
            spinButton.disabled = true;
            return;
        }

        const allMovieIds = Object.keys(shared.appState.content.movies);
        const moviesForRoulette = Array.from({ length: 50 }, () => {
            const randomIndex = Math.floor(Math.random() * allMovieIds.length);
            return { id: allMovieIds[randomIndex], data: shared.appState.content.movies[allMovieIds[randomIndex]] };
        });
        const finalPickIndex = Math.floor(Math.random() * (moviesForRoulette.length - 10)) + 5;
        selectedMovie = moviesForRoulette[finalPickIndex];

        moviesForRoulette.forEach((movie, index) => {
            const card = shared.createMovieCardElement(movie.id, movie.data, 'movie', 'roulette', false);
            if (index === finalPickIndex) {
                card.dataset.winner = 'true';
            }
            rouletteTrack.appendChild(card);
        });
        
        setTimeout(() => {
            const wrapperWidth = rouletteTrack.parentElement.offsetWidth;
            const card = rouletteTrack.querySelector('.movie-card');
            if (!card) return;
            const cardTotalWidth = card.offsetWidth + (parseFloat(getComputedStyle(card).marginLeft) * 2);
            const initialOffset = (wrapperWidth / 2) - (cardTotalWidth / 2);
            rouletteTrack.style.transform = `translateX(${initialOffset}px)`;
        }, 100);
    };

    spinButton.addEventListener('click', () => {
        if (!selectedMovie) return;
        spinButton.disabled = true;
        const rouletteTrack = shared.DOM.rouletteModal.querySelector('#roulette-carousel-track');
        rouletteTrack.classList.add('is-spinning');

        const winnerCard = rouletteTrack.querySelector('[data-winner="true"]');
        if (!winnerCard) return;

        const wrapperWidth = rouletteTrack.parentElement.offsetWidth;
        const targetPosition = (wrapperWidth / 2) - winnerCard.offsetLeft - (winnerCard.offsetWidth / 2);
        const randomJitter = Math.floor(Math.random() * (winnerCard.offsetWidth / 4)) - (winnerCard.offsetWidth / 8);
        const finalPosition = targetPosition + randomJitter;
        
        rouletteTrack.style.transition = 'transform 6s cubic-bezier(0.1, 0, 0.2, 1)';
        rouletteTrack.style.transform = `translateX(${finalPosition}px)`;

        rouletteTrack.addEventListener('transitionend', () => {
            rouletteTrack.classList.remove('is-spinning');
            setTimeout(() => {
                closeRouletteModal();
                shared.openDetailsModal(selectedMovie.id, 'movie');
            }, 500);
        }, { once: true });
    });
    
    // Asigna la función al objeto window para que el HTML pueda llamarlo
    window.loadRouletteMovies = loadRouletteMovies;
}

// Esta es la función que exportamos para ser llamada desde el script principal
export function openRouletteModal() {
    if (!shared.appState.content.movies) return;
    if (shared.DOM.rouletteModal) {
        document.body.classList.add('modal-open');
        shared.DOM.rouletteModal.classList.add('show');
        if (window.loadRouletteMovies) window.loadRouletteMovies();
    }
}
