import { state } from '../state.js';
import { GS_CLIENT_ID, GS_SCOPES } from '../config/google-sheets.js';
import { notify } from '../ui/notify.js';
import { gsInitSheets } from './google-sheets.js';
import { cargarDatos } from './google-sync.js';

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
        const fuente = await cargarDatos();
        renderAuthStatus();
        notify('✅ Conectado · datos desde ' + (fuente === 'supabase' ? 'Supabase 🟣' : 'Sheets'));
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
      + '<button class="btn btn-ghost btn-sm" onclick="refrescarDatos()" style="font-size:11px;padding:3px 8px;" title="Recarga los datos más recientes desde Supabase (para ver cambios de otros usuarios)">🔄 Refrescar</button>'
      + '<button class="btn btn-ghost btn-sm" onclick="migrarTodoASupabase()" style="font-size:11px;padding:3px 8px;border-color:#C8A96E;color:#C8A96E;" title="Solo si editaste el Google Sheet a MANO: sube esos cambios a Supabase">🟣 Subir cambios del Sheet</button>'
      + '<button class="btn btn-ghost btn-sm" onclick="gsLogout()" style="font-size:11px;padding:3px 8px;">Desconectar</button>'
      + '</div>';
    if (el) el.innerHTML = html;
    if (el2) el2.innerHTML = html;
    if (actions) actions.innerHTML = ''
      + '<button class="btn btn-ghost" onclick="gsLoadAll()" title="RESPALDO: recarga los datos desde Google Sheets. Úsalo solo para inspeccionar o recuperar; normalmente la app lee de Supabase." style="opacity:.8;">⬇ Cargar desde Sheets (respaldo)</button>';
  } else {
    // Logueado en Supabase pero SIN Google: modo SOLO LECTURA. Ve los datos
    // (desde Supabase), pero para editar/guardar necesita conectar Google.
    const html = '<div style="display:flex;align-items:center;gap:8px;">'
      + '<span style="font-size:11px;color:#C8A96E;background:rgba(200,169,110,.12);padding:3px 8px;border-radius:6px;font-weight:600;">👁 Solo lectura</span>'
      + '<button class="btn btn-primary" onclick="gsLogin()" style="padding:6px 14px;font-size:12px;" title="Conéctate a Google para EDITAR/GUARDAR. Mientras no, solo puedes ver. Al guardar, los cambios se respaldan en Sheets.">🔗 Conectar para editar</button>'
      + '</div>';
    if (el) el.innerHTML = html;
    if (el2) el2.innerHTML = html;
    if (actions) actions.innerHTML = '<p style="color:var(--muted);font-size:13px;">👁 <b>Modo solo lectura.</b> Estás viendo los datos desde Supabase. Para <b>editar o capturar pagos</b>, conecta Google Sheets (los cambios se respaldan ahí al guardar).</p>';
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
        const fuente = await cargarDatos();
        renderAuthStatus();
        notify('✅ Conectado · datos desde ' + (fuente === 'supabase' ? 'Supabase 🟣' : 'Sheets'));
      })();
    }
  }
}
