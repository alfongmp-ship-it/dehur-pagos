// Gate de autenticacion: bloquea la app hasta que el usuario este logueado
// con un tenant valido en Supabase.

import { state } from '../state.js';
import { signIn, signOut, fetchCurrentTenantInfo, onAuthStateChange } from './supabase.js';

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
  const userBadge = document.getElementById('user-badge');
  if (userBadge && state.session) {
    userBadge.innerHTML = `
      <span style="font-size:11px;color:var(--muted);">Conectado:</span>
      <span style="font-weight:600;">${escapeHtml(state.session.email)}</span>
      <span style="font-size:10px;padding:2px 6px;border-radius:6px;background:rgba(200,169,110,.2);color:#C8A96E;">${escapeHtml(state.session.role || '—')}</span>
      <button class="btn btn-ghost btn-sm" onclick="window.handleLogout()" style="font-size:11px;padding:4px 10px;">Salir</button>
    `;
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

// Check inicial al cargar la app. Si hay sesion valida + tenant -> muestra app.
// Si no -> muestra login.
export async function initAuthGate(onAuthedCallback) {
  console.log('🔐 initAuthGate inicio');
  let info;
  try {
    info = await fetchCurrentTenantInfo();
  } catch (e) {
    console.error('initAuthGate error', e);
    showLogin({ errorMessage: 'Error conectando con Supabase: ' + (e.message || e) });
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
  onAuthStateChange(async (event, session) => {
    console.log('🔔 onAuthStateChange:', event, session ? '(con session)' : '(sin session)');
    if (event === 'SIGNED_OUT' || !session) {
      state.session = null;
      showLogin();
      return;
    }
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
      let info;
      try {
        info = await fetchCurrentTenantInfo();
      } catch (e) {
        console.error('  → fetchCurrentTenantInfo lanzo:', e);
        showLogin({ errorMessage: 'No pude cargar tu tenant: ' + (e.message || e) });
        return;
      }

      if (info && !info.orphan) {
        state.session = info;
        hideLogin();
        if (event === 'SIGNED_IN' && onAuthedCallback) {
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
