// ===========================================================
// MÓDULO DE PERFIL (BLINDADO CON LOGS)
// ===========================================================

import { logError } from '../utils/logger.js'; // Importamos el logger

let shared; // Dependencias compartidas
let isInitialized = false;
let isDropdownInitialized = false;

// ── ESTILOS DEL PERFIL ────────────────────────────────────────────
// Los estilos viven en main.css — esta función fue eliminada.

// 1. INICIALIZACIÓN
export function initProfile(dependencies) {
    if (isInitialized) return;
    shared = dependencies;
    isInitialized = true;

    // ── Clases de layout desktop (reemplazan media queries) ────────
    function _applyLayoutClass() {
        const container = document.getElementById('profile-container');
        if (!container) return;
        const w = window.innerWidth;
        container.classList.toggle('prf-desktop', w >= 1024);
        container.classList.toggle('prf-wide',    w >= 1440);
    }
    _applyLayoutClass();
    window.addEventListener('resize', _applyLayoutClass);
}

// 2. LÓGICA DEL HEADER (MENÚ DESPLEGABLE ACTUALIZADO)
export function setupUserDropdown() {
    if (isDropdownInitialized) return;

    const btn = document.getElementById('user-greeting');
    const dropdown = document.getElementById('user-menu-dropdown');

    if (btn && dropdown) {
        // Abrir/Cerrar menú
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('show');
        });

        // Detectar clics dentro del menú
        dropdown.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (!link) return;

            // Si es cerrar sesión
            if (link.dataset.action === 'logout') {
                e.preventDefault();
                shared.auth.signOut();
            }
            
            // Cerrar menú después de cualquier clic
            dropdown.classList.remove('show');
        });

        // Cerrar si se hace clic fuera
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
                dropdown.classList.remove('show');
            }
        });

        isDropdownInitialized = true;
    }
}

// 3. RENDERIZAR PERFIL (CORREGIDO)
export function renderProfile() {
    const user = shared.auth.currentUser;
    if (!user) return;

    const usernameEl = document.getElementById('profile-username');
    const emailEl = document.getElementById('profile-email');

    if (usernameEl) usernameEl.textContent = user.displayName || 'Usuario';
    if (emailEl) emailEl.textContent = user.email;

    // Mostrar foto de perfil si existe
    _updateAvatarUI(user.photoURL);

    // ── Idea 6: Miembro desde ──────────────────────────────
    const joinedEl = document.getElementById('prf-joined-date');
    if (joinedEl && user.metadata?.creationTime) {
        const d = new Date(user.metadata.creationTime);
        joinedEl.textContent = d.toLocaleDateString('es-CL', {
            day: 'numeric', month: 'long', year: 'numeric'
        });
    }

    calculateAndDisplayUserStats();

    // ── Idea 3: Nota promedio del usuario ─────────────────
    _loadUserReviewAvg(user);

    // ── Últimas 5 vistas por categoría (posters) ──────────
    _loadRecentHistory(user);

    // ── Últimas 5 reseñas por categoría ───────────────────
    _loadRecentReviews(user);

    // ── Editar perfil inline ───────────────────────────────
    _renderInlineSettings(user);
}

