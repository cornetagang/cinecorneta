// ===========================================================
// MÓDULO DE REPORTES - reports.js
// ===========================================================
// Permite a los usuarios reportar problemas de calidad,
// subtítulos, audio, etc. en películas y series.
// Los admins pueden ver y gestionar los reportes desde
// la sección de Pedidos (tab "Reportes").
// DB path: reports/{id}
// ===========================================================

let shared;
let isInitialized = false;

const ADMIN_EMAILS = ['baquezadat@gmail.com'];

// Tipos de problema disponibles
const ISSUE_TYPES = [
    { id: 'video',    icon: 'fa-film',            label: 'Mala calidad de video'              },
    { id: 'audio',    icon: 'fa-volume-mute',      label: 'Problema de audio / desincronizado' },
    { id: 'subs',     icon: 'fa-closed-captioning', label: 'Subtítulos incorrectos / faltantes' },
    { id: 'broken',   icon: 'fa-unlink',           label: 'Enlace roto / no carga'             },
    { id: 'wrong',    icon: 'fa-random',           label: 'Contenido incorrecto'               },
    { id: 'other',    icon: 'fa-ellipsis-h',       label: 'Otro problema'                      },
];

// ─────────────────────────────────────────────
// 1. INICIALIZACIÓN
// ─────────────────────────────────────────────
export function initReports(dependencies) {
    if (isInitialized) return;
    shared = dependencies;
    isInitialized = true;
}

