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
// 4. SECCIÓN REST (grid compacto)
// ─────────────────────────────────────────────
function buildRestSection(sagas) {
    const wrapper = document.createElement('div');
    wrapper.className = 'universes-rest-wrapper';

    const label = document.createElement('p');
    label.className = 'universes-rest-label';
    label.textContent = 'Más universos';
    wrapper.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'universes-rest-grid';

    sagas.forEach(saga => {
        grid.appendChild(createCompactCard(saga));
    });

    wrapper.appendChild(grid);
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
