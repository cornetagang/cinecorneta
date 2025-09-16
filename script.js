// ===========================================================
// VARIABLES GLOBALES Y ENLACE API
// ===========================================================
let movieDatabase = {}, seriesDatabase = {}, seriesEpisodesData = {}, allMoviesFull = {};
const API_URL = 'https://script.google.com/macros/s/AKfycbxGF-2oYn2FfNkAqqERZH6dFt49hcWhRhjB_zrIiU7UDOshLFoobKVxCU6HlcaCE2Sd/exec';
const playerState = {};

// ===========================================================
// VARIABLES DE ESTADO
// ===========================================================
let heroInterval;
let isHeroIntervalPaused = false;
let heroMovieIds = [];

// ===========================================================
// INICIO DE LA APLICACIÓN
// ===========================================================
document.addEventListener('DOMContentLoaded', () => {
    const preloader = document.getElementById('preloader');
    const pageWrapper = document.querySelector('.page-wrapper');

    Promise.all([
        fetch(`${API_URL}?data=series`).then(res => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return res.json();
        }),
        fetch(`${API_URL}?data=episodes`).then(res => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return res.json();
        }),
        fetch(`${API_URL}?data=allMovies`).then(res => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return res.json();
        })
    ])
    .then(([series, episodes, allMovies]) => {
        if (typeof allMovies !== 'object' || allMovies === null) {
            throw new Error("Datos de películas no válidos");
        }
        if (typeof series !== 'object' || series === null) {
            throw new Error("Datos de series no válidos");
        }

        seriesDatabase = series;
        seriesEpisodesData = episodes;
        allMoviesFull = allMovies;

        const movieEntries = Object.keys(allMoviesFull)
        .sort((a, b) => allMoviesFull[b].tr - allMoviesFull[a].tr)
        .slice(0, 7)
        .map(key => [key, allMoviesFull[key]]);
        movieDatabase = Object.fromEntries(movieEntries);
            
        const criticalImageUrls = new Set();
        const firstMovieId = Object.keys(movieDatabase)[0];
        if (firstMovieId && movieDatabase[firstMovieId]) {
            criticalImageUrls.add(movieDatabase[firstMovieId].poster);
            criticalImageUrls.add(movieDatabase[firstMovieId].banner);
        }
        Object.keys(movieDatabase).slice(0, 6).forEach(id => {
            if (movieDatabase[id] && movieDatabase[id].poster) {
                criticalImageUrls.add(movieDatabase[id].poster);
            }
        });

        const preloadImages = (urls) => {
            const promises = Array.from(urls).map(url => new Promise((resolve) => {
                const img = new Image();
                img.onload = resolve;
                img.onerror = resolve;
                img.src = url;
            }));
            return Promise.all(promises);
        };

        preloadImages(criticalImageUrls).then(() => {
            setupApp();
            preloader.classList.add('fade-out');
            preloader.addEventListener('transitionend', () => preloader.remove());
            pageWrapper.style.display = 'block';
        });
    })
    .catch(error => {
        console.error("Error al cargar los datos:", error);
        preloader.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;"><p>Error al cargar datos. Por favor, revisa la conexión y la configuración de la API.</p><p>Detalles: ${error.message}</p></div>`;
        preloader.style.opacity = 1;
        preloader.style.visibility = 'visible';
    });
});

// ===========================================================
// SETUP INICIAL DE LA APP
// ===========================================================
function setupApp() {
    setupHero();
    generateCarousels();
    setupRouletteLogic();
    setupNavigation();
    setupKeydownListener();
    setupSearch();
    setupScrollListeners();

    const genreFilter = document.getElementById('genre-filter');
    const sortBy = document.getElementById('sort-by');
    genreFilter.addEventListener('change', handleFilterChange);
    sortBy.addEventListener('change', handleFilterChange);

    switchView('all');
}

// ===========================================================
// MANEJADORES DE EVENTOS
// ===========================================================
function setupScrollListeners() {
    window.addEventListener('scroll', () => {
        const header = document.querySelector('.main-header');
        const isModalOpen = document.querySelector('.modal.show');
        
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }

        if (heroInterval) {
           
        if (window.scrollY > 50 && !isHeroIntervalPaused && !isModalOpen) {
                clearInterval(heroInterval);
                isHeroIntervalPaused = true;

            }

        else if (window.scrollY <= 50 && isHeroIntervalPaused) {
                startHeroInterval();
            }
        }
    }, { passive: true });
}

