// ── Logo SVG: ajuste automático de viewBox para recortar espacios vacíos ──────
const _svgTrimCache = new Map();

async function _getTrimmedSvgUrl(url) {
  if (!url || !url.toLowerCase().endsWith(".svg")) return url;
  if (_svgTrimCache.has(url)) return _svgTrimCache.get(url);

  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const svgText = await res.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg) return url;

    // Usamos el viewBox ORIGINAL del logo (o su width/height si no tiene)
    // como sistema de coordenadas de referencia. Forzar un viewBox fijo
    // (ej. 800x310) para todos los logos cortaba los que tenían un lienzo
    // de diseño más grande o con otra proporción (ej. "Karate Kid",
    // "Cómo entrenar a tu dragón"), porque el contenido quedaba fuera
    // del área capturada.
    let ovx = 0, ovy = 0, ovw = 800, ovh = 310; // fallback si no hay info
    const existingViewBox = svg.getAttribute("viewBox");
    if (existingViewBox) {
      const parts = existingViewBox.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
        [ovx, ovy, ovw, ovh] = parts;
      }
    } else {
      const wAttr = parseFloat(svg.getAttribute("width"));
      const hAttr = parseFloat(svg.getAttribute("height"));
      if (wAttr > 0 && hAttr > 0) {
        ovw = wAttr;
        ovh = hAttr;
      }
    }
    if (ovw <= 0 || ovh <= 0) return url;

    // Lienzo de rasterizado con la MISMA proporción que el viewBox original,
    // escalado a una resolución razonable para detectar bordes con precisión
    // (ni tan chico que pierda detalle, ni tan grande que sea lento).
    const TARGET_MAX = 1000;
    const rasterScale = TARGET_MAX / Math.max(ovw, ovh);
    const CANVAS_W = Math.max(1, Math.round(ovw * rasterScale));
    const CANVAS_H = Math.max(1, Math.round(ovh * rasterScale));

    svg.setAttribute("width", CANVAS_W);
    svg.setAttribute("height", CANVAS_H);
    svg.setAttribute("viewBox", `${ovx} ${ovy} ${ovw} ${ovh}`);

    const svgBlob = new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    });
    const blobUrl = URL.createObjectURL(svgBlob);

    const bounds = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = CANVAS_W;
        canvas.height = CANVAS_H;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
        URL.revokeObjectURL(blobUrl);
        const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
        let minX = CANVAS_W,
          minY = CANVAS_H,
          maxX = 0,
          maxY = 0,
          found = false;
        for (let y = 0; y < CANVAS_H; y++) {
          for (let x = 0; x < CANVAS_W; x++) {
            if (data[(y * CANVAS_W + x) * 4 + 3] > 10) {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
              found = true;
            }
          }
        }
        resolve(found ? { minX, minY, maxX, maxY } : null);
      };
      img.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        resolve(null);
      };
      img.src = blobUrl;
    });

    if (!bounds) return url;

    // Convertimos los bordes detectados (en píxeles del raster) de vuelta
    // a las unidades del viewBox original antes de armar el resultado.
    const padPx = 6;
    const minXu = ovx + (bounds.minX - padPx) / rasterScale;
    const minYu = ovy + (bounds.minY - padPx) / rasterScale;
    const maxXu = ovx + (bounds.maxX + padPx) / rasterScale;
    const maxYu = ovy + (bounds.maxY + padPx) / rasterScale;

    const vx = Math.max(ovx, minXu);
    const vy = Math.max(ovy, minYu);
    const vw = Math.min(ovx + ovw, maxXu) - vx;
    const vh = Math.min(ovy + ovh, maxYu) - vy;
    if (vw <= 0 || vh <= 0) return url;

    svg.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
    svg.setAttribute("width",   vw);
    svg.setAttribute("height",  vh);

    const objectUrl = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: "image/svg+xml",
      }),
    );
    _svgTrimCache.set(url, objectUrl);
    return objectUrl;
  } catch (e) {
    console.warn("[setLogoSrc] No se pudo trimar SVG:", e);
    return url;
  }
}

/**
 * Asigna el src de un logo <img> trimando automáticamente el viewBox
 * del SVG para eliminar espacios vacíos a los lados.
 * Para PNG/otros formatos actúa igual que asignar .src directamente.
 */
export async function setLogoSrc(imgEl, url) {
  if (!imgEl || !url) return;
  imgEl.src = url; // mostrar de inmediato para evitar flash vacío
  const trimmedUrl = await _getTrimmedSvgUrl(url);
  if (imgEl.isConnected) imgEl.src = trimmedUrl;
}