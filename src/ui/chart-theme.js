// ============================================================================
// chart-theme.js — colores de las gráficas (Chart.js) según el tema ACTUAL.
//
// Chart.js pinta en <canvas>: NO resuelve var(--...) como el CSS → hay que
// pasarle colores YA resueltos, leídos al momento de crear la gráfica. Antes
// los 7 charts traían hardcodes del tema oscuro (#aaa, rejilla blanca, borde
// de dona #0f0f0f / var(--bg) inválido) → en modo claro salían cifras lavadas
// y bordes negros. Al cambiar el tema, la página visible se re-pinta (hook en
// toggleTheme de index.html); las demás se re-crean al navegar (lazy render).
// ============================================================================
export function chartTheme() {
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  return {
    // Ejes, leyendas y etiquetas
    ticks:      light ? '#665f54' : '#aaa',
    ticksSoft:  light ? '#7a7266' : '#888',
    grid:       light ? 'rgba(60,52,38,.10)' : 'rgba(255,255,255,.05)',
    // Cifras dibujadas sobre puntos/barras (plugin valueLabels)
    valueLabel: light ? '#3a352c' : '#e8e8e8',
    // Separador entre rebanadas de dona = color real del fondo del tema
    donutBorder: light ? '#fffdf9' : '#0f0f0f',
    // Dorado de la marca (línea de tendencia, barras) en el tono del tema
    gold:     light ? '#8a6630' : '#c8a96e',
    goldFill: light ? 'rgba(138,102,48,.12)' : 'rgba(200,169,110,.15)',
    goldSoft: light ? 'rgba(138,102,48,.35)' : 'rgba(200,169,110,.35)'
  };
}
