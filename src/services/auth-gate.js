// Gate de autenticacion: bloquea la app hasta que el usuario este logueado
// con un tenant valido en Supabase.

import { state } from '../state.js';
import { signIn, signOut, fetchCurrentTenantInfo, onAuthStateChange } from './supabase.js';

const APP_SHELL_ID = 'app-shell';
const AUTH_SCREEN_ID = 'auth-screen';

function showLogin(opts = {}) {
  const auth = document.getElementById(AUTH_SCREEN_ID);
  const app = document.getElementById(APP_SHELL_ID);
  if (auth) auth.style.display = 'flex';
  if (app) app.style.display = 'none';
  if (opts.errorMessage) {
    const errorEl = document.getElementById('login-error');
    if (errorEl) errorEl.textContent = opts.errorMessage;
  }
}

function hideLogin() {
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

// Check inicial al cargar la app. Si hay sesion valida + tenant -> muestra app.
// Si no -> muestra login.
export async function initAuthGate(onAuthedCallback) {
  let info;
  try {
    info = await fetchCurrentTenantInfo();
  } catch (e) {
    console.error('initAuthGate error', e);
    showLogin({ errorMessage: 'Error conectando con Supabase: ' + e.message });
    return false;
  }

  if (!info) {
    showLogin();
    return false;
  }
  if (info.orphan) {
    showLogin({ errorMessage: 'Tu usuario no esta asignado a ningun tenant. Contacta al admin.' });
    return false;
  }

  state.session = info;
  hideLogin();
  if (onAuthedCallback) await onAuthedCallback();
  return true;
}

// Listener de cambios de sesion (logout, refresh, etc.)
export function setupAuthListener(onAuthedCallback) {
  onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      state.session = null;
      showLogin();
    } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      const info = await fetchCurrentTenantInfo();
      if (info && !info.orphan) {
        state.session = info;
        hideLogin();
        if (event === 'SIGNED_IN' && onAuthedCallback) await onAuthedCallback();
      } else if (info?.orphan) {
        showLogin({ errorMessage: 'Tu usuario no esta asignado a ningun tenant.' });
      }
    }
  });
}

// Handler del formulario de login (llamado desde el HTML)
export async function handleLoginSubmit(event) {
  if (event && event.preventDefault) event.preventDefault();
  const emailEl = document.getElementById('login-email');
  const passEl = document.getElementById('login-password');
  const errorEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');

  const email = emailEl?.value?.trim();
  const password = passEl?.value;
  if (!email || !password) {
    if (errorEl) errorEl.textContent = 'Email y password son requeridos';
    return;
  }
  if (errorEl) errorEl.textContent = '';
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Conectando...'; }

  try {
    await signIn(email, password);
    // El onAuthStateChange handler se encarga de cargar tenant info y ocultar login.
  } catch (e) {
    console.error('login error', e);
    if (errorEl) errorEl.textContent = e.message || 'Error de login';
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Entrar'; }
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
