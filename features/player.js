// ===========================================================
// MÓDULO DEL REPRODUCTOR (V2 - SOPORTE MULTI-SAGA)
// ===========================================================

import { logError } from '../utils/logger.js'; 

let shared; 

// ===========================================================
// 🔥 CONFIGURACIÓN DE ORDEN MANUAL DE TEMPORADAS
// ===========================================================
// Para series donde las películas/especiales deben ir en posiciones específicas
// que no siguen el orden alfanumérico de JavaScript
const SEASON_ORDER_OVERRIDES = {
    'jujutsu': ['pelicula', '1', '2', '3'],
    // Agregar más series aquí según sea necesario:
    // 'initialD': ['1', '2', 'pelicula', '4', '5'],
};

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
    const seriesInfo = findContentData(seriesId); 
    
    // Seguridad extra: Si por alguna razón no lo encuentra, salimos para no romper la app
    if (!seriesInfo) {
        console.error("No se encontró info para la serie:", seriesId);
        return;
    }

    if (!container) return;

    container.innerHTML = '';

    // 1. Obtener temporadas con el orden correcto
    // 🔥 PRIORIDAD: Override manual > Orden preservado > Object.keys()
    let allSeasons;
    
    if (SEASON_ORDER_OVERRIDES[seriesId]) {
        // MÁXIMA PRIORIDAD: Orden manual hardcodeado
        allSeasons = SEASON_ORDER_OVERRIDES[seriesId];
        console.log(`🎯 Usando orden MANUAL para ${seriesId}:`, allSeasons);
    } else if (shared.appState.content.seasonOrder && shared.appState.content.seasonOrder[seriesId]) {
        // Segunda opción: Orden preservado del servidor
        allSeasons = shared.appState.content.seasonOrder[seriesId];
        console.log(`📺 Usando orden preservado para ${seriesId}:`, allSeasons);
    } else {
        // Fallback: combinar claves de episodios y posters
        const episodeSeasons = Object.keys(episodesData);
        const posterSeasons = Object.keys(postersData);
        allSeasons = [...new Set([...episodeSeasons, ...posterSeasons])];
        console.log(`⚠️ Usando Object.keys() para ${seriesId}:`, allSeasons);
    }

    // Mapear a estructura del grid
    const seasonsMapped = allSeasons.map((key, index) => {
        return { 
            key: key,           // Clave original ("pelicula", "1", "2"...)
            num: index + 1      // Número secuencial para layout
        };
    });

    const totalSeasons = seasonsMapped.length;

    // ============================================
    // 🔥 LÓGICA INTELIGENTE DE LAYOUT (JAVASCRIPT)
    // ============================================
    let columns = 5; // Default: máximo 5 columnas
    
    if (totalSeasons <= 5) {
        // 1-5 temporadas: todas en una fila
        columns = totalSeasons;
    } else if (totalSeasons === 6) {
        // 6 temporadas: 2 filas de 3
        columns = 3;
    } else if (totalSeasons === 7 || totalSeasons === 8) {
        // 7-8 temporadas: 2 filas de 4
        columns = 4;
    } else {
        // 9+ temporadas: máximo 5 por fila
        columns = 5;
    }

    // Aplicar layout calculado directamente al grid
    container.style.gridTemplateColumns = `repeat(${columns}, 200px)`;
    container.style.justifyContent = 'center';
    container.style.maxWidth = `${columns * 200 + (columns - 1) * 20}px`; // columnas × ancho + gaps

    // ============================================
    // RENDERIZAR TARJETAS
    // ============================================
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
                // 1. Determinar el título correcto
                // Si es modo película (isSingleMovie), usamos el título del episodio/película.
                // Si es serie normal, usamos el título de la serie.
                let correctTitle = '';
                let correctType = 'movie'; // Por defecto movie si es Gladiador II

                if (isSpecialContent || isSingleMovie) {
                    correctTitle = displayTitle; // Título específico (ej: "Gladiador II")
                    correctType = 'movie';       // Tratamos como película para reseñas
                } else {
                    correctTitle = seriesInfo.title || displayTitle;
                    correctType = 'series';
                }
                
                // 2. LLAMAR A LA FUNCIÓN GLOBAL QUE CREAMOS EN EL PASO 1
                if (window.openSmartReviewModal) {
                    window.openSmartReviewModal(seriesId, correctType, correctTitle);
                } else {
                    console.error("La función window.openSmartReviewModal no está definida en script.js");
                }
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
    }, 3000); // 🔥 CORREGIDO: 3 segundos en lugar de 20 

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