function setupKeydownListener() {
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const openModal = document.querySelector('.modal.show');
        if (openModal) {
            const closeButton = openModal.querySelector('.close-btn');
            if (closeButton) closeButton.click();
        }
    });
}

// ===========================================================
// NAVEGACIÓN
// ===========================================================
function setupNavigation() {
    const hamburgerBtn = document.getElementById('menu-toggle');
    const mobileNavPanel = document.getElementById('mobile-nav-panel');
    const closeNavBtn = mobileNavPanel.querySelector('.close-nav-btn');
    const menuOverlay = document.getElementById('menu-overlay');
    const mobileNavContainer = mobileNavPanel.querySelector('.mobile-nav ul');
    const desktopNavContainer = document.querySelector('.main-nav ul');

    function openMenu() {
        if (mobileNavPanel) mobileNavPanel.classList.add('is-open');
        if (menuOverlay) menuOverlay.classList.add('active');
    }

    function closeMenu() {
        if (mobileNavPanel) mobileNavPanel.classList.remove('is-open');
        if (menuOverlay) menuOverlay.classList.remove('active');
    }

    function handleFilterClick(event) {
        const linkClickeado = event.target.closest('a');
        if (!linkClickeado) return;
        event.preventDefault();
        const filter = linkClickeado.dataset.filter;
        closeMenu();

        if (filter === 'roulette') {
            openRouletteModal();
            return;
        }

        if (linkClickeado.classList.contains('active')) return;
        document.querySelectorAll('.main-nav a, .mobile-nav a').forEach(link => link.classList.remove('active'));
        document.querySelectorAll(`a[data-filter="${filter}"]`).forEach(link => link.classList.add('active'));
        document.getElementById('search-input').value = '';
        switchView(filter);
    }

    if (hamburgerBtn) hamburgerBtn.addEventListener('click', openMenu);
    if (closeNavBtn) closeNavBtn.addEventListener('click', closeMenu);
    if (menuOverlay) menuOverlay.addEventListener('click', closeMenu);
    if (desktopNavContainer) desktopNavContainer.addEventListener('click', handleFilterClick);
    if (mobileNavContainer) mobileNavContainer.addEventListener('click', handleFilterClick);
}

function handleFilterChange() {
    const activeNav = document.querySelector('.main-nav a.active, .mobile-nav a.active');
    const type = activeNav.dataset.filter;
    applyAndDisplayFilters(type);
}

// ===========================================================
// BÚSQUEDA
// ===========================================================
function setupSearch() {
    const searchInput = document.getElementById('search-input');
    let isSearchActive = false;
    searchInput.addEventListener('input', () => {
        const searchTerm = searchInput.value.toLowerCase().trim();
        if (searchTerm === '') {
            if (isSearchActive) {
                const activeNav = document.querySelector('.main-nav a.active, .mobile-nav a.active');
                switchView(activeNav ? activeNav.dataset.filter : 'all');
                isSearchActive = false;
            }
            return;
        }
        isSearchActive = true;
        const allContent = { ...allMoviesFull, ...seriesDatabase };
        const results = Object.entries(allContent).filter(([id, item]) => 
            item.title.toLowerCase().includes(searchTerm)
        );
        displaySearchResults(results);
    });
}

function displaySearchResults(results) {
    const gridContainer = document.querySelector('#full-grid-container .grid');
    document.getElementById('hero-section').style.display = 'none';
    document.getElementById('carousel-container').style.display = 'none';
    document.getElementById('full-grid-container').style.display = 'block';

    gridContainer.innerHTML = '';

    if (results.length === 0) {
        gridContainer.style.display = 'flex';
        gridContainer.style.justifyContent = 'center';
        gridContainer.style.alignItems = 'center';
        gridContainer.innerHTML = `<p style="color: var(--text-muted); text-align: center;">No se encontraron resultados.</p>`;
    } else {
        gridContainer.style.display = 'grid';
        gridContainer.style.justifyContent = 'initial';
        gridContainer.style.alignItems = 'initial';

        results.forEach(([id, item]) => {
            const type = seriesDatabase[id] ? 'series' : 'movie-grid';
            gridContainer.appendChild(createMovieCardElement(id, item, type, true));
        });
    }
}

