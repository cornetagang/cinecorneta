// ===========================================================
// VARIABLES GLOBALES DE DATOS (Se llenarán desde la API)
// ===========================================================
let movieDatabase = {};
let seriesDatabase = {};
let seriesEpisodesData = {};
let allMoviesFull = null;

// ===========================================================
// ENLACE A TU API DE GOOGLE SHEETS
// ===========================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbxKyrwRxsIKW5xUgQFBg4zfOwnmwW12zR_4PDR1FljRm7oDE0ej7KrH1jMbhLdP3xgr/exec';

// ===========================================================
// VARIABLES GLOBALES DE ESTADO
// ===========================================================
let heroInterval;
let currentHeroIndex = 0;
let featuredIds = [];

let playerState = {
    dexter: { season: 1, episodeIndex: 0 },
    peacemaker: { season: 'Temporada 1', episodeIndex: 0, lang: 'es' },
    chernobyl: { season: 'Miniserie', episodeIndex: 0 },
};

// ===========================================================
// INICIO DE LA APLICACIÓN (CORREGIDO)
// ===========================================================
document.addEventListener('DOMContentLoaded', () => {
    showSkeletons();
    
    const startTime = Date.now(); 

    Promise.all([
        fetch(`${API_URL}?data=home`).then(res => res.json()),
        fetch(`${API_URL}?data=series`).then(res => res.json()),
        fetch(`${API_URL}?data=episodes`).then(res => res.json())
    ])
    .then(([movies, series, episodes]) => {
        const elapsedTime = Date.now() - startTime;
        const minLoadingTime = 2000;
        setTimeout(() => {
            movieDatabase = movies;
            seriesDatabase = series;
            seriesEpisodesData = episodes;
            
            hideSkeletons();
            setupHero();
            generateCarousels();
            setupRouletteLogic();
            switchView('all');
        }, elapsedTime < minLoadingTime ? minLoadingTime - elapsedTime : 0);
    })
    .catch(error => {
        const elapsedTime = Date.now() - startTime;
        const minLoadingTime = 2000;
        setTimeout(() => {
            console.error("Error al cargar los datos:", error);
            document.body.innerHTML = `<div style="text-align: center; margin-top: 50px; color: var(--text-light);">
                <h1>¡Ups! No pudimos cargar los datos.</h1>
                <p>Por favor, revisa tu conexión a internet o inténtalo de nuevo más tarde.</p>
            </div>`;
        }, elapsedTime < minLoadingTime ? minLoadingTime - elapsedTime : 0);
    });

    setupNavigation();
    setupKeydownListener();
    setupSearch();
});


// ===========================================================
// LÓGICA DEL BUSCADOR
// ===========================================================
function setupSearch() {
    const searchInput = document.getElementById('search-input');
    
    searchInput.addEventListener('input', () => {
        const searchTerm = searchInput.value.toLowerCase().trim();

        if (searchTerm === '') {
            const activeNav = document.querySelector('.main-nav a.active');
            if(activeNav && activeNav.dataset.filter !== 'all') {
                switchView(activeNav.dataset.filter);
            } else {
                switchView('all');
            }
            return;
        }

        const searchMovies = allMoviesFull || movieDatabase;
        const movieResults = Object.entries(searchMovies).filter(([id, movie]) => 
            movie.title.toLowerCase().includes(searchTerm)
        );
        const seriesResults = Object.entries(seriesDatabase).filter(([id, series]) => 
            series.title.toLowerCase().includes(searchTerm)
        );

        const allResults = [...movieResults, ...seriesResults];
        displaySearchResults(allResults);
    });
}

function displaySearchResults(results) {
    const carouselContainer = document.getElementById('carousel-container');
    const fullGridContainer = document.getElementById('full-grid-container');
    const heroSection = document.getElementById('hero-section');
    const grid = fullGridContainer.querySelector('.grid');

    heroSection.style.display = 'none';
    carouselContainer.style.display = 'none';
    fullGridContainer.style.display = 'block';
    grid.innerHTML = '';

    if (results.length === 0) {
        grid.innerHTML = `<p style="color: var(--text-muted); font-size: 1.2rem; text-align: center; grid-column: 1 / -1;">No se encontraron resultados.</p>`;
    } else {
        results.forEach(([id, item]) => {
            const type = (allMoviesFull && allMoviesFull[id]) ? 'movie-grid' : 'series';
            grid.appendChild(createMovieCardElement(id, item, type));
        });
    }
}


