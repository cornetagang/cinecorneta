// ===========================================================
// MÓDULO DE RESEÑAS (REVIEWS)
// ===========================================================
// Versión: 3.0
// Fecha: 1 de Marzo 2026
// ===========================================================

let appState, DOM, auth, db, ErrorHandler, ModalManager, openConfirmationModal;

// Contexto local del módulo (no contamina window)
let reviewContext = {
    contentId: null,
    contentTitle: null,
    contentType: null,
    isPreselected: false
};

// ===========================================================
// INICIALIZACIÓN
// ===========================================================
let isInitialized = false;

export function initReviews(dependencies) {
    // Actualizar dependencias siempre (por si cambia el usuario)
    appState = dependencies.appState;
    DOM = dependencies.DOM;
    auth = dependencies.auth;
    db = dependencies.db;
    ErrorHandler = dependencies.ErrorHandler;
    ModalManager = dependencies.ModalManager;
    openConfirmationModal = dependencies.openConfirmationModal;

    // Solo registrar listeners una vez para evitar duplicados
    if (isInitialized) return;
    isInitialized = true;

    console.log('⭐ Módulo de Reseñas Inicializado');

    // Configurar listeners
    setupEventListeners();
    
    // Configurar listener de ratings (promedios)
    setupRatingsListener();
    
    // Inicializar averages si no existe
    if (!appState.content.averages) {
        appState.content.averages = {};
    }
}

// ===========================================================
// EVENT LISTENERS
// ===========================================================
function setupEventListeners() {
    // 1. Botón principal "Escribir Reseña"
    if (DOM.openReviewBtn) {
        DOM.openReviewBtn.onclick = () => {
            if (!auth.currentUser) {
                openConfirmationModal(
                    "Inicia Sesión", 
                    "Necesitas una cuenta para escribir reseñas.", 
                    () => {
                        if (window.openAuthModal) window.openAuthModal(true);
                    }
                );
                return;
            }
            openReviewModal(false); // Modo normal
        };
    }

    // 2. Formulario de envío
    if (DOM.reviewForm) {
        // Clonamos para evitar múltiples listeners
        const newForm = DOM.reviewForm.cloneNode(true);
        DOM.reviewForm.parentNode.replaceChild(newForm, DOM.reviewForm);
        DOM.reviewForm = newForm;
        
        newForm.onsubmit = handleReviewSubmit;
    }

    // 3. Buscador de películas dentro del modal
    setupMovieSearchBox();

    // 4. Estrellas interactivas
    setupStarRating();
}

// ===========================================================
// UI: ABRIR MODAL DE RESEÑA
// ===========================================================
export function openReviewModal(isContextual = false, contextData = null) {
    const reviewModal = document.getElementById('review-form-modal');
    if (!reviewModal) return;

    // Resetear formulario
    resetReviewForm();

    if (isContextual && contextData) {
        // MODO CONTEXTUAL: Desde botón "Dejar Reseña" en modal de detalles
        reviewContext = { ...contextData, isPreselected: true };
        console.log('📝 Modo Contextual:', reviewContext);
        setupContextualUI(true);
    } else {
        // MODO NORMAL: Desde botón flotante o menú
        reviewContext = { 
            contentId: null, 
            contentTitle: null, 
            contentType: null, 
            isPreselected: false 
        };
        console.log('📝 Modo Normal');
        setupContextualUI(false);
        loadAllContentOptions();
    }

    // Mostrar modal
    reviewModal.classList.add('show');
    document.body.classList.add('modal-open');
}

// Exponer globalmente para usar desde inline onclick
window.openReviewModal = openReviewModal;

// ===========================================================
// UI: CONFIGURAR INTERFAZ SEGÚN MODO
// ===========================================================
function setupContextualUI(isPreselected) {
    const inputContainer = document.querySelector('.custom-select-input-container');
    const selectedDisplay = document.getElementById('review-selected-display');
    const selectedTitle = document.getElementById('review-selected-title');
    const searchInput = document.getElementById('review-movie-search');
    const hiddenInput = document.getElementById('review-selected-id');
    const changeBtnEl = document.querySelector('.btn-change-selection');
    
    // 🔥 NUEVO: Selector del tipo de contenido (Para el fix de IDs duplicados)
    const contentTypeInput = document.getElementById('review-content-type');

    if (isPreselected) {
        // MODO 1: PRE-SELECCIONADO (Vengo desde el botón "Reseñar")
        // Ocultar buscador y mostrar título fijo
        if (inputContainer) inputContainer.style.display = 'none';
        if (selectedDisplay) selectedDisplay.style.display = 'block';
        
        if (selectedTitle) selectedTitle.textContent = reviewContext.contentTitle;
        if (hiddenInput) hiddenInput.value = reviewContext.contentId;
        if (searchInput) searchInput.value = reviewContext.contentTitle;
        
        // 🔥 NUEVO: Llenar el tipo (ej: 'series' o 'movie')
        if (contentTypeInput) {
            contentTypeInput.value = reviewContext.contentType || 'movie';
            console.log(`📝 Contexto establecido: ${reviewContext.contentTitle} (${contentTypeInput.value})`);
        }

        // Configurar botón "Cambiar" (el texto pequeño)
        if (changeBtnEl) {
            changeBtnEl.onclick = () => {
                reviewContext.isPreselected = false;
                setupContextualUI(false); // Volver a modo normal
                loadAllContentOptions();  // Cargar lista para buscar manualmente
            };
        }

    } else {
        // MODO 2: NORMAL (Buscador manual)
        // Mostrar buscador y ocultar título fijo
        if (inputContainer) inputContainer.style.display = 'block';
        if (selectedDisplay) selectedDisplay.style.display = 'none';
        
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }
        if (hiddenInput) hiddenInput.value = '';
        
        // 🔥 NUEVO: Limpiar el tipo para evitar datos basura
        if (contentTypeInput) contentTypeInput.value = '';
    }
}

// ===========================================================
// UI: SISTEMA DE ESTRELLAS
// ===========================================================
function buildStarHalfHTML(val) {
    // Devuelve HTML de estrella según valor: 0=vacía, 0.5=media, 1=llena
    if (val >= 1)  return '<i class="fas fa-star"></i>';
    if (val >= 0.5) return '<i class="fas fa-star-half-alt"></i>';
    return '<i class="far fa-star"></i>';
}

function renderStarsFromValue(value) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
        const diff = value - (i - 1);
        html += buildStarHalfHTML(diff);
    }
    return html;
}

