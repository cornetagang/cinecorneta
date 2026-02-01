// ===========================================================
// MÓDULO DE LA RULETA (OPTIMIZADO)
// ===========================================================

let shared;
let isInitialized = false;

// Inicialización con inyección de dependencias
export function initRoulette(dependencies) {
    if (isInitialized) return;
    shared = dependencies;
    setupRouletteLogic();
    isInitialized = true;
}

// Cierra el modal de la ruleta
function closeRouletteModal() {
    if (shared.DOM.rouletteModal) {
        shared.DOM.rouletteModal.classList.remove('show');
    }
    if (!document.querySelector('.modal.show')) {
        document.body.classList.remove('modal-open');
    }
}

function setupRouletteLogic() {
    const spinButton = shared.DOM.rouletteModal?.querySelector('#spin-roulette-btn');
    if (!shared.DOM.rouletteModal || !spinButton) return;
    
    let selectedMovie = null;

    const loadRouletteMovies = () => {
        const rouletteTrack = shared.DOM.rouletteModal.querySelector('#roulette-carousel-track');
        if (!rouletteTrack) return;
        
        // Reset inicial
        rouletteTrack.classList.remove('is-spinning');
        spinButton.disabled = false;
        rouletteTrack.style.transition = 'none';
        rouletteTrack.style.transform = 'translateX(0px)';
        rouletteTrack.innerHTML = '';

        // Validar contenido suficiente
        if (!shared.appState.content.movies || Object.keys(shared.appState.content.movies).length < 10) {
            rouletteTrack.innerHTML = `<p>No hay suficientes películas.</p>`;
            spinButton.disabled = true;
            return;
        }

        const allMovieIds = Object.keys(shared.appState.content.movies);
        const totalItems = 35; // Balance ideal para la animación
        
        // Generar array de películas aleatorias
        const moviesForRoulette = Array.from({ length: totalItems }, () => {
            const randomIndex = Math.floor(Math.random() * allMovieIds.length);
            return { 
                id: allMovieIds[randomIndex], 
                data: shared.appState.content.movies[allMovieIds[randomIndex]] 
            };
        });

        // Definir ganador (5 posiciones desde el final)
        const finalPickIndex = totalItems - 5; 
        selectedMovie = moviesForRoulette[finalPickIndex];

        // Renderizar tarjetas
        moviesForRoulette.forEach((movie, index) => {
            // lazy = false para evitar cuadros blancos durante la animación
            const card = shared.createMovieCardElement(movie.id, movie.data, 'movie', 'roulette', false);
            
            if (index === finalPickIndex) {
                card.dataset.winner = 'true';
            }
            rouletteTrack.appendChild(card);
        });
        
        // Centrar el track después del render
        setTimeout(() => {
            const wrapperWidth = rouletteTrack.parentElement.offsetWidth;
            const card = rouletteTrack.querySelector('.movie-card');
            if (!card) return;
            
            const cardWidth = card.offsetWidth + 20; 
            rouletteTrack.style.transform = `translateX(${wrapperWidth / 2 - cardWidth / 2}px)`;
        }, 50);
    };

    // Evento del botón de girar
    spinButton.addEventListener('click', () => {
        if (!selectedMovie) return;
        spinButton.disabled = true;
        
        const rouletteTrack = shared.DOM.rouletteModal.querySelector('#roulette-carousel-track');
        rouletteTrack.classList.add('is-spinning');

        const winnerCard = rouletteTrack.querySelector('[data-winner="true"]');
        if (!winnerCard) return;

        // Calcular posición final del ganador
        const wrapperWidth = rouletteTrack.parentElement.offsetWidth;
        const cardWidth = winnerCard.offsetWidth;
        const targetPosition = (wrapperWidth / 2) - winnerCard.offsetLeft - (cardWidth / 2);
        
        // Agregar jitter aleatorio para efecto natural
        const randomJitter = Math.floor(Math.random() * 20) - 10;
        const finalPosition = targetPosition + randomJitter;
        
        // Animación suave de 4.5s con curva de desaceleración
        rouletteTrack.style.transition = 'transform 4.5s cubic-bezier(0.1, 0.7, 0.1, 1)';
        rouletteTrack.style.transform = `translateX(${finalPosition}px)`;

        // Al terminar la animación
        rouletteTrack.addEventListener('transitionend', () => {
            rouletteTrack.classList.remove('is-spinning');
            
            // Pausa breve antes de abrir el modal de detalles
            setTimeout(() => {
                closeRouletteModal(); 
                shared.openDetailsModal(selectedMovie.id, 'movie');
                
                // Recargar ruleta en segundo plano
                setTimeout(() => loadRouletteMovies(), 500);
            }, 800); 
        }, { once: true });
    });
    
    // Exponer función global para uso externo
    window.loadRouletteMovies = loadRouletteMovies;
}

// Función pública para abrir el modal de la ruleta
export function openRouletteModal() {
    if (!shared.appState.content.movies) return;
    
    if (shared.DOM.rouletteModal) {
        document.body.classList.add('modal-open');
        shared.DOM.rouletteModal.classList.add('show');
        
        if (window.loadRouletteMovies) {
            window.loadRouletteMovies();
        }
    }
}
