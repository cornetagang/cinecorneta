// ===========================================================
// MÓDULO DEL REPRODUCTOR (V2 - SOPORTE MULTI-SAGA)
// ===========================================================

import { logError } from '../utils/logger.js'; 

let shared; 

// 1. INICIALIZACIÓN
export function initPlayer(dependencies) {
    shared = dependencies;
}

// 🔥 NUEVO: BUSCADOR INTELIGENTE EN TODAS LAS SAGAS
// Esta función busca el ID en Pelis, Series, Marvel, StarWars, HP, etc.
function findContentData(id) {
    const content = shared.appState.content;

    // 1. Buscar en listas principales
    if (content.movies && content.movies[id]) return content.movies[id];
    if (content.series && content.series[id]) return content.series[id];
    
    // 2. Buscar en UCM (Legacy)
    if (content.ucm && content.ucm[id]) return content.ucm[id];

    // 3. 🔥 BUSCAR EN SAGAS DINÁMICAS (Star Wars, HP, etc.)
    if (content.sagas) {
        for (const sagaKey in content.sagas) {
            const sagaData = content.sagas[sagaKey];
            if (sagaData && sagaData[id]) {
                return sagaData[id];
            }
        }
    }
    return null;
}

// 2. HELPERS
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
        
        const seriesInfo = findContentData(seriesId); 
        
        if (!seriesInfo) {
            console.warn(`Serie ID no encontrado: ${seriesId}`);
            shared.ErrorHandler.show('content', 'No se encontró la serie.');
            return;
        }

        document.body.classList.add('modal-open');
        shared.DOM.seriesPlayerModal.classList.add('show');
        
        shared.DOM.seriesPlayerModal.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
                <div class="spinner"></div>
            </div>`;

        // === 🔥 LÓGICA DE SALTO DE BLOQUEO ===
        const seriesEpisodes = shared.appState.content.seriesEpisodes[seriesId] || {};
        const postersData = shared.appState.content.seasonPosters[seriesId] || {};
        
        // 1. Obtenemos TODAS las temporadas (Episodios + Posters) y las ordenamos
        const allSeasonsKeys = [...new Set([...Object.keys(seriesEpisodes), ...Object.keys(postersData)])];
        
        const seasonsMapped = allSeasonsKeys.map(k => {
            const numMatch = String(k).replace(/\D/g, '');
            const num = numMatch ? parseInt(numMatch, 10) : 0;
            return { key: k, num };
        }).sort((a, b) => a.num - b.num);

        // 2. Si forzamos grilla, mostramos grilla directamente
        if (forceSeasonGrid && seasonsMapped.length > 1) {
            renderSeasonGrid(seriesId);
            return;
        }

        // 3. BUSCAMOS LA PRIMERA TEMPORADA DESBLOQUEADA
        let targetSeasonKey = null;

        for (const s of seasonsMapped) {
            const seasonKey = s.key;
            
            // Verificamos estado en PostersTemporadas
            const posterEntry = postersData[seasonKey];
            let seasonStatus = '';
            if (posterEntry && typeof posterEntry === 'object') {
                seasonStatus = String(posterEntry.estado || '').toLowerCase().trim();
            }

            // Verificamos si tiene episodios reales
            const eps = seriesEpisodes[seasonKey];
            const hasEpisodes = eps && (Array.isArray(eps) ? eps.length > 0 : Object.keys(eps).length > 0);

            // Condición de Bloqueo (Igual que en la grilla)
            const isManuallyLocked = (seasonStatus === 'proximamente' || seasonStatus === 'locked');
            const isLocked = isManuallyLocked || (!hasEpisodes && seasonStatus !== 'disponible');

            // Si NO está bloqueada, ¡esta es la elegida!
            if (!isLocked) {
                targetSeasonKey = seasonKey;
                break; // Rompemos el ciclo, ya encontramos la primera visible
            }
        }

        // 4. RESULTADO
        if (targetSeasonKey) {
            // Reproducimos la temporada encontrada (puede ser la 3 si la 1 y 2 están bloqueadas)
            // Chequeamos historial primero por si el usuario ya iba avanzado en ESA temporada
            const user = shared.auth.currentUser;
            let lastWatchedEpisode = 0;

            if (user) {
                // Pequeña lógica para recuperar donde quedó
                const savedIndex = loadProgress(seriesId, targetSeasonKey);
                if (savedIndex > 0) lastWatchedEpisode = savedIndex;
            }

            renderEpisodePlayer(seriesId, targetSeasonKey, lastWatchedEpisode);
        } else {
            // Si llegamos aquí, es que TODO está bloqueado o no hay nada
            if (seasonsMapped.length > 0) {
                 // Si hay temporadas pero todas bloqueadas, mostramos la grilla para que vea los candados
                renderSeasonGrid(seriesId);
            } else {
                shared.DOM.seriesPlayerModal.innerHTML = `
                    <button class="close-btn">&times;</button>
                    <div style="text-align:center; padding: 20px; color: white;">
                        <h2>${seriesInfo.title}</h2>
                        <p>Próximamente disponible.</p>
                    </div>`;
                shared.DOM.seriesPlayerModal.querySelector('.close-btn').onclick = closeSeriesPlayerModal;
            }
        }

    } catch (error) {
        logError(error, 'Player: Critical Crash');
        shared.ErrorHandler.show('unknown', 'Error al abrir el reproductor de series.');
    }
}

// 4. VISTA DE GRILLA DE TEMPORADAS
function renderSeasonGrid(seriesId) {
    const seriesInfo = findContentData(seriesId); 
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
    
    // Función helper para formatear nombres de temporada
    function formatSeasonName(seasonKey, seasonNum) {
        const keyLower = String(seasonKey).toLowerCase();
        
        // Detectar tipos especiales
        if (keyLower.includes('pelicula') || keyLower.includes('película') || keyLower === 'pelicula') {
            return 'Película';
        }
        if (keyLower.includes('especial') || keyLower === 'especial') {
            return 'Especial';
        }
        if (keyLower.includes('ova') || keyLower === 'ova') {
            return 'OVA';
        }
        if (keyLower.includes('movie') || keyLower === 'movie') {
            return 'Película';
        }
        if (keyLower.includes('special') || keyLower === 'special') {
            return 'Especial';
        }
        
        // Si es un número, mostrar "Temporada X"
        return `Temporada ${seasonNum}`;
    }
    
    // Obtenemos datos usando 'shared'
    const episodesData = shared.appState.content.seriesEpisodes[seriesId] || {};
    const postersData = shared.appState.content.seasonPosters[seriesId] || {};
    
    // 🔴 ERROR ANTERIOR: Solo buscaba en la lista de series normal
    // const seriesInfo = shared.appState.content.series[seriesId]; 

    // 🟢 CORRECCIÓN: Usamos el buscador inteligente que busca en Sagas también
    const seriesInfo = findContentData(seriesId); 
    
    // Seguridad extra: Si por alguna razón no lo encuentra, salimos para no romper la app
    if (!seriesInfo) {
        console.error("No se encontró info para la serie:", seriesId);
        return;
    }

    if (!container) return;

    container.innerHTML = '';

    // 1. Unir temporadas de Episodios + Temporadas de Posters
    const episodeSeasons = Object.keys(episodesData);
    const posterSeasons = Object.keys(postersData);
    const allSeasons = [...new Set([...episodeSeasons, ...posterSeasons])];

    const seasonsMapped = allSeasons.map(k => {
        const numMatch = String(k).replace(/\D/g, '');
        const num = numMatch ? parseInt(numMatch, 10) : 0;
        return { key: k, num };
    }).sort((a, b) => a.num - b.num);

    seasonsMapped.forEach(({ key: seasonKey, num: seasonNum }) => {
        const rawEpisodes = episodesData[seasonKey];
        const episodes = rawEpisodes ? (Array.isArray(rawEpisodes) ? rawEpisodes : Object.values(rawEpisodes)) : [];
        
        // Datos del Poster (URL, fecha, estado)
        let posterUrl = seriesInfo.poster || '';
        let seasonStatus = ''; 

        const posterEntry = postersData[seasonKey];
        if (posterEntry) {
            if (typeof posterEntry === 'object') {
                posterUrl = posterEntry.posterUrl || posterEntry.poster || posterUrl;
                seasonStatus = String(posterEntry.estado || '').toLowerCase().trim();
            } else {
                posterUrl = posterEntry;
            }
        }
        
        const totalEpisodes = episodes.length;

        // 🔥 BLOQUEO: Si dice "proximamente" O si no hay episodios cargados
        const isManuallyLocked = (seasonStatus === 'proximamente' || seasonStatus === 'locked');
        const isEmpty = (totalEpisodes === 0);
        const isLocked = isManuallyLocked || (isEmpty && seasonStatus !== 'disponible');

        // Renderizado de la tarjeta
        const card = document.createElement('div');
        card.className = `season-poster-card ${isLocked ? 'locked' : ''}`;
        
        card.onclick = () => {
            if (isLocked) {
                shared.ErrorHandler.show('content', 'Temporada no disponible aún.');
            } else {
                // Asegúrate de que esta función esté disponible en el ámbito
                // Si da error, usa window.renderEpisodePlayer o expórtala
                // En tu estructura actual, está definida abajo en este mismo archivo, así que está bien.
                renderEpisodePlayer(seriesId, seasonKey);
            }
        };

        const overlayText = isLocked ? "PRÓXIMAMENTE" : (formatSeasonName(seasonKey, seasonNum).includes("Temporada") ? `${totalEpisodes} episodios` : "");

        card.innerHTML = `
            <img src="${posterUrl}" alt="Temporada ${seasonNum}">
            <div class="overlay">
                <h3>${formatSeasonName(seasonKey, seasonNum)}</h3>
                <p>${overlayText}</p>
            </div>
        `;
        container.appendChild(card);
    });
}

// 5. REPRODUCTOR DE EPISODIOS (CON DETECTOR DE IDIOMA INTELIGENTE)
async function renderEpisodePlayer(seriesId, seasonNum, startAtIndex = null) {
    try {
        shared.appState.player.activeSeriesId = seriesId;
        const savedEpisodeIndex = loadProgress(seriesId, seasonNum);
        const initialEpisodeIndex = startAtIndex !== null ? startAtIndex : savedEpisodeIndex;
        
        // Obtener episodios para analizar idiomas
        const episodes = shared.appState.content.seriesEpisodes[seriesId]?.[seasonNum] || [];
        const firstEpisode = episodes[0];
        
        if (!firstEpisode) {
            console.error("No hay episodios para renderizar.");
            return;
        }

        // --- 🧠 LÓGICA DE IDIOMAS MEJORADA ---
        // 1. Verificamos qué existe realmente
        const hasSpanish = !!(firstEpisode.videoId_es && firstEpisode.videoId_es.trim());
        const hasOriginal = !!((firstEpisode.videoId_en && firstEpisode.videoId_en.trim()) || (firstEpisode.videoId && firstEpisode.videoId.trim()));
        
        // 2. Solo mostramos botones si hay DOS opciones reales
        const hasLangOptions = hasSpanish && hasOriginal;

        // 3. Definimos el idioma de arranque
        let initialLang = 'en'; // Por defecto Original
        if (!hasLangOptions && hasSpanish) {
            initialLang = 'es'; // Si solo hay español, forzamos español
        }

        // Inicializar estado con el idioma correcto
        shared.appState.player.state[seriesId] = { 
            season: seasonNum, 
            episodeIndex: initialEpisodeIndex, 
            lang: initialLang 
        };

        // Generar HTML de controles (Solo si hay opciones)
        let langControlsHTML = hasLangOptions 
            ? `<div class="lang-controls">
                 <button class="lang-btn-movie ${initialLang === 'en' ? 'active' : ''}" data-lang="en">Original</button>
                 <button class="lang-btn-movie ${initialLang === 'es' ? 'active' : ''}" data-lang="es">Español</button>
               </div>` 
            : '';
        
        // --- RESTO DE VARIABLES ---
        const seasonLower = String(seasonNum).toLowerCase();
        const isSpecialContent = seasonLower.includes('pelicula') || 
                                seasonLower.includes('película') || 
                                seasonLower.includes('especial') || 
                                seasonLower.includes('ova') || 
                                seasonLower.includes('movie') || 
                                seasonLower.includes('special');
        
        const isSingleMovie = isSpecialContent && episodes.length === 1;

        const postersData = shared.appState.content.seasonPosters[seriesId]?.[seasonNum] || {};
        const seriesInfo = findContentData(seriesId) || {};

        const movieYear = postersData.year || postersData.anio || '';
        const movieDuration = postersData.duration || postersData.duracion || '';
        const movieRequester = postersData.pedido || postersData.pedidoPor || '';
        
        let specificPoster = postersData.poster || postersData.posterUrl;
        if (!specificPoster) specificPoster = seriesInfo.poster; 

        const movieSynopsis = postersData.sinopsis || firstEpisode.description || "Sinopsis no disponible.";
        
        // TÍTULO CORRECTO: Para películas/especiales usar el título del episodio, para series usar el de la serie
        const displayTitle = isSpecialContent && firstEpisode.title 
            ? firstEpisode.title 
            : seriesInfo.title || firstEpisode.title || 'Sin título';
        
        const seasonsCount = Object.keys(shared.appState.content.seriesEpisodes[seriesId] || {}).length;
        const backButtonHTML = seasonsCount > 1 
            ? `<button class="player-back-link back-to-seasons"><i class="fas fa-arrow-left"></i> Temporadas</button>` 
            : '';

        shared.DOM.seriesPlayerModal.className = 'modal show player-layout-view';
        
        // =========================================================
        // MODO A: PELÍCULA / ESPECIAL
        // =========================================================
        if (isSingleMovie) {
            shared.DOM.seriesPlayerModal.innerHTML = `
                <button class="close-btn">&times;</button>
                <div class="player-layout-container movie-mode">
                    <div class="player-container">
                        <div class="screen"><iframe id="video-frame-${seriesId}" src="" allowfullscreen></iframe></div>
                    </div>
                    <div class="movie-info-sidebar">
                        ${backButtonHTML}
                        <div class="sidebar-poster-container">
                            <img src="${specificPoster}" alt="Poster" class="sidebar-poster-img" onerror="this.src='https://via.placeholder.com/150'">
                        </div>
                        <h2 id="cinema-title-${seriesId}" class="player-title">${displayTitle}</h2>
                        <div class="movie-metadata">
                            ${movieRequester ? `<div class="meta-tag request-tag" title="Pedido por ${movieRequester}"><i class="fas fa-user-circle"></i> ${movieRequester}</div>` : ''}
                            ${movieYear ? `<div class="meta-tag"><i class="fas fa-calendar"></i> ${movieYear}</div>` : ''}
                            ${movieDuration ? `<div class="meta-tag"><i class="fas fa-clock"></i> ${movieDuration}</div>` : ''}
                        </div>
                        <div class="movie-synopsis-container"><p>${movieSynopsis}</p></div>
                        ${langControlsHTML}
                        <button id="btn-review-player-${seriesId}" class="btn-review-sidebar"><i class="fas fa-pen-nib"></i> Escribir Reseña</button>
                    </div>
                </div>
            `;

        } else {
            // =========================================================
            // MODO B: SERIE NORMAL
            // =========================================================
            shared.DOM.seriesPlayerModal.innerHTML = `
                <button class="close-btn">&times;</button>
                <div class="player-layout-container">
                    <div class="player-container">
                        <h3 class="series-main-title">${seriesInfo.title || 'Serie'}</h3>
                        <h2 id="cinema-title-${seriesId}" class="player-title"></h2>
                        <div class="screen"><iframe id="video-frame-${seriesId}" src="" allowfullscreen></iframe></div>
                        <div class="pagination-controls">
                            <button class="episode-nav-btn" id="prev-btn-${seriesId}"><i class="fas fa-chevron-left"></i> Anterior</button>
                            ${langControlsHTML} <button class="episode-nav-btn" id="next-btn-${seriesId}">Siguiente <i class="fas fa-chevron-right"></i></button>
                        </div>
                    </div>
                    <div class="episode-sidebar">
                        <div class="sidebar-header"> ${backButtonHTML} <h2>Episodios</h2> </div>
                        <div id="episode-list-${seriesId}" class="episode-list-container"></div>
                    </div>
                </div>
            `;
            
            const prevBtn = shared.DOM.seriesPlayerModal.querySelector(`#prev-btn-${seriesId}`);
            const nextBtn = shared.DOM.seriesPlayerModal.querySelector(`#next-btn-${seriesId}`);
            if(prevBtn) prevBtn.onclick = () => navigateEpisode(seriesId, -1);
            if(nextBtn) nextBtn.onclick = () => navigateEpisode(seriesId, 1);
        }

        // LISTENERS COMUNES
        shared.DOM.seriesPlayerModal.querySelector('.close-btn').onclick = closeSeriesPlayerModal;
        
        shared.DOM.seriesPlayerModal.querySelectorAll(`.lang-btn-movie`).forEach(btn => {
            btn.onclick = () => {
                // Actualizar visualmente botones activos
                shared.DOM.seriesPlayerModal.querySelectorAll('.lang-btn-movie').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                changeLanguage(seriesId, btn.dataset.lang);
            };
        });
        
        const backButton = shared.DOM.seriesPlayerModal.querySelector('.player-back-link.back-to-seasons');
        if (backButton) backButton.onclick = () => renderSeasonGrid(seriesId);
        
        
        
        // BOTÓN DE RESEÑA (solo en modo película)
        const reviewBtn = shared.DOM.seriesPlayerModal.querySelector(`#btn-review-player-${seriesId}`);
        if (reviewBtn) {
            reviewBtn.onclick = () => {
                // Verificar si hay usuario logueado
                if (!shared.auth.currentUser) {
                    shared.ErrorHandler.show('auth', 'Debes iniciar sesión para escribir una reseña.');
                    return;
                }
                
                // Determinar el título correcto basado en el tipo de contenido
                let correctTitle = '';
                let correctId = seriesId;
                
                if (isSpecialContent) {
                    // Para películas/especiales: usar el título específico del episodio
                    correctTitle = displayTitle;
                } else {
                    // Para series: usar el título de la serie completa
                    correctTitle = seriesInfo.title || displayTitle;
                }
                
                // Abrir modal PRIMERO
                const reviewModal = document.getElementById('review-form-modal');
                if (!reviewModal) return;
                
                reviewModal.classList.add('show');
                document.body.classList.add('modal-open');
                
                // LUEGO (después de que el modal esté visible) manipular los elementos
                setTimeout(() => {
                    const selectedIdInput = document.getElementById('review-selected-id');
                    const selectedDisplay = document.getElementById('review-selected-display');
                    const selectedTitleSpan = document.getElementById('review-selected-title');
                    const searchInput = document.getElementById('review-movie-search');
                    const searchContainer = searchInput?.parentElement;
                    
                    // Establecer valores
                    if (selectedIdInput) selectedIdInput.value = correctId;
                    if (selectedTitleSpan) selectedTitleSpan.textContent = correctTitle;
                    
                    // MOSTRAR el display bloqueado, OCULTAR búsqueda
                    if (selectedDisplay) {
                        selectedDisplay.style.display = 'flex';
                        // Ocultar el botón X
                        const changeBtn = selectedDisplay.querySelector('.btn-change-selection');
                        if (changeBtn) changeBtn.style.display = 'none';
                    }
                    
                    if (searchContainer) searchContainer.style.display = 'none';
                    if (searchInput) searchInput.value = '';
                    
                    // Resetear formulario
                    const form = document.getElementById('review-submission-form');
                    if (form) {
                        const textarea = form.querySelector('textarea');
                        if (textarea) textarea.value = '';
                    }
                    
                    // Resetear estrellas
                    document.querySelectorAll('.star-option').forEach(s => s.classList.remove('selected'));
                    const ratingValue = document.getElementById('review-rating-value');
                    if (ratingValue) ratingValue.value = '0';
                }, 50); // 50ms de delay para que el DOM se actualice
            };
        }
        if (!isSingleMovie) populateEpisodeList(seriesId, seasonNum);
        
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
    
    // Detectar si es película/especial/OVA para mostrar solo el título
    const seasonLower = String(season).toLowerCase();
    const isSpecialContent = seasonLower.includes('pelicula') || 
                            seasonLower.includes('película') || 
                            seasonLower.includes('especial') || 
                            seasonLower.includes('ova') || 
                            seasonLower.includes('movie') || 
                            seasonLower.includes('special');
    
    if(titleEl) {
        if (isSpecialContent) {
            // Para películas/especiales: solo el título
            titleEl.textContent = episode.title || '';
        } else {
            // Para temporadas normales: formato tradicional
            titleEl.textContent = `T${String(season).replace('T', '')} E${episodeNumber} - ${episode.title || ''}`;
        }
    }
    
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

