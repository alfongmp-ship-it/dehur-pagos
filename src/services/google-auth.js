import { state } from '../state.js';
import { GS_CLIENT_ID, GS_SCOPES } from '../config/google-sheets.js';
import { notify } from '../ui/notify.js';
import { gsInitSheets } from './google-sheets.js';
import { gsLoadAll } from './google-sync.js';

export function gsLogin() {
  const redirectUri = window.location.href.split('?')[0].split('#')[0];
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
    + '?client_id=' + encodeURIComponent(GS_CLIENT_ID)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&response_type=token'
    + '&scope=' + encodeURIComponent(GS_SCOPES)
    + '&prompt=select_account';

  const w = 500, h = 600;
  const left = (screen.width / 2) - (w / 2);
  const top = (screen.height / 2) - (h / 2);
  const popup = window.open(authUrl, 'gsauth',
    'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',scrollbars=yes');

  const timer = setInterval(async () => {
    try {
      if (!popup || popup.closed) { clearInterval(timer); return; }
      const url = popup.location.href;
      if (url.includes('access_token=')) {
        clearInterval(timer);
        popup.close();
        const hash = url.split('#')[1] || url.split('?')[1] || '';
        const params = new URLSearchParams(hash);
        state.gsToken = params.get('access_token');
        if (!state.gsToken) { notify('No se obtuvo token', 'error'); return; }
        try {
          const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: 'Bearer ' + state.gsToken }
          });
          state.gsUser = await r.json();
        } catch (e) { /* ignore */ }
        await gsInitSheets();
        await gsLoadAll();
        renderAuthStatus();
        notify('✅ Conectado a Google Sheets');
      }
    } catch (e) { /* cross-origin, still loading */ }
  }, 500);
}

export function gsLogout() {
  if (state.gsToken) {
    try { fetch('https://oauth2.googleapis.com/revoke?token=' + state.gsToken, { method: 'POST' }); } catch (e) { }
  }
  state.gsToken = null;
  state.gsUser = null;
  renderAuthStatus();
  notify('Sesión cerrada');
}

export function renderAuthStatus() {
  const el = document.getElementById('gs-auth-status');
  const el2 = document.getElementById('gs-auth-status-2');
  const actions = document.getElementById('gs-sync-actions');

  if (state.gsToken && state.gsUser) {
    const html = '<div style="display:flex;align-items:center;gap:8px;">'
      + '<div style="width:8px;height:8px;border-radius:50%;background:var(--green);"></div>'
      + '<span style="font-size:12px;color:var(--muted);">✅ ' + (state.gsUser.email || 'Conectado') + '</span>'
      + '<button class="btn btn-ghost btn-sm" onclick="recargarDesdeSheets()" style="font-size:11px;padding:3px 8px;" title="Volver a leer Sheets (sincroniza cambios externos)">🔄 Recargar</button>'
      + '<button class="btn btn-ghost btn-sm" onclick="gsLogout()" style="font-size:11px;padding:3px 8px;">Desconectar</button>'
      + '</div>';
    if (el) el.innerHTML = html;
    if (el2) el2.innerHTML = html;
    if (actions) actions.innerHTML = ''
      + '<button class="btn btn-primary" onclick="gsSaveProveedores()">☁ Subir Proveedores</button>'
      + '<button class="btn btn-primary" onclick="gsSaveEmpleados()">☁ Subir Empleados</button>'
      + '<button class="btn btn-primary" onclick="gsSaveProyectos()">☁ Subir Proyectos</button>'
      + '<button class="btn btn-ghost" onclick="gsLoadAll()">⬇ Cargar desde Sheets</button>'
      + '<button class="btn btn-ghost" onclick="migrarProveedoresASupabase()" title="Recarga de Sheets y espeja proveedores a Supabase (migración inicial o re-sincronizar tras editar el Sheet)" style="border-color:#C8A96E;color:#C8A96E;">🟣 Proveedores → Supabase</button>';
  } else {
    const html = '<button class="btn btn-primary" onclick="gsLogin()" style="padding:8px 20px;font-size:13px;">🔗 Conectar Google Sheets</button>';
    if (el) el.innerHTML = html;
    if (el2) el2.innerHTML = html;
    if (actions) actions.innerHTML = '<p style="color:var(--muted);font-size:13px;">Conecta tu cuenta para sincronizar datos con Google Sheets.</p>';
  }
}

export function checkOAuthCallback() {
  const hash = window.location.hash;
  if (hash && hash.includes('access_token=')) {
    const params = new URLSearchParams(hash.substring(1));
    state.gsToken = params.get('access_token');
    window.location.hash = '';
    if (state.gsToken) {
      (async () => {
        try {
          const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: 'Bearer ' + state.gsToken }
          });
          state.gsUser = await r.json();
        } catch (e) { }
        await gsInitSheets();
        await gsLoadAll();
        renderAuthStatus();
        notify('✅ Conectado a Google Sheets');
      })();
    }
  }
}
