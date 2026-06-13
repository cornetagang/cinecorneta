// ===========================================================
// MÓDULO DE RESEÑAS (REVIEWS)
// ===========================================================
// Versión: 3.0
// Fecha: 1 de Marzo 2026
// ===========================================================

let appState, DOM, auth, db, ErrorHandler, ModalManager, openConfirmationModal;

// Handler global para avatar roto — evita problemas de escaping en onerror HTML
window.onAvatarError = function(el) {
  el.parentElement.innerHTML = '<i class="fas fa-user rc-avatar-icon"></i>';
};

// Contexto local del módulo (no contamina window)
let reviewContext = {
  contentId: null,
  contentTitle: null,
  contentType: null,
  isPreselected: false,
};

// ID de la reseña que se está editando (null = nueva reseña)
let editingReviewId = null;

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

  // Sincronizar barra "Escribe tu reseña" con el estado de auth
  _syncWriteReviewTrigger();

  // Solo registrar listeners una vez para evitar duplicados
  if (isInitialized) return;
  isInitialized = true;

  console.log("⭐ Módulo de Reseñas Inicializado");

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
  // 1. Botón principal "Escribir Reseña" (legado, por si existe en algún lugar)
  if (DOM.openReviewBtn) {
    DOM.openReviewBtn.onclick = () => {
      if (!auth.currentUser) {
        openConfirmationModal(
          "Inicia Sesión",
          "Necesitas una cuenta para escribir reseñas.",
          () => { if (window.openAuthModal) window.openAuthModal(true); },
        );
        return;
      }
      openReviewModal(false);
    };
  }

  // 2. Submit del composer inline
  const inlineSubmitBtn = document.getElementById("irc-submit-btn");
  if (inlineSubmitBtn) {
    inlineSubmitBtn.onclick = () =>
      handleReviewSubmit({ preventDefault: () => {}, _inline: true });
  }

  // 3. Formulario modal (legado, por si existe)
  if (DOM.reviewForm) {
    const newForm = DOM.reviewForm.cloneNode(true);
    DOM.reviewForm.parentNode.replaceChild(newForm, DOM.reviewForm);
    DOM.reviewForm = newForm;
    newForm.onsubmit = handleReviewSubmit;
  }

  // 4. Buscador de películas dentro del modal/composer
  setupMovieSearchBox();

  // 5. Estrellas interactivas
  setupStarRating();
}

// ===========================================================
// UI: BARRA INLINE "ESCRIBE TU RESEÑA"
// ===========================================================
function _syncWriteReviewTrigger() {
  const composer = document.getElementById("inline-review-composer");

  // Sincronizar visibilidad del tab "Mis Reseñas" en cada cambio de auth
  const mineTab = document.getElementById("rv-tab-mine");
  if (mineTab) mineTab.style.display = auth.currentUser ? "" : "none";

  if (!composer) return;

  const user = auth.currentUser;

  if (!user) {
    composer.classList.add("hidden");
    return;
  }

  composer.classList.remove("hidden");

  // Actualizar avatares (colapsado y expandido)
  const avatarEls = [
    document.getElementById("wrt-avatar"),
    document.getElementById("wrt-avatar-exp"),
  ];
  avatarEls.forEach((avatarEl) => {
    if (!avatarEl) return;
    if (user.photoURL) {
      avatarEl.innerHTML = `<img src="${user.photoURL}" alt="">`;
    } else {
      const name = user.displayName || user.email?.split("@")[0] || "U";
      const initials = name.slice(0, 2).toUpperCase();
      avatarEl.innerHTML = `<span>${initials}</span>`;
    }
  });
}

