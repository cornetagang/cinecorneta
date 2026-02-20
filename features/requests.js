// ===========================================================
// MÓDULO DE PEDIDOS - requests.js
// Versión: 1.0.0
// ===========================================================

let shared;
let isInitialized = false;
const ADMIN_EMAILS = ['baquezadat@gmail.com'];

// -------------------------------------------------------
// INICIALIZACIÓN
// -------------------------------------------------------
export function initRequests(dependencies) {
    if (isInitialized) return;
    shared = dependencies;
    isInitialized = true;
    try { ['seenAddedRequests','annViewCounts','addedNotifViewCounts'].forEach(k=>localStorage.removeItem(k)); } catch {}
}

// -------------------------------------------------------
// ABRIR MODAL DE PEDIDO
// -------------------------------------------------------
export function openRequestModal() {
    const user = shared.auth.currentUser;
    if (!user) {
        shared.ErrorHandler?.show('auth', 'Debes iniciar sesión para hacer un pedido.');
        return;
    }

    const existing = document.getElementById('request-form-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'request-form-modal';
    modal.className = 'modal show';
    modal.innerHTML = `
        <div class="auth-modal-content" style="max-width: 480px;">
            <button class="close-btn" id="close-request-modal">&times;</button>
            <h2 style="font-family: 'Bebas Neue', sans-serif; font-size: 1.8rem; margin-bottom: 5px; letter-spacing: 1px;">
                <i class="fas fa-film" style="color: #E50914;"></i> HACER UN PEDIDO
            </h2>
            <p style="color: #aaa; font-size: 0.85rem; margin-bottom: 20px;">
                ¿Hay algo que quieres ver y no está en el cine? Pide la wea.
            </p>

            <div class="settings-group" style="margin-bottom: 16px;">
                <label style="color: #ccc; font-size: 0.85rem; margin-bottom: 6px; display: block;">
                    Nombre de la Película / Serie / Saga
                </label>
                <input type="text" id="req-movie-name" placeholder="Ej: Casado con Hijos, Infieles..."
                    style="width: 100%; background: #1a1a1a; border: 1px solid #333; color: white; padding: 11px 14px; border-radius: 8px; font-size: 0.95rem; box-sizing: border-box;">
            </div>

            <div class="settings-group" style="margin-bottom: 16px;">
                <label style="color: #ccc; font-size: 0.85rem; margin-bottom: 10px; display: block;">
                    Idioma preferido
                </label>
                <div style="display: flex; gap: 12px; flex-wrap: wrap; justify-content: center;">
                    <label class="req-audio-option">
                        <input type="checkbox" name="req-audio" value="original">
                        <span>Original</span>
                    </label>
                    <label class="req-audio-option">
                        <input type="checkbox" name="req-audio" value="latino">
                        <span>Latino</span>
                    </label>
                    <label class="req-audio-option">
                        <input type="checkbox" id="req-audio-otro-check" name="req-audio" value="otro">
                        <span>Otro</span>
                    </label>
                </div>
                <div id="req-otro-field" style="display: none; margin-top: 12px;">
                    <input type="text" id="req-otro-text" placeholder="Especifica el idioma..."
                        style="width: 100%; background: #1a1a1a; border: 1px solid #555; color: white; padding: 10px 14px; border-radius: 8px; font-size: 0.88rem; box-sizing: border-box; transition: border-color 0.2s;">
                </div>
            </div>

            <div class="settings-group" style="margin-bottom: 20px;">
                <label style="color: #ccc; font-size: 0.85rem; margin-bottom: 6px; display: block;">
                    Información Adicional <span style="color: #666;">(opcional)</span>
                </label>
                <textarea id="req-info" placeholder="Director, país, año, si tiene varias versiones, etc..."
                    rows="4"
                    style="width: 100%; background: #1a1a1a; border: 1px solid #333; color: white; padding: 11px 14px; border-radius: 8px; font-size: 0.9rem; resize: vertical; box-sizing: border-box; font-family: inherit;"></textarea>
            </div>

            <div style="display: flex; gap: 10px;">
                <button id="submit-request-btn" class="btn-primary" style="flex: 1; padding: 13px; font-size: 1rem; background: #E50914;">
                    <i class="fas fa-check"></i> Enviar pedido
                </button>
                <button id="cancel-request-btn" class="btn-primary" style="flex: 1; padding: 13px; font-size: 1rem; background: #333;">
                    <i class="fas fa-times"></i> Cancelar
                </button>
            </div>
            <p id="req-feedback" style="display: none; margin-top: 12px; text-align: center; font-size: 0.9rem;"></p>
        </div>
    `;

    document.body.appendChild(modal);
    document.body.classList.add('modal-open');

    // Cerrar
    const closeModal = () => {
        modal.remove();
        if (!document.querySelector('.modal.show')) {
            document.body.classList.remove('modal-open');
        }
    };

    document.getElementById('close-request-modal').onclick = closeModal;
    document.getElementById('cancel-request-btn').onclick = closeModal;

    // Mostrar/ocultar campo "Otro" al marcar el checkbox
    const otroCheck = document.getElementById('req-audio-otro-check');
    const otroField = document.getElementById('req-otro-field');
    otroCheck.addEventListener('change', () => {
        otroField.style.display = otroCheck.checked ? 'block' : 'none';
        if (!otroCheck.checked) {
            document.getElementById('req-otro-text').value = '';
        }
    });

    // Enviar
    document.getElementById('submit-request-btn').onclick = () => submitRequest(user, modal);
}

// -------------------------------------------------------
// ENVIAR PEDIDO
// -------------------------------------------------------
async function submitRequest(user, modal) {
    const nameInput = document.getElementById('req-movie-name');
    const infoInput = document.getElementById('req-info');
    const audioChecks = [...document.querySelectorAll('input[name="req-audio"]:checked')];
    const feedbackEl = document.getElementById('req-feedback');
    const submitBtn = document.getElementById('submit-request-btn');
    const otroText = document.getElementById('req-otro-text');

    const name = nameInput.value.trim();

    // Construir etiquetas de audio, reemplazando "otro" por el texto personalizado si existe
    const audioLabels = audioChecks.map(c => {
        if (c.value === 'otro') {
            const custom = otroText ? otroText.value.trim() : '';
            return custom || 'Otro / Ambos';
        }
        return c.value === 'original' ? 'Original' : 'Latino';
    });

    // Validaciones
    if (!name) {
        showModalFeedback(feedbackEl, 'Ingresa el nombre de la película o serie.', 'error');
        return;
    }
    if (audioLabels.length === 0) {
        showModalFeedback(feedbackEl, 'Selecciona al menos un tipo de audio.', 'error');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

    try {
        const requestData = {
            movieName: name,
            audioType: audioLabels.join(', '),
            info: infoInput.value.trim() || '',
            userId: user.uid,
            username: user.displayName || 'Usuario',
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            status: 'pending'
        };

        await shared.db.ref('requests').push(requestData);

        modal.remove();
        if (!document.querySelector('.modal.show')) {
            document.body.classList.remove('modal-open');
        }
        showToast('¡Pedido enviado! Se agregará pronto.', 'success');
        const _t = document.querySelector('.req-tab-btn.active');
        loadAndRenderRequests(_t ? _t.dataset.status : 'all', shared.auth.currentUser && ADMIN_EMAILS.includes(shared.auth.currentUser.email));

    } catch (error) {
        console.error('Error al enviar pedido:', error);
        showModalFeedback(feedbackEl, 'Error al enviar. Intenta de nuevo.', 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-check"></i> Enviar pedido';
    }
}

// -------------------------------------------------------
// RENDERIZAR SECCIÓN PÚBLICA DE PEDIDOS
// -------------------------------------------------------
export async function renderRequestsSection() {
    const container = document.getElementById('requests-container');
    if (!container) return;

    const user = shared.auth.currentUser;
    const isAdmin = user && ADMIN_EMAILS.includes(user.email);

    container.innerHTML = `
        <div class="requests-page-header">
            <div class="requests-page-header-inner">
                <div>
                    <h1 class="requests-page-title">Pedidos</h1>
                </div>
                ${user ? `
                <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                    ${isAdmin ? `
                    <button id="req-announcement-btn" class="btn-primary requests-new-btn" style="background: #222; border: 1px solid #444;">
                        <i class="fas fa-bullhorn"></i> Publicar aviso
                    </button>` : ''}
                    <button id="open-request-modal-btn" class="btn-primary requests-new-btn">
                        <i class="fas fa-plus"></i> Hacer un pedido
                    </button>
                </div>` : `
                <p class="requests-login-hint"><i class="fas fa-lock"></i> Inicia sesión para pedir</p>
                `}
            </div>
        </div>
        <div class="requests-body">
            <div id="requests-filter-tabs" class="req-tabs-bar">
                <button class="req-tab-btn active" data-status="all">Todos</button>
                <button class="req-tab-btn" data-status="pending"><i class="fas fa-clock"></i> Pendientes</button>
                <button class="req-tab-btn" data-status="added"><i class="fas fa-check-circle"></i> Agregadas</button>
                <button class="req-tab-btn" data-status="rejected"><i class="fas fa-times-circle"></i> No encontradas</button>
                <button class="req-tab-btn" data-status="announcements"><i class="fas fa-bullhorn"></i> Avisos</button>
            </div>
            <div id="requests-list" class="requests-list">
                <div class="spinner" style="margin: 60px auto;"></div>
            </div>
        </div>
    `;

    // Botón abrir modal
    const openBtn = document.getElementById('open-request-modal-btn');
    if (openBtn) openBtn.onclick = openRequestModal;

    // Botón aviso personalizado (solo admin)
    const annBtn = document.getElementById('req-announcement-btn');
    if (annBtn) annBtn.onclick = openAnnouncementModal;

    // Tabs de filtro
    let currentStatus = 'all';
    document.querySelectorAll('.req-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.req-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentStatus = btn.dataset.status;
            loadAndRenderRequests(currentStatus, isAdmin);
        });
    });

    // Carga inicial
    await loadAndRenderRequests('all', isAdmin);
}