// ===========================================================
// CONFIGURACIÓN INICIAL Y NAVEGACIÓN
// ===========================================================
function showSkeletons() {
    const heroSection = document.getElementById('hero-section');
    heroSection.innerHTML = `<div class="hero-skeleton"></div>`;
    heroSection.style.display = 'flex';

    const container = document.getElementById('carousel-container');
    container.innerHTML = `
        <div class="carousel" data-type="movie">
            <h3 class="carousel-title">Cargando...</h3>
            <div class="carousel-track-container">
                <div class="carousel-track">
                    <div class="carousel-card skeleton-card"></div>
                    <div class="carousel-card skeleton-card"></div>
                    <div class="carousel-card skeleton-card"></div>
                    <div class="carousel-card skeleton-card"></div>
                    <div class="carousel-card skeleton-card"></div>
                    <div class="carousel-card skeleton-card"></div>
                </div>
            </div>
        </div>
    `;
    container.style.display = 'block';
}

function hideSkeletons() {
    const heroSection = document.getElementById('hero-section');
    const carouselContainer = document.getElementById('carousel-container');
    heroSection.innerHTML = ''; 
    carouselContainer.innerHTML = '';
}


// CAMBIO AQUÍ: Simplificamos la lógica para evitar el bucle infinito
function setupHero() {
    const heroSection = document.getElementById('hero-section');
    if (!heroSection) return;
    
    // Creamos la estructura del héroe una sola vez
    const heroContent = document.createElement('div');
    heroContent.className = 'hero-content';
    heroContent.innerHTML = `<h1 id="hero-title"></h1><p id="hero-synopsis"></p><div class="hero-buttons"></div>`;
    heroSection.appendChild(heroContent);

    featuredIds = Object.keys(movieDatabase);
    if (featuredIds.length === 0) {
        heroSection.style.display = 'none';
        return;
    }
    shuffleArray(featuredIds);
    
    // Inicializamos el héroe y el intervalo
    changeHeroMovie(currentHeroIndex);
    clearInterval(heroInterval);
    heroInterval = setInterval(() => {
        currentHeroIndex = (currentHeroIndex + 1) % featuredIds.length;
        changeHeroMovie(currentHeroIndex);
    }, 7000);
}

// CAMBIO AQUÍ: La función solo cambia los datos, no la estructura
function changeHeroMovie(index) {
    const heroSection = document.getElementById('hero-section');
    const heroContent = heroSection.querySelector('.hero-content');
    if (!heroContent) return;

    const movieId = featuredIds[index];
    const movieData = movieDatabase[movieId];
    if (!movieData) {
        console.error("No se encontraron datos para la película con ID:", movieId);
        return;
    }
    
    heroContent.classList.add('hero-fading');
    setTimeout(() => {
        heroSection.style.backgroundImage = `url(${movieData.banner})`;
        document.getElementById('hero-title').textContent = movieData.title;
        document.getElementById('hero-synopsis').textContent = movieData.synopsis;
        heroContent.querySelector('.hero-buttons').innerHTML = `<button class="btn btn-play" onclick="openPlayerModal('${movieId}')"><i class="fas fa-play"></i> Ver Ahora</button> <button class="btn btn-info" onclick="openDetailsModal('${movieId}', 'movie')">Más Información</button>`;
        heroContent.classList.remove('hero-fading');
    }, 500);
}

function generateCarousels() {
    const container = document.getElementById('carousel-container');
    const recentMovieIds = Object.keys(movieDatabase);
    const moviesHTML = `<div class="carousel" data-type="movie"><h3 class="carousel-title">Agregadas Recientemente</h3><div class="carousel-track-container"><div class="carousel-track"></div></div></div>`;
    container.innerHTML += moviesHTML;
    const movieTrack = container.querySelector('.carousel[data-type="movie"] .carousel-track');
    recentMovieIds.forEach(id => {
        movieTrack.appendChild(createMovieCardElement(id, movieDatabase[id], 'movie'));
    });
    
    const seriesHTML = `<div class="carousel" data-type="series" style="display: none;"><h3 class="carousel-title">Series</h3><div class="carousel-track-container"><div class="carousel-track"></div></div></div>`;
    container.innerHTML += seriesHTML;
    const seriesTrack = container.querySelector('.carousel[data-type="series"] .carousel-track');
    for (const id in seriesDatabase) {
        seriesTrack.appendChild(createMovieCardElement(id, seriesDatabase[id], 'series'));
    }
}

