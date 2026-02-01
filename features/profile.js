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
    if (!user) return; // Salida inmediata si es invitado

    const usernameEl = document.getElementById('profile-username');
    const emailEl = document.getElementById('profile-email');

    // Solo actualizar si los elementos existen en el DOM actual
    if (usernameEl) usernameEl.textContent = user.displayName || 'Usuario';
    if (emailEl) emailEl.textContent = user.email;

    calculateAndDisplayUserStats();
}

// =======================================================
// RENDERIZAR AJUSTES (CON SOLUCIÓN DE RETRASO Y DESCARGA)
// =======================================================
export function renderSettings() {
    const settingsContainer = document.getElementById('settings-container');
    
    // A. SOLUCIÓN AL "A VECES NO CARGA":
    if (!shared.auth.currentUser) {
        if (settingsContainer) {
            settingsContainer.innerHTML = '<div class="spinner" style="margin: 50px auto;"></div>';
        }
        setTimeout(() => renderSettings(), 500);
        return;
    }

    const user = shared.auth.currentUser;

    // B. RESTAURAR FORMULARIO
    if (settingsContainer) {
         settingsContainer.innerHTML = `
            <div class="content-header"><h1 class="main-title">Ajustes</h1></div>
            <div class="settings-form-wrapper">
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

    // --- C. LÓGICA USUARIO NORMAL ---
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

    // --- D. ZONA ADMIN (SIN DESCARGA DE DB) ---
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
                <div style="margin-bottom: 30px; border-bottom: 1px dashed #444; padding-bottom: 25px;">
                    <h3 style="color: #d42279; margin-top: 0; font-family: 'Bebas Neue'; letter-spacing: 1px;">
                        <i class="fas fa-microphone"></i> GESTIÓN FESTIVAL
                    </h3>
                    <div style="margin-bottom: 15px;">
                        <label style="color: #aaa; font-size: 0.9rem; display:block; margin-bottom: 5px;">Link Señal (.m3u8)</label>
                        <input type="text" id="admin-live-url" placeholder="https://..." style="background:#222; border:1px solid #444; color:white; width:100%; padding:10px; border-radius:5px;">
                    </div>
                    <div style="margin-bottom: 15px;">
                        <label style="color: #aaa; font-size: 0.9rem; display:block; margin-bottom: 5px;">Fondo (Imagen URL)</label>
                        <input type="text" id="admin-bg-url" placeholder="https://..." style="background:#222; border:1px solid #444; color:white; width:100%; padding:10px; border-radius:5px;">
                    </div>
                    <button id="save-festival-data" class="btn-primary" style="width: 100%; background: #d42279;">GUARDAR FESTIVAL</button>
                </div>

                <div>
                    <h3 style="color: #ffd700; display: flex; align-items: center; gap: 10px; margin-top: 0;">
                        <i class="fas fa-crown"></i> Panel de Administrador
                    </h3>
                    <p style="color: #ccc; font-size: 0.9rem; margin-bottom: 15px;">
                        Herramientas de mantenimiento del sistema.
                    </p>
                    
                    <button id="admin-force-update-btn" class="btn-primary" style="background: #ffd700; color: #000; width: 100%; font-weight: 800;">
                        <i class="fas fa-sync-alt spin-hover"></i> ACTUALIZAR TODO AHORA
                    </button>
                </div>
            `;

            wrapper.appendChild(adminZone);

            // 1. Cargar datos del Festival
            shared.db.ref('system_metadata').once('value', (s) => {
                const d = s.val() || {};
                if (d.live_festival_url) document.getElementById('admin-live-url').value = d.live_festival_url;
                if (d.live_background_url) document.getElementById('admin-bg-url').value = d.live_background_url;
            });

            // 2. Guardar datos del Festival
            document.getElementById('save-festival-data').onclick = async () => {
                const btn = document.getElementById('save-festival-data');
                const originalText = btn.textContent;
                btn.textContent = "Guardando...";
                try {
                    await shared.db.ref('system_metadata').update({
                        live_festival_url: document.getElementById('admin-live-url').value.trim(),
                        live_background_url: document.getElementById('admin-bg-url').value.trim()
                    });
                    btn.textContent = "¡GUARDADO!";
                    btn.style.background = "#28a745";
                    setTimeout(() => { 
                        btn.textContent = originalText; 
                        btn.style.background = "#d42279";
                    }, 2000);
                } catch (e) { btn.textContent = "ERROR"; }
            };

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
        }
    }
}

// 5. HELPERS
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
        let genreCounts = {};
        let totalItemsInHistory = 0;

        for (const item of Object.values(history)) {
            totalItemsInHistory++;
            if (item.type === 'movie') moviesWatched++;
            else if (item.type === 'series') seriesWatched.add(item.contentId);

            // Seguridad: Verificar que content existe antes de leer genres
            const content = shared.appState.content.movies[item.contentId] || shared.appState.content.series[item.contentId] || (shared.appState.content.ucm ? shared.appState.content.ucm[item.contentId] : null);
            
            if (content && content.genres) {
                content.genres.split(';').forEach(g => {
                    const genre = g.trim();
                    if (genre) genreCounts[genre] = (genreCounts[genre] || 0) + 1;
                });
            }
        }

        if(statMoviesEl) statMoviesEl.textContent = moviesWatched;
        if(statSeriesEl) statSeriesEl.textContent = seriesWatched.size;
        if(statTotalEl) statTotalEl.textContent = totalItemsInHistory;

        if (genreStatsContainer) {
            genreStatsContainer.innerHTML = '';
            const sortedGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
            const maxCount = sortedGenres.length > 0 ? sortedGenres[0][1] : 0;

            sortedGenres.forEach(([genre, count]) => {
                const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;
                genreStatsContainer.insertAdjacentHTML('beforeend', `
                    <div class="genre-stat-bar">
                        <span class="genre-label">${genre}</span>
                        <div class="genre-progress">
                            <div class="genre-progress-fill" style="width: ${percentage}%;"></div>
                        </div>
                        <span class="genre-count">${count}</span>
                    </div>`);
            });
        }
    } catch (error) {
        logError(error, 'Profile: Stats Calculation');
    }
}