function setupStarRating() {
    const container = document.getElementById('star-rating-input');
    const ratingInput = document.getElementById('review-rating-value');
    const ratingLabel = document.getElementById('review-rating-label');
    if (!container || !ratingInput) return;

    // Construir 5 wrappers, cada uno con mitad izquierda y mitad derecha
    container.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
        const wrapper = document.createElement('span');
        wrapper.className = 'star-wrapper';
        wrapper.style.cssText = 'position:relative; display:inline-block; cursor:pointer; color:#f5c518;';
        wrapper.innerHTML = '<i class="far fa-star star-icon" style="font-size:2rem; pointer-events:none;"></i>';

        // Mitad izquierda → valor i - 0.5
        const leftHalf = document.createElement('span');
        leftHalf.className = 'star-half-zone';
        leftHalf.dataset.value = (i - 0.5).toFixed(1);
        leftHalf.style.cssText = 'position:absolute; left:0; top:0; width:50%; height:100%; z-index:1;';

        // Mitad derecha → valor i
        const rightHalf = document.createElement('span');
        rightHalf.className = 'star-half-zone';
        rightHalf.dataset.value = i.toFixed(1);
        rightHalf.style.cssText = 'position:absolute; right:0; top:0; width:50%; height:100%; z-index:1;';

        wrapper.appendChild(leftHalf);
        wrapper.appendChild(rightHalf);
        container.appendChild(wrapper);
    }

    // Hover preview
    container.addEventListener('mouseover', (e) => {
        const zone = e.target.closest('.star-half-zone');
        if (zone) updateStarVisuals(parseFloat(zone.dataset.value), true);
    });
    container.addEventListener('mouseleave', () => {
        const current = parseFloat(ratingInput.value) || 0;
        updateStarVisuals(current, false);
    });

    // Click → fijar valor
    container.addEventListener('click', (e) => {
        const zone = e.target.closest('.star-half-zone');
        if (!zone) return;
        const val = parseFloat(zone.dataset.value);
        ratingInput.value = val;
        updateStarVisuals(val, false);
        if (ratingLabel) ratingLabel.textContent = `${val}/5`;
    });
}

function updateStarVisuals(value, isHover = false) {
    const wrappers = document.querySelectorAll('.star-wrapper');
    wrappers.forEach((wrapper, index) => {
        const icon = wrapper.querySelector('.star-icon');
        if (!icon) return;
        const diff = value - index; // cuánto "rellena" esta estrella
        icon.className = 'star-icon';
        icon.style.cssText = 'font-size:2rem; pointer-events:none;';
        if (diff >= 1) {
            icon.classList.add('fas', 'fa-star');
        } else if (diff >= 0.5) {
            icon.classList.add('fas', 'fa-star-half-alt');
        } else {
            icon.classList.add('far', 'fa-star');
        }
        if (isHover) {
            icon.style.opacity = '0.85';
        }
    });
}

function resetReviewForm() {
    if (DOM.reviewForm) DOM.reviewForm.reset();
    
    const ratingInput = document.getElementById('review-rating-value');
    const hiddenInput = document.getElementById('review-selected-id');
    const textInput = document.getElementById('review-text-input');
    const ratingLabel = document.getElementById('review-rating-label');
    
    if (ratingInput) ratingInput.value = '0';
    if (hiddenInput) hiddenInput.value = '';
    if (textInput) textInput.value = '';
    if (ratingLabel) ratingLabel.textContent = '';
    
    updateStarVisuals(0);
}

// ===========================================================
// UI: BUSCADOR DE PELÍCULAS
// ===========================================================
function setupMovieSearchBox() {
    const searchInput = document.getElementById('review-movie-search');
    const optionsList = document.getElementById('review-movie-options');
    const wrapper = document.querySelector('.custom-select-wrapper');

    if (!searchInput || !optionsList) return;

    const showList = (e) => {
        e.stopPropagation();
        // Si está vacía, la llenamos con nuestra función inteligente
        if (optionsList.children.length === 0 || optionsList.innerHTML.includes('Cargando')) {
            loadAllContentOptions();
        }
        optionsList.classList.add('show');
    };

    searchInput.addEventListener('click', showList);
    searchInput.addEventListener('focus', showList);

    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        
        optionsList.classList.add('show');
        const options = optionsList.querySelectorAll('.custom-option');

        if (term.length === 0) {
            options.forEach(opt => opt.style.display = 'block');
            return;
        }

        options.forEach(opt => {
            if (opt.classList.contains('empty-option') || opt.classList.contains('loading-option')) return;
            const text = (opt.textContent || '').toLowerCase();
            // Filtro visual simple
            opt.style.display = text.includes(term) ? 'block' : 'none';
        });
    });

    document.addEventListener('click', (e) => {
        if (wrapper && !wrapper.contains(e.target)) {
            optionsList.classList.remove('show');
        }
    });
}

function loadAllContentOptions() {
    const optionsList = document.getElementById('review-movie-options');
    const searchInput = document.getElementById('review-movie-search');
    const hiddenInput = document.getElementById('review-selected-id');
    const contentTypeInput = document.getElementById('review-content-type');
    
    if (!optionsList) return;

    let allOptions = [];

    // 1. Pelis
    if (appState.content.movies) Object.entries(appState.content.movies).forEach(([id, m]) => allOptions.push({ ...m, id }));

    // 2. Series
    if (appState.content.series) {
        Object.entries(appState.content.series).forEach(([id, serie]) => {
            allOptions.push({ ...serie, id });
            const episodes = appState.content.seriesEpisodes?.[id];
            if (episodes && episodes['pelicula']) {
                const specialData = episodes['pelicula'][0];
                allOptions.push({
                    id: `${id}_pelicula`,
                    title: specialData.title || `${serie.title} (Película)`,
                    poster: serie.poster || '',
                    type: 'movie',
                    _isSpecial: true
                });
            }
        });
    }

    // 3. Sagas y UCM
    if (appState.content.sagas) Object.values(appState.content.sagas).forEach(g => Object.entries(g).forEach(([id, i]) => allOptions.push({ ...i, id })));
    if (appState.content.ucm)   Object.entries(appState.content.ucm).forEach(([id, i]) => allOptions.push({ ...i, id }));

    allOptions.sort((a, b) => (a.title || '').localeCompare(b.title || ''));

    const uniqueIds = new Set();
    const renderOptions = (term = '') => {
        optionsList.innerHTML = '';
        let count = 0;
        for (const item of allOptions) {
            if (uniqueIds.has(item.id)) continue;
            if (term && !(item.title || '').toLowerCase().includes(term)) continue;
            uniqueIds.add(item.id);
            count++;

            const div = document.createElement('div');
            div.className = 'custom-option custom-option-rich';
            div.innerHTML = `
                <img src="${item.poster || ''}" alt="" loading="lazy">
                <span class="custom-option-title">${item.title || item.id}${item._isSpecial ? ' <em style="font-size:0.75rem;color:#aaa;">(Película)</em>' : ''}</span>
            `;
            div.onclick = () => {
                if (searchInput) searchInput.value = item.title || '';
                if (hiddenInput) hiddenInput.value = item.id;
                if (contentTypeInput) contentTypeInput.value = item.type || 'movie';
                optionsList.classList.remove('show');

                // Mostrar display de selección con poster
                const display = document.getElementById('review-selected-display');
                const titleEl = document.getElementById('review-selected-title');
                const inputContainer = document.querySelector('.custom-select-input-container');
                if (display) {
                    display.style.display = 'flex';
                    display.style.alignItems = 'center';
                    display.style.gap = '10px';
                    // Insertar poster en el display si no existe ya
                    let posterEl = display.querySelector('.review-selected-poster');
                    if (!posterEl) {
                        posterEl = document.createElement('img');
                        posterEl.className = 'review-selected-poster';
                        posterEl.style.cssText = 'width:32px;height:46px;object-fit:cover;border-radius:4px;flex-shrink:0;';
                        display.insertBefore(posterEl, display.firstChild);
                    }
                    posterEl.src = item.poster || '';
                    if (titleEl) titleEl.textContent = item.title || item.id;
                }
                if (inputContainer) inputContainer.style.display = 'none';
            };
            optionsList.appendChild(div);
            if (!term && count >= 80) break; // Sin búsqueda, limitar a 80
        }
        uniqueIds.clear();
        if (count === 0) {
            optionsList.innerHTML = '<div class="empty-option">Sin resultados</div>';
        }
    };

    // Primera carga
    renderOptions();
    optionsList.classList.add('show');

    // Búsqueda en tiempo real: reemplazar el handler de input
    if (searchInput._richHandlerAttached) return;
    searchInput._richHandlerAttached = true;
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        optionsList.classList.add('show');
        renderOptions(term);
    });
}

