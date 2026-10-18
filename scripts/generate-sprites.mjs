// Genera los sprites de miniaturas (10x20 cuadros de 160x90) de cada video del
// catálogo y los sube a Cloudinary como  sprites/<videoId>_<bytes>.jpg
// (misma clave y mismo formato que usa player.js).
//
// Variables de entorno:
//   CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET   (secrets de GitHub; no hacen falta con DRY=1)
//   SHARD / SHARDS     reparto entre jobs en paralelo (por defecto 0 / 1)
//   LIMIT              máximo de sprites a generar en esta ejecución
//   MAX_MINUTES        tiempo máximo antes de parar limpiamente (por defecto 300)
//   IDS                lista "id1,id2" para procesar solo esos videos (pruebas)
//   DRY=1              no sube a Cloudinary: deja los sprites en ./out
//   WORKER_URL, CLOUD_NAME   solo para pruebas / cambios

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const run = promisify(execFile);

const WORKER_URL = process.env.WORKER_URL || "https://cinecorneta.cornetagang.workers.dev";
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwVU0jgVzV_TbtSWZzV0utl-DwSVh7cnTTXDSDxP0tVfEEYA7vYoAJOjOmHU1l0Y9Wz/exec";
const CLOUD = process.env.CLOUD_NAME || "ualxljd6";

const N = 200, COLS = 10, ROWS = 20, FW = 160, FH = 90; // igual que player.js
const UA = "Mozilla/5.0 (X11; Linux x86_64) CineCornetaSprites/1.0";

const SHARD = Number(process.env.SHARD || 0);
const SHARDS = Number(process.env.SHARDS || 1);
const LIMIT = Number(process.env.LIMIT || Infinity);
const DEADLINE = Date.now() + Number(process.env.MAX_MINUTES || 300) * 60_000;
const DRY = process.env.DRY === "1";
const ONLY = (process.env.IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

const log = (...a) => console.log(`[shard ${SHARD}/${SHARDS}]`, ...a);

// ── Catálogo ────────────────────────────────────────────────
async function getJson(url) {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  return r.json();
}

// Recorre cualquier JSON y junta los campos videoId, videoId_es, videoId_en…
function collect(node, out) {
  if (Array.isArray(node)) return node.forEach((n) => collect(n, out));
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) {
    if (/^videoid(_\w+)?$/i.test(k) && typeof v === "string" && v.trim()) out.add(v.trim());
    else if (v && typeof v === "object") collect(v, out);
  }
}

async function fetchCatalogIds() {
  const bases = [`${WORKER_URL}/api`, APPS_SCRIPT_URL];
  let lastErr;
  for (const base of bases) {
    try {
      const ids = new Set();
      const q = (d) => `${base}?data=${d}`;
      for (const d of ["allMovies&order=desc", "series", "episodes"]) collect(await getJson(q(d)), ids);
      const sagas = Object.values((await getJson(q("sagas_list"))) || {});
      for (const s of sagas) if (s?.id) collect(await getJson(q(s.id)), ids);
      if (ids.size) return [...ids].sort();
    } catch (e) {
      lastErr = e;
      log("catálogo falló con", base, "→", e.message);
    }
  }
  throw lastErr || new Error("catálogo vacío");
}

// ── Utilidades de video ─────────────────────────────────────
const videoUrl = (id) => `${WORKER_URL}/?id=${encodeURIComponent(id)}&type=video`;

// Mismo cálculo que player.js (_detectFastStart): Content-Range de un Range 0-2047
async function getContentLength(url) {
  const r = await fetch(url, { headers: { Range: "bytes=0-2047", "user-agent": UA }, redirect: "follow" });
  if (!r.ok && r.status !== 206) { await r.body?.cancel(); return null; }
  const cr = r.headers.get("content-range");
  const len = cr ? parseInt(cr.split("/")[1], 10) || null : parseInt(r.headers.get("content-length"), 10) || null;
  await r.body?.cancel();
  return len;
}

async function spriteExists(key) {
  try {
    const r = await fetch(`https://res.cloudinary.com/${CLOUD}/image/upload/sprites/${key}.jpg`, { method: "HEAD" });
    return r.ok;
  } catch { return false; }
}

async function getDuration(url) {
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-user_agent", UA, "-show_entries", "format=duration", "-of", "csv=p=0", url],
    { timeout: 60_000 },
  );
  const d = parseFloat(stdout.trim());
  return Number.isFinite(d) && d > 1 ? d : null;
}

