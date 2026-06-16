import { state, rol, puedeEditar } from '../state.js';
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
      + '<button class="btn btn-ghost btn-sm" onclick="gsLogout()" style="font-size:11px;padding:3px 8px;">Desconectar</button>'
      + '</div>';
    if (el) el.innerHTML = html;
    if (el2) el2.innerHTML = html;
    // "Subir cambios del Sheet" se movió aquí (Configuración) para que no se
    // apriete por accidente desde el header.
    if (actions) actions.innerHTML = ''
      + '<button class="btn btn-ghost" onclick="respaldarTodoASheets()" style="border-color:var(--green);color:var(--green);margin-right:8px;" title="Sube TODO el estado actual al Google Sheet (pone el respaldo al día). Como el capturista guarda sin Google, el Sheet se queda atrás; usa esto cada tanto.">💾 Respaldar a Sheets</button>'
      + '<button class="btn btn-ghost" onclick="migrarTodoASupabase()" style="border-color:var(--accent);color:var(--accent);margin-right:8px;" title="Solo si editaste el Google Sheet a MANO: sube esos cambios a Supabase">🟣 Subir cambios del Sheet</button>'
      + '<button class="btn btn-ghost" onclick="gsLoadAll()" title="RESPALDO: recarga los datos desde Google Sheets. Úsalo solo para inspeccionar o recuperar; normalmente la app lee de Supabase." style="opacity:.8;">⬇ Cargar desde Sheets (respaldo)</button>';
  } else {
    // Sin Google conectado: el comportamiento depende del ROL (no de Google).
    // - admin: opera desde Supabase y puede conectar Google para respaldar en Sheets.
    // - capturista: captura DIRECTO a Supabase (no necesita Google).
    // - contabilidad/lector: solo ven.
    const r = rol();
    let badge, info;
    if (r === 'admin') {
      badge = '<span style="font-size:11px;color:var(--accent);background:rgba(138,102,48,.12);padding:3px 8px;border-radius:6px;font-weight:600;">👁 Datos desde Supabase</span>'
        + '<button class="btn btn-primary" onclick="gsLogin()" style="padding:6px 14px;font-size:12px;" title="Conecta Google para respaldar en Sheets y subir cambios manuales del Sheet.">🔗 Conectar Google</button>';
      info = '<p style="color:var(--muted);font-size:13px;">Estás operando desde Supabase. Conecta Google para <b>respaldar en Sheets</b> y subir cambios manuales.</p>';
    } else if (puedeEditar()) {
      badge = '<span style="font-size:11px;color:var(--green);background:rgba(27,119,74,.12);padding:3px 8px;border-radius:6px;font-weight:600;">✍ Captura activa</span>';
      info = '<p style="color:var(--muted);font-size:13px;">Tus cambios se guardan <b>directo en Supabase</b>. El respaldo en Google Sheets lo hace el admin.</p>';
    } else {
      badge = '<span style="font-size:11px;color:var(--muted);background:rgba(0,0,0,.06);padding:3px 8px;border-radius:6px;font-weight:600;">👁 Solo lectura</span>';
      info = '<p style="color:var(--muted);font-size:13px;">Tu perfil es de <b>solo lectura</b>: ves toda la información pero no puedes editar.</p>';
    }
    const html = '<div style="display:flex;align-items:center;gap:8px;">' + badge + '</div>';
    if (el) el.innerHTML = html;
    if (el2) el2.innerHTML = html;
    if (actions) actions.innerHTML = info;
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
