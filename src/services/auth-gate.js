// Gate de autenticacion: bloquea la app hasta que el usuario este logueado
// con un tenant valido en Supabase.

import { state, rolLabel } from '../state.js';
import { signIn, signOut, fetchCurrentTenantInfo, onAuthStateChange, getSupabaseClient } from './supabase.js';

const APP_SHELL_ID = 'app-shell';
const AUTH_SCREEN_ID = 'auth-screen';

// Bandera global: signal que la pantalla de login ya esta oculta. Lo usa
// el safety timeout para saber si todavia debe quejarse.
let loginHidden = false;

function showLogin(opts = {}) {
  loginHidden = false;
  const auth = document.getElementById(AUTH_SCREEN_ID);
  const app = document.getElementById(APP_SHELL_ID);
  if (auth) auth.style.display = 'flex';
  if (app) app.style.display = 'none';
  if (opts.errorMessage) {
    const errorEl = document.getElementById('login-error');
    if (errorEl) errorEl.textContent = opts.errorMessage;
  }
  // Reset boton en caso de que viniera de un estado "Conectando..."
  const submitBtn = document.getElementById('login-submit');
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Entrar'; }
}

function hideLogin() {
  loginHidden = true;
  console.log('👁 hideLogin');
  const auth = document.getElementById(AUTH_SCREEN_ID);
  const app = document.getElementById(APP_SHELL_ID);
  if (auth) auth.style.display = 'none';
  if (app) app.style.display = '';
  const errorEl = document.getElementById('login-error');
  if (errorEl) errorEl.textContent = '';
  renderUserBadge();
}

// Render compacto del user-badge: avatar (inicial) + chip de rol + flecha.
// El detalle (email completo + boton Salir) vive en un dropdown que se abre
// al hacer clic. Ocupa ~90px en lugar de ~250px del badge expandido — deja
// espacio a los badges de saldos que ya estaban en el header.
function renderUserBadge() {
  const userBadge = document.getElementById('user-badge');
  if (!userBadge || !state.session) return;
  const email = state.session.email || '';
  const role = rolLabel();
  const initial = (email[0] || '?').toUpperCase();

  userBadge.innerHTML = `
    <div style="position:relative;">
      <button id="user-badge-trigger"
              onclick="window.toggleUserMenu(event)"
              title="Cuenta y sesion"
              style="display:flex;align-items:center;gap:6px;background:transparent;border:1px solid var(--border);border-radius:20px;padding:3px 8px 3px 3px;cursor:pointer;color:var(--text);font:inherit;">
        <span style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--accent);color:var(--on-accent);font-weight:700;font-size:12px;font-family:'Syne',sans-serif;">${escapeHtml(initial)}</span>
        <span style="font-size:10px;padding:2px 6px;border-radius:6px;background:rgba(200,169,110,.2);color:var(--accent);font-weight:600;">${escapeHtml(role)}</span>
        <span style="font-size:9px;color:var(--muted);">▾</span>
      </button>
      <div id="user-menu" style="display:none;position:absolute;top:calc(100% + 6px);right:0;min-width:240px;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35);padding:12px;z-index:1000;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Conectado como</div>
        <div style="font-size:13px;font-weight:600;margin-bottom:8px;word-break:break-all;">${escapeHtml(email)}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;">
          <span style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">Rol:</span>
          <span style="font-size:11px;padding:2px 8px;border-radius:6px;background:rgba(200,169,110,.2);color:var(--accent);font-weight:600;">${escapeHtml(role)}</span>
        </div>
        <button class="btn btn-ghost" onclick="window.handleLogout()" style="width:100%;font-size:12px;padding:7px;">↪ Cerrar sesion</button>
      </div>
    </div>
  `;
}

let _userMenuDocListener = null;
export function toggleUserMenu(ev) {
  if (ev) ev.stopPropagation();
  const menu = document.getElementById('user-menu');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  if (isOpen) {
    closeUserMenu();
  } else {
    menu.style.display = 'block';
    // Listener para cerrar al hacer clic fuera. Se registra una vez por apertura.
    if (!_userMenuDocListener) {
      _userMenuDocListener = (e) => {
        const trigger = document.getElementById('user-badge-trigger');
        if (menu.contains(e.target) || trigger?.contains(e.target)) return;
        closeUserMenu();
      };
      // setTimeout para que el mismo click que abrio no lo cierre.
      setTimeout(() => document.addEventListener('click', _userMenuDocListener), 0);
    }
  }
}

function closeUserMenu() {
  const menu = document.getElementById('user-menu');
  if (menu) menu.style.display = 'none';
  if (_userMenuDocListener) {
    document.removeEventListener('click', _userMenuDocListener);
    _userMenuDocListener = null;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setLoginButton(text, disabled) {
  const btn = document.getElementById('login-submit');
  if (!btn) return;
  btn.disabled = !!disabled;
  btn.textContent = text;
}

// Helper: corre una promesa con límite de tiempo. Si se pasa, rechaza. Evita
// que el gate se quede colgado para siempre (pantalla negra) si Supabase no
// responde.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label || 'timeout')), ms))
  ]);
}