async function grabFrame(url, t, file) {
  const vf = `scale=${FW}:${FH}:force_original_aspect_ratio=decrease,pad=${FW}:${FH}:(ow-iw)/2:(oh-ih)/2:black`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await run(
        "ffmpeg",
        ["-v", "error", "-y", "-user_agent", UA, "-ss", t.toFixed(3), "-i", url, "-frames:v", "1", "-vf", vf, "-q:v", "4", file],
        { timeout: 90_000 },
      );
      await fs.access(file);
      return true;
    } catch { /* reintenta */ }
  }
  return false;
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) { const n = i++; await fn(items[n], n); }
  }));
}

async function buildSprite(id, key) {
  const url = videoUrl(id);
  const dur = await getDuration(url);
  if (!dur) throw new Error("no se pudo leer la duración");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spr-"));
  try {
    const ok = new Array(N).fill(false);
    const idxs = Array.from({ length: N }, (_, i) => i);
    await pool(idxs, 4, async (i) => {
      // mismo instante que el escáner del player: centro de la casilla
      const t = Math.min(((i + 0.5) / N) * dur, dur - 0.1);
      ok[i] = await grabFrame(url, t, path.join(dir, `f${String(i + 1).padStart(3, "0")}.jpg`));
    });
    const failed = ok.filter((v) => !v).length;
    if (failed > N * 0.1) throw new Error(`fallaron ${failed}/${N} cuadros`);
    // huecos sueltos: repetir el cuadro anterior (o el siguiente si es el primero)
    for (let i = 0; i < N; i++) {
      if (ok[i]) continue;
      const src = ok.findLastIndex((v, j) => v && j < i) !== -1 ? ok.findLastIndex((v, j) => v && j < i) : ok.indexOf(true);
      await fs.copyFile(path.join(dir, `f${String(src + 1).padStart(3, "0")}.jpg`), path.join(dir, `f${String(i + 1).padStart(3, "0")}.jpg`));
    }
    const out = path.join(dir, "sprite.jpg");
    await run("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-start_number", "1", "-i", path.join(dir, "f%03d.jpg"),
      "-vf", `tile=${COLS}x${ROWS}`, "-frames:v", "1", "-q:v", "6", out], { timeout: 120_000 });
    return { buf: await fs.readFile(out), failed, dur };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ── Subida firmada a Cloudinary ─────────────────────────────
async function upload(key, buf) {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { overwrite: "true", public_id: `sprites/${key}`, timestamp };
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  const signature = crypto.createHash("sha1").update(toSign + API_SECRET).digest("hex");
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "image/jpeg" }), "sprite.jpg");
  fd.append("api_key", API_KEY);
  fd.append("timestamp", String(timestamp));
  fd.append("public_id", params.public_id);
  fd.append("overwrite", "true");
  fd.append("signature", signature);
  const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return j.secure_url;
}

// ── Principal ───────────────────────────────────────────────
async function main() {
  if (!DRY && (!API_KEY || !API_SECRET)) throw new Error("Faltan CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET");
  const all = ONLY.length ? ONLY : await fetchCatalogIds();
  const mine = all.filter((_, i) => i % SHARDS === SHARD);
  log(`${all.length} videos en el catálogo, ${mine.length} en este shard`);

  let made = 0, skipped = 0, errors = 0;
  for (const id of mine) {
    if (made >= LIMIT) { log("LIMIT alcanzado"); break; }
    if (Date.now() > DEADLINE) { log("tiempo máximo alcanzado, se continúa en la próxima ejecución"); break; }
    try {
      const len = await getContentLength(videoUrl(id));
      if (!len) { log(`✗ ${id}: sin tamaño (¿Worker/Drive no responde?)`); errors++; continue; }
      const key = `${id}_${len}`;
      if (!DRY && (await spriteExists(key))) { skipped++; continue; }
      const t0 = Date.now();
      const { buf, failed, dur } = await buildSprite(id, key);
      if (DRY) {
        await fs.mkdir("out", { recursive: true });
        await fs.writeFile(path.join("out", `${key}.jpg`), buf);
        log(`✓ (dry) ${key}.jpg ${Math.round(buf.length / 1024)} KB`);
      } else {
        const url = await upload(key, buf);
        log(`✓ ${key} ${Math.round(buf.length / 1024)} KB, ${Math.round(dur / 60)} min de video, ${failed} huecos, ${Math.round((Date.now() - t0) / 1000)} s → ${url}`);
      }
      made++;
    } catch (e) {
      errors++;
      log(`✗ ${id}: ${e.message}`);
    }
  }
  log(`Fin: ${made} generados, ${skipped} ya existían, ${errors} con error`);
}

main().catch((e) => { console.error(e); process.exit(1); });
