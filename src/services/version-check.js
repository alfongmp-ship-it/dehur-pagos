// ============================================================================
// version-check.js — Aviso de "versión nueva" (para no depender de Ctrl+Shift+R)
// ============================================================================
// Cómo funciona: APP_VERSION viaja DENTRO del código que tienes cargado. El
// archivo /version.json se consulta SALTÁNDOSE la caché (URL única + no-store);
// si su versión difiere de la cargada, significa que se subió algo nuevo y se
// muestra un aviso con botón "Actualizar".
//
// ⚠️ EN CADA DEPLOY: subir el número AQUÍ (APP_VERSION) y en /version.json al
//    MISMO valor, en el mismo commit. (Si solo se sube version.json sin tocar el
//    código, todos verían el aviso; si se igualan, solo lo ven quienes tienen
//    código viejo en caché — que es justo lo deseado.)
//
// Seguro por diseño: NO cambia cómo carga la app; si el fetch falla, no avisa
// (try/catch) y todo sigue igual. Totalmente reversible (quitar import + llamada).
// ============================================================================

export const APP_VERSION = '2026.07.15-171512';

let _avisado = false;

async function hayVersionNueva() {
  try {
    const r = await fetch('./version.json?_=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return false;
    const data = await r.json();
    return !!(data && data.v && data.v !== APP_VERSION);
  } catch {
    return false; // sin red / sin archivo: no molestar
  }
}

function mostrarBanner() {
  if (_avisado || document.getElementById('version-banner')) return;
  _avisado = true;
  const bar = document.createElement('div');
  bar.id = 'version-banner';
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 16px;background:var(--accent,#c8a96e);color:#1a1a1a;font-size:13px;font-weight:600;box-shadow:0 2px 12px rgba(0,0,0,.35);';
  bar.innerHTML =
    '<span>🔄 Hay una versión nueva de la app.</span>' +
    '<button id="vb-update" style="background:#1a1a1a;color:#fff;border:none;border-radius:6px;padding:5px 14px;font-size:12px;font-weight:600;cursor:pointer;">Actualizar</button>' +
    '<button id="vb-later" style="background:transparent;color:#1a1a1a;border:1px solid rgba(0,0,0,.35);border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;">Después</button>';
  document.body.appendChild(bar);
  document.getElementById('vb-update').addEventListener('click', () => location.reload());
  document.getElementById('vb-later').addEventListener('click', () => bar.remove());
}

export function iniciarChequeoVersion() {
  const chequear = async () => { if (await hayVersionNueva()) mostrarBanner(); };
  setTimeout(chequear, 8000);                                   // primer chequeo, sin estorbar el arranque
  setInterval(chequear, 5 * 60 * 1000);                         // cada 5 min
  document.addEventListener('visibilitychange', () => {          // al volver a la pestaña
    if (!document.hidden) chequear();
  });
}
