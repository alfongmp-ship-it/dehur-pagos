import { gsLoadAll } from './google-sync.js';
import { state } from '../state.js';

const POLL_INTERVAL_MS = 75_000;
let pollTimer = null;
let inFlight = false;

export function startRealtimePolling() {
  if (pollTimer) return;
  pollTimer = setInterval(tick, POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function onVisibilityChange() {
  if (document.hidden) {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  } else if (!pollTimer && state.gsToken) {
    tick();
    pollTimer = setInterval(tick, POLL_INTERVAL_MS);
  }
}

async function tick() {
  if (inFlight || !state.gsToken) return;
  if (document.querySelector('.modal-overlay.open')) return;
  const ae = document.activeElement;
  if (ae && ['INPUT', 'SELECT', 'TEXTAREA'].includes(ae.tagName)) return;

  inFlight = true;
  setSyncIndicator(true);
  try {
    await gsLoadAll();
    rerenderActive();
  } catch (e) {
    console.warn('realtime poll fallo', e);
  } finally {
    inFlight = false;
    setSyncIndicator(false);
  }
}

function rerenderActive() {
  const active = document.querySelector('.nav-item.active')?.id || '';
  const map = {
    'nav-proveedores': window.renderProveedores,
    'nav-nomina': window.renderNomina,
    'nav-solicitudes': window.renderSolicitudes,
    'nav-dispersion': window.renderCola,
    'nav-confirmar': window.renderConfirmarPagos,
    'nav-historial': window.renderHistorial,
    'nav-facturas': window.renderFacturas,
    'nav-factura-pagos': window.renderFacturaPagos,
    'nav-cuentas-propias': window.renderCuentasPropias,
    'nav-posicion-saldos': window.renderPosicionSaldos,
    'nav-resumen-costos': window.renderResumenCostos,
    'nav-traspasos': window.renderTraspasos,
    'nav-resumen-traspasos': window.renderResumenTraspasos,
    'nav-creditos': window.renderCreditos,
  };
  const fn = map[active];
  if (typeof fn === 'function') fn();
  if (typeof window.renderHeaderBadges === 'function') window.renderHeaderBadges();
}

function setSyncIndicator(active) {
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  el.style.opacity = active ? '1' : '.35';
  el.style.color = active ? 'var(--accent)' : 'var(--muted)';
}