// =======================================================
// RENDERIZAR AJUSTES (CON SOLUCIÓN DE RETRASO Y DESCARGA)
// =======================================================
export function renderSettings() {
    const settingsContainer = document.getElementById('settings-container');
    
    if (!shared.auth.currentUser) {
        if (settingsContainer) {
            settingsContainer.innerHTML = '<div class="spinner" style="margin: 50px auto;"></div>';
        }
        setTimeout(() => renderSettings(), 500);
        return;
    }

    const user = shared.auth.currentUser;

    if (settingsContainer) {
        settingsContainer.innerHTML = `
            <div class="catalog-header" style="padding-bottom: 0;">
                <p class="catalog-eyebrow">ADMINISTRACIÓN</p>
                <h1 class="catalog-title">Panel de Admin</h1>
            </div>
            <div class="settings-form-wrapper"></div>
        `;
    }

    // --- ZONA ADMIN ---
    const ADMIN_EMAILS = ['baquezadat@gmail.com']; 

    if (ADMIN_EMAILS.includes(user.email)) {
        const wrapper = settingsContainer.querySelector('.settings-form-wrapper');
        
        const existingZone = document.getElementById('admin-zone');
        if (existingZone) existingZone.remove();

        if (wrapper) {
            const adminZone = document.createElement('div');
            adminZone.id = 'admin-zone';
            adminZone.className = 'admin-zone-desktop';

            adminZone.innerHTML = `
                <!-- Header -->
                <div class="admin-header-desktop">
                    <span class="admin-crown-desktop"><i class="fas fa-crown"></i></span>
                    <h2 class="admin-title-desktop">Panel de Administrador</h2>
                    <p class="admin-header-subtitle-desktop">Herramientas de mantenimiento del sistema</p>
                </div>

                <!-- Action cards -->
                <div class="admin-actions-grid-desktop">
                    <div class="admin-card-desktop admin-card--gold">
                        <div class="admin-card-icon-desktop"><i class="fas fa-sync-alt"></i></div>
                        <div>
                            <h3 class="admin-card-title-desktop">Actualizar Todo</h3>
                            <p class="admin-card-desc-desktop">Fuerza recarga global del sistema para todos los usuarios.</p>
                        </div>
                        <button id="admin-force-update-btn" class="admin-btn-desktop admin-btn--gold">
                            <i class="fas fa-sync-alt"></i> ACTUALIZAR TODO
                        </button>
                    </div>

                    <div class="admin-card-desktop admin-card--blue">
                        <div class="admin-card-icon-desktop"><i class="fas fa-bolt"></i></div>
                        <div>
                            <h3 class="admin-card-title-desktop">Actualizar Local</h3>
                            <p class="admin-card-desc-desktop">Limpia el caché y recarga solo en tu dispositivo.</p>
                        </div>
                        <button id="admin-local-refresh-btn2" class="admin-btn-desktop admin-btn--blue" title="Actualiza los datos localmente sin recargar la página">
                            <i class="fas fa-bolt"></i> ACTUALIZAR LOCAL
                        </button>
                    </div>
                </div>

                <!-- Migrar IDs -->
                <div class="admin-section-desktop admin-section--migrate">
                    <div class="admin-section-header-desktop">
                        <i class="fas fa-exchange-alt admin-section-icon-desktop"></i>
                        <h3 class="admin-section-title-desktop">Migrar IDs de Reseñas</h3>
                    </div>
                    <p class="admin-section-desc-desktop">
                        Sincroniza los <code>contentId</code> de Firebase con los IDs actuales del sheet.
                        Solo modifica ese campo — el texto, estrellas y todo lo demás queda intacto.
                    </p>
                    <button id="admin-migrate-ids-btn" class="admin-btn-desktop admin-btn--migrate">
                        <i class="fas fa-search"></i> ANALIZAR Y MIGRAR
                    </button>
                    <div id="admin-migrate-log" class="admin-migrate-log-desktop"></div>
                </div>


            `;

            wrapper.appendChild(adminZone);

            // 3. 🔥 LÓGICA BOTÓN MAESTRO ORIGINAL 🔥
            document.getElementById('admin-force-update-btn').onclick = async function() {
                const btn = this;
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando...';

                try {
                    await shared.db.ref('system_metadata/last_update').set(Date.now());

                    if (window.adminForceUpdate) {
                        window.adminForceUpdate();
                    } else {
                        localStorage.clear();
                        location.reload();
                    }
                } catch (error) {
                    console.error(error);
                    btn.disabled = false;
                    btn.innerHTML = 'Error. Reintentar.';
                }
            };

            // 4. 🔄 BOTÓN ACTUALIZAR LOCAL (limpia caché y recarga solo en tu pc)
            document.getElementById('admin-local-refresh-btn2').onclick = function() {
                if (window.safeClearStorage) window.safeClearStorage();
                else localStorage.clear();
                location.reload();
            };

            // 5. MIGRAR IDs DE RESEÑAS
            document.getElementById('admin-migrate-ids-btn').onclick = async function() {
                const btn = this;
                const log = document.getElementById('admin-migrate-log');

                const BASE_URL = 'https://script.google.com/macros/s/AKfycbxRGzMHroA3o3e5AC5K5bK3AKzJttM5JBKybMlEjhnWPhJxQKo7zttJNBHseu2nElz_/exec';

                const logLine = (msg, color = '#ccc') => {
                    const line = document.createElement('div');
                    line.style.color = color;
                    line.innerHTML = msg;
                    log.appendChild(line);
                    log.scrollTop = log.scrollHeight;
                };

                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando sheet...';
                log.innerHTML = '';
                log.style.display = 'block';

                try {
                    // 1. Cargar IDs frescos del sheet
                    const res  = await fetch(`${BASE_URL}?data=allMovies`);
                    const data = await res.json();

                    let sheetItems = [];
                    if (Array.isArray(data)) {
                        sheetItems = data.map(i => ({ id: i.id, title: i.title }));
                    } else if (typeof data === 'object') {
                        sheetItems = Object.entries(data).map(([id, i]) => ({
                            id,
                            title: typeof i === 'object' ? i.title : i
                        }));
                    }

                    logLine(`📄 ${sheetItems.length} ítems cargados del sheet.`, '#46d369');

                    // 2. Función de resolución usando id y title del sheet
                    const norm = s => (s || '').trim().toLowerCase();
                    const LEGACY_ID_MAP = {
                        'reze'   : 'Chainsaw Man – The Movie: Reze Arc',
                        'jinroh' : 'Jin-Roh: The Wolf Brigade',
                        '30aniv' : 'Evangelion Special 30th Anniversary',
                    };
                    function resolveId(oldId, contentTitle) {
                        if (LEGACY_ID_MAP[oldId]) return LEGACY_ID_MAP[oldId];
                        const nOldId = norm(oldId);
                        const nTitle = norm(contentTitle);
                        for (const item of sheetItems) {
                            const nItemId    = norm(item.id);
                            const nItemTitle = norm(item.title);
                            if (
                                nItemId    === nOldId  ||
                                nItemId    === nTitle  ||
                                nItemTitle === nOldId  ||
                                nItemTitle === nTitle
                            ) return item.id;
                        }
                        return null;
                    }

                    // 3. Leer reseñas de Firebase
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Leyendo Firebase...';
                    const snapshot = await shared.db.ref('reviews').once('value');
                    if (!snapshot.exists()) {
                        logLine('⚠️ No hay reseñas en Firebase.', '#ffd700');
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-search"></i> ANALIZAR Y MIGRAR';
                        return;
                    }

                    // 4. Analizar
                    const toUpdate = [], notFound = [], alreadyOk = [];
                    snapshot.forEach(child => {
                        const rev   = child.val();
                        const oldId = rev.contentId    || '';
                        const title = rev.contentTitle || '';
                        const existsInSheet = sheetItems.some(i => i.id === oldId);
                        if (existsInSheet) { alreadyOk.push({ key: child.key, oldId, title }); return; }
                        const newId = resolveId(oldId, title);
                        if (newId && newId !== oldId) toUpdate.push({ key: child.key, oldId, newId, title });
                        else notFound.push({ key: child.key, oldId, title });
                    });

                    // 5. Mostrar resumen
                    logLine(`─────────────────────────────`);
                    logLine(`✅ Ya correctos: <b>${alreadyOk.length}</b>`, '#46d369');
                    logLine(`🔄 Para actualizar: <b>${toUpdate.length}</b>`, '#a78bfa');
                    logLine(`❓ Sin coincidencia: <b>${notFound.length}</b>`, '#ffd700');
                    logLine(`─────────────────────────────`);

                    if (toUpdate.length > 0) {
                        logLine('🔄 Cambios detectados:', '#a78bfa');
                        toUpdate.forEach(({ title, oldId, newId }) => {
                            logLine(`&nbsp;&nbsp;"${title}" &nbsp;<span style="color:#555">${oldId}</span> ➜ <span style="color:#46d369">${newId}</span>`);
                        });
                    }
                    if (notFound.length > 0) {
                        logLine('❓ Sin coincidencia (se dejan igual):', '#ffd700');
                        notFound.forEach(({ title, oldId }) => {
                            logLine(`&nbsp;&nbsp;"${title}" <span style="color:#555">(${oldId})</span>`);
                        });
                    }

                    if (toUpdate.length === 0) {
                        logLine('🎉 Nada que migrar. Todo está correcto.', '#46d369');
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-check"></i> TODO CORRECTO';
                        return;
                    }

                    // 6. Confirmar con modal interno (sin window.confirm)
                    await new Promise((resolve) => {
                        // Crear modal inline
                        const overlay = document.createElement('div');
                        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;';

                        const box = document.createElement('div');
                        box.style.cssText = 'background:#1a1a1a;border:1px solid #a78bfa;border-radius:12px;padding:28px 32px;max-width:420px;width:90%;text-align:center;';
                        box.innerHTML = `
                            <i class="fas fa-exchange-alt" style="font-size:2rem;color:#a78bfa;margin-bottom:14px;display:block;"></i>
                            <h3 style="color:#fff;margin:0 0 10px;">Confirmar migración</h3>
                            <p style="color:#ccc;font-size:0.9rem;margin:0 0 20px;">
                                Se actualizará el <code>contentId</code> de <b style="color:#a78bfa">${toUpdate.length} reseña(s)</b>.<br>
                                El texto, estrellas y todo lo demás queda intacto.
                            </p>
                            <div style="display:flex;gap:12px;justify-content:center;">
                                <button id="mig-cancel" style="padding:10px 24px;border-radius:8px;border:1px solid #555;background:transparent;color:#ccc;cursor:pointer;font-size:0.9rem;">Cancelar</button>
                                <button id="mig-confirm" style="padding:10px 24px;border-radius:8px;border:none;background:#a78bfa;color:#000;cursor:pointer;font-weight:800;font-size:0.9rem;">Actualizar</button>
                            </div>
                        `;
                        overlay.appendChild(box);
                        document.body.appendChild(overlay);

                        document.getElementById('mig-confirm').onclick = () => { overlay.remove(); resolve(true); };
                        document.getElementById('mig-cancel').onclick  = () => { overlay.remove(); resolve(false); };
                    }).then(async (confirmed) => {
                        if (!confirmed) {
                            logLine('❌ Cancelado.', '#ff4444');
                            btn.disabled = false;
                            btn.innerHTML = '<i class="fas fa-search"></i> ANALIZAR Y MIGRAR';
                            return;
                        }

                        // 7. Ejecutar
                        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando...';
                        logLine('─────────────────────────────');
                        let okCount = 0, errCount = 0;
                        for (const { key, newId, title } of toUpdate) {
                            try {
                                await shared.db.ref(`reviews/${key}`).update({ contentId: newId });
                                logLine(`✅ "${title}" ➜ ${newId}`, '#46d369');
                                okCount++;
                            } catch (err) {
                                logLine(`❌ Error en "${title}": ${err.message}`, '#ff4444');
                                errCount++;
                            }
                        }

                        logLine('─────────────────────────────');
                        logLine(`🎉 Listo. Actualizadas: ${okCount}${errCount > 0 ? ` | Errores: ${errCount}` : ''}`, '#46d369');
                        btn.innerHTML = '<i class="fas fa-check"></i> MIGRACIÓN COMPLETA';
                    });

                } catch (err) {
                    logLine(`❌ Error: ${err.message}`, '#ff4444');
                    console.error('[MigrateIds]', err);
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-search"></i> ANALIZAR Y MIGRAR';
                }
            };


        }
    }
}