// ===========================================================
// UI: EXPANDIR / COLAPSAR COMPOSER INLINE
// ===========================================================
export function expandReviewComposer() {
  if (!auth.currentUser) {
    openConfirmationModal(
      "Inicia Sesión",
      "Necesitas una cuenta para escribir reseñas.",
      () => { if (window.openAuthModal) window.openAuthModal(true); },
    );
    return;
  }
  const collapsed = document.getElementById("irc-collapsed");
  const expanded  = document.getElementById("irc-expanded");
  if (collapsed) collapsed.style.display = "none";
  if (expanded)  expanded.classList.add("irc-expanded--open");

  if (window.innerWidth <= 860) {
    document.getElementById('irc-backdrop')?.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  resetReviewForm();
  setupContextualUI(false);
  loadAllContentOptions();
}
window.expandReviewComposer = expandReviewComposer;

export function collapseReviewComposer() {
  const collapsed = document.getElementById("irc-collapsed");
  const expanded  = document.getElementById("irc-expanded");
  if (collapsed) collapsed.style.display = "";
  if (expanded)  expanded.classList.remove("irc-expanded--open");

  document.getElementById('irc-backdrop')?.classList.remove('show');
  document.body.style.overflow = '';
  
  resetReviewForm();
}
window.collapseReviewComposer = collapseReviewComposer;

// ===========================================================
// UI: ABRIR MODAL DE RESEÑA
// ===========================================================
export function openReviewModal(isContextual = false, contextData = null) {
  // Navegar a la sección de reseñas si no está visible
  const reviewsContainer = document.getElementById("reviews-container");
  const isVisible = reviewsContainer && reviewsContainer.style.display !== "none";

  const _openComposer = () => {
    resetReviewForm();

    if (isContextual && contextData) {
      reviewContext = { ...contextData, isPreselected: true };
      setupContextualUI(true);
    } else {
      reviewContext = { contentId: null, contentTitle: null, contentType: null, isPreselected: false };
      setupContextualUI(false);
      loadAllContentOptions();
    }

    // Expandir el formulario inline
    const collapsed = document.getElementById("irc-collapsed");
    const expanded  = document.getElementById("irc-expanded");
    if (collapsed) collapsed.style.display = "none";
    if (expanded)  expanded.classList.add("irc-expanded--open");

    // Scroll al formulario
    setTimeout(() => {
      expanded?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  };

  if (!isVisible) {
    // Cambiar de vista primero y luego abrir el composer
    if (window.switchView) {
      window.switchView("reviews").then(() => {
        setTimeout(_openComposer, 200);
      });
    } else {
      // Fallback: mostrar el contenedor directamente
      if (reviewsContainer) {
        reviewsContainer.style.display = "block";
        reviewsContainer.style.marginTop = "0";
      }
      if (window.renderReviewsGrid) window.renderReviewsGrid();
      setTimeout(_openComposer, 200);
    }
  } else {
    _openComposer();
  }
}

// Exponer globalmente para usar desde inline onclick
window.openReviewModal = openReviewModal;

// ===========================================================
// UI: CONFIGURAR INTERFAZ SEGÚN MODO
// ===========================================================
function setupContextualUI(isPreselected) {
  const inputContainer = document.querySelector(
    ".custom-select-input-container",
  );
  const selectedDisplay = document.getElementById("review-selected-display");
  const selectedTitle = document.getElementById("review-selected-title");
  const searchInput = document.getElementById("review-movie-search");
  const hiddenInput = document.getElementById("review-selected-id");
  const changeBtnEl = document.querySelector(".btn-change-selection");

  // 🔥 NUEVO: Selector del tipo de contenido (Para el fix de IDs duplicados)
  const contentTypeInput = document.getElementById("review-content-type");

  if (isPreselected) {
    // MODO 1: PRE-SELECCIONADO (Vengo desde el botón "Reseñar")
    // Ocultar buscador y mostrar título fijo
    if (inputContainer) inputContainer.style.display = "none";
    if (selectedDisplay) selectedDisplay.style.display = "block";

    if (selectedTitle) selectedTitle.textContent = reviewContext.contentTitle;
    if (hiddenInput) hiddenInput.value = reviewContext.contentId;
    if (searchInput) searchInput.value = reviewContext.contentTitle;

    // 🔥 NUEVO: Llenar el tipo (ej: 'series' o 'movie')
    if (contentTypeInput) {
      contentTypeInput.value = reviewContext.contentType || "movie";
      console.log(
        `📝 Contexto establecido: ${reviewContext.contentTitle} (${contentTypeInput.value})`,
      );
    }

    // Configurar botón "Cambiar" (el texto pequeño)
    if (changeBtnEl) {
      changeBtnEl.onclick = () => {
        reviewContext.isPreselected = false;
        setupContextualUI(false); // Volver a modo normal
        loadAllContentOptions(); // Cargar lista para buscar manualmente
      };
    }
  } else {
    // MODO 2: NORMAL (Buscador manual)
    // Mostrar buscador y ocultar título fijo
    if (inputContainer) inputContainer.style.display = "block";
    if (selectedDisplay) selectedDisplay.style.display = "none";

    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
    }
    if (hiddenInput) hiddenInput.value = "";

    // 🔥 NUEVO: Limpiar el tipo para evitar datos basura
    if (contentTypeInput) contentTypeInput.value = "";
  }
}

// ===========================================================
// UI: SISTEMA DE ESTRELLAS
// ===========================================================
function buildStarHalfHTML(val) {
  // Devuelve HTML de estrella según valor: 0=vacía, 0.5=media, 1=llena
  if (val >= 1) return '<i class="fas fa-star"></i>';
  if (val >= 0.5) return '<i class="fas fa-star-half-alt"></i>';
  return '<i class="far fa-star"></i>';
}

function renderStarsFromValue(value) {
  let html = "";
  for (let i = 1; i <= 5; i++) {
    const diff = value - (i - 1);
    html += buildStarHalfHTML(diff);
  }
  return html;
}

function setupStarRating() {
  const container = document.getElementById("star-rating-input");
  const ratingInput = document.getElementById("review-rating-value");
  const ratingLabel = document.getElementById("review-rating-label");
  if (!container || !ratingInput) return;

  // Reservar espacio fijo para el label desde el inicio → evita reflow al hacer hover
  if (ratingLabel) {
    ratingLabel.style.width = "3.5ch";
    ratingLabel.style.flexShrink = "0";
    ratingLabel.style.display = "inline-block";
    ratingLabel.textContent = "";
  }

  // Construir 5 wrappers, cada uno con mitad izquierda y mitad derecha
  container.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const wrapper = document.createElement("span");
    wrapper.className = "star-wrapper";
    wrapper.style.cssText =
      "position:relative; display:inline-block; cursor:pointer; color:var(--accent-color);";
    wrapper.innerHTML =
      '<i class="far fa-star star-icon" style="font-size:1.4rem; pointer-events:none;"></i>';

    // Mitad izquierda → valor i - 0.5
    const leftHalf = document.createElement("span");
    leftHalf.className = "star-half-zone";
    leftHalf.dataset.value = (i - 0.5).toFixed(1);
    leftHalf.style.cssText =
      "position:absolute; left:0; top:0; width:50%; height:100%; z-index:1;";

    // Mitad derecha → valor i
    const rightHalf = document.createElement("span");
    rightHalf.className = "star-half-zone";
    rightHalf.dataset.value = i.toFixed(1);
    rightHalf.style.cssText =
      "position:absolute; right:0; top:0; width:50%; height:100%; z-index:1;";

    wrapper.appendChild(leftHalf);
    wrapper.appendChild(rightHalf);
    container.appendChild(wrapper);
  }

  // Hover preview
  container.addEventListener("mouseover", (e) => {
    const zone = e.target.closest(".star-half-zone");
    if (zone) updateStarVisuals(parseFloat(zone.dataset.value), true);
  });
  container.addEventListener("mouseleave", () => {
    const current = parseFloat(ratingInput.value) || 0;
    updateStarVisuals(current, false);
  });

  // Click → fijar valor
  container.addEventListener("click", (e) => {
    const zone = e.target.closest(".star-half-zone");
    if (!zone) return;
    const val = parseFloat(zone.dataset.value);
    ratingInput.value = val;
    updateStarVisuals(val, false);
    if (ratingLabel) ratingLabel.textContent = val.toFixed(1).replace(".", ",");
  });
}

function updateStarVisuals(value, isHover = false) {
  const wrappers = document.querySelectorAll(".star-wrapper");
  wrappers.forEach((wrapper, index) => {
    const icon = wrapper.querySelector(".star-icon");
    if (!icon) return;
    const diff = value - index; // cuánto "rellena" esta estrella
    icon.className = "star-icon";
    icon.style.cssText = "font-size:1.4rem; pointer-events:none;";
    if (diff >= 1) {
      icon.classList.add("fas", "fa-star");
    } else if (diff >= 0.5) {
      icon.classList.add("fas", "fa-star-half-alt");
    } else {
      icon.classList.add("far", "fa-star");
    }
    if (isHover) {
      icon.style.opacity = "0.85";
    }
  });

  // Mostrar nota en hover y al seleccionar
  const ratingLabel = document.getElementById("review-rating-label");
  if (ratingLabel) {
    ratingLabel.textContent = value > 0 ? value.toFixed(1).replace(".", ",") : "\u00A0\u00A0\u00A0";
  }
}

function resetReviewForm() {
  editingReviewId = null;
  const submitBtn = DOM.reviewForm?.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = "Publicar Reseña";
  if (DOM.reviewForm) DOM.reviewForm.reset();

  const ratingInput    = document.getElementById("review-rating-value");
  const hiddenInput    = document.getElementById("review-selected-id");
  const textInput      = document.getElementById("review-text-input");
  const ratingLabel    = document.getElementById("review-rating-label");
  const selectedTitle  = document.getElementById("review-selected-title");
  const selectedDisplay = document.getElementById("review-selected-display");
  const inputContainer = document.querySelector(".custom-select-input-container");
  const searchInput    = document.getElementById("review-movie-search");
  const contentTypeInput = document.getElementById("review-content-type");

  if (ratingInput) ratingInput.value = "0";
  if (hiddenInput) hiddenInput.value = "";
  if (textInput) textInput.value = "";
  if (ratingLabel) ratingLabel.textContent = "";

  // Limpiar título seleccionado y restaurar buscador
  if (selectedTitle) selectedTitle.textContent = "";
  if (selectedDisplay) selectedDisplay.style.display = "none";
  if (inputContainer) inputContainer.style.display = "block";
  if (searchInput) searchInput.value = "";
  if (contentTypeInput) contentTypeInput.value = "";

  // Resetear contexto
  reviewContext = { contentId: null, contentTitle: null, contentType: null, isPreselected: false };

  updateStarVisuals(0);
}

// ===========================================================
// UI: BUSCADOR DE PELÍCULAS
// ===========================================================
// ===========================================================
// UI: BUSCADOR DE PELÍCULAS (optimizado)
// ===========================================================

// Índice pre-construido una sola vez (se invalida si cambia appState)
let _searchIndex = null;

// Normaliza tildes y caracteres especiales para búsqueda tolerante
function _norm(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function _buildSearchIndex() {
  if (_searchIndex) return _searchIndex;

  const items = [];
  const seen = new Set();

  const add = (id, data) => {
    if (!id || seen.has(id) || !data?.title) return;
    seen.add(id);
    items.push({
      id,
      title: data.title,
      secondTitle: data.secondTitle || "",
      titleNorm: _norm(data.title),
      secondTitleNorm: _norm(data.secondTitle || ""),
      idNorm: _norm(id.replace(/_/g, " ")),
      poster: data.poster || "",
      type: data.type || "movie",
      _isSpecial: data._isSpecial || false,
    });
  };

  if (appState.content.movies)
    Object.entries(appState.content.movies).forEach(([id, m]) => add(id, m));

  if (appState.content.series)
    Object.entries(appState.content.series).forEach(([id, serie]) => {
      add(id, { ...serie, type: "series" });
      const eps = appState.content.seriesEpisodes?.[id];
      if (eps?.pelicula) {
        const sp = eps.pelicula[0];
        add(`${id}_pelicula`, {
          title: sp.title || `${serie.title} (Película)`,
          poster: serie.poster || "",
          type: "movie",
          _isSpecial: true,
        });
      }
    });

  if (appState.content.sagas)
    Object.values(appState.content.sagas).forEach((g) =>
      Object.entries(g).forEach(([id, i]) => add(id, i)),
    );

  if (appState.content.ucm)
    Object.entries(appState.content.ucm).forEach(([id, i]) => add(id, i));

  items.sort((a, b) => a.title.localeCompare(b.title));
  _searchIndex = items;
  return items;
}

function _renderResults(optionsList, term, onSelect) {
  const items = _buildSearchIndex();
  const MAX = 12;
  const termNorm = _norm(term);
  const results = term
    ? items.filter((i) =>
        i.titleNorm.includes(termNorm) ||
        i.secondTitleNorm.includes(termNorm) ||
        i.idNorm.includes(termNorm)
      ).slice(0, MAX)
    : [];

  optionsList.innerHTML = "";

  if (!term) return; // Sin término → lista vacía (no mostrar nada)

  if (results.length === 0) {
    optionsList.innerHTML = `<div class="empty-option">Sin resultados para "${term}"</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  results.forEach((item) => {
    const div = document.createElement("div");
    div.className = "custom-option custom-option-rich";
    div.innerHTML = `
      <img src="${item.poster}" alt="" loading="lazy">
      <span class="custom-option-title">${item.title}${
        item._isSpecial ? ' <em style="font-size:0.72rem;color:#888;">(Película)</em>' : ""
      }</span>
    `;
    div.addEventListener("mousedown", (e) => {
      e.preventDefault(); // evita que el input pierda foco antes del click
      onSelect(item);
    });
    frag.appendChild(div);
  });
  optionsList.appendChild(frag);
}

function setupMovieSearchBox() {
  const searchInput = document.getElementById("review-movie-search");
  const optionsList = document.getElementById("review-movie-options");
  const searchWrap   = document.querySelector(".irc-search-wrap");

  if (!searchInput || !optionsList) return;

  // Reconstruir índice si se vuelve a abrir el composer
  _searchIndex = null;

  const hiddenInput     = document.getElementById("review-selected-id");
  const contentTypeInput = document.getElementById("review-content-type");
  const display         = document.getElementById("review-selected-display");
  const titleEl         = document.getElementById("review-selected-title");
  const inputContainer  = document.getElementById("irc-search-container");

  const closeList = () => optionsList.classList.remove("show");
  const openList  = () => {
    if (optionsList.innerHTML) optionsList.classList.add("show");
  };

  // Selección de un item
  const handleSelect = (item) => {
    searchInput.value = item.title;
    if (hiddenInput)      hiddenInput.value = item.id;
    if (contentTypeInput) contentTypeInput.value = item.type;
    closeList();

    // Mostrar display de confirmación con poster
    if (display) {
      let posterEl = display.querySelector(".review-selected-poster");
      if (!posterEl) {
        posterEl = document.createElement("img");
        posterEl.className = "review-selected-poster";
        posterEl.style.cssText = "width:28px;height:40px;object-fit:cover;border-radius:4px;flex-shrink:0;";
        display.insertBefore(posterEl, display.firstChild);
      }
      posterEl.src = item.poster;
      if (titleEl) titleEl.textContent = item.title;
      display.style.display = "flex";
      display.style.alignItems = "center";
      display.style.gap = "10px";
    }
    if (inputContainer) inputContainer.style.display = "none";
  };

  // Debounce de 220 ms — solo busca cuando el usuario hace pausa
  let debounceTimer = null;
  searchInput.addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    const term = e.target.value.trim().toLowerCase();

    if (term.length < 2) {
      optionsList.innerHTML = "";
      closeList();
      return;
    }

    debounceTimer = setTimeout(() => {
      _renderResults(optionsList, term, handleSelect);
      if (optionsList.innerHTML) optionsList.classList.add("show");
    }, 220);
  });

  searchInput.addEventListener("focus", openList);

  // Cerrar al hacer click fuera
  document.addEventListener("click", (e) => {
    if (searchWrap && !searchWrap.contains(e.target)) closeList();
  });
}

// Mantener compatible con el flujo contextual (modo preseleccionado)
function loadAllContentOptions() {
  // En el nuevo flujo la lista se carga bajo demanda al escribir.
  // Esta función se conserva para no romper setupContextualUI.
  _searchIndex = null; // forzar reconstrucción en la próxima búsqueda
}

// ===========================================================
// LÓGICA: ENVIAR RESEÑA
// ===========================================================
async function handleReviewSubmit(e) {
  e.preventDefault();

  const isInline = e._inline === true;

  const user = auth.currentUser;
  if (!user) {
    ErrorHandler.show("auth", "Debes iniciar sesión.");
    return;
  }

  const contentId = document.getElementById("review-selected-id")?.value;
  const contentType =
    document.getElementById("review-content-type")?.value || "movie";
  const rating = document.getElementById("review-rating-value")?.value;
  const text = document.getElementById("review-text-input")?.value.trim();

  if (!contentId)
    return ErrorHandler.show("content", "Selecciona una película.");
  if (rating === "0" || !rating)
    return ErrorHandler.show("content", "Debes dar una calificación.");
  if (!text || text.length < 2)
    return ErrorHandler.show("content", "Escribe una reseña válida.");

  // Referencia al botón según si es inline o modal
  const submitBtn = isInline
    ? document.getElementById("irc-submit-btn")
    : DOM.reviewForm?.querySelector('button[type="submit"]');

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Publicando...";
  }

  try {
    // Si estamos editando, saltamos verificación de duplicados
    if (editingReviewId) {
      await db.ref(`reviews/${editingReviewId}`).update({
        stars: parseFloat(rating),
        text: text,
        editedAt: firebase.database.ServerValue.TIMESTAMP,
      });
      if (window.showNotification)
        window.showNotification("¡Reseña actualizada!", "success");
      else ErrorHandler.show("success", "¡Reseña actualizada!");
      if (isInline) {
        collapseReviewComposer();
      } else {
        ModalManager.closeAll();
      }
      resetReviewForm();
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Publicar Reseña";
      }
      return;
    }

    // 1. Verificar duplicados (LÓGICA MEJORADA)
    const existing = await db
      .ref("reviews")
      .orderByChild("userId")
      .equalTo(user.uid)
      .once("value");

    let duplicado = false;
    existing.forEach((child) => {
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
        `Ya tienes una reseña para esta ${contentType === "series" ? "serie" : "película"}.`,
        () => ModalManager.closeAll(),
      );
      if (document.getElementById("confirm-delete-btn"))
        document.getElementById("confirm-delete-btn").textContent = "Entendido";
      return; // Importante: Salir aquí
    }

    // 2. Buscar datos y Guardar
    const itemData = findContentData(contentId);

    await db.ref("reviews").push({
      userId: user.uid,
      userName: user.displayName || "Usuario",
      userEmail: user.email,
      userPhotoURL: user.photoURL || null,
      contentId: contentId,
      contentType: contentType,
      contentTitle: itemData ? itemData.title : "Desconocido",
      poster: itemData ? itemData.poster : "",
      banner: itemData ? itemData.banner : "",
      stars: parseFloat(rating),
      text: text,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
    });

    // 3. Éxito
    if (window.showNotification) {
      window.showNotification("¡Reseña publicada exitosamente!", "success");
    } else {
      ErrorHandler.show("success", "¡Reseña publicada!");
    }

    if (isInline) {
      collapseReviewComposer();
    } else {
      ModalManager.closeAll();
    }
    resetReviewForm();
  } catch (error) {
    console.error("Error:", error);
    ErrorHandler.show("database", "Error al publicar.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Publicar Reseña";
    }
  }
}

// ===========================================================
// LÓGICA: BUSCAR DATOS DE CONTENIDO
// ===========================================================
function findContentData(contentId) {
  if (!contentId) return null;

  // --- CASO PELÍCULA (Jujutsu Kaisen 0) ---
  if (contentId.includes("_pelicula")) {
    const parentId = contentId.replace("_pelicula", "");

    // 1. Acceder a las hojas de datos
    const parentSeries = appState.content.series[parentId];
    const episodesSheet = appState.content.seriesEpisodes[parentId];
    const postersSheet = appState.content.seasonPosters[parentId];

    if (parentSeries && episodesSheet && episodesSheet["pelicula"]) {
      // A. TÍTULO (Hoja Episodios)
      // Tu Excel tiene: seriesId | seasonNum | title
      const epData = episodesSheet["pelicula"][0];
      const realTitle = epData.title || `${parentSeries.title} (Película)`;

      // B. PÓSTER (Hoja PostersTemporadas)
      // Tu Excel tiene: seriesId | seasonNumber | (Columna oculta de la URL)
      let realPoster = parentSeries.poster; // Fallback

      if (postersSheet && postersSheet["pelicula"]) {
        const pData = postersSheet["pelicula"];

        // 🛠️ AQUÍ ESTABA EL ERROR:
        // Si pData es un objeto (fila de excel), sacamos la url.
        // Si pData es texto directo, lo usamos.
        if (typeof pData === "object") {
          // Intenta adivinar el nombre de la columna de la imagen
          realPoster =
            pData.posterUrl || pData.poster || pData.url || pData.img;
        } else {
          realPoster = pData;
        }
      }
      // Fallback: Si no hay poster en la hoja PostersTemporadas, usar miniatura del episodio
      else if (epData.thumbnail) {
        realPoster = epData.thumbnail;
      }

      // Debug para que veas en la consola (F12) qué encontró
      console.log("🎬 Película detectada:", {
        title: realTitle,
        poster: realPoster,
      });

      return {
        id: contentId,
        title: realTitle,
        poster: realPoster,
        type: "movie",
        banner: parentSeries.banner,
        synopsis: epData.description || parentSeries.synopsis,
      };
    }
  }

  // --- BÚSQUEDA NORMAL ---
  if (appState.content.movies && appState.content.movies[contentId])
    return appState.content.movies[contentId];
  if (appState.content.series && appState.content.series[contentId])
    return appState.content.series[contentId];
  if (appState.content.sagas) {
    for (let key in appState.content.sagas) {
      if (appState.content.sagas[key][contentId])
        return appState.content.sagas[key][contentId];
    }
  }
  if (appState.content.ucm && appState.content.ucm[contentId])
    return appState.content.ucm[contentId];

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
let _activeTab = "all";
let _activeStarFilter = "all";
let _activeUserFilter = "";
let _currentPage = 1;
const REVIEWS_PER_PAGE = 6;

export function renderReviewsGrid() {
  // ✅ FIX: sincronizar el composer con el estado de auth actual
  _syncWriteReviewTrigger();

  const grid = DOM.reviewsGrid;
  if (!grid) return;

  grid.className = "reviews-list";
  grid.innerHTML = `<div class="reviews-loading"><i class="fas fa-spinner fa-spin"></i> Cargando reseñas...</div>`;

  db.ref("reviews")
    .limitToLast(500)
    .on("value", async (snapshot) => {
      grid.innerHTML = "";

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
      snapshot.forEach((child) => {
        const data = child.val();
        data.id = child.key;
        reviews.push(data);
      });

      reviews.reverse();

      // --- Estado global ---
      // Solo reiniciar filtros en la primera carga; en actualizaciones en tiempo real
      // se preserva el filtro activo para no interrumpir al usuario.
      const isFirstLoad = _allReviews.length === 0;
      _allReviews = reviews;

      if (isFirstLoad) {
        _filteredReviews = reviews;
        _activeTab = "all";
        _activeStarFilter = "all";
        _activeUserFilter = "";
        _currentPage = 1;
      }

      // --- Estadísticas ---
      _renderStatsPanel(reviews);

      // --- Panel de usuarios ---
      _renderUsersPanel(reviews);

      // --- Configurar tabs (solo primera vez) ---
      _setupTabsBar();

      // --- Pre-cargar conteos de comentarios ---
      const commentCountsSnap = await db.ref("review_comments").once("value");
      _commentCounts = {};
      if (commentCountsSnap.exists()) {
        commentCountsSnap.forEach((child) => {
          _commentCounts[child.key] = child.numChildren();
        });
      }

      // Re-aplica el filtro actual (preserva selección del usuario en actualizaciones)
      _applyAllFilters();
    });
}

function _renderFiltered() {
  const grid = DOM.reviewsGrid;
  if (!grid) return;

  grid.innerHTML = "";

  if (_filteredReviews.length === 0) {
    let msg = "No hay reseñas que coincidan con los filtros.";
    if (_activeTab === "mine") msg = "Aún no has escrito ninguna reseña.";
    else if (_activeTab === "user" && _activeUserFilter)
      msg = `No se encontraron reseñas de "@${_activeUserFilter}".`;
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
  pageReviews.forEach((review) => {
    const card = createReviewCard(review, _commentCounts[review.id] || 0);
    fragment.appendChild(card);
  });
  grid.appendChild(fragment);

  _renderPagination();
}

function _renderPagination() {
  // Buscar o crear el contenedor de paginación
  let paginationEl = document.getElementById("reviews-pagination");
  if (!paginationEl) {
    paginationEl = document.createElement("div");
    paginationEl.id = "reviews-pagination";
    paginationEl.className = "reviews-pagination";
    // Insertar DESPUÉS del contenedor flex de dos columnas, no dentro de él
    const twoCol = DOM.reviewsGrid.closest(".reviews-two-col");
    const insertAfter = twoCol || DOM.reviewsGrid;
    insertAfter.insertAdjacentElement("afterend", paginationEl);
  }

  const total = _filteredReviews.length;
  const totalPages = Math.ceil(total / REVIEWS_PER_PAGE);

  if (totalPages <= 1) {
    paginationEl.innerHTML = "";
    return;
  }

  const start = (_currentPage - 1) * REVIEWS_PER_PAGE + 1;
  const end = Math.min(_currentPage * REVIEWS_PER_PAGE, total);

  // Construir botones de páginas (mostrar hasta 5 páginas alrededor de la actual)
  let pageButtons = "";
  const delta = 2;
  const left = Math.max(1, _currentPage - delta);
  const right = Math.min(totalPages, _currentPage + delta);

  if (left > 1) {
    pageButtons += `<button class="rvpag-btn rp-btn" data-page="1">1</button>`;
    if (left > 2) pageButtons += `<span class="rp-dots">…</span>`;
  }
  for (let i = left; i <= right; i++) {
    pageButtons += `<button class="rvpag-btn rp-btn ${i === _currentPage ? "rp-active" : ""}" data-page="${i}">${i}</button>`;
  }
  if (right < totalPages) {
    if (right < totalPages - 1) pageButtons += `<span class="rp-dots">…</span>`;
    pageButtons += `<button class="rvpag-btn rp-btn" data-page="${totalPages}">${totalPages}</button>`;
  }

  paginationEl.innerHTML = `
        <div class="rp-divider"></div>
        <div class="rp-info">${start}–${end} de ${total} reseñas</div>
        <div class="rp-controls">
            <button class="rvpag-btn rp-btn rp-arrow rp-prev" data-page="${_currentPage - 1}" ${_currentPage === 1 ? "disabled" : ""}>
                <i class="fas fa-chevron-left"></i>
            </button>
            <div class="rp-pages">${pageButtons}</div>
            <button class="rvpag-btn rp-btn rp-arrow rp-next" data-page="${_currentPage + 1}" ${_currentPage === totalPages ? "disabled" : ""}>
                <i class="fas fa-chevron-right"></i>
            </button>
        </div>
    `;

  paginationEl.querySelectorAll(".rvpag-btn:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = parseInt(btn.dataset.page);
      if (page && page !== _currentPage) {
        _currentPage = page;
        _renderFiltered();
        // Scroll suave al tope del grid
        DOM.reviewsGrid.scrollIntoView({ behavior: "smooth", block: "start" });
        // Scroll al tope del contenedor de reseñas para leer desde arriba
        const reviewsContainer = document.getElementById("reviews-container");
        if (reviewsContainer) {
          reviewsContainer.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      }
    });
  });
}

function _applyAllFilters() {
  let result = _allReviews;
  const currentUser = auth.currentUser;
  let contextLabel = null;

  if (_activeTab === "mine" && currentUser) {
    result = result.filter((r) => r.userId === currentUser.uid);
    const name = currentUser.displayName || currentUser.email?.split("@")[0] || "tu cuenta";
    contextLabel = `@${name}`;
  } else if (_activeTab === "user" && _activeUserFilter) {
    const term = _activeUserFilter.toLowerCase();
    result = result.filter((r) =>
      (r.userName || "").toLowerCase().includes(term),
    );
    contextLabel = `@${_activeUserFilter}`;
  }

  // Actualizar estadísticas con el subconjunto contextual (antes del filtro por estrellas)
  _renderStatsPanel(result, contextLabel);

  if (_activeStarFilter !== "all") {
    const groupRating = (s) => Math.max(1, Math.floor(s || 0));
    result = result.filter((r) => groupRating(r.stars) === _activeStarFilter);
  }

  _filteredReviews = result;
  _currentPage = 1;
  _renderFiltered();
}

function _setupTabsBar() {
  const bar = document.getElementById("reviews-tabs-bar");
  if (!bar || bar.dataset.ready === "1") return;
  bar.dataset.ready = "1";

  const mineTab = document.getElementById("rv-tab-mine");
  if (mineTab) mineTab.style.display = auth.currentUser ? "" : "none";

  bar.querySelectorAll(".rv-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      bar.querySelectorAll(".rv-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      _activeTab = btn.dataset.tab;
      _activeUserFilter = "";
      _activeStarFilter = "all";
      document.querySelectorAll(".rsp-chip").forEach((b) =>
        b.classList.toggle("active", b.dataset.stars === "all"),
      );
      // Deseleccionar usuario activo en el panel
      document.querySelectorAll(".rsp-user-item").forEach(el => el.classList.remove("active"));
      _applyAllFilters();
    });
  });
}

// ── Panel lateral de usuarios con reseñas ───────────────────────────────
function _renderUsersPanel(reviews) {
  const panel = document.getElementById("rsp-users-panel");
  const list  = document.getElementById("rsp-users-list");
  if (!panel || !list) return;

  // Agrupar por usuario y contar
  const map = {};
  reviews.forEach((r) => {
    const uid  = r.userId || r.userName;
    const name = r.userName || "Usuario";
    const photo = r.userPhotoURL || null;
    if (!map[uid]) map[uid] = { uid, name, photo, count: 0 };
    map[uid].count++;
  });

  const users = Object.values(map).sort((a, b) => b.count - a.count);
  if (!users.length) { panel.style.display = "none"; return; }

  panel.style.display = "block";
  list.innerHTML = "";

  users.forEach((u) => {
    const initials = u.name.substring(0, 2).toUpperCase();
    const avatarHTML = u.photo
      ? `<img src="${u.photo}" alt="" onerror="this.parentElement.innerHTML='<span>${initials}</span>'">`
      : `<span>${initials}</span>`;

    const li = document.createElement("li");
    li.className = "rsp-user-item";
    li.dataset.username = u.name;
    li.innerHTML = `
      <div class="rsp-user-avatar">${avatarHTML}</div>
      <div class="rsp-user-info">
        <span class="rsp-user-name">@${u.name}</span>
        <span class="rsp-user-count">${u.count} reseña${u.count !== 1 ? "s" : ""}</span>
      </div>`;

    li.addEventListener("click", () => {
      const isActive = li.classList.contains("active");

      // Toggle: si ya estaba activo, vuelve a "Todas"
      list.querySelectorAll(".rsp-user-item").forEach(el => el.classList.remove("active"));
      document.querySelectorAll(".rv-tab").forEach(b => b.classList.remove("active"));

      if (isActive) {
        _activeTab = "all";
        _activeUserFilter = "";
        document.querySelector(".rv-tab[data-tab='all']")?.classList.add("active");
      } else {
        li.classList.add("active");
        _activeTab = "user";
        _activeUserFilter = u.name;
        _activeStarFilter = "all";
        document.querySelectorAll(".rsp-chip").forEach(b =>
          b.classList.toggle("active", b.dataset.stars === "all")
        );
      }
      _applyAllFilters();
    });

    list.appendChild(li);
  });
}

function _renderStatsPanel(reviews, contextLabel = null) {
  const panel = document.getElementById("reviews-stats-panel");
  if (!panel) return;

  // Label contextual solo para "Mis reseñas", nunca para filtro de usuario
  let labelEl = document.getElementById("rsp-context-label");
  if (!labelEl) {
    labelEl = document.createElement("p");
    labelEl.id = "rsp-context-label";
    labelEl.className = "rsp-context-label";
    panel.insertBefore(labelEl, panel.firstChild);
  }
  // Solo mostrar si es "Mis Reseñas" (tab mine), no para filtro de usuario del panel
  if (contextLabel && _activeTab === "mine") {
    labelEl.textContent = contextLabel;
    labelEl.style.display = "block";
  } else {
    labelEl.style.display = "none";
  }

  const total = reviews.length;
  const avg = total > 0
    ? (reviews.reduce((s, r) => s + (r.stars || 0), 0) / total).toFixed(1)
    : "—";

  // Distribución: agrupar en enteros (0.5/1.5 → 1, 2.5 → 2, 3.5 → 3, 4.5 → 4, 5 → 5)
  const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  const groupRating = (stars) => Math.max(1, Math.floor(stars || 0));
  reviews.forEach((r) => {
    const group = groupRating(r.stars);
    if (dist[group] !== undefined) dist[group]++;
  });

  // ── MÓVIL: Compact view (número + estrellas + chips) ─────────────
  const avgEl = document.getElementById("rsp-avg");
  const starsEl = document.getElementById("rsp-stars");
  const countEl = document.getElementById("rsp-count");
  const chipsEl = document.getElementById("rsp-chips");

  if (avgEl) avgEl.textContent = avg;
  if (starsEl) {
    const avgNum = parseFloat(avg);
    starsEl.innerHTML = isNaN(avgNum) ? "" : renderStarsFromValue(avgNum);
  }
  if (countEl) countEl.textContent = `${total} reseña${total !== 1 ? "s" : ""}`;

  if (chipsEl) {
    const allActive = _activeStarFilter === "all";
    const allChip = `<button class="rsp-chip${allActive ? " active" : ""}" data-stars="all">Todas <span class="rsp-chip-n">${total}</span></button>`;
    const starChips = [5, 4, 3, 2, 1]
      .map((n) => {
        const count = dist[n] || 0;
        const isActive = _activeStarFilter === n;
        return `<button class="rsp-chip${isActive ? " active" : ""}" data-stars="${n}">${n}★ <span class="rsp-chip-n">${count}</span></button>`;
      })
      .join("");
    chipsEl.innerHTML = allChip + starChips;

    chipsEl.querySelectorAll(".rsp-chip").forEach((chip) => {
      chip.onclick = () => {
        const val = chip.dataset.stars;
        _applyStarFilter(val === "all" ? "all" : parseFloat(val));
      };
    });
  }

  // ── DESKTOP: Gráfica de barras ────────────────────────────────────
  let chartEl = document.getElementById("rsp-chart");
  if (!chartEl) {
    chartEl = document.createElement("div");
    chartEl.id = "rsp-chart";
    chartEl.className = "rsp-chart";
    panel.appendChild(chartEl);
  }

  const avgNum = parseFloat(avg);
  const starsHtml = !isNaN(avgNum) ? renderStarsFromValue(avgNum) : "";

  const chartRows = [5, 4, 3, 2, 1].map((n) => {
    const count = dist[n] || 0;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const isActive = _activeStarFilter === n;
    return `
      <div class="rsp-chart-row">
        <button class="rsp-chart-star-btn rsp-chip${isActive ? " active" : ""}" data-stars="${n}">${n}★</button>
        <div class="rsp-chart-bar-track">
          <div class="rsp-chart-bar-fill" style="width:${pct}%"></div>
        </div>
        <span class="rsp-chart-count">${count}</span>
      </div>`;
  }).join("");

  const allRow = `
    <div class="rsp-chart-row">
      <button class="rsp-chart-star-btn rsp-chip${_activeStarFilter === "all" ? " active" : ""}" data-stars="all" style="min-width:38px;text-align:center;">Todas</button>
      <div class="rsp-chart-bar-track">
        <div class="rsp-chart-bar-fill" style="width:100%;opacity:0.35"></div>
      </div>
      <span class="rsp-chart-count">${total}</span>
    </div>`;

  chartEl.innerHTML = `
    <div class="rsp-chart-header">
      <div class="rsp-chart-big-num">${avg}</div>
      <div class="rsp-chart-meta">
        <div class="rsp-chart-stars">${starsHtml}</div>
        <div class="rsp-chart-total">${total} reseña${total !== 1 ? "s" : ""}</div>
      </div>
    </div>
    <div class="rsp-chart-bars">${allRow}${chartRows}</div>`;

  // Wire clicks en la gráfica
  chartEl.querySelectorAll("[data-stars]").forEach((el) => {
    el.onclick = () => {
      const val = el.dataset.stars;
      _applyStarFilter(val === "all" ? "all" : parseFloat(val));
    };
  });

  panel.style.display = "flex";
}

function _applyStarFilter(stars) {
  _activeStarFilter = stars;
  document.querySelectorAll(".rsp-chip").forEach((b) => {
    b.classList.toggle("active", b.dataset.stars === String(stars));
  });
  _applyAllFilters();
}

// Exponer globalmente
window.renderReviews = renderReviewsGrid;

// ===========================================================
// AUXILIAR: CREAR TARJETA ESTILO IMDB
// ===========================================================
function createReviewCard(review, initialCommentCount = 0) {
  const card = document.createElement("div");
  card.className = "review-card";
  card.dataset.reviewData = JSON.stringify(review);

  const starsHTML = renderStarsFromValue(review.stars || 0);

  const date = review.timestamp
    ? (() => {
        const d = new Date(review.timestamp);
        const fecha = d.toLocaleDateString("es-ES", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
        const hora = d.toLocaleTimeString("es-ES", {
          hour: "2-digit",
          minute: "2-digit",
        });
        return `${fecha} · ${hora}`;
      })()
    : "Reciente";

  const dateShort = review.timestamp
    ? (() => {
        const d = new Date(review.timestamp);
        return d.toLocaleDateString("es-ES", {
          day: "numeric",
          month: "numeric",
          year: "numeric",
        }) + " · " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
      })()
    : "Reciente";

  // ── Resolver URL del banner (backdrop) ──────────────────────
  // 1) Campo banner guardado en el review (reviews nuevas)
  // 2) Lookup en appState por contentId (reviews viejas sin banner)
  // 3) Fallback al poster
  const _contentData = review.contentId ? findContentData(review.contentId) : null;
  const bannerUrl = review.banner
    || _contentData?.banner
    || review.poster
    || "";

  const isAdmin =
    auth.currentUser && auth.currentUser.email === "baquezadat@gmail.com";
  const isOwner = auth.currentUser && auth.currentUser.uid === review.userId;

  const deleteBtnHTML =
    isAdmin || isOwner
      ? `<button class="btn-delete-review" onclick="deleteReview('${review.id}')" title="Borrar reseña"><i class="fas fa-trash-alt"></i></button>`
      : "";

  const editBtnHTML = isOwner
    ? `<button class="btn-edit-review" data-review-id="${review.id}" data-stars="${review.stars}" data-content-id="${review.contentId || ""}" data-content-type="${review.contentType || "movie"}" data-title="${(review.contentTitle || "").replace(/"/g, "&quot;")}" title="Editar reseña"><i class="fas fa-pen"></i></button>`
    : "";

  const fullText = review.text || "";

  // Avatar: foto real o iniciales del usuario
  const photo =
    review.userPhotoURL ||
    (auth.currentUser?.uid === review.userId
      ? auth.currentUser?.photoURL
      : null);
  const initials = (review.userName || "U").substring(0, 2).toUpperCase();
  const avatarHTML = photo
    ? `<div class="rc-avatar"><img src="${photo}" alt="" onerror="onAvatarError(this)"></div>`
    : `<div class="rc-avatar">${initials}</div>`;

  card.innerHTML = `
        <!-- ── MEDIA: poster izquierda + banner derecha ── -->
        <div class="rc-media">
            <div class="rc-media-banner">
                <img src="${bannerUrl}" alt="" onerror="this.style.opacity='0'">
            </div>
            <div class="rc-media-scrim"></div>

            <!-- Botones de acción (top-right del banner) -->
            <div class="rc-media-actions">
                ${editBtnHTML}
                ${deleteBtnHTML}
            </div>

            <!-- Floor: poster + título + autor + estrellas -->
            <div class="rc-media-floor">
                <img class="rc-media-poster"
                     src="${review.poster || ""}"
                     alt="${review.contentTitle || ""}"
                     onerror="this.src='https://res.cloudinary.com/djhgmmdjx/image/upload/v1759209689/u71QEFc_bet4rv.png'">
                <div class="rc-media-info">
                    <h3 class="rc-media-film-title">${review.contentTitle || ""}</h3>
                    <div class="rc-media-meta">
                        ${avatarHTML}
                        <span class="rc-author-name rc-author-link"
                              data-userid="${review.userId}"
                              data-username="${review.userName}"
                              data-photo="${photo || ""}">@${review.userName}</span>
                        <span class="rc-yt-dot rc-meta-full">·</span>
                        <span class="rc-date rc-meta-full">${date}</span>
                        <span class="rc-date rc-meta-short">${dateShort}</span>
                    </div>
                    <div class="rc-stars">${starsHTML}<span class="rc-stars-num">${review.stars}/5</span></div>
                </div>
            </div>
        </div>

        <!-- ── BODY: solo texto + footer ── -->
        <div class="rc-body">

            <!-- Texto de la reseña -->
            <p class="rc-text">${fullText}</p>

            <!-- Footer: like + comentarios -->
            <div class="social-footer">
                <div class="rc-footer-actions">
                    <div class="rc-yt-vote-group">
                        <button class="rc-like-btn" data-review-id="${review.id}">
                            <i class="far fa-heart"></i>
                            <span class="rc-like-count">0</span>
                        </button>
                    </div>
                    <button class="rc-comment-toggle" data-review-id="${review.id}">
                        <i class="far fa-comment-dots"></i>
                        <span class="rc-reply-label">${initialCommentCount > 0 ? `${initialCommentCount} comentario${initialCommentCount !== 1 ? "s" : ""}` : "Comentar"}</span>
                        ${initialCommentCount > 0 ? `<i class="fas fa-chevron-right rc-reply-chevron"></i>` : ""}
                    </button>
                </div>
            </div>

        </div><!-- /rc-body -->

        <!-- Área de comentarios (fuera del body para expandirse sin clip) -->
        <div class="rc-comments-area" style="display:none;">
            <div class="crm-comments-list" id="comments-${review.id}">
                <div class="crm-comments-loading"><i class="fas fa-spinner fa-spin"></i></div>
            </div>
            ${
              auth.currentUser
                ? `
            <div class="crm-comment-input-row">
                <i class="fas fa-user-circle crm-comment-input-avatar"></i>
                <!-- Botón + solo en mobile -->
                <div class="crm-add-media-wrap">
                    <button class="crm-add-media-btn" type="button" title="Adjuntar media">
                        <i class="fas fa-plus"></i>
                    </button>
                    <div class="crm-add-media-menu" style="display:none;">
                        <label class="crm-add-media-item crm-add-photo-item">
                            <i class="fas fa-image"></i> Foto
                        </label>
                        <button class="crm-add-gif-item crm-add-media-item" type="button">
                            <i class="fas fa-film"></i> GIF
                        </button>
                    </div>
                </div>
                <div class="crm-comment-input-wrap">
                    <div class="crm-media-previews">
                        <div class="crm-img-preview-wrap" style="display:none;">
                            <img class="crm-img-preview" src="" alt="preview">
                            <button class="crm-img-remove" title="Quitar imagen"><i class="fas fa-times"></i></button>
                        </div>
                        <div class="crm-gif-preview-wrap" style="display:none;">
                            <img class="crm-gif-preview" src="" alt="gif preview">
                            <button class="crm-gif-preview-remove" title="Quitar GIF"><i class="fas fa-times"></i></button>
                        </div>
                    </div>
                    <div class="crm-gif-picker" style="display:none;">
                        <div class="crm-gif-search-row">
                            <input type="text" class="crm-gif-search-input" placeholder="Buscar GIF...">
                            <button class="crm-gif-close" type="button"><i class="fas fa-times"></i></button>
                        </div>
                        <div class="crm-gif-results"></div>
                    </div>
                    <div class="crm-input-row">
                        <textarea class="crm-comment-input" placeholder="Comentar..." rows="1"></textarea>
                        <label class="crm-img-btn" title="Adjuntar imagen">
                            <i class="fas fa-image"></i>
                            <input type="file" class="crm-img-input" accept="image/*" style="display:none;">
                        </label>
                        <button class="crm-gif-btn" title="Buscar GIF" type="button">GIF</button>
                        <button class="crm-comment-send" data-review-id="${review.id}">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                </div>
            </div>`
                : `<p class="crm-login-hint"><i class="fas fa-lock"></i> Inicia sesión para comentar</p>`
            }
        </div><!-- /rc-comments-area -->
    `;

  // Botón editar
  const editBtn = card.querySelector(".btn-edit-review");
  if (editBtn) {
    editBtn.addEventListener("click", () => {
      const rid = editBtn.dataset.reviewId;
      const stars = parseFloat(editBtn.dataset.stars);
      const title = editBtn.dataset.title || "";
      const contentId = editBtn.dataset.contentId || "";
      const contentType = editBtn.dataset.contentType || "movie";
      const rev = (_allReviews || []).find((r) => r.id === rid);
      const text = rev ? rev.text || "" : "";
      editReview(rid, stars, text, title, contentId, contentType);
    });
  }

  // Botón like
  const likeBtn = card.querySelector(".rc-like-btn");
  const likeCountEl = likeBtn?.querySelector(".rc-like-count");
  if (likeBtn && likeCountEl) {
    const reviewId = review.id;
    const uid = auth.currentUser?.uid;
    const likesRef = db.ref(`review_likes/${reviewId}`);
    likesRef.on("value", (snap) => {
      const likes = snap.val() || {};
      const count = Object.keys(likes).length;
      likeCountEl.textContent = count;
      if (uid && likes[uid]) {
        likeBtn.classList.add("liked");
        likeBtn.querySelector("i").className = "fas fa-heart";
      } else {
        likeBtn.classList.remove("liked");
        likeBtn.querySelector("i").className = "far fa-heart";
      }
    });
    likeBtn.addEventListener("click", async () => {
      if (!auth.currentUser) {
        if (window.showNotification)
          window.showNotification("Inicia sesión para dar like", "info");
        return;
      }
      const myLikeRef = db.ref(`review_likes/${reviewId}/${uid}`);
      const snap = await myLikeRef.once("value");
      if (snap.exists()) await myLikeRef.remove();
      else await myLikeRef.set(true);
    });
  }

  // Toggle comentarios
  const commentToggle = card.querySelector(".rc-comment-toggle");

  commentToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const data = JSON.parse(card.dataset.reviewData);
    openFullReview(data);
  });

  // Enviar comentario
  if (auth.currentUser) {
    const sendBtn = card.querySelector(".crm-comment-send");
    const inputEl = card.querySelector(".crm-comment-input");

    inputEl.addEventListener("input", () => {
      inputEl.style.height = "auto";
      inputEl.style.height = inputEl.scrollHeight + "px";
    });
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });
    // Imagen adjunta
    const imgInput = card.querySelector(".crm-img-input");
    const imgPreviewWrap = card.querySelector(".crm-img-preview-wrap");
    const imgPreview = card.querySelector(".crm-img-preview");
    const imgRemoveBtn = card.querySelector(".crm-img-remove");
    let pendingImageFile = null;
    let commentsLoaded = false;

    if (imgInput) {
      imgInput.addEventListener("change", () => {
        const file = imgInput.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
          if (window.showNotification)
            window.showNotification("La imagen no puede superar 5MB", "error");
          return;
        }
        pendingImageFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
          imgPreview.src = e.target.result;
          imgPreviewWrap.style.display = "block";
        };
        reader.readAsDataURL(file);
      });
    }

    if (imgRemoveBtn) {
      imgRemoveBtn.addEventListener("click", () => {
        pendingImageFile = null;
        imgPreviewWrap.style.display = "none";
        imgPreview.src = "";
        if (imgInput) imgInput.value = "";
      });
    }

    // GIF picker
    const gifBtn = card.querySelector(".crm-gif-btn");
    const gifPicker = card.querySelector(".crm-gif-picker");
    const gifSearchInput = card.querySelector(".crm-gif-search-input");
    const gifResults = card.querySelector(".crm-gif-results");
    const gifClose = card.querySelector(".crm-gif-close");
    const GIPHY_KEY = "XYG1rqTv26FibnEq5SRJeGPeAPegvn3q";
    const GIF_LIMIT = 24;
    let gifSearchTimeout = null;
    let pendingGifUrl = null;
    let gifCurrentQuery = "";
    let gifOffset = 0;
    let gifHasMore = true;
    let gifLoading = false;

    async function searchGifs(query, offset = 0) {
      const endpoint = query
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(query)}&limit=${GIF_LIMIT}&offset=${offset}&rating=r`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=${GIF_LIMIT}&offset=${offset}&rating=r`;
      const res = await fetch(endpoint);
      const data = await res.json();
      gifHasMore = (data.pagination?.total_count || 0) > offset + GIF_LIMIT;
      return data.data || [];
    }

    function appendGifs(gifs) {
      // Eliminar botón "Cargar más" si existe
      const oldBtn = gifResults.querySelector(".crm-gif-more-btn");
      if (oldBtn) oldBtn.remove();

      gifs.forEach((gif) => {
        const img = document.createElement("img");
        img.src = gif.images.fixed_height_small.url;
        img.className = "crm-gif-item";
        img.addEventListener("click", () => {
          pendingGifUrl = gif.images.downsized.url;
          const gifPreviewEl = card.querySelector(".crm-gif-preview");
          const gifPreviewWrap = card.querySelector(".crm-gif-preview-wrap");
          if (gifPreviewEl) gifPreviewEl.src = pendingGifUrl;
          if (gifPreviewWrap) gifPreviewWrap.style.display = "block";
          gifPicker.style.display = "none";
        });
        gifResults.appendChild(img);
      });

      // Botón "Cargar más" si hay más resultados
      if (gifHasMore) {
        const moreBtn = document.createElement("button");
        moreBtn.className = "crm-gif-more-btn";
        moreBtn.innerHTML = '<i class="fas fa-plus"></i> Cargar más';
        moreBtn.addEventListener("click", async () => {
          if (gifLoading) return;
          gifLoading = true;
          moreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
          gifOffset += GIF_LIMIT;
          const more = await searchGifs(gifCurrentQuery, gifOffset);
          gifLoading = false;
          appendGifs(more);
        });
        gifResults.appendChild(moreBtn);
      }
    }

    async function renderGifs(query = "") {
      gifCurrentQuery = query;
      gifOffset = 0;
      gifResults.innerHTML =
        '<div class="crm-gif-loading"><i class="fas fa-spinner fa-spin"></i></div>';
      const gifs = await searchGifs(query, 0);
      gifResults.innerHTML = "";
      appendGifs(gifs);
    }

    if (gifBtn) {
      gifBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = gifPicker.style.display !== "none";
        gifPicker.style.display = isOpen ? "none" : "block";
        if (isOpen) {
          // Al cerrar: limpiar búsqueda y resultados
          if (gifSearchInput) gifSearchInput.value = "";
          gifResults.innerHTML = "";
          gifCurrentQuery = "";
          gifOffset = 0;
        } else {
          // Al abrir: mostrar trending desde cero
          if (gifSearchInput) gifSearchInput.value = "";
          renderGifs();
        }
      });
    }
    if (gifClose)
      gifClose.addEventListener("click", () => {
        gifPicker.style.display = "none";
        if (gifSearchInput) gifSearchInput.value = "";
        gifResults.innerHTML = "";
        gifCurrentQuery = "";
        gifOffset = 0;
      });
    if (gifSearchInput) {
      gifSearchInput.addEventListener("input", () => {
        clearTimeout(gifSearchTimeout);
        gifSearchTimeout = setTimeout(
          () => renderGifs(gifSearchInput.value.trim()),
          400,
        );
      });
    }

    // ── Botón + mobile (abre mini-menú con Foto / GIF) ──────────────
    const addMediaBtn = card.querySelector(".crm-add-media-btn");
    const addMediaMenu = card.querySelector(".crm-add-media-menu");
    const addPhotoItem = card.querySelector(".crm-add-photo-item");
    const addGifItem = card.querySelector(".crm-add-gif-item");

    if (addMediaBtn && addMediaMenu) {
      addMediaBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = addMediaMenu.style.display !== "none";
        if (!isOpen) {
          // Posicionar el menú encima del botón usando coordenadas fixed
          addMediaMenu.style.display = "flex";
          const rect = addMediaBtn.getBoundingClientRect();
          const menuH = addMediaMenu.offsetHeight;
          addMediaMenu.style.top = (rect.top - menuH - 10) + "px";
          addMediaMenu.style.left = rect.left + "px";
        } else {
          addMediaMenu.style.display = "none";
        }
        addMediaBtn.classList.toggle("active", !isOpen);
      });

      // Cerrar al hacer click fuera
      document.addEventListener("click", () => {
        addMediaMenu.style.display = "none";
        addMediaBtn.classList.remove("active");
      });

      if (addPhotoItem) {
        addPhotoItem.addEventListener("click", (e) => {
          e.stopPropagation();
          if (imgInput) imgInput.click();
          addMediaMenu.style.display = "none";
          addMediaBtn.classList.remove("active");
        });
      }

      if (addGifItem) {
        addGifItem.addEventListener("click", (e) => {
          e.stopPropagation();
          if (gifBtn) gifBtn.click();
          addMediaMenu.style.display = "none";
          addMediaBtn.classList.remove("active");
        });
      }
    }

    // Botón quitar imagen
    if (imgRemoveBtn) {
      imgRemoveBtn.onclick = () => {
        pendingImageFile = null;
        imgPreviewWrap.style.display = "none";
        imgPreview.src = "";
        if (imgInput) imgInput.value = "";
      };
    }

    // Botón quitar GIF
    const gifPreviewRemove = card.querySelector(".crm-gif-preview-remove");
    const gifPreviewWrapEl = card.querySelector(".crm-gif-preview-wrap");
    const gifPreviewEl = card.querySelector(".crm-gif-preview");
    if (gifPreviewRemove) {
      gifPreviewRemove.onclick = () => {
        pendingGifUrl = null;
        if (gifPreviewWrapEl) gifPreviewWrapEl.style.display = "none";
        if (gifPreviewEl) gifPreviewEl.src = "";
      };
    }

    sendBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const text = inputEl.value.trim();
      const hasContent = text || pendingImageFile || pendingGifUrl;
      if (!hasContent) return;
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      try {
        let imageUrl = null;

        // Subir imagen a Cloudinary (el gif se guarda por separado)
        if (pendingImageFile) {
          const formData = new FormData();
          formData.append("file", pendingImageFile);
          formData.append("upload_preset", "cinecorneta");
          formData.append("folder", "comment_media");
          const res = await fetch(
            "https://api.cloudinary.com/v1_1/djhgmmdjx/image/upload",
            {
              method: "POST",
              body: formData,
            },
          );
          const data = await res.json();
          if (!data.secure_url) throw new Error("Error al subir imagen");
          imageUrl = data.secure_url;
        }

        const commentData = {
          userId: auth.currentUser.uid,
          userName: auth.currentUser.displayName || "Usuario",
          text: text || "",
          timestamp: firebase.database.ServerValue.TIMESTAMP,
        };
        if (imageUrl) commentData.imageUrl = imageUrl;
        if (pendingGifUrl) commentData.gifUrl = pendingGifUrl;

        await db.ref(`review_comments/${review.id}`).push(commentData);

        inputEl.value = "";
        inputEl.style.height = "auto";
        pendingImageFile = null;
        pendingGifUrl = null;
        imgPreviewWrap.style.display = "none";
        imgPreview.src = "";
        if (imgInput) imgInput.value = "";
        if (gifPreviewWrapEl) gifPreviewWrapEl.style.display = "none";
        if (gifPreviewEl) gifPreviewEl.src = "";
        commentsLoaded = true;
        loadComments(review.id, card);
      } catch (err) {
        console.error("[Comments]", err);
        if (window.showNotification)
          window.showNotification("Error al enviar el comentario", "error");
      } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
      }
    });
  }

  // Click en la card → abrir modal de reseña completa
  card.addEventListener("click", (e) => {
    if (e.target.closest("button, a, .rc-author-link")) return;
    const data = JSON.parse(card.dataset.reviewData);
    card.classList.add("frm-card-zoom");
    setTimeout(() => card.classList.remove("frm-card-zoom"), 400);
    openFullReview(data);
  });

  return card;
}