// 6. REPRODUCTOR DE PELÍCULAS (FORMATO COMPLETO CON INFORMACIÓN CORRECTA)
export function openPlayerModal(movieId, movieTitle) {
    try {
        shared.closeAllModals();
        
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
        
        // Mostrar modal
        shared.DOM.cinemaModal.classList.add('show');
        document.body.classList.add('modal-open');

        // 1. ACTUALIZAR POSTER (de la columna "poster" de la misma hoja)
        const posterImg = shared.DOM.cinemaModal.querySelector('#cinema-poster');
        if (posterImg) {
            posterImg.src = movieData.poster || movieData.image || '';
            posterImg.alt = movieData.title || 'Poster';
        }

        // 2. ACTUALIZAR TÍTULO
        const titleElement = shared.DOM.cinemaModal.querySelector('#cinema-title');
        if (titleElement) {
            titleElement.textContent = movieTitle || movieData.title || "Película";
        }

        // 3. ACTUALIZAR META INFORMACIÓN - ORDEN: Pedido, Año, Duración
        const requesterEl = shared.DOM.cinemaModal.querySelector('#cinema-requester');
        const yearEl = shared.DOM.cinemaModal.querySelector('#cinema-year');
        const durationEl = shared.DOM.cinemaModal.querySelector('#cinema-duration');

        // 1. Solicitante (de la columna "pedido") - PRIMERO
        if (requesterEl) {
            requesterEl.textContent = movieData.pedido || movieData.requester || 'Anónimo';
            requesterEl.style.display = (movieData.pedido || movieData.requester) ? 'inline-flex' : 'none';
        }

        // 2. Año - SEGUNDO
        if (yearEl) {
            // Buscamos en 'year' O en 'anio' y quitamos espacios vacíos
            const finalYear = (movieData.year || movieData.anio || '').toString().trim();
            
            if (finalYear.length > 0) {
                yearEl.textContent = finalYear;
                yearEl.style.display = 'inline-flex';
            } else {
                // Si no hay año real, ocultamos TODO (incluido el icono)
                yearEl.style.display = 'none';
            }
        }

        // 3. Duración (de la columna "duration") - TERCERO
        if (durationEl) {
            durationEl.textContent = movieData.duration || 'Duration';
            durationEl.style.display = 'inline-flex';
        }

        // 🔥 4. NUEVO: HORA DE TÉRMINO CALCULADA (MEJORADA)
        let endTimeEl = shared.DOM.cinemaModal.querySelector('#cinema-endtime');
        const metaContainer = shared.DOM.cinemaModal.querySelector('.movie-meta-info');

        if (movieData.duration) {
            const finishTime = calculateFinishTime(movieData.duration);
            
            if (finishTime) {
                if (!endTimeEl && metaContainer) {
                    endTimeEl = document.createElement('div'); // Usamos div o span
                    endTimeEl.id = 'cinema-endtime';
                    
                    if (durationEl && durationEl.nextSibling) {
                        metaContainer.insertBefore(endTimeEl, durationEl.nextSibling);
                    } else {
                        metaContainer.appendChild(endTimeEl);
                    }
                }
                
                // --- ESTILO Y CONTENIDO MEJORADO ---
                if (endTimeEl) {
                    // 1. Aplicamos la clase para que se vea como una "cajita" igual al resto
                    endTimeEl.className = 'meta-tag'; 
                    
                    // 2. Formato: Icono rojo + Texto claro + Hora en negrita
                    endTimeEl.innerHTML = `
                        <i class="fas fa-flag-checkered" style="color:#ff4d4d;"></i> 
                        <span style="opacity: 0.9; margin-left: 5px;">Terminas de ver a las <strong style="color: #fff;">${finishTime}</strong> aprox.</span>
                    `;
                    
                    endTimeEl.style.display = 'inline-flex';
                    endTimeEl.style.alignItems = 'center';
                }
            }
        } else {
            if (endTimeEl) endTimeEl.style.display = 'none';
        }

        // 4.5 ACTUALIZAR SINOPSIS (de la columna "synopsis")
        const synopsisEl = shared.DOM.cinemaModal.querySelector('#cinema-synopsis');
        if (synopsisEl) {
            synopsisEl.textContent = movieData.synopsis || 'Sin sinopsis disponible.';
        }

        // 5. CONFIGURAR BOTONES DE IDIOMA
        const langSelection = shared.DOM.cinemaModal.querySelector('.movie-lang-selection');
        const originalBtn = shared.DOM.cinemaModal.querySelector('[data-lang="original"]');
        const spanishBtn = shared.DOM.cinemaModal.querySelector('[data-lang="spanish"]');
        
        if (langSelection && originalBtn && spanishBtn) {
            // 🔥 CORRECCIÓN: Si no hay elección múltiple, OCULTAMOS los botones
            langSelection.style.display = hasMultipleLangs ? 'flex' : 'none';

            // Resetear estados visuales
            originalBtn.classList.remove('active');
            spanishBtn.classList.remove('active');
            
            // Limpiar iframe inicialmente
            const iframe = shared.DOM.cinemaModal.querySelector('iframe');
            if (iframe) iframe.src = '';
            
            // Configurar disponibilidad (por si acaso se muestran)
            originalBtn.disabled = !hasEnglish;
            spanishBtn.disabled = !hasSpanish;
            
            // Lógica de carga
            if (!hasMultipleLangs) {
                // CASO 1: UN SOLO IDIOMA (Botones ocultos, carga automática)
                if (hasEnglish) {
                    originalBtn.classList.add('active'); // Marcamos internamente
                    loadMovieInPlayer(movieData.videoId_en, movieId, movieData);
                } else if (hasSpanish) {
                    spanishBtn.classList.add('active'); // Marcamos internamente
                    loadMovieInPlayer(movieData.videoId_es, movieId, movieData);
                } else {
                    // Fallback extremo
                    originalBtn.classList.add('active');
                    loadMovieInPlayer(movieId, movieId, movieData);
                }
            } else {
                // CASO 2: AMBOS IDIOMAS (Botones visibles, carga automática del original)
                originalBtn.classList.add('active');
                
                // Cargar Original por defecto
                loadMovieInPlayer(movieData.videoId_en, movieId, movieData);
                
                // Listeners para cambiar
                originalBtn.onclick = () => {
                    if (hasEnglish) {
                        originalBtn.classList.add('active');
                        spanishBtn.classList.remove('active');
                        loadMovieInPlayer(movieData.videoId_en, movieId, movieData);
                    }
                };
                
                spanishBtn.onclick = () => {
                    if (hasSpanish) {
                        spanishBtn.classList.add('active');
                        originalBtn.classList.remove('active');
                        loadMovieInPlayer(movieData.videoId_es, movieId, movieData);
                    }
                };
            }
        }

        // 6. CONFIGURAR CONTROLES ADICIONALES (Mi Lista + Reseñas)
        setupMovieControls(movieId, movieData);

    } catch (e) {
        logError(e, 'Player: Open Modal');
        shared.ErrorHandler.show('unknown', 'Error al abrir el reproductor.');
    }
}