// Check inicial al cargar la app. Si hay sesion valida + tenant -> muestra app.
// Si no -> muestra login.
export async function initAuthGate(onAuthedCallback) {
  console.log('🔐 initAuthGate inicio');
  let info;
  try {
    // Red de seguridad: si fetchCurrentTenantInfo no resuelve en 12s, caemos a
    // login en vez de quedarnos en negro.
    info = await withTimeout(fetchCurrentTenantInfo(), 12000, 'initAuthGate: timeout verificando sesión');
  } catch (e) {
    console.error('initAuthGate error', e);
    showLogin({ errorMessage: 'No pudimos verificar tu sesión (revisa tu conexión y recarga). ' + (e.message || e) });
    return false;
  }

  if (!info) {
    console.log('  → sin sesion, mostrando login');
    showLogin();
    return false;
  }
  if (info.orphan) {
    console.warn('  → orphan, mostrando login con mensaje');
    showLogin({ errorMessage: 'Tu usuario no esta asignado a ningun tenant. Contacta al admin.' });
    return false;
  }

  state.session = info;
  hideLogin();
  if (onAuthedCallback) {
    console.log('  → invocando bootstrap');
    await onAuthedCallback();
  }
  return true;
}

// Listener de cambios de sesion (logout, refresh, etc.)
export function setupAuthListener(onAuthedCallback) {
  onAuthStateChange((event, session) => {
    console.log('🔔 onAuthStateChange:', event, session ? '(con session)' : '(sin session)');
    // CRÍTICO: diferimos TODO el trabajo con setTimeout(0). Supabase invoca este
    // callback sosteniendo un lock interno (navigator.locks); hacer queries o
    // llamar getSession() aquí adentro deadlockea y deja la app en negro. Ya
    // fuera del callback (siguiente tick) es seguro.
    setTimeout(async () => {
      if (event === 'SIGNED_OUT' || !session) {
        state.session = null;
        showLogin();
        return;
      }
      // Mantener autenticada la conexión de realtime con el token actual (incluido
      // tras TOKEN_REFRESHED, ~cada hora). Sin esto la RLS bloquea los eventos de
      // realtime. setAuth NO usa el lock de auth → seguro en este callback.
      try {
        if (session.access_token) getSupabaseClient().realtime.setAuth(session.access_token);
      } catch (e) { console.warn('realtime.setAuth en listener falló:', e); }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        let info;
        try {
          // Pasamos la `session` del listener para NO volver a llamar getSession().
          info = await fetchCurrentTenantInfo(session);
        } catch (e) {
          console.error('  → fetchCurrentTenantInfo lanzo:', e);
          showLogin({ errorMessage: 'No pude cargar tu tenant: ' + (e.message || e) });
          return;
        }

        if (info && !info.orphan) {
          state.session = info;
          hideLogin();
          if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && onAuthedCallback) {
            try { await onAuthedCallback(); }
            catch (e) { console.error('  → bootstrap fallo:', e); }
          }
          return;
        }
        if (info?.orphan) {
          showLogin({ errorMessage: 'Tu usuario no esta asignado a ningun tenant.' });
          return;
        }
        // info === null  →  query fallo, sin mensaje claro
        showLogin({ errorMessage: 'No pude consultar tu tenant. Revisa la consola (F12) o reintenta.' });
      }
    }, 0);
  });
}

// Handler del formulario de login (llamado desde el HTML)
export async function handleLoginSubmit(event) {
  if (event && event.preventDefault) event.preventDefault();
  const emailEl = document.getElementById('login-email');
  const passEl = document.getElementById('login-password');
  const errorEl = document.getElementById('login-error');

  const email = emailEl?.value?.trim();
  const password = passEl?.value;
  if (!email || !password) {
    if (errorEl) errorEl.textContent = 'Email y password son requeridos';
    return;
  }
  if (errorEl) errorEl.textContent = '';
  setLoginButton('Conectando...', true);

  // Safety timeout: si en 15s no se completo el flujo (no se llamo hideLogin),
  // restauramos el boton y mostramos un mensaje. Evita el estado "Conectando..." eterno.
  loginHidden = false;
  const safety = setTimeout(() => {
    if (loginHidden) return;
    console.warn('⏰ Safety timeout: login no completo en 15s');
    if (errorEl) errorEl.textContent = 'Sin respuesta del servidor. Revisa tu conexion y reintenta. Abre DevTools (F12) para detalles.';
    setLoginButton('Entrar', false);
  }, 15000);

  try {
    console.log('🔐 signIn iniciado para', email);
    await signIn(email, password);
    console.log('✓ signIn OK — esperando listener para cargar tenant');
    // Cambiamos el texto para que el usuario sepa que ya pasamos auth y estamos cargando datos
    setLoginButton('Cargando datos...', true);
    // El onAuthStateChange handler se encarga de cargar tenant info y ocultar login.
    // El safety timeout arriba garantiza que no se queda mudo si algo falla.
  } catch (e) {
    console.error('login error', e);
    clearTimeout(safety);
    if (errorEl) errorEl.textContent = e.message || 'Error de login';
    setLoginButton('Entrar', false);
  }
}

export async function handleLogout() {
  if (!confirm('Cerrar sesion?')) return;
  try {
    await signOut();
  } catch (e) {
    console.error('logout error', e);
  }
}