// ─────────────────────────────────────────────
// 2. ABRIR MODAL DE REPORTE
// ─────────────────────────────────────────────
export function openReportModal({ contentId, contentTitle, contentType = 'movie', episodeInfo = null }) {
    const user = shared.auth.currentUser;
    if (!user) {
        _showToast('Debes iniciar sesión para enviar un reporte.', 'error');
        return;
    }

    // Eliminar modal previo si existe
    document.getElementById('report-modal')?.remove();

    const episodeLabel = episodeInfo
        ? `<span class="report-episode-tag"><i class="fas fa-tv"></i> T${episodeInfo.season} · E${episodeInfo.episode}${episodeInfo.title ? ` — ${episodeInfo.title}` : ''}</span>`
        : '';

    const modal = document.createElement('div');
    modal.id = 'report-modal';
    modal.className = 'modal show';
    modal.innerHTML = `
        <div class="report-modal-inner">
            <button class="close-btn" id="report-close-btn">&times;</button>

            <div class="report-header">
                <div class="report-header-icon"><i class="fas fa-flag"></i></div>
                <div>
                    <h2 class="report-title">Reportar problema</h2>
                    <p class="report-subtitle">
                        <span class="report-content-name">${_escapeHtml(contentTitle)}</span>
                        ${episodeLabel}
                    </p>
                </div>
            </div>

            <p class="report-section-label">¿Qué tipo de problema encontraste?</p>
            <div class="report-issue-grid" id="report-issue-grid">
                ${ISSUE_TYPES.map(t => `
                    <button class="report-issue-btn" data-id="${t.id}">
                        <i class="fas ${t.icon}"></i>
                        <span>${t.label}</span>
                    </button>
                `).join('')}
            </div>

            <div class="report-desc-wrapper" id="report-desc-wrapper" style="display:none;">
                <label class="report-section-label" for="report-desc-input">
                    Detalles adicionales <span class="report-optional">(opcional)</span>
                </label>
                <textarea id="report-desc-input" class="report-textarea"
                    maxlength="400"
                    placeholder="Describe el problema con más detalle..."></textarea>
                <span class="report-char-count"><span id="report-char-num">0</span>/400</span>
            </div>

            <div id="report-feedback" class="report-feedback" style="display:none;"></div>

            <div class="report-actions" id="report-actions" style="display:none;">
                <button class="report-submit-btn" id="report-submit-btn">
                    <i class="fas fa-paper-plane"></i> Enviar reporte
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    document.body.classList.add('modal-open');

    // ── Lógica de selección de tipo ──
    let selectedType = null;
    const grid      = modal.querySelector('#report-issue-grid');
    const descWrap  = modal.querySelector('#report-desc-wrapper');
    const actions   = modal.querySelector('#report-actions');
    const textarea  = modal.querySelector('#report-desc-input');
    const charNum   = modal.querySelector('#report-char-num');
    const feedback  = modal.querySelector('#report-feedback');

    grid.addEventListener('click', e => {
        const btn = e.target.closest('.report-issue-btn');
        if (!btn) return;

        grid.querySelectorAll('.report-issue-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedType = btn.dataset.id;

        descWrap.style.display  = 'block';
        actions.style.display   = 'flex';
        feedback.style.display  = 'none';
    });

    textarea.addEventListener('input', () => {
        charNum.textContent = textarea.value.length;
    });

    // ── Envío ──
    modal.querySelector('#report-submit-btn').onclick = async () => {
        if (!selectedType) return;

        const submitBtn = modal.querySelector('#report-submit-btn');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

        const issueLabel = ISSUE_TYPES.find(t => t.id === selectedType)?.label || selectedType;

        const reportData = {
            contentId,
            contentTitle,
            contentType,
            issueType:   selectedType,
            issueLabel,
            description: textarea.value.trim() || null,
            episodeInfo: episodeInfo || null,
            userId:      user.uid,
            userEmail:   user.email,
            userName:    user.displayName || user.email.split('@')[0],
            timestamp:   firebase.database.ServerValue.TIMESTAMP,
            status:      'pending',
        };

        try {
            await shared.db.ref('reports').push(reportData);

            // Feedback de éxito dentro del modal
            grid.style.display         = 'none';
            descWrap.style.display     = 'none';
            actions.style.display      = 'none';
            modal.querySelector('.report-section-label')?.remove();

            feedback.style.display = 'flex';
            feedback.innerHTML = `
                <div class="report-success-icon"><i class="fas fa-check-circle"></i></div>
                <h3 class="report-success-title">¡Reporte enviado!</h3>
                <p class="report-success-msg">Gracias por ayudarnos a mejorar la calidad del cine. Revisaremos el problema lo antes posible.</p>
                <button class="report-done-btn" id="report-done-btn">Cerrar</button>
            `;
            feedback.querySelector('#report-done-btn').onclick = _closeReportModal;

        } catch (err) {
            console.error('Error enviando reporte:', err);
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar reporte';
            _showToast('Hubo un error al enviar el reporte. Intenta de nuevo.', 'error');
        }
    };

    // ── Cierre ──
    modal.querySelector('#report-close-btn').onclick = _closeReportModal;
    modal.addEventListener('click', e => { if (e.target === modal) _closeReportModal(); });
}

function _closeReportModal() {
    const modal = document.getElementById('report-modal');
    if (modal) modal.remove();
    if (!document.querySelector('.modal.show')) {
        document.body.classList.remove('modal-open');
    }
}

// ─────────────────────────────────────────────
// 3. PANEL ADMIN: LISTA DE REPORTES
// ─────────────────────────────────────────────
export async function renderAdminReports(container) {
    if (!container) return;

    // Esperar a que auth esté listo si aún no lo está
    const currentUser = shared.auth.currentUser || await new Promise(resolve => {
        const unsub = shared.auth.onAuthStateChanged(user => { unsub(); resolve(user); });
    });

    const isAdmin = currentUser && ADMIN_EMAILS.includes(currentUser.email);
    if (!isAdmin) {
        container.innerHTML = '<p style="color:#666; text-align:center; padding:40px 0;">Acceso restringido.</p>';
        return;
    }

    container.innerHTML = `
        <div class="reports-admin-toolbar">
            <div class="reports-admin-filters" id="reports-status-filters">
                <button class="reports-filter-btn active" data-status="pending">
                    <i class="fas fa-clock"></i> Pendientes
                </button>
                <button class="reports-filter-btn" data-status="resolved">
                    <i class="fas fa-check-circle"></i> Resueltos
                </button>
                <button class="reports-filter-btn" data-status="all">
                    <i class="fas fa-list"></i> Todos
                </button>
            </div>
            <span class="reports-count-badge" id="reports-count-badge"></span>
        </div>
        <div id="reports-list-container" class="reports-list-container">
            <div class="spinner" style="margin: 60px auto;"></div>
        </div>
    `;

    let currentFilter = 'pending';

    const filterBtns = container.querySelectorAll('.reports-filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.status;
            _loadReports(currentFilter, container.querySelector('#reports-list-container'), container.querySelector('#reports-count-badge'));
        });
    });

    await _loadReports('pending', container.querySelector('#reports-list-container'), container.querySelector('#reports-count-badge'));
}

async function _loadReports(statusFilter, listEl, badgeEl) {
    listEl.innerHTML = '<div class="spinner" style="margin: 60px auto;"></div>';

    try {
        // Usar REST API para evitar caché del SDK
        const user = shared.auth.currentUser;
        const token = user ? await user.getIdToken(true) : null;
        const dbUrl = shared.db.ref().toString();
        const res = await fetch(`${dbUrl}/reports.json?auth=${token}&ts=${Date.now()}`);
        const data = await res.json();

        const reports = [];
        if (data && typeof data === 'object') {
            for (const [key, val] of Object.entries(data)) {
                reports.push({ _id: key, ...val });
            }
        }
        console.log('[Reports] Total en Firebase:', reports.length, reports.map(r => ({ id: r._id, status: r.status, title: r.contentTitle })));

        // Filtrar por estado en el cliente
        // Tratamos null/undefined como 'pending' por si algún reporte se creó sin status
        const normalizeStatus = s => (s === 'resolved' ? 'resolved' : 'pending');
        const filtered = statusFilter === 'all'
            ? reports
            : reports.filter(r => normalizeStatus(r.status) === statusFilter);

        filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        if (badgeEl) badgeEl.textContent = filtered.length > 0 ? filtered.length : '';

        if (filtered.length === 0) {
            listEl.innerHTML = `
                <div class="reports-empty">
                    <i class="fas fa-flag" style="font-size:2.5rem; color:#333; margin-bottom:12px;"></i>
                    <p>No hay reportes ${statusFilter === 'pending' ? 'pendientes' : statusFilter === 'resolved' ? 'resueltos' : ''}.</p>
                </div>
            `;
            return;
        }

        listEl.innerHTML = '';
        filtered.forEach(r => listEl.appendChild(_buildReportCard(r, listEl, badgeEl, statusFilter)));

    } catch (err) {
        console.error('Error cargando reportes:', err);
        listEl.innerHTML = '<p style="color:#f44; text-align:center; padding:40px 0;">Error al cargar reportes.</p>';
    }
}

function _buildReportCard(report, listEl, badgeEl, currentFilter) {
    const card = document.createElement('div');
    card.className = `report-admin-card ${report.status === 'resolved' ? 'report-admin-card--resolved' : ''}`;
    card.dataset.id = report._id;

    const issueType = ISSUE_TYPES.find(t => t.id === report.issueType);
    const icon = issueType?.icon || 'fa-flag';
    const date = report.timestamp ? new Date(report.timestamp).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

    const episodeTag = report.episodeInfo
        ? `<span class="report-card-episode"><i class="fas fa-tv"></i> T${report.episodeInfo.season}·E${report.episodeInfo.episode}</span>`
        : '';

    card.innerHTML = `
        <div class="report-card-header">
            <div class="report-card-issue-icon ${report.status === 'resolved' ? 'resolved' : ''}">
                <i class="fas ${icon}"></i>
            </div>
            <div class="report-card-info">
                <div class="report-card-top">
                    <span class="report-card-content-title">${_escapeHtml(report.contentTitle || '—')}</span>
                    ${episodeTag}
                    <span class="report-card-type-badge">${_escapeHtml(report.issueLabel || report.issueType || '—')}</span>
                </div>
                <div class="report-card-meta">
                    <span><i class="fas fa-user" style="color:#E50914;"></i> ${_escapeHtml(report.userName || report.userEmail || '—')}</span>
                    <span><i class="fas fa-clock" style="color:#666;"></i> ${date}</span>
                    <span class="report-status-chip ${report.status === 'resolved' ? 'chip-resolved' : 'chip-pending'}">
                        ${report.status === 'resolved' ? '✓ Resuelto' : '⏳ Pendiente'}
                    </span>
                </div>
                ${report.description ? `<p class="report-card-desc">"${_escapeHtml(report.description)}"</p>` : ''}
            </div>
        </div>
        <div class="report-card-actions">
            ${report.status === 'pending'
                ? `<button class="report-action-btn report-resolve-btn" data-id="${report._id}"><i class="fas fa-check"></i> Marcar resuelto</button>`
                : `<button class="report-action-btn report-unresolve-btn" data-id="${report._id}" style="opacity:0.6;"><i class="fas fa-undo"></i> Reabrir</button>`
            }
            <button class="report-action-btn report-delete-btn" data-id="${report._id}"><i class="fas fa-trash"></i> Eliminar</button>
        </div>
    `;

    // Resolver / reabrir
    const resolveBtn  = card.querySelector('.report-resolve-btn');
    const unresolveBtn = card.querySelector('.report-unresolve-btn');

    if (resolveBtn) {
        resolveBtn.onclick = async () => {
            resolveBtn.disabled = true;
            await shared.db.ref(`reports/${report._id}`).update({
                status: 'resolved',
                resolvedAt: firebase.database.ServerValue.TIMESTAMP,
                resolvedBy: shared.auth.currentUser?.email
            });
            _showToast('Reporte marcado como resuelto', 'success');
            await _loadReports(currentFilter, listEl, badgeEl);
        };
    }
    if (unresolveBtn) {
        unresolveBtn.onclick = async () => {
            unresolveBtn.disabled = true;
            await shared.db.ref(`reports/${report._id}`).update({ status: 'pending', resolvedAt: null, resolvedBy: null });
            _showToast('Reporte reabierto', 'success');
            await _loadReports(currentFilter, listEl, badgeEl);
        };
    }

    // Eliminar
    card.querySelector('.report-delete-btn').onclick = async () => {
        if (!confirm('¿Eliminar este reporte definitivamente?')) return;
        await shared.db.ref(`reports/${report._id}`).remove();
        _showToast('Reporte eliminado', 'success');
        await _loadReports(currentFilter, listEl, badgeEl);
    };

    return card;
}

// ─────────────────────────────────────────────
// 4. INYECCIÓN AUTOMÁTICA EN EL SERIES PLAYER
// ─────────────────────────────────────────────

// Parsea "T1 E3 - Título del episodio" → { season, episode, title }
function _parseEpisodeLabel(text) {
    if (!text) return null;
    // Soporta: "T1 E3 - Título", "T1 E3", "Temporada 1 Episodio 3 - Título"
    const m = text.match(/T(\d+)\s*E(\d+)(?:\s*[-–]\s*(.+))?/i);
    if (!m) return null;
    return {
        season:  parseInt(m[1]),
        episode: parseInt(m[2]),
        title:   m[3]?.trim() || null
    };
}

// Lee el estado actual del player de series desde el DOM
function _readSeriesPlayerState() {
    const modal = document.getElementById('series-player-modal');
    if (!modal) return null;

    // Título de la serie (ej: "FIRE FORCE")
    const seriesTitleEl = modal.querySelector('.series-main-title');
    const contentTitle  = seriesTitleEl?.textContent?.trim() || '';

    // Subtítulo del episodio (ej: "T1 E1 - Shinra Kusakabe se enlista")
    const episodeLabelEl = modal.querySelector('.player-container .player-title');
    const episodeInfo    = _parseEpisodeLabel(episodeLabelEl?.textContent?.trim());

    // Buscar contentId en appState por título
    let contentId = modal.dataset.seriesId || '';
    if (!contentId && shared.appState) {
        const allSeries = shared.appState.content.series || {};
        const found = Object.entries(allSeries).find(([, d]) =>
            d.title?.toUpperCase() === contentTitle.toUpperCase()
        );
        if (found) contentId = found[0];
    }

    return { contentId, contentTitle, episodeInfo };
}

// Inyecta (o actualiza) el botón de reporte en el player de series
export function syncSeriesReportButton() {
    const modal = document.getElementById('series-player-modal');
    if (!modal || !modal.classList.contains('show')) return;

    // Colocar el slot dentro de .sidebar-title-row (junto al título "Episodios")
    const titleRow = modal.querySelector('.sidebar-title-row');
    if (!titleRow) return;

    // Crear o reutilizar el slot del botón
    let slot = modal.querySelector('.series-report-slot');
    if (!slot) {
        slot = document.createElement('div');
        slot.className = 'series-report-slot';
        titleRow.appendChild(slot);
    }

    const state = _readSeriesPlayerState();
    if (!state?.contentTitle) return;

    const { contentId, contentTitle, episodeInfo } = state;

    // Actualizar el botón (siempre recrea para reflejar episodio actual)
    slot.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'btn-report-series';
    btn.title = episodeInfo
        ? `Reportar T${episodeInfo.season} E${episodeInfo.episode}`
        : 'Reportar problema';
    btn.innerHTML = `<i class="fas fa-flag"></i>`;
    btn.onclick = () => openReportModal({ contentId, contentTitle, contentType: 'series', episodeInfo });
    slot.appendChild(btn);
}

// Función pública legada (compatible con llamadas desde player.js)
export function injectReportButtonInSeriesPlayer(contentId, contentTitle, episodeInfo = null) {
    syncSeriesReportButton();
}

// Función pública: inyecta el botón de reporte en el player de cine
export function injectReportButtonInCinema(contentId, contentTitle) {
    const controls = document.querySelector('#cinema .cinema-controls');
    if (!controls) return;
    controls.querySelector('.btn-report')?.remove();
    const btn = document.createElement('button');
    btn.className = 'btn btn-report';
    btn.innerHTML = '<i class="fas fa-flag"></i> Reportar problema';
    btn.onclick = () => openReportModal({ contentId, contentTitle, contentType: 'movie' });
    controls.appendChild(btn);
}

// ─────────────────────────────────────────────
// 5. HELPERS INTERNOS
// ─────────────────────────────────────────────
function _showToast(message, type = 'success') {
    const container = document.getElementById('toast-container') || document.body;
    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i> ${message}`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 400);
    }, 3500);
}

function _escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
