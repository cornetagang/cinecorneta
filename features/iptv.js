// ===========================================================
// MÓDULO DE TV EN VIVO (IPTV)
// ===========================================================

const DEFAULT_M3U_URL = 'https://m3u.cl/lista/CL.m3u';

const CORS_PROXIES = [
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://thingproxy.freeboard.io/fetch/${url}`,
];

let channels = [];
let filteredChannels = [];
let activeChannelId = null;
let hlsInstance = null;
let isLoaded = false;

function parseM3U(text) {
    if (!text || !text.includes('#EXTM3U')) return [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const result = [];
    let current = null;
    for (const line of lines) {
        if (line.startsWith('#EXTINF')) {
            const logoMatch  = line.match(/tvg-logo="([^"]*)"/);
            const groupMatch = line.match(/group-title="([^"]*)"/);
            const idMatch    = line.match(/tvg-id="([^"]*)"/);
            const displayName = line.split(',').pop()?.trim() || 'Canal';
            current = {
                id:    idMatch?.[1] || displayName,
                name:  displayName,
                logo:  logoMatch?.[1] || '',
                group: groupMatch?.[1] || 'General',
                url:   ''
            };
        } else if ((line.startsWith('http') || line.startsWith('rtmp')) && current) {
            current.url = line;
            result.push(current);
            current = null;
        }
    }
    return result;
}

async function fetchM3U(url) {
    // 1. Directo
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
            const text = await res.text();
            if (text.includes('#EXTM3U')) return text;
        }
    } catch {}

    // 2. Proxies
    for (const makeProxy of CORS_PROXIES) {
        try {
            const res = await fetch(makeProxy(url), { signal: AbortSignal.timeout(8000) });
            if (res.ok) {
                const text = await res.text();
                if (text.includes('#EXTM3U')) return text;
            }
        } catch {}
    }
    throw new Error('No se pudo obtener la lista. Todos los proxies fallaron.');
}

export async function initIPTV(customUrl = null) {
    const m3uUrl = customUrl || DEFAULT_M3U_URL;
    if (isLoaded && !customUrl) { renderChannels(); return; }

    const loading  = document.getElementById('iptv-loading');
    const errorDiv = document.getElementById('iptv-error');
    const grid     = document.getElementById('iptv-channel-grid');
    const groupBar = document.getElementById('iptv-group-bar');

    if (loading)  loading.style.display  = 'flex';
    if (errorDiv) errorDiv.style.display = 'none';
    if (grid)     grid.innerHTML         = '';
    if (groupBar) groupBar.innerHTML     = '';

    try {
        const text = await fetchM3U(m3uUrl);
        channels = parseM3U(text).filter(c => c.url);
        filteredChannels = [...channels];
        isLoaded = !customUrl;
        if (loading) loading.style.display = 'none';
        if (channels.length === 0) { showError('Lista descargada pero sin canales válidos.'); return; }
        buildGroupFilter();
        renderChannels();
    } catch (e) {
        if (loading) loading.style.display = 'none';
        showError(e.message);
    }
}

function showError(msg) {
    const errorDiv = document.getElementById('iptv-error');
    if (!errorDiv) return;
    errorDiv.innerHTML = `
        <i class="fas fa-exclamation-triangle"></i>
        <p>${msg}</p>
        <p style="font-size:0.85rem;color:#aaa;margin-top:4px;">Ingresa una URL de lista M3U manualmente:</p>
        <div style="display:flex;gap:8px;margin-top:10px;width:100%;max-width:500px;">
            <input type="text" id="iptv-manual-url" placeholder="https://tu-lista.m3u"
                style="flex:1;padding:9px 12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:0.9rem;outline:none;">
            <button id="iptv-manual-load"
                style="padding:9px 16px;background:var(--primary-red);border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:0.9rem;">
                Cargar
            </button>
        </div>
    `;
    errorDiv.style.display = 'flex';
    document.getElementById('iptv-manual-load')?.addEventListener('click', () => {
        const url = document.getElementById('iptv-manual-url')?.value.trim();
        if (url) initIPTV(url);
    });
    document.getElementById('iptv-manual-url')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { const url = e.target.value.trim(); if (url) initIPTV(url); }
    });
}

function buildGroupFilter() {
    const bar = document.getElementById('iptv-group-bar');
    if (!bar) return;

    bar.innerHTML = `
        <button class="iptv-group-btn active" data-group="Todos">Todos</button>
        <button class="iptv-group-btn" data-group="Festival">🎵 Festival</button>
    `;

    bar.querySelectorAll('.iptv-group-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            bar.querySelectorAll('.iptv-group-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const g = btn.dataset.group;
            if (g === 'Festival') {
                filteredChannels = channels.filter(c => isFestivalChannel(c.name));
            } else {
                filteredChannels = [...channels];
            }
            const search = document.getElementById('iptv-search')?.value.trim().toLowerCase();
            if (search) filteredChannels = filteredChannels.filter(c => c.name.toLowerCase().includes(search));
            renderChannels();
        });
    });
}