function setupNavigation() {
    const menuToggle = document.getElementById('menu-toggle');
    const mainHeader = document.querySelector('.main-header');
    const menuOverlay = document.getElementById('menu-overlay');
    const navMenuContainer = document.querySelector('.main-nav ul');
    
    function closeMenu() {
        mainHeader.classList.remove('menu-open');
        if (menuOverlay) menuOverlay.classList.remove('active');
    }

    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            mainHeader.classList.toggle('menu-open');
            if (menuOverlay) menuOverlay.classList.toggle('active');
        });
    }
    if (menuOverlay) {
        menuOverlay.addEventListener('click', closeMenu);
    }
    if (navMenuContainer) {
        navMenuContainer.addEventListener('click', (event) => {
            if (event.target.tagName === 'A') {
                event.preventDefault();
                const linkClickeado = event.target;
                const filter = linkClickeado.dataset.filter;
                
                closeMenu();
                document.getElementById('search-input').value = '';

                if (filter === 'roulette') {
                    openRouletteModal();
                } else {
                    const allLinks = navMenuContainer.querySelectorAll('a');
                    allLinks.forEach(link => link.classList.remove('active'));
                    linkClickeado.classList.add('active');
                    switchView(filter);
                }
            }
        });
    }
}

function setupKeydownListener() {
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const openModal = document.querySelector('.modal.show');
        if (!openModal) return;
        switch (openModal.id) {
            case 'cinema': closePlayerModal('video-frame'); break;
            case 'series-player-modal':
                const seriesIframe = openModal.querySelector('iframe');
                if (seriesIframe) closePlayerModal(seriesIframe.id);
                break;
            case 'details-modal': closeDetailsModal(); break;
            case 'roulette-modal': closeRouletteModal(); break;
        }
    });
}

