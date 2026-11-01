// ===========================================================
// SISTEMA DE LAZY LOADING DE IMÁGENES
// ===========================================================

export class LazyImageLoader {
    constructor() {
        this.observer = null;
        // Margen amplio: las imágenes se piden antes de llegar a la pantalla.
        this.options = { root: null, rootMargin: '700px 300px', threshold: 0.01 };
        // Carruseles con scroll horizontal: un observador por carrusel, porque
        // con root = null el propio carrusel recorta lo que queda fuera de él
        // y el margen no tendría efecto.
        this.scrollObservers = new Map();
        this.init();
    }

    init() {
        if (!('IntersectionObserver' in window)) {
            this.loadAllImages();
            return;
        }
        this.observer = this.createObserver(this.options);
        this.observeImages();
    }

    createObserver(options) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.loadImage(entry.target);
                    observer.unobserve(entry.target);
                }
            });
        }, options);
        return observer;
    }

    // Carrusel horizontal más cercano (ancestro con overflow-x: auto/scroll), o null.
    findHorizontalScroller(img) {
        let el = img.parentElement;
        while (el && el !== document.body) {
            const ox = getComputedStyle(el).overflowX;
            if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth) return el;
            el = el.parentElement;
        }
        return null;
    }

    observeWithin(img) {
        const scroller = this.findHorizontalScroller(img);
        if (!scroller) { this.observer.observe(img); return; }
        let obs = this.scrollObservers.get(scroller);
        if (!obs) {
            obs = this.createObserver({ root: scroller, rootMargin: '0px 800px', threshold: 0.01 });
            this.scrollObservers.set(scroller, obs);
        }
        // Se observa también con el observador general, por si el carrusel
        // está fuera de pantalla verticalmente: gana el que llegue primero.
        obs.observe(img);
        this.observer.observe(img);
    }

    observeImages() {
        const lazyImages = document.querySelectorAll('img[data-src]');
        lazyImages.forEach(img => this.observer.observe(img));
    }

    loadImage(img) {
        const src = img.dataset.src;
        if (!src || img.classList.contains('lazy-loading')) return;
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
        if (this.observer) {
            // La tarjeta puede no estar aún en el DOM: se decide el observador un frame después.
            requestAnimationFrame(() => {
                if (!img.dataset.src) return; // ya cargada
                if (img.isConnected) this.observeWithin(img);
                else this.observer.observe(img);
            });
        } else {
            // Sin soporte de IntersectionObserver: cargar de inmediato
            this.loadImage(img);
        }
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