// ===========================================================
// LÓGICA: TRUNCADO INTELIGENTE (LEER MÁS / MENOS)
// ===========================================================
function setupReviewTruncation() {
  const reviewCards = document.querySelectorAll(".review-card");

  reviewCards.forEach((card) => {
    const textEl = card.querySelector(".review-text");
    if (!textEl) return;

    // Limpiar estado previo
    const existingBtn = card.querySelector(".read-more-trigger");
    if (existingBtn) existingBtn.remove();

    // Esperar a que el elemento esté completamente renderizado
    setTimeout(() => {
      // Verificar nuevamente que el elemento existe
      if (!textEl || !textEl.scrollHeight || !textEl.clientHeight) return;

      // 🔥 DETECCIÓN INTELIGENTE: Verificar si el texto está siendo truncado visualmente
      // Comparamos el scrollHeight (altura total del contenido) con clientHeight (altura visible)
      const isTruncated = textEl.scrollHeight > textEl.clientHeight; // Sin margen - detección directa

      console.log("Verificando truncado:", {
        scrollHeight: textEl.scrollHeight,
        clientHeight: textEl.clientHeight,
        isTruncated: isTruncated,
        text: textEl.textContent.substring(0, 30) + "...",
      });

      if (isTruncated) {
        // 1. Creamos botón
        const btn = document.createElement("button");
        btn.className = "read-more-trigger";
        btn.textContent = "Leer reseña completa";

        // Estilos inline básicos
        btn.style.marginTop = "8px";
        btn.style.background = "none";
        btn.style.border = "none";
        btn.style.color = "#888";
        btn.style.cursor = "pointer";
        btn.style.fontSize = "0.85rem";
        btn.style.fontWeight = "600";
        btn.style.transition = "color 0.3s ease";

        // 2. 🔥 Evento Click - ABRIR MODAL CON LA RESEÑA COMPLETA
        btn.onclick = (e) => {
          e.stopPropagation();

          // Obtener datos de la reseña desde el atributo data
          const reviewData = JSON.parse(card.dataset.reviewData);

          // Abrir modal con reseña completa
          openFullReview(reviewData);
        };

        // Hover effect
        btn.addEventListener("mouseenter", () => {
          btn.style.color = "#e50914";
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.color = "#888";
        });

        // Insertar después del contenedor de texto
        textEl.parentNode.appendChild(btn);
      }
    }, 100); // Mayor delay para asegurar que el DOM esté completamente renderizado
  });
}

