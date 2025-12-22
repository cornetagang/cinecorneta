// ===========================================================
// MÓDULO DEL REPRODUCTOR (CON LOGS Y SEGURIDAD)
// ===========================================================

import { logError } from './logger.js'; // Importamos el logger

let shared; // Dependencias compartidas

// 1. INICIALIZACIÓN
export function initPlayer(dependencies) {
    shared = dependencies;
}

// 2. HELPERS (BUSCADOR UNIVERSAL)
function getSeriesData(seriesId) {
    return shared.appState.content.series[seriesId] || 
           (shared.appState.content.ucm ? shared.appState.content.ucm[seriesId] : null);
}

function saveProgress(seriesId) {
    try {
        let allProgress = JSON.parse(localStorage.getItem('seriesProgress')) || {};
        if (!allProgress[seriesId]) allProgress[seriesId] = {};
        const currentState = shared.appState.player.state[seriesId];
        allProgress[seriesId][currentState.season] = currentState.episodeIndex;
        localStorage.setItem('seriesProgress', JSON.stringify(allProgress));
    } catch (e) {
        logError(e, 'Player: Save Progress', 'warning');
    }
}

function loadProgress(seriesId, seasonNum) {
    try {
        const allProgress = JSON.parse(localStorage.getItem('seriesProgress'));
        return allProgress?.[seriesId]?.[seasonNum] || 0;
    } catch (e) { return 0; }
}

// 3. GESTIÓN DEL MODAL DE SERIES
export function commitAndClearPendingSave() {
    if (shared.appState.player.pendingHistorySave) {
        try {
            shared.addToHistoryIfLoggedIn(
                shared.appState.player.pendingHistorySave.contentId,
                shared.appState.player.pendingHistorySave.type,
                shared.appState.player.pendingHistorySave.episodeInfo
            );
        } catch (e) {
            logError(e, 'Player: History Commit');
        }
        shared.appState.player.pendingHistorySave = null;
    }
}

export function closeSeriesPlayerModal() {
    clearTimeout(shared.appState.player.episodeOpenTimer);
    commitAndClearPendingSave();
    shared.DOM.seriesPlayerModal.classList.remove('show', 'season-grid-view', 'player-layout-view');
    document.body.classList.remove('modal-open');
    const iframe = shared.DOM.seriesPlayerModal.querySelector('iframe');
    if (iframe) iframe.src = '';
    shared.appState.player.activeSeriesId = null; 
}

