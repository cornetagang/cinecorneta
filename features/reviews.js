// ===========================================================
// MÓDULO DE RESEÑAS (REVIEWS)
// ===========================================================
// Versión: 2.0
// Fecha: 1 de Febrero 2026
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
export function initReviews(dependencies) {
    // Inyectar dependencias
    appState = dependencies.appState;
    DOM = dependencies.DOM;
    auth = dependencies.auth;
    db = dependencies.db;
    ErrorHandler = dependencies.ErrorHandler;
    ModalManager = dependencies.ModalManager;
    openConfirmationModal = dependencies.openConfirmationModal;

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
function setupStarRating() {
    const stars = document.querySelectorAll('.star-option');
    const ratingInput = document.getElementById('review-rating-value');
    
    stars.forEach(star => {
        star.onclick = () => {
            const value = parseInt(star.dataset.value);
            if (ratingInput) ratingInput.value = value;
            updateStarVisuals(value);
        };
    });
}

function updateStarVisuals(value) {
    const stars = document.querySelectorAll('.star-option');
    stars.forEach(star => {
        const starValue = parseInt(star.dataset.value);
        if (starValue <= value) {
            star.classList.add('selected', 'fas');
            star.classList.remove('far');
        } else {
            star.classList.remove('selected', 'fas');
            star.classList.add('far');
        }
    });
}

function resetReviewForm() {
    if (DOM.reviewForm) DOM.reviewForm.reset();
    
    const ratingInput = document.getElementById('review-rating-value');
    const hiddenInput = document.getElementById('review-selected-id');
    const textInput = document.getElementById('review-text-input');
    
    if (ratingInput) ratingInput.value = '0';
    if (hiddenInput) hiddenInput.value = '';
    if (textInput) textInput.value = '';
    
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
    
    if (!optionsList) return;

    optionsList.innerHTML = '<div class="loading-option">Cargando...</div>';
    let allOptions = [];

    // 1. Pelis
    if (appState.content.movies) Object.values(appState.content.movies).forEach(m => allOptions.push(m));

    // 2. Series + Películas Internas
    if (appState.content.series) {
        Object.entries(appState.content.series).forEach(([id, serie]) => {
            allOptions.push(serie); // La serie normal

            // 🔥 BUSCAMOS LITERAL "pelicula"
            const episodes = appState.content.seriesEpisodes[id];
            if (episodes && episodes['pelicula']) {
                const specialData = episodes['pelicula'][0];
                allOptions.push({
                    id: `${id}_pelicula`, // ID Virtual
                    title: specialData.title || `${serie.title} (Película)`,
                    type: 'movie',
                    _isSpecial: true
                });
            }
        });
    }

    // 3. Otros
    if (appState.content.sagas) Object.values(appState.content.sagas).forEach(g => Object.values(g).forEach(i => allOptions.push(i)));
    if (appState.content.ucm) Object.values(appState.content.ucm).forEach(i => allOptions.push(i));

    // Render
    allOptions.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    optionsList.innerHTML = '';
    const uniqueIds = new Set();

    if (allOptions.length === 0) {
        optionsList.innerHTML = '<div class="empty-option">Vacío</div>'; return;
    }

    allOptions.forEach((item) => {
        if (uniqueIds.has(item.id)) return;
        uniqueIds.add(item.id);

        const div = document.createElement('div');
        div.className = 'custom-option';
        div.textContent = item.title + (item._isSpecial ? ' (Película)' : '');
        div.onclick = () => {
            if (searchInput) searchInput.value = item.title;
            if (hiddenInput) hiddenInput.value = item.id;
            optionsList.classList.remove('show');
        };
        optionsList.appendChild(div);
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
            stars: parseInt(rating),
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
export function renderReviewsGrid() {
    const grid = DOM.reviewsGrid; // O document.getElementById('reviews-grid-container')
    if (!grid) return;

    // Estado de carga inicial
    grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 50px;">
            <p class="loading-text">Cargando reseñas...</p>
        </div>
    `;

    // Escuchar cambios en Firebase
    db.ref('reviews').limitToLast(50).on('value', snapshot => {
        // Limpiar grid
        grid.innerHTML = '';
        
        if (!snapshot.exists()) {
            grid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">
                    <i class="far fa-comment-dots" style="font-size: 2rem; margin-bottom: 15px; display:block;"></i>
                    <p>Aún no hay reseñas. ¡Sé el primero en opinar!</p>
                </div>
            `;
            return;
        }

        // 1. Obtener y ordenar datos
        const reviews = [];
        snapshot.forEach(child => {
            const data = child.val();
            data.id = child.key;
            reviews.push(data);
        });

        // Ordenar: Más recientes primero
        reviews.reverse();

        // 2. Generar el HTML
        // Usamos un fragmento para mejor rendimiento
        const fragment = document.createDocumentFragment();

        reviews.forEach(review => {
            const card = createReviewCard(review);
            fragment.appendChild(card);
        });

        grid.appendChild(fragment);

        // 3. 🔥 ACTIVAR EL SISTEMA DE TRUNCADO (LEER MÁS)
        // Se ejecuta después de que los elementos están en el DOM
        setTimeout(() => {
            setupReviewTruncation();
        }, 100);
    });
}

// Exponer globalmente
window.renderReviews = renderReviewsGrid;

// ===========================================================
// AUXILIAR: CREAR TARJETA (LIMPIA)
// ===========================================================
function createReviewCard(review) {
    const card = document.createElement('div');
    card.className = 'review-card'; // Asegúrate de tener CSS para esto
    
    // 🔥 Almacenar datos de la reseña en la tarjeta para usarlos después
    card.dataset.reviewData = JSON.stringify(review);

    // Estrellas
    const starsHTML = 
        '<i class="fas fa-star" style="color:#e50914;"></i>'.repeat(review.stars) + 
        '<i class="far fa-star" style="color:#444;"></i>'.repeat(5 - review.stars);

    // Fecha
    const date = review.timestamp 
        ? new Date(review.timestamp).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
        : 'Reciente';

    // Botón borrar (Solo admin)
    const isAdmin = auth.currentUser && auth.currentUser.email === 'baquezadat@gmail.com'; // Tu email
    const deleteBtnHTML = isAdmin 
        ? `<button class="btn-delete-review" onclick="deleteReview('${review.id}')" title="Borrar reseña">
             <i class="fas fa-trash-alt"></i>
           </button>` 
        : '';

    // HTML de la tarjeta
    // NOTA: Ponemos el texto COMPLETO. El JS de truncado se encarga de ocultarlo si es largo.
    card.innerHTML = `
        <img src="${review.poster || 'img/default-poster.png'}" 
             class="review-poster" 
             loading="lazy" 
             alt="${review.contentTitle}"
             onerror="this.src='https://res.cloudinary.com/djhgmmdjx/image/upload/v1759209689/u71QEFc_bet4rv.png'">
        
        <div class="review-content">
            <h3 class="review-movie-title">${review.contentTitle}</h3>
            <p class="review-user">
                @${review.userName}
                <span class="review-date-tag">• ${date}</span>
            </p>
            <div class="review-stars">${starsHTML}</div>
            <p class="review-text">${review.text}</p>
        </div>
        ${deleteBtnHTML}
    `;

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
            const isTruncated = textEl.scrollHeight > textEl.clientHeight + 2; // +2 para margen de error
            
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
        }, 50); // Pequeño delay para asegurar que el DOM esté listo
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
    if (stars) stars.innerHTML = 
        '<i class="fas fa-star"></i>'.repeat(reviewData.stars) + 
        '<i class="far fa-star"></i>'.repeat(5 - reviewData.stars);

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
// EXPORTACIONES
// ===========================================================
export default {
    initReviews,
    renderReviewsGrid,
    openReviewModal,
    openFullReview,
    deleteReview,
    getStarsHTML
};
