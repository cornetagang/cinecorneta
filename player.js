// ===========================================================
// MÓDULO DEL REPRODUCTOR (Cargado bajo demanda)
// ===========================================================

let shared; // Dependencias compartidas (appState, DOM, etc.)

// ===========================================================
// 1. INICIALIZACIÓN Y CONFIGURACIÓN
// ===========================================================

export function initPlayer(dependencies) {
    shared = dependencies;
}

// ===========================================================
// 2. SISTEMA DE PERSISTENCIA (PROGRESO LOCAL)
// ===========================================================

function saveProgress(seriesId) {
    try {
        let allProgress = JSON.parse(localStorage.getItem('seriesProgress')) || {};
        if (!allProgress[seriesId]) allProgress[seriesId] = {};
        
        // Guardamos el índice del episodio actual para la temporada actual
        const currentState = shared.appState.player.state[seriesId];
        allProgress[seriesId][currentState.season] = currentState.episodeIndex;
        
        localStorage.setItem('seriesProgress', JSON.stringify(allProgress));
    } catch (e) { 
        console.warn("No se pudo guardar el progreso local:", e); 
    }
}

function loadProgress(seriesId, seasonNum) {
    try {
        const allProgress = JSON.parse(localStorage.getItem('seriesProgress'));
        return allProgress?.[seriesId]?.[seasonNum] || 0;
    } catch (e) { 
        return 0; 
    }
}

// ===========================================================
// 3. GESTIÓN DEL MODAL DE SERIES (CIERRE Y APERTURA)
// ===========================================================

export function commitAndClearPendingSave() {
    if (shared.appState.player.pendingHistorySave) {
        shared.addToHistoryIfLoggedIn(
            shared.appState.player.pendingHistorySave.contentId,
            shared.appState.player.pendingHistorySave.type,
            shared.appState.player.pendingHistorySave.episodeInfo
        );
        shared.appState.player.pendingHistorySave = null;
    }
}

export function closeSeriesPlayerModal() {
    // 1. Guardar historial pendiente si existe
    clearTimeout(shared.appState.player.episodeOpenTimer);
    commitAndClearPendingSave();

    // 2. Limpiar UI
    shared.DOM.seriesPlayerModal.classList.remove('show', 'season-grid-view', 'player-layout-view');
    document.body.classList.remove('modal-open');
    
    // 3. Detener video (limpiar src)
    const iframe = shared.DOM.seriesPlayerModal.querySelector('iframe');
    if (iframe) iframe.src = '';
    
    shared.appState.player.activeSeriesId = null; 
}

