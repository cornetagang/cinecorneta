// ===========================================================
// MÓDULO DE UNIVERSOS (LAYOUT FEATURED)
// ===========================================================
// Reemplaza el antiguo renderSagasHub() con un layout dinámico
// que destaca los universos más importantes visualmente.
// Los estilos viven en style.css (sección UNIVERSOS).
// Uso: initUniverses(dependencies) → renderUniversesHub()
// ===========================================================

let shared;
let isInitialized = false;

// ─────────────────────────────────────────────
// 1. INICIALIZACIÓN CON INYECCIÓN DE DEPENDENCIAS
// ─────────────────────────────────────────────
export function initUniverses(dependencies) {
    if (isInitialized) return;
    shared = dependencies;
    isInitialized = true;
}

// ─────────────────────────────────────────────
// 2. RENDERIZADO PRINCIPAL DEL HUB
// ─────────────────────────────────────────────
export function renderUniversesHub() {
    const container = document.getElementById('sagas-grid-dynamic');
    if (!container) return;

    // Actualizar el título del header si existe
    const headerTitle = document.querySelector('#sagas-hub-container .main-title');
    if (headerTitle) headerTitle.textContent = 'Universos';

    const sagas = Object.values(shared.appState.content.sagasList || {});
    sagas.sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99));

    if (sagas.length === 0) {
        container.innerHTML = `<p class="universes-empty">No hay universos disponibles.</p>`;
        return;
    }

    container.innerHTML = '';
    container.className = 'universes-layout';

    // ── Sección DESTACADOS (primeras 3 sagas) ──
    const featuredSagas = sagas.slice(0, 3);
    const restSagas = sagas.slice(3);

    const featuredSection = buildFeaturedSection(featuredSagas);
    container.appendChild(featuredSection);

    // ── Sección RESTO (grid compacto) ──
    if (restSagas.length > 0) {
        const restSection = buildRestSection(restSagas);
        container.appendChild(restSection);
    }
}

// ─────────────────────────────────────────────
// 3. SECCIÓN FEATURED
// ─────────────────────────────────────────────
function buildFeaturedSection(sagas) {
    const section = document.createElement('div');
    section.className = 'universes-featured';

    // Las 3 van directo al grid, sin wrapper intermedio
    sagas.slice(0, 3).forEach(saga => {
        section.appendChild(createFeaturedCard(saga, 'featured'));
    });

    return section;
}

// ─────────────────────────────────────────────
// 4. SECCIÓN REST (grid compacto con paginación)
// ─────────────────────────────────────────────
// Columnas del grid de universos según los breakpoints del CSS
// (repeat(2..5, 1fr) — no es auto-fill, así que usamos los mismos valores exactos)
function getPageSize() {
    const w = window.innerWidth;
    if (w >= 1600) return 5 * 3; // 15
    if (w > 1024)  return 4 * 3; // 12
    if (w > 768)   return 3 * 3; // 9
    return 2 * 3;                 // 6 (móvil)
}

