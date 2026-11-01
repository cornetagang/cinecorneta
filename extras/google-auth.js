/* ── LOGIN / VINCULACIÓN CON GOOGLE ─────────────────────────────
   Módulo independiente (no toca script.js). Usa el Firebase que ya
   inicializa script.js (firebase.auth() / firebase.database()).

   Qué hace:
   1. Agrega "Continuar con Google" / "Registrarse con Google" a los
      4 formularios (login y registro, escritorio y móvil).
   2. Cuentas NUEVAS creadas con Google: se obliga a elegir un apodo
      antes de seguir. El apodo se guarda como displayName (igual que el
      registro normal) y además en users/{uid}/nickname.
      La condición no es "cuenta nueva" sino "cuenta solo-Google sin
      users/{uid}/nickname": si cierran la pestaña a medias, el modal
      vuelve a salir en el próximo ingreso.
   3. Cuentas YA creadas (correo + contraseña): botón "Vincular con
      Google" en Perfil → engranaje de ajustes. Después pueden entrar con
      cualquiera de los dos. También permite desvincular.
   4. Si intentan entrar con Google usando un correo que ya tiene cuenta
      con contraseña, se les pide la contraseña y se vinculan ahí mismo.
   ─────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  // 3–20 caracteres: letras, números, espacio . _ - (sin @, para que no sea un correo)
  const NICK_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,18}[\p{L}\p{N}]$/u;

  const G_SVG =
    '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">' +
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
    "</svg>";

  let auth = null;
  let db = null;

  const newProvider = () => {
    const p = new window.firebase.auth.GoogleAuthProvider();
    p.setCustomParameters({ prompt: "select_account" });
    return p;
  };
  // Móvil / navegadores integrados: el popup de Google suele fallar (se cierra solo, lo bloquean o
  // pierde la comunicación con la página). En móvil se usa redirección directamente.
  // Con el sitio en GitHub Pages (authDomain de Firebase en otro dominio) la redirección falla en
  // Safari/Chrome móvil por el almacenamiento particionado, así que por defecto se usa popup también
  // en móvil. Pon true SOLO si el sitio se sirve desde el mismo dominio que authDomain
  // (p. ej. Firebase Hosting) o si ya tienes el proxy de /__/auth/.
  const MOBILE_USE_REDIRECT = false;
  const UA = navigator.userAgent || "";
  const isMobile = () =>
    /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(UA) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(UA)); // iPadOS se identifica como Mac
  // Google bloquea el login (error 403 disallowed_useragent) dentro de estos navegadores integrados
  const isInAppBrowser = () => /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|TikTok|musical_ly|Snapchat|Twitter|; wv\)/i.test(UA);
  const IN_APP_MSG = "Google no permite iniciar sesión desde este navegador integrado. Abre el sitio en Chrome o Safari e intenta de nuevo.";
  // Errores del popup en los que conviene reintentar con redirección
  const POPUP_FALLBACK = [
    "auth/popup-blocked",
    "auth/operation-not-supported-in-this-environment",
    "auth/web-storage-unsupported",
  ];
  const hasProvider = (u, id) => !!u && (u.providerData || []).some((p) => p && p.providerId === id);
  const isGoogleOnly = (u) => hasProvider(u, "google.com") && !hasProvider(u, "password");

  /* ── Respaldo del nombre y la foto ──
     Al entrar con Google en una cuenta que ya existe (correo + contraseña), Firebase puede
     reemplazar el displayName y la photoURL por los de la cuenta de Google. Para que eso no pase:
     · mientras NO se esté entrando con Google, se guarda users/{uid}/profileBackup con el
       nombre y la foto actuales (al abrir la página y justo antes de cerrar sesión);
     · después de entrar/vincular con Google, si cambiaron, se restauran. */
  let suppressBackup = false; // true durante el flujo de Google: no se respalda lo que Google acaba de poner

  async function saveBackup(user) {
    if (!user || !hasProvider(user, "password")) return; // solo cuentas con perfil propio
    try {
      await db.ref(`users/${user.uid}/profileBackup`).set({
        displayName: user.displayName || null,
        photoURL: user.photoURL || null,
      });
    } catch (e) {
      console.warn("google-auth: no se pudo respaldar el perfil:", e && e.message);
    }
  }

  // Devuelve true si tuvo que restaurar algo
  async function applyProfile(user, snap) {
    if (!user || !snap) return false;
    const dn = snap.displayName || null;
    const ph = snap.photoURL || null;
    if ((user.displayName || null) === dn && (user.photoURL || null) === ph) return false;
    const upd = { photoURL: ph };
    if (dn) upd.displayName = dn;
    try {
      await user.updateProfile(upd);
      return true;
    } catch (e) {
      console.warn("google-auth: no se pudo restaurar el perfil:", e && e.message);
      return false;
    }
  }

  // Nombre y foto "reales" de la cuenta. profile.js los guarda en users/{uid}/username y
  // users/{uid}/photoURL cada vez que se edita el perfil (Firebase no los toca al entrar con Google);
  // si no existen, se usa el respaldo propio (profileBackup).
  async function savedProfile(user) {
    const get = async (path) => {
      try { return (await db.ref(`users/${user.uid}/${path}`).once("value")).val(); } catch (_) { return null; }
    };
    const [bk, un, ph] = await Promise.all([get("profileBackup"), get("username"), get("photoURL")]);
    const displayName = (typeof un === "string" && un) || (bk && bk.displayName) || null;
    const photoURL = (typeof ph === "string" && ph) || (bk && bk.photoURL) || null;
    if (!bk && !displayName && !photoURL) return null;
    return { displayName, photoURL };
  }

  async function restoreAfterGoogle(user) {
    if (!user || !hasProvider(user, "password")) return false; // cuenta nueva de Google: nada que restaurar
    return applyProfile(user, await savedProfile(user));
  }

  // Cuenta con contraseña + Google cuyo nombre/foto ya fueron pisados antes: se arregla al cargar (una vez por sesión)
  async function repairIfNeeded(user) {
    if (!hasProvider(user, "google.com") || !hasProvider(user, "password")) return false;
    const flag = "gauth_fix_" + user.uid;
    try { if (sessionStorage.getItem(flag)) return false; } catch (_) {}
    const fixed = await applyProfile(user, await savedProfile(user));
    if (fixed) {
      try { sessionStorage.setItem(flag, "1"); } catch (_) {}
      reloadSoon();
    }
    return fixed;
  }

  const reloadSoon = () => setTimeout(() => location.reload(), 150);

  function errMsg(e) {
    switch (e && e.code) {
      case "auth/cancelled-popup-request":
        return "";
      case "auth/popup-closed-by-user":
        return "Se cerró la ventana de Google antes de terminar. Intenta de nuevo.";
      case "auth/web-storage-unsupported":
      case "auth/operation-not-supported-in-this-environment":
        return "Tu navegador tiene bloqueado el almacenamiento (modo privado o cookies de terceros). Actívalo o usa Chrome/Safari.";
      case "auth/internal-error":
        return "Error interno al iniciar sesión con Google. Intenta de nuevo.";
      case "auth/popup-blocked":
        return "El navegador bloqueó la ventana de Google. Permite las ventanas emergentes e intenta de nuevo.";
      case "auth/network-request-failed":
        return "Sin conexión. Revisa tu internet e intenta de nuevo.";
      case "auth/unauthorized-domain":
        return "Este dominio no está autorizado en Firebase (Authentication → Settings → Dominios autorizados).";
      case "auth/operation-not-allowed":
        return "El acceso con Google no está activado en Firebase.";
      case "auth/credential-already-in-use":
        return "Esa cuenta de Google ya está vinculada a otra cuenta del sitio.";
      case "auth/provider-already-linked":
        return "Tu cuenta ya tiene Google vinculado.";
      case "auth/requires-recent-login":
        return "Por seguridad, cierra sesión, vuelve a entrar e inténtalo de nuevo.";
      default:
        return "No se pudo continuar con Google. Intenta de nuevo.";
    }
  }

  /* ── Estilos ── */
  function injectStyles() {
    if (document.getElementById("gauth-styles")) return;
    const st = document.createElement("style");
    st.id = "gauth-styles";
    st.textContent = `
.gauth-wrap{display:block;margin-top:14px}
.gauth-or{display:flex;align-items:center;gap:10px;margin:0 0 12px;color:var(--text-muted,#64748b);font-size:.75rem;text-transform:uppercase;letter-spacing:1px}
.gauth-or::before,.gauth-or::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.14)}
.auth-form .gauth-btn,.gauth-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:44px;padding:10px 14px;
  background:#fff;color:#1f1f1f;border:1px solid #dadce0;border-radius:6px;font-size:.95rem;font-weight:600;cursor:pointer;transition:filter .15s}
.auth-form .gauth-btn:hover,.gauth-btn:hover{filter:brightness(.94)}
.gauth-btn:disabled{opacity:.6;cursor:wait}
.gauth-hint{margin:8px 0 0;font-size:.72rem;text-align:center;color:var(--text-muted,#64748b)}
.gauth-msg{display:none;margin:10px 0 0;font-size:.82rem;text-align:center;font-weight:700;color:#ff4d4d}
.gauth-msg.show{display:block}
#gauth-link-btn{display:flex;align-items:center;gap:10px}
#gauth-link-btn svg{flex:0 0 auto}
#gauth-link-btn:disabled{opacity:.7;cursor:default}
.gauth-ov{position:fixed;inset:0;z-index:20000;display:flex;align-items:center;justify-content:center;padding:16px;
  background:rgba(0,0,0,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.gauth-box{width:100%;max-width:380px;background:#0c0e14;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:22px;
  box-shadow:0 20px 60px rgba(0,0,0,.6);color:var(--text-light,#f8fafc);display:flex;flex-direction:column;gap:12px}
.gauth-box h2{margin:0;font-family:"Bebas Neue",sans-serif;font-size:1.8rem;letter-spacing:1px}
.gauth-box p{margin:0;font-size:.85rem;line-height:1.45;color:var(--text-muted,#94a3b8)}
.gauth-box input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:8px;
  padding:12px;font-size:16px;color:var(--text-light,#f8fafc)}
.gauth-box input:focus{outline:none;border-color:var(--accent-color)}
.gauth-err{min-height:1em;color:#ff4d4d!important;font-weight:700}
.gauth-ok{width:100%;padding:12px;border:0;border-radius:8px;background:var(--accent-color);color:#fff;font-size:1rem;font-weight:800;cursor:pointer}
.gauth-ok:disabled{opacity:.6;cursor:wait}
.gauth-cancel{background:none;border:0;color:var(--text-muted,#94a3b8);font-size:.8rem;cursor:pointer;text-decoration:underline;padding:4px}
.gauth-toast{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:20001;max-width:calc(100vw - 32px);
  background:#111827;color:#f8fafc;border:1px solid rgba(255,255,255,.12);padding:10px 16px;border-radius:50px;font-size:.82rem;box-shadow:0 8px 30px rgba(0,0,0,.5)}
html.gauth-lock,html.gauth-lock body{overflow:hidden}
`;
    document.head.appendChild(st);
  }

  function toast(text) {
    if (!text) return;
    const t = document.createElement("div");
    t.className = "gauth-toast";
    t.setAttribute("role", "status");
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }

  /* ── Diálogo genérico (con o sin campo) ──
     onSubmit(valor) puede lanzar Error("mensaje") para mostrarlo dentro del diálogo.
     dismissible=false → no se cierra con Escape ni tocando afuera (solo con los botones). */
  function openDialog(o) {
    const ov = document.createElement("div");
    ov.className = "gauth-ov";
    const form = document.createElement("form");
    form.className = "gauth-box";
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");
    form.noValidate = true;

    const h = document.createElement("h2");
    h.textContent = o.title;
    h.id = "gauth-t-" + Date.now();
    form.setAttribute("aria-labelledby", h.id);
    const p = document.createElement("p");
    p.textContent = o.text;
    form.append(h, p);

    let input = null;
    if (o.input) {
      input = document.createElement("input");
      input.type = o.input.type || "text";
      input.placeholder = o.input.placeholder || "";
      if (o.input.maxLength) input.maxLength = o.input.maxLength;
      input.autocomplete = o.input.autocomplete || "off";
      input.setAttribute("aria-label", o.input.placeholder || o.title);
      // evita que atajos del sitio capturen las teclas mientras se escribe
      input.addEventListener("keydown", (e) => e.stopPropagation());
      form.appendChild(input);
    }
    const err = document.createElement("p");
    err.className = "gauth-err";
    err.setAttribute("role", "alert");
    const ok = document.createElement("button");
    ok.type = "submit";
    ok.className = "gauth-ok";
    ok.textContent = o.submitText;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "gauth-cancel";
    cancel.textContent = o.cancelText;
    form.append(err, ok, cancel);
    ov.appendChild(form);

    const prevFocus = document.activeElement;
    const close = () => {
      document.removeEventListener("keydown", onKey, true);
      ov.remove();
      document.documentElement.classList.remove("gauth-lock");
      if (o.dismissible !== false && prevFocus && prevFocus.focus) prevFocus.focus();
    };
    const doCancel = () => { close(); if (o.onCancel) o.onCancel(); };
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (o.dismissible !== false) doCancel();
      } else if (e.key === "Tab") {
        const f = [...form.querySelectorAll("input,button")];
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKey, true);
    cancel.addEventListener("click", doCancel);
    ov.addEventListener("mousedown", (e) => { if (e.target === ov && o.dismissible !== false) doCancel(); });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.textContent = "";
      ok.disabled = true;
      try {
        await o.onSubmit(input ? input.value : null);
        close();
      } catch (ex) {
        err.textContent = ex && ex.message ? ex.message : "Ocurrió un error. Intenta de nuevo.";
        ok.disabled = false;
        if (input) input.focus();
      }
    });

    document.documentElement.classList.add("gauth-lock");
    document.body.appendChild(ov);
    setTimeout(() => (input || ok).focus(), 30);
    return { close };
  }

  /* ── Apodo obligatorio para cuentas nuevas de Google ── */
  let nickDialogOpen = false;

  async function checkNickname(user) {
    if (nickDialogOpen || !isGoogleOnly(user)) return;
    let has = false;
    try {
      has = (await db.ref(`users/${user.uid}/nickname`).once("value")).exists();
    } catch (e) {
      console.warn("google-auth: no se pudo leer el apodo:", e && e.message);
      return; // sin lectura no podemos decidir; no bloqueamos la sesión
    }
    if (has || auth.currentUser !== user) return;

    nickDialogOpen = true;
    openDialog({
      title: "Elige tu apodo",
      text: "Así te verán en el sitio (perfil y reseñas). Es obligatorio para terminar de crear tu cuenta; puedes cambiarlo después desde tu perfil.",
      input: { placeholder: "Apodo (3–20 caracteres)", maxLength: 20, autocomplete: "nickname" },
      submitText: "Guardar y continuar",
      cancelText: "Cancelar y cerrar sesión",
      dismissible: false,
      onSubmit: async (raw) => {
        const nick = String(raw || "").trim().replace(/\s+/g, " ");
        if (nick.length < 3) throw new Error("El apodo debe tener al menos 3 caracteres.");
        if (!NICK_RE.test(nick)) throw new Error("Usa solo letras, números, espacios y . _ - (hasta 20 caracteres).");
        try {
          await db.ref(`users/${user.uid}`).update({ nickname: nick, username: nick });
          await user.updateProfile({ displayName: nick });
        } catch (e) {
          throw new Error("No se pudo guardar el apodo. Revisa tu conexión e intenta de nuevo.");
        }
        // Recarga una vez para que saludo, avatares y presencia ya muestren el apodo
        // (updateProfile no dispara onAuthStateChanged).
        setTimeout(() => location.reload(), 150);
      },
      onCancel: () => {
        nickDialogOpen = false;
        auth.signOut().then(() => location.reload());
      },
    });
  }

  /* ── Ingresar / registrarse con Google ── */
  function setMsg(el, text) {
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("show", !!text);
  }

  async function startRedirect(op) {
    try { sessionStorage.setItem("gauth_redirect", "1"); } catch (_) {}
    if (op === "link") { try { sessionStorage.setItem("gauth_link", "1"); } catch (_) {} }
    if (op === "link") await auth.currentUser.linkWithRedirect(newProvider());
    else await auth.signInWithRedirect(newProvider());
  }

  async function signInWithGoogle(msgEl, btn) {
    setMsg(msgEl, "");
    if (isInAppBrowser()) { setMsg(msgEl, IN_APP_MSG); return; }
    if (btn) btn.disabled = true;
    suppressBackup = true;
    try {
      if (MOBILE_USE_REDIRECT && isMobile()) {
        await startRedirect("signin");
        return; // la página se va a Google y vuelve; el resultado lo procesa getRedirectResult()
      }
      const res = await auth.signInWithPopup(newProvider());
      if (typeof window.closeMobileDrawer === "function") { try { window.closeMobileDrawer(); } catch (_) {} }
      if (await restoreAfterGoogle(res.user)) reloadSoon(); // devuelve el nombre y la foto de la cuenta original
    } catch (e) {
      if (e && POPUP_FALLBACK.includes(e.code)) {
        // El popup no se pudo abrir: se reintenta con redirección
        try { await startRedirect("signin"); return; } catch (e2) { e = e2; }
      }
      if (e && e.code === "auth/account-exists-with-different-credential") offerLinkExisting(e);
      else setMsg(msgEl, errMsg(e));
    } finally {
      // Si se está redirigiendo, se deja el flag y el botón bloqueado hasta que la página cambie
      let redirecting = false;
      try { redirecting = sessionStorage.getItem("gauth_redirect") === "1"; } catch (_) {}
      if (!redirecting) suppressBackup = false;
      if (btn && !redirecting) btn.disabled = false;
    }
  }

  // Ese correo ya tiene cuenta con contraseña: pide la contraseña y vincula Google ahí mismo
  function offerLinkExisting(e) {
    const email = e.email;
    const cred = e.credential;
    if (!email || !cred) { toast("Ese correo ya tiene una cuenta. Entra con tu contraseña y vincula Google desde tu perfil."); return; }
    openDialog({
      title: "Ya tienes una cuenta",
      text: `${email} ya está registrado con contraseña. Escríbela para vincular Google a esa cuenta; después podrás entrar con cualquiera de los dos.`,
      input: { type: "password", placeholder: "Contraseña", autocomplete: "current-password" },
      submitText: "Vincular Google",
      cancelText: "Cancelar",
      onSubmit: async (pw) => {
        if (!pw) throw new Error("Escribe tu contraseña.");
        let uc;
        try {
          uc = await auth.signInWithEmailAndPassword(email, pw);
        } catch (ex) {
          throw new Error("Contraseña incorrecta.");
        }
        const before = { displayName: uc.user.displayName, photoURL: uc.user.photoURL };
        try {
          await uc.user.linkWithCredential(cred);
        } catch (ex) {
          throw new Error(errMsg(ex) || "No se pudo vincular Google.");
        }
        if (await applyProfile(uc.user, before)) reloadSoon();
        toast("Google vinculado. Ya puedes entrar con Google.");
        refreshLinkUi(auth.currentUser);
        if (typeof window.closeMobileDrawer === "function") { try { window.closeMobileDrawer(); } catch (_) {} }
      },
    });
  }

  /* ── Botones en los formularios de login / registro ── */
  const FORMS = [
    ["login-form", "login"],
    ["register-form", "register"],
    ["mob-login-form", "login"],
    ["mob-register-form", "register"],
  ];

  function injectFormButtons() {
    let all = true;
    FORMS.forEach(([id, mode]) => {
      const f = document.getElementById(id);
      if (!f) { all = false; return; }
      if (f.querySelector(".gauth-wrap")) return;
      const w = document.createElement("div");
      w.className = "gauth-wrap";
      w.innerHTML =
        '<div class="gauth-or"><span>o</span></div>' +
        `<button type="button" class="gauth-btn">${G_SVG}<span>${mode === "register" ? "Registrarse con Google" : "Continuar con Google"}</span></button>` +
        (mode === "register" ? '<p class="gauth-hint">Después te pediremos un apodo.</p>' : "") +
        '<p class="gauth-msg" role="alert"></p>';
      f.appendChild(w);
      const btn = w.querySelector(".gauth-btn");
      const msg = w.querySelector(".gauth-msg");
      btn.addEventListener("click", () => signInWithGoogle(msg, btn));
    });
    return all;
  }

  /* ── Perfil: vincular / desvincular Google (engranaje de ajustes) ── */
  function ensureLinkBtn() {
    const dd = document.getElementById("prf-settings-dropdown");
    if (!dd) return null;
    let b = document.getElementById("gauth-link-btn");
    if (!b) {
      b = document.createElement("button");
      b.id = "gauth-link-btn";
      b.type = "button";
      b.className = "prf-settings-option";
      b.addEventListener("click", onLinkClick);
      dd.appendChild(b);
    }
    return b;
  }

  function setLinkBtn(b, mode, label) {
    b.dataset.mode = mode;
    b.disabled = mode === "none";
    b.innerHTML = G_SVG.replace('width="18" height="18"', 'width="16" height="16"') + "<span></span>";
    b.lastChild.textContent = label;
  }

  function refreshLinkUi(user) {
    const b = ensureLinkBtn();
    if (!b) return;
    const pwBtn = document.getElementById("prf-change-password-btn");
    if (!user) { b.style.display = "none"; return; }
    b.style.display = "";
    const g = hasProvider(user, "google.com");
    const pw = hasProvider(user, "password");
    // Una cuenta solo-Google no tiene contraseña que cambiar
    if (pwBtn) pwBtn.style.display = g && !pw ? "none" : "";
    if (!g) setLinkBtn(b, "link", "Vincular con Google");
    else if (pw) setLinkBtn(b, "unlink", "Desvincular Google");
    else setLinkBtn(b, "none", "Google vinculado");
  }

  async function onLinkClick() {
    const user = auth.currentUser;
    const b = document.getElementById("gauth-link-btn");
    if (!user || !b) return;
    if (b.dataset.mode === "link") {
      const before = { displayName: user.displayName, photoURL: user.photoURL };
      suppressBackup = true;
      if (isInAppBrowser()) { toast(IN_APP_MSG); suppressBackup = false; return; }
      try {
        if (MOBILE_USE_REDIRECT && isMobile()) { await startRedirect("link"); return; }
        await user.linkWithPopup(newProvider());
        const restored = await applyProfile(user, before);
        // La cuenta ya tenía apodo propio (displayName): se deja registrado para que nunca se lo vuelvan a pedir
        try {
          const ref = db.ref(`users/${user.uid}/nickname`);
          if (!(await ref.once("value")).exists() && user.displayName) await ref.set(user.displayName);
        } catch (_) {}
        await user.reload();
        refreshLinkUi(auth.currentUser);
        toast("Google vinculado. Ya puedes entrar con Google.");
        await saveBackup(auth.currentUser);
        if (restored) reloadSoon();
      } catch (e) {
        toast(errMsg(e));
      } finally {
        let redirecting = false;
        try { redirecting = sessionStorage.getItem("gauth_redirect") === "1"; } catch (_) {}
        if (!redirecting) suppressBackup = false;
      }
    } else if (b.dataset.mode === "unlink") {
      openDialog({
        title: "Desvincular Google",
        text: "Dejarás de poder entrar con Google; seguirás entrando con tu correo y contraseña.",
        submitText: "Desvincular",
        cancelText: "Cancelar",
        onSubmit: async () => {
          try {
            await user.unlink("google.com");
            await user.reload();
          } catch (e) {
            throw new Error(errMsg(e) || "No se pudo desvincular.");
          }
          refreshLinkUi(auth.currentUser);
          toast("Google desvinculado.");
        },
      });
    }
  }

  /* ── Arranque: espera a que script.js inicialice Firebase ── */
  function start() {
    auth = window.firebase.auth();
    db = window.firebase.database();
    injectStyles();

    let tries = 0;
    const iv = setInterval(() => {
      if (injectFormButtons() || ++tries > 40) clearInterval(iv);
    }, 250);

    // Si volvemos de una redirección de Google, no se respalda lo que Google acaba de poner
    let fromRedirect = false;
    try { fromRedirect = sessionStorage.getItem("gauth_redirect") === "1"; } catch (_) {}
    if (fromRedirect) suppressBackup = true;

    // Resultado de signInWithRedirect / linkWithRedirect (flujo normal en móvil)
    let wasLink = false;
    try { wasLink = sessionStorage.getItem("gauth_link") === "1"; sessionStorage.removeItem("gauth_link"); } catch (_) {}
    auth.getRedirectResult()
      .then(async (r) => {
        if (r && r.user) {
          let restored = false;
          if (hasProvider(r.user, "password")) {
            restored = await restoreAfterGoogle(r.user);
            if (wasLink || (r.operationType === "link")) {
              // misma lógica que el vínculo con popup: dejar registrado el apodo y el respaldo
              try {
                const ref = db.ref(`users/${r.user.uid}/nickname`);
                if (!(await ref.once("value")).exists() && r.user.displayName) await ref.set(r.user.displayName);
              } catch (_) {}
              toast("Google vinculado. Ya puedes entrar con Google.");
            }
          }
          if (restored) reloadSoon();
        } else if (fromRedirect && !auth.currentUser) {
          // Volvió de Google pero no hay sesión: casi siempre es el almacenamiento particionado del
          // navegador (authDomain distinto al dominio del sitio) o un navegador integrado.
          console.warn("google-auth: volvió de Google sin sesión. Revisa que authDomain sea el mismo dominio del sitio (ver MOBILE_USE_REDIRECT).");
          toast("No se pudo completar el inicio de sesión con Google. Intenta de nuevo o usa tu correo.");
        }
      })
      .catch((e) => {
        if (e && e.code === "auth/account-exists-with-different-credential") offerLinkExisting(e);
        else toast(errMsg(e));
      })
      .then(() => {
        if (fromRedirect) { suppressBackup = false; try { sessionStorage.removeItem("gauth_redirect"); } catch (_) {} }
      });

    auth.onAuthStateChanged((user) => {
      refreshLinkUi(user);
      if (user) {
        checkNickname(user);
        if (!suppressBackup) repairIfNeeded(user).then((fixed) => { if (!fixed) saveBackup(user); });
      }
    });

    // Antes de cerrar sesión se respalda el nombre/foto actuales (por si los editó en esta sesión)
    const origSignOut = auth.signOut.bind(auth);
    auth.signOut = function () {
      return saveBackup(auth.currentUser).then(() => origSignOut(), () => origSignOut());
    };
  }

  function init() {
    let tries = 0;
    const iv = setInterval(() => {
      if (window.firebase && window.firebase.apps && window.firebase.apps.length) {
        clearInterval(iv);
        start();
      } else if (++tries > 120) clearInterval(iv);
    }, 250);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();