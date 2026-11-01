// ===========================================================
// SERVICE WORKER — caché de imágenes de Cloudinary
// Solo toca imágenes de Cloudinary. Todo lo demás
// (Firebase, la hoja, el reproductor, tu propio código) pasa sin tocar.
// ===========================================================

const CACHE_PREFIX = "cc-img-";
const CACHE_NAME = CACHE_PREFIX + "v1";   // súbelo (v2, v3…) para vaciar el almacén
const MAX_ENTRIES = 400;                  // tope de imágenes guardadas
// TMDB NO está aquí a propósito: sus imágenes no traen permiso CORS, así que no se
// pueden guardar con su tamaño real (el navegador las contaría como ~7 MB cada una)
// y el intento solo generaba errores y pedidos de más. Esas las maneja el caché normal del navegador.
const HOSTS = ["res.cloudinary.com"];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Borra almacenes de versiones anteriores
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

async function trim(cache) {
  const keys = await cache.keys(); // en orden de inserción: las primeras son las más viejas
  const extra = keys.length - MAX_ENTRIES;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

async function handleImage(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request.url);
  if (hit) return hit;

  // Las imágenes pedidas con <img> o background-image llegan en modo "no-cors"
  // (respuesta opaca, que el navegador cuenta como varios MB). Se repiden en
  // modo CORS para guardarlas con su tamaño real.
  let response;
  if (request.mode === "no-cors") {
    try {
      response = await fetch(request.url, { mode: "cors", credentials: "omit" });
    } catch {
      response = null; // el sitio no admite CORS: se cae al pedido normal
    }
  }
  if (!response) response = await fetch(request);

  // Solo se guardan respuestas completas y correctas
  if (response.ok && response.status === 200 && response.type !== "opaque") {
    try {
      await cache.put(request.url, response.clone());
      await trim(cache);
    } catch {
      /* sin espacio u otro fallo: no es crítico, la imagen igual se entrega */
    }
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (!HOSTS.includes(url.hostname)) return;
  event.respondWith(handleImage(request));
});