// ===========================================================
// LÓGICA: ENVIAR RESEÑA
// ===========================================================
async function handleReviewSubmit(e) {
    e.preventDefault();
    
    const user = auth.currentUser;
    if (!user) {
        ErrorHandler.show('auth', 'Debes iniciar sesión.');
        return;
    }

    const contentId = document.getElementById('review-selected-id')?.value;
    const contentType = document.getElementById('review-content-type')?.value || 'movie'; // 🔥 LEER TIPO
    const rating = document.getElementById('review-rating-value')?.value;
    const text = document.getElementById('review-text-input')?.value.trim();

    // Validaciones (Igual que antes)
    if (!contentId) return ErrorHandler.show('content', 'Selecciona una película.');
    if (rating === "0" || !rating) return ErrorHandler.show('content', 'Debes dar una calificación.');
    if (!text || text.length < 2) return ErrorHandler.show('content', 'Escribe una reseña válida.');

    const submitBtn = DOM.reviewForm.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Publicando...'; }

    try {
        // 1. Verificar duplicados (LÓGICA MEJORADA)
        const existing = await db.ref('reviews')
            .orderByChild('userId')
            .equalTo(user.uid)
            .once('value');

        let duplicado = false;
        existing.forEach(child => {
            const rev = child.val();
            // 🔥 AHORA COMPARAMOS ID Y TIPO
            // Si el ID coincide...
            if (rev.contentId === contentId) {
                // Y si el tipo TAMBIÉN coincide (o si la reseña vieja no tenía tipo guardado)
                // entonces sí es duplicado.
                if (!rev.contentType || rev.contentType === contentType) {
                    duplicado = true;
                }
            }
        });

        if (duplicado) {
            openConfirmationModal(
                "¡Ya opinaste!",
                `Ya tienes una reseña para esta ${contentType === 'series' ? 'serie' : 'película'}.`,
                () => ModalManager.closeAll()
            );
            if (document.getElementById('confirm-delete-btn')) 
                document.getElementById('confirm-delete-btn').textContent = "Entendido";
            return; // Importante: Salir aquí
        }

        // 2. Buscar datos y Guardar
        const itemData = findContentData(contentId);
        
        await db.ref('reviews').push({
            userId: user.uid,
            userName: user.displayName || 'Usuario',
            userEmail: user.email,
            contentId: contentId,
            contentType: contentType, // 🔥 GUARDAMOS EL TIPO AHORA
            contentTitle: itemData ? itemData.title : 'Desconocido',
            poster: itemData ? itemData.poster : '',
            banner: itemData ? itemData.banner : '', // 🔥 GUARDAMOS EL BANNER
            stars: parseFloat(rating),
            text: text,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });

        // 3. Éxito
        if (window.showNotification) {
            window.showNotification('¡Reseña publicada exitosamente!', 'success');
        } else {
            ErrorHandler.show('success', '¡Reseña publicada!');
        }
        
        ModalManager.closeAll();
        resetReviewForm();

    } catch (error) {
        console.error('Error:', error);
        ErrorHandler.show('database', 'Error al publicar.');
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Publicar Reseña'; }
    }
}

// ===========================================================
// LÓGICA: BUSCAR DATOS DE CONTENIDO
// ===========================================================
function findContentData(contentId) {
    if (!contentId) return null;

    // --- CASO PELÍCULA (Jujutsu Kaisen 0) ---
    if (contentId.includes('_pelicula')) {
        const parentId = contentId.replace('_pelicula', '');
        
        // 1. Acceder a las hojas de datos
        const parentSeries = appState.content.series[parentId];
        const episodesSheet = appState.content.seriesEpisodes[parentId];
        const postersSheet = appState.content.seasonPosters[parentId];

        if (parentSeries && episodesSheet && episodesSheet['pelicula']) {
            // A. TÍTULO (Hoja Episodios)
            // Tu Excel tiene: seriesId | seasonNum | title
            const epData = episodesSheet['pelicula'][0];
            const realTitle = epData.title || `${parentSeries.title} (Película)`;

            // B. PÓSTER (Hoja PostersTemporadas)
            // Tu Excel tiene: seriesId | seasonNumber | (Columna oculta de la URL)
            let realPoster = parentSeries.poster; // Fallback

            if (postersSheet && postersSheet['pelicula']) {
                const pData = postersSheet['pelicula'];
                
                // 🛠️ AQUÍ ESTABA EL ERROR:
                // Si pData es un objeto (fila de excel), sacamos la url.
                // Si pData es texto directo, lo usamos.
                if (typeof pData === 'object') {
                    // Intenta adivinar el nombre de la columna de la imagen
                    realPoster = pData.posterUrl || pData.poster || pData.url || pData.img; 
                } else {
                    realPoster = pData;
                }
            } 
            // Fallback: Si no hay poster en la hoja PostersTemporadas, usar miniatura del episodio
            else if (epData.thumbnail) {
                realPoster = epData.thumbnail;
            }

            // Debug para que veas en la consola (F12) qué encontró
            console.log('🎬 Película detectada:', { title: realTitle, poster: realPoster });

            return {
                id: contentId,
                title: realTitle,
                poster: realPoster,
                type: 'movie',
                banner: parentSeries.banner,
                synopsis: epData.description || parentSeries.synopsis
            };
        }
    }

    // --- BÚSQUEDA NORMAL ---
    if (appState.content.movies && appState.content.movies[contentId]) return appState.content.movies[contentId];
    if (appState.content.series && appState.content.series[contentId]) return appState.content.series[contentId];
    if (appState.content.sagas) {
        for (let key in appState.content.sagas) {
            if (appState.content.sagas[key][contentId]) return appState.content.sagas[key][contentId];
        }
    }
    if (appState.content.ucm && appState.content.ucm[contentId]) return appState.content.ucm[contentId];
    
    return null;
}

