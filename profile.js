// ===========================================================
// MÓDULO DE PERFIL (Cargado bajo demanda)
// ===========================================================

let shared; // Dependencias compartidas (appState, DOM, auth, db, etc.)
let isInitialized = false;
let isDropdownInitialized = false; // Prevención de duplicación de eventos

// ===========================================================
// 1. INICIALIZACIÓN
// ===========================================================

// Inyecta las dependencias desde el script principal
export function initProfile(dependencies) {
    if (isInitialized) return;
    shared = dependencies;
    isInitialized = true;
}

// ===========================================================
// 2. LÓGICA DEL HEADER (MENÚ DESPLEGABLE)
// ===========================================================

export function setupUserDropdown() {
    // Si ya se configuraron los listeners, no lo hacemos de nuevo
    if (isDropdownInitialized) return;

    if (shared.DOM.userGreetingBtn && shared.DOM.userMenuDropdown) {
        
        // Toggle del menú al hacer clic en el botón de saludo
        shared.DOM.userGreetingBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            shared.DOM.userMenuDropdown.classList.toggle('show');
        });

        // Manejo de clics dentro del menú (Perfil, Ajustes, Logout)
        shared.DOM.userMenuDropdown.addEventListener('click', (e) => {
            const link = e.target.closest('a[data-action]');
            if (!link) return;
            
            e.preventDefault();
            const action = link.dataset.action;

            if (action === 'logout') {
                shared.auth.signOut();
            } else if (action === 'profile' || action === 'settings') {
                // Quitar clase activa de navegación principal
                document.querySelectorAll('.main-nav a, .mobile-nav a').forEach(l => l.classList.remove('active'));
                shared.switchView(action);
            }
            
            // Cerrar menú tras la acción
            shared.DOM.userMenuDropdown.classList.remove('show');
        });

        // Cerrar menú si se hace clic fuera de él
        document.addEventListener('click', (e) => {
            if (!shared.DOM.userMenuDropdown.contains(e.target) && !shared.DOM.userGreetingBtn.contains(e.target)) {
                shared.DOM.userMenuDropdown.classList.remove('show');
            }
        });

        isDropdownInitialized = true; // Marcamos como configurado
    }
}

// ===========================================================
// 3. VISTAS PRINCIPALES (PERFIL Y AJUSTES)
// ===========================================================

// Renderiza la vista de Perfil
export function renderProfile() {
    const user = shared.auth.currentUser;
    if (!user) {
        shared.switchView('all');
        return;
    }

    // Llenar datos básicos
    shared.DOM.profileUsername.textContent = user.displayName || 'Usuario';
    shared.DOM.profileEmail.textContent = user.email;

    // Calcular estadísticas
    calculateAndDisplayUserStats(); 

    // Lógica de pestañas (Tabs)
    const tabs = document.querySelectorAll('.profile-tab');
    const tabContents = document.querySelectorAll('.profile-tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const tabName = tab.dataset.tab;
            tabContents.forEach(content => {
                content.classList.toggle('active', content.id === `${tabName}-tab`);
            });
        });
    });

    // Activar la primera pestaña por defecto
    if (tabs.length > 0) {
        tabs[0].click();
    }
}