function switchView(filter) {
    const carouselContainer = document.getElementById('carousel-container');
    const fullGridContainer = document.getElementById('full-grid-container');
    const heroSection = document.getElementById('hero-section');
    const moviesCarousel = carouselContainer.querySelector('.carousel[data-type="movie"]');
    const seriesCarousel = carouselContainer.querySelector('.carousel[data-type="series"]');

    heroSection.style.display = 'none';
    carouselContainer.style.display = 'none';
    fullGridContainer.style.display = 'none';
    
    if (filter === 'all') {
        heroSection.style.display = 'flex';
        carouselContainer.style.display = 'block';
        if (moviesCarousel) moviesCarousel.style.display = 'block';
        if (moviesCarousel) moviesCarousel.querySelector('.carousel-title').style.display = 'block';
        if (seriesCarousel) seriesCarousel.style.display = 'none';
    } else if (filter === 'movie') {
        // CAMBIO AQUÍ: Esto SIEMPRE se debe ejecutar
        fullGridContainer.style.display = 'block'; 

        if (!allMoviesFull) {
            const gridContainer = fullGridContainer.querySelector('.grid');
            gridContainer.innerHTML = '';
            for (let i = 0; i < 15; i++) {
                const skeleton = document.createElement('div');
                skeleton.className = 'movie-card skeleton-card';
                gridContainer.appendChild(skeleton);
            }
            
            fetch(`${API_URL}?data=allMovies`)
                .then(res => res.json())
                .then(data => {
                    allMoviesFull = data;
                    populateFullMovieGrid();
                })
                .catch(error => {
                    console.error('Error al cargar la lista completa de películas:', error);
                    gridContainer.innerHTML = `<p style="color: var(--text-muted); text-align: center; grid-column: 1 / -1;">No se pudieron cargar las películas.</p>`;
                });
        } else {
            // Esto solo se ejecuta si ya tenemos la lista completa
            populateFullMovieGrid();
        }
    } else if (filter === 'series') {
        carouselContainer.style.display = 'block';
        if (moviesCarousel) moviesCarousel.style.display = 'none';
        if (seriesCarousel) seriesCarousel.style.display = 'block';
        if (seriesCarousel) seriesCarousel.querySelector('.carousel-title').style.display = 'none';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}


function populateFullMovieGrid() {
    const gridContainer = document.querySelector('#full-grid-container .grid');
    gridContainer.innerHTML = '';
    for (const id in allMoviesFull) {
        gridContainer.appendChild(createMovieCardElement(id, allMoviesFull[id], 'movie-grid'));
    }
}

function changeHeroMovie(index) {
    const heroSection = document.getElementById('hero-section');
    const heroContent = heroSection.querySelector('.hero-content');
    if (!heroContent) return;

    const movieId = featuredIds[index];
    const movieData = movieDatabase[movieId];
    if (!movieData) {
        console.error("No se encontraron datos para la película con ID:", movieId);
        return;
    }
    
    heroContent.classList.add('hero-fading');
    setTimeout(() => {
        heroSection.style.backgroundImage = `url(${movieData.banner})`;
        document.getElementById('hero-title').textContent = movieData.title;
        document.getElementById('hero-synopsis').textContent = movieData.synopsis;
        heroContent.querySelector('.hero-buttons').innerHTML = `<button class="btn btn-play" onclick="openPlayerModal('${movieId}')"><i class="fas fa-play"></i> Ver Ahora</button> <button class="btn btn-info" onclick="openDetailsModal('${movieId}', 'movie')">Más Información</button>`;
        heroContent.classList.remove('hero-fading');
    }, 500);
}

// ===========================================================
// MODALES (Se adaptan a la nueva lógica)
// ===========================================================
function openDetailsModal(id, type) {
    const data = type.startsWith('movie') ? (allMoviesFull && allMoviesFull[id] ? allMoviesFull[id] : movieDatabase[id]) : seriesDatabase[id];
    if (!data) return;
    const modal = document.getElementById('details-modal');
    modal.querySelector('#details-panel-content').style.backgroundImage = `url(${data.banner})`;
    modal.querySelector('#details-poster-img').src = data.poster;
    modal.querySelector('#details-title').textContent = data.title;
    modal.querySelector('#details-year').textContent = data.year;
    modal.querySelector('#details-genres').textContent = data.genres.join(' • ');
    modal.querySelector('#details-synopsis').textContent = data.synopsis;
    const buttonsContainer = modal.querySelector('#details-buttons');
    if (type.startsWith('movie')) {
        buttonsContainer.innerHTML = `<button class="btn btn-play" onclick="openPlayerModal('${id}')"><i class="fas fa-play"></i> Ver Ahora</button>`;
    } else {
        const seriesFunction = `openSeriesPlayer('${id}')`;
        buttonsContainer.innerHTML = `<button class="btn btn-play" onclick="${seriesFunction}"><i class="fas fa-bars"></i> Ver Episodios</button>`;
    }
    modal.classList.add('show');
}
function closeDetailsModal() { document.getElementById('details-modal').classList.remove('show'); }
function openPlayerModal(movieId) {
    closeDetailsModal();
    const cinemaModal = document.getElementById('cinema');
    const iframe = document.getElementById('video-frame');
    iframe.src = `https://drive.google.com/file/d/${movieId}/preview`;
    cinemaModal.classList.add('show');
}
function closePlayerModal(iframeId) {
    const iframe = document.getElementById(iframeId);
    if (iframe) {
        iframe.src = '';
        const modal = iframe.closest('.modal');
        if (modal) modal.classList.remove('show');
    }
}
function setupRouletteLogic() {
    const rouletteModal = document.getElementById('roulette-modal');
    const rouletteTrack = document.getElementById('roulette-carousel-track');
    const spinButton = document.getElementById('spin-roulette-btn');
    const cardWidth = 170;
    let finalPickIndex = -1;
    let selectedMovie = null;
    window.openRouletteModal = function() {
        rouletteModal.classList.add('show');
        loadRouletteMovies();
    }
    window.closeRouletteModal = function() {
        rouletteModal.classList.remove('show');
    }
    function loadRouletteMovies() {
        spinButton.disabled = false;
        rouletteTrack.style.transition = 'none';
        rouletteTrack.innerHTML = '';
        const allMovieIds = Object.keys(allMoviesFull || movieDatabase);
        if (allMovieIds.length < 5) {
            rouletteTrack.innerHTML = `<p style="color:white; width:100%; text-align:center;">Se necesitan más películas.</p>`;
            spinButton.disabled = true;
            return;
        }
        const moviesForRoulette = [];
        for (let i = 0; i < 50; i++) {
            const randomIndex = Math.floor(Math.random() * allMovieIds.length);
            const movieId = allMovieIds[randomIndex];
            moviesForRoulette.push({ id: movieId, data: (allMoviesFull && allMoviesFull[movieId] ? allMoviesFull[movieId] : movieDatabase[movieId]) });
        }
        finalPickIndex = Math.floor(Math.random() * 5) + 40;
        selectedMovie = moviesForRoulette[finalPickIndex];
        moviesForRoulette.forEach(movie => {
            rouletteTrack.appendChild(createMovieCardElement(movie.id, movie.data, 'roulette'));
        });
        const wrapperWidth = rouletteTrack.parentElement.offsetWidth;
        const startCardIndex = 5;
        const initialOffset = (wrapperWidth / 2) - (cardWidth / 2) - (startCardIndex * cardWidth);
        setTimeout(() => {
            rouletteTrack.style.transform = `translateX(${initialOffset}px)`;
        }, 0);
    }
    spinButton.addEventListener('click', () => {
        spinButton.disabled = true;
        const wrapperWidth = rouletteTrack.parentElement.offsetWidth;
        const targetPosition = (wrapperWidth / 2) - (cardWidth / 2) - (finalPickIndex * cardWidth);
        const randomJitter = Math.floor(Math.random() * (cardWidth - 40)) - ((cardWidth - 40) / 2);
        const finalPosition = targetPosition + randomJitter;
        rouletteTrack.style.transition = 'transform 6s cubic-bezier(0.25, 0.1, 0.25, 1)';
        rouletteTrack.style.transform = `translateX(${finalPosition}px)`;
        rouletteTrack.addEventListener('transitionend', () => {
            setTimeout(() => {
                closeRouletteModal();
                openDetailsModal(selectedMovie.id, 'movie');
            }, 500);
        }, { once: true });
    });
}

// ===========================================================
// LÓGICA DEL REPRODUCTOR DE SERIES
// ===========================================================
function openSeriesPlayer(seriesId) {
    closeDetailsModal();
    try {
        const savedProgress = localStorage.getItem(`${seriesId}Progress`);
        if (savedProgress) {
            playerState[seriesId] = { ...playerState[seriesId], ...JSON.parse(savedProgress) };
        }
    } catch (e) { console.error(`Error al cargar progreso de ${seriesId}:`, e); }

    const seriesInfo = seriesDatabase[seriesId];
    if (!seriesInfo) {
        console.error("No se encontraron datos para la serie:", seriesId);
        return;
    }
    const modal = document.getElementById('series-player-modal');
    let langControlsHTML = (seriesId === 'peacemaker') ? `
        <div id="peacemaker-lang-controls" class="lang-controls">
            <button class="lang-btn" data-lang="es" onclick="changeLanguage('peacemaker', 'es')">Español</button>
            <button class="lang-btn" data-lang="en" onclick="changeLanguage('peacemaker', 'en')">Inglés</button>
        </div>` : '';

    modal.innerHTML = `
        <button class="close-btn" onclick="closePlayerModal('video-frame-${seriesId}')" aria-label="Cerrar reproductor de series">X</button>
        <div class="player-layout-container" data-title="${seriesInfo.title.toUpperCase()}">
            <div class="player-container">
                <h2 id="${seriesId}-cinema-title" class="player-title"></h2>
                ${langControlsHTML}
                <div class="screen"><iframe id="video-frame-${seriesId}" src="" allowfullscreen></iframe></div>
                <div class="pagination-controls">
                    <button class="episode-nav-btn" id="${seriesId}-prev-btn" onclick="navigateEpisode('${seriesId}', -1)"><i class="fas fa-chevron-left"></i> Anterior</button>
                    <span id="${seriesId}-page-indicator" class="page-indicator"></span>
                    <button class="episode-nav-btn" id="${seriesId}-next-btn" onclick="navigateEpisode('${seriesId}', 1)">Siguiente <i class="fas fa-chevron-right"></i></button>
                </div>
            </div>
            <div class="episode-sidebar">
                <h2>Temporadas y Episodios</h2>
                <select id="${seriesId}-season-selector" class="season-dropdown"></select>
                <div id="${seriesId}-episode-list" class="episode-list-container"></div>
            </div>
        </div>`;
    modal.classList.add('show');

    const dataSet = seriesEpisodesData[seriesId];
    if (!dataSet) {
        console.error(`No se encontraron datos de episodios para la serie: ${seriesId}`);
        return;
    }
    const initialSeason = playerState[seriesId]?.season || Object.keys(dataSet)[0];
    const initialEpisode = playerState[seriesId]?.episodeIndex || 0;

    populateSeasonDropdown(seriesId, initialSeason);
    populateEpisodeList(seriesId, initialSeason);
    openEpisode(seriesId, initialSeason, initialEpisode);

    document.getElementById(`${seriesId}-season-selector`).addEventListener('change', (event) => {
        const newSeason = event.target.value;
        playerState[seriesId].season = newSeason;
        playerState[seriesId].episodeIndex = 0;
        populateEpisodeList(seriesId, newSeason);
        openEpisode(seriesId, newSeason, 0);
    });
}

function changeLanguage(seriesId, lang) {
    if (playerState[seriesId]) {
        playerState[seriesId].lang = lang;
        const { season, episodeIndex } = playerState[seriesId];
        openEpisode(seriesId, season, episodeIndex);
    }
}

function populateSeasonDropdown(seriesId, selectedSeason) {
    const selector = document.getElementById(`${seriesId}-season-selector`);
    const data = seriesEpisodesData[seriesId];
    selector.innerHTML = Object.keys(data).map(seasonNum =>
        `<option value="${seasonNum}" ${seasonNum == selectedSeason ? 'selected' : ''}>${isNaN(seasonNum) ? seasonNum : `Temporada ${seasonNum}`}</option>`
    ).join('');
}

function populateEpisodeList(seriesId, seasonNum) {
    const container = document.getElementById(`${seriesId}-episode-list`);
    const data = seriesEpisodesData[seriesId];
    container.innerHTML = '';
    if (!data || !data[seasonNum]) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    data[seasonNum].forEach((episode, index) => {
        const releaseDate = episode.releaseDate ? new Date(episode.releaseDate) : null;
        const isAvailable = !releaseDate || releaseDate <= today;
        let thumbnailHTML = '';
        const clickEvent = isAvailable ? `onclick="openEpisode('${seriesId}', '${seasonNum}', ${index})"` : '';

        if (isAvailable && episode.thumbnail) {
            thumbnailHTML = `<img src="${episode.thumbnail}" alt="${episode.title}" class="episode-card-thumb" loading="lazy">`;
        } else if (releaseDate && !isAvailable) {
            thumbnailHTML = `
                <div class="thumbnail-placeholder">
                    <span class="release-day">${formatDate(releaseDate, 'day')}</span>
                    <span class="release-month">${formatDate(releaseDate, 'month')}</span>
                </div>`;
        }
        const cardHTML = `
            <div class="episode-card ${!isAvailable ? 'disabled' : ''}" 
                id="${seriesId}-episode-${String(seasonNum).replace(' ','')}-${index}" 
                data-season-key="${seasonNum}" 
                onmouseenter="startExpandTimer(this)" 
                onmouseleave="cancelExpandTimer(this)"
                ${clickEvent}>
                ${thumbnailHTML}
                <div class="episode-card-info">
                    <h3>${index + 1}. ${episode.title}</h3>
                    <p class="episode-description">${episode.description || ''}</p>
                </div>
            </div>`;
        container.innerHTML += cardHTML;
    });
}

function startExpandTimer(cardElement) {
    cardElement.dataset.timerId = setTimeout(() => expandDescription(cardElement, true), 1500);
}

function cancelExpandTimer(cardElement) {
    if (cardElement.dataset.timerId) clearTimeout(cardElement.dataset.timerId);
    expandDescription(cardElement, false);
}

function expandDescription(cardElement, shouldExpand) {
    const infoContainer = cardElement.querySelector('.episode-card-info');
    const descriptionP = infoContainer?.querySelector('.episode-description');
    if (!infoContainer || !descriptionP) return;

    if (infoContainer.dataset.collapseTimer) clearTimeout(infoContainer.dataset.collapseTimer);

    const seriesId = cardElement.id.split('-')[0];
    const seasonKey = cardElement.dataset.seasonKey;
    const episodeIndex = parseInt(cardElement.id.split('-').pop());
    const data = seriesEpisodesData[seriesId];
    const fullDescription = data[seasonKey][episodeIndex].description || '';

    if (shouldExpand) {
        descriptionP.textContent = fullDescription;
        infoContainer.classList.add('expanded');
    } else {
        infoContainer.classList.remove('expanded');
        infoContainer.dataset.collapseTimer = setTimeout(() => {
            const shortDescription = fullDescription.length > 100 ? fullDescription.substring(0, 100) + '...' : fullDescription;
            descriptionP.textContent = shortDescription;
        }, 300);
    }
}

function openEpisode(seriesId, season, episodeIndex) {
    document.querySelectorAll(`#${seriesId}-episode-list .episode-card.active`).forEach(c => c.classList.remove('active'));
    const activeCard = document.getElementById(`${seriesId}-episode-${String(season).replace(' ','')}-${episodeIndex}`);
    if (activeCard) {
        activeCard.classList.add('active');
        activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    playerState[seriesId].season = season;
    playerState[seriesId].episodeIndex = episodeIndex;
    saveProgress(seriesId);

    const data = seriesEpisodesData[seriesId];
    const episode = data[season]?.[episodeIndex];
    if (!episode) return;

    let videoId;
    if (seriesId === 'peacemaker') {
        const lang = playerState.peacemaker.lang || 'es';
        videoId = lang === 'es' ? episode.videoId_es : episode.videoId_en;
        document.querySelectorAll('#peacemaker-lang-controls .lang-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.lang === lang);
        });
    } else {
        videoId = episode.videoId;
    }

    const iframe = document.getElementById(`video-frame-${seriesId}`);
    if (videoId) {
        iframe.src = `https://drive.google.com/file/d/${videoId}/preview`;
    } else {
        iframe.src = '';
    }

    const seasonNumberMatch = String(season).match(/\d+/);
    const seasonNumber = seasonNumberMatch ? seasonNumberMatch[0] : '1';
    document.getElementById(`${seriesId}-cinema-title`).textContent = `T${seasonNumber}E${episodeIndex + 1} - ${episode.title}`;
    const totalEpisodes = data[season].length;
    document.getElementById(`${seriesId}-page-indicator`).textContent = `${episodeIndex + 1} / ${totalEpisodes}`;
    updateNavButtons(seriesId);
}

function navigateEpisode(seriesId, direction) {
    const { season, episodeIndex } = playerState[seriesId];
    const data = seriesEpisodesData[seriesId];
    const seasonEpisodes = data[season];
    let newIndex = episodeIndex + direction;
    if (newIndex >= 0 && newIndex < seasonEpisodes.length) {
        openEpisode(seriesId, season, newIndex);
    }
}

function updateNavButtons(seriesId) {
    const { season, episodeIndex } = playerState[seriesId];
    const data = seriesEpisodesData[seriesId];
    const totalEpisodes = data[season].length;
    document.getElementById(`${seriesId}-prev-btn`).disabled = (episodeIndex === 0);
    document.getElementById(`${seriesId}-next-btn`).disabled = (episodeIndex === totalEpisodes - 1);
}

function saveProgress(seriesId) {
    try {
        localStorage.setItem(`${seriesId}Progress`, JSON.stringify(playerState[seriesId]));
    } catch (e) { console.error(`Error al guardar el progreso de ${seriesId}:`, e); }
}

function formatDate(date, part) {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
     
    if (part === 'day') {
        return new Intl.DateTimeFormat('es-ES', { day: 'numeric' }).format(d);
    }
    if (part === 'month') {
        return new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(d).substring(0, 3).toUpperCase();
    }
    return '';
}

// ===========================================================
// FUNCIONES DE UTILIDAD Y CREACIÓN DE ELEMENTOS
// ===========================================================
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function createMovieCardElement(id, data, type) {
    const card = document.createElement('div');
    let cardClass = 'carousel-card';
    if (type === 'movie-grid' || type === 'roulette') {
        cardClass = 'movie-card';
    }
    card.className = cardClass;
    
    if (type !== 'roulette') {
        card.onclick = () => openDetailsModal(id, type);
    }
    
    const img = document.createElement('img');
    img.src = data.poster;
    img.alt = data.title;
    img.loading = 'lazy';
    
    card.appendChild(img);
    return card;
}