// ===========================================================
// EDICIÓN DE PERFIL INLINE — En el hero, in-place
// ===========================================================
function _renderInlineSettings(user) {
    // La sección de abajo ya no se usa — queda vacía
    const section = document.getElementById('profile-edit-section');
    if (section) section.innerHTML = '';

    // ── Gear button: abrir/cerrar dropdown ────────────────
    const gearBtn  = document.getElementById('prf-settings-gear-btn');
    const dropdown = document.getElementById('prf-settings-dropdown');

    if (gearBtn && dropdown) {
        const freshGear = gearBtn.cloneNode(true);
        gearBtn.parentNode.replaceChild(freshGear, gearBtn);

        freshGear.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.toggle('open');
            freshGear.classList.toggle('open', isOpen);
        });

        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && !freshGear.contains(e.target)) {
                dropdown.classList.remove('open');
                freshGear.classList.remove('open');
            }
        });
    }

    // ── Opción "Editar perfil" ─────────────────────────────
    const toggleBtn = document.getElementById('prf-edit-toggle-btn');
    if (!toggleBtn) return;

    const fresh = toggleBtn.cloneNode(true);
    toggleBtn.parentNode.replaceChild(fresh, toggleBtn);

    fresh.addEventListener('click', () => {
        if (dropdown) dropdown.classList.remove('open');
        const gear = document.getElementById('prf-settings-gear-btn');
        if (gear) gear.classList.remove('open');
        _enterEditMode(user, fresh);
    });

    // ── Opción "Cambiar Contraseña" ───────────────────────
    const changePwBtn = document.getElementById('prf-change-password-btn');
    if (changePwBtn) {
        const freshPw = changePwBtn.cloneNode(true);
        changePwBtn.parentNode.replaceChild(freshPw, changePwBtn);
        freshPw.addEventListener('click', () => {
            if (dropdown) dropdown.classList.remove('open');
            const gear = document.getElementById('prf-settings-gear-btn');
            if (gear) gear.classList.remove('open');
            _openChangePasswordModal(user);
        });
    }
}