function buildRestSection(sagas) {
    const wrapper = document.createElement('div');
    wrapper.className = 'universes-rest-wrapper';

    // Header con label
    const header = document.createElement('div');
    header.className = 'universes-rest-header';
    const label = document.createElement('p');
    label.className = 'universes-rest-label';
    label.textContent = 'Más universos';
    header.appendChild(label);
    wrapper.appendChild(header);

    // Fila: flecha izq + grid + flecha der
    const row = document.createElement('div');
    row.className = 'universes-rest-row';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'univ-side-btn univ-side-btn--prev';
    prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
    prevBtn.setAttribute('aria-label', 'Página anterior');

    const grid = document.createElement('div');
    grid.className = 'universes-rest-grid';

    const nextBtn = document.createElement('button');
    nextBtn.className = 'univ-side-btn univ-side-btn--next';
    nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
    nextBtn.setAttribute('aria-label', 'Página siguiente');

    row.appendChild(prevBtn);
    row.appendChild(grid);
    row.appendChild(nextBtn);
    wrapper.appendChild(row);

    // Dots debajo centrados
    const dotsBar = document.createElement('div');
    dotsBar.className = 'univ-dots-bar';
    wrapper.appendChild(dotsBar);

    // Barra móvil: [ ‹ ] [ dots ] [ › ] — solo visible en móvil
    const mobileNav = document.createElement('div');
    mobileNav.className = 'univ-mobile-nav';
    mobileNav.style.display = 'none';

    const mobilePrev = document.createElement('button');
    mobilePrev.className = 'univ-side-btn';
    mobilePrev.innerHTML = '<i class="fas fa-chevron-left"></i>';
    mobilePrev.setAttribute('aria-label', 'Página anterior');

    const mobileDots = document.createElement('div');
    mobileDots.className = 'univ-dots-bar';
    mobileDots.style.padding = '0';

    const mobileNext = document.createElement('button');
    mobileNext.className = 'univ-side-btn';
    mobileNext.innerHTML = '<i class="fas fa-chevron-right"></i>';
    mobileNext.setAttribute('aria-label', 'Página siguiente');

    mobileNav.appendChild(mobilePrev);
    mobileNav.appendChild(mobileDots);
    mobileNav.appendChild(mobileNext);
    wrapper.appendChild(mobileNav);

    mobilePrev.addEventListener('click', () => goToPage(currentPage - 1));
    mobileNext.addEventListener('click', () => goToPage(currentPage + 1));

    let currentPage = 0;
    let pageSize = getPageSize();
    let totalPages = Math.ceil(sagas.length / pageSize);

    function goToPage(page) {
        if (page < 0 || page >= totalPages) return;
        grid.classList.add('univ-grid-exit');
        setTimeout(() => {
            currentPage = page;
            grid.innerHTML = '';
            pageSize = getPageSize();
            totalPages = Math.ceil(sagas.length / pageSize);
            sagas.slice(page * pageSize, page * pageSize + pageSize)
                 .forEach(saga => grid.appendChild(createCompactCard(saga)));
            grid.classList.remove('univ-grid-exit');
            grid.classList.add('univ-grid-enter');
            setTimeout(() => grid.classList.remove('univ-grid-enter'), 300);
            updateControls();
        }, 180);
    }

    function makeDots(container) {
        container.innerHTML = '';
        for (let i = 0; i < totalPages; i++) {
            const dot = document.createElement('button');
            dot.className = 'univ-dot' + (i === currentPage ? ' univ-dot--active' : '');
            dot.setAttribute('aria-label', `Página ${i + 1}`);
            dot.addEventListener('click', () => goToPage(i));
            container.appendChild(dot);
        }
    }

    function updateControls() {
        const isMobile = window.innerWidth <= 768;

        // Flechas del row (desktop)
        prevBtn.disabled = currentPage === 0;
        prevBtn.classList.toggle('univ-side-btn--disabled', currentPage === 0);
        nextBtn.disabled = currentPage === totalPages - 1;
        nextBtn.classList.toggle('univ-side-btn--disabled', currentPage === totalPages - 1);
        const visible = totalPages > 1 ? '' : 'hidden';
        prevBtn.style.visibility = visible;
        nextBtn.style.visibility = visible;

        if (totalPages <= 1) {
            dotsBar.innerHTML = '';
            mobileNav.style.display = 'none';
            return;
        }

        if (isMobile) {
            // Ocultar dots sueltos, mostrar barra móvil completa
            dotsBar.style.display = 'none';
            mobileNav.style.display = 'flex';
            mobilePrev.disabled = currentPage === 0;
            mobilePrev.classList.toggle('univ-side-btn--disabled', currentPage === 0);
            mobileNext.disabled = currentPage === totalPages - 1;
            mobileNext.classList.toggle('univ-side-btn--disabled', currentPage === totalPages - 1);
            makeDots(mobileDots);
        } else {
            dotsBar.style.display = '';
            mobileNav.style.display = 'none';
            makeDots(dotsBar);
        }
    }

    prevBtn.addEventListener('click', () => goToPage(currentPage - 1));
    nextBtn.addEventListener('click', () => goToPage(currentPage + 1));

    // Recalcular al cambiar tamaño de ventana
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const newPageSize = getPageSize();
            if (newPageSize !== pageSize) {
                goToPage(0); // Volver a página 1 con nuevo tamaño
            }
        }, 200);
    });

    goToPage(0);
    return wrapper;
}

// ─────────────────────────────────────────────
// 5. CREAR TARJETA FEATURED (hero / secondary)
// ─────────────────────────────────────────────
function createFeaturedCard(saga, variant) {
    const card = document.createElement('div');
    card.className = `universe-card universe-card--${variant}`;
    card.style.setProperty('--hover-color', saga.color || '#ffffff');

    if (saga.banner) {
        card.style.backgroundImage = `url('${saga.banner}')`;
    }

    card.innerHTML = `
        <div class="uc-overlay"></div>
        <div class="uc-shine"></div>
        <div class="uc-content">
            <img src="${saga.logo}" alt="${saga.title}" class="uc-logo">
        </div>
        <div class="uc-footer">
            <span class="uc-count" id="uc-count-${saga.id}"></span>
        </div>
    `;

    card.addEventListener('click', () => shared.switchView(saga.id));

    // Inyectar conteo de películas de forma asíncrona
    injectMovieCount(saga.id, card.querySelector(`#uc-count-${saga.id}`));

    return card;
}

// ─────────────────────────────────────────────
// 6. CREAR TARJETA COMPACTA (rest grid)
// ─────────────────────────────────────────────
function createCompactCard(saga) {
    const card = document.createElement('div');
    card.className = 'universe-card universe-card--compact';
    card.style.setProperty('--hover-color', saga.color || '#ffffff');

    if (saga.banner) {
        card.style.backgroundImage = `url('${saga.banner}')`;
    }

    card.innerHTML = `
        <div class="uc-overlay"></div>
        <div class="uc-shine"></div>
        <div class="uc-content">
            <img src="${saga.logo}" alt="${saga.title}" class="uc-logo">
        </div>
    `;

    card.setAttribute('tabindex', '-1');
    card.addEventListener('click', () => shared.switchView(saga.id));
    return card;
}

// ─────────────────────────────────────────────
// 7. HELPER: Contar películas de la saga
// ─────────────────────────────────────────────
function injectMovieCount(sagaId, el) {
    if (!el) return;
    const sagaData = shared.appState.content.sagas?.[sagaId];
    if (!sagaData) return;
    const count = Object.keys(sagaData).length;
    if (count > 0) {
        el.textContent = `${count} ${count === 1 ? 'título' : 'títulos'}`;
    }
}