// ===========================================================
// MODAL: VER RESEÑA COMPLETA (con comentarios)
// ===========================================================
export function openFullReview(reviewData) {
  const modal = document.getElementById("full-review-modal");
  if (!modal) return;

  // ── Banner ──────────────────────────────────────────────────
  let bannerToUse = reviewData.banner;
  if (!bannerToUse && reviewData.contentId) {
    const contentData = findContentData(reviewData.contentId);
    if (contentData?.banner) bannerToUse = contentData.banner;
  }
  const bgImage = bannerToUse || reviewData.poster || "";

  document.getElementById("frm-banner").style.backgroundImage = `url(${bgImage})`;
  document.getElementById("frm-poster").src = reviewData.poster || "";
  document.getElementById("frm-title").textContent = reviewData.contentTitle || "";
  document.getElementById("frm-text").textContent = reviewData.text || "";
  document.getElementById("frm-stars").innerHTML =
    renderStarsFromValue(reviewData.stars || 0) +
    `<span style="margin-left:6px;font-size:0.82rem;color:var(--text-muted)">${reviewData.stars}/5</span>`;

  // ── Fecha ───────────────────────────────────────────────────
  document.getElementById("frm-date").textContent = reviewData.timestamp
    ? new Date(reviewData.timestamp).toLocaleDateString("es-ES", {
        day: "numeric", month: "long", year: "numeric",
      })
    : "Reciente";

  // ── Avatar + autor ──────────────────────────────────────────
  const photo =
    reviewData.userPhotoURL ||
    (auth.currentUser?.uid === reviewData.userId ? auth.currentUser?.photoURL : null);
  const initials = (reviewData.userName || "U").substring(0, 2).toUpperCase();
  const avatarEl = document.getElementById("frm-avatar");
  avatarEl.innerHTML = photo
    ? `<img src="${photo}" alt="" onerror="this.parentElement.innerHTML='<span>${initials}</span>'">`
    : `<span>${initials}</span>`;
  document.getElementById("frm-author").textContent = `@${reviewData.userName}`;

  // ── Reset scroll del body ───────────────────────────────────
  const body = modal.querySelector(".frm-body");
  if (body) body.scrollTop = 0;

  // ── Comentarios ─────────────────────────────────────────────
  const listEl = document.getElementById("frm-comments-list");
  const inputArea = document.getElementById("frm-comment-input-area");
  const labelEl = document.getElementById("frm-comments-label");

  listEl.innerHTML = `<div class="frm-comments-loading"><i class="fas fa-spinner fa-spin"></i></div>`;
  labelEl.textContent = "Comentarios";

  // Cargar comentarios desde Firebase
  _loadCommentsInModal(reviewData.id, listEl, (count) => {
    labelEl.textContent = count === 0
      ? "Comentarios"
      : `${count} comentario${count !== 1 ? "s" : ""}`;
  });

  // Input para nuevo comentario (solo si está autenticado)
  if (auth.currentUser) {
    const user = auth.currentUser;
    const userPhoto = user.photoURL;
    const userInitials = (user.displayName || user.email?.split("@")[0] || "U")
      .slice(0, 2).toUpperCase();

    inputArea.innerHTML = `
      <div class="frm-input-row">
        <div class="frm-input-avatar">
          ${userPhoto
            ? `<img src="${userPhoto}" alt="">`
            : `<span>${userInitials}</span>`}
        </div>
        <div class="frm-input-wrap">
          <div class="crm-media-previews">
            <div class="crm-img-preview-wrap" style="display:none;">
              <img class="crm-img-preview" src="" alt="preview">
              <button class="crm-img-remove" title="Quitar imagen"><i class="fas fa-times"></i></button>
            </div>
            <div class="crm-gif-preview-wrap" style="display:none;">
              <img class="crm-gif-preview" src="" alt="gif preview">
              <button class="crm-gif-preview-remove" title="Quitar GIF"><i class="fas fa-times"></i></button>
            </div>
          </div>
          <div class="crm-gif-picker" style="display:none;">
            <div class="crm-gif-search-row">
              <input type="text" class="crm-gif-search-input" placeholder="Buscar GIF...">
              <button class="crm-gif-close" type="button"><i class="fas fa-times"></i></button>
            </div>
            <div class="crm-gif-results"></div>
          </div>
          <div class="crm-input-row">
            <textarea class="frm-comment-textarea" placeholder="Escribe un comentario..." rows="1"></textarea>
            <label class="crm-img-btn" title="Adjuntar imagen">
              <i class="fas fa-image"></i>
              <input type="file" class="crm-img-input" accept="image/*" style="display:none;">
            </label>
            <button class="crm-gif-btn" title="Buscar GIF" type="button">GIF</button>
            <button class="frm-send-btn"><i class="fas fa-paper-plane"></i></button>
          </div>
        </div>
      </div>`;

    const textarea       = inputArea.querySelector(".frm-comment-textarea");
    const sendBtn        = inputArea.querySelector(".frm-send-btn");
    const imgInput       = inputArea.querySelector(".crm-img-input");
    const imgPreviewWrap = inputArea.querySelector(".crm-img-preview-wrap");
    const imgPreview     = inputArea.querySelector(".crm-img-preview");
    const imgRemoveBtn   = inputArea.querySelector(".crm-img-remove");
    const gifBtn         = inputArea.querySelector(".crm-gif-btn");
    const gifPicker      = inputArea.querySelector(".crm-gif-picker");
    const gifSearchInput = inputArea.querySelector(".crm-gif-search-input");
    const gifResults     = inputArea.querySelector(".crm-gif-results");
    const gifClose       = inputArea.querySelector(".crm-gif-close");
    const gifPreviewWrap = inputArea.querySelector(".crm-gif-preview-wrap");
    const gifPreviewEl   = inputArea.querySelector(".crm-gif-preview");
    const gifRemoveBtn   = inputArea.querySelector(".crm-gif-preview-remove");

    const GIPHY_KEY  = "XYG1rqTv26FibnEq5SRJeGPeAPegvn3q";
    const GIF_LIMIT  = 24;
    let pendingImageFile = null;
    let pendingGifUrl    = null;
    let gifSearchTimeout = null;
    let gifCurrentQuery  = "";
    let gifOffset        = 0;
    let gifHasMore       = true;
    let gifLoading       = false;

    // ── Textarea auto-resize ────────────────────────────────────
    textarea.addEventListener("input", () => {
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
    });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
    });

    // ── Imagen ──────────────────────────────────────────────────
    imgInput.addEventListener("change", () => {
      const file = imgInput.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        if (window.showNotification) window.showNotification("La imagen no puede superar 5MB", "error");
        return;
      }
      pendingImageFile = file;
      const reader = new FileReader();
      reader.onload = (e) => { imgPreview.src = e.target.result; imgPreviewWrap.style.display = "block"; };
      reader.readAsDataURL(file);
    });
    imgRemoveBtn.addEventListener("click", () => {
      pendingImageFile = null;
      imgPreviewWrap.style.display = "none";
      imgPreview.src = "";
      imgInput.value = "";
    });

    // ── GIF picker ──────────────────────────────────────────────
    async function frmSearchGifs(query, offset = 0) {
      const ep = query
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(query)}&limit=${GIF_LIMIT}&offset=${offset}&rating=r`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=${GIF_LIMIT}&offset=${offset}&rating=r`;
      const res  = await fetch(ep);
      const data = await res.json();
      gifHasMore = (data.pagination?.total_count || 0) > offset + GIF_LIMIT;
      return data.data || [];
    }

    function frmAppendGifs(gifs) {
      const oldBtn = gifResults.querySelector(".crm-gif-more-btn");
      if (oldBtn) oldBtn.remove();
      gifs.forEach((gif) => {
        const img = document.createElement("img");
        img.src = gif.images.fixed_height_small.url;
        img.className = "crm-gif-item";
        img.addEventListener("click", () => {
          pendingGifUrl = gif.images.downsized.url;
          if (gifPreviewEl) gifPreviewEl.src = pendingGifUrl;
          if (gifPreviewWrap) gifPreviewWrap.style.display = "block";
          gifPicker.style.display = "none";
        });
        gifResults.appendChild(img);
      });
      if (gifHasMore) {
        const moreBtn = document.createElement("button");
        moreBtn.className = "crm-gif-more-btn";
        moreBtn.innerHTML = '<i class="fas fa-plus"></i> Cargar más';
        moreBtn.addEventListener("click", async () => {
          if (gifLoading) return;
          gifLoading = true;
          moreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
          gifOffset += GIF_LIMIT;
          const more = await frmSearchGifs(gifCurrentQuery, gifOffset);
          gifLoading = false;
          frmAppendGifs(more);
        });
        gifResults.appendChild(moreBtn);
      }
    }

    async function frmRenderGifs(query = "") {
      gifCurrentQuery = query;
      gifOffset = 0;
      gifResults.innerHTML = '<div class="crm-gif-loading"><i class="fas fa-spinner fa-spin"></i></div>';
      const gifs = await frmSearchGifs(query, 0);
      gifResults.innerHTML = "";
      frmAppendGifs(gifs);
    }

    gifBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = gifPicker.style.display !== "none";
      gifPicker.style.display = isOpen ? "none" : "block";
      if (!isOpen) { gifSearchInput.value = ""; frmRenderGifs(); }
      else { gifSearchInput.value = ""; gifResults.innerHTML = ""; }
    });
    gifClose.addEventListener("click", () => {
      gifPicker.style.display = "none";
      gifSearchInput.value = "";
      gifResults.innerHTML = "";
    });
    gifSearchInput.addEventListener("input", () => {
      clearTimeout(gifSearchTimeout);
      gifSearchTimeout = setTimeout(() => frmRenderGifs(gifSearchInput.value.trim()), 400);
    });
    if (gifRemoveBtn) {
      gifRemoveBtn.addEventListener("click", () => {
        pendingGifUrl = null;
        gifPreviewWrap.style.display = "none";
        gifPreviewEl.src = "";
      });
    }

    // ── Enviar comentario ───────────────────────────────────────
    sendBtn.addEventListener("click", async () => {
      const text = textarea.value.trim();
      if (!text && !pendingImageFile && !pendingGifUrl) return;
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      try {
        let imageUrl = null;
        if (pendingImageFile) {
          const formData = new FormData();
          formData.append("file", pendingImageFile);
          formData.append("upload_preset", "cinecorneta");
          formData.append("folder", "comment_media");
          const res  = await fetch("https://api.cloudinary.com/v1_1/djhgmmdjx/image/upload", { method: "POST", body: formData });
          const data = await res.json();
          if (!data.secure_url) throw new Error("Error al subir imagen");
          imageUrl = data.secure_url;
        }
        const commentData = {
          userId:    user.uid,
          userName:  user.displayName || "Usuario",
          text:      text || "",
          timestamp: firebase.database.ServerValue.TIMESTAMP,
        };
        if (imageUrl)      commentData.imageUrl = imageUrl;
        if (pendingGifUrl) commentData.gifUrl   = pendingGifUrl;

        await db.ref(`review_comments/${reviewData.id}`).push(commentData);

        textarea.value = "";
        textarea.style.height = "auto";
        pendingImageFile = null;
        pendingGifUrl    = null;
        imgPreviewWrap.style.display = "none";
        imgPreview.src = "";
        imgInput.value = "";
        if (gifPreviewWrap) gifPreviewWrap.style.display = "none";
        if (gifPreviewEl)   gifPreviewEl.src = "";

        _loadCommentsInModal(reviewData.id, listEl, (count) => {
          labelEl.textContent = `${count} comentario${count !== 1 ? "s" : ""}`;
        });
      } catch (err) {
        console.error("[FRM] Error al enviar comentario:", err);
        if (window.showNotification) window.showNotification("Error al enviar el comentario", "error");
      } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
      }
    });
  } else {
    inputArea.innerHTML = `
      <p class="frm-login-prompt">
        <a href="#" onclick="if(window.openAuthModal) window.openAuthModal(true)">
          Inicia sesión</a> para comentar.
      </p>`;
  }

  // ── Abrir modal ─────────────────────────────────────────────
  document.body.style.overflow = "hidden";

  if (ModalManager && typeof ModalManager.open === "function") {
    ModalManager.open(modal, { closeOnEsc: true });
  } else {
    modal.classList.add("show");
    document.body.classList.add("modal-open");
  }

  // Restaurar scroll al cerrar
  const restoreScroll = () => { document.body.style.overflow = ""; };
  modal.addEventListener("click", (e) => {
    if (e.target === modal) restoreScroll();
  }, { once: true });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") restoreScroll();
  }, { once: true });
}