// ═══════════════════════════════════════════════════════
// MODAL — CAMBIAR CONTRASEÑA
// ═══════════════════════════════════════════════════════
function _openChangePasswordModal(user) {
    const modal = document.getElementById('change-password-modal');
    if (!modal) return;

    // Reset campos
    ['cpw-current','cpw-new','cpw-confirm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const feedback   = document.getElementById('cpw-feedback');
    const strengthW  = document.getElementById('cpw-strength-wrap');
    if (feedback)  { feedback.style.display = 'none'; feedback.className = 'cpw-feedback'; }
    if (strengthW)   strengthW.style.display = 'none';

    modal.classList.add('show');
    document.body.classList.add('modal-open');
    setTimeout(() => document.getElementById('cpw-current')?.focus(), 100);

    // ── Cerrar ────────────────────────────────────────────
    const closeModal = () => {
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    };
    document.getElementById('cpw-close-btn').onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    // ── Toggle visibilidad contraseñas ────────────────────
    modal.querySelectorAll('.cpw-eye-btn').forEach(btn => {
        btn.onclick = () => {
            const input = document.getElementById(btn.dataset.target);
            if (!input) return;
            const isText = input.type === 'text';
            input.type = isText ? 'password' : 'text';
            btn.querySelector('i').className = isText ? 'fas fa-eye' : 'fas fa-eye-slash';
        };
    });

    // ── Indicador de fortaleza ────────────────────────────
    const newInput = document.getElementById('cpw-new');
    newInput?.addEventListener('input', () => {
        const val = newInput.value;
        if (!val) { if (strengthW) strengthW.style.display = 'none'; return; }
        if (strengthW) strengthW.style.display = 'flex';
        const score = _passwordStrength(val);
        const fill  = document.getElementById('cpw-strength-fill');
        const label = document.getElementById('cpw-strength-label');
        const levels = [
            { pct: 25, color: '#ff4444', text: 'Débil'     },
            { pct: 50, color: '#ff9800', text: 'Regular'   },
            { pct: 75, color: '#4a9eff', text: 'Buena'     },
            { pct:100, color: '#46d369', text: 'Excelente' },
        ];
        const l = levels[score - 1] || levels[0];
        if (fill)  { fill.style.width = l.pct + '%'; fill.style.background = l.color; }
        if (label) { label.textContent = l.text; label.style.color = l.color; }
    });

    // ── Submit ────────────────────────────────────────────
    const submitBtn = document.getElementById('cpw-submit-btn');
    submitBtn.onclick = async () => {
        const current = document.getElementById('cpw-current')?.value || '';
        const newPass = document.getElementById('cpw-new')?.value     || '';
        const confirm = document.getElementById('cpw-confirm')?.value  || '';

        const showFb = (msg, type) => {
            if (!feedback) return;
            feedback.textContent = msg;
            feedback.className = `cpw-feedback ${type}`;
            feedback.style.display = 'block';
        };

        if (!current)              return showFb('Ingresa tu contraseña actual.', 'error');
        if (newPass.length < 6)    return showFb('La nueva contraseña debe tener al menos 6 caracteres.', 'error');
        if (newPass !== confirm)   return showFb('Las contraseñas no coinciden.', 'error');
        if (current === newPass)   return showFb('La nueva contraseña debe ser diferente a la actual.', 'error');

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cambiando...';
        if (feedback) feedback.style.display = 'none';

        try {
            // Reautenticar con la contraseña actual (Firebase 8 compat global)
            const credential = firebase.auth.EmailAuthProvider.credential(user.email, current);
            await user.reauthenticateWithCredential(credential);
            await user.updatePassword(newPass);

            showFb('¡Contraseña actualizada correctamente!', 'success');
            submitBtn.innerHTML = '<i class="fas fa-check"></i> ¡Listo!';
            setTimeout(closeModal, 1800);

        } catch (e) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check"></i> Cambiar Contraseña';
            if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
                showFb('La contraseña actual es incorrecta.', 'error');
            } else if (e.code === 'auth/too-many-requests') {
                showFb('Demasiados intentos. Espera unos minutos.', 'error');
            } else {
                showFb('Error al cambiar la contraseña. Intenta de nuevo.', 'error');
            }
        }
    };
}

function _passwordStrength(pass) {
    let score = 1;
    if (pass.length >= 8) score++;
    if (/[A-Z]/.test(pass) && /[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass) && pass.length >= 10) score++;
    return Math.min(score, 4);
}

// ── Entra en modo edición ──────────────────────────────────
function _enterEditMode(user, toggleBtn) {
    if (document.querySelector('.prf-identity--editing')) return;

    const hero     = document.querySelector('.prf-identity');
    const heroText = document.querySelector('.prf-identity-info');
    const avatarRing = document.querySelector('.prf-avatar-ring');
    const usernameEl = document.getElementById('profile-username');
    if (!hero || !usernameEl) return;

    hero.classList.add('prf-hero--editing');
    hero.classList.add('prf-identity--editing');

    // ── 1. Avatar: overlay cámara ──────────────────────────
    const camLabel = document.createElement('label');
    camLabel.className = 'prf-inline-cam';
    camLabel.title     = 'Cambiar foto';
    camLabel.innerHTML = '<i class="fas fa-camera"></i>';
    const fileInput = document.createElement('input');
    fileInput.type    = 'file';
    fileInput.id      = 'prf-inline-file';
    fileInput.accept  = 'image/*';
    fileInput.style.display = 'none';
    avatarRing.appendChild(camLabel);
    avatarRing.appendChild(fileInput);

    // Anular pointer-events:none del CSS y conectar click directo al input
    camLabel.style.pointerEvents = 'auto';
    camLabel.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });

    let pendingFile = null;
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) return;
        pendingFile = file;
        const reader = new FileReader();
        reader.onload = e => {
            const avatarEl = document.getElementById('prf-avatar-el');
            if (avatarEl) {
                avatarEl.style.padding = '0';
                avatarEl.style.overflow = 'hidden';
                avatarEl.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
            }
        };
        reader.readAsDataURL(file);
    });

    // ── 2. Nombre: h1 → input editable ────────────────────
    const nameInput = document.createElement('input');
    nameInput.type      = 'text';
    nameInput.id        = 'prf-inline-name';
    nameInput.className = 'prf-inline-name-input';
    nameInput.value     = usernameEl.textContent || user.displayName || '';
    usernameEl.replaceWith(nameInput);
    setTimeout(() => nameInput.focus(), 50);

    // ── 3. Feedback inline ─────────────────────────────────
    const fbEl = document.createElement('p');
    fbEl.className = 'prf-inline-feedback';
    fbEl.style.display = 'none';
    heroText.appendChild(fbEl);

    const showFb = (msg, ok = true) => {
        fbEl.textContent = msg;
        fbEl.style.color = ok ? '#46d369' : '#ff6b6b';
        fbEl.style.display = 'block';
        if (ok) setTimeout(() => { fbEl.style.display = 'none'; }, 3000);
    };

    // ── 5. Botones: Guardar + Cancelar (junto a la tuerca) ───
    const settingsWrap = document.getElementById('prf-settings-wrap');
    const gearBtn      = document.getElementById('prf-settings-gear-btn');
    const dropdownEl   = document.getElementById('prf-settings-dropdown');
    if (dropdownEl) dropdownEl.classList.remove('open');
    if (gearBtn)    gearBtn.style.display = 'none';
    if (settingsWrap) settingsWrap.appendChild(toggleBtn);

    toggleBtn.innerHTML = '<i class="fas fa-check"></i><span>Guardar</span>';
    toggleBtn.classList.add('prf-edit-toggle-btn--saving');

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'prf-inline-cancel-btn';
    cancelBtn.innerHTML = '<i class="fas fa-times"></i>';
    cancelBtn.title = 'Cancelar';
    if (settingsWrap) settingsWrap.appendChild(cancelBtn);
    else toggleBtn.parentNode.insertBefore(cancelBtn, toggleBtn.nextSibling);

    // ── Cancel ─────────────────────────────────────────────
    cancelBtn.onclick = () => {
        _exitEditMode(user, toggleBtn, cancelBtn, nameInput, null, fbEl, camLabel, fileInput);
    };

    // ── Guardar ────────────────────────────────────────────
    toggleBtn.onclick = async () => {
        const newName = nameInput.value.trim();
        if (!newName) { showFb('El nombre no puede estar vacío.', false); return; }

        toggleBtn.disabled = true;
        toggleBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Guardando...</span>';
        fbEl.style.display = 'none';

        try {
            // Nombre — siempre pasamos photoURL para que Firebase no lo borre
            if (newName !== user.displayName) {
                await user.updateProfile({
                    displayName: newName,
                    photoURL: user.photoURL || null
                });
                await shared.db.ref('users/' + user.uid).update({ username: newName });
                const greeting = document.getElementById('user-greeting');
                if (greeting) greeting.textContent = `Hola, ${newName}`;
            }

            // Foto
            if (pendingFile) {
                const formData = new FormData();
                formData.append('file', pendingFile);
                formData.append('upload_preset', 'cinecorneta');
                formData.append('folder', 'profile_photos');
                const res  = await fetch('https://api.cloudinary.com/v1_1/djhgmmdjx/image/upload', { method: 'POST', body: formData });
                const data = await res.json();
                if (data.secure_url) {
                    await user.updateProfile({ photoURL: data.secure_url });
                    await shared.db.ref(`users/${user.uid}`).update({ photoURL: data.secure_url });
                    // Actualizar avatares en reseñas
                    const reviewsSnap = await shared.db.ref('reviews').orderByChild('userId').equalTo(user.uid).once('value');
                    if (reviewsSnap.exists()) {
                        const updates = {};
                        reviewsSnap.forEach(child => { updates[`reviews/${child.key}/userPhotoURL`] = data.secure_url; });
                        await shared.db.ref().update(updates);
                    }
                    if (typeof window.syncAllAvatars === 'function') {
                        const initials = newName.slice(0, 2).toUpperCase();
                        window.syncAllAvatars(data.secure_url, initials, newName);
                    }
                }
            }

            _exitEditMode(user, toggleBtn, cancelBtn, nameInput, null, fbEl, camLabel, fileInput, newName);

        } catch (e) {
            console.error('[EditMode save]', e);
            if (e.code === 'auth/requires-recent-login') {
                showFb('Por seguridad, cierra sesión y vuelve a entrar.', false);
            } else {
                showFb('Error al guardar. Intenta de nuevo.', false);
            }
            toggleBtn.disabled = false;
            toggleBtn.innerHTML = '<i class="fas fa-check"></i><span>Guardar</span>';
        }
    };
}