// ===========================================================
// RENDERIZADO: GRID DE RESEÑAS (CON LÓGICA DE "LEER MÁS")
// ===========================================================
// ===========================================================
// ESTADO GLOBAL DE FILTROS
// ===========================================================
let _allReviews = [];
let _filteredReviews = [];
let _commentCounts = {};
let _activeTab = 'all';
let _activeStarFilter = 'all';
let _activeUserFilter = '';
let _currentPage = 1;
const REVIEWS_PER_PAGE = 10;


export function renderReviewsGrid() {
    const grid = DOM.reviewsGrid;
    if (!grid) return;

    grid.className = 'reviews-list';
    grid.innerHTML = `<div class="reviews-loading"><i class="fas fa-spinner fa-spin"></i> Cargando reseñas...</div>`;

    db.ref('reviews').limitToLast(500).on('value', async snapshot => {
        grid.innerHTML = '';

        if (!snapshot.exists()) {
            grid.innerHTML = `
                <div class="reviews-empty">
                    <i class="far fa-comment-dots"></i>
                    <p>Aún no hay reseñas. ¡Sé el primero en opinar!</p>
                </div>
            `;
            return;
        }

        const reviews = [];
        snapshot.forEach(child => {
            const data = child.val();
            data.id = child.key;
            reviews.push(data);
        });

        reviews.reverse();

        // --- Estado global ---
        _allReviews = reviews;
        _filteredReviews = reviews;
        _activeTab = 'all';
        _activeStarFilter = 'all';
        _activeUserFilter = '';

        // --- Estadísticas ---
        _renderStatsPanel(reviews);

        // --- Configurar tabs (solo primera vez) ---
        _setupTabsBar();

        // --- Pre-cargar conteos de comentarios ---
        const commentCountsSnap = await db.ref('review_comments').once('value');
        _commentCounts = {};
        if (commentCountsSnap.exists()) {
            commentCountsSnap.forEach(child => {
                _commentCounts[child.key] = child.numChildren();
            });
        }

        _renderFiltered();
    });
}

function _renderFiltered() {
    const grid = DOM.reviewsGrid;
    if (!grid) return;

    grid.innerHTML = '';

    if (_filteredReviews.length === 0) {
        let msg = 'No hay reseñas que coincidan con los filtros.';
        if (_activeTab === 'mine') msg = 'Aún no has escrito ninguna reseña.';
        else if (_activeTab === 'user' && _activeUserFilter) msg = `No se encontraron reseñas de "@${_activeUserFilter}".`;
        grid.innerHTML = `<div class="reviews-empty"><i class="far fa-comment-dots"></i><p>${msg}</p></div>`;
        _renderPagination();
        return;
    }

    const totalPages = Math.ceil(_filteredReviews.length / REVIEWS_PER_PAGE);
    // Guardar página dentro de rango válido
    if (_currentPage > totalPages) _currentPage = totalPages;
    if (_currentPage < 1) _currentPage = 1;

    const start = (_currentPage - 1) * REVIEWS_PER_PAGE;
    const pageReviews = _filteredReviews.slice(start, start + REVIEWS_PER_PAGE);

    const fragment = document.createDocumentFragment();
    pageReviews.forEach(review => {
        const card = createReviewCard(review, _commentCounts[review.id] || 0);
        fragment.appendChild(card);
    });
    grid.appendChild(fragment);

    _renderPagination();
}