function renderChannels() {
    const grid = document.getElementById('iptv-channel-grid');
    if (!grid) return;
    if (filteredChannels.length === 0) {
        grid.innerHTML = `<p class="iptv-empty">No se encontraron canales.</p>`;
        return;
    }
    grid.innerHTML = '';
    filteredChannels.forEach(ch => {
        const card = document.createElement('div');
        card.className = `iptv-channel-card${ch.id === activeChannelId ? ' active' : ''}`;
        card.dataset.id = ch.id;
        card.innerHTML = `
            <div class="iptv-logo-wrap">
                <img src="${ch.logo}" alt="${ch.name}" loading="lazy"
                    onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                <div class="iptv-logo-fallback" style="display:none"><i class="fas fa-tv"></i></div>
            </div>
            <span class="iptv-channel-name">${ch.name}</span>
        `;
        card.addEventListener('click', () => playChannel(ch));
        grid.appendChild(card);
    });
}


// Canales del Festival de Viña
const FESTIVAL_KEYWORDS = ['mega', 'meganoticias'];

function isFestivalChannel(name) {
    const n = (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return FESTIVAL_KEYWORDS.some(k => n.includes(k));
}

function setFestivalMode(active) {
    const bg      = document.getElementById('iptv-festival-bg');
    const overlay = document.getElementById('iptv-festival-overlay');
    const panel   = document.getElementById('iptv-festival-panel');
    if (active) {
        if (typeof firebase !== 'undefined') {
            firebase.database().ref('system_metadata').once('value').then(snap => {
                const bgUrl = snap.val()?.live_background_url;
                if (bgUrl && bg) {
                    bg.style.backgroundImage = `url('${bgUrl}')`;
                }
            }).catch(() => {});
        }
        if (bg)      bg.style.opacity = '1';
        if (overlay) overlay.style.opacity = '1';
        if (panel)   panel.style.display = 'block';
    } else {
        if (bg)      bg.style.opacity = '0';
        if (overlay) overlay.style.opacity = '0';
        if (panel)   panel.style.display = 'none';
    }
}

function playChannel(ch) {
    activeChannelId = ch.id;
    document.querySelectorAll('.iptv-channel-card').forEach(c => {
        c.classList.toggle('active', c.dataset.id === ch.id);
    });

    setFestivalMode(isFestivalChannel(ch.name));
    const playerSection = document.getElementById('iptv-player-section');
    const titleEl       = document.getElementById('iptv-now-playing');
    const videoEl       = document.getElementById('iptv-video');
    const bufferingEl   = document.getElementById('iptv-buffering');
    if (playerSection) { playerSection.style.display = 'block'; }
    if (titleEl)     titleEl.textContent = `▶ ${ch.name}`;
    if (bufferingEl) bufferingEl.style.display = 'flex';
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (videoEl) videoEl.src = '';
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsInstance.loadSource(ch.url);
        hlsInstance.attachMedia(videoEl);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            videoEl.play().catch(() => {});
            if (bufferingEl) bufferingEl.style.display = 'none';
        });
        hlsInstance.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal && bufferingEl) {
                bufferingEl.style.display = 'none';
                if (titleEl) titleEl.textContent = `⚠ "${ch.name}" no disponible ahora`;
            }
        });
    } else if (videoEl?.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = ch.url;
        videoEl.play().catch(() => {});
        if (bufferingEl) bufferingEl.style.display = 'none';
    } else {
        if (bufferingEl) bufferingEl.style.display = 'none';
    }
}

export function destroyIPTV() {
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    const videoEl = document.getElementById('iptv-video');
    if (videoEl) { videoEl.pause(); videoEl.src = ''; }
    activeChannelId = null;
    setFestivalMode(false);
}

export function setupIPTVSearch() {
    const input = document.getElementById('iptv-search');
    if (!input) return;
    input.addEventListener('input', () => {
        const term = input.value.trim().toLowerCase();
        const activeGroup = document.querySelector('.iptv-group-btn.active')?.dataset.group || 'Todos';
        filteredChannels = (activeGroup === 'Todos' ? channels : channels.filter(c => c.group === activeGroup))
            .filter(c => !term || c.name.toLowerCase().includes(term));
        renderChannels();
    });
}