export async function openSeriesPlayer(seriesId, forceSeasonGrid = false) {
    shared.closeAllModals();
    const seriesInfo = shared.appState.content.series[seriesId];
    if (!seriesInfo) return;

    document.body.classList.add('modal-open');
    shared.DOM.seriesPlayerModal.classList.add('show');
    
    // Mostrar spinner mientras carga lógica
    shared.DOM.seriesPlayerModal.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
            <div class="spinner"></div>
        </div>`;

    const seriesEpisodes = shared.appState.content.seriesEpisodes[seriesId] || {};
    const seasons = Object.keys(seriesEpisodes);

    // Caso 1: Forzar grilla de temporadas o hay múltiples temporadas
    if (forceSeasonGrid && seasons.length > 1) {
        renderSeasonGrid(seriesId);
        return;
    }

    // Caso 2: No hay episodios
    if (seasons.length === 0) {
        shared.DOM.seriesPlayerModal.innerHTML = `
            <button class="close-btn">&times;</button>
            <div style="text-align:center; padding: 20px;">
                <p>No hay episodios disponibles por el momento.</p>
            </div>`;
        // Asignar evento manualmente (Corrección del onclick)
        shared.DOM.seriesPlayerModal.querySelector('.close-btn').onclick = closeSeriesPlayerModal;
        return;
    }

    // Caso 3: Verificar historial del usuario para "Continuar viendo"
    const user = shared.auth.currentUser;
    let lastWatched = null;

    if (user) {
        const historySnapshot = await shared.db.ref(`users/${user.uid}/history`).orderByChild('viewedAt').once('value');
        if (historySnapshot.exists()) {
            let userHistoryForThisSeries = [];
            historySnapshot.forEach(child => {
                const item = child.val();
                if (item.type === 'series' && item.contentId === seriesId) {
                    userHistoryForThisSeries.push(item);
                }
            });
            if (userHistoryForThisSeries.length > 0) {
                lastWatched = userHistoryForThisSeries.pop(); // El último visto
            }
        }
    }

    if (lastWatched) {
        renderEpisodePlayer(seriesId, lastWatched.season, lastWatched.lastEpisode);
    } else {
        // Ordenar temporadas para abrir la primera
        const seasonsMapped = seasons.map(k => {
            const numMatch = String(k).replace(/\D/g, '');
            const num = numMatch ? parseInt(numMatch, 10) : 0;
            return { key: k, num };
        }).sort((a, b) => a.num - b.num);

        const firstSeasonKey = seasonsMapped.length > 0 ? seasonsMapped[0].key : seasons[0];
        renderEpisodePlayer(seriesId, firstSeasonKey, 0);
    }
}

// ===========================================================
// 4. VISTA DE GRILLA DE TEMPORADAS
// ===========================================================

function renderSeasonGrid(seriesId) {
    const seriesInfo = shared.appState.content.series[seriesId];
    shared.DOM.seriesPlayerModal.className = 'modal show season-grid-view';
    
    // Generar HTML base
    shared.DOM.seriesPlayerModal.innerHTML = `
        <button class="close-btn">&times;</button>
        <div class="season-grid-container">
            <h2 class="player-title">${seriesInfo.title}</h2>
            <div id="season-grid" class="season-grid"></div>
        </div>
    `;
    
    // Asignar evento de cierre (Corrección)
    shared.DOM.seriesPlayerModal.querySelector('.close-btn').onclick = closeSeriesPlayerModal;

    populateSeasonGrid(seriesId);
    shared.appState.player.activeSeriesId = null;
}

function populateSeasonGrid(seriesId) {
    const container = shared.DOM.seriesPlayerModal.querySelector('#season-grid');
    const data = shared.appState.content.seriesEpisodes[seriesId];
    const seriesInfo = shared.appState.content.series[seriesId];
    if (!container || !data) return;

    container.innerHTML = '';

    const seasonKeys = Object.keys(data);
    // Ordenar temporadas numéricamente
    const seasonsMapped = seasonKeys.map(k => {
        const numMatch = String(k).replace(/\D/g, '');
        const num = numMatch ? parseInt(numMatch, 10) : 0;
        return { key: k, num };
    }).sort((a, b) => a.num - b.num);

    // Ajustar columnas CSS Grid dinámicamente según cantidad
    const seasonCount = seasonsMapped.length;
    let columns = (seasonCount <= 5) ? seasonCount : Math.ceil(seasonCount / 2);
    container.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;

    seasonsMapped.forEach(({ key: seasonKey, num: seasonNum }) => {
        const episodes = Array.isArray(data[seasonKey]) ? data[seasonKey] : Object.values(data[seasonKey] || {});
        const posterUrl = shared.appState.content.seasonPosters[seriesId]?.[seasonKey] || seriesInfo.poster || '';
        const totalEpisodes = episodes.length;

        // Calcular progreso visual
        const lastWatchedIndex = loadProgress(seriesId, seasonKey);
        const watchedEpisodes = lastWatchedIndex > 0 ? lastWatchedIndex + 1 : 0;
        const progressPercent = totalEpisodes > 0 ? Math.round((watchedEpisodes / totalEpisodes) * 100) : 0;

        let progressHTML = '';
        if (progressPercent > 0 && progressPercent < 100) {
            progressHTML = `
                <div class="progress-bar" role="progressbar">
                    <div style="width: ${progressPercent}%"></div>
                </div>`;
        } else if (progressPercent === 100) {
            progressHTML = `
                <div class="progress-bar complete" role="progressbar">
                    <div style="width: 100%"></div>
                </div>`;
        }

        const card = document.createElement('div');
        card.className = 'season-poster-card';
        card.onclick = () => renderEpisodePlayer(seriesId, seasonKey);

        card.innerHTML = `
            <img src="${posterUrl}" alt="Temporada ${seasonNum}">
            <div class="overlay">
                <h3>Temporada ${seasonNum}</h3>
                <p>${totalEpisodes} episodios</p>
            </div>
            ${progressHTML}
        `;

        container.appendChild(card);
    });
}

// ===========================================================
// 5. VISTA DE REPRODUCTOR DE EPISODIOS
// ===========================================================

async function renderEpisodePlayer(seriesId, seasonNum, startAtIndex = null) {
    shared.appState.player.activeSeriesId = seriesId;
    
    // Determinar índice inicial
    const savedEpisodeIndex = loadProgress(seriesId, seasonNum);
    const initialEpisodeIndex = startAtIndex !== null ? startAtIndex : savedEpisodeIndex;
    
    // Inicializar estado local del reproductor
    shared.appState.player.state[seriesId] = { 
        season: seasonNum, 
        episodeIndex: initialEpisodeIndex, 
        lang: 'en' 
    };
    
    const firstEpisode = shared.appState.content.seriesEpisodes[seriesId]?.[seasonNum]?.[0];
    
    // Verificar si hay opciones de idioma
    const hasLangOptions = firstEpisode?.videoId_es?.trim();
    let langControlsHTML = hasLangOptions 
        ? `<div class="lang-controls">
             <button class="lang-btn active" data-lang="en">Original</button>
             <button class="lang-btn" data-lang="es">Español</button>
           </div>` 
        : '';
    
    // Botón "Volver a temporadas" si hay más de una
    const seasonsCount = Object.keys(shared.appState.content.seriesEpisodes[seriesId]).length;
    const backButtonHTML = seasonsCount > 1 
        ? `<button class="player-back-link back-to-seasons"><i class="fas fa-arrow-left"></i> Temporadas</button>` 
        : '';

    shared.DOM.seriesPlayerModal.className = 'modal show player-layout-view';
    
    // Generar estructura del reproductor (Sin onclicks inline)
    shared.DOM.seriesPlayerModal.innerHTML = `
        <button class="close-btn">&times;</button>
        <div class="player-layout-container">
            <div class="player-container">
                <h2 id="cinema-title-${seriesId}" class="player-title"></h2>
                <div class="screen"><iframe id="video-frame-${seriesId}" src="" allowfullscreen></iframe></div>
                <div class="pagination-controls">
                    <button class="episode-nav-btn" id="prev-btn-${seriesId}"><i class="fas fa-chevron-left"></i> Anterior</button>
                    ${langControlsHTML}
                    <button class="episode-nav-btn" id="next-btn-${seriesId}">Siguiente <i class="fas fa-chevron-right"></i></button>
                </div>
            </div>
            <div class="episode-sidebar">
                <div class="sidebar-header"> ${backButtonHTML} <h2>Episodios</h2> </div>
                <div id="episode-list-${seriesId}" class="episode-list-container"></div>
            </div>
        </div>
    `;

    // Asignar eventos manualmente
    shared.DOM.seriesPlayerModal.querySelector('.close-btn').onclick = closeSeriesPlayerModal;

    shared.DOM.seriesPlayerModal.querySelector(`#prev-btn-${seriesId}`).onclick = () => navigateEpisode(seriesId, -1);
    shared.DOM.seriesPlayerModal.querySelector(`#next-btn-${seriesId}`).onclick = () => navigateEpisode(seriesId, 1);
    
    shared.DOM.seriesPlayerModal.querySelectorAll(`.lang-btn`).forEach(btn => {
        btn.onclick = () => changeLanguage(seriesId, btn.dataset.lang);
    });
    
    const backButton = shared.DOM.seriesPlayerModal.querySelector('.player-back-link.back-to-seasons');
    if (backButton) {
        backButton.onclick = () => renderSeasonGrid(seriesId);
    }
    
    populateEpisodeList(seriesId, seasonNum);
    openEpisode(seriesId, seasonNum, initialEpisodeIndex);
}