// Carga comentarios directamente en un listEl (sin depender de card)
function _loadCommentsInModal(reviewId, listEl, onCountUpdate = null) {
  const isAdmin = auth.currentUser && auth.currentUser.email === "baquezadat@gmail.com";
  const currentUid = auth.currentUser ? auth.currentUser.uid : null;

  db.ref(`review_comments/${reviewId}`)
    .once("value")
    .then((snapshot) => {
      listEl.innerHTML = "";
      if (!snapshot.exists()) {
        listEl.innerHTML = `<p class="crm-no-comments">Sé el primero en comentar.</p>`;
        if (onCountUpdate) onCountUpdate(0);
        return;
      }

      const comments = [];
      snapshot.forEach((child) => {
        const val = child.val();
        if (val) comments.push({ id: child.key, ...val });
      });
      comments.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      if (onCountUpdate) onCountUpdate(comments.length);

      const frag = document.createDocumentFragment();
      comments.forEach((comment) => {
        const dateStr = comment.timestamp
          ? new Date(comment.timestamp).toLocaleDateString("es-ES", {
              day: "numeric", month: "short", year: "numeric",
            })
          : "";
        const canDelete = isAdmin || currentUid === comment.userId;
        const deleteBtn = canDelete
          ? `<button class="crm-comment-delete" onclick="deleteReviewComment('${reviewId}','${comment.id}')" title="Borrar"><i class="fas fa-trash-alt"></i></button>`
          : "";

        const el = document.createElement("div");
        el.className = "crm-comment-item";
        el.style.cssText = "display:flex;gap:10px;width:100%;box-sizing:border-box;overflow:hidden;";
        el.innerHTML = `
          <i class="fas fa-user-circle crm-comment-avatar" style="flex-shrink:0;"></i>
          <div class="crm-comment-bubble" style="flex:1;min-width:0;overflow:hidden;box-sizing:border-box;">
            <div class="crm-comment-meta">
              <span class="crm-comment-user">@${comment.userName || "Usuario"}</span>
              <span class="crm-comment-date">${dateStr}</span>
              ${deleteBtn}
            </div>
            ${(comment.text || comment.body || comment.content || comment.message)
              ? `<p class="crm-comment-text" style="word-break:break-word;overflow-wrap:break-word;">${comment.text || comment.body || comment.content || comment.message}</p>`
              : ""}
            ${comment.imageUrl ? `<img class="crm-comment-img" src="${comment.imageUrl}" alt="imagen" loading="lazy" style="max-width:100%;height:auto;display:block;border-radius:8px;margin-top:6px;">` : ""}
            ${comment.gifUrl ? `<img class="crm-comment-img crm-comment-gif" src="${comment.gifUrl}" alt="gif" loading="lazy" style="max-width:100%;height:auto;display:block;border-radius:8px;margin-top:6px;">` : ""}
          </div>`;

        // Lightbox en imágenes
        const imgEl = el.querySelector(".crm-comment-img");
        if (imgEl) {
          imgEl.addEventListener("click", () => {
            const lb = document.createElement("div");
            lb.className = "crm-lightbox";
            lb.innerHTML = `<img src="${imgEl.src}" alt="imagen">`;
            lb.addEventListener("click", () => lb.remove());
            document.body.appendChild(lb);
          });
        }

        frag.appendChild(el);
      });
      listEl.appendChild(frag);
    })
    .catch((err) => console.error("[FRM] Error cargando comentarios:", err));
}