// ── Sale del modo edición ──────────────────────────────────
function _exitEditMode(user, toggleBtn, cancelBtn, nameInput, passWrap, fbEl, camLabel, fileInput, finalName) {
    // Restaurar h1 del nombre
    const displayName = finalName || nameInput?.value || user.displayName || 'Usuario';
    const h1 = document.createElement('h1');
    h1.className = 'prf-name';
    h1.id = 'profile-username';
    h1.textContent = displayName;
    nameInput?.replaceWith(h1);

    // Limpiar elementos temporales
    passWrap?.remove();
    fbEl?.remove();
    camLabel?.remove();
    fileInput?.remove();

    // Restaurar botón
    toggleBtn.disabled = false;
    toggleBtn.onclick = null;
    toggleBtn.classList.remove('prf-edit-toggle-btn--saving');
    toggleBtn.innerHTML = '<i class="fas fa-pencil-alt"></i><span>Editar perfil</span>';
    cancelBtn?.remove();

    // Devolver toggleBtn al dropdown y mostrar tuerca
    const dropdownEl   = document.getElementById('prf-settings-dropdown');
    const gearBtn      = document.getElementById('prf-settings-gear-btn');
    if (dropdownEl && toggleBtn) dropdownEl.insertBefore(toggleBtn, dropdownEl.firstChild);
    if (gearBtn) gearBtn.style.display = '';

    // Quitar clase de edición
    const heroEl = document.querySelector('.prf-identity');
    heroEl?.classList.remove('prf-hero--editing');
    heroEl?.classList.remove('prf-identity--editing');

    // Re-conectar para el próximo click
    const fresh = toggleBtn.cloneNode(true);
    toggleBtn.parentNode.replaceChild(fresh, toggleBtn);
    fresh.addEventListener('click', () => {
        const dd = document.getElementById('prf-settings-dropdown');
        const gb = document.getElementById('prf-settings-gear-btn');
        if (dd) dd.classList.remove('open');
        if (gb) gb.classList.remove('open');
        _enterEditMode(user, fresh);
    });
}