// ===========================================================
// VISTAS Y CONTENIDO DINÁMICO
// ===========================================================
function setupHero() {
    const heroSection = document.getElementById('hero-section');
    if (!heroSection) return;
    heroSection.innerHTML = `<div class="hero-content"><h1 id="hero-title"></h1><p id="hero-synopsis"></p><div class="hero-buttons"></div></div>`;
    
    heroMovieIds = Object.keys(movieDatabase); 

    if (heroMovieIds.length > 0) {
        shuffleArray(heroMovieIds);
        changeHeroMovie(0, heroMovieIds);
        startHeroInterval(); 
    } else {
       heroSection.style.display = 'none'; 
    }
}

function startHeroInterval() {
    clearInterval(heroInterval);
    isHeroIntervalPaused = false;
    let currentHeroIndex = 0;

    if (heroMovieIds.length === 0) return;

    heroInterval = setInterval(() => {
        currentHeroIndex = (currentHeroIndex + 1) % heroMovieIds.length;
        changeHeroMovie(currentHeroIndex, heroMovieIds);
    }, 7000);
}

function changeHeroMovie(index, ids) {
    const heroSection = document.getElementById('hero-section');
    const heroContent = heroSection.querySelector('.hero-content');
    if (!heroContent || !ids) return;
    const movieId = ids[index];
    const movieData = movieDatabase[movieId];
    if (!movieData) return;
    const imageUrl = window.innerWidth < 992 ? movieData.poster : movieData.banner;
    heroContent.classList.add('hero-fading');
    setTimeout(() => {
        heroSection.style.backgroundImage = `url(${imageUrl})`;
        heroContent.querySelector('#hero-title').textContent = movieData.title;
        heroContent.querySelector('#hero-synopsis').textContent = movieData.synopsis;
        heroContent.querySelector('.hero-buttons').innerHTML = `<button class="btn btn-play" onclick="openPlayerModal('${movieId}')"><i class="fas fa-play"></i> Ver Ahora</button> <button class="btn btn-info" onclick="openDetailsModal('${movieId}', 'movie')">Más Información</button>`;
        heroContent.classList.remove('hero-fading');
    }, 500);
}

function generateCarousels() {
    const container = document.getElementById('carousel-container');
    container.innerHTML = '';
    const recentMovieIds = Object.keys(movieDatabase);
    if (recentMovieIds.length > 0) {
        const movieCarouselEl = document.createElement('div');
        movieCarouselEl.className = 'carousel';
        movieCarouselEl.dataset.type = 'movie';
        movieCarouselEl.innerHTML = `<h3 class="carousel-title">Agregadas Recientemente</h3><div class="carousel-track-container"><div class="carousel-track"></div></div>`;
        const movieTrack = movieCarouselEl.querySelector('.carousel-track');
        recentMovieIds.forEach(id => movieTrack.appendChild(createMovieCardElement(id, movieDatabase[id], 'movie', false)));
        container.appendChild(movieCarouselEl);
    }
} 