// -------------------------------------------------------
// CARGAR Y RENDERIZAR LISTA (pedidos + avisos mezclados)
// -------------------------------------------------------
async function loadAndRenderRequests(status, isAdmin) {
    const listEl = document.getElementById('requests-list');
    if (!listEl) return;

    listEl.innerHTML = '<div class="spinner" style="margin: 60px auto;"></div>';

    try {
        // Cargar pedidos
        let requests = [];
        const reqSnap = await shared.db.ref('requests').orderByChild('timestamp').once('value');
        if (reqSnap.exists()) {
            reqSnap.forEach(child => requests.push({ _type: 'request', id: child.key, ...child.val() }));
        }

        // Cargar log de avisos
        let announcements = [];
        const annSnap = await shared.db.ref('system_metadata/announcement_log').once('value');
        if (annSnap.exists()) {
            annSnap.forEach(child => announcements.push({ _type: 'announcement', id: child.key, ...child.val() }));
        }

        // Tab exclusivo de Avisos
        if (status === 'announcements') {
            const items = announcements.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            listEl.innerHTML = '';
            if (items.length === 0) {
                listEl.innerHTML = '<p style="color: #666; text-align: center; padding: 40px 0;">No hay avisos publicados.</p>';
                return;
            }
            items.forEach(ann => listEl.appendChild(buildAnnouncementCard(ann, isAdmin)));
            return;
        }

        // Filtrar pedidos por status
        let filteredRequests = status === 'all' ? requests : requests.filter(r => r.status === status);

        // En "all" mezclamos avisos + pedidos; en otros tabs solo pedidos filtrados
        const mixed = status === 'all'
            ? [...filteredRequests, ...announcements]
            : filteredRequests;

        // Ordenar por timestamp más nuevo primero
        mixed.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        listEl.innerHTML = '';

        if (mixed.length === 0) {
            listEl.innerHTML = '<p style="color: #666; text-align: center; padding: 40px 0;">No hay pedidos en esta categoría.</p>';
            return;
        }

        mixed.forEach(item => {
            if (item._type === 'announcement') {
                listEl.appendChild(buildAnnouncementCard(item, isAdmin));
            } else {
                listEl.appendChild(buildRequestCard(item, isAdmin));
            }
        });

    } catch (error) {
        console.error('Error cargando:', error);
        listEl.innerHTML = '<p style="color: #ff4444; text-align: center; padding: 40px 0;">Error al cargar.</p>';
    }
}

