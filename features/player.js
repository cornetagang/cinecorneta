// ===========================================================
// MÓDULO DEL REPRODUCTOR (V2 - SOPORTE MULTI-SAGA)
// ===========================================================

import { logError } from '../utils/logger.js'; 

let shared; 

// 1. INICIALIZACIÓN
export function initPlayer(dependencies) {
    shared = dependencies;
}

// ===========================================================
// 🌐 HELPER: OBTENER TRACKS DE AUDIO DISPONIBLES DINÁMICAMENTE
// Soporta videoId_en, videoId_es, videoId_jp + label desde campo language
// ===========================================================
function getLangTracks(data) {
    // IDs disponibles (en orden: original, alternativo, latino)
    const rawEn = data.videoId_en?.trim() || data.videoId?.trim() || '';
    const rawEs = data.videoId_es?.trim() || '';
    const rawJp = data.videoId_jp?.trim() || data.videoId_alt?.trim() || '';

    // Parsear campo language para obtener etiquetas reales
    // Ejemplo: "Japonés - Latino" o "Inglés;Japonés;Latino"
    const rawLang = (data.language || data.idioma || data.audio || '').trim();
    const langParts = rawLang
        .split(/[-;|]/)
        .map(l => l.trim())
        .filter(Boolean);

    // Clasificar partes: español/latino vs originales
    const SPANISH_LABELS = ['latino', 'español', 'castellano', 'doblado', 'esp'];
    const isSpanish = l => SPANISH_LABELS.some(s => l.toLowerCase().includes(s));

    const spanishLabel = langParts.find(l => isSpanish(l)) || 'Latino';
    const originalLabels = langParts.filter(l => !isSpanish(l));

    const tracks = [];

    if (rawEn) {
        tracks.push({
            id: rawEn,
            lang: 'en',
            label: originalLabels[0] || 'Original',
        });
    }
    if (rawJp) {
        tracks.push({
            id: rawJp,
            lang: 'jp',
            label: originalLabels[1] || 'Alt',
        });
    }
    if (rawEs) {
        tracks.push({
            id: rawEs,
            lang: 'es',
            label: spanishLabel,
        });
    }

    return tracks;
}


// ===========================================================
// 🎬 HELPER: CONSTRUIR URL DE EMBED SEGÚN PROVEEDOR
// Detecta automáticamente Google Drive vs Streamtape por el formato del ID.
// - Google Drive: empieza con "1" y tiene 25+ caracteres (ej: 1cfLvKRV-hI3LimRY97ptxp3...)
// - Streamtape:   ID corto alfanumérico (ej: mvYbMvV3bXcb864)
// ===========================================================
function getEmbedUrl(videoId) {
    if (!videoId || !videoId.trim()) return '';
    const id = videoId.trim();
    
    // 1. Identificar Google Drive (Empieza por 1 y es largo)
    const isGoogleDrive = id.startsWith('1') && id.length >= 25;
    if (isGoogleDrive) {
        return `https://drive.google.com/file/d/${id}/preview?rm=minimal`;
    }
    
    // 2. Identificar OK.ru (Solo números)
    if (/^\d+$/.test(id)) {
        // Se añade /videoembed/ y el símbolo $ para interpolar el id correctamente
        return `https://ok.ru/videoembed/${id}?nochat=1`;
    }
    
    // 3. Por defecto, asumir Streamtape (o cualquier otro sistema de IDs cortos)
    return `https://streamtape.com/e/${id}/`;
}

function adjustIframeScale() {
    const iframes = document.querySelectorAll('.screen iframe, #video-frame');
    iframes.forEach(iframe => {
        const container = iframe.parentElement;
        const scale = container.offsetWidth / 1280;
        iframe.style.transform = `scale(${scale})`;
        iframe.style.width = '1280px';
        iframe.style.height = `${720 * scale}px`; // ajusta el contenedor también
        container.style.height = `${720 * scale}px`;
    });
}

