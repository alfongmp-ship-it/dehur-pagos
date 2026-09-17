import { state, datosListos } from '../state.js';
import { fmt, escapeHtml } from './format.js';

export function actualizarDisplaySaldo() {
  const el = document.getElementById('disp-saldo-display');
  if (!el) return;
  const sel = document.getElementById('cuenta-disp');
  const proyId = sel ? sel.value : null;
  // Recordar la última cuenta elegida: el select ya no trae default (candado
  // anti "todo se carga a la Concentradora por inercia"), y restaurar la última
  // evita la fricción de elegirla cada sesión.
  if (proyId) { try { localStorage.setItem('dt-cuenta-disp', proyId); } catch (_) { /* ignore */ } }
  const p = proyId ? state.proyectos.find(x => x.id === proyId) : null;
  if (p && p.saldo) {
    el.style.display = '';
    el.innerHTML = `🏦 <span style="color:var(--green);font-weight:700;font-size:15px;">${fmt(p.saldo)}</span><span style="color:var(--muted);font-size:11px;margin-left:6px;">disponible</span>`;
  } else {
    el.style.display = 'none';
  }
}

export function renderHeaderBadges() {
  const hb = document.getElementById('header-badges');
  if (!hb) return;
  if (!datosListos()) { hb.innerHTML = ''; return; }
  // Color semántico del saldo: negativo en ROJO, positivo en verde (antes todo
  // salía verde y un saldo negativo se leía como "bien" de reojo).
  const saldoColor = s => !s ? 'var(--muted)' : (s < 0 ? 'var(--red)' : 'var(--green)');
  const proyBadges = state.proyectos.filter(p => p.activo).map(p =>
    `<span class="badge" style="border-left:3px solid ${p.color};display:flex;align-items:center;gap:8px;padding:6px 12px;">
      <span style="font-size:12px;font-weight:500;">${escapeHtml(p.nombre)}</span>
      <span style="font-family:'DM Mono',monospace;font-size:14px;font-weight:700;color:${saldoColor(p.saldo)};">${p.saldo ? fmt(p.saldo) : '—'}</span>
    </span>`
  ).join('');
  const extraBadges = state.cuentasPropias.filter(c => c.activo !== false).map(c =>
    `<span class="badge" style="border-left:3px solid var(--accent);display:flex;align-items:center;gap:8px;padding:6px 12px;">
      <span style="font-size:12px;font-weight:500;">${escapeHtml(c.nombre)}</span>
      <span style="font-family:'DM Mono',monospace;font-size:14px;font-weight:700;color:${saldoColor(c.saldo)};">${c.saldo ? fmt(c.saldo) : '—'}</span>
    </span>`
  ).join('');
  hb.innerHTML = proyBadges + extraBadges;
}

export function renderCuentaDispSelect() {
  const sel = document.getElementById('cuenta-disp');
  if (!sel) return;
  const cur = sel.value;
  // SIN preselección del primer proyecto: esta cuenta es la CUENTA CARGO de todo
  // el archivo BBVA — un default silencioso mandaba corridas completas a la
  // Concentradora. Se restaura lo elegido antes (DOM o localStorage) si sigue
  // siendo válido; si no, obliga a elegir.
  sel.innerHTML = '<option value="">— Elige la cuenta —</option>' + state.proyectos.filter(p => p.activo).map(p =>
    `<option value="${p.id}">${escapeHtml(p.nombre)} – BBVA ···${p.cuenta.slice(-4)}</option>`
  ).join('');
  let quiere = cur;
  if (!quiere) { try { quiere = localStorage.getItem('dt-cuenta-disp') || ''; } catch (_) { quiere = ''; } }
  sel.value = (quiere && state.proyectos.find(p => p.id === quiere && p.activo)) ? quiere : '';
  actualizarDisplaySaldo();
}

