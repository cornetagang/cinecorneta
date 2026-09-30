// ===========================================================
// BARRA DE PROGRESO DE LA DESCARGA INICIAL
// ===========================================================
// Se muestra dentro del #preloader cuando NO hay caché y hay que bajar
// toda la base de datos. El avance es real:
//   - Cada descarga terminada suma su parte de la barra.
//   - Las descargas en curso suman según los bytes recibidos, siempre que
//     se conozca su tamaño de una visita anterior (se guarda en localStorage).
//   - El contador de MB avanza con cada trozo que llega, así se ve que la
//     página sigue viva aunque la barra tarde en moverse.
// El porcentaje nunca retrocede.

const SIZES_KEY = "cc_dl_sizes";
const SHOW_DELAY_MS = 400;   // en conexiones rápidas ni siquiera aparece
const SLOW_HINT_MS = 12000;  // aviso si tarda más de lo normal

function readSizes() {
  try {
    return JSON.parse(localStorage.getItem(SIZES_KEY)) || {};
  } catch {
    return {};
  }
}

function writeSizes(sizes) {
  try {
    localStorage.setItem(SIZES_KEY, JSON.stringify(sizes));
  } catch {
    /* localStorage lleno o bloqueado: no es crítico */
  }
}

export function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export class LoadProgress {
  /**
   * @param {HTMLElement|null} host   Elemento donde se dibuja (el #preloader).
   * @param {Object} phases           Reparto de la barra por fase. Ej: { catalog: 0.6, sagas: 0.4 }
   */
  constructor(host, phases) {
    this.host = host;
    this.phases = {};
    for (const [name, share] of Object.entries(phases)) {
      this.phases[name] = { share, started: false, total: 0, done: 0, label: "", partial: {} };
    }
    this.loaded = {};        // key -> bytes recibidos
    this.sizes = readSizes(); // tamaños aprendidos en visitas anteriores
    this.newSizes = {};
    this.percent = 0;
    this.currentPhase = null;
    this._timers = [];
    this._build();
  }

  // ── Fases ────────────────────────────────────────────────
  /** Inicia una fase con `total` descargas. total = 0 la da por completada. */
  phase(name, total, label) {
    const p = this.phases[name];
    if (!p) return;
    p.started = true;
    p.total = total;
    p.label = label;
    this.currentPhase = name;
    this._render();
  }

  /**
   * Ejecuta una descarga y la contabiliza.
   * fn recibe un callback onBytes(bytesRecibidos) que puede llamar mientras descarga.
   */
  async track(phaseName, key, fn) {
    const p = this.phases[phaseName];
    const expected = this.sizes[key] || 0;
    try {
      const result = await fn((loaded) => {
        this.loaded[key] = loaded;
        if (expected) p.partial[key] = Math.min(0.95, loaded / expected);
        this._render();
      });
      p.done++;
      delete p.partial[key];
      if (this.loaded[key] && !key.startsWith("saga:")) this.newSizes[key] = this.loaded[key];
      this._render();
      return result;
    } catch (error) {
      delete p.partial[key];
      throw error;
    }
  }

  // ── Fin ──────────────────────────────────────────────────
  /** Descarga completa: la barra llega al 100% y se guardan los tamaños para la próxima vez. */
  finish() {
    this._clearTimers();
    this.percent = 100;
    if (Object.keys(this.newSizes).length) writeSizes({ ...this.sizes, ...this.newSizes });
    if (!this.el) return;
    this._show();
    this.titleEl.textContent = "Preparando la interfaz…";
    this._render(true);
  }

  /** Cancelar (por ejemplo, si hubo un error): limpia timers y quita la barra. */
  destroy() {
    this._clearTimers();
    this.el?.remove();
    this.el = null;
  }

  // ── Internos ─────────────────────────────────────────────
  _build() {
    if (!this.host) return;
    const el = document.createElement("div");
    el.className = "load-progress";
    el.setAttribute("role", "progressbar");
    el.setAttribute("aria-label", "Descargando contenido");
    el.setAttribute("aria-valuemin", "0");
    el.setAttribute("aria-valuemax", "100");
    el.setAttribute("aria-valuenow", "0");

    this.titleEl = document.createElement("p");
    this.titleEl.className = "load-progress-title";
    this.titleEl.textContent = "Descargando el catálogo…";

    const track = document.createElement("div");
    track.className = "load-progress-track";
    this.fillEl = document.createElement("div");
    this.fillEl.className = "load-progress-fill";
    track.appendChild(this.fillEl);

    const meta = document.createElement("div");
    meta.className = "load-progress-meta";
    this.pctEl = document.createElement("span");
    this.pctEl.textContent = "0%";
    this.detailEl = document.createElement("span");
    meta.append(this.pctEl, this.detailEl);

    this.hintEl = document.createElement("p");
    this.hintEl.className = "load-progress-hint";

    el.append(this.titleEl, track, meta, this.hintEl);
    this.host.appendChild(el);
    this.el = el;

    this._timers.push(setTimeout(() => this._show(), SHOW_DELAY_MS));
    this._timers.push(
      setTimeout(() => {
        if (!this.el) return;
        this.hintEl.textContent =
          "Está tardando más de lo normal, pero sigue descargando. Solo pasa la primera vez.";
        this.hintEl.classList.add("is-visible");
      }, SLOW_HINT_MS),
    );
  }

  _show() {
    this.el?.classList.add("is-visible");
  }

  _clearTimers() {
    this._timers.forEach(clearTimeout);
    this._timers = [];
  }

  _compute() {
    let pct = 0;
    for (const p of Object.values(this.phases)) {
      if (!p.started) continue;
      const partial = Object.values(p.partial).reduce((a, b) => a + b, 0);
      const fraction = p.total === 0 ? 1 : Math.min(1, (p.done + partial) / p.total);
      pct += p.share * fraction * 100;
    }
    return Math.min(100, pct);
  }

  _render(force = false) {
    if (!this.el) return;
    if (!force) this.percent = Math.max(this.percent, this._compute()); // nunca retrocede
    const shown = Math.floor(this.percent);

    // Mientras no haya nada terminado ni tamaños conocidos no hay base real para un
    // porcentaje: en vez de una barra vacía que parece congelada, se muestra una barra
    // "en curso" y el contador de KB/MB, que sí avanza con cada trozo recibido.
    const indeterminate = !force && shown === 0;
    this.el.classList.toggle("is-indeterminate", indeterminate);

    this.fillEl.style.width = `${this.percent}%`;
    this.pctEl.textContent = indeterminate ? "" : `${shown}%`;
    this.el.setAttribute("aria-valuenow", String(shown));

    const p = this.currentPhase ? this.phases[this.currentPhase] : null;
    if (p && !force) {
      this.titleEl.textContent = `${p.label}…`;
    }

    const totalBytes = Object.values(this.loaded).reduce((a, b) => a + b, 0);
    const parts = [];
    if (p && p.total > 0) parts.push(`${Math.min(p.done, p.total)} de ${p.total}`);
    if (totalBytes > 0) parts.push(formatBytes(totalBytes));
    this.detailEl.textContent = parts.join(" · ");
  }
}