// Renderiza la vista de Ajustes
export function renderSettings() {
    const user = shared.auth.currentUser;
    if (!user) {
        shared.switchView('all');
        return;
    }

    // Pre-llenar input de usuario
    shared.DOM.settingsUsernameInput.value = user.displayName || '';

    // Listener: Actualizar Nombre
    shared.DOM.updateUsernameBtn.onclick = async () => {
        const newUsername = shared.DOM.settingsUsernameInput.value.trim();
        if (newUsername && newUsername !== user.displayName) {
            try {
                await user.updateProfile({ displayName: newUsername });
                // Actualizar también en base de datos para persistencia
                await shared.db.ref(`users/${user.uid}/profile/displayName`).set(newUsername);
                
                showFeedbackMessage('Nombre de usuario actualizado correctamente.', 'success');
                shared.DOM.userGreetingBtn.textContent = `Hola, ${newUsername}`;
            } catch (error) {
                console.error("Error al actualizar nombre:", error);
                showFeedbackMessage(`Error: ${error.message}`, 'error');
            }
        } else {
            showFeedbackMessage('Por favor, ingresa un nombre válido y diferente.', 'error');
        }
    };

    // Listener: Actualizar Contraseña
    shared.DOM.updatePasswordBtn.onclick = async () => {
        const newPassword = shared.DOM.settingsPasswordInput.value;
        if (newPassword.length >= 6) {
            try {
                await user.updatePassword(newPassword);
                showFeedbackMessage('Contraseña actualizada correctamente.', 'success');
                shared.DOM.settingsPasswordInput.value = '';
            } catch (error) {
                console.error("Error al actualizar contraseña:", error);
                // Nota: Firebase pide re-autenticación si la sesión es vieja
                showFeedbackMessage(`Error: ${error.message}`, 'error');
            }
        } else {
            showFeedbackMessage('La contraseña debe tener al menos 6 caracteres.', 'error');
        }
    };
}

// ===========================================================
// 4. FUNCIONES AUXILIARES (PRIVADAS)
// ===========================================================

function showFeedbackMessage(message, type) {
    const feedbackElement = document.getElementById('settings-feedback');
    if (!feedbackElement) return;

    feedbackElement.textContent = message;
    feedbackElement.className = `feedback-message ${type}`;
    feedbackElement.style.display = 'block';
    
    setTimeout(() => {
        feedbackElement.style.display = 'none';
        feedbackElement.textContent = '';
        feedbackElement.className = 'feedback-message';
    }, 5000);
}

async function calculateAndDisplayUserStats() {
    const user = shared.auth.currentUser;
    if (!user) return;

    // Obtener historial desde Firebase
    const historySnapshot = await shared.db.ref(`users/${user.uid}/history`).once('value');

    if (!historySnapshot.exists()) {
        const statsContainer = document.querySelector('.stats-container');
        if (statsContainer) statsContainer.innerHTML = `<p class="empty-message">Aún no tienes actividad para mostrar estadísticas.</p>`;
        return;
    }

    const history = historySnapshot.val();
    let moviesWatched = 0;
    const seriesWatched = new Set();
    let genreCounts = {};
    let totalItemsInHistory = 0;

    // Procesar historial
    for (const item of Object.values(history)) {
        totalItemsInHistory++;
        
        if (item.type === 'movie') {
            moviesWatched++;
        } else if (item.type === 'series') {
            seriesWatched.add(item.contentId);
        }

        // Calcular géneros
        const content = shared.appState.content.movies[item.contentId] || shared.appState.content.series[item.contentId];
        if (content && content.genres) {
            content.genres.split(';').forEach(genreStr => {
                const genre = genreStr.trim();
                if (genre) {
                    genreCounts[genre] = (genreCounts[genre] || 0) + 1;
                }
            });
        }
    }

    // Actualizar DOM de estadísticas
    const statMoviesEl = document.getElementById('stat-movies-watched');
    const statSeriesEl = document.getElementById('stat-series-watched');
    const statTotalEl = document.getElementById('stat-total-items');

    if (statMoviesEl) statMoviesEl.textContent = moviesWatched;
    if (statSeriesEl) statSeriesEl.textContent = seriesWatched.size;
    if (statTotalEl) statTotalEl.textContent = totalItemsInHistory;

    // Generar barras de géneros
    const genreStatsContainer = document.getElementById('genre-stats-container');
    if (genreStatsContainer) {
        genreStatsContainer.innerHTML = '';
        
        const sortedGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const maxCount = sortedGenres.length > 0 ? sortedGenres[0][1] : 0;

        sortedGenres.forEach(([genre, count]) => {
            const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;
            const barHtml = `
                <div class="genre-stat-bar">
                    <span class="genre-label">${genre}</span>
                    <div class="genre-progress">
                        <div class="genre-progress-fill" style="width: ${percentage}%;"></div>
                    </div>
                    <span class="genre-count">${count}</span>
                </div>`;
            genreStatsContainer.insertAdjacentHTML('beforeend', barHtml);
        });
    }
}