function buildLangButtonsHTML(tracks, activeLang, cssClass) {
    if (tracks.length <= 1) return '';
    return `<div class="movie-lang-selection">
        ${tracks.map(t => `
            <button class="${cssClass} ${t.lang === activeLang ? 'active' : ''}" data-lang="${t.lang}">
                ${t.label}
            </button>`).join('')}
    </div>`;
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

// ===========================================================
// HELPER: Abrir la página del player (reemplaza el modal)
// ===========================================================
function _openSeriesPlayerPage() {
    const sections = [
        'hero-section', 'carousel-container', 'full-grid-container',
        'my-list-container', 'history-container', 'profile-container',
        'settings-container', 'profile-hub-container', 'sagas-hub-container',
        'reviews-container', 'reports-container', 'filter-controls',
        'live-tv-section', 'iptv-section'
    ];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // Fallback: buscar en el DOM directo si shared.DOM no está listo
    const page = shared.DOM.seriesPlayerModal || document.getElementById('series-player-page');
    if (!page) {
        console.error('[Player] #series-player-page no encontrado en el DOM');
        return;
    }
    // Actualizar la referencia por si acaso
    shared.DOM.seriesPlayerModal = page;

    page.style.display = 'block';
    page.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function closeSeriesPlayerModal() {
    clearTimeout(shared.appState.player.episodeOpenTimer);
    commitAndClearPendingSave();
    const page = shared.DOM.seriesPlayerModal;
    page.classList.remove('active', 'season-grid-view', 'player-layout-view');
    page.style.display = 'none';
    const iframe = page.querySelector('iframe');
    if (iframe) iframe.src = '';
    shared.appState.player.activeSeriesId = null;
    if (shared.switchView) shared.switchView(shared.appState.currentFilter || 'all');
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

        _openSeriesPlayerPage();
        
        shared.DOM.seriesPlayerModal.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
                <div class="spinner"></div>
            </div>`;

        // === 🔥 LÓGICA DE SALTO DE BLOQUEO ===
        const seriesEpisodes = shared.appState.content.seriesEpisodes[seriesId] || {};
        const postersData = shared.appState.content.seasonPosters[seriesId] || {};
        
        // 1. Obtenemos TODAS las temporadas ordenadas
        // PRIORIDAD: seasonOrder servidor > campo "orden" > numérico (especiales al final)
        const allSeasonsKeys = [...new Set([...Object.keys(seriesEpisodes), ...Object.keys(postersData)])];

        let orderedKeys;
        if (shared.appState.content.seasonOrder && shared.appState.content.seasonOrder[seriesId]) {
            orderedKeys = shared.appState.content.seasonOrder[seriesId];
        } else {
            orderedKeys = [...allSeasonsKeys].sort((a, b) => {
                const posterA = postersData[a];
                const posterB = postersData[b];
                const ordenA = posterA && typeof posterA === 'object' && posterA.orden !== undefined && posterA.orden !== ''
                    ? Number(posterA.orden) : null;
                const ordenB = posterB && typeof posterB === 'object' && posterB.orden !== undefined && posterB.orden !== ''
                    ? Number(posterB.orden) : null;
                if (ordenA !== null && ordenB !== null) return ordenA - ordenB;
                if (ordenA !== null) return -1;
                if (ordenB !== null) return 1;
                const isNumericA = !isNaN(Number(a)) && String(a).trim() !== '';
                const isNumericB = !isNaN(Number(b)) && String(b).trim() !== '';
                if (isNumericA && isNumericB) return Number(a) - Number(b);
                if (isNumericA) return -1;
                if (isNumericB) return 1;
                return 0;
            });
        }

        const seasonsMapped = orderedKeys
            .filter(k => allSeasonsKeys.includes(k))
            .map(k => ({ key: k, num: !isNaN(k) ? Number(k) : 0 }));

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
            const isManuallyLocked = seasonStatus !== '' && seasonStatus !== 'disponible';
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
                    <button class="close-btn streaming-back-btn"><i class="fas fa-arrow-left"></i> Volver</button>
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

    shared.DOM.seriesPlayerModal.className = 'series-player-page active season-grid-view';
    
    shared.DOM.seriesPlayerModal.innerHTML = `
        <button class="close-btn streaming-back-btn"><i class="fas fa-arrow-left"></i> Volver</button>
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
    function formatSeasonName(seasonKey, seasonNum, customLabel = null) {
        // 🆕 Si hay etiqueta personalizada en el sheet, usarla directamente
        if (customLabel && customLabel.trim()) return customLabel.trim();

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
    let allSeasons;

    if (shared.appState.content.seasonOrder && shared.appState.content.seasonOrder[seriesId]) {
        // Orden preservado del servidor (respeta campo "orden" del sheet)
        allSeasons = shared.appState.content.seasonOrder[seriesId];
        console.log(`📺 Usando orden del servidor para ${seriesId}:`, allSeasons);
    } else {
        // Fallback: combinar claves de episodios y posters
        const episodeSeasons = Object.keys(episodesData);
        const posterSeasons = Object.keys(postersData);
        allSeasons = [...new Set([...episodeSeasons, ...posterSeasons])];
        console.log(`⚠️ Usando Object.keys() para ${seriesId}:`, allSeasons);
    }

    // Mapear a estructura del grid
    // num: si la clave es numérica usamos ese número, si no (especial, pelicula...) usamos 0
    const seasonsMapped = allSeasons.map((key) => {
        const num = !isNaN(key) ? Number(key) : 0;
        return { key, num };
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
        let seasonStatusRaw = ''; // Valor original sin lowercase
        let seasonCustomLabel = ''; // 🆕 Etiqueta personalizada (ej: "Parte 1/2", "Parte 3"...)

        const posterEntry = postersData[seasonKey];
        if (posterEntry) {
            if (typeof posterEntry === 'object') {
                posterUrl = posterEntry.posterUrl || posterEntry.poster || posterUrl;
                seasonStatusRaw = String(posterEntry.estado || '').trim();
                seasonStatus = seasonStatusRaw.toLowerCase();
                seasonCustomLabel = String(posterEntry.etiqueta || '').trim(); // 🆕
            } else {
                posterUrl = posterEntry;
            }
        }
        
        const totalEpisodes = episodes.length;

        // 🔥 BLOQUEO: cualquier estado no vacío bloquea la temporada
        const isManuallyLocked = seasonStatus !== '' && seasonStatus !== 'disponible';
        const isEmpty = (totalEpisodes === 0);
        const isLocked = isManuallyLocked || (isEmpty && seasonStatus !== 'disponible');

        // 🆕 Calcular el label final una sola vez
        const seasonLabel = formatSeasonName(seasonKey, seasonNum, seasonCustomLabel);

        // Renderizado de la tarjeta
        const card = document.createElement('div');
        card.className = `season-poster-card ${isLocked ? 'locked' : ''} ${seasonStatus === 'mantenimiento' ? 'en-mantenimiento' : ''}`;
        
        card.onclick = () => {
            if (isLocked) {
                shared.ErrorHandler.show('content', 'Temporada no disponible aún.');
            } else {
                renderEpisodePlayer(seriesId, seasonKey);
            }
        };

        // Texto del overlay
        let overlayText = '';
        if (isLocked) {
            if (seasonStatus === 'mantenimiento') {
                overlayText = 'Mantenimiento';
            } else if (seasonStatus === 'proximamente' || seasonStatus === 'próximamente') {
                overlayText = 'PRÓXIMAMENTE';
            } else if (/\d/.test(seasonStatusRaw)) {
                overlayText = `Próx. ${seasonStatusRaw}`;
            } else if (seasonStatusRaw) {
                overlayText = `Próx. en ${seasonStatusRaw}`;
            } else {
                overlayText = 'PRÓXIMAMENTE';
            }
        } else if (!isNaN(seasonKey)) {
            // Mostrar episodios para cualquier temporada numérica (con o sin etiqueta custom)
            overlayText = `${totalEpisodes} episodios`;
        }

        card.innerHTML = `
            <img src="${posterUrl}" alt="${seasonLabel}">
            <div class="overlay">
                <h3>${seasonLabel}</h3>
                <p>${overlayText}</p>
            </div>
        `;
        container.appendChild(card);
    });
}

// 5. REPRODUCTOR DE EPISODIOS (CON DETECTOR DE IDIOMA INTELIGENTE)
export async function renderEpisodePlayer(seriesId, seasonNum, startAtIndex = null) {
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
 
        // --- 🧠 LÓGICA DE IDIOMAS DINÁMICA ---
        const seriesTracks = getLangTracks(firstEpisode);
        const hasLangOptions = seriesTracks.length > 1;
        
        // 🔥 NUEVO: RECUPERAR IDIOMA GUARDADO DEL USUARIO
        let savedLang = null;
        try {
            const prefs = JSON.parse(localStorage.getItem('seriesLangPrefs')) || {};
            savedLang = prefs[seriesId];
        } catch(e) {}

        let initialLang = seriesTracks[0]?.lang || 'en';
        if (!hasLangOptions && seriesTracks[0]?.lang === 'es') initialLang = 'es';
        
        // Si existe el idioma que el usuario prefirió en este capítulo, lo forzamos
        if (savedLang && seriesTracks.some(t => t.lang === savedLang)) {
            initialLang = savedLang;
        }
 
        shared.appState.player.state[seriesId] = { 
            season: seasonNum, 
            episodeIndex: initialEpisodeIndex, 
            lang: initialLang 
        };
 
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
        
        const displayTitle = isSpecialContent && firstEpisode.title 
            ? firstEpisode.title 
            : seriesInfo.title || firstEpisode.title || 'Sin título';
        
        const seasonsCount = Object.keys(shared.appState.content.seriesEpisodes[seriesId] || {}).length;
        const backButtonHTML = seasonsCount > 1 
            ? `<button class="player-back-link back-to-seasons"><i class="fas fa-arrow-left"></i> Temporadas</button>` 
            : '';
 
        shared.DOM.seriesPlayerModal.className = 'series-player-page active player-layout-view';
 
        const finishTime = movieDuration ? calculateFinishTime(movieDuration) : null;
        const endTimeHTML = finishTime
            ? `<span class="meta-tag" style="display:inline-flex;align-items:center;">
                   <i class="fas fa-flag-checkered" style="color:#ff4d4d;"></i>
                   <span style="opacity:0.9;margin-left:5px;">Terminas de ver a las <strong style="color:#fff;">${finishTime}</strong> aprox.</span>
               </span>`
            : '';
 
        // =========================================================
        // MODO A: PELÍCULA / ESPECIAL 
        // =========================================================
        if (isSingleMovie) {
            shared.DOM.seriesPlayerModal.innerHTML = `
                <button class="close-btn streaming-back-btn"><i class="fas fa-arrow-left"></i> Volver</button>
                <div class="player-layout-container movie-mode">
                    <div class="movie-player-container">
                        <h2 id="cinema-title-${seriesId}" class="movie-player-title cinema-title-above">${displayTitle}</h2>
                        <div class="screen"><iframe id="video-frame-${seriesId}" src="" allowfullscreen allow="autoplay; fullscreen; encrypted-media; picture-in-picture"></iframe></div>
                    </div>
                    <div class="movie-info-sidebar">
                        <div class="movie-info-sidebar-inner">
                            ${backButtonHTML}
                            <div class="movie-poster-container">
                                <img src="${specificPoster}" alt="Poster" onerror="this.src='https://via.placeholder.com/150'">
                            </div>
                            <div class="movie-details-info">
                                <div class="movie-meta-info">
                                    ${movieRequester ? `<span class="meta-tag request-tag"><i class="fas fa-user-circle"></i> ${movieRequester}</span>` : ''}
                                    ${movieYear ? `<span class="meta-tag"><i class="fas fa-calendar"></i> ${movieYear}</span>` : ''}
                                    ${movieDuration ? `<span class="meta-tag"><i class="fas fa-clock"></i> ${movieDuration}</span>` : ''}
                                    ${endTimeHTML}
                                </div>
                                <p id="cinema-synopsis-sp" class="movie-synopsis">${movieSynopsis}</p>
                                <div class="cinema-controls-sp">
                                    <button id="btn-review-player-${seriesId}" class="btn btn-review"><i class="fas fa-star"></i> Escribir Reseña</button>
                                    <button class="btn btn-report-sp"><i class="fas fa-flag"></i> Reportar problema</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
 
        } else {
            // =========================================================
            // MODO B: SERIE NORMAL — NUEVO LAYOUT EDGE-TO-EDGE
            // =========================================================
 
            // 🔥 NUEVO: Dropdown de idioma CUSTOM (Cero estilos feos del navegador)
            let langDropdown = '';
            if (hasLangOptions) {
                const currentLangLabel = seriesTracks.find(t => t.lang === initialLang)?.label || 'Original';
                
                const optionsHtml = seriesTracks.map(t => `
                    <div class="cc-lang-option" data-lang="${t.lang}" style="padding: 10px 15px; cursor: pointer; color: ${t.lang === initialLang ? '#fff' : '#aaa'}; background: ${t.lang === initialLang ? '#e50914' : 'transparent'}; font-size: 11px; font-weight: bold; text-transform: uppercase; transition: 0.2s; border-bottom: 1px solid #222;">
                        ${t.label}
                    </div>
                `).join('');

                langDropdown = `
                    <div class="cc-custom-lang-wrapper" style="position: relative; display: inline-block; font-family: 'Montserrat', sans-serif;">
                        <div class="cc-lang-trigger" style="display: inline-flex; align-items: center; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px; padding: 7px 12px; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
                            <i class="fas fa-language" style="color: #e50914; font-size: 14px; margin-right: 8px; pointer-events: none;"></i>
                            <span style="color: #fff; font-size: 12px; font-weight: 700; text-transform: uppercase; padding-right: 10px; letter-spacing: 0.5px; pointer-events: none;">${currentLangLabel}</span>
                            <i class="fas fa-chevron-down" style="font-size: 10px; color: #aaa; pointer-events: none;"></i>
                        </div>
                        <!-- 🔥 AHORA ABRE HACIA ABAJO (top: calc...) -->
                        <div class="cc-lang-menu" style="display: none; position: absolute; top: calc(100% + 5px); right: 0; background: #141414; border: 1px solid #333; border-radius: 8px; overflow: hidden; z-index: 999999; min-width: 130px; box-shadow: 0 10px 25px rgba(0,0,0,0.9);">
                            ${optionsHtml}
                        </div>
                    </div>
                `;
            }

            const mYear = postersData.year || postersData.anio || seriesInfo.year || seriesInfo.anio || '';
            const mReq = postersData.pedido || postersData.pedidoPor || seriesInfo.pedido || seriesInfo.requester || '';
            
            const normStr = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '');
            const rawAltTitle = seriesInfo.secondTitle || seriesId;
            const originalTitle = rawAltTitle && normStr(rawAltTitle) !== normStr(seriesInfo.title || '') ? rawAltTitle : null;

            let genresVal = '';
            if (seriesInfo.genres) {
                genresVal = Array.isArray(seriesInfo.genres) ? seriesInfo.genres.join(', ') : String(seriesInfo.genres).replace(/;/g, ', ');
            }
            const langVal = seriesInfo.language || seriesInfo.idioma || seriesInfo.audio || '';

            const mReqHtml = mReq ? `<span>Pedido por: <span style="color:#fff; font-weight:bold;">${mReq}</span></span><span style="font-size:10px; color:#555; margin:0 4px;">●</span>` : '';
            const mYearHtml = mYear ? `<span>Estreno: <span style="color:#fff; font-weight:bold;">${mYear}</span></span><span style="font-size:10px; color:#555; margin:0 4px;">●</span>` : '';
            const logoTheme = shared.THEMES?.normal?.logo || 'https://res.cloudinary.com/djhgmmdjx/image/upload/v1759209688/vgJjqSM_oicebo.png';

            shared.DOM.seriesPlayerModal.innerHTML = `
                <style>
                    body:has(#series-player-page.active) .bottom-nav { display: none !important; }
                    #series-player-page.player-layout-view {
                        position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
                        display: flex !important; flex-direction: column !important; background-color: #0f0f0f !important;
                        z-index: 99999 !important; padding: 0 !important; margin: 0 !important; 
                        width: 100vw !important; height: 100dvh !important; border-radius: 0 !important; 
                        align-items: stretch !important; overflow: hidden !important;
                        overscroll-behavior: none !important;
                    }
                    #series-player-page .player-top-bar, #series-player-page .player-page-wrapper, #series-player-page .nav-buttons-row { display: none !important; }
                    .cc-top-fixed { flex-shrink: 0; display: flex; flex-direction: column; background-color: #0f0f0f; z-index: 10; transition: box-shadow 0.3s ease; }
                    .cc-top-fixed.scrolled { box-shadow: 0 4px 15px rgba(0,0,0,0.6); border-bottom: 1px solid #222; }
                    .cc-nav { display: flex; align-items: center; justify-content: space-between; padding: 10px 15px; padding-top: calc(10px + env(safe-area-inset-top)); border-bottom: 2px solid #e50914; }
                    .cc-logo { height: 22px; }
                    .cc-back-btn { background: transparent; border: none; color: white; font-size: 0.9rem; font-weight: bold; display: flex; align-items: center; gap: 7px; cursor: pointer; padding: 0; }
                    .cc-video-wrap { width: 100%; background: #000; position: relative; padding-top: 56.25%; height: 0; }
                    .cc-video-wrap iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: none; }
                    .cc-details { padding: 15px; }
                    .cc-title-box { position: relative; cursor: pointer; margin-bottom: 0; user-select: none; -webkit-tap-highlight-color: transparent; }
                    .cc-title { font-size: 1.2rem; font-weight: bold; margin: 0 0 4px 0; color: white; line-height: 1.2;}
                    .cc-subtitle { color: #e50914; font-size: 12px; font-weight: bold; margin-bottom: 4px; display: block; }
                    .cc-toggle { position: absolute; bottom: 2px; right: 0; font-size: 14px; color: #8a8a92; font-weight: 500; background: linear-gradient(90deg, rgba(15,15,15,0) 0%, rgba(15,15,15,1) 25%, rgba(15,15,15,1) 100%); padding-left: 25px; padding-right: 2px; z-index: 2; }
                    .cc-scroll { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; padding: 15px 15px 40px 15px; display: block !important; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
                    .cc-scroll::-webkit-scrollbar { display: none; }
                    .cc-meta { font-size: 12px; color: #8a8a92; margin-bottom: 15px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; line-height: 1.6; border-bottom: 1px solid #222; padding-bottom: 15px; }
                    .cc-expand { display: none; background-color: #181818; border-radius: 12px; padding: 15px; margin-bottom: 20px; }
                    .cc-desc { font-size: 13px; line-height: 1.5; color: white; margin-bottom: 15px; }
                    .cc-controls { display: flex; align-items: center; justify-content: flex-start; gap: 15px; margin: 10px 0 15px 0; flex-wrap: wrap; overflow: visible; }
                    .cc-controls::-webkit-scrollbar { display: none; }
                    .cc-season-btn { display: inline-flex; align-items: center; gap: 8px; font-size: 16px; font-weight: bold; cursor: pointer; padding: 8px; border-radius: 8px; background-color: transparent; color: white; margin-left: -8px; }
                    .cc-langs { display: flex; gap: 8px; flex-wrap: nowrap; margin-left: auto; } /* margin-left auto empuja el dropdown a la derecha suavemente */
                    .cc-card { display: flex !important; gap: 12px !important; margin-bottom: 16px !important; align-items: center !important; padding: 0 !important; background: transparent !important; border: none !important; cursor: pointer; }
                    .cc-thumb { width: 120px !important; height: 67px !important; border-radius: 8px !important; object-fit: cover !important; border: 2px solid transparent !important; flex-shrink: 0; background: #222;}
                    .cc-card.active .cc-thumb { border: 2px solid #e50914 !important; }
                    .cc-info { display: flex !important; flex-direction: column !important; justify-content: center !important; flex: 1 !important; min-width: 0;}
                    .cc-ep-title { font-size: 0.85rem !important; font-weight: bold !important; color: white !important; margin: 0 0 4px 0 !important; line-height: 1.3;}
                    .cc-card.active .cc-ep-title { color: #e50914 !important; }
                    .cc-ep-desc { font-size: 0.75rem !important; color: #8a8a92 !important; display: -webkit-box !important; -webkit-line-clamp: 2 !important; -webkit-box-orient: vertical !important; overflow: hidden !important; margin: 0 !important; line-height: 1.4;}
                    .cc-sheet-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 3000; display: flex; flex-direction: column; justify-content: flex-end; opacity: 0; pointer-events: none; transition: opacity 0.3s ease; }
                    .cc-sheet-overlay.active { opacity: 1; pointer-events: auto; }
                    .cc-sheet { background-color: #181818; border-radius: 20px 20px 0 0; padding: 20px 15px calc(20px + env(safe-area-inset-bottom)); max-height: 75vh; display: flex; flex-direction: column; transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.1, 0.9, 0.2, 1); width: 100%; box-sizing: border-box; }
                    .cc-sheet-overlay.active .cc-sheet { transform: translateY(0); }
                    .cc-sheet-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; font-size: 18px; font-weight: bold; color: white;}
                    .cc-sheet-close { background: transparent; border: none; color: white; font-size: 24px; cursor: pointer; padding: 0;}
                    .cc-sheet-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; overflow-y: auto; padding-bottom: 20px; }
                    .cc-sheet-grid::-webkit-scrollbar { display: none; }
                    .cc-sheet-card { position: relative; border-radius: 8px; overflow: hidden; aspect-ratio: 2/3; cursor: pointer; background-color: #111; border: 2px solid transparent; }
                    .cc-sheet-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
                    .cc-sheet-card .cc-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 60%); display: flex; align-items: flex-end; justify-content: center; padding: 10px; color: white; font-size: 0.8rem; font-weight: bold; text-align: center; }
                    .cc-sheet-card.active-season { border-color: #e50914; }
                </style>

                <div class="cc-top-fixed" id="fixedHeader">
                    <nav class="cc-nav">
                        <img src="${logoTheme}" class="cc-logo">
                        <button class="cc-back-btn streaming-back-btn"><i class="fas fa-times"></i> Cerrar</button>
                    </nav>
                    <div class="cc-video-wrap">
                        <iframe id="video-frame-${seriesId}" src="" allowfullscreen allow="autoplay; fullscreen; encrypted-media; picture-in-picture"></iframe>
                    </div>
                    <div class="cc-details">
                        <div class="cc-title-box" id="toggleDescBtn">
                            <div>
                                <span class="cc-subtitle" id="subTitle">Temporada ${seasonNum}</span>
                                <h1 class="cc-title" id="cinema-title-${seriesId}"></h1>
                            </div>
                            <span class="cc-toggle" id="toggleText">... ver más</span>
                        </div>
                    </div>
                </div>

                <div class="cc-scroll" id="scrollArea">
                    <div class="cc-meta">
                        ${mReqHtml}
                        ${mYearHtml}
                        <span><span style="color:#fff; font-weight:bold;">${seasonsCount}</span> Temporadas</span>
                    </div>

                    <div class="cc-expand" id="expandableArea">
                        <div style="font-size: 12px; color: #ccc; margin-bottom: 15px; display: flex; flex-direction: column; gap: 6px; background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; border-left: 2px solid #e50914;">
                            ${originalTitle ? `<span><i class="fas fa-film" style="color:#8a8a92; width:18px;"></i> ${originalTitle}</span>` : ''}
                            ${genresVal ? `<span><i class="fas fa-tags" style="color:#8a8a92; width:18px;"></i> ${genresVal}</span>` : ''}
                            ${langVal ? `<span><i class="fas fa-language" style="color:#8a8a92; width:18px;"></i> ${langVal}</span>` : ''}
                        </div>

                        <div class="cc-desc" id="episode-desc-${seriesId}"></div>
                        <button class="vab-btn--report" style="background: rgba(229, 9, 20, 0.1); color: #e50914; border: 1px solid rgba(229, 9, 20, 0.3); border-radius: 18px; padding: 8px 16px; font-size: 13px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 6px; width: fit-content;"><i class="fas fa-flag"></i> Reportar problema</button>
                    </div>
                    
                    <div class="cc-controls">
                        <div class="cc-season-btn" id="seasonSelectorBtn">
                            <span id="seasonBtnText">Temporada ${seasonNum}</span>
                            <i class="fas fa-chevron-down"></i>
                        </div>
                        <div class="cc-langs">
                            ${langDropdown}
                        </div>
                    </div>

                    <div id="episode-list-${seriesId}"></div>
                </div>

                <div class="cc-sheet-overlay" id="seasonModalSheet">
                    <div class="cc-sheet" onclick="event.stopPropagation();">
                        <div class="cc-sheet-header">
                            <span>Temporadas</span>
                            <button class="cc-sheet-close" id="closeSeasonSheetBtn">✕</button>
                        </div>
                        <div class="cc-sheet-grid" id="season-grid-sheet-container"></div>
                    </div>
                </div>
            `;
 
            // — Listeners Scroll / Expandir sinopsis —
            const scrollArea    = shared.DOM.seriesPlayerModal.querySelector('#scrollArea');
            const fixedHeader   = shared.DOM.seriesPlayerModal.querySelector('#fixedHeader');
            const toggleText    = shared.DOM.seriesPlayerModal.querySelector('#toggleText');
            const toggleDescBtn = shared.DOM.seriesPlayerModal.querySelector('#toggleDescBtn');
            const expandArea    = shared.DOM.seriesPlayerModal.querySelector('#expandableArea');
 
            if (scrollArea && fixedHeader && toggleText) {
                scrollArea.addEventListener('scroll', () => {
                    if (scrollArea.scrollTop > 10) {
                        toggleText.style.opacity       = '0';
                        toggleText.style.pointerEvents = 'none';
                        fixedHeader.classList.add('scrolled');
                    } else {
                        toggleText.style.opacity       = '1';
                        toggleText.style.pointerEvents = 'auto';
                        fixedHeader.classList.remove('scrolled');
                    }
                });
            }
 
            if (toggleDescBtn && expandArea && toggleText && scrollArea) {
                toggleDescBtn.addEventListener('click', () => {
                    if (expandArea.style.display === 'none' || expandArea.style.display === '') {
                        expandArea.style.display = 'block';
                        toggleText.innerHTML     = 'ocultar';
                        scrollArea.scrollTo({ top: 0, behavior: 'smooth' });
                    } else {
                        expandArea.style.display = 'none';
                        toggleText.innerHTML     = '... ver más';
                    }
                });
            }
 
            // — Bottom Sheet de Temporadas —
            const seasonSelectorBtn        = shared.DOM.seriesPlayerModal.querySelector('#seasonSelectorBtn');
            const seasonModalSheet         = shared.DOM.seriesPlayerModal.querySelector('#seasonModalSheet');
            const closeSeasonSheetBtn      = shared.DOM.seriesPlayerModal.querySelector('#closeSeasonSheetBtn');
            const seasonGridSheetContainer = shared.DOM.seriesPlayerModal.querySelector('#season-grid-sheet-container');
 
            if (seasonSelectorBtn && seasonModalSheet && seasonGridSheetContainer) {
                seasonGridSheetContainer.innerHTML = '';
 
                const seriesEpisodes   = shared.appState.content.seriesEpisodes[seriesId] || {};
                const allSeasonPosters = shared.appState.content.seasonPosters[seriesId]  || {};
                const allSeasonsKeys   = [...new Set([...Object.keys(seriesEpisodes), ...Object.keys(allSeasonPosters)])];
                const orderedKeys      = shared.appState.content.seasonOrder?.[seriesId] || allSeasonsKeys;
                const seasonsMappedSheet = orderedKeys
                    .filter(k => allSeasonsKeys.includes(k))
                    .map(k => ({ key: k, num: !isNaN(k) ? Number(k) : 0 }));
 
                seasonsMappedSheet.forEach(({ key: sKey, num: sNum }) => {
                    const posterEntry = allSeasonPosters[sKey];
                    let posterUrl   = seriesInfo.poster || '';
                    let customLabel = '';
 
                    if (posterEntry && typeof posterEntry === 'object') {
                        posterUrl   = posterEntry.posterUrl || posterEntry.poster || posterUrl;
                        customLabel = posterEntry.etiqueta  || '';
                    } else if (posterEntry) {
                        posterUrl = posterEntry;
                    }
 
                    const sLabel   = customLabel ? customLabel : (sNum === 0 ? 'Especial/Película' : `Temporada ${sNum}`);
                    const isActive = sKey === seasonNum;
 
                    const card = document.createElement('div');
                    card.className = `cc-sheet-card ${isActive ? 'active-season' : ''}`;
                    card.innerHTML = `<img src="${posterUrl}" alt="${sLabel}"><div class="cc-overlay">${sLabel}</div>`;
                    card.addEventListener('click', () => {
                        seasonModalSheet.classList.remove('active');
                        if (scrollArea) scrollArea.style.overflowY = 'auto';
                        if (!isActive) renderEpisodePlayer(seriesId, sKey);
                    });
                    seasonGridSheetContainer.appendChild(card);
                });
 
                seasonSelectorBtn.addEventListener('click', () => {
                    seasonModalSheet.classList.add('active');
                    if (scrollArea) scrollArea.style.overflowY = 'hidden';
                });
                const closeSheet = () => {
                    seasonModalSheet.classList.remove('active');
                    if (scrollArea) scrollArea.style.overflowY = 'auto';
                };
                if (closeSeasonSheetBtn) closeSeasonSheetBtn.addEventListener('click', closeSheet);
                seasonModalSheet.addEventListener('click', closeSheet);
            }
 
            // — Listener Reportar problema (MODO B) —
            const reportBtnB = shared.DOM.seriesPlayerModal.querySelector('.vab-btn--report');
            if (reportBtnB) {
                reportBtnB.addEventListener('click', async () => {
                    try {
                        const rptMod = await import('./features/reports.js');
                        rptMod.openReportModal({ contentId: seriesId, contentTitle: seriesInfo.title, contentType: 'series' });
                    } catch(e) { console.error('Error al abrir reporte:', e); }
                });
            }
        } // fin MODO B
 
        // ── LISTENERS COMUNES ──────────────────
        shared.DOM.seriesPlayerModal.querySelector('.streaming-back-btn').onclick = closeSeriesPlayerModal;
        
        // — Lógica Dropdown Idiomas —
            const langWrapper = shared.DOM.seriesPlayerModal.querySelector('.cc-custom-lang-wrapper');
            if (langWrapper) {
                const trigger = langWrapper.querySelector('.cc-lang-trigger');
                const menu = langWrapper.querySelector('.cc-lang-menu');
                const options = langWrapper.querySelectorAll('.cc-lang-option');

                trigger.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isOpen = menu.style.display === 'block';
                    menu.style.display = isOpen ? 'none' : 'block';
                    trigger.style.borderColor = isOpen ? 'rgba(255, 255, 255, 0.15)' : '#e50914';
                });

                document.addEventListener('click', () => {
                    if (menu.style.display === 'block') {
                        menu.style.display = 'none';
                        trigger.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                    }
                });

                options.forEach(opt => {
                    opt.addEventListener('mouseenter', () => {
                        // Solo aplica hover gris si no es el rojo seleccionado
                        if (opt.style.background !== 'rgb(229, 9, 20)' && opt.style.background !== '#e50914') {
                            opt.style.background = '#2a2a2a';
                        }
                    });
                    opt.addEventListener('mouseleave', () => {
                        if (opt.style.background !== 'rgb(229, 9, 20)' && opt.style.background !== '#e50914') {
                            opt.style.background = 'transparent';
                        }
                    });
                    
                    opt.addEventListener('click', (e) => {
                        e.stopPropagation();
                        menu.style.display = 'none';
                        changeLanguage(seriesId, opt.dataset.lang);
                    });
                });
            }
        
        const backButton = shared.DOM.seriesPlayerModal.querySelector('.player-back-link.back-to-seasons');
        if (backButton) backButton.onclick = () => renderSeasonGrid(seriesId);
 
        // — Botón Reseña (solo modo película) —
        const reviewBtn = shared.DOM.seriesPlayerModal.querySelector(`#btn-review-player-${seriesId}`);
        if (reviewBtn) {
            reviewBtn.onclick = () => {
                let correctTitle = '';
                let correctType  = 'movie';
                if (isSpecialContent || isSingleMovie) {
                    correctTitle = displayTitle;
                    correctType  = 'movie';
                } else {
                    correctTitle = seriesInfo.title || displayTitle;
                    correctType  = 'series';
                }
                if (window.openSmartReviewModal) {
                    window.openSmartReviewModal(seriesId, correctType, correctTitle);
                } else {
                    console.error("La función window.openSmartReviewModal no está definida en script.js");
                }
            };
        }
 
        // — Botón Reportar problema (solo modo película) —
        const reportBtnSp = shared.DOM.seriesPlayerModal.querySelector('.btn-report-sp');
        if (reportBtnSp) {
            reportBtnSp.onclick = async () => {
                try {
                    const rptMod = await import('./features/reports.js');
                    rptMod.openReportModal({ contentId: seriesId, contentTitle: displayTitle, contentType: 'movie' });
                } catch(e) { console.error('Error al abrir reporte:', e); }
            };
        }
 
        // — Ver más / Ver menos en sinopsis de película —
        if (isSingleMovie) {
            const synopsisEl = shared.DOM.seriesPlayerModal.querySelector('#cinema-synopsis-sp');
            if (synopsisEl) {
                requestAnimationFrame(() => {
                    const isClamped = synopsisEl.scrollHeight > synopsisEl.clientHeight + 2;
                    if (isClamped) {
                        const toggleBtn = document.createElement('button');
                        toggleBtn.className   = 'synopsis-toggle-btn';
                        toggleBtn.textContent = 'Leer sinopsis ▾';
                        toggleBtn.onclick = () => {
                            const isExpanded = synopsisEl.classList.toggle('expanded');
                            toggleBtn.textContent = isExpanded ? 'Ver menos ▴' : 'Leer sinopsis ▾';
                        };
                        synopsisEl.insertAdjacentElement('afterend', toggleBtn);
                    }
                });
            }
        }
 
        if (!isSingleMovie) populateEpisodeList(seriesId, seasonNum);
        openEpisode(seriesId, seasonNum, initialEpisodeIndex);
 
    } catch (e) {
        logError(e, 'Player: Render Episode');
        shared.ErrorHandler.show('content', 'Error al cargar el episodio.');
    }
}

export function populateEpisodeList(seriesId, seasonNum) {
    const container = shared.DOM.seriesPlayerModal.querySelector(`#episode-list-${seriesId}`);
    const episodes  = shared.appState.content.seriesEpisodes[seriesId]?.[seasonNum];
    if (!container || !episodes) return;
 
    container.innerHTML = '';
 
    episodes.sort((a, b) => a.episodeNumber - b.episodeNumber).forEach((episode, index) => {
        const card = document.createElement('div');
        card.className = 'cc-card episode-card'; 
        card.id        = `episode-card-${seriesId}-${seasonNum}-${index}`;
        card.addEventListener('click', () => openEpisode(seriesId, seasonNum, index));
 
        const thumbSrc = episode.thumbnail || episode.thumb || episode.image || '';
        const epNum    = String(episode.episodeNumber || index + 1).padStart(2, '0');
        const desc     = episode.description || episode.synopsis || episode.desc || '';
 
        card.innerHTML = `
            ${thumbSrc
                ? `<img class="cc-thumb ep-thumb" src="${thumbSrc}" alt="" loading="lazy" onerror="this.style.display='none'">`
                : `<div class="cc-thumb ep-thumb"></div>`
            }
            <div class="cc-info episode-card-info">
                <h3 class="cc-ep-title ep-title">${epNum}. ${episode.title || ''}</h3>
                ${desc ? `<p class="cc-ep-desc episode-description">${desc}</p>` : ''}
            </div>
        `;
        container.appendChild(card);
    });
}

export function openEpisode(seriesId, season, newEpisodeIndex) {
    const episode = shared.appState.content.seriesEpisodes[seriesId]?.[season]?.[newEpisodeIndex];
    if (!episode) return;
 
    clearTimeout(shared.appState.player.episodeOpenTimer);
    shared.appState.player.pendingHistorySave = null;
 
    shared.appState.player.episodeOpenTimer = setTimeout(() => {
        shared.appState.player.pendingHistorySave = {
            contentId:   seriesId,
            type:        'series',
            episodeInfo: { season, index: newEpisodeIndex, title: episode.title || '' }
        };
    }, 3000);
 
    // — Marcar episodio activo en la lista —
    shared.DOM.seriesPlayerModal.querySelectorAll('.episode-card.active').forEach(c => c.classList.remove('active'));
    const activeCard = shared.DOM.seriesPlayerModal.querySelector(`#episode-card-${seriesId}-${season}-${newEpisodeIndex}`);
    if (activeCard) {
        activeCard.classList.add('active');
        activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
 
    // — Guardar progreso —
    shared.appState.player.state[seriesId] = {
        ...shared.appState.player.state[seriesId],
        season,
        episodeIndex: newEpisodeIndex
    };
    saveProgress(seriesId);
 
    // — Cargar vídeo —
    const iframe = shared.DOM.seriesPlayerModal.querySelector(`#video-frame-${seriesId}`);
    const lang   = shared.appState.player.state[seriesId]?.lang || 'es';
 
    let videoId;
    if      (lang === 'en' && episode.videoId_en)  videoId = episode.videoId_en;
    else if (lang === 'es' && episode.videoId_es)  videoId = episode.videoId_es;
    else if (lang === 'jp' && (episode.videoId_jp || episode.videoId_alt)) videoId = episode.videoId_jp || episode.videoId_alt;
    else videoId = episode.videoId;
 
    if (iframe) iframe.src = getEmbedUrl(videoId);
 
    // — Detectar si es contenido especial —
    const seasonLower = String(season).toLowerCase();
    const isSpecialContent = seasonLower.includes('pelicula')  ||
                             seasonLower.includes('película')  ||
                             seasonLower.includes('especial')  ||
                             seasonLower.includes('ova')       ||
                             seasonLower.includes('movie')     ||
                             seasonLower.includes('special');
 
    const episodeNumber = episode.episodeNumber || newEpisodeIndex + 1;
 
    // — Actualizar títulos —
    const subTitleEl = shared.DOM.seriesPlayerModal.querySelector('#subTitle');
    const titleEl    = shared.DOM.seriesPlayerModal.querySelector(`#cinema-title-${seriesId}`);
    const infoDescEl = shared.DOM.seriesPlayerModal.querySelector(`#episode-desc-${seriesId}`);
 
    const episodeTitleText = episode.title || `Episodio ${episodeNumber}`;
    const subTitleText     = isSpecialContent
        ? 'Especial / Película'
        : `Temporada ${String(season).replace('T', '')} | Ep ${episodeNumber}`;
 
    if (subTitleEl)  subTitleEl.textContent = subTitleText;
    if (titleEl)     titleEl.textContent    = episodeTitleText;
    if (infoDescEl)  infoDescEl.innerHTML   =
        `<strong>Sinopsis:</strong><br><br>${
            episode.description || episode.synopsis || episode.desc
            || 'No hay descripción disponible para este episodio.'
        }`;
 
    // 🔥 Sincronizar el Dropdown Custom de Idioma visualmente —
    const langWrapper = shared.DOM.seriesPlayerModal.querySelector('.cc-custom-lang-wrapper');
    if (langWrapper) {
        const triggerSpan = langWrapper.querySelector('.cc-lang-trigger span');
        const options = langWrapper.querySelectorAll('.cc-lang-option');
        
        options.forEach(opt => {
            if (opt.dataset.lang === lang) {
                // Marcar como activo (fondo rojo, texto blanco)
                opt.style.background = '#e50914';
                opt.style.color = '#fff';
                opt.classList.add('active');
                // Actualizar el texto del botón principal
                if (triggerSpan) triggerSpan.textContent = opt.textContent.trim();
            } else {
                // Desmarcar los demás
                opt.style.background = 'transparent';
                opt.style.color = '#aaa';
                opt.classList.remove('active');
            }
        });
    }
 
    // — Auto-scroll al inicio en móvil al cambiar de episodio —
    const scrollAreaEp = shared.DOM.seriesPlayerModal.querySelector('#scrollArea');
    if (scrollAreaEp && window.innerWidth <= 768) {
        scrollAreaEp.scrollTo({ top: 0, behavior: 'smooth' });
    }
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
    
    // 🔥 NUEVO: GUARDAR LA ELECCIÓN EN LA MEMORIA DEL NAVEGADOR
    try {
        let prefs = JSON.parse(localStorage.getItem('seriesLangPrefs')) || {};
        prefs[seriesId] = lang;
        localStorage.setItem('seriesLangPrefs', JSON.stringify(prefs));
    } catch(e) { console.warn("No se pudo guardar el idioma"); }

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

        // 🚫 VERIFICAR SI LA PELÍCULA ESTÁ VETADA
        if (movieData.estado && movieData.estado.toLowerCase() === 'vetada') {
            console.warn('⚠️ Intento de reproducir película vetada:', movieId);
            shared.ErrorHandler.show(
                shared.ErrorHandler.types.CONTENT, 
                'Esta película no está disponible para reproducción.'
            );
            return; // Bloquear completamente la reproducción
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

        // 5. CONFIGURAR BOTONES DE IDIOMA (DINÁMICO)
        const tracks = getLangTracks(movieData);
        const langSelection = shared.DOM.cinemaModal.querySelector('.movie-lang-selection');
        const langContainer = langSelection?.parentNode;

        if (langSelection) langSelection.remove(); // limpiar anterior

        const iframe = shared.DOM.cinemaModal.querySelector('iframe');
        if (iframe) iframe.src = '';

        if (tracks.length === 0) {
            // Sin video registrado
        } else if (tracks.length === 1) {
            // Un solo idioma: carga automática sin botones
            loadMovieInPlayer(tracks[0].id, movieId, movieData);
        } else {
            // Múltiples idiomas: botones dinámicos
            const defaultTrack = tracks[0];
            loadMovieInPlayer(defaultTrack.id, movieId, movieData);

            const buttonsHTML = buildLangButtonsHTML(tracks, defaultTrack.lang, 'lang-select-btn');
            const wrapper = shared.DOM.cinemaModal.querySelector('.screen')?.parentNode;
            if (wrapper) {
                const div = document.createElement('div');
                div.className = 'movie-lang-selection';
                div.innerHTML = tracks.map(t => `
                    <button class="lang-select-btn ${t.lang === defaultTrack.lang ? 'active' : ''}" data-lang="${t.lang}">
                        ${t.label}
                    </button>`).join('');
                wrapper.appendChild(div);

                div.querySelectorAll('.lang-select-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        div.querySelectorAll('.lang-select-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        const track = tracks.find(t => t.lang === btn.dataset.lang);
                        if (track) loadMovieInPlayer(track.id, movieId, movieData);
                    });
                });
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

    // Cargar video (el timer ya fue iniciado desde el botón "Ver ahora" en detalles)
    iframe.src = getEmbedUrl(videoId);
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
    _openSeriesPlayerPage();
    renderEpisodePlayer(seriesId, seasonNum);
}

export function openPlayerToEpisode(seriesId, seasonNum, episodeIndex) {
    const seriesInfo = findContentData(seriesId);
    if (!seriesInfo) return;
    
    shared.closeAllModals();
    _openSeriesPlayerPage();
    renderEpisodePlayer(seriesId, seasonNum, episodeIndex);
}

/**
 * Función simplificada para reproducir un episodio específico
 * @param {string} seriesId - ID de la serie
 * @param {string} seasonNum - Número/clave de temporada
 * @param {string|number} episodeNum - Número del episodio (1-indexed en la hoja)
 */
// NOTA: Esta función está obsoleta. Usa openPlayerToEpisode() en su lugar.
// Mantenida aquí por compatibilidad pero no debe usarse.
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
        iframe.src = getEmbedUrl(rawUrl);
    }

    // 5. Marcar visualmente el episodio activo en la lista
    highlightCurrentEpisode(seasonKey, episodeIndex);

    // 🔥 AÑADIR ESTO AL FINAL: GUARDADO AUTOMÁTICO 🔥
    // Esto asegura que apenas cargue el video, se guarde en "Continuar Viendo"
    if (shared.addToHistoryIfLoggedIn && typeof shared.addToHistoryIfLoggedIn === 'function') {
        shared.addToHistoryIfLoggedIn(seriesId, 'series', {
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