function switchView(filter) {
    const carouselContainer = document.getElementById('carousel-container');
    const fullGridContainer = document.getElementById('full-grid-container');
    const heroSection = document.getElementById('hero-section');
    const filterControls = document.getElementById('filter-controls');

    heroSection.style.display = 'none';
    carouselContainer.style.display = 'none';
    fullGridContainer.style.display = 'none';
    filterControls.style.display = 'none';

    resetFilters();

    if (filter === 'all') {
        heroSection.style.display = 'flex';
        carouselContainer.style.display = 'block';
    } else if (filter === 'movie') {
        fullGridContainer.style.display = 'block';
        filterControls.style.display = 'flex';
        populateFullMovieGrid();
    } else if (filter === 'series') {
        fullGridContainer.style.display = 'block';
        filterControls.style.display = 'flex';
        populateFullSeriesGrid();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function populateFullMovieGrid() {
    populateFilters('movie');
    applyAndDisplayFilters('movie');
}

function populateFullSeriesGrid() {
    populateFilters('series');
    applyAndDisplayFilters('series');
}

function populateFilters(type) {
    const sourceData = (type === 'movie') ? allMoviesFull : seriesDatabase;
    const genreFilter = document.getElementById('genre-filter');
    const genres = new Set();
    for (const id in sourceData) {
        if (Array.isArray(sourceData[id].genres)) {
            sourceData[id].genres.forEach(genre => genres.add(genre));
        }
    }
    const sortedGenres = Array.from(genres).sort();
    genreFilter.innerHTML = `<option value="all">Todos los géneros</option>`;
    sortedGenres.forEach(genre => {
        const option = document.createElement('option');
        option.value = genre;
        option.textContent = genre;
        genreFilter.appendChild(option);
    });
}

function applyAndDisplayFilters(type) {
    const sourceData = (type === 'movie') ? allMoviesFull : seriesDatabase;
    const gridContainer = document.querySelector('#full-grid-container .grid');
    const selectedGenre = document.getElementById('genre-filter').value;
    const sortByValue = document.getElementById('sort-by').value;

    let content = Object.entries(sourceData);
    if (selectedGenre !== 'all') {
        content = content.filter(([id, item]) => 
            item.genres && item.genres.includes(selectedGenre)
        );
    }

    switch (sortByValue) {
        case 'title-asc':
            content.sort((a, b) => a[1].title.localeCompare(b[1].title));
            break;
        case 'title-desc':
            content.sort((a, b) => b[1].title.localeCompare(a[1].title));
            break;
        case 'year-desc':
            content.sort((a, b) => b[1].year - a[1].year);
            break;
        case 'year-asc':

        content.sort((a, b) => a[1].year - b[1].year); 
            break;
        case 'recent':
            content.sort((a, b) => b[1].tr - a[1].tr);
            break;
    }

    gridContainer.innerHTML = '';
    if (content.length > 0) {
        const cardType = (type === 'movie') ? 'movie-grid' : 'series';
        content.forEach(([id, item]) => {
            gridContainer.appendChild(createMovieCardElement(id, item, cardType, true));
        });
    } else {
        gridContainer.innerHTML = `<p style="color: var(--text-muted); text-align: center; grid-column: 1 / -1;">No se encontraron resultados.</p>`;
    }
}

function resetFilters() {
    document.getElementById('genre-filter').value = 'all';
    document.getElementById('sort-by').value = 'default';
}
// ===========================================================
// MODALES
// ===========================================================

function openRouletteModal() {
    if (!allMoviesFull) {
        alert("Las películas aún se están cargando, por favor espera un segundo.");
        return;
    }
    const rouletteModal = document.getElementById('roulette-modal');
    if (rouletteModal) {
        rouletteModal.classList.add('show');
        if (window.loadRouletteMovies) {
            window.loadRouletteMovies();
        }
    }
}

function closeRouletteModal() {
    const rouletteModal = document.getElementById('roulette-modal');
    if (rouletteModal) rouletteModal.classList.remove('show');
}

function openDetailsModal(id, type) {
    let data;
    if (type.startsWith('movie')) {
        data = (allMoviesFull && allMoviesFull[id]) ? allMoviesFull[id] : movieDatabase[id];
    } else {
        data = seriesDatabase[id];
    }
    if (!data) return;

    const modal = document.getElementById('details-modal');
    modal.querySelector('.details-panel').style.backgroundImage = `url(${data.banner})`;
    modal.querySelector('#details-poster-img').src = data.poster;
    modal.querySelector('#details-title').textContent = data.title;
    modal.querySelector('#details-year').textContent = data.year || '';
    modal.querySelector('#details-genres').textContent = Array.isArray(data.genres) ? data.genres.join(' • ') : '';
    modal.querySelector('#details-synopsis').textContent = data.synopsis || '';
    
    const buttonsContainer = modal.querySelector('#details-buttons');
    if (type.startsWith('movie')) {
        buttonsContainer.innerHTML = `<button class="btn btn-play" onclick="openPlayerModal('${id}')"><i class="fas fa-play"></i> Ver Ahora</button>`;
    } else {
        buttonsContainer.innerHTML = `<button class="btn btn-episodes" onclick="openSeriesPlayer('${id}')"><i class="fas fa-bars"></i> Ver Episodios</button>`;
    }

    initializeShowMore(modal);
    modal.classList.add('show');
}

function closeDetailsModal() { document.getElementById('details-modal').classList.remove('show'); }

function openPlayerModal(movieId) {
    closeDetailsModal();
    const cinemaModal = document.getElementById('cinema');
    const iframe = cinemaModal.querySelector('iframe');
    iframe.src = `https://drive.google.com/file/d/${movieId}/preview`;
    cinemaModal.classList.add('show');
    
    const fullscreenEvent = 'fullscreenchange';
    document.addEventListener(fullscreenEvent, () => handleFullscreenChange('video-frame'), false);
    const closeBtn = cinemaModal.querySelector('.close-btn');
    closeBtn.onclick = () => {
        closePlayerModal('video-frame');
        document.removeEventListener(fullscreenEvent, () => handleFullscreenChange('video-frame'), false);
    };
}

function closePlayerModal(iframeId) {
    const iframe = document.getElementById(iframeId);
    if (iframe) {
        iframe.src = '';
        const modal = iframe.closest('.modal');
        if (modal) modal.classList.remove('show');
    }

    if (screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock();
    }
}

function setupRouletteLogic() {
    const rouletteModal = document.getElementById('roulette-modal');
    const spinButton = document.getElementById('spin-roulette-btn');
    const rouletteTrack = document.getElementById('roulette-carousel-track');

    if (!rouletteModal || !spinButton || !rouletteTrack) {
        console.error("¡ERROR! No se encontró uno de los elementos de la ruleta.");
        return;
    }

    const cardWidth = 150;
    const cardMargin = 10;
    const cardTotalWidth = cardWidth + (cardMargin * 2);
    let finalPickIndex = -1;
    let selectedMovie = null;

    window.loadRouletteMovies = function() {
        rouletteTrack.classList.remove('is-spinning');
        spinButton.disabled = false;
        rouletteTrack.style.transition = 'none';
        rouletteTrack.innerHTML = '';
        
        if (!allMoviesFull || Object.keys(allMoviesFull).length < 5) {
            rouletteTrack.innerHTML = `<p style="color:white;text-align:center;">No hay suficientes películas para la ruleta.</p>`;
            spinButton.disabled = true;
            return;
        }

        const allMovieIds = Object.keys(allMoviesFull);
        const moviesForRoulette = Array.from({ length: 50 }, () => {
            const randomIndex = Math.floor(Math.random() * allMovieIds.length);
            const movieId = allMovieIds[randomIndex];
            return { id: movieId, data: allMoviesFull[movieId] };
        });

        finalPickIndex = Math.floor(Math.random() * (moviesForRoulette.length - 10)) + 5;
        selectedMovie = moviesForRoulette[finalPickIndex];

        moviesForRoulette.forEach(movie => {
            rouletteTrack.appendChild(createMovieCardElement(movie.id, movie.data, 'roulette', true));
        });
        
        setTimeout(() => {
            const wrapperWidth = rouletteTrack.parentElement.offsetWidth;
            const initialOffset = (wrapperWidth / 2) - (cardTotalWidth * 2.5);
            rouletteTrack.style.transform = `translateX(${initialOffset}px)`;
        }, 100);
    }
    
    spinButton.addEventListener('click', () => {
        if (!selectedMovie) return;
        spinButton.disabled = true;
        rouletteTrack.classList.add('is-spinning');

        const wrapperWidth = rouletteTrack.parentElement.offsetWidth;
        const centerOfFinalCard = (cardTotalWidth * finalPickIndex) + (cardTotalWidth / 2);
        const targetPosition = (wrapperWidth / 2) - centerOfFinalCard;
        const randomJitter = Math.floor(Math.random() * (cardWidth / 2)) - (cardWidth / 4);
        const finalPosition = targetPosition + randomJitter;
        
        rouletteTrack.style.transition = 'transform 8s cubic-bezier(0.1, 0, 0.2, 1)';
        rouletteTrack.style.transform = `translateX(${finalPosition}px)`;

        rouletteTrack.addEventListener('transitionend', () => {
            rouletteTrack.classList.remove('is-spinning');
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
    const seriesInfo = seriesDatabase[seriesId];
    if (!seriesInfo) return;
    const dataSet = seriesEpisodesData[seriesId];
    const modal = document.getElementById('series-player-modal');
    if (!dataSet) {
        modal.innerHTML = `<div class="player-layout-container" style="text-align:center;justify-content:center;"><button class="close-btn" onclick="document.getElementById('series-player-modal').classList.remove('show')">X</button><h2>Error</h2><p>No se encontraron episodios.</p></div>`;
        modal.classList.add('show');
        return;
    }

    let savedProgress = loadProgress(seriesId);
    if (savedProgress && dataSet[savedProgress.season]) {
        playerState[seriesId] = savedProgress;
    } else {
        playerState[seriesId] = { season: Object.keys(dataSet)[0], episodeIndex: 0, lang: 'es' };
    }
    
    const { season, episodeIndex } = playerState[seriesId];
    const firstEpisode = dataSet[Object.keys(dataSet)[0]][0];
    const hasLangOptions = firstEpisode && firstEpisode.videoId_es && firstEpisode.videoId_es.trim() !== '';
    let langControlsHTML = hasLangOptions ? `<div id="${seriesId}-lang-controls" class="lang-controls"><button class="lang-btn" data-lang="es" onclick="changeLanguage('${seriesId}', 'es')">Español</button><button class="lang-btn" data-lang="en" onclick="changeLanguage('${seriesId}', 'en')">Inglés</button></div>` : '';
    
    const iframeId = `video-frame-${seriesId}`;

    modal.innerHTML = `<button class="close-btn" aria-label="Cerrar reproductor de series">X</button><div class="player-layout-container"><div class="player-container"><h2 id="${seriesId}-cinema-title" class="player-title"></h2>${langControlsHTML}<div class="screen"><iframe id="${iframeId}" src="" allowfullscreen></iframe></div><div class="pagination-controls"><button class="episode-nav-btn" id="${seriesId}-prev-btn" onclick="navigateEpisode('${seriesId}', -1)"><i class="fas fa-chevron-left"></i> Anterior</button><span id="${seriesId}-page-indicator" class="page-indicator"></span><button class="episode-nav-btn" id="${seriesId}-next-btn" onclick="navigateEpisode('${seriesId}', 1)">Siguiente <i class="fas fa-chevron-right"></i></button></div></div><div class="episode-sidebar"><h2>Temporadas y Episodios</h2><select id="${seriesId}-season-selector" class="season-dropdown"></select><div id="${seriesId}-episode-list" class="episode-list-container"></div></div></div>`;
    modal.classList.add('show');
    
    const fullscreenEvent = 'fullscreenchange';
    const closeBtn = modal.querySelector('.close-btn');

    const handleClose = () => {
        closePlayerModal(iframeId);
        document.removeEventListener(fullscreenEvent, handleFullscreenChange);
        closeBtn.removeEventListener('click', handleClose);
    };

    const handleFullscreenChangeWithId = () => {
        handleFullscreenChange(iframeId);
    };

    document.addEventListener(fullscreenEvent, handleFullscreenChangeWithId);
    closeBtn.addEventListener('click', handleClose);

    populateSeasonDropdown(seriesId, season);
    populateEpisodeList(seriesId, season);
    openEpisode(seriesId, season, episodeIndex);

    document.getElementById(`${seriesId}-season-selector`).addEventListener('change', (event) => {
        const newSeason = event.target.value;
        playerState[seriesId] = { ...playerState[seriesId], season: newSeason, episodeIndex: 0 };
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
    selector.innerHTML = Object.keys(data).map(seasonNum => `<option value="${seasonNum}" ${seasonNum == selectedSeason ? 'selected' : ''}>${isNaN(seasonNum) ? seasonNum : `Temporada ${seasonNum}`}</option>`).join('');
}
function populateEpisodeList(seriesId, seasonNum) {
    const container = document.getElementById(`${seriesId}-episode-list`);
    const episodes = seriesEpisodesData[seriesId][seasonNum];
    container.innerHTML = '';
    if (!episodes) return;
    episodes.forEach((episode, index) => {
        const card = document.createElement('div');
        card.className = 'episode-card';
        card.id = `${seriesId}-episode-${String(seasonNum).replace(/\s/g, '')}-${index}`;
        card.onclick = () => openEpisode(seriesId, seasonNum, index);
        card.innerHTML = `<img src="${episode.thumbnail}" alt="${episode.title}" class="episode-card-thumb" loading="lazy"><div class="episode-card-info"><h3>${index + 1}. ${episode.title}</h3><p class="episode-description">${episode.description || ''}</p></div>`;
        container.appendChild(card);
    });
}
function openEpisode(seriesId, season, episodeIndex) {
    const episode = seriesEpisodesData[seriesId]?.[season]?.[episodeIndex];
    if (!episode) return;
    document.querySelectorAll(`#${seriesId}-episode-list .episode-card.active`).forEach(c => c.classList.remove('active'));
    document.getElementById(`${seriesId}-episode-${String(season).replace(/\s/g, '')}-${episodeIndex}`)?.classList.add('active');
    playerState[seriesId] = { ...playerState[seriesId], season, episodeIndex };
    saveProgress(seriesId);
    const iframe = document.getElementById(`video-frame-${seriesId}`);
    let videoId = episode.videoId;
    if (episode.hasOwnProperty('videoId_es') && episode.videoId_es.trim() !== '') {
        const lang = playerState[seriesId]?.lang || 'es';
        videoId = lang === 'es' ? episode.videoId_es : episode.videoId_en;
        document.querySelectorAll(`#${seriesId}-lang-controls .lang-btn`).forEach(btn => {
            btn.classList.toggle('active', btn.dataset.lang === lang);
        });
    }
    iframe.src = videoId ? `https://drive.google.com/file/d/${videoId}/preview` : '';
    document.getElementById(`${seriesId}-cinema-title`).textContent = `T${season} E${episodeIndex + 1} - ${episode.title}`;
    updateNavButtons(seriesId, season, episodeIndex);
}
function navigateEpisode(seriesId, direction) {
    const { season, episodeIndex } = playerState[seriesId];
    const newIndex = episodeIndex + direction;
    if (newIndex >= 0 && newIndex < seriesEpisodesData[seriesId][season].length) {
        openEpisode(seriesId, season, newIndex);
    }
}
function updateNavButtons(seriesId, season, episodeIndex) {
    const totalEpisodes = seriesEpisodesData[seriesId][season].length;
    document.getElementById(`${seriesId}-prev-btn`).disabled = (episodeIndex === 0);
    document.getElementById(`${seriesId}-next-btn`).disabled = (episodeIndex === totalEpisodes - 1);
}
function saveProgress(seriesId) {
    try {
        localStorage.setItem(`${seriesId}Progress`, JSON.stringify(playerState[seriesId]));
    } catch (e) { console.error(`Error al guardar progreso:`, e); }
}

// ===========================================================
// FUNCIONES DE UTILIDAD
// ===========================================================
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}
function createMovieCardElement(id, data, type, lazy) {
    const card = document.createElement('div');
    const cardClass = (type.includes('grid') || type === 'roulette' || type === 'series') ? 'movie-card' : 'carousel-card';
    card.className = cardClass;
    if (type !== 'roulette') {
        const clickType = type.includes('series') ? 'series' : 'movie';
        card.onclick = () => openDetailsModal(id, clickType);
    }
    const img = document.createElement('img');
    img.src = data.poster;
    img.alt = data.title;
    if (lazy) img.loading = 'lazy';
    card.appendChild(img);
    return card;
}

function initializeShowMore(modalElement) {
    const description = modalElement.querySelector('#details-synopsis');
    const wrapper = modalElement.querySelector('.description-wrapper');

    if(!wrapper) return;

    const existingButton = wrapper.querySelector('.toggle-description-btn');
    if (existingButton) {
        existingButton.remove();
    }

    description.classList.remove('description-truncated');

    if (description.scrollHeight > 65) {
        description.classList.add('description-truncated');
        
        const toggleButton = document.createElement('button');
        toggleButton.innerText = 'Ver más...';
        toggleButton.className = 'toggle-description-btn';
        
        wrapper.appendChild(toggleButton);

        toggleButton.addEventListener('click', () => {
            if (description.classList.contains('description-truncated')) {
                description.classList.remove('description-truncated');
                toggleButton.innerText = 'Ver menos';
            } else {
                description.classList.add('description-truncated');
                toggleButton.innerText = 'Ver más...';
            }
        });
    }
}

function loadProgress(seriesId) {
    try {
        const progress = localStorage.getItem(`${seriesId}Progress`);
        return progress ? JSON.parse(progress) : null;
    } catch (e) {
        console.error("Error al cargar progreso:", e);
        return null;
    }
}

function handleFullscreenChange(elementId) {
    const iframe = document.getElementById(elementId);
    if (!iframe) return;

    if (document.fullscreenElement) {
        try {
            if (screen.orientation && screen.orientation.lock) {
                screen.orientation.lock('landscape')
                    .then(() => console.log('Pantalla bloqueada en horizontal.'))
                    .catch(err => console.error('Error al bloquear la pantalla:', err));
            }
        } catch (err) {
            console.error('La API de orientación de pantalla no está disponible o falló:', err);
        }
    } else {
        try {
            if (screen.orientation && screen.orientation.unlock) {
                screen.orientation.unlock();
                console.log('Pantalla desbloqueada.');
            }
        } catch (err) {
            console.error('La API de orientación de pantalla no está disponible o falló:', err);
        }
    }
}
