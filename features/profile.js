// ===========================================================
// MÓDULO DE PERFIL (BLINDADO CON LOGS)
// ===========================================================

import { logError } from '../utils/logger.js'; // Importamos el logger

let shared; // Dependencias compartidas
let isInitialized = false;
let isDropdownInitialized = false;

// 1. INICIALIZACIÓN
export function initProfile(dependencies) {
    if (isInitialized) return;
    shared = dependencies;
    isInitialized = true;
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

    calculateAndDisplayUserStats();
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
            <div class="content-header"><h1 class="main-title">Ajustes</h1></div>
            <div class="settings-form-wrapper">
                <div class="settings-group settings-group--avatar">
                    <label>Foto de perfil</label>
                    <div class="avatar-upload-row">
                        <div class="avatar-preview-wrap" id="avatar-preview-wrap">
                            ${user.photoURL
                                ? `<img src="${user.photoURL}" class="avatar-preview-img" id="avatar-preview-img" alt="foto de perfil">`
                                : `<div class="avatar-preview-placeholder" id="avatar-preview-img"><i class="fas fa-user-circle"></i></div>`
                            }
                            <label class="avatar-upload-btn" for="avatar-file-input" title="Cambiar foto">
                                <i class="fas fa-camera"></i>
                            </label>
                            <input type="file" id="avatar-file-input" accept="image/*" style="display:none">
                        </div>
                        <div class="avatar-upload-info">
                            <p class="avatar-upload-hint">JPG, PNG o GIF · Máx. 5MB</p>
                            <button id="avatar-upload-btn" class="btn-primary" disabled>Guardar foto</button>
                            <p id="avatar-feedback" class="feedback-message" style="display:none"></p>
                        </div>
                    </div>
                </div>
                <div class="settings-group">
                    <label>Nombre de usuario</label>
                    <div class="input-with-button">
                        <input type="text" id="settings-username-input" value="${user.displayName || ''}">
                        <button id="update-username-btn" class="btn-primary">Guardar</button>
                    </div>
                </div>
                <div class="settings-group">
                    <label>Contraseña</label>
                    <div class="input-with-button">
                        <input type="password" id="settings-password-input" placeholder="Nueva contraseña">
                        <button id="update-password-btn" class="btn-primary">Actualizar</button>
                    </div>
                </div>
                <p id="settings-feedback" class="feedback-message"></p>
            </div>
         `;
    }

    // --- LÓGICA FOTO DE PERFIL ---
    _setupAvatarUpload(user);

    // --- LÓGICA USUARIO NORMAL ---
    const usernameInput = document.getElementById('settings-username-input');
    const passwordInput = document.getElementById('settings-password-input');
    const updateNameBtn = document.getElementById('update-username-btn');
    const updatePassBtn = document.getElementById('update-password-btn');
    const feedbackMsg = document.getElementById('settings-feedback');

    const showFeedback = (msg, type = 'success') => {
        if (feedbackMsg) {
            feedbackMsg.textContent = msg;
            feedbackMsg.style.color = type === 'success' ? '#46d369' : '#ff4444';
            feedbackMsg.style.display = 'block';
            setTimeout(() => { feedbackMsg.style.display = 'none'; }, 3000);
        }
    };

    if (updateNameBtn) {
        updateNameBtn.onclick = async () => {
            const newName = usernameInput.value.trim();
            if (!newName) return showFeedback('El nombre no puede estar vacío', 'error');
            updateNameBtn.textContent = 'Guardando...';
            try {
                await user.updateProfile({ displayName: newName });
                await shared.db.ref('users/' + user.uid).update({ username: newName });
                showFeedback('Nombre actualizado');
                const greeting = document.getElementById('user-greeting');
                if (greeting) greeting.textContent = `Hola, ${newName}`;
            } catch (e) { showFeedback('Error al actualizar', 'error'); }
            updateNameBtn.textContent = 'Guardar';
        };
    }

    if (updatePassBtn) {
        updatePassBtn.onclick = async () => {
            const newPass = passwordInput.value;
            if (newPass.length < 6) return showFeedback('Mínimo 6 caracteres', 'error');
            updatePassBtn.textContent = 'Actualizando...';
            try {
                await user.updatePassword(newPass);
                showFeedback('Contraseña actualizada. Vuelve a entrar.');
                passwordInput.value = '';
            } catch (e) { 
                if (e.code === 'auth/requires-recent-login') showFeedback('Por seguridad, cierra sesión y vuelve a entrar.', 'error');
                else showFeedback('Error al actualizar', 'error');
            }
            updatePassBtn.textContent = 'Actualizar';
        };
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
            adminZone.className = 'settings-group';
            adminZone.style.cssText = 'margin-top: 40px; padding: 25px; border: 1px solid #444; border-radius: 10px; background: #151515;';

            adminZone.innerHTML = `
                <div>
                    <h3 style="color: #ffd700; display: flex; align-items: center; gap: 10px; margin-top: 0;">
                        <i class="fas fa-crown"></i> Panel de Administrador
                    </h3>
                    <p style="color: #ccc; font-size: 0.9rem; margin-bottom: 15px;">
                        Herramientas de mantenimiento del sistema.
                    </p>
                    
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button id="admin-force-update-btn" class="btn-primary" style="background: #ffd700; color: #000; flex: 1; min-width: 160px; font-weight: 800;">
                            <i class="fas fa-sync-alt spin-hover"></i> ACTUALIZAR TODO
                        </button>
                        <button id="admin-local-refresh-btn2" class="btn-primary" title="Actualiza los datos localmente sin recargar la página" style="background: #1a1a2e; color: #4a9eff; border: 2px solid #4a9eff; flex: 1; min-width: 160px; font-weight: 800;">
                            <i class="fas fa-bolt"></i> ACTUALIZAR LOCAL
                        </button>
                    </div>
                </div>

                <div style="margin-top: 30px; border-top: 1px dashed #333; padding-top: 25px;">
                    <h3 style="color: #E50914; display: flex; align-items: center; gap: 10px; margin-top: 0; font-family: 'Bebas Neue'; letter-spacing: 1px;">
                        <i class="fas fa-bullhorn"></i> HISTORIAL DE AVISOS
                    </h3>
                    <div id="announcement-log-list" style="display: flex; flex-direction: column; gap: 10px;">
                        <p style="color: #555; font-size: 0.85rem;">Cargando...</p>
                    </div>
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

            // 4. HISTORIAL DE AVISOS
            loadAnnouncementLog();
        }
    }
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

