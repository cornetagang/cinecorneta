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
        rouletteTrack.style.transform = 'translateX(0px)';
        rouletteTrack.innerHTML = '';

        if (!shared.appState.content.movies || Object.keys(shared.appState.content.movies).length < 10) {
            rouletteTrack.innerHTML = `<p>No hay suficientes películas.</p>`;
            spinButton.disabled = true;
            return;
        }

        const allMovieIds = Object.keys(shared.appState.content.movies);
        
        // Mantenemos 35 items (es el equilibrio ideal)
        const totalItems = 35; 
        const moviesForRoulette = Array.from({ length: totalItems }, () => {
            const randomIndex = Math.floor(Math.random() * allMovieIds.length);
            return { id: allMovieIds[randomIndex], data: shared.appState.content.movies[allMovieIds[randomIndex]] };
        });

        const finalPickIndex = totalItems - 5; 
        selectedMovie = moviesForRoulette[finalPickIndex];

        moviesForRoulette.forEach((movie, index) => {
            // lazy = false es vital para que no salgan cuadros blancos
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
            const cardWidth = card.offsetWidth + 20; 
            rouletteTrack.style.transform = `translateX(${wrapperWidth / 2 - cardWidth / 2}px)`;
        }, 50);
    };

    spinButton.addEventListener('click', () => {
        if (!selectedMovie) return;
        spinButton.disabled = true;
        
        const rouletteTrack = shared.DOM.rouletteModal.querySelector('#roulette-carousel-track');
        rouletteTrack.classList.add('is-spinning');

        const winnerCard = rouletteTrack.querySelector('[data-winner="true"]');
        if (!winnerCard) return;

        const wrapperWidth = rouletteTrack.parentElement.offsetWidth;
        const cardWidth = winnerCard.offsetWidth;
        const targetPosition = (wrapperWidth / 2) - winnerCard.offsetLeft - (cardWidth / 2);
        
        const randomJitter = Math.floor(Math.random() * 20) - 10;
        const finalPosition = targetPosition + randomJitter;
        
        // 🔥 CAMBIO APLICADO: 4.5s
        // Curva suave para que frene con elegancia
        rouletteTrack.style.transition = 'transform 4.5s cubic-bezier(0.1, 0.7, 0.1, 1)';
        rouletteTrack.style.transform = `translateX(${finalPosition}px)`;

        rouletteTrack.addEventListener('transitionend', () => {
            rouletteTrack.classList.remove('is-spinning');
            
            // Esperamos 0.8s para admirar al ganador antes de abrir la ficha
            setTimeout(() => {
                closeRouletteModal(); 
                shared.openDetailsModal(selectedMovie.id, 'movie');
                
                // Recargar ruleta en silencio
                setTimeout(() => loadRouletteMovies(), 500);
            }, 800); 
        }, { once: true });
    });
    
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