window.openFullReview = openFullReview;

// ===========================================================
// ADMIN: ELIMINAR RESEÑA
// ===========================================================
export function editReview(
  reviewId,
  stars,
  text,
  contentTitle,
  contentId,
  contentType,
) {
  const user = auth.currentUser;
  if (!user) return;
  const reviewModal = document.getElementById("review-form-modal");
  if (!reviewModal) return;
  resetReviewForm();
  editingReviewId = reviewId;
  const inputContainer = document.querySelector(
    ".custom-select-input-container",
  );
  const selectedDisplay = document.getElementById("review-selected-display");
  const selectedTitle = document.getElementById("review-selected-title");
  if (inputContainer) inputContainer.style.display = "none";
  if (selectedDisplay) selectedDisplay.style.display = "block";
  if (selectedTitle)
    selectedTitle.textContent = contentTitle || "Editando reseña";
  const hiddenId = document.getElementById("review-selected-id");
  const hiddenType = document.getElementById("review-content-type");
  if (hiddenId) hiddenId.value = contentId || reviewId;
  if (hiddenType) hiddenType.value = contentType || "movie";
  const textInput = document.getElementById("review-text-input");
  if (textInput) textInput.value = text;
  const ratingInput = document.getElementById("review-rating-value");
  const ratingLabel = document.getElementById("review-rating-label");
  if (ratingInput) {
    ratingInput.value = stars;
    setTimeout(() => {
      const val = parseFloat(stars);
      const container = document.getElementById("star-rating-input");
      if (container) {
        container.querySelectorAll(".star-wrapper").forEach((wrapper, i) => {
          const icon = wrapper.querySelector(".star-icon");
          if (!icon) return;
          const diff = val - i;
          if (diff >= 1) icon.className = "fas fa-star star-icon";
          else if (diff >= 0.5)
            icon.className = "fas fa-star-half-alt star-icon";
          else icon.className = "far fa-star star-icon";
          icon.style.fontSize = "2rem";
          icon.style.pointerEvents = "none";
        });
      }
    }, 50);
  }
  if (ratingLabel) ratingLabel.textContent = `${stars}/5`;
  const submitBtn = DOM.reviewForm?.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = "Actualizar Reseña";
  reviewModal.classList.add("show");
  document.body.classList.add("modal-open");
}
window.editReview = editReview;