// Helper para cargar la película en el reproductor
function loadMovieInPlayer(videoId, movieId, movieData) {
    const iframe = shared.DOM.cinemaModal.querySelector('iframe');
    if (!iframe) return;
    
    // Cargar video
    iframe.src = `https://drive.google.com/file/d/${videoId}/preview`;
    
    // Registrar en historial
    shared.addToHistoryIfLoggedIn(movieId, 'movie');
}

// Helper para configurar controles adicionales (Mi Lista + Reseñas)
function setupMovieControls(movieId, movieData) {
    const cinemaControls = shared.DOM.cinemaModal.querySelector('.cinema-controls');
    if (!cinemaControls) return;
    
    let controlsHTML = '';
    const user = shared.auth.currentUser;
    
    // Botón "Mi Lista" (solo si está logueado)
    if (user) {
        const isInList = shared.appState.user.watchlist.has(movieId);
        const iconClass = isInList ? 'fa-check' : 'fa-plus';
        const buttonClass = isInList ? 'btn-watchlist in-list' : 'btn-watchlist';
        controlsHTML += `
            <button class="${buttonClass}" data-content-id="${movieId}">
                <i class="fas ${iconClass}"></i> 
                ${isInList ? 'En Mi Lista' : 'Agregar a Mi Lista'}
            </button>
        `;
    }
    
    // Botón "Escribir Reseña" (siempre visible)
    controlsHTML += `
        <button class="btn-review" data-content-id="${movieId}" data-type="movie">
            <i class="fas fa-star"></i> 
            Escribir Reseña
        </button>
    `;
    
    cinemaControls.innerHTML = controlsHTML;
    
    // Event listener para el botón de reseñas
    const reviewBtn = cinemaControls.querySelector('.btn-review');
    if (reviewBtn) {
        reviewBtn.addEventListener('click', () => {
            // 🔥 CORRECCIÓN: Usar la función global window.openSmartReviewModal
            if (typeof window.openSmartReviewModal === 'function') {
                window.openSmartReviewModal(movieId, 'movie', movieData.title);
            } else {
                console.error("Error: window.openSmartReviewModal no está definida en script.js");
            }
        });
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
function playEpisode(seriesId, seasonKey, episodeIndex) {
    // 1. Validar que existan los datos
    const allEpisodes = shared.appState.content.seriesEpisodes[seriesId];
    if (!allEpisodes || !allEpisodes[seasonKey] || !allEpisodes[seasonKey][episodeIndex]) {
        console.error('Episodio no encontrado');
        return;
    }

    const episode = allEpisodes[seasonKey][episodeIndex];
    
    // 2. Actualizar variables de estado (para saber dónde estamos)
    state.currentSeriesId = seriesId;
    state.currentSeason = seasonKey;
    state.currentEpisodeIndex = episodeIndex;

    // 3. Actualizar la interfaz (Título, descripción, botones)
    updatePlayerUI(episode, seasonKey, episodeIndex, allEpisodes[seasonKey].length);

    // 4. Cargar el iframe del video
    const iframe = document.getElementById('series-iframe');
    if (iframe) {
        // Usar la URL directa o buscar en servidor si es necesario
        iframe.src = episode.videoUrl || episode.url; 
    }

    // 5. Marcar visualmente el episodio activo en la lista
    highlightCurrentEpisode(seasonKey, episodeIndex);

    // 🔥 AÑADIR ESTO AL FINAL: GUARDADO AUTOMÁTICO 🔥
    // Esto asegura que apenas cargue el video, se guarde en "Continuar Viendo"
    if (shared.appState && typeof shared.appState.addToHistoryIfLoggedIn === 'function') {
        shared.appState.addToHistoryIfLoggedIn(seriesId, 'series', {
            season: seasonKey,
            index: episodeIndex,
            title: episode.title
        });
        console.log(`✅ Historial actualizado: ${episode.title}`);
    }
}

// ==========================================
// HELPER: CALCULAR HORA DE TÉRMINO (V2 INTELIGENTE)
// ==========================================
function calculateFinishTime(durationStr) {
    if (!durationStr) return null;
    
    let hours = 0, minutes = 0, seconds = 0;
    
    // Limpieza básica
    durationStr = durationStr.toString().trim();

    // Caso 1: Formato con dos puntos (ej: "58:20" o "2:30:00")
    if (durationStr.includes(':')) {
        const parts = durationStr.split(':').map(Number);
        
        if (parts.length === 3) {
            // Formato H:MM:SS
            [hours, minutes, seconds] = parts;
        } else if (parts.length === 2) {
            // AMBIGÜEDAD: ¿H:MM o M:SS?
            // 🔥 CORRECCIÓN: Si el primer número es > 7, asumimos que son MINUTOS.
            // (Ej: "58:20" son 58 min, no 58 horas)
            if (parts[0] > 7) {
                [minutes, seconds] = parts; 
            } else {
                [hours, minutes] = parts;
            }
        }
    } 
    // Caso 2: Texto (ej: "2h 15m" o "90 min")
    else {
        const hMatch = durationStr.match(/(\d+)\s*h/);
        const mMatch = durationStr.match(/(\d+)\s*m/);
        if (hMatch) hours = parseInt(hMatch[1]);
        if (mMatch) minutes = parseInt(mMatch[1]);
        
        if (!hMatch && !mMatch && durationStr.includes('min')) {
            const minOnly = parseInt(durationStr);
            if (!isNaN(minOnly)) minutes = minOnly;
        }
    }

    // Calcular fecha final
    const now = new Date();
    const durationMs = (hours * 3600000) + (minutes * 60000) + (seconds * 1000);
    const endTime = new Date(now.getTime() + durationMs);

    return endTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}