function populateEpisodeList(seriesId, seasonNum) {
    const container = shared.DOM.seriesPlayerModal.querySelector(`#episode-list-${seriesId}`);
    const episodes = shared.appState.content.seriesEpisodes[seriesId]?.[seasonNum];
    if (!container || !episodes) return;
    
    container.innerHTML = '';

    episodes.sort((a, b) => a.episodeNumber - b.episodeNumber).forEach((episode, index) => {
        const card = document.createElement('div');
        card.className = 'episode-card';
        card.id = `episode-card-${seriesId}-${seasonNum}-${index}`;
        
        card.addEventListener('click', () => openEpisode(seriesId, seasonNum, index));

        card.innerHTML = `
            <img src="${episode.thumbnail || ''}" alt="${episode.title || ''}" class="episode-card-thumb" loading="lazy">
            <div class="episode-card-info">
                <h3>${episode.episodeNumber || index + 1}. ${episode.title || ''}</h3>
                <p class="episode-description">${episode.description || ''}</p>
            </div>`;
            
        container.appendChild(card);

        // Efecto hover para expandir descripción
        let hoverTimer;
        card.addEventListener('mouseenter', () => { 
            hoverTimer = setTimeout(() => { card.classList.add('expanded'); }, 1000); 
        });
        card.addEventListener('mouseleave', () => { 
            clearTimeout(hoverTimer); 
            card.classList.remove('expanded'); 
        });
    });
}