// ===========================================================
// FOTO DE PERFIL — HELPERS
// ===========================================================
function _updateAvatarUI(photoURL) {
    const placeholder = document.querySelector('.profile-avatar-placeholder');
    if (!placeholder) return;

    if (photoURL) {
        placeholder.innerHTML = `<img src="${photoURL}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        placeholder.style.padding = '0';
        placeholder.style.overflow = 'hidden';
    } else {
        placeholder.innerHTML = `<i class="fas fa-user-circle"></i>`;
    }
}

function _setupAvatarUpload(user) {
    const fileInput = document.getElementById('avatar-file-input');
    const uploadBtn = document.getElementById('avatar-upload-btn');
    const feedback  = document.getElementById('avatar-feedback');
    let pendingFile = null;

    const showFb = (msg, ok = true) => {
        if (!feedback) return;
        feedback.textContent = msg;
        feedback.style.color = ok ? '#46d369' : '#ff4444';
        feedback.style.display = 'block';
        setTimeout(() => feedback.style.display = 'none', 3500);
    };

    if (!fileInput || !uploadBtn) return;

    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { showFb('La imagen no puede superar 5MB', false); return; }

        pendingFile = file;
        uploadBtn.disabled = false;

        // Preview inmediato
        const reader = new FileReader();
        reader.onload = e => {
            const wrap = document.getElementById('avatar-preview-wrap');
            if (wrap) {
                wrap.querySelector('#avatar-preview-img').outerHTML = `<img src="${e.target.result}" class="avatar-preview-img" id="avatar-preview-img" alt="preview">`;
            }
        };
        reader.readAsDataURL(file);
    });

    uploadBtn.addEventListener('click', async () => {
        if (!pendingFile) return;
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Subiendo...';

        try {
            // 1. Subir a Cloudinary
            const formData = new FormData();
            formData.append('file', pendingFile);
            formData.append('upload_preset', 'cinecorneta');
            formData.append('folder', 'profile_photos');
            const res = await fetch('https://api.cloudinary.com/v1_1/djhgmmdjx/image/upload', {
                method: 'POST', body: formData
            });
            const data = await res.json();
            if (!data.secure_url) throw new Error('Error al subir imagen');

            const photoURL = data.secure_url;

            // 2. Actualizar Firebase Auth
            await user.updateProfile({ photoURL });

            // 3. Guardar en DB para referencia futura
            await shared.db.ref(`users/${user.uid}`).update({ photoURL });

            // 4. Actualizar userPhotoURL en todas las reseñas del usuario
            const reviewsSnap = await shared.db.ref('reviews')
                .orderByChild('userId').equalTo(user.uid).once('value');
            if (reviewsSnap.exists()) {
                const updates = {};
                reviewsSnap.forEach(child => {
                    updates[`reviews/${child.key}/userPhotoURL`] = photoURL;
                });
                await shared.db.ref().update(updates);
            }

            // 4. Actualizar UI
            _updateAvatarUI(photoURL);
            // Sincronizar nav, dropdown y todos los avatares del sitio
            if (typeof window.syncAllAvatars === 'function') {
                const uName = user.displayName || user.email.split('@')[0];
                const initials = uName.slice(0, 2).toUpperCase();
                window.syncAllAvatars(photoURL, initials, uName);
            }
            showFb('¡Foto actualizada correctamente!');
            pendingFile = null;
        } catch (err) {
            console.error('[Avatar]', err);
            showFb('Error al subir la foto', false);
        } finally {
            uploadBtn.disabled = false;
            uploadBtn.textContent = 'Guardar foto';
        }
    });
}

// ── Idea 3: Nota promedio del usuario ─────────────────────
async function _loadUserReviewAvg(user) {
    try {
        const avgEl   = document.getElementById('prf-review-avg');
        const starsEl = document.getElementById('prf-review-stars');
        const countEl = document.getElementById('prf-review-count');
        // Elementos del stats strip (desktop usa la info card; mobile tiene strip propio)
        const stripAvgEl     = document.getElementById('stat-strip-avg-mobile');
        const stripReviewsEl = document.getElementById('stat-strip-reviews-mobile');

        const snap = await shared.db.ref('reviews')
            .orderByChild('userId').equalTo(user.uid).once('value');

        if (!snap.exists()) {
            if (avgEl)         avgEl.textContent         = '—';
            if (countEl)       countEl.textContent       = 'Sin reseñas aún';
            if (stripAvgEl)    stripAvgEl.textContent    = '—';
            if (stripReviewsEl) stripReviewsEl.textContent = '0';
            return;
        }

        let total = 0, count = 0;
        snap.forEach(child => {
            const r = child.val().stars ?? child.val().rating;
            if (r != null) { total += Number(r); count++; }
        });

        if (count === 0) {
            if (avgEl)         avgEl.textContent         = '—';
            if (countEl)       countEl.textContent       = 'Sin reseñas aún';
            if (stripAvgEl)    stripAvgEl.textContent    = '—';
            if (stripReviewsEl) stripReviewsEl.textContent = '0';
            return;
        }

        const avg = total / count;
        if (avgEl)         avgEl.textContent         = avg.toFixed(1);
        if (countEl)       countEl.textContent       = `${count} reseña${count !== 1 ? 's' : ''}`;
        if (stripAvgEl)    stripAvgEl.textContent    = avg.toFixed(1);
        if (stripReviewsEl) stripReviewsEl.textContent = count;

        if (starsEl) {
            const full    = Math.floor(avg);
            const hasHalf = (avg - full) >= 0.3;
            let html = '';
            for (let i = 0; i < full; i++)      html += '<i class="fas fa-star"></i>';
            if (hasHalf)                         html += '<i class="fas fa-star-half-alt"></i>';
            for (let i = full + (hasHalf ? 1 : 0); i < 5; i++) html += '<i class="far fa-star"></i>';
            starsEl.innerHTML = html;
        }

        // ── Última reseña ─────────────────────────
        // Buscamos el review con mayor timestamp; si hay empate usamos la push key
        // (Firebase las ordena cronológicamente, key mayor = más reciente).
        let last = null;
        let lastTs = -1;
        snap.forEach(child => {
            const rev = child.val();
            const ts  = Number(rev.timestamp || rev.createdAt || 0);
            const key = child.key || '';
            if (ts > lastTs || (ts === lastTs && key > (last?._key || ''))) {
                lastTs = ts;
                last   = { _key: key, ...rev };
            }
        });

        const lrWrap   = document.getElementById('prf-last-review');
        const lrPoster = document.getElementById('prf-lr-poster');
        const lrTitle  = document.getElementById('prf-lr-title');
        const lrStars  = document.getElementById('prf-lr-stars');
        const lrText   = document.getElementById('prf-lr-text');
        const lrDate   = document.getElementById('prf-lr-date');

        if (last && lrWrap) {
            if (lrPoster) {
                if (last.poster) { lrPoster.src = last.poster; lrPoster.style.display = ''; }
                else lrPoster.style.display = 'none';
            }
            if (lrTitle) lrTitle.textContent = last.contentTitle || 'Sin título';
            if (lrStars) {
                const s = parseFloat(last.stars) || 0;
                const f = Math.floor(s), h = (s - f) >= 0.3;
                let sh = '';
                for (let i = 0; i < f; i++)               sh += '<i class="fas fa-star"></i>';
                if (h)                                     sh += '<i class="fas fa-star-half-alt"></i>';
                for (let i = f + (h ? 1 : 0); i < 5; i++) sh += '<i class="far fa-star"></i>';
                lrStars.innerHTML = sh;
            }
            if (lrText)  lrText.textContent  = last.text || '';
            if (lrDate)  lrDate.textContent  = last.timestamp
                ? new Date(last.timestamp).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })
                : '';
            lrWrap.style.display = 'flex';
        }
    } catch (e) { /* silent */ }
}

// 5. HISTORIAL DE AVISOS (admin)
async function loadAnnouncementLog() {
    const container = document.getElementById('announcement-log-list');
    if (!container) return;

    try {
        const snap = await shared.db.ref('system_metadata/announcement_log')
            .orderByChild('timestamp')
            .limitToLast(20)
            .once('value');

        if (!snap.exists()) {
            container.innerHTML = '<p style="color: #555; font-size: 0.85rem;">No hay avisos publicados aún.</p>';
            return;
        }

        const items = [];
        snap.forEach(c => items.push({ id: c.key, ...c.val() }));
        items.reverse(); // más reciente primero

        container.innerHTML = '';
        items.forEach(item => {
            const date = item.timestamp
                ? new Date(item.timestamp).toLocaleString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '';

            const el = document.createElement('div');
            el.style.cssText = 'background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 4px;';
            el.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                    <span style="color: #fff; font-size: 0.88rem; font-weight: 600;">${item.text}</span>
                    <button data-id="${item.id}" class="ann-log-delete-btn" style="background: none; border: none; color: #555; cursor: pointer; font-size: 0.8rem; flex-shrink: 0; padding: 0;" title="Eliminar del log">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                ${item.subtitle ? `<span style="color: #888; font-size: 0.8rem;">${item.subtitle}</span>` : ''}
                <span style="color: #444; font-size: 0.75rem;">${date}</span>
            `;

            el.querySelector('.ann-log-delete-btn').onclick = async () => {
                await shared.db.ref(`system_metadata/announcement_log/${item.id}`).remove();
                el.remove();
                if (container.children.length === 0) {
                    container.innerHTML = '<p style="color: #555; font-size: 0.85rem;">No hay avisos publicados aún.</p>';
                }
            };

            container.appendChild(el);
        });

    } catch(e) {
        container.innerHTML = '<p style="color: #555; font-size: 0.85rem;">Error al cargar el historial.</p>';
    }
}