export async function openSeriesPlayer(seriesId, forceSeasonGrid = false) {
    try {
        shared.closeAllModals();
        
        const seriesInfo = getSeriesData(seriesId); 
        
        if (!seriesInfo) {
            logError(`Serie ID no encontrado: ${seriesId}`, 'Player: Open Series', 'warning');
            shared.ErrorHandler.show(shared.ErrorHandler.types.CONTENT, 'No se encontró la serie.');
            return;
        }

        document.body.classList.add('modal-open');
        shared.DOM.seriesPlayerModal.classList.add('show');
        
        shared.DOM.seriesPlayerModal.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
                <div class="spinner"></div>
            </div>`;

        const seriesEpisodes = shared.appState.content.seriesEpisodes[seriesId] || {};
        const seasons = Object.keys(seriesEpisodes);

        if (forceSeasonGrid && seasons.length > 1) {
            renderSeasonGrid(seriesId);
            return;
        }

        if (seasons.length === 0) {
            shared.DOM.seriesPlayerModal.innerHTML = `
                <button class="close-btn">&times;</button>
                <div style="text-align:center; padding: 20px; color: white;">
                    <h2>${seriesInfo.title}</h2>
                    <p>No hay episodios disponibles por el momento.</p>
                </div>`;
            shared.DOM.seriesPlayerModal.querySelector('.close-btn').onclick = closeSeriesPlayerModal;
            return;
        }

        const user = shared.auth.currentUser;
        let lastWatched = null;

        if (user) {
            try {
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
                        lastWatched = userHistoryForThisSeries.pop();
                    }
                }
            } catch (dbError) {
                logError(dbError, 'Player: Fetch History');
            }
        }

        if (lastWatched) {
            renderEpisodePlayer(seriesId, lastWatched.season, lastWatched.lastEpisode);
        } else {
            const seasonsMapped = seasons.map(k => {
                const numMatch = String(k).replace(/\D/g, '');
                const num = numMatch ? parseInt(numMatch, 10) : 0;
                return { key: k, num };
            }).sort((a, b) => a.num - b.num);

            const firstSeasonKey = seasonsMapped.length > 0 ? seasonsMapped[0].key : seasons[0];
            renderEpisodePlayer(seriesId, firstSeasonKey, 0);
        }
    } catch (error) {
        logError(error, 'Player: Critical Crash');
        shared.ErrorHandler.show('unknown', 'Error al abrir el reproductor de series.');
    }
}

// 4. VISTA DE GRILLA DE TEMPORADAS
function renderSeasonGrid(seriesId) {
    const seriesInfo = getSeriesData(seriesId); 
    if (!seriesInfo) return;

    shared.DOM.seriesPlayerModal.className = 'modal show season-grid-view';
    
    shared.DOM.seriesPlayerModal.innerHTML = `
        <button class="close-btn">&times;</button>
        <div class="season-grid-container">
            <h2 class="player-title">${seriesInfo.title}</h2>
            <div id="season-grid" class="season-grid"></div>
        </div>
    `;
    
    shared.DOM.seriesPlayerModal.querySelector('.close-btn').onclick = closeSeriesPlayerModal;
    populateSeasonGrid(seriesId);
    shared.appState.player.activeSeriesId = null;
}

function populateSeasonGrid(seriesId) {
    const container = shared.DOM.seriesPlayerModal.querySelector('#season-grid');
    const data = shared.appState.content.seriesEpisodes[seriesId];
    const seriesInfo = getSeriesData(seriesId);
    
    if (!container || !data) return;

    container.innerHTML = '';

    const seasonKeys = Object.keys(data);
    const seasonsMapped = seasonKeys.map(k => {
        const numMatch = String(k).replace(/\D/g, '');
        const num = numMatch ? parseInt(numMatch, 10) : 0;
        return { key: k, num };
    }).sort((a, b) => a.num - b.num);

    let columns = (seasonsMapped.length <= 5) ? seasonsMapped.length : Math.ceil(seasonsMapped.length / 2);
    container.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;

    seasonsMapped.forEach(({ key: seasonKey, num: seasonNum }) => {
        const episodes = Array.isArray(data[seasonKey]) ? data[seasonKey] : Object.values(data[seasonKey] || {});
        const posterUrl = shared.appState.content.seasonPosters[seriesId]?.[seasonKey] || seriesInfo.poster || '';
        const totalEpisodes = episodes.length;

        const lastWatchedIndex = loadProgress(seriesId, seasonKey);
        const watchedEpisodes = lastWatchedIndex > 0 ? lastWatchedIndex + 1 : 0;
        const progressPercent = totalEpisodes > 0 ? Math.round((watchedEpisodes / totalEpisodes) * 100) : 0;

        let progressHTML = '';
        if (progressPercent > 0 && progressPercent < 100) {
            progressHTML = `<div class="progress-bar"><div style="width: ${progressPercent}%"></div></div>`;
        } else if (progressPercent === 100) {
            progressHTML = `<div class="progress-bar complete"><div style="width: 100%"></div></div>`;
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

// 5. REPRODUCTOR DE EPISODIOS
async function renderEpisodePlayer(seriesId, seasonNum, startAtIndex = null) {
    try {
        shared.appState.player.activeSeriesId = seriesId;
        const savedEpisodeIndex = loadProgress(seriesId, seasonNum);
        const initialEpisodeIndex = startAtIndex !== null ? startAtIndex : savedEpisodeIndex;
        
        shared.appState.player.state[seriesId] = { season: seasonNum, episodeIndex: initialEpisodeIndex, lang: 'en' };
        
        const firstEpisode = shared.appState.content.seriesEpisodes[seriesId]?.[seasonNum]?.[0];
        const hasLangOptions = firstEpisode?.videoId_es?.trim();
        
        let langControlsHTML = hasLangOptions 
            ? `<div class="lang-controls">
                 <button class="lang-btn active" data-lang="en">Original</button>
                 <button class="lang-btn" data-lang="es">Español</button>
               </div>` 
            : '';
        
        const seasonsCount = Object.keys(shared.appState.content.seriesEpisodes[seriesId] || {}).length;
        const backButtonHTML = seasonsCount > 1 
            ? `<button class="player-back-link back-to-seasons"><i class="fas fa-arrow-left"></i> Temporadas</button>` 
            : '';

        shared.DOM.seriesPlayerModal.className = 'modal show player-layout-view';
        
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

        shared.DOM.seriesPlayerModal.querySelector('.close-btn').onclick = closeSeriesPlayerModal;
        shared.DOM.seriesPlayerModal.querySelector(`#prev-btn-${seriesId}`).onclick = () => navigateEpisode(seriesId, -1);
        shared.DOM.seriesPlayerModal.querySelector(`#next-btn-${seriesId}`).onclick = () => navigateEpisode(seriesId, 1);
        
        shared.DOM.seriesPlayerModal.querySelectorAll(`.lang-btn`).forEach(btn => {
            btn.onclick = () => changeLanguage(seriesId, btn.dataset.lang);
        });
        
        const backButton = shared.DOM.seriesPlayerModal.querySelector('.player-back-link.back-to-seasons');
        if (backButton) backButton.onclick = () => renderSeasonGrid(seriesId);
        
        populateEpisodeList(seriesId, seasonNum);
        openEpisode(seriesId, seasonNum, initialEpisodeIndex);
    } catch (e) {
        logError(e, 'Player: Render Episode');
        shared.ErrorHandler.show('content', 'Error al cargar el episodio.');
    }
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
    });
}

function openEpisode(seriesId, season, newEpisodeIndex) {
    const episode = shared.appState.content.seriesEpisodes[seriesId]?.[season]?.[newEpisodeIndex];
    if (!episode) return;
    
    clearTimeout(shared.appState.player.episodeOpenTimer);
    shared.appState.player.pendingHistorySave = null;

    shared.appState.player.episodeOpenTimer = setTimeout(() => {
        shared.appState.player.pendingHistorySave = {
            contentId: seriesId,
            type: 'series',
            episodeInfo: { season: season, index: newEpisodeIndex, title: episode.title || '' }
        };
    }, 20000); 

    shared.DOM.seriesPlayerModal.querySelectorAll(`.episode-card.active`).forEach(c => c.classList.remove('active'));
    const activeCard = shared.DOM.seriesPlayerModal.querySelector(`#episode-card-${seriesId}-${season}-${newEpisodeIndex}`);
    if (activeCard) {
        activeCard.classList.add('active');
        activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    shared.appState.player.state[seriesId] = { ...shared.appState.player.state[seriesId], season, episodeIndex: newEpisodeIndex };
    saveProgress(seriesId);
    
    const iframe = shared.DOM.seriesPlayerModal.querySelector(`#video-frame-${seriesId}`);
    const lang = shared.appState.player.state[seriesId]?.lang || 'es';
    
    let videoId;
    if (lang === 'en' && episode.videoId_en) videoId = episode.videoId_en;
    else if (lang === 'es' && episode.videoId_es) videoId = episode.videoId_es;
    else videoId = episode.videoId;

    if (iframe) iframe.src = videoId ? `https://drive.google.com/file/d/${videoId}/preview` : '';
    
    const episodeNumber = episode.episodeNumber || newEpisodeIndex + 1;
    const titleEl = shared.DOM.seriesPlayerModal.querySelector(`#cinema-title-${seriesId}`);
    if(titleEl) titleEl.textContent = `T${String(season).replace('T', '')} E${episodeNumber} - ${episode.title || ''}`;
    
    shared.DOM.seriesPlayerModal.querySelectorAll(`.lang-btn`).forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });
    
    updateNavButtons(seriesId, season, newEpisodeIndex);
}

function navigateEpisode(seriesId, direction) {
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
    const prevBtn = shared.DOM.seriesPlayerModal.querySelector(`#prev-btn-${seriesId}`);
    const nextBtn = shared.DOM.seriesPlayerModal.querySelector(`#next-btn-${seriesId}`);
    
    if(prevBtn) prevBtn.disabled = (episodeIndex === 0);
    if(nextBtn) nextBtn.disabled = (episodeIndex === totalEpisodes - 1);
}

function changeLanguage(seriesId, lang) {
    shared.appState.player.state[seriesId].lang = lang;
    const { season, episodeIndex } = shared.appState.player.state[seriesId];
    openEpisode(seriesId, season, episodeIndex);
}