function openEpisode(seriesId, season, newEpisodeIndex) {
    const episode = shared.appState.content.seriesEpisodes[seriesId]?.[season]?.[newEpisodeIndex];
    if (!episode) return;
    
    // Limpiar timer de guardado de historial anterior
    clearTimeout(shared.appState.player.episodeOpenTimer);
    shared.appState.player.pendingHistorySave = null;

    // Configurar nuevo timer para guardar en historial tras 20s
    shared.appState.player.episodeOpenTimer = setTimeout(() => {
        shared.appState.player.pendingHistorySave = {
            contentId: seriesId,
            type: 'series',
            episodeInfo: { season: season, index: newEpisodeIndex, title: episode.title || '' }
        };
    }, 20000); 

    // Actualizar UI de lista (Clase active)
    shared.DOM.seriesPlayerModal.querySelectorAll(`.episode-card.active`).forEach(c => c.classList.remove('active'));
    const activeCard = shared.DOM.seriesPlayerModal.querySelector(`#episode-card-${seriesId}-${season}-${newEpisodeIndex}`);
    if (activeCard) {
        activeCard.classList.add('active');
        activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    // Actualizar estado y guardar progreso
    shared.appState.player.state[seriesId] = { ...shared.appState.player.state[seriesId], season, episodeIndex: newEpisodeIndex };
    saveProgress(seriesId);
    
    // Cargar iframe
    const iframe = shared.DOM.seriesPlayerModal.querySelector(`#video-frame-${seriesId}`);
    const lang = shared.appState.player.state[seriesId]?.lang || 'es';
    
    let videoId;
    if (lang === 'en' && episode.videoId_en) {
        videoId = episode.videoId_en;
    } else if (lang === 'es' && episode.videoId_es) {
        videoId = episode.videoId_es;
    } else {
        videoId = episode.videoId; // Fallback
    }

    iframe.src = videoId ? `https://drive.google.com/file/d/${videoId}/preview` : '';
    
    // Actualizar Títulos y Botones
    const episodeNumber = episode.episodeNumber || newEpisodeIndex + 1;
    shared.DOM.seriesPlayerModal.querySelector(`#cinema-title-${seriesId}`).textContent = `T${String(season).replace('T', '')} E${episodeNumber} - ${episode.title || ''}`;
    
    shared.DOM.seriesPlayerModal.querySelectorAll(`.lang-btn`).forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });
    
    updateNavButtons(seriesId, season, newEpisodeIndex);
}

