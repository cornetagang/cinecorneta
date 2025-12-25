// ===========================================================
// MÓDULO DE PERFIL (BLINDADO CON LOGS)
// ===========================================================

import { logError } from './logger.js'; // Importamos el logger

let shared; // Dependencias compartidas
let isInitialized = false;
let isDropdownInitialized = false;

// 1. INICIALIZACIÓN
export function initProfile(dependencies) {
    if (isInitialized) return;
    shared = dependencies;
    isInitialized = true;
}

// 2. LÓGICA DEL HEADER (MENÚ DESPLEGABLE)
export function setupUserDropdown() {
    if (isDropdownInitialized) return;

    // Buscamos los elementos frescos del DOM para evitar referencias nulas
    const btn = document.getElementById('user-greeting');
    const dropdown = document.getElementById('user-menu-dropdown');

    if (btn && dropdown) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('show');
        });

        dropdown.addEventListener('click', (e) => {
            const link = e.target.closest('a[data-action]');
            if (!link) return;
            e.preventDefault();
            const action = link.dataset.action;

            if (action === 'logout') {
                shared.auth.signOut();
            } else if (action === 'profile' || action === 'settings') {
                document.querySelectorAll('.main-nav a, .mobile-nav a').forEach(l => l.classList.remove('active'));
                shared.switchView(action);
            }
            dropdown.classList.remove('show');
        });

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
    try {
        const user = shared.auth.currentUser;
        if (!user) {
            shared.switchView('all');
            return;
        }

        // Buscar elementos directamente
        const usernameEl = document.getElementById('profile-username');
        const emailEl = document.getElementById('profile-email');

        if (usernameEl) usernameEl.textContent = user.displayName || 'Usuario';
        if (emailEl) emailEl.textContent = user.email;

        calculateAndDisplayUserStats();

        // ----- FIX: manejo correcto de pestañas SIN cloneNode -----
        const tabs = document.querySelectorAll('.profile-tab');
        const tabContents = document.querySelectorAll('.profile-tab-content');

        tabs.forEach(tab => {
            tab.onclick = () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const tabName = tab.dataset.tab;

                tabContents.forEach(content => {
                    content.classList.toggle('active', content.id === `${tabName}-tab`);
                });
            };
        });

        // Activar la primera pestaña si no hay ninguna activa
        const firstTab = document.querySelector('.profile-tab');
        if (firstTab && !document.querySelector('.profile-tab.active')) firstTab.click();

    } catch (error) {
        logError(error, 'Profile: Render Profile');
        shared.ErrorHandler.show('unknown', 'Error al cargar el perfil.');
    }
}

// 4. RENDERIZAR AJUSTES (CORREGIDO)
export function renderSettings() {
    try {
        const user = shared.auth.currentUser;
        if (!user) {
            shared.switchView('all');
            return;
        }

        // Elementos existentes
        const userInput = document.getElementById('settings-username-input');
        const updateNameBtn = document.getElementById('update-username-btn');
        const passInput = document.getElementById('settings-password-input');
        const updatePassBtn = document.getElementById('update-password-btn');
        
        // Contenedor principal para inyectar la zona admin
        const settingsWrapper = document.querySelector('.settings-form-wrapper');

        if (userInput) userInput.value = user.displayName || '';

        // ===========================================================
        // 🔒 ZONA ADMIN (NUEVO)
        // ===========================================================
        // Poner aquí TU correo de administrador exacto
        const ADMIN_EMAILS = ['baquezadat@gmail.com']; 
        
        // Eliminamos si ya existe para no duplicar al re-renderizar
        const existingAdminZone = document.getElementById('admin-zone');
        if (existingAdminZone) existingAdminZone.remove();

        if (ADMIN_EMAILS.includes(user.email) && settingsWrapper) {
            const adminZone = document.createElement('div');
            adminZone.id = 'admin-zone';
            adminZone.className = 'settings-group danger-zone'; // Usamos estilos existentes
            adminZone.style.borderColor = '#ffd700'; // Dorado para destacar
            adminZone.style.backgroundColor = 'rgba(255, 215, 0, 0.05)';

            adminZone.innerHTML = `
                <h3 style="color: #ffd700; display: flex; align-items: center; gap: 10px;">
                    <i class="fas fa-crown"></i> Panel de Administrador
                </h3>
                <p>Este botón borrará la memoria caché y forzará una descarga fresca de datos desde Google Sheets.</p>
                <button id="admin-force-update-btn" class="btn-primary" style="background: #ffd700; color: #000; width: 100%;">
                    <i class="fas fa-sync-alt spin-hover"></i> ACTUALIZAR TODO AHORA
                </button>
            `;

            settingsWrapper.appendChild(adminZone);

            // Lógica del Botón Maestro
            document.getElementById('admin-force-update-btn').onclick = async function() {
                const btn = this;
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando...';

                try {
                    // 1. Opcional: Avisar a Firebase que hubo update (útil para futuro)
                    await shared.db.ref('system_metadata/last_update').set(Date.now());

                    // 2. Llamar a la función global de limpieza (definida en script.js)
                    if (window.adminForceUpdate) {
                        window.adminForceUpdate();
                    } else {
                        // Fallback por si la función no está expuesta
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
        // ===========================================================
        // FIN ZONA ADMIN
        // ===========================================================

        // Actualizar nombre
        if (updateNameBtn) {
            updateNameBtn.onclick = async () => {
                const newUsername = userInput.value.trim();

                if (!newUsername) {
                    showFeedbackMessage('El nombre no puede estar vacío.', 'error');
                    return;
                }

                if (newUsername === user.displayName) {
                    showFeedbackMessage('El nombre es igual al actual.', 'error');
                    return;
                }

                try {
                    await user.updateProfile({ displayName: newUsername });
                    await shared.db.ref(`users/${user.uid}/profile/displayName`).set(newUsername);

                    showFeedbackMessage('Nombre actualizado correctamente.', 'success');

                    const greetingBtn = document.getElementById('user-greeting');
                    if (greetingBtn) greetingBtn.textContent = `Hola, ${newUsername}`;

                } catch (error) {
                    logError(error, 'Profile: Update Name');
                    showFeedbackMessage(`Error: ${error.message}`, 'error');
                }
            };
        }

        // Actualizar contraseña
        if (updatePassBtn) {
            updatePassBtn.onclick = async () => {
                const newPassword = passInput.value;

                if (newPassword.length < 6) {
                    showFeedbackMessage('Mínimo 6 caracteres.', 'error');
                    return;
                }

                try {
                    await user.updatePassword(newPassword);
                    showFeedbackMessage('Contraseña actualizada correctamente.', 'success');
                    passInput.value = '';
                } catch (error) {
                    logError(error, 'Profile: Update Password');
                    showFeedbackMessage(`Error: ${error.message}`, 'error');
                }
            };
        }

    } catch (error) {
        logError(error, 'Profile: Render Settings');
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