// -------------------------------------------------------
// HELPER: FORMATEAR FECHA + HORA
// -------------------------------------------------------
function formatDateTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const date = d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${date}, ${time}`;
}

// -------------------------------------------------------
// CONSTRUIR TARJETA DE AVISO (del log histórico)
// -------------------------------------------------------
function buildAnnouncementCard(ann, isAdmin) {
    const card = document.createElement('div');
    card.className = 'announcement-list-card';

    const dateTime = formatDateTime(ann.timestamp);

    card.innerHTML = `
        <div class="ann-card-left">
            <div class="ann-card-icon"><i class="fas fa-bullhorn"></i></div>
            <div class="ann-card-body">
                <span class="ann-card-label">Aviso</span>
                <p class="ann-card-title">${escapeHtml(ann.text)}</p>
                ${ann.subtitle ? `<p class="ann-card-subtitle">${escapeHtml(ann.subtitle)}</p>` : ''}
            </div>
        </div>
        <div class="ann-card-right">
            ${dateTime ? `<span class="ann-card-date"><i class="fas fa-calendar"></i> ${dateTime}</span>` : ''}
            ${isAdmin ? `<button class="ann-card-delete-btn" title="Eliminar aviso del historial" data-id="${ann.id}"><i class="fas fa-trash"></i></button>` : ''}
        </div>
    `;

    if (isAdmin) {
        card.querySelector('.ann-card-delete-btn').onclick = async () => {
            // Borrar del log (fuente de verdad única)
            await shared.db.ref(`system_metadata/announcement_log/${ann.id}`).remove();
            // Limpiar contador de vistas de este aviso
            try {
                const counts = JSON.parse(localStorage.getItem('annViewCounts') || '{}');
                delete counts[ann.id];
                localStorage.setItem('annViewCounts', JSON.stringify(counts));
            } catch {}
            showToast('Aviso eliminado', 'success');
            const activeTab = document.querySelector('.req-tab-btn.active');
            loadAndRenderRequests(activeTab?.dataset.status || 'all', true);
        };
    }

    return card;
}

// -------------------------------------------------------
// CONSTRUIR TARJETA DE PEDIDO
// -------------------------------------------------------
function buildRequestCard(req, isAdmin) {
    const card = document.createElement('div');
    card.className = 'request-card';
    card.dataset.status = req.status;

    const statusConfig = {
        pending: { label: 'Pendiente', color: '#f5a623', icon: 'fa-clock' },
        added: { label: 'Agregada', color: '#46d369', icon: 'fa-check-circle' },
        rejected: { label: 'No encontrada', color: '#888', icon: 'fa-times-circle' }
    };
    const s = statusConfig[req.status] || statusConfig.pending;

    const date = req.timestamp ? formatDateTime(req.timestamp) : '';

    // Audio badge
    const audioBadge = req.audioType ? `<span class="req-audio-badge">${req.audioType}</span>` : '';

    card.innerHTML = `
        <div class="request-card-header">
            <div class="request-card-title-row">
                <h3 class="request-card-title">${escapeHtml(req.movieName)}</h3>
                <span class="req-status-badge" style="color: ${s.color}; border-color: ${s.color};">
                    <i class="fas ${s.icon}"></i> ${s.label}
                </span>
            </div>
            <div class="request-card-meta">
                <span><i class="fas fa-user" style="color: #E50914;"></i> ${escapeHtml(req.username || 'Usuario')}</span>
                ${audioBadge}
                ${date ? `<span><i class="fas fa-calendar" style="color: #666;"></i> ${date}</span>` : ''}
            </div>
        </div>
        ${req.info ? `<p class="request-card-info">${escapeHtml(req.info)}</p>` : ''}
        ${isAdmin ? `
        <div class="request-card-footer">
            <div class="req-silence-area">
                ${req.status === 'pending' ? (() => {
                    const silenced = getSilenced();
                    return silenced.includes(req.id)
                        ? `<span class="req-silenced-hint"><button class="req-unsilence-btn" data-id="${req.id}"><i class="fas fa-bell"></i> Reactivar</button><i class="fas fa-bell-slash"></i> Aviso silenciado</span>`
                        : `<button class="req-silence-btn" data-id="${req.id}"><i class="fas fa-bell-slash"></i> Silenciar aviso</button>`;
                })() : ''}
            </div>
            <div class="request-card-admin-actions">
                ${req.status !== 'added' ? `
                <button class="req-admin-btn req-btn-add" data-id="${req.id}">
                    <i class="fas fa-check"></i> Agregada
                </button>` : ''}
                ${req.status !== 'rejected' ? `
                <button class="req-admin-btn req-btn-reject" data-id="${req.id}">
                    <i class="fas fa-times"></i> No encontrada
                </button>` : ''}
                ${req.status !== 'pending' ? `
                <button class="req-admin-btn req-btn-pending" data-id="${req.id}">
                    <i class="fas fa-undo"></i> Pendiente
                </button>` : ''}
                <button class="req-admin-btn req-btn-delete" data-id="${req.id}">
                    <i class="fas fa-trash"></i> Eliminar
                </button>
            </div>
        </div>` : ''}
    `;

    if (isAdmin) {
        const silenceBtn   = card.querySelector('.req-silence-btn');
        const unsilenceBtn = card.querySelector('.req-unsilence-btn');
        if (silenceBtn) silenceBtn.onclick = () => silenceRequest(req.id);
        if (unsilenceBtn) unsilenceBtn.onclick = () => {
            setSilenced(getSilenced().filter(id => id !== req.id));
            showToast('Aviso reactivado', 'success');
            const tab = document.querySelector('.req-tab-btn.active');
            loadAndRenderRequests(tab ? tab.dataset.status : 'all', true);
        };
        const addBtn     = card.querySelector('.req-btn-add');
        const rejectBtn  = card.querySelector('.req-btn-reject');
        const pendingBtn = card.querySelector('.req-btn-pending');
        const deleteBtn  = card.querySelector('.req-btn-delete');
        if (addBtn)     addBtn.onclick     = () => openAddedModal(req);
        if (rejectBtn)  rejectBtn.onclick  = () => updateRequestStatus(req.id, 'rejected', req);
        if (pendingBtn) pendingBtn.onclick  = () => updateRequestStatus(req.id, 'pending', req);
        if (deleteBtn)  deleteBtn.onclick  = () => deleteRequest(req.id);
    }

    return card;
}

// -------------------------------------------------------
// ADMIN: MODAL PERSONALIZAR AVISO AL AGREGAR
// -------------------------------------------------------
function openAddedModal(req) {
    document.getElementById('req-added-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'req-added-modal';
    modal.className = 'modal show';
    modal.innerHTML = `
        <div class="auth-modal-content" style="max-width: 480px; position: relative;">
            <button class="close-btn" id="close-added-modal">&times;</button>
            <h2 style="font-family: 'Bebas Neue', sans-serif; font-size: 1.8rem; margin-bottom: 5px; letter-spacing: 1px;">
                <i class="fas fa-check-circle" style="color: #46d369;"></i> MARCAR COMO AGREGADA
            </h2>
            <p style="color: #aaa; font-size: 0.85rem; margin-bottom: 22px;">
                Personaliza el aviso que verán los usuarios al entrar al cine.
            </p>

            <div class="settings-group" style="margin-bottom: 16px;">
                <label style="color: #ccc; font-size: 0.85rem; margin-bottom: 6px; display: block;">Título del aviso</label>
                <input type="text" id="added-notif-title"
                    value="${escapeHtml(req.movieName)} ya está en el cine"
                    style="width: 100%; background: #1a1a1a; border: 1px solid #333; color: white; padding: 11px 14px; border-radius: 8px; font-size: 0.95rem; box-sizing: border-box;">
            </div>

            <div class="settings-group" style="margin-bottom: 16px;">
                <label style="color: #ccc; font-size: 0.85rem; margin-bottom: 8px; display: block;">Sección donde fue agregada</label>
                <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;">
                    <button class="req-section-btn" data-section="Películas">Películas</button>
                    <button class="req-section-btn" data-section="Series">Series</button>
                    <button class="req-section-btn" data-section="Universos">Universos</button>
                </div>
            </div>

            <div class="settings-group" style="margin-bottom: 16px;">
                <label style="color: #ccc; font-size: 0.85rem; margin-bottom: 6px; display: block;">
                    Subtítulo del aviso <span style="color: #555; font-size: 0.78rem;">(se genera solo, puedes editar)</span>
                </label>
                <input type="text" id="added-notif-subtitle"
                    placeholder="Ej: Disponible en Películas 🎬"
                    style="width: 100%; background: #1a1a1a; border: 1px solid #333; color: white; padding: 11px 14px; border-radius: 8px; font-size: 0.9rem; box-sizing: border-box;">
            </div>

            <div style="background: #111; border: 1px solid #222; border-radius: 8px; padding: 12px 14px; margin-bottom: 22px;">
                <p style="color: #555; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.8px; margin: 0 0 6px 0;">Vista previa del banner</p>
                <p id="notif-preview-title" style="color: #fff; font-size: 0.9rem; font-weight: 600; margin: 0 0 2px 0;"></p>
                <p id="notif-preview-subtitle" style="color: #aaa; font-size: 0.82rem; margin: 0;"></p>
            </div>

            <div style="display: flex; gap: 10px;">
                <button id="confirm-added-btn" class="btn-primary" style="flex: 1; padding: 13px; font-size: 1rem; background: #46d369; color: #000; font-weight: 700;">
                    <i class="fas fa-check"></i> Confirmar
                </button>
                <button id="cancel-added-btn" class="btn-primary" style="flex: 1; padding: 13px; font-size: 1rem; background: #333;">
                    <i class="fas fa-times"></i> Cancelar
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    document.body.classList.add('modal-open');

    const titleInput    = modal.querySelector('#added-notif-title');
    const subtitleInput = modal.querySelector('#added-notif-subtitle');
    const previewTitle  = modal.querySelector('#notif-preview-title');
    const previewSub    = modal.querySelector('#notif-preview-subtitle');
    let selectedSection = '';

    const updatePreview = () => {
        previewTitle.textContent = titleInput.value.trim() || req.movieName;
        previewSub.textContent   = subtitleInput.value.trim() || (selectedSection ? `Disponible en ${selectedSection} 🎬` : 'Ya disponible en el cine 🎬');
    };
    titleInput.addEventListener('input', updatePreview);
    subtitleInput.addEventListener('input', () => { subtitleInput.dataset.auto = 'false'; updatePreview(); });
    updatePreview();

    modal.querySelectorAll('.req-section-btn').forEach(btn => {
        btn.onclick = () => {
            modal.querySelectorAll('.req-section-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedSection = btn.dataset.section;
            if (subtitleInput.dataset.auto !== 'false') {
                subtitleInput.value = `Disponible en ${selectedSection} 🎬`;
                subtitleInput.dataset.auto = 'true';
            }
            updatePreview();
        };
    });

    const close = () => {
        modal.remove();
        if (!document.querySelector('.modal.show')) document.body.classList.remove('modal-open');
    };
    modal.querySelector('#close-added-modal').onclick = close;
    modal.querySelector('#cancel-added-btn').onclick  = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    modal.querySelector('#confirm-added-btn').onclick = async () => {
        const btn = modal.querySelector('#confirm-added-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Confirmando...';
        const customTitle    = titleInput.value.trim()    || req.movieName;
        const customSubtitle = subtitleInput.value.trim() || (selectedSection ? `Disponible en ${selectedSection} 🎬` : 'Ya disponible en el cine 🎬');
        await updateRequestStatus(req.id, 'added', req, { title: customTitle, subtitle: customSubtitle });
        close();
    };
}

// -------------------------------------------------------
// ADMIN: ACTUALIZAR ESTADO
// -------------------------------------------------------
async function updateRequestStatus(id, newStatus, reqData, customNotif = null) {
    try {
        const updateData = { status: newStatus };

        if (newStatus === 'added') {
            updateData.addedTimestamp       = firebase.database.ServerValue.TIMESTAMP;
            updateData.notificationTitle    = customNotif?.title    || reqData.movieName;
            updateData.notificationSubtitle = customNotif?.subtitle || null;
        }
        if (newStatus === 'pending') {
            updateData.addedTimestamp       = null;
            updateData.notificationTitle    = null;
            updateData.notificationSubtitle = null;
        }

        await shared.db.ref(`requests/${id}`).update(updateData);

        const toastMsg = {
            added:    '✅ Marcado como agregada',
            rejected: '❌ Marcado como no encontrada',
            pending:  '↩️ Revertido a pendiente'
        };
        showToast(toastMsg[newStatus] || 'Actualizado', 'success');

        // Feedback inmediato al admin + pre-incrementar para no repetir en recarga
        if (newStatus === 'added') {
            const t = customNotif?.title    || reqData.movieName;
            const s = customNotif?.subtitle || 'Ya disponible en el cine 🎬';
            try {
                const counts = JSON.parse(localStorage.getItem('notifViewCounts') || '{}');
                counts['req_' + id] = (counts['req_' + id] || 0) + 1;
                localStorage.setItem('notifViewCounts', JSON.stringify(counts));
            } catch {}
            showRequestsBanner({ icon: 'fa-film', title: t, subtitle: s, onClose: null });
        }

        const activeTab = document.querySelector('.req-tab-btn.active');
        const currentStatus = activeTab ? activeTab.dataset.status : 'all';
        loadAndRenderRequests(currentStatus, true);

    } catch (error) {
        console.error('Error actualizando pedido:', error);
        showToast('Error al actualizar', 'error');
    }
}

// -------------------------------------------------------
// ADMIN: ELIMINAR PEDIDO (con modal personalizado)
// -------------------------------------------------------
function deleteRequest(id) {
    // Crear modal de confirmación
    const existing = document.getElementById('req-confirm-delete-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'req-confirm-delete-modal';
    modal.className = 'modal show';
    modal.style.zIndex = '99999';
    modal.innerHTML = `
        <div class="confirmation-modal-content" style="
            background: #1a1a1a;
            border: 1px solid #333;
            border-radius: 16px;
            padding: 32px 28px;
            max-width: 380px;
            width: 90%;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.8);
        ">
            <h2 style="font-family: 'Bebas Neue', sans-serif; font-size: 1.6rem; color: #fff; margin: 0 0 10px 0; letter-spacing: 1px;">
                Eliminar pedido
            </h2>
            <p style="color: #aaa; font-size: 0.92rem; line-height: 1.5; margin: 0 0 28px 0;">
                ¿Estás seguro? Esta acción es <strong style="color: #ff4444;">permanente</strong> y no se puede deshacer.
            </p>
            <div style="display: flex; gap: 10px;">
                <button id="req-cancel-delete" style="
                    flex: 1; padding: 12px; border-radius: 8px;
                    background: #2a2a2a; border: 1px solid #444;
                    color: #ccc; font-size: 0.95rem; cursor: pointer;
                    transition: background 0.2s;
                " onmouseover="this.style.background='#333'" onmouseout="this.style.background='#2a2a2a'">
                    Cancelar
                </button>
                <button id="req-confirm-delete" style="
                    flex: 1; padding: 12px; border-radius: 8px;
                    background: linear-gradient(135deg, #c0392b, #e74c3c);
                    border: none; color: white; font-size: 0.95rem;
                    font-weight: 700; cursor: pointer;
                    transition: opacity 0.2s;
                " onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                    <i class="fas fa-trash"></i> Eliminar
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    document.body.classList.add('modal-open');

    const closeDeleteModal = () => {
        modal.remove();
        if (!document.querySelector('.modal.show:not(#req-confirm-delete-modal)')) {
            document.body.classList.remove('modal-open');
        }
    };

    // Cancelar
    document.getElementById('req-cancel-delete').onclick = closeDeleteModal;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeDeleteModal(); });

    // Confirmar
    document.getElementById('req-confirm-delete').onclick = async () => {
        const btn = document.getElementById('req-confirm-delete');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Eliminando...';
        try {
            await shared.db.ref(`requests/${id}`).remove();
            closeDeleteModal();
            showToast('Pedido eliminado', 'success');
            const activeTab = document.querySelector('.req-tab-btn.active');
            const currentStatus = activeTab ? activeTab.dataset.status : 'all';
            loadAndRenderRequests(currentStatus, true);
        } catch (error) {
            closeDeleteModal();
            showToast('Error al eliminar', 'error');
        }
    };
}

// -------------------------------------------------------
// HELPERS DE SILENCIADO
// -------------------------------------------------------
function getSilenced() {
    try { return JSON.parse(localStorage.getItem('silencedRequests') || '[]'); } catch { return []; }
}
function setSilenced(arr) {
    localStorage.setItem('silencedRequests', JSON.stringify(arr));
}
export function silenceRequest(id) {
    const s = getSilenced();
    if (!s.includes(id)) { s.push(id); setSilenced(s); }
    _clearAllBanners();
    showToast('Aviso silenciado', 'success');
    const tab = document.querySelector('.req-tab-btn.active');
    const isAdmin = shared.auth.currentUser && ADMIN_EMAILS.includes(shared.auth.currentUser.email);
    loadAndRenderRequests(tab ? tab.dataset.status : 'all', isAdmin);
}
window.silenceRequest = silenceRequest;

// -------------------------------------------------------
// NOTIFICACIÓN PEDIDOS AGREGADOS (todos, 48h)
// -------------------------------------------------------
export async function checkAddedNotifications() {
    // Reemplazado por checkSessionNotification()
}

// -------------------------------------------------------
// NOTIFICACIÓN PEDIDOS PENDIENTES (solo admin)
// -------------------------------------------------------
export async function checkPendingNotifications() {
    try {
        const user = shared.auth.currentUser;
        if (!user || !ADMIN_EMAILS.includes(user.email)) return;
        const silenced = getSilenced();
        const snap = await shared.db.ref('requests').orderByChild('status').equalTo('pending').once('value');
        if (!snap.exists()) return;
        const pending = [];
        snap.forEach(c => {
            if (!silenced.includes(c.key)) pending.push({ id: c.key, title: c.val().movieName });
        });
        if (!pending.length) return;
        showRequestsBanner({
            icon: 'fa-clock',
            title: pending.length > 1 ? `Tienes ${pending.length} pedidos pendientes` : '¡Tienes un pedido pendiente!',
            subtitle: pending.length > 1
                ? 'Revisa la sección de Pedidos.'
                : `<strong>${escapeHtml(pending[0].title)}</strong> está pendiente.`,
            onClose: null
        });
    } catch(e) { console.error('Error notif pendientes:', e); }
}

// -------------------------------------------------------
// -------------------------------------------------------
// SISTEMA DE BANNERS CON COLA Y STACK (máx 3 visibles)
// -------------------------------------------------------
const _bannerQueue   = [];
const _activeBanners = [];
const MAX_BANNERS    = 3;
const BANNER_DURATION = 8000;

function showRequestsBanner({ icon, title, subtitle, onClose }) {
    _bannerQueue.push({ icon, title, subtitle, onClose });
    _processBannerQueue();
}

function _processBannerQueue() {
    while (_activeBanners.length < MAX_BANNERS && _bannerQueue.length > 0) {
        _showBannerInStack(_bannerQueue.shift());
    }
}

function _getOrCreateStack() {
    let stack = document.getElementById('banner-stack-container');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'banner-stack-container';
        document.body.appendChild(stack);
    }
    return stack;
}

function _showBannerInStack({ icon, title, subtitle, onClose }) {
    const stack  = _getOrCreateStack();
    const uid    = `banner-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const banner = document.createElement('div');
    banner.className = 'added-requests-banner';
    banner.dataset.uid = uid;

    banner.innerHTML = `
        <div class="added-banner-inner">
            <div class="added-banner-icon"><i class="fas ${icon}"></i></div>
            <div class="added-banner-text">
                <span class="added-banner-title">${title}</span>
                ${subtitle ? `<span class="added-banner-subtitle">${subtitle}</span>` : ''}
            </div>
            <button class="added-banner-close" aria-label="Cerrar">
                <i class="fas fa-times"></i>
            </button>
        </div>`;

    stack.appendChild(banner);
    _activeBanners.push(uid);

    const removeBanner = () => {
        if (!banner.isConnected) return;
        banner.classList.add('banner-hiding');
        clearTimeout(autoTimer);
        setTimeout(() => {
            banner.remove();
            const idx = _activeBanners.indexOf(uid);
            if (idx > -1) _activeBanners.splice(idx, 1);
            if (onClose) onClose();
            _processBannerQueue();
            if (stack.children.length === 0) stack.remove();
        }, 400);
    };

    banner.querySelector('.added-banner-close').onclick = removeBanner;
    const autoTimer = setTimeout(removeBanner, BANNER_DURATION);

    requestAnimationFrame(() => banner.classList.add('banner-visible'));
}

// Limpiar todos los banners activos (usado por silenceRequest)
function _clearAllBanners() {
    const stack = document.getElementById('banner-stack-container');
    if (stack) stack.remove();
    _activeBanners.length = 0;
    _bannerQueue.length   = 0;
}// -------------------------------------------------------
// ADMIN: MODAL AVISO PERSONALIZADO
// -------------------------------------------------------
async function openAnnouncementModal() {
    document.getElementById('req-announcement-modal')?.remove();

    // El modal siempre empieza limpio — los avisos son registros históricos
    const currentTitle = '', currentSubtitle = '';

    const modal = document.createElement('div');
    modal.id = 'req-announcement-modal';
    modal.className = 'modal show';
    modal.innerHTML = `
        <div class="auth-modal-content" style="max-width: 480px; position: relative;">
            <button class="close-btn" id="close-announcement-modal">&times;</button>
            <h2 style="font-family: 'Bebas Neue', sans-serif; font-size: 1.8rem; margin-bottom: 5px; letter-spacing: 1px;">
                <i class="fas fa-bullhorn" style="color: #E50914;"></i> PUBLICAR AVISO
            </h2>
            <p style="color: #aaa; font-size: 0.85rem; margin-bottom: 22px;">
                Publica un aviso que verán todos los usuarios al entrar a Pedidos.
            </p>

            <div class="settings-group" style="margin-bottom: 16px;">
                <label style="color: #ccc; font-size: 0.85rem; margin-bottom: 6px; display: block;">Título del aviso</label>
                <input type="text" id="ann-title-input" maxlength="100"
                    value="${escapeHtml(currentTitle)}"
                    placeholder="Ej: The Office ya está en el cine"
                    style="width: 100%; background: #1a1a1a; border: 1px solid #333; color: white; padding: 11px 14px; border-radius: 8px; font-size: 0.95rem; box-sizing: border-box;">
            </div>

            <div class="settings-group" style="margin-bottom: 16px;">
                <label style="color: #ccc; font-size: 0.85rem; margin-bottom: 6px; display: block;">
                    Subtítulo <span style="color: #555; font-size: 0.78rem;">(opcional)</span>
                </label>
                <input type="text" id="ann-subtitle-input" maxlength="120"
                    value="${escapeHtml(currentSubtitle)}"
                    placeholder="Ej: Disponible en Series 🎬"
                    style="width: 100%; background: #1a1a1a; border: 1px solid #333; color: white; padding: 11px 14px; border-radius: 8px; font-size: 0.9rem; box-sizing: border-box;">
            </div>

            <div style="background: #111; border: 1px solid #222; border-radius: 8px; padding: 12px 14px; margin-bottom: 22px;">
                <p style="color: #555; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.8px; margin: 0 0 6px 0;">Vista previa del banner</p>
                <p id="ann-preview-title" style="color: #fff; font-size: 0.9rem; font-weight: 600; margin: 0 0 2px 0;"></p>
                <p id="ann-preview-subtitle" style="color: #aaa; font-size: 0.82rem; margin: 0; display: none;"></p>
            </div>

            <div style="display: flex; gap: 10px;">
                <button id="ann-confirm-btn" class="btn-primary" style="flex: 1; padding: 13px; font-size: 1rem; background: #E50914; font-weight: 700;">
                    <i class="fas fa-bullhorn"></i> Publicar
                </button>
                <button id="ann-cancel-btn" class="btn-primary" style="flex: 1; padding: 13px; font-size: 1rem; background: #333;">
                    <i class="fas fa-times"></i> Cancelar
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    document.body.classList.add('modal-open');

    const titleInput    = modal.querySelector('#ann-title-input');
    const subtitleInput = modal.querySelector('#ann-subtitle-input');
    const previewTitle  = modal.querySelector('#ann-preview-title');
    const previewSub    = modal.querySelector('#ann-preview-subtitle');

    const updatePreview = () => {
        previewTitle.textContent  = titleInput.value.trim() || 'Título del aviso';
        const sub = subtitleInput.value.trim();
        previewSub.textContent    = sub;
        previewSub.style.display  = sub ? 'block' : 'none';
    };
    titleInput.addEventListener('input', updatePreview);
    subtitleInput.addEventListener('input', updatePreview);
    updatePreview();

    const close = () => {
        modal.remove();
        if (!document.querySelector('.modal.show')) document.body.classList.remove('modal-open');
    };
    modal.querySelector('#close-announcement-modal').onclick = close;
    modal.querySelector('#ann-cancel-btn').onclick = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    // Publicar — solo guarda en el log, sin nodo "activo"
    modal.querySelector('#ann-confirm-btn').onclick = async () => {
        const text     = titleInput.value.trim();
        const subtitle = subtitleInput.value.trim() || null;
        if (!text) return;
        const btn = modal.querySelector('#ann-confirm-btn');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publicando...';
        btn.disabled  = true;

        const newRef = shared.db.ref('system_metadata/announcement_log').push();
        await newRef.set({
            text, subtitle,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            publishedBy: shared.auth.currentUser?.email || 'admin'
        });
        try {
            const counts = JSON.parse(localStorage.getItem('notifViewCounts') || '{}');
            counts['ann_' + newRef.key] = 1;
            localStorage.setItem('notifViewCounts', JSON.stringify(counts));
        } catch {}

        close();
        showToast('Aviso publicado', 'success');
        // Refrescar lista
        const activeTabNow = document.querySelector('.req-tab-btn.active');
        const isAdminNow = shared.auth.currentUser && ADMIN_EMAILS.includes(shared.auth.currentUser.email);
        await loadAndRenderRequests(activeTabNow?.dataset.status || 'all', isAdminNow);
    };
}


// -------------------------------------------------------
// BANNER AL ENTRAR: muestra el aviso más reciente del log si no fue visto
// -------------------------------------------------------
const ANN_MAX_VIEWS = 2; // veces que se muestra cada aviso por cuenta

export async function checkCustomAnnouncement() {
    // Reemplazado por checkSessionNotification()
}

// -------------------------------------------------------
// SISTEMA UNIFICADO: 1 banner por sesión de apertura del cine
// Sin importar si hay o no sesión iniciada, siempre 1 banner.
// Prioridad: pedidos agregados recientes > aviso personalizado
// -------------------------------------------------------
export async function checkSessionNotification() {
    try {
        const MAX  = ANN_MAX_VIEWS;
        const KEY  = 'notifViewCounts';
        let counts = {};
        try { counts = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}

        // — Prioridad 1: pedido agregado en últimas 48h —
        const TWO_DAYS = 172800000;
        const now = Date.now();
        const addedSnap = await shared.db.ref('requests')
            .orderByChild('status').equalTo('added').once('value');
        if (addedSnap.exists()) {
            const pending = [];
            addedSnap.forEach(c => {
                const d = c.val(), ck = 'req_' + c.key;
                if (d.addedTimestamp && (now - d.addedTimestamp) <= TWO_DAYS && (counts[ck] || 0) < MAX)
                    pending.push({ ck, title: d.notificationTitle || d.movieName, subtitle: d.notificationSubtitle || null });
            });
            if (pending.length > 0) {
                pending.forEach(p => { counts[p.ck] = (counts[p.ck] || 0) + 1; });
                localStorage.setItem(KEY, JSON.stringify(counts));
                showRequestsBanner({
                    icon: 'fa-film',
                    title:    pending.length > 1 ? '¡Nuevos pedidos agregados!' : pending[0].title,
                    subtitle: pending.length > 1
                        ? pending.length + ' pedidos ya están disponibles en el cine 🎬'
                        : (pending[0].subtitle || 'Ya disponible en el cine 🎬'),
                    onClose: null
                });
                return;
            }
        }

        // — Prioridad 2: aviso personalizado del admin —
        const annSnap = await shared.db.ref('system_metadata/announcement_log')
            .orderByChild('timestamp').limitToLast(1).once('value');
        if (!annSnap.exists()) return;
        let latest = null;
        annSnap.forEach(c => { latest = { ck: 'ann_' + c.key, ...c.val() }; });
        if (!latest?.text || (counts[latest.ck] || 0) >= MAX) return;
        counts[latest.ck] = (counts[latest.ck] || 0) + 1;
        localStorage.setItem(KEY, JSON.stringify(counts));
        showRequestsBanner({ icon: 'fa-bullhorn', title: latest.text, subtitle: latest.subtitle || null, onClose: null });

    } catch(e) { console.error('checkSessionNotification:', e); }
}

// -------------------------------------------------------
// HELPERS
// -------------------------------------------------------
function showModalFeedback(el, msg, type) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    el.style.color = type === 'error' ? '#ff4444' : '#46d369';
}

function showToast(message, type = 'success') {
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

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
