// ===========================================================
// OPTIMIZADOR DE URLs DE IMÁGENES
// Pide a TMDB / Cloudinary una versión al tamaño con que se muestra la imagen,
// en vez de /original/ (que pesa varios MB).
// ===========================================================

// Tamaños válidos de TMDB:
//   pósters:  w92 w154 w185 w342 w500 w780 original
//   banners:  w300 w780 w1280 original
const TMDB_SIZES = {
    poster: "w500",   // tarjeta ~200 px a 2x = 400 px
    banner: "w1280",  // hero a pantalla completa
};

const TMDB_ORIGINAL = /^(https:\/\/image\.tmdb\.org\/t\/p\/)original\//;

// Cloudinary: se inserta la transformación justo después de /upload/.
//   f_auto  -> WebP/AVIF según el navegador
//   q_auto  -> calidad automática
//   w_XXX   -> ancho máximo; c_limit evita agrandar imágenes más pequeñas
const CLOUDINARY_WIDTHS = { poster: 500, banner: 1280 };
const CLOUDINARY_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/;

function optimizeCloudinary(url, kind) {
    const m = url.match(CLOUDINARY_UPLOAD);
    if (!m) return url;
    const [, base, rest] = m;
    // SVG (logos) no necesita ni admite redimensionado
    if (/\.svg(\?.*)?$/i.test(rest)) return url;
    // Si ya trae transformaciones (el primer segmento no es la versión vNNN), no se toca
    if (!/^v\d+\//.test(rest)) return url;
    const w = CLOUDINARY_WIDTHS[kind] || CLOUDINARY_WIDTHS.poster;
    return `${base}f_auto,q_auto,c_limit,w_${w}/${rest}`;
}

/**
 * @param {string} url
 * @param {'poster'|'banner'} kind
 * @returns {string} URL optimizada; cualquier otra URL se devuelve sin tocar.
 */
export function optimizeImage(url, kind = "poster") {
    if (typeof url !== "string" || !url) return url;
    if (url.startsWith("https://res.cloudinary.com/")) return optimizeCloudinary(url, kind);
    const size = TMDB_SIZES[kind] || TMDB_SIZES.poster;
    return url.replace(TMDB_ORIGINAL, `$1${size}/`);
}

export default optimizeImage;