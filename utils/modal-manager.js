// ===========================================================
// MÓDULO CENTRALIZADO DE GESTIÓN DE MODALES
// ===========================================================

export const ModalManager = {
    active: null,
    stack: [], // Para modales anidados
    
    /**
     * Abre un modal y cierra cualquier otro modal abierto
     * @param {HTMLElement} modalElement - Elemento del modal a abrir
     * @param {Object} options - Opciones adicionales
     */
    open(modalElement, options = {}) {
        if (!modalElement) {
            console.warn('[ModalManager] Elemento modal no encontrado');
            return;
        }

        // Cerrar modal actual si existe
        if (this.active && options.nested !== true) {
            this.close(this.active);
        }

        // Agregar a stack si es anidado
        if (options.nested && this.active) {
            this.stack.push(this.active);
        }

        // Abrir nuevo modal
        document.body.classList.add('modal-open');
        modalElement.classList.add('show');
        this.active = modalElement;

        // Configurar botón de cierre si existe
        const closeBtn = modalElement.querySelector('.close-btn');
        if (closeBtn && !closeBtn.dataset.listenerAdded) {
            closeBtn.addEventListener('click', () => this.close(modalElement));
            closeBtn.dataset.listenerAdded = 'true';
        }

        // Callback de apertura
        if (options.onOpen && typeof options.onOpen === 'function') {
            options.onOpen(modalElement);
        }

        // Cerrar con ESC
        if (options.closeOnEsc !== false) {
            this._addEscListener(modalElement);
        }

        // Cerrar con clic fuera
        if (options.closeOnBackdrop) {
            this._addBackdropListener(modalElement);
        }
    },

    /**
     * Cierra un modal específico o el activo
     * @param {HTMLElement} modalElement - Modal a cerrar (opcional)
     */
    close(modalElement = null) {
        const targetModal = modalElement || this.active;
        
        if (!targetModal) return;

        targetModal.classList.remove('show');
        
        // Limpiar clases especiales
        targetModal.classList.remove('season-grid-view', 'player-layout-view');

        // Si hay modales en el stack, restaurar el anterior
        if (this.stack.length > 0) {
            this.active = this.stack.pop();
        } else {
            this.active = null;
            // Solo remover modal-open si no hay más modales
            if (!document.querySelector('.modal.show')) {
                document.body.classList.remove('modal-open');
            }
        }

        // Limpiar contenido si es necesario
        if (targetModal.querySelector('iframe')) {
            targetModal.querySelector('iframe').src = '';
        }
    },

    /**
     * Cierra todos los modales abiertos
     */
    closeAll() {
        const allModals = document.querySelectorAll('.modal.show');
        allModals.forEach(modal => {
            modal.classList.remove('show');
            if (modal.querySelector('iframe')) {
                modal.querySelector('iframe').src = '';
            }
        });
        
        this.active = null;
        this.stack = [];
        document.body.classList.remove('modal-open');
    },

    /**
     * Verifica si hay algún modal abierto
     */
    hasOpenModal() {
        return this.active !== null || document.querySelector('.modal.show') !== null;
    },

    /**
     * Obtiene el modal actualmente activo
     */
    getActive() {
        return this.active;
    },

    /**
     * Agrega listener para cerrar con ESC
     */
    _addEscListener(modalElement) {
        const escHandler = (e) => {
            if (e.key === 'Escape' && this.active === modalElement) {
                this.close(modalElement);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    },

    /**
     * Agrega listener para cerrar clickeando fuera
     */
    _addBackdropListener(modalElement) {
        const backdropHandler = (e) => {
            if (e.target === modalElement) {
                this.close(modalElement);
                modalElement.removeEventListener('click', backdropHandler);
            }
        };
        modalElement.addEventListener('click', backdropHandler);
    }
};

// Función global para compatibilidad con código existente
window.closeAllModals = () => ModalManager.closeAll();

export default ModalManager;