export function deleteReview(reviewId) {
  openConfirmationModal(
    "Eliminar Reseña",
    "¿Estás seguro de que deseas eliminar esta reseña permanentemente?",
    async () => {
      try {
        await db.ref(`reviews/${reviewId}`).remove();

        // ✅ NOTIFICACIÓN VISUAL (Toast)
        if (window.showNotification) {
          window.showNotification("Reseña eliminada correctamente.", "success");
        } else {
          // Fallback por si acaso
          ErrorHandler.show("content", "Reseña eliminada correctamente.");
        }
      } catch (error) {
        console.error("Error al eliminar reseña:", error);

        if (window.showNotification) {
          window.showNotification("Error al eliminar la reseña.", "error");
        } else {
          ErrorHandler.show("database", "Error al eliminar la reseña.");
        }
      }
    },
  );
}

window.deleteReview = deleteReview;

// ===========================================================
// HELPER: RESOLVER ID OBSOLETO USANDO TÍTULO COMO FALLBACK
// ===========================================================
/**
 * Cuando un contentId de Firebase ya no coincide con ninguna entrada del sheet,
 * intenta encontrar el ID actual buscando por título de la reseña.
 *
 * @param {string} oldId       - El contentId guardado en Firebase (puede estar desactualizado)
 * @param {string} title       - El contentTitle guardado en la reseña
 * @returns {string}           - El ID correcto (actual) o el oldId si no se encuentra nada mejor
 */
function resolveContentId(oldId, title) {
  // ── MAPA DE IDs OBSOLETOS ──────────────────────────────────────────────────
  // IDs que cambiaron tanto que no se pueden resolver automáticamente.
  // Clave: oldId guardado en Firebase → Valor: id actual en el sheet.
  const LEGACY_ID_MAP = {
    reze: "Chainsaw Man – The Movie: Reze Arc",
    jinroh: "Jin-Roh: The Wolf Brigade",
    "30aniv": "Evangelion Special 30th Anniversary",
  };
  if (LEGACY_ID_MAP[oldId]) return LEGACY_ID_MAP[oldId];
  // ──────────────────────────────────────────────────────────────────────────

  // Si el ID ya existe en el contenido actual, no hace falta buscar
  if (findContentData(oldId)) return oldId;

  // Sin título no podemos hacer fallback
  if (!title) return oldId;

  // Normalizamos tanto el título en español (contentTitle de Firebase)
  // como el oldId (que podría ser un título original antiguo, ej: "warfare")
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedOldId = oldId.trim().toLowerCase();

  /**
   * Comprueba si un item del sheet coincide con la reseña.
   * Estrategia (en orden de prioridad):
   *   1. El id actual del sheet === oldId guardado en Firebase  → ya cubierto arriba por findContentData
   *   2. El id actual del sheet coincide con el título en español de la reseña
   *   3. El título (m.title) del item coincide con el título en español de la reseña
   *   4. El id actual del sheet coincide con el oldId (útil si el id era un título en inglés)
   *   5. El título del item coincide con el oldId (ej: item.title="Extraction", oldId="warfare" → no, pero item.title="Warfare" → sí)
   */
  const isMatch = (id, item) => {
    const itemId = (id || "").trim().toLowerCase();
    const itemTitle = (item.title || "").trim().toLowerCase();
    return (
      itemId === normalizedTitle || // id actual == título español reseña
      itemTitle === normalizedTitle || // título item == título español reseña
      itemId === normalizedOldId || // id actual == oldId (título original antiguo)
      itemTitle === normalizedOldId // título item == oldId
    );
  };

  // Buscar en películas
  if (appState.content.movies) {
    for (const [id, m] of Object.entries(appState.content.movies)) {
      if (isMatch(id, m)) return id;
    }
  }
  // Buscar en series
  if (appState.content.series) {
    for (const [id, s] of Object.entries(appState.content.series)) {
      if (isMatch(id, s)) return id;
    }
  }
  // Buscar en sagas
  if (appState.content.sagas) {
    for (const sagaKey in appState.content.sagas) {
      const sagaData = appState.content.sagas[sagaKey];
      if (!sagaData) continue;
      for (const [id, item] of Object.entries(sagaData)) {
        if (isMatch(id, item)) return id;
      }
    }
  }
  // Buscar en UCM
  if (appState.content.ucm) {
    for (const [id, item] of Object.entries(appState.content.ucm)) {
      if (isMatch(id, item)) return id;
    }
  }

  // No se encontró coincidencia
  console.warn(
    `[resolveContentId] No match for title="${title}" / oldId="${oldId}"`,
  );
  return oldId;
}

