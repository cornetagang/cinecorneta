// ==================== =======================================
// SISTEMA DE LAZY LOADING DE IMÁGENES
// ===========================================================

export class LazyImageLoader {
    constructor() {
        this.observer = null;
        this.options = { root: null, rootMargin: '50px', threshold: 0.01 };
        this.init();
    }

    init() {
        if (!('IntersectionObserver' in window)) {
            this.loadAllImages();
            return;
        }
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.loadImage(entry.target);
                    this.observer.unobserve(entry.target);
                }
            });
        }, this.options);
        this.observeImages();
    }

    observeImages() {
        const lazyImages = document.querySelectorAll('img[data-src]');
        lazyImages.forEach(img => this.observer.observe(img));
    }

    loadImage(img) {
        const src = img.dataset.src;
        if (!src) return;
        img.classList.add('lazy-loading');
        const tempImg = new Image();
        tempImg.onload = () => {
            img.src = src;
            img.classList.remove('lazy-loading');
            img.classList.add('lazy-loaded');
            delete img.dataset.src;
        };
        tempImg.onerror = () => {
            img.classList.remove('lazy-loading');
            img.classList.add('lazy-error');
            console.warn('Error al cargar:', src);
        };
        tempImg.src = src;
    }

    loadAllImages() {
        const lazyImages = document.querySelectorAll('img[data-src]');
        lazyImages.forEach(img => {
            if (img.dataset.src) {
                img.src = img.dataset.src;
                delete img.dataset.src;
            }
        });
    }

    observe(img) {
        if (this.observer) this.observer.observe(img);
    }
}

export function injectLazyLoadingStyles() {
    if (!document.getElementById('lazy-loading-styles')) {
        const lazyStyles = document.createElement('style');
        lazyStyles.id = 'lazy-loading-styles';
        lazyStyles.textContent = `
            img[data-src] { filter: blur(5px); transition: filter 0.3s ease; }
            img.lazy-loading { background: linear-gradient(135deg, #333 0%, #222 100%); animation: pulse 1.5s ease-in-out infinite; }
            @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
            img.lazy-loaded { filter: blur(0); animation: fadeIn 0.3s ease-in; }
            @keyframes fadeIn { from { opacity: 0.7; } to { opacity: 1; } }
            img.lazy-error { filter: grayscale(1); opacity: 0.5; }
        `;
        document.head.appendChild(lazyStyles);
    }
}

export default LazyImageLoader;