function navigateEpisode(seriesId, direction) {
    // Guardar historial pendiente antes de cambiar
    commitAndClearPendingSave();

    const { season, episodeIndex } = shared.appState.player.state[seriesId];
    const newIndex = episodeIndex + direction;
    const seasonEpisodes = shared.appState.content.seriesEpisodes[seriesId][season];

    if (newIndex >= 0 && newIndex < seasonEpisodes.length) {
        openEpisode(seriesId, season, newIndex);
    }
}

function updateNavButtons(seriesId, season, episodeIndex) {
    const totalEpisodes = shared.appState.content.seriesEpisodes[seriesId][season].length;
    shared.DOM.seriesPlayerModal.querySelector(`#prev-btn-${seriesId}`).disabled = (episodeIndex === 0);
    shared.DOM.seriesPlayerModal.querySelector(`#next-btn-${seriesId}`).disabled = (episodeIndex === totalEpisodes - 1);
}

function changeLanguage(seriesId, lang) {
    shared.appState.player.state[seriesId].lang = lang;
    const { season, episodeIndex } = shared.appState.player.state[seriesId];
    openEpisode(seriesId, season, episodeIndex); // Recargar con nuevo idioma
}

// ===========================================================
// 6. REPRODUCTOR DE PELÍCULAS
// ===========================================================