// 6. HELPERS
function showFeedbackMessage(message, type) {
    const feedbackElement = document.getElementById('settings-feedback');
    if (!feedbackElement) return;

    feedbackElement.textContent = message;
    feedbackElement.className = `feedback-message ${type}`;
    feedbackElement.style.display = 'block';
    
    setTimeout(() => {
        feedbackElement.style.display = 'none';
    }, 4000);
}

// ── Últimas 5 reseñas del usuario por tipo ────────────────
async function _loadRecentReviews(user) {
    try {
        const wrap      = document.getElementById('prf-recent-reviews');
        const moviesEl  = document.getElementById('prf-recent-movies');
        const seriesEl  = document.getElementById('prf-recent-series');
        if (!wrap || !moviesEl || !seriesEl) return;

        const snap = await shared.db.ref('reviews')
            .orderByChild('userId').equalTo(user.uid).once('value');

        if (!snap.exists()) return;

        // Recolectar y ordenar por timestamp desc
        const all = [];
        snap.forEach(child => all.push({ id: child.key, ...child.val() }));
        all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        const movies = all.filter(r => r.contentType === 'movie').slice(0, 5);
        const series = all.filter(r => r.contentType === 'series').slice(0, 5);

        if (movies.length === 0 && series.length === 0) return;

        // Mostrar sección
        wrap.style.display = '';

        const renderList = (container, reviews) => {
            if (reviews.length === 0) {
                container.innerHTML = `<p class="prf-recent-empty">Sin reseñas aún</p>`;
                return;
            }
            container.innerHTML = reviews.map(r => {
                const stars  = parseFloat(r.stars) || 0;
                const full   = Math.floor(stars);
                const half   = (stars - full) >= 0.3;
                let starsHtml = '';
                for (let i = 0; i < full; i++)                        starsHtml += '<i class="fas fa-star"></i>';
                if (half)                                              starsHtml += '<i class="fas fa-star-half-alt"></i>';
                for (let i = full + (half ? 1 : 0); i < 5; i++)       starsHtml += '<i class="far fa-star"></i>';

                const date = r.timestamp
                    ? new Date(r.timestamp).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })
                    : '';

                const poster = r.poster
                    ? `<img src="${r.poster}" alt="${r.contentTitle}" class="prf-rc-poster" loading="lazy">`
                    : `<div class="prf-rc-poster prf-rc-poster--empty"><i class="fas fa-film"></i></div>`;

                const text = (r.text || '').length > 120
                    ? r.text.substring(0, 120).trimEnd() + '…'
                    : (r.text || '');

                return `
                <div class="prf-rc-card">
                    ${poster}
                    <div class="prf-rc-body">
                        <p class="prf-rc-title">${r.contentTitle || 'Sin título'}</p>
                        <div class="prf-rc-stars">${starsHtml} <span class="prf-rc-score">${stars.toFixed(1)}</span></div>
                        ${text ? `<p class="prf-rc-text">${text}</p>` : ''}
                        <span class="prf-rc-date">${date}</span>
                    </div>
                </div>`;
            }).join('');
        };

        renderList(moviesEl, movies);
        renderList(seriesEl, series);

    } catch(e) { /* silent */ }
}

// ── Últimas 5 películas y series vistas (posters desde historial) ────────────
async function _loadRecentHistory(user) {
    const moviesEl = document.getElementById('prf-history-movies');
    const seriesEl = document.getElementById('prf-history-series');
    if (!moviesEl || !seriesEl) return;

    // Skeleton loader mientras carga
    const skeleton = `<div class="prf-poster-skeleton"></div>`.repeat(5);
    moviesEl.innerHTML = `<div class="prf-poster-grid-inner">${skeleton}</div>`;
    seriesEl.innerHTML = `<div class="prf-poster-grid-inner">${skeleton}</div>`;

    try {
        // 1. Intentar usar el cache global del listener de script.js
        //    (ya viene ordenado: más reciente primero)
        let history = window._cinecorneta_historyCache || null;

        // 2. Si el cache no está listo aún, hacer query directa a Firebase
        if (!history) {
            console.log('[Profile] Cache de historial no disponible, consultando Firebase...');
            const snap = await shared.db
                .ref(`users/${user.uid}/history`)
                .orderByChild('viewedAt')
                .once('value');

            history = [];
            snap.forEach(child => {
                const item = child.val();
                item.key = child.key;
                history.push(item);
            });
            history.reverse(); // más reciente primero
        } else {
            console.log('[Profile] Usando cache de historial:', history.length, 'items');
        }

        if (!history.length) {
            moviesEl.innerHTML = '<p class="prf-poster-empty"><i class="fas fa-inbox"></i><br>Sin historial aún</p>';
            seriesEl.innerHTML = '<p class="prf-poster-empty"><i class="fas fa-inbox"></i><br>Sin historial aún</p>';
            return;
        }

        // Separar por tipo — el campo guardado es "movie" o "series"
        const lastMovies = history.filter(h => h.type === 'movie').slice(0, 6);
        const lastSeries = history.filter(h => h.type === 'series').slice(0, 6);

        console.log('[Profile] Películas recientes:', lastMovies.length, '| Series recientes:', lastSeries.length);

        // Render — poster y title ya vienen en la entrada del historial
        const renderPosters = (container, items, emptyIcon) => {
            if (items.length === 0) {
                container.innerHTML = `<p class="prf-poster-empty"><i class="fas ${emptyIcon}"></i><br>Sin historial aún</p>`;
                return;
            }
            container.innerHTML = `<div class="prf-poster-grid-inner">${
                items.map(h => {
                    const poster    = h.poster || '';
                    const title     = h.title  || h.contentTitle || h.key || '';
                    const safeTitle = title.replace(/"/g, '&quot;');

                    if (poster) {
                        return `<div class="prf-poster-item" data-id="${h.key || h.contentId}" title="${safeTitle}">
                            <img src="${poster}" alt="${safeTitle}" loading="lazy">
                            <div class="prf-poster-overlay">
                                <p class="prf-poster-overlay-title">${title}</p>
                            </div>
                        </div>`;
                    } else {
                        return `<div class="prf-poster-item prf-poster-item--empty" data-id="${h.key || h.contentId}" title="${safeTitle}">
                            <div class="prf-poster-empty-inner">
                                <i class="fas fa-film"></i>
                                <p class="prf-poster-empty-title">${title}</p>
                            </div>
                        </div>`;
                    }
                }).join('')
            }</div>`;
        };

        renderPosters(moviesEl, lastMovies, 'fa-film');
        renderPosters(seriesEl, lastSeries, 'fa-tv');

    } catch(e) {
        console.error('[Profile] Error en _loadRecentHistory:', e);
        moviesEl.innerHTML = '<p class="prf-poster-empty"><i class="fas fa-exclamation-circle"></i><br>Error al cargar</p>';
        seriesEl.innerHTML = '<p class="prf-poster-empty"><i class="fas fa-exclamation-circle"></i><br>Error al cargar</p>';
    }
}