// ===========================================================
// SISTEMA DE RATINGS (PROMEDIOS)
// ===========================================================
function setupRatingsListener() {
  db.ref("reviews").on("value", (snapshot) => {
    const ratingsData = {};

    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        const review = child.val();
        // Resolver el ID: si está desactualizado, buscar por título
        const resolvedId = resolveContentId(
          review.contentId,
          review.contentTitle,
        );
        if (!ratingsData[resolvedId]) {
          ratingsData[resolvedId] = { sum: 0, count: 0 };
        }
        ratingsData[resolvedId].sum += review.stars;
        ratingsData[resolvedId].count += 1;
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
  document.querySelectorAll(".movie-card").forEach((card) => {
    const contentId = card.dataset.contentId;
    const ratingContainer = card.querySelector(".card-rating-container");

    if (ratingContainer && contentId) {
      const rating = appState.content.averages[contentId];
      ratingContainer.innerHTML = getStarsHTML(rating, true);
    }
  });
}

export function getStarsHTML(rating, isSmall = true) {
  if (!rating || rating === "0.0" || rating === 0) return "";

  return `
        <div class="star-rating-display ${isSmall ? "small" : "large"}" 
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
  const modal = document.getElementById("content-reviews-modal");
  if (!modal) return;

  // Resetear estado
  const crmList = document.getElementById("crm-list");
  const crmLoading = document.getElementById("crm-loading");
  const crmEmpty = document.getElementById("crm-empty");
  const crmTitle = document.getElementById("crm-title");
  const crmPoster = document.getElementById("crm-poster");
  const crmHeader = document.getElementById("crm-header");
  const crmAvg = document.getElementById("crm-avg");
  const crmCount = document.getElementById("crm-count");

  if (crmList) crmList.innerHTML = "";
  if (crmLoading) crmLoading.style.display = "flex";
  if (crmEmpty) crmEmpty.style.display = "none";
  if (crmTitle) crmTitle.textContent = contentTitle || "";

  // Buscar datos del contenido para poster y banner
  const contentData = findContentData(contentId);
  if (contentData) {
    if (crmPoster) crmPoster.src = contentData.poster || "";
    if (crmHeader && (contentData.banner || contentData.poster)) {
      crmHeader.style.backgroundImage = `url(${contentData.banner || contentData.poster})`;
    }
  }

  // Abrir modal
  if (ModalManager && typeof ModalManager.open === "function") {
    ModalManager.open(modal, { closeOnEsc: true, nested: true });
  } else {
    modal.classList.add("show");
    document.body.classList.add("modal-open");
  }

  const MAX_CHARS = 220;

  try {
    // Fetch TODAS las reseñas y filtrar por contentId en cliente
    // (evita necesidad de índice en Firebase)
    const snapshot = await db.ref("reviews").once("value");
    if (crmLoading) crmLoading.style.display = "none";

    const reviews = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        const rev = child.val();
        // Resolver el ID almacenado en Firebase por si cambió en el sheet
        const resolvedId = resolveContentId(rev.contentId, rev.contentTitle);
        if (resolvedId === contentId) {
          reviews.push({ id: child.key, ...rev });
        }
      });
    }

    if (reviews.length === 0) {
      if (crmEmpty) crmEmpty.style.display = "flex";
      return;
    }

    // Ordenar más antiguos primero
    reviews.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    // Stats
    const avg = (
      reviews.reduce((s, r) => s + r.stars, 0) / reviews.length
    ).toFixed(1);
    if (crmAvg) crmAvg.innerHTML = `<i class="fas fa-star"></i> ${avg}`;
    if (crmCount)
      crmCount.textContent = `${reviews.length} ${reviews.length === 1 ? "reseña" : "reseñas"}`;

    const isAdmin =
      auth.currentUser && auth.currentUser.email === "baquezadat@gmail.com";
    const currentUser = auth.currentUser;

    reviews.forEach((review) => {
      const starsHTML = renderStarsFromValue(review.stars);

      const date = review.timestamp
        ? (() => {
            const d = new Date(review.timestamp);
            const fecha = d.toLocaleDateString("es-ES", {
              day: "numeric",
              month: "long",
              year: "numeric",
            });
            const hora = d.toLocaleTimeString("es-ES", {
              hour: "2-digit",
              minute: "2-digit",
            });
            return `${fecha} · ${hora}`;
          })()
        : "Reciente";

      const fullText = review.text || "";
      const isTruncated = fullText.length > MAX_CHARS;
      const shortText = isTruncated
        ? fullText.substring(0, MAX_CHARS).trimEnd() + "…"
        : fullText;

      const card = document.createElement("div");
      card.className = "crm-review-card";
      card.innerHTML = `
                <div class="crm-card-header">
                    <div class="crm-card-user">
                        ${(() => {
                          const photo =
                            review.userPhotoURL ||
                            (auth.currentUser?.uid === review.userId
                              ? auth.currentUser?.photoURL
                              : null);
                          return photo
                            ? `<img src="${photo}" class="crm-user-photo" alt="${review.userName}">`
                            : `<i class="fas fa-user-circle crm-user-icon"></i>`;
                        })()}
                        <span class="crm-username">@${review.userName}</span>
                        <span class="crm-date">${date}</span>
                    </div>
                    <div class="crm-card-stars">${starsHTML}</div>
                </div>
                <p class="crm-card-text">${shortText}</p>
                ${isTruncated ? `<button class="crm-read-more">Leer reseña completa <i class="fas fa-chevron-down"></i></button>` : ""}
                <div class="crm-comments-section">
                    <button class="crm-toggle-comments" data-review-id="${review.id}">
                        <i class="far fa-comment"></i>
                        <span class="crm-comments-label">Ver comentarios</span>
                    </button>
                    <div class="crm-comments-area" style="display:none;">
                        <div class="crm-comments-list" id="comments-${review.id}">
                            <div class="crm-comments-loading"><i class="fas fa-spinner fa-spin"></i></div>
                        </div>
                        ${
                          currentUser
                            ? `
                        <div class="crm-comment-input-row">
                            <i class="fas fa-user-circle crm-comment-input-avatar"></i>
                            <div class="crm-comment-input-wrap">
                                <textarea class="crm-comment-input" placeholder="Escribe un comentario..." rows="1"></textarea>
                                <button class="crm-comment-send" data-review-id="${review.id}">
                                    <i class="fas fa-paper-plane"></i>
                                </button>
                            </div>
                        </div>`
                            : `<p class="crm-login-hint"><i class="fas fa-lock"></i> Inicia sesión para comentar</p>`
                        }
                    </div>
                </div>
            `;

      // Toggle expandir/colapsar texto
      if (isTruncated) {
        const btn = card.querySelector(".crm-read-more");
        const textEl = card.querySelector(".crm-card-text");
        let expanded = false;
        btn.addEventListener("click", () => {
          expanded = !expanded;
          textEl.textContent = expanded ? fullText : shortText;
          btn.innerHTML = expanded
            ? 'Mostrar menos <i class="fas fa-chevron-up"></i>'
            : 'Leer reseña completa <i class="fas fa-chevron-down"></i>';
        });
      }

      // Toggle comentarios
      const toggleBtn = card.querySelector(".crm-toggle-comments");
      const commentsArea = card.querySelector(".crm-comments-area");
      let commentsLoaded = false;
      let commentsListener = null;

      toggleBtn.addEventListener("click", () => {
        const isOpen = commentsArea.style.display !== "none";
        commentsArea.style.display = isOpen ? "none" : "block";
        toggleBtn.querySelector(".crm-comments-label").textContent = isOpen
          ? "Ver comentarios"
          : "Ocultar comentarios";
        toggleBtn.querySelector("i").className = isOpen
          ? "far fa-comment"
          : "fas fa-comment";

        if (!isOpen && !commentsLoaded) {
          commentsLoaded = true;
          loadComments(review.id, card);
        }
      });

      // Enviar comentario
      if (currentUser) {
        const sendBtn = card.querySelector(".crm-comment-send");
        const inputEl = card.querySelector(".crm-comment-input");

        // Auto-resize textarea
        inputEl.addEventListener("input", () => {
          inputEl.style.height = "auto";
          inputEl.style.height = inputEl.scrollHeight + "px";
        });

        // Enter para enviar (Shift+Enter = salto de línea)
        inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
          }
        });

        sendBtn.addEventListener("click", async () => {
          const text = inputEl.value.trim();
          if (!text) return;

          sendBtn.disabled = true;
          sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

          try {
            await db.ref(`review_comments/${review.id}`).push({
              userId: currentUser.uid,
              userName: currentUser.displayName || "Usuario",
              text,
              timestamp: firebase.database.ServerValue.TIMESTAMP,
            });
            inputEl.value = "";
            inputEl.style.height = "auto";

            // Cargar si no estaban cargados aún
            if (!commentsLoaded) {
              commentsLoaded = true;
              loadComments(review.id, card);
            }
          } catch (err) {
            console.error("[Comments] Error al enviar:", err);
          } finally {
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
          }
        });
      }

      if (crmList) crmList.appendChild(card);
    });
  } catch (err) {
    if (crmLoading) crmLoading.style.display = "none";
    console.error("[ContentReviews] Error al cargar reseñas:", err);
    if (crmEmpty) crmEmpty.style.display = "flex";
  }
}

// ===========================================================
// COMENTARIOS DE RESEÑAS
// ===========================================================
function loadComments(reviewId, card, onCountUpdate = null) {
  const listEl = card.querySelector(`[id="comments-${reviewId}"]`);
  if (!listEl) return;

  const isAdmin =
    auth.currentUser && auth.currentUser.email === "baquezadat@gmail.com";
  const currentUid = auth.currentUser ? auth.currentUser.uid : null;

  // Sin orderByChild para evitar dependencia de índice en Firebase;
  // el orden cronológico se aplica en cliente.
  db.ref(`review_comments/${reviewId}`)
    .once("value")
    .then((snapshot) => {
      listEl.innerHTML = "";

      if (!snapshot.exists()) {
        listEl.innerHTML = `<p class="crm-no-comments">Sé el primero en comentar.</p>`;
        if (onCountUpdate) onCountUpdate(0);
        return;
      }

      const comments = [];
      snapshot.forEach((child) => {
        const val = child.val();
        if (val) comments.push({ id: child.key, ...val });
      });

      // Ordenar por timestamp en cliente (evita necesidad de índice en Firebase)
      comments.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      if (onCountUpdate) onCountUpdate(comments.length);

      const fragment = document.createDocumentFragment();
      comments.forEach((comment) => {
        const date = comment.timestamp
          ? new Date(comment.timestamp).toLocaleDateString("es-ES", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "";

        const canDelete = isAdmin || currentUid === comment.userId;
        const deleteBtn = canDelete
          ? `<button class="crm-comment-delete" onclick="deleteReviewComment('${reviewId}','${comment.id}')" title="Borrar comentario"><i class="fas fa-trash-alt"></i></button>`
          : "";

        const el = document.createElement("div");
        el.className = "crm-comment-item";
        el.style.cssText = "display:flex;gap:10px;width:100%;box-sizing:border-box;overflow:hidden;";
        el.innerHTML = `
                <i class="fas fa-user-circle crm-comment-avatar" style="flex-shrink:0;"></i>
                <div class="crm-comment-bubble" style="flex:1;min-width:0;overflow:hidden;box-sizing:border-box;">
                    <div class="crm-comment-meta">
                        <span class="crm-comment-user">@${comment.userName}</span>
                        <span class="crm-comment-date">${date}</span>
                        ${deleteBtn}
                    </div>
                    ${comment.text ? `<p class="crm-comment-text" style="word-break:break-word;overflow-wrap:break-word;">${comment.text}</p>` : ""}
                    ${comment.imageUrl ? `<img class="crm-comment-img" src="${comment.imageUrl}" alt="imagen" loading="lazy" style="max-width:100%;height:auto;display:block;">` : ""}
                    ${comment.gifUrl ? `<img class="crm-comment-img crm-comment-gif" src="${comment.gifUrl}" alt="gif" loading="lazy" style="max-width:100%;height:auto;display:block;">` : ""}
                </div>
            `;
        // Lightbox al click en imagen
        const imgEl = el.querySelector(".crm-comment-img");
        if (imgEl) {
          imgEl.addEventListener("click", () => {
            const lb = document.createElement("div");
            lb.className = "crm-lightbox";
            lb.innerHTML = `<img src="${imgEl.src}" alt="imagen">`;
            lb.addEventListener("click", () => lb.remove());
            document.body.appendChild(lb);
          });
        }

        fragment.appendChild(el);
      });
      listEl.appendChild(fragment);
    })
    .catch((err) => console.error("[Comments] Error cargando:", err));
}

export function deleteReviewComment(reviewId, commentId) {
  openConfirmationModal(
    "¿Borrar comentario?",
    "Esta acción no se puede deshacer.",
    async () => {
      try {
        await db.ref(`review_comments/${reviewId}/${commentId}`).remove();

        // Eliminar el elemento del DOM inmediatamente sin recargar
        const listEl = document.getElementById(`comments-${reviewId}`);
        if (listEl) {
          const items = listEl.querySelectorAll(".crm-comment-item");
          items.forEach((item) => {
            const delBtn = item.querySelector(".crm-comment-delete");
            if (
              delBtn &&
              (delBtn.getAttribute("onclick") || "").includes(commentId)
            ) {
              item.remove();
            }
          });
          if (listEl.querySelectorAll(".crm-comment-item").length === 0) {
            listEl.innerHTML =
              '<p class="crm-no-comments">Sé el primero en comentar.</p>';
          }
        }
      } catch (err) {
        console.error("[Comments] Error al borrar:", err);
      }
    },
  );
}
window.deleteReviewComment = deleteReviewComment;

window.openContentReviews = openContentReviews;

// ===========================================================
// MODAL: PERFIL PÚBLICO DE USUARIO
// ===========================================================
export async function openUserProfile(userId, userName, photoURL) {
  const modal = document.getElementById("user-profile-modal");
  if (!modal) return;

  // Renderizar el nuevo layout mini del modal
  const content = modal.querySelector(".upm-content");
  content.innerHTML = `
    <button class="close-btn" onclick="closeAllModals()">&times;</button>
    <div class="upm-header" id="upm-header">
      <div class="upm-header-overlay"></div>
      <div class="upm-header-info">
        <div class="upm-avatar-wrap">
          ${photoURL
            ? `<img src="${photoURL}" alt="avatar" class="upm-avatar" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
            : ""}
          <div class="upm-avatar-placeholder" style="${photoURL ? "display:none" : ""}">
            <i class="fas fa-user-circle"></i>
          </div>
        </div>
        <div>
          <h2 class="upm-username">@${userName}</h2>
          <div class="upm-stats-row" id="upm-stats-row">
            <span><i class="fas fa-film"></i> <b>—</b> Películas</span>
            <span><i class="fas fa-tv"></i> <b>—</b> Series</span>
          </div>
        </div>
      </div>
    </div>
    <div class="upm-body" id="upm-body">
      <div class="upm-loading" id="upm-loading">
        <i class="fas fa-spinner fa-spin"></i>
      </div>
    </div>
  `;

  ModalManager.open(modal, { closeOnEsc: true, nested: true });

  try {
    const snap = await db.ref(`users/${userId}/history`).once("value");
    const body = document.getElementById("upm-body");

    if (!snap.exists()) {
      body.innerHTML = `<div class="upm-empty"><i class="far fa-film"></i><p>Este usuario no tiene actividad aún.</p></div>`;
      return;
    }

    const movies = [], series = [];
    const genreCount = {};
    const FALLBACK = "https://res.cloudinary.com/djhgmmdjx/image/upload/v1759209689/u71QEFc_bet4rv.png";

    snap.forEach((child) => {
      const item = child.val();
      // Contar géneros
      const genres = (item.genres || "").split(";").map(g => g.trim()).filter(Boolean);
      genres.forEach(g => { genreCount[g] = (genreCount[g] || 0) + 1; });
      if (item.type === "series") series.push(item);
      else movies.push(item);
    });

    const byDate = (a, b) => (b.viewedAt || 0) - (a.viewedAt || 0);
    movies.sort(byDate);
    series.sort(byDate);

    // Stats row
    document.getElementById("upm-stats-row").innerHTML = `
      <span><i class="fas fa-film"></i> <b>${movies.length}</b> Película${movies.length !== 1 ? "s" : ""}</span>
      <span><i class="fas fa-tv"></i> <b>${series.length}</b> Serie${series.length !== 1 ? "s" : ""}</span>
    `;

    // Top géneros
    const topGenres = Object.entries(genreCount)
      .sort(([,a],[,b]) => b - a)
      .slice(0, 5);
    const maxGenre = topGenres[0]?.[1] || 1;

    // Últimas 6 películas y series
    const lastMovies = movies.slice(0, 6);
    const lastSeries = series.slice(0, 6);

    const renderPosters = (items) => items.map(item => `
      <div class="upm-card">
        <img src="${item.poster || FALLBACK}" alt="${item.title}" class="upm-card-poster"
             onerror="this.src='${FALLBACK}'">
        <p class="upm-card-title">${item.title || ""}</p>
      </div>
    `).join("");

    body.innerHTML = `
      <!-- Stats cards -->
      <div class="upm-mini-stats">
        <div class="upm-mini-stat">
          <span class="upm-mini-stat__val">${movies.length + series.length}</span>
          <span class="upm-mini-stat__lbl">Total vistas</span>
        </div>
        <div class="upm-mini-stat">
          <span class="upm-mini-stat__val">${movies.length}</span>
          <span class="upm-mini-stat__lbl">Películas</span>
        </div>
        <div class="upm-mini-stat">
          <span class="upm-mini-stat__val">${series.length}</span>
          <span class="upm-mini-stat__lbl">Series</span>
        </div>
      </div>

      ${topGenres.length ? `
      <!-- Géneros favoritos -->
      <div class="upm-section">
        <p class="upm-section-title"><i class="fas fa-tags"></i> Géneros favoritos</p>
        <div class="upm-genres">
          ${topGenres.map(([g, count]) => `
            <div class="upm-genre-row">
              <span class="upm-genre-name">${g}</span>
              <div class="upm-genre-bar-wrap">
                <div class="upm-genre-bar" style="width:${Math.round(count/maxGenre*100)}%"></div>
              </div>
              <span class="upm-genre-count">${count}</span>
            </div>
          `).join("")}
        </div>
      </div>` : ""}

      ${lastMovies.length ? `
      <!-- Últimas películas -->
      <div class="upm-section">
        <p class="upm-section-title"><i class="fas fa-film"></i> Últimas películas</p>
        <div class="upm-grid">${renderPosters(lastMovies)}</div>
      </div>` : ""}

      ${lastSeries.length ? `
      <!-- Últimas series -->
      <div class="upm-section">
        <p class="upm-section-title"><i class="fas fa-tv"></i> Últimas series</p>
        <div class="upm-grid">${renderPosters(lastSeries)}</div>
      </div>` : ""}
    `;

  } catch (err) {
    console.error("[UserProfile]", err);
    const body = document.getElementById("upm-body");
    if (body) body.innerHTML = `<div class="upm-empty"><i class="fas fa-exclamation-circle"></i><p>No se pudo cargar el perfil.</p></div>`;
  }
}

window.openUserProfile = openUserProfile;

// Click delegation for author links (works for dynamically created cards)
document.addEventListener("click", (e) => {
  const link = e.target.closest(".rc-author-link");
  if (!link) return;
  e.stopPropagation();
  const { userid, username, photo } = link.dataset;
  if (userid) openUserProfile(userid, username, photo);
});

// ===========================================================
// EXPORTACIONES
// ===========================================================
export default {
  initReviews,
  renderReviewsGrid,
  openReviewModal,
  openFullReview,
  openContentReviews,
  openUserProfile,
  deleteReview,
  getStarsHTML,
};