export function openPlayerModal(movieId, movieTitle) {
    shared.closeAllModals();
    // Guardar en historial inmediatamente (para películas es más simple)
    shared.addToHistoryIfLoggedIn(movieId, 'movie');

    const movieData = shared.appState.content.movies[movieId];
    if (!movieData) {
        console.error(`Película no encontrada: ${movieId}`);
        shared.ErrorHandler.show(shared.ErrorHandler.types.CONTENT, 'No se pudo cargar la película.');
        return;
    }

    const hasSpanish = !!(movieData.videoId_es && movieData.videoId_es.trim());
    const hasEnglish = !!(movieData.videoId_en && movieData.videoId_en.trim());
    const hasMultipleLangs = hasSpanish && hasEnglish;
    
    let defaultLang, initialVideoId;

    if (hasEnglish) {
        defaultLang = 'en';
        initialVideoId = movieData.videoId_en;
    } else if (hasSpanish) {
        defaultLang = 'es';
        initialVideoId = movieData.videoId_es
    } else {
        defaultLang = 'default';
        initialVideoId = movieId;
    }

    const iframe = shared.DOM.cinemaModal.querySelector('iframe');
    if (!iframe) {
        console.error('Iframe del reproductor no encontrado');
        return;
    }
    
    iframe.src = `https://drive.google.com/file/d/${initialVideoId}/preview`;

    const titleElement = shared.DOM.cinemaModal.querySelector('#cinema-title');
    if (titleElement) {
        titleElement.textContent = movieTitle || movieData.title || "Película";
    }

    // Configurar controles (Lista y Lenguaje)
    const cinemaControls = shared.DOM.cinemaModal.querySelector('.cinema-controls');
    
    if (cinemaControls) {
        let controlsHTML = '';
        const user = shared.auth.currentUser;
        if (user) {
            const isInList = shared.appState.user.watchlist.has(movieId);
            const iconClass = isInList ? 'fa-check' : 'fa-plus';
            const buttonClass = isInList ? 'btn-watchlist in-list' : 'btn-watchlist';
            controlsHTML += `
                <button class="${buttonClass}" data-content-id="${movieId}">
                    <i class="fas ${iconClass}"></i> Mi Lista
                </button>
            `;
        }

        if (hasMultipleLangs) {
            controlsHTML += `
                <div class="lang-controls-movie">
                    <button class="lang-btn-movie ${defaultLang === 'en' ? 'active' : ''}" 
                            data-lang="en" 
                            data-movie-id="${movieId}"
                            ${!hasEnglish ? 'disabled' : ''}>
                        Original
                    </button>
                    <button class="lang-btn-movie ${defaultLang === 'es' ? 'active' : ''}" 
                            data-lang="es" 
                            data-movie-id="${movieId}"
                            ${!hasSpanish ? 'disabled' : ''}>
                        Español
                    </button>
                </div>
            `;
        }
        cinemaControls.innerHTML = controlsHTML;

        // Listeners para cambio de idioma
        if (hasMultipleLangs) {
            cinemaControls.querySelectorAll('.lang-btn-movie').forEach(btn => {
                btn.addEventListener('click', function() {
                    const selectedLang = this.dataset.lang;
                    const targetMovieId = this.dataset.movieId;
                    const targetMovieData = shared.appState.content.movies[targetMovieId];
                    
                    if (!targetMovieData) return;

                    let newVideoId;
                    if (selectedLang === 'es' && targetMovieData.videoId_es) {
                        newVideoId = targetMovieData.videoId_es;
                    } else if (selectedLang === 'en' && targetMovieData.videoId_en) {
                        newVideoId = targetMovieData.videoId_en;
                    } else {
                        newVideoId = targetMovieId;
                    }

                    const iframe = shared.DOM.cinemaModal.querySelector('iframe');
                    if (iframe) {
                        iframe.src = `https://drive.google.com/file/d/${newVideoId}/preview`;
                    }

                    cinemaControls.querySelectorAll('.lang-btn-movie').forEach(b => 
                        b.classList.remove('active')
                    );
                    this.classList.add('active');
                });
            });
        }
    }

    shared.DOM.cinemaModal.classList.add('show');
    document.body.classList.add('modal-open');
}

// ===========================================================
// 7. FUNCIONES PÚBLICAS AUXILIARES
// ===========================================================

export function playRandomEpisode(seriesId) {
    const episodesData = shared.appState.content.seriesEpisodes[seriesId];
    if (!episodesData) {
        shared.ErrorHandler.show('content', 'No hay episodios disponibles para esta serie.');
        return;
    }

    const allEpisodes = Object.entries(episodesData).flatMap(([seasonKey, episodes]) =>
        episodes.map((ep, index) => ({
            ...ep,
            season: seasonKey,
            index: index
        }))
    );

    if (allEpisodes.length === 0) {
        shared.ErrorHandler.show('content', 'No se encontraron episodios registrados.');
        return;
    }

    const randomEpisode = allEpisodes[Math.floor(Math.random() * allEpisodes.length)];

    if (typeof openPlayerToEpisode === 'function') {
        shared.closeAllModals(); 
        openPlayerToEpisode(seriesId, randomEpisode.season, randomEpisode.index);
    }
}

export function openSeriesPlayerDirectlyToSeason(seriesId, seasonNum) {
    const seriesInfo = shared.appState.content.series[seriesId];
    if (!seriesInfo) return;

    shared.closeAllModals();
    document.body.classList.add('modal-open');
    shared.DOM.seriesPlayerModal.classList.add('show');
    
    renderEpisodePlayer(seriesId, seasonNum);
}

export function openPlayerToEpisode(seriesId, seasonNum, episodeIndex) {
    const seriesInfo = shared.appState.content.series[seriesId];
    if (!seriesInfo) return;
    
    shared.closeAllModals();
    document.body.classList.add('modal-open');
    shared.DOM.seriesPlayerModal.classList.add('show');
    
    renderEpisodePlayer(seriesId, seasonNum, episodeIndex);
}