// 6. REPRODUCTOR DE PELÍCULAS (ACTUALIZADO)
export function openPlayerModal(movieId, movieTitle) {
    try {
        shared.closeAllModals();
        shared.addToHistoryIfLoggedIn(movieId, 'movie');

        // 🔥 USAMOS EL BUSCADOR INTELIGENTE
        const movieData = findContentData(movieId);

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
            initialVideoId = movieId; // Algunos IDs son directamente el videoID
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
                        
                        // 🔥 USAMOS EL BUSCADOR INTELIGENTE TAMBIÉN AQUÍ
                        const targetMovieData = findContentData(targetMovieId);
                        
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
    const seriesInfo = findContentData(seriesId); 
    if (!seriesInfo) return;

    shared.closeAllModals();
    document.body.classList.add('modal-open');
    shared.DOM.seriesPlayerModal.classList.add('show');
    
    renderEpisodePlayer(seriesId, seasonNum);
}

export function openPlayerToEpisode(seriesId, seasonNum, episodeIndex) {
    const seriesInfo = findContentData(seriesId);
    if (!seriesInfo) return;
    
    shared.closeAllModals();
    document.body.classList.add('modal-open');
    shared.DOM.seriesPlayerModal.classList.add('show');
    
    renderEpisodePlayer(seriesId, seasonNum, episodeIndex);
}

/**
 * Función simplificada para reproducir un episodio específico
 * @param {string} seriesId - ID de la serie
 * @param {string} seasonNum - Número/clave de temporada
 * @param {string|number} episodeNum - Número del episodio (1-indexed en la hoja)
 */
export function playEpisode(seriesId, seasonNum, episodeNum) {
    // Los episodios en el array son 0-indexed, pero en la hoja son 1-indexed
    const episodeIndex = parseInt(episodeNum) - 1;
    openPlayerToEpisode(seriesId, seasonNum, episodeIndex);
}