// Función pública para que script.js pueda llamarla cuando el historial se actualiza
export function renderRecentHistory() {
    const user = shared.auth.currentUser;
    if (!user) return;
    _loadRecentHistory(user);
}

async function calculateAndDisplayUserStats() {
    try {
        const user = shared.auth.currentUser;
        if (!user) return;

        const historySnapshot = await shared.db.ref(`users/${user.uid}/history`).once('value');

        // Elementos del DOM (Búsqueda directa para evitar pantalla negra)
        const statMoviesEl = document.getElementById('stat-movies-watched');
        const statSeriesEl = document.getElementById('stat-series-watched');
        const statTotalEl = document.getElementById('stat-total-items');
        // Versiones mobile del strip
        const statMoviesMobileEl = document.getElementById('stat-movies-watched-mobile');
        const statSeriesMobileEl = document.getElementById('stat-series-watched-mobile');
        // Tarjetas desktop en info-cards
        const statMoviesCardEl = document.getElementById('stat-movies-card');
        const statSeriesCardEl = document.getElementById('stat-series-card');

        if (!historySnapshot.exists()) {
            if(statMoviesEl) statMoviesEl.textContent = '0';
            if(statSeriesEl) statSeriesEl.textContent = '0';
            if(statTotalEl) statTotalEl.textContent = '0';
            if(statMoviesMobileEl) statMoviesMobileEl.textContent = '0';
            if(statSeriesMobileEl) statSeriesMobileEl.textContent = '0';
            if(statMoviesCardEl) statMoviesCardEl.textContent = '0';
            if(statSeriesCardEl) statSeriesCardEl.textContent = '0';
            return;
        }

        const history = historySnapshot.val();
        let moviesWatched = 0;
        const seriesWatched = new Set();
        let totalItemsInHistory = 0;

        for (const item of Object.values(history)) {
            totalItemsInHistory++;
            if (item.type === 'movie') moviesWatched++;
            else if (item.type === 'series') seriesWatched.add(item.contentId);
        }

        if(statMoviesEl) statMoviesEl.textContent = moviesWatched;
        if(statSeriesEl) statSeriesEl.textContent = seriesWatched.size;
        if(statTotalEl) statTotalEl.textContent = totalItemsInHistory;
        if(statMoviesMobileEl) statMoviesMobileEl.textContent = moviesWatched;
        if(statSeriesMobileEl) statSeriesMobileEl.textContent = seriesWatched.size;
        if(statMoviesCardEl) statMoviesCardEl.textContent = moviesWatched;
        if(statSeriesCardEl) statSeriesCardEl.textContent = seriesWatched.size;

        // ── Distribución películas / series ────────
        const total = moviesWatched + seriesWatched.size;
        if (total > 0) {
            const moviePct  = Math.round((moviesWatched    / total) * 100);
            const seriesPct = 100 - moviePct;
            const dMovie    = document.getElementById('prf-dist-movie');
            const dSeries   = document.getElementById('prf-dist-series');
            const dMLbl     = document.getElementById('prf-dist-movie-lbl');
            const dSLbl     = document.getElementById('prf-dist-series-lbl');
            if (dMovie)  dMovie.style.width  = `${moviePct}%`;
            if (dSeries) dSeries.style.width = `${seriesPct}%`;
            if (dMLbl)   dMLbl.textContent   = `Películas ${moviePct}%`;
            if (dSLbl)   dSLbl.textContent   = `Series ${seriesPct}%`;
        }

        // ── Géneros más vistos ────────────────────
        const genreCount = new Map();
        const movies  = shared.appState?.content?.movies  || {};
        const seriesC = shared.appState?.content?.series  || {};

        for (const item of Object.values(history)) {
            const contentData = movies[item.contentId] || seriesC[item.contentId];
            if (!contentData) continue;
            const genresRaw = contentData.genres || contentData.Generos || contentData.Géneros || contentData.generos || '';
            String(genresRaw).split(';').map(g => g.trim()).filter(Boolean).forEach(g => {
                genreCount.set(g, (genreCount.get(g) || 0) + 1);
            });
        }

        const topGenres = [...genreCount.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const genresList = document.getElementById('prf-top-genres-list');
        const genresWrap = document.getElementById('prf-top-genres');
        if (genresList && topGenres.length > 0) {
            const maxCount = topGenres[0][1];
            genresList.innerHTML = topGenres.map(([name, count]) => `
                <div class="prf-genre-row">
                    <span class="prf-genre-name">${name}</span>
                    <div class="prf-genre-track">
                        <div class="prf-genre-fill" style="width:${Math.round((count / maxCount) * 100)}%"></div>
                    </div>
                    <span class="prf-genre-count">${count}</span>
                </div>
            `).join('');
            if (genresWrap) genresWrap.style.display = 'flex';
        } else if (genresWrap) {
            genresWrap.style.display = 'none';
        }
    } catch (error) {
        logError(error, 'Profile: Stats Calculation');
    }
}