async function calculateAndDisplayUserStats() {
    try {
        const user = shared.auth.currentUser;
        if (!user) return;

        const historySnapshot = await shared.db.ref(`users/${user.uid}/history`).once('value');

        // Elementos del DOM (Búsqueda directa para evitar pantalla negra)
        const statMoviesEl = document.getElementById('stat-movies-watched');
        const statSeriesEl = document.getElementById('stat-series-watched');
        const statTotalEl = document.getElementById('stat-total-items');
        const genreStatsContainer = document.getElementById('genre-stats-container');

        if (!historySnapshot.exists()) {
            if(statMoviesEl) statMoviesEl.textContent = '0';
            if(statSeriesEl) statSeriesEl.textContent = '0';
            if(statTotalEl) statTotalEl.textContent = '0';
            if(genreStatsContainer) genreStatsContainer.innerHTML = '<p>Sin actividad reciente.</p>';
            return;
        }

        const history = historySnapshot.val();
        let moviesWatched = 0;
        const seriesWatched = new Set();
        let movieGenreCounts = {};
        let seriesGenreCounts = {};
        let totalItemsInHistory = 0;

        for (const item of Object.values(history)) {
            totalItemsInHistory++;
            if (item.type === 'movie') moviesWatched++;
            else if (item.type === 'series') seriesWatched.add(item.contentId);

            // Buscar en todas las fuentes: movies, series, sagas, ucm
            let content = shared.appState.content.movies?.[item.contentId]
                || shared.appState.content.series?.[item.contentId]
                || (shared.appState.content.ucm?.[item.contentId]);
            if (!content && shared.appState.content.sagas) {
                for (const sagaItems of Object.values(shared.appState.content.sagas)) {
                    if (sagaItems?.[item.contentId]) { content = sagaItems[item.contentId]; break; }
                }
            }
            
            if (content && content.genres) {
                const targetMap = item.type === 'series' ? seriesGenreCounts : movieGenreCounts;
                content.genres.split(';').forEach(g => {
                    const genre = g.trim();
                    if (genre) targetMap[genre] = (targetMap[genre] || 0) + 1;
                });
            }
        }

        if(statMoviesEl) statMoviesEl.textContent = moviesWatched;
        if(statSeriesEl) statSeriesEl.textContent = seriesWatched.size;
        if(statTotalEl) statTotalEl.textContent = totalItemsInHistory;

        if (genreStatsContainer) {
            genreStatsContainer.innerHTML = '';

            const renderGenreBlock = (title, genreCounts) => {
                const sorted = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
                if (sorted.length === 0) return;
                const maxCount = sorted[0][1];
                const block = document.createElement('div');
                block.className = 'genre-block';
                block.innerHTML = `<p class="genre-block-title">${title}</p>` +
                    sorted.map(([genre, count]) => {
                        const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                        return `
                            <div class="genre-stat-bar">
                                <span class="genre-label">${genre}</span>
                                <div class="genre-progress">
                                    <div class="genre-progress-fill" style="width:${pct}%"></div>
                                </div>
                                <span class="genre-count">${count}</span>
                            </div>`;
                    }).join('');
                genreStatsContainer.appendChild(block);
            };

            renderGenreBlock('Géneros — Películas', movieGenreCounts);
            renderGenreBlock('Géneros — Series', seriesGenreCounts);
        }
    } catch (error) {
        logError(error, 'Profile: Stats Calculation');
    }
}