// 6. REPRODUCTOR DE PELÍCULAS
export function openPlayerModal(movieId, movieTitle) {
    try {
        shared.closeAllModals();
        shared.addToHistoryIfLoggedIn(movieId, 'movie');

        // Búsqueda Universal para películas (incluye UCM)
        const movieData = shared.appState.content.movies[movieId] || 
                          (shared.appState.content.ucm ? shared.appState.content.ucm[movieId] : null);

        if (!movieData) {
            logError(`Película no encontrada: ${movieId}`, 'Player: Open Movie', 'warning');
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
        if (!iframe) return;
        
        iframe.src = `https://drive.google.com/file/d/${initialVideoId}/preview`;

        const titleElement = shared.DOM.cinemaModal.querySelector('#cinema-title');
        if (titleElement) titleElement.textContent = movieTitle || movieData.title || "Película";

        const cinemaControls = shared.DOM.cinemaModal.querySelector('.cinema-controls');
        if (cinemaControls) {
            let controlsHTML = '';
            const user = shared.auth.currentUser;
            if (user) {
                const isInList = shared.appState.user.watchlist.has(movieId);
                const iconClass = isInList ? 'fa-check' : 'fa-plus';
                const buttonClass = isInList ? 'btn-watchlist in-list' : 'btn-watchlist';
                controlsHTML += `<button class="${buttonClass}" data-content-id="${movieId}"><i class="fas ${iconClass}"></i> Mi Lista</button>`;
            }

            if (hasMultipleLangs) {
                controlsHTML += `
                    <div class="lang-controls-movie">
                        <button class="lang-btn-movie ${defaultLang === 'en' ? 'active' : ''}" data-lang="en" data-movie-id="${movieId}" ${!hasEnglish ? 'disabled' : ''}>Original</button>
                        <button class="lang-btn-movie ${defaultLang === 'es' ? 'active' : ''}" data-lang="es" data-movie-id="${movieId}" ${!hasSpanish ? 'disabled' : ''}>Español</button>
                    </div>`;
            }
            cinemaControls.innerHTML = controlsHTML;

            if (hasMultipleLangs) {
                cinemaControls.querySelectorAll('.lang-btn-movie').forEach(btn => {
                    btn.addEventListener('click', function() {
                        const selectedLang = this.dataset.lang;
                        const targetMovieId = this.dataset.movieId;
                        
                        const targetMovieData = shared.appState.content.movies[targetMovieId] || 
                                                (shared.appState.content.ucm ? shared.appState.content.ucm[targetMovieId] : null);
                        if (!targetMovieData) return;

                        let newVideoId;
                        if (selectedLang === 'es' && targetMovieData.videoId_es) newVideoId = targetMovieData.videoId_es;
                        else if (selectedLang === 'en' && targetMovieData.videoId_en) newVideoId = targetMovieData.videoId_en;
                        else newVideoId = targetMovieId;

                        const iframe = shared.DOM.cinemaModal.querySelector('iframe');
                        if (iframe) iframe.src = `https://drive.google.com/file/d/${newVideoId}/preview`;

                        cinemaControls.querySelectorAll('.lang-btn-movie').forEach(b => b.classList.remove('active'));
                        this.classList.add('active');
                    });
                });
            }
        }

        shared.DOM.cinemaModal.classList.add('show');
        document.body.classList.add('modal-open');
    } catch (e) {
        logError(e, 'Player: Open Modal');
        shared.ErrorHandler.show('unknown', 'Error al abrir el reproductor.');
    }
}

// 7. FUNCIONES PÚBLICAS AUXILIARES
export function playRandomEpisode(seriesId) {
    const episodesData = shared.appState.content.seriesEpisodes[seriesId];
    if (!episodesData) {
        shared.ErrorHandler.show('content', 'No hay episodios disponibles para esta serie.');
        return;
    }

    const allEpisodes = Object.entries(episodesData).flatMap(([seasonKey, episodes]) =>
        episodes.map((ep, index) => ({ ...ep, season: seasonKey, index: index }))
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
    const seriesInfo = getSeriesData(seriesId); 
    if (!seriesInfo) return;

    shared.closeAllModals();
    document.body.classList.add('modal-open');
    shared.DOM.seriesPlayerModal.classList.add('show');
    
    renderEpisodePlayer(seriesId, seasonNum);
}

export function openPlayerToEpisode(seriesId, seasonNum, episodeIndex) {
    const seriesInfo = getSeriesData(seriesId);
    if (!seriesInfo) return;
    
    shared.closeAllModals();
    document.body.classList.add('modal-open');
    shared.DOM.seriesPlayerModal.classList.add('show');
    
    renderEpisodePlayer(seriesId, seasonNum, episodeIndex);
}