function _renderPagination() {
    // Buscar o crear el contenedor de paginación
    let paginationEl = document.getElementById('reviews-pagination');
    if (!paginationEl) {
        paginationEl = document.createElement('div');
        paginationEl.id = 'reviews-pagination';
        paginationEl.className = 'reviews-pagination';
        // Insertar DESPUÉS del contenedor flex de dos columnas, no dentro de él
        const twoCol = DOM.reviewsGrid.closest('.reviews-two-col');
        const insertAfter = twoCol || DOM.reviewsGrid;
        insertAfter.insertAdjacentElement('afterend', paginationEl);
    }

    const total = _filteredReviews.length;
    const totalPages = Math.ceil(total / REVIEWS_PER_PAGE);

    if (totalPages <= 1) {
        paginationEl.innerHTML = '';
        return;
    }

    const start = (_currentPage - 1) * REVIEWS_PER_PAGE + 1;
    const end = Math.min(_currentPage * REVIEWS_PER_PAGE, total);

    // Construir botones de páginas (mostrar hasta 5 páginas alrededor de la actual)
    let pageButtons = '';
    const delta = 2;
    const left = Math.max(1, _currentPage - delta);
    const right = Math.min(totalPages, _currentPage + delta);

    if (left > 1) {
        pageButtons += `<button class="rvpag-btn rp-btn" data-page="1">1</button>`;
        if (left > 2) pageButtons += `<span class="rp-dots">…</span>`;
    }
    for (let i = left; i <= right; i++) {
        pageButtons += `<button class="rvpag-btn rp-btn ${i === _currentPage ? 'rp-active' : ''}" data-page="${i}">${i}</button>`;
    }
    if (right < totalPages) {
        if (right < totalPages - 1) pageButtons += `<span class="rp-dots">…</span>`;
        pageButtons += `<button class="rvpag-btn rp-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    paginationEl.innerHTML = `
        <div class="rp-divider"></div>
        <div class="rp-info">${start}–${end} de ${total} reseñas</div>
        <div class="rp-controls">
            <button class="rvpag-btn rp-btn rp-arrow rp-prev" data-page="${_currentPage - 1}" ${_currentPage === 1 ? 'disabled' : ''}>
                <i class="fas fa-chevron-left"></i>
            </button>
            <div class="rp-pages">${pageButtons}</div>
            <button class="rvpag-btn rp-btn rp-arrow rp-next" data-page="${_currentPage + 1}" ${_currentPage === totalPages ? 'disabled' : ''}>
                <i class="fas fa-chevron-right"></i>
            </button>
        </div>
    `;

    paginationEl.querySelectorAll('.rvpag-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = parseInt(btn.dataset.page);
            if (page && page !== _currentPage) {
                _currentPage = page;
                _renderFiltered();
                // Scroll suave al tope del grid
                DOM.reviewsGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Scroll al tope del contenedor de reseñas para leer desde arriba
                const reviewsContainer = document.getElementById('reviews-container');
                if (reviewsContainer) {
                    reviewsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        });
    });
}

function _applyAllFilters() {
    let result = _allReviews;
    const currentUser = auth.currentUser;

    if (_activeTab === 'mine' && currentUser) {
        result = result.filter(r => r.userId === currentUser.uid);
    } else if (_activeTab === 'user' && _activeUserFilter) {
        const term = _activeUserFilter.toLowerCase();
        result = result.filter(r => (r.userName || '').toLowerCase().includes(term));
    }

    if (_activeStarFilter !== 'all') {
        const groupRating = s => Math.max(1, Math.floor(s || 0));
        result = result.filter(r => groupRating(r.stars) === _activeStarFilter);
    }

    _filteredReviews = result;
    _currentPage = 1;
    _renderFiltered();
}

function _setupTabsBar() {
    const bar = document.getElementById('reviews-tabs-bar');
    if (!bar || bar.dataset.ready === '1') return;
    bar.dataset.ready = '1';

    const mineTab = document.getElementById('rv-tab-mine');
    if (mineTab) mineTab.style.display = auth.currentUser ? '' : 'none';

    bar.querySelectorAll('.rv-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            bar.querySelectorAll('.rv-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _activeTab = btn.dataset.tab;

            const input = document.getElementById('rv-user-search-input');
            const clearBtn = document.getElementById('rv-user-search-clear');
            if (input) input.value = '';
            if (clearBtn) clearBtn.style.display = 'none';
            _activeUserFilter = '';

            _activeStarFilter = 'all';
            document.querySelectorAll('.rsf-btn').forEach(b => b.classList.toggle('active', b.dataset.stars === 'all'));

            _applyAllFilters();
        });
    });

    const searchInput = document.getElementById('rv-user-search-input');
    const clearBtn    = document.getElementById('rv-user-search-clear');

    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const term = searchInput.value.trim();
                _activeUserFilter = term;
                if (term) {
                    bar.querySelectorAll('.rv-tab').forEach(b => b.classList.remove('active'));
                    _activeTab = 'user';
                } else {
                    _activeTab = 'all';
                    bar.querySelectorAll('.rv-tab')[0]?.classList.add('active');
                }
                if (clearBtn) clearBtn.style.display = term ? '' : 'none';
                _applyAllFilters();
            }, 300);
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            clearBtn.style.display = 'none';
            _activeUserFilter = '';
            _activeTab = 'all';
            bar.querySelectorAll('.rv-tab').forEach(b => b.classList.remove('active'));
            bar.querySelectorAll('.rv-tab')[0]?.classList.add('active');
            _applyAllFilters();
        });
    }
}

function _renderStatsPanel(reviews) {
    const panel = document.getElementById('reviews-stats-panel');
    if (!panel) return;

    const total = reviews.length;
    const avg = (reviews.reduce((s, r) => s + (r.stars || 0), 0) / total).toFixed(1);

    // Distribución: agrupar en enteros (0.5/1.5 → 1, 2.5 → 2, 3.5 → 3, 4.5 → 4, 5 → 5)
    const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    const groupRating = (stars) => Math.max(1, Math.floor(stars || 0));
    reviews.forEach(r => {
        const group = groupRating(r.stars);
        if (dist[group] !== undefined) dist[group]++;
    });

    const avgEl = document.getElementById('rsp-avg');
    const starsEl = document.getElementById('rsp-stars');
    const countEl = document.getElementById('rsp-count');
    const barsEl = document.getElementById('rsp-bars');

    if (avgEl) avgEl.textContent = avg;
    if (starsEl) {
        starsEl.innerHTML = renderStarsFromValue(parseFloat(avg));
    }
    if (countEl) countEl.textContent = `${total} reseña${total !== 1 ? 's' : ''}`;
    if (barsEl) {
        barsEl.innerHTML = [5, 4, 3, 2, 1].map(n => {
            const count = dist[n] || 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return `
                <div class="rsp-bar-row" data-stars="${n}">
                    <span class="rsp-bar-label">${n} <i class="fas fa-star"></i></span>
                    <div class="rsp-bar-track">
                        <div class="rsp-bar-fill" style="width:${pct}%"></div>
                    </div>
                    <span class="rsp-bar-pct">${count}</span>
                </div>`;
        }).join('');
    }

    panel.style.display = 'flex';

    // Mostrar filtros y hacer las barras clickeables
    const filterPanel = document.getElementById('reviews-star-filter');
    if (filterPanel) filterPanel.style.display = 'block';

    // Hacer barras clickeables (misma lógica que botones)
    document.querySelectorAll('.rsp-bar-row').forEach(row => {
        const starsVal = parseFloat(row.dataset.stars);
        if (!isNaN(starsVal)) {
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => _applyStarFilter(starsVal));
        }
    });

    // Botones de filtro
    document.querySelectorAll('.rsf-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.rsf-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const val = btn.dataset.stars;
            _applyStarFilter(val === 'all' ? 'all' : parseFloat(val));
        });
    });
}

function _applyStarFilter(stars) {
    _activeStarFilter = stars;
    document.querySelectorAll('.rsf-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.stars === String(stars));
    });
    _applyAllFilters();
}

// Exponer globalmente
window.renderReviews = renderReviewsGrid;

// ===========================================================
// AUXILIAR: CREAR TARJETA ESTILO IMDB
// ===========================================================
function createReviewCard(review, initialCommentCount = 0) {
    const card = document.createElement('div');
    card.className = 'review-card';
    card.dataset.reviewData = JSON.stringify(review);

    const starsHTML = renderStarsFromValue(review.stars || 0);

    const date = review.timestamp
        ? (() => {
            const d = new Date(review.timestamp);
            const fecha = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
            const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            return `${fecha} · ${hora}`;
        })()
        : 'Reciente';

    const isAdmin = auth.currentUser && auth.currentUser.email === 'baquezadat@gmail.com';
    const isOwner = auth.currentUser && auth.currentUser.uid === review.userId;

    const deleteBtnHTML = (isAdmin || isOwner)
        ? `<button class="btn-delete-review" onclick="deleteReview('${review.id}')" title="Borrar reseña"><i class="fas fa-trash-alt"></i></button>`
        : '';

    const MAX_CHARS = 300;
    const fullText = review.text || '';
    const isTruncated = fullText.length > MAX_CHARS;
    const shortText = isTruncated ? fullText.substring(0, MAX_CHARS).trimEnd() + '…' : fullText;

    card.innerHTML = `
        <div class="rc-poster-col">
            <img src="${review.poster || ''}" class="rc-poster"
                 onerror="this.src='https://res.cloudinary.com/djhgmmdjx/image/upload/v1759209689/u71QEFc_bet4rv.png'"
                 alt="${review.contentTitle}">
        </div>
        <div class="rc-main">
            <div class="rc-header">
                <div class="rc-header-left">
                    <h3 class="rc-movie-title">${review.contentTitle}</h3>
                    <div class="rc-stars">${starsHTML}<span class="rc-stars-num">${review.stars}/5</span></div>
                </div>
                <div class="rc-header-right">
                    ${deleteBtnHTML}
                </div>
            </div>
            <p class="rc-text">${shortText}</p>
            ${isTruncated ? `<button class="rc-read-more">Leer reseña completa <i class="fas fa-chevron-down"></i></button>` : ''}
            <div class="rc-footer">
                <div class="rc-author">
                    <i class="fas fa-user-circle rc-author-icon"></i>
                    <span class="rc-author-name">@${review.userName}</span>
                    <span class="rc-date">${date}</span>
                </div>
                <button class="rc-comment-toggle" data-review-id="${review.id}">
                    <i class="far fa-comment"></i>
                    <span>${initialCommentCount > 0 ? `${initialCommentCount} comentario${initialCommentCount !== 1 ? 's' : ''}` : 'Comentar'}</span>
                </button>
            </div>
            <div class="rc-comments-area" style="display:none;">
                <div class="crm-comments-list" id="comments-${review.id}">
                    <div class="crm-comments-loading"><i class="fas fa-spinner fa-spin"></i></div>
                </div>
                ${auth.currentUser ? `
                <div class="crm-comment-input-row">
                    <i class="fas fa-user-circle crm-comment-input-avatar"></i>
                    <div class="crm-comment-input-wrap">
                        <textarea class="crm-comment-input" placeholder="Añade un comentario..." rows="1"></textarea>
                        <button class="crm-comment-send" data-review-id="${review.id}">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                </div>` : `<p class="crm-login-hint"><i class="fas fa-lock"></i> Inicia sesión para comentar</p>`}
            </div>
        </div>
    `;

    // Expandir texto
    if (isTruncated) {
        const btn = card.querySelector('.rc-read-more');
        const textEl = card.querySelector('.rc-text');
        let expanded = false;
        btn.addEventListener('click', () => {
            expanded = !expanded;
            textEl.textContent = expanded ? fullText : shortText;
            btn.innerHTML = expanded
                ? 'Mostrar menos <i class="fas fa-chevron-up"></i>'
                : 'Leer reseña completa <i class="fas fa-chevron-down"></i>';
        });
    }

    // Toggle comentarios
    const commentToggle = card.querySelector('.rc-comment-toggle');
    const commentsArea = card.querySelector('.rc-comments-area');
    let commentsLoaded = false;

    commentToggle.addEventListener('click', () => {
        const isOpen = commentsArea.style.display !== 'none';
        commentsArea.style.display = isOpen ? 'none' : 'block';
        const spanEl = commentToggle.querySelector('span');
        const iconEl = commentToggle.querySelector('i');
        if (isOpen) {
            spanEl.textContent = initialCommentCount > 0 ? `${initialCommentCount} comentario${initialCommentCount !== 1 ? 's' : ''}` : 'Comentar';
            iconEl.className = 'far fa-comment';
        } else {
            spanEl.textContent = 'Ocultar';
            iconEl.className = 'fas fa-comment';
        }

        if (!isOpen && !commentsLoaded) {
            commentsLoaded = true;
            loadComments(review.id, card, (count) => {
                // Actualizar label con conteo real
                if (commentsArea.style.display === 'none') {
                    spanEl.textContent = count > 0 ? `${count} comentario${count !== 1 ? 's' : ''}` : 'Comentar';
                }
            });
        }
    });

    // Enviar comentario
    if (auth.currentUser) {
        const sendBtn = card.querySelector('.crm-comment-send');
        const inputEl = card.querySelector('.crm-comment-input');

        inputEl.addEventListener('input', () => {
            inputEl.style.height = 'auto';
            inputEl.style.height = inputEl.scrollHeight + 'px';
        });
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
        });
        sendBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const text = inputEl.value.trim();
            if (!text) return;
            sendBtn.disabled = true;
            sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            try {
                await db.ref(`review_comments/${review.id}`).push({
                    userId: auth.currentUser.uid,
                    userName: auth.currentUser.displayName || 'Usuario',
                    text,
                    timestamp: firebase.database.ServerValue.TIMESTAMP
                });
                inputEl.value = '';
                inputEl.style.height = 'auto';
                if (!commentsLoaded) { commentsLoaded = true; loadComments(review.id, card); }
            } catch (err) {
                console.error('[Comments]', err);
            } finally {
                sendBtn.disabled = false;
                sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
            }
        });
    }

    return card;
}

// ===========================================================
// LÓGICA: TRUNCADO INTELIGENTE (LEER MÁS / MENOS)
// ===========================================================
function setupReviewTruncation() {
    const reviewCards = document.querySelectorAll('.review-card');

    reviewCards.forEach(card => {
        const textEl = card.querySelector('.review-text');
        if (!textEl) return;

        // Limpiar estado previo
        const existingBtn = card.querySelector('.read-more-trigger');
        if (existingBtn) existingBtn.remove();

        // Esperar a que el elemento esté completamente renderizado
        setTimeout(() => {
            // Verificar nuevamente que el elemento existe
            if (!textEl || !textEl.scrollHeight || !textEl.clientHeight) return;
            
            // 🔥 DETECCIÓN INTELIGENTE: Verificar si el texto está siendo truncado visualmente
            // Comparamos el scrollHeight (altura total del contenido) con clientHeight (altura visible)
            const isTruncated = textEl.scrollHeight > textEl.clientHeight; // Sin margen - detección directa
            
            console.log('Verificando truncado:', {
                scrollHeight: textEl.scrollHeight,
                clientHeight: textEl.clientHeight,
                isTruncated: isTruncated,
                text: textEl.textContent.substring(0, 30) + '...'
            });
            
            if (isTruncated) {
                // 1. Creamos botón
                const btn = document.createElement('button');
                btn.className = 'read-more-trigger';
                btn.textContent = 'Leer reseña completa';
                
                // Estilos inline básicos
                btn.style.marginTop = '8px';
                btn.style.background = 'none';
                btn.style.border = 'none';
                btn.style.color = '#888';
                btn.style.cursor = 'pointer';
                btn.style.fontSize = '0.85rem';
                btn.style.fontWeight = '600';
                btn.style.transition = 'color 0.3s ease';

                // 2. 🔥 Evento Click - ABRIR MODAL CON LA RESEÑA COMPLETA
                btn.onclick = (e) => {
                    e.stopPropagation();
                    
                    // Obtener datos de la reseña desde el atributo data
                    const reviewData = JSON.parse(card.dataset.reviewData);
                    
                    // Abrir modal con reseña completa
                    openFullReview(reviewData);
                };
                
                // Hover effect
                btn.addEventListener('mouseenter', () => {
                    btn.style.color = '#e50914';
                });
                btn.addEventListener('mouseleave', () => {
                    btn.style.color = '#888';
                });

                // Insertar después del contenedor de texto
                textEl.parentNode.appendChild(btn);
            }
        }, 100); // Mayor delay para asegurar que el DOM esté completamente renderizado
    });
}

// ===========================================================
// MODAL: VER RESEÑA COMPLETA
// ===========================================================
export function openFullReview(reviewData) {
    const modal = document.getElementById('full-review-modal');
    if (!modal) return;

    // Llenar datos
    const header = document.getElementById('read-review-header');
    const poster = document.getElementById('read-review-poster');
    const title = document.getElementById('read-review-movie-title');
    const user = document.getElementById('read-review-user');
    const date = document.getElementById('read-review-date');
    const text = document.getElementById('read-review-text');
    const stars = document.getElementById('read-review-stars');

    // 🔥 BUSCAR BANNER DINÁMICAMENTE si no existe en la reseña guardada
    let bannerToUse = reviewData.banner;
    
    if (!bannerToUse && reviewData.contentId) {
        // Buscar el contenido actual para obtener el banner
        const contentData = findContentData(reviewData.contentId);
        if (contentData && contentData.banner) {
            bannerToUse = contentData.banner;
        }
    }
    
    // Usar banner como fondo, si no existe usar poster
    const backgroundImage = bannerToUse || reviewData.poster;
    if (header) header.style.backgroundImage = `url(${backgroundImage})`;
    
    // Poster sigue siendo el poster normal
    if (poster) poster.src = reviewData.poster;
    
    if (title) title.textContent = reviewData.contentTitle;
    if (user) user.textContent = `@${reviewData.userName}`;
    if (date) date.textContent = reviewData.timestamp 
        ? new Date(reviewData.timestamp).toLocaleDateString('es-ES', { 
            day: 'numeric', 
            month: 'long', 
            year: 'numeric' 
        })
        : 'Reciente';
    if (text) text.textContent = reviewData.text;
    if (stars) stars.innerHTML = renderStarsFromValue(reviewData.stars || 0);

    // Mostrar modal usando ModalManager si está disponible
    if (ModalManager && typeof ModalManager.open === 'function') {
        ModalManager.open(modal, { closeOnEsc: true });
    } else {
        // Fallback si ModalManager no está disponible
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }
}

window.openFullReview = openFullReview;

// ===========================================================
// ADMIN: ELIMINAR RESEÑA
// ===========================================================
export function deleteReview(reviewId) {
    openConfirmationModal(
        "Eliminar Reseña",
        "¿Estás seguro de que deseas eliminar esta reseña permanentemente?",
        async () => {
            try {
                await db.ref(`reviews/${reviewId}`).remove();
                
                // ✅ NOTIFICACIÓN VISUAL (Toast)
                if (window.showNotification) {
                    window.showNotification('Reseña eliminada correctamente.', 'success');
                } else {
                    // Fallback por si acaso
                    ErrorHandler.show('content', 'Reseña eliminada correctamente.');
                }

            } catch (error) {
                console.error('Error al eliminar reseña:', error);
                
                if (window.showNotification) {
                    window.showNotification('Error al eliminar la reseña.', 'error');
                } else {
                    ErrorHandler.show('database', 'Error al eliminar la reseña.');
                }
            }
        }
    );
}

window.deleteReview = deleteReview;

// ===========================================================
// SISTEMA DE RATINGS (PROMEDIOS)
// ===========================================================
function setupRatingsListener() {
    db.ref('reviews').on('value', snapshot => {
        const ratingsData = {};
        
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const review = child.val();
                if (!ratingsData[review.contentId]) {
                    ratingsData[review.contentId] = { sum: 0, count: 0 };
                }
                ratingsData[review.contentId].sum += review.stars;
                ratingsData[review.contentId].count += 1;
            });
        }

        // Calcular promedios
        const newAverages = {};
        for (const contentId in ratingsData) {
            const data = ratingsData[contentId];
            newAverages[contentId] = (data.sum / data.count).toFixed(1);
        }

        // Guardar conteos de reseñas por contenido
        const newCounts = {};
        for (const contentId in ratingsData) {
            newCounts[contentId] = ratingsData[contentId].count;
        }
        appState.content.reviewCounts = newCounts;

        // Actualizar en appState
        appState.content.averages = newAverages;
        
        // Actualizar UI visible
        updateVisibleRatings();
    });
}

// ===========================================================
// UI: ACTUALIZAR RATINGS VISIBLES
// ===========================================================
function updateVisibleRatings() {
    document.querySelectorAll('.movie-card').forEach(card => {
        const contentId = card.dataset.contentId;
        const ratingContainer = card.querySelector('.card-rating-container');
        
        if (ratingContainer && contentId) {
            const rating = appState.content.averages[contentId];
            ratingContainer.innerHTML = getStarsHTML(rating, true);
        }
    });
}

export function getStarsHTML(rating, isSmall = true) {
    if (!rating || rating === "0.0" || rating === 0) return '';
    
    return `
        <div class="star-rating-display ${isSmall ? 'small' : 'large'}" 
             title="${rating} de 5 estrellas">
            <i class="fas fa-star"></i>
            <span class="rating-number">${rating}</span>
        </div>
    `;
}

// ===========================================================
// MODAL: VER TODAS LAS RESEÑAS DE UN CONTENIDO
// ===========================================================
export async function openContentReviews(contentId, contentTitle) {
    const modal = document.getElementById('content-reviews-modal');
    if (!modal) return;

    // Resetear estado
    const crmList = document.getElementById('crm-list');
    const crmLoading = document.getElementById('crm-loading');
    const crmEmpty = document.getElementById('crm-empty');
    const crmTitle = document.getElementById('crm-title');
    const crmPoster = document.getElementById('crm-poster');
    const crmHeader = document.getElementById('crm-header');
    const crmAvg = document.getElementById('crm-avg');
    const crmCount = document.getElementById('crm-count');

    if (crmList) crmList.innerHTML = '';
    if (crmLoading) crmLoading.style.display = 'flex';
    if (crmEmpty) crmEmpty.style.display = 'none';
    if (crmTitle) crmTitle.textContent = contentTitle || '';

    // Buscar datos del contenido para poster y banner
    const contentData = findContentData(contentId);
    if (contentData) {
        if (crmPoster) crmPoster.src = contentData.poster || '';
        if (crmHeader && (contentData.banner || contentData.poster)) {
            crmHeader.style.backgroundImage = `url(${contentData.banner || contentData.poster})`;
        }
    }

    // Abrir modal
    if (ModalManager && typeof ModalManager.open === 'function') {
        ModalManager.open(modal, { closeOnEsc: true, nested: true });
    } else {
        modal.classList.add('show');
        document.body.classList.add('modal-open');
    }

    const MAX_CHARS = 220;

    try {
        // Fetch TODAS las reseñas y filtrar por contentId en cliente
        // (evita necesidad de índice en Firebase)
        const snapshot = await db.ref('reviews').once('value');
        if (crmLoading) crmLoading.style.display = 'none';

        const reviews = [];
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const rev = child.val();
                if (rev.contentId === contentId) {
                    reviews.push({ id: child.key, ...rev });
                }
            });
        }

        if (reviews.length === 0) {
            if (crmEmpty) crmEmpty.style.display = 'flex';
            return;
        }

        // Ordenar más antiguos primero
        reviews.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        // Stats
        const avg = (reviews.reduce((s, r) => s + r.stars, 0) / reviews.length).toFixed(1);
        if (crmAvg) crmAvg.innerHTML = `<i class="fas fa-star"></i> ${avg}`;
        if (crmCount) crmCount.textContent = `${reviews.length} ${reviews.length === 1 ? 'reseña' : 'reseñas'}`;

        const isAdmin = auth.currentUser && auth.currentUser.email === 'baquezadat@gmail.com';
        const currentUser = auth.currentUser;

        reviews.forEach(review => {
            const starsHTML =
                '<i class="fas fa-star"></i>'.repeat(review.stars) +
                '<i class="far fa-star"></i>'.repeat(5 - review.stars);

            const date = review.timestamp
                ? (() => {
                    const d = new Date(review.timestamp);
                    const fecha = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
                    const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                    return `${fecha} · ${hora}`;
                })()
                : 'Reciente';

            const fullText = review.text || '';
            const isTruncated = fullText.length > MAX_CHARS;
            const shortText = isTruncated ? fullText.substring(0, MAX_CHARS).trimEnd() + '…' : fullText;

            const card = document.createElement('div');
            card.className = 'crm-review-card';
            card.innerHTML = `
                <div class="crm-card-header">
                    <div class="crm-card-user">
                        <i class="fas fa-user-circle crm-user-icon"></i>
                        <span class="crm-username">@${review.userName}</span>
                        <span class="crm-date">${date}</span>
                    </div>
                    <div class="crm-card-stars">${starsHTML}</div>
                </div>
                <p class="crm-card-text">${shortText}</p>
                ${isTruncated ? `<button class="crm-read-more">Leer reseña completa <i class="fas fa-chevron-down"></i></button>` : ''}
                <div class="crm-comments-section">
                    <button class="crm-toggle-comments" data-review-id="${review.id}">
                        <i class="far fa-comment"></i>
                        <span class="crm-comments-label">Ver comentarios</span>
                    </button>
                    <div class="crm-comments-area" style="display:none;">
                        <div class="crm-comments-list" id="comments-${review.id}">
                            <div class="crm-comments-loading"><i class="fas fa-spinner fa-spin"></i></div>
                        </div>
                        ${currentUser ? `
                        <div class="crm-comment-input-row">
                            <i class="fas fa-user-circle crm-comment-input-avatar"></i>
                            <div class="crm-comment-input-wrap">
                                <textarea class="crm-comment-input" placeholder="Escribe un comentario..." rows="1"></textarea>
                                <button class="crm-comment-send" data-review-id="${review.id}">
                                    <i class="fas fa-paper-plane"></i>
                                </button>
                            </div>
                        </div>` : `<p class="crm-login-hint"><i class="fas fa-lock"></i> Inicia sesión para comentar</p>`}
                    </div>
                </div>
            `;

            // Toggle expandir/colapsar texto
            if (isTruncated) {
                const btn = card.querySelector('.crm-read-more');
                const textEl = card.querySelector('.crm-card-text');
                let expanded = false;
                btn.addEventListener('click', () => {
                    expanded = !expanded;
                    textEl.textContent = expanded ? fullText : shortText;
                    btn.innerHTML = expanded
                        ? 'Mostrar menos <i class="fas fa-chevron-up"></i>'
                        : 'Leer reseña completa <i class="fas fa-chevron-down"></i>';
                });
            }

            // Toggle comentarios
            const toggleBtn = card.querySelector('.crm-toggle-comments');
            const commentsArea = card.querySelector('.crm-comments-area');
            let commentsLoaded = false;
            let commentsListener = null;

            toggleBtn.addEventListener('click', () => {
                const isOpen = commentsArea.style.display !== 'none';
                commentsArea.style.display = isOpen ? 'none' : 'block';
                toggleBtn.querySelector('.crm-comments-label').textContent = isOpen ? 'Ver comentarios' : 'Ocultar comentarios';
                toggleBtn.querySelector('i').className = isOpen ? 'far fa-comment' : 'fas fa-comment';

                if (!isOpen && !commentsLoaded) {
                    commentsLoaded = true;
                    loadComments(review.id, card);
                }
            });

            // Enviar comentario
            if (currentUser) {
                const sendBtn = card.querySelector('.crm-comment-send');
                const inputEl = card.querySelector('.crm-comment-input');

                // Auto-resize textarea
                inputEl.addEventListener('input', () => {
                    inputEl.style.height = 'auto';
                    inputEl.style.height = inputEl.scrollHeight + 'px';
                });

                // Enter para enviar (Shift+Enter = salto de línea)
                inputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendBtn.click();
                    }
                });

                sendBtn.addEventListener('click', async () => {
                    const text = inputEl.value.trim();
                    if (!text) return;

                    sendBtn.disabled = true;
                    sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

                    try {
                        await db.ref(`review_comments/${review.id}`).push({
                            userId: currentUser.uid,
                            userName: currentUser.displayName || 'Usuario',
                            text,
                            timestamp: firebase.database.ServerValue.TIMESTAMP
                        });
                        inputEl.value = '';
                        inputEl.style.height = 'auto';

                        // Cargar si no estaban cargados aún
                        if (!commentsLoaded) {
                            commentsLoaded = true;
                            loadComments(review.id, card);
                        }
                    } catch (err) {
                        console.error('[Comments] Error al enviar:', err);
                    } finally {
                        sendBtn.disabled = false;
                        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
                    }
                });
            }

            if (crmList) crmList.appendChild(card);
        });

    } catch (err) {
        if (crmLoading) crmLoading.style.display = 'none';
        console.error('[ContentReviews] Error al cargar reseñas:', err);
        if (crmEmpty) crmEmpty.style.display = 'flex';
    }
}

// ===========================================================
// COMENTARIOS DE RESEÑAS
// ===========================================================
function loadComments(reviewId, card, onCountUpdate = null) {
    const listEl = card.querySelector(`#comments-${reviewId}`);
    if (!listEl) return;

    const isAdmin = auth.currentUser && auth.currentUser.email === 'baquezadat@gmail.com';
    const currentUid = auth.currentUser ? auth.currentUser.uid : null;

    db.ref(`review_comments/${reviewId}`).orderByChild('timestamp').on('value', snapshot => {
        listEl.innerHTML = '';

        if (!snapshot.exists()) {
            listEl.innerHTML = `<p class="crm-no-comments">Sé el primero en comentar.</p>`;
            if (onCountUpdate) onCountUpdate(0);
            return;
        }

        const comments = [];
        snapshot.forEach(child => comments.push({ id: child.key, ...child.val() }));

        if (onCountUpdate) onCountUpdate(comments.length);

        comments.forEach(comment => {
            const date = comment.timestamp
                ? new Date(comment.timestamp).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
                : '';

            const canDelete = isAdmin || currentUid === comment.userId;
            const deleteBtn = canDelete
                ? `<button class="crm-comment-delete" onclick="deleteReviewComment('${reviewId}','${comment.id}')" title="Borrar comentario"><i class="fas fa-trash-alt"></i></button>`
                : '';

            const el = document.createElement('div');
            el.className = 'crm-comment-item';
            el.innerHTML = `
                <i class="fas fa-user-circle crm-comment-avatar"></i>
                <div class="crm-comment-bubble">
                    <div class="crm-comment-meta">
                        <span class="crm-comment-user">@${comment.userName}</span>
                        <span class="crm-comment-date">${date}</span>
                        ${deleteBtn}
                    </div>
                    <p class="crm-comment-text">${comment.text}</p>
                </div>
            `;
            listEl.appendChild(el);
        });
    });
}

export function deleteReviewComment(reviewId, commentId) {
    openConfirmationModal('¿Borrar comentario?', 'Esta acción no se puede deshacer.', async () => {
        try {
            await db.ref(`review_comments/${reviewId}/${commentId}`).remove();
        } catch (err) {
            console.error('[Comments] Error al borrar:', err);
        }
    });
}
window.deleteReviewComment = deleteReviewComment;

window.openContentReviews = openContentReviews;

// ===========================================================
// EXPORTACIONES
// ===========================================================
export default {
    initReviews,
    renderReviewsGrid,
    openReviewModal,
    openFullReview,
    openContentReviews,
    deleteReview,
    getStarsHTML
};
