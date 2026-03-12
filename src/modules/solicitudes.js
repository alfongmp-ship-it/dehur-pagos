import { state } from '../state.js';
import { getBanco, getTipo } from '../config/bancos.js';
import { tipoBadge, proyTag } from '../ui/badges.js';
import { fmt } from '../ui/format.js';
import { notify } from '../ui/notify.js';
import { cerrar } from '../ui/modal.js';
import { buscarProveedorSol, normalizar, tokenizar } from '../matching/fuzzy.js';

export function handleSolDrop(e) {
  e.preventDefault();
  const dz = document.getElementById('sol-dropzone');
  dz.style.borderColor = 'var(--border)';
  dz.style.background = 'var(--surface)';
  const f = e.dataTransfer.files[0];
  if (f) handleSolFile(f);
}

export function handleSolFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      parsearSolicitud(wb, file.name);
    } catch (err) { notify('Error leyendo el archivo: ' + err.message, 'error'); }
  };
  reader.readAsArrayBuffer(file);
}

export function descargarPlantilla() {
  notify('La plantilla se descarga desde la app original', 'error');
}

function detectarProyecto(sheetName, obra) {
  const s = (sheetName + '|' + obra).toUpperCase();
  if (s.includes('PARAISO') || s.includes('PARAÍSO')) return 'Privada del Paraíso';
  if (s.includes('ENTORNO')) return 'Entorno';
  if (s.includes('DT') || s.includes('CONCENTRADORA')) return 'Concentradora DT';
  return 'Privada del Paraíso';
}

export function parsearSolicitud(wb, filename) {
  state.solicitudesData = [];
  let obraGlobal = '';

  // Validate it's Dehur standard template
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  const firstRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
  const fila1 = String(firstRows[0]?.[0] || '').toLowerCase();
  const fila4 = firstRows[3] || [];
  const headers4 = fila4.map(h => String(h || '').toLowerCase());
  const esPlantillaDehur = fila1.includes('dehur') &&
    headers4.some(h => h.includes('proveedor') || h.includes('contratista'));
  if (!esPlantillaDehur) {
    notify('⚠ Este archivo no es la Plantilla Estándar Dehur.', 'error');
    return;
  }

  wb.SheetNames.forEach(sheetName => {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    rows.slice(0, 6).forEach(r => {
      const v = String(r[0] || '').trim();
      if (v.toUpperCase().includes('OBRA:')) obraGlobal = v;
    });

    let dataStart = 4;
    rows.forEach((r, i) => {
      const v = String(r[1] || '').toLowerCase();
      if (v.includes('proveedor') || v.includes('contratista')) {
        dataStart = i + 1;
      }
    });

    rows.slice(dataStart).forEach(r => {
      const proveedor = String(r[1] || '').trim();
      if (!proveedor || proveedor.toLowerCase() === 'total' ||
        proveedor.toLowerCase().startsWith('total') ||
        proveedor.toLowerCase().startsWith('solicitud') ||
        proveedor.toLowerCase().startsWith('dehur') ||
        proveedor.toLowerCase().startsWith('obra')) return;

      const partida = String(r[2] || '').trim();
      const clave = String(r[3] || '').trim();
      const factura = String(r[4] || '').trim();
      const oc = String(r[5] || '').trim();
      const importe = parseFloat(String(r[6] || '').replace(/[$,\s]/g, '')) || 0;
      if (!importe || importe < 1) return;

      const proyectoFila = String(r[7] || '').trim();
      if (proyectoFila && !obraGlobal) obraGlobal = proyectoFila;

      const concepto = String(r[8] || '').trim();
      const motivoRaw = (factura ? 'Fac:' + factura + ' ' : '') + concepto;
      const motivo = motivoRaw.substring(0, 40).trim();

      const flag = String(r[7] || '').trim().toUpperCase();
      const esNo = flag === 'NO' || flag === 'N/A' || flag === 'PENDIENTE';

      let cuentaEmbebida = '', bancoEmbebido = '';
      const m18 = concepto.match(/(\d{18})/);
      const mCta = concepto.match(/cta\.?\s*(\d{10,18})/i);
      if (m18) { cuentaEmbebida = m18[1]; bancoEmbebido = getBanco(m18[1]) || 'BBVA'; }
      else if (mCta) { cuentaEmbebida = mCta[1]; bancoEmbebido = 'BBVA'; }
      if (!bancoEmbebido) {
        const conU = concepto.toUpperCase();
        if (conU.includes('BANCOMER') || conU.includes('BBVA')) bancoEmbebido = 'BBVA';
        else if (conU.includes('BANAMEX') || conU.includes('CITIBANAMEX')) bancoEmbebido = 'Banamex';
        else if (conU.includes('BANORTE')) bancoEmbebido = 'Banorte';
        else if (conU.includes('HSBC')) bancoEmbebido = 'HSBC';
        else if (conU.includes('SCOTIABANK')) bancoEmbebido = 'Scotiabank';
      }

      const matchResult = buscarProveedorSol(proveedor, cuentaEmbebida);
      const matchProv = matchResult ? matchResult.prov : null;
      const matchMetodo = matchResult ? matchResult.metodo : null;
      const matchScore = matchResult ? matchResult.score : 0;

      state.solicitudesData.push({
        uid: Date.now() + '-' + Math.random(),
        proveedor, partida, clave, oc, concepto, motivo, importe, flag,
        esNo, proyecto: detectarProyecto(sheetName, obraGlobal),
        semana: sheetName, cuentaEmbebida, bancoEmbebido,
        match: matchProv, matchMetodo, matchScore,
        vinculadoManual: false, seleccionado: !esNo
      });
    });
  });

  if (!state.solicitudesData.length) { notify('No se encontraron filas de pago en el archivo', 'error'); return; }

  document.getElementById('sol-filename').textContent = filename;
  const total = state.solicitudesData.reduce((a, s) => a + s.importe, 0);
  document.getElementById('sol-fileinfo').textContent =
    `${state.solicitudesData.length} partidas · ${wb.SheetNames.join(', ')} · Total: ${fmt(total)}`;
  document.getElementById('sol-dropzone').style.display = 'none';
  document.getElementById('sol-contenido').style.display = '';
  document.getElementById('sol-actions').style.display = 'flex';
  document.getElementById('cnt-sol').textContent = state.solicitudesData.length;

  const partidas = [...new Set(state.solicitudesData.map(s => s.partida).filter(Boolean))].sort();
  const sel = document.getElementById('f-sol-partida');
  sel.innerHTML = '<option value="">Todas las partidas</option>' +
    partidas.map(p => `<option value="${p}">${p}</option>`).join('');

  renderSolicitudes();
  const sinCuenta = state.solicitudesData.filter(s => !s.match && !s.cuentaEmbebida).length;
  notify(`${state.solicitudesData.length} solicitudes cargadas${sinCuenta ? ' · ⚠ ' + sinCuenta + ' sin cuenta' : ''}`);
}

export function renderSolicitudes() {
  if (!state.solicitudesData.length) return;
  const q = (document.getElementById('buscar-sol')?.value || '').toLowerCase();
  const fp = document.getElementById('f-sol-partida')?.value || '';

  const fil = state.solicitudesData.filter(s =>
    (!q || (s.proveedor.toLowerCase().includes(q) || s.concepto.toLowerCase().includes(q) || s.partida.toLowerCase().includes(q) || s.clave.toLowerCase().includes(q))) &&
    (!fp || s.partida === fp)
  );

  let total = 0, selTotal = 0, selCount = 0;
  state.solicitudesData.forEach(s => { total += s.importe; if (s.seleccionado) { selTotal += s.importe; selCount++; } });
  document.getElementById('sol-total').textContent = fmt(total);
  document.getElementById('sol-seleccionado').textContent = fmt(selTotal);
  document.getElementById('sol-subtitle').textContent =
    `${state.solicitudesData.length} solicitudes · ${selCount} seleccionadas · ` +
    [...new Set(state.solicitudesData.map(s => s.proyecto))].join(', ');

  const sinCuenta = state.solicitudesData.filter(s => s.seleccionado && !s.match && !s.cuentaEmbebida);
  document.getElementById('sol-alertas').innerHTML = sinCuenta.length
    ? `<div style="background:rgba(224,90,90,.1);border:1px solid rgba(224,90,90,.3);border-radius:8px;padding:10px 14px;font-size:12px;margin-bottom:4px;">
        ⚠ <b>${sinCuenta.length} proveedor${sinCuenta.length > 1 ? 'es' : ''} sin cuenta:</b>
        ${sinCuenta.map(s => `<span style="font-weight:500">${s.proveedor}</span>`).join(', ')}
      </div>` : '';

  const tb = document.getElementById('tbody-sol');
  if (!fil.length) {
    tb.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--muted);font-size:13px;">Sin resultados</td></tr>`;
    return;
  }

  tb.innerHTML = fil.map(s => {
    const cuenta = s.match ? s.match.cuenta : s.cuentaEmbebida;
    const banco = s.match ? s.match.banco : s.bancoEmbebido;
    const tipo = s.match ? s.match.tipo_cuenta : (cuenta ? getTipo(cuenta) : '');

    let cuentaHtml = '';
    if (cuenta) {
      const tColor = tipo === 'CLABE' ? 'var(--green)' : tipo === 'Cuenta BBVA' ? 'var(--blue)' : 'var(--yellow)';
      cuentaHtml = `<span style="font-family:'DM Mono',monospace;font-size:11px;">${cuenta}</span>
        <div style="font-size:10px;color:var(--muted);margin-top:1px;">
          ${banco || ''} <span style="color:${tColor};font-weight:600;">${tipo}</span>
          ${!s.match && s.cuentaEmbebida ? ' <span style="color:var(--yellow)">(del concepto)</span>' : ''}
        </div>`;
    } else {
      cuentaHtml = `<span style="font-size:11px;color:var(--red);">⚠ Sin cuenta</span>`;
    }

    const metodoLabel = { 'cuenta': 'Cta. coincide', 'exacta': 'Exacto', 'contencion': 'Contenido', 'tokens': 'Por palabras', 'keyword': 'Keyword' }[s.matchMetodo] || '';
    const estadoHtml = s.esNo
      ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:rgba(224,90,90,.15);color:var(--red);">NO</span>`
      : s.match
        ? `<div>
            <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;background:rgba(90,200,90,.12);color:#5cb85c;font-weight:600;">
              ${s.matchMetodo === 'cuenta' ? '🔗' : s.vinculadoManual ? '✎' : '✓'} ${s.vinculadoManual ? 'Vinculado' : metodoLabel || 'BD'}
            </span>
            ${s.matchScore < 80 && !s.vinculadoManual ? `<div style="font-size:9px;color:var(--muted);margin-top:2px;">${s.matchScore}% · <a href="#" onclick="abrirVincular('${s.uid}');return false;" style="color:var(--accent);">cambiar</a></div>` : ''}
          </div>`
        : s.cuentaEmbebida
          ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;background:rgba(90,155,224,.12);color:var(--blue);">Cta.en texto</span>`
          : `<div>
              <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;background:rgba(224,180,90,.12);color:var(--yellow);">⚠ Sin match</span>
              <div style="margin-top:3px;"><a href="#" onclick="abrirVincular('${s.uid}');return false;" style="font-size:10px;color:var(--accent);text-decoration:none;">🔗 Vincular / Agregar</a></div>
            </div>`;

    const rowStyle = s.esNo ? 'opacity:.5' : '';
    return `<tr style="${rowStyle}">
      <td style="padding:8px 6px;"><input type="checkbox" ${s.seleccionado ? 'checked' : ''}
        onchange="toggleSol('${s.uid}',this.checked)" style="width:15px;height:15px;cursor:pointer;accent-color:var(--accent);"></td>
      <td>
        <div style="font-size:12px;font-weight:600;line-height:1.3;">${s.proveedor}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;">${s.proyecto}</div>
      </td>
      <td style="font-size:11px;color:var(--muted);">${s.partida}</td>
      <td style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);">${s.clave}</td>
      <td style="font-size:11px;color:var(--muted);max-width:240px;">
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px;" title="${s.concepto}">${s.concepto}</div>
      </td>
      <td>${cuentaHtml}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;font-size:13px;font-weight:600;color:var(--accent);white-space:nowrap;">${fmt(s.importe)}</td>
      <td style="text-align:center;">${estadoHtml}</td>
    </tr>`;
  }).join('');
}

export function toggleSol(uid, checked) {
  const s = state.solicitudesData.find(x => x.uid === uid);
  if (s) { s.seleccionado = checked; }
  renderSolicitudes();
}

export function seleccionarTodosSol(val) {
  const v = val === true || val === 'true' || val === '1';
  state.solicitudesData.forEach(s => s.seleccionado = v);
  if (document.getElementById('chk-all-sol'))
    document.getElementById('chk-all-sol').checked = v;
  renderSolicitudes();
}

export function nuevaSolicitud() {
  state.solicitudesData = [];
  document.getElementById('sol-dropzone').style.display = '';
  document.getElementById('sol-contenido').style.display = 'none';
  document.getElementById('sol-actions').style.display = 'none';
  if (document.getElementById('sol-file-input'))
    document.getElementById('sol-file-input').value = '';
  document.getElementById('cnt-sol').textContent = '0';
}

// ---- VINCULAR PROVEEDOR ----
export function abrirVincular(uid) {
  state.vincUid = uid;
  const s = state.solicitudesData.find(x => x.uid === uid);
  if (!s) return;
  document.getElementById('vinc-nombre-sol').textContent = s.proveedor;
  document.getElementById('vinc-cuenta-sol').textContent =
    s.cuentaEmbebida ? `Cuenta en concepto: ${s.cuentaEmbebida}` : 'Sin cuenta en concepto';
  document.getElementById('vinc-nuevo-nombre').value = s.proveedor.toUpperCase();
  document.getElementById('vinc-nuevo-cuenta').value = s.cuentaEmbebida || '';
  validarVincCuenta();
  if (s.cuentaEmbebida) {
    const t = getTipo(s.cuentaEmbebida);
    document.getElementById('vinc-nuevo-tipo').value = t;
    renderVincTipo();
  }
  document.getElementById('vinc-buscar').value = '';
  renderVincBusqueda();
  document.getElementById('modal-vincular').classList.add('open');
}

export function renderVincBusqueda() {
  const q = document.getElementById('vinc-buscar').value.toLowerCase();
  const s = state.solicitudesData.find(x => x.uid === state.vincUid);
  let lista = [...state.proveedores];
  if (s) {
    lista.sort((a, b) => {
      const sa = buscarProveedorSol(a.nombre, s.cuentaEmbebida);
      const sb = buscarProveedorSol(b.nombre, s.cuentaEmbebida);
      return (sb?.score || 0) - (sa?.score || 0);
    });
  }
  if (q) lista = lista.filter(p =>
    p.nombre.toLowerCase().includes(q) || (p.cuenta || '').includes(q) || (p.banco || '').toLowerCase().includes(q)
  );
  const div = document.getElementById('vinc-resultados');
  if (!lista.length) {
    div.innerHTML = `<div style="padding:12px;text-align:center;color:var(--muted);font-size:12px;">Sin resultados</div>`;
    return;
  }
  div.innerHTML = lista.slice(0, 30).map(p => {
    const tipColor = p.tipo_cuenta === 'CLABE' ? 'var(--green)' : p.tipo_cuenta === 'Cuenta BBVA' ? 'var(--blue)' : 'var(--yellow)';
    return `<div onclick="seleccionarProvExistente(${p.id})"
      style="padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;transition:background .15s;"
      onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background=''">
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.nombre}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;font-family:'DM Mono',monospace;">${p.cuenta || ''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <span style="font-size:10px;color:${tipColor};font-weight:600;">${p.tipo_cuenta === 'CLABE' ? 'CLABE' : p.tipo_cuenta === 'Cuenta BBVA' ? 'BBVA' : 'Corta'}</span>
        <div style="font-size:10px;color:var(--muted);">${p.banco || ''}</div>
      </div>
    </div>`;
  }).join('');
}

export function seleccionarProvExistente(id) {
  const s = state.solicitudesData.find(x => x.uid === state.vincUid);
  const prov = state.proveedores.find(p => p.id === id);
  if (!s || !prov) return;
  s.match = prov;
  s.vinculadoManual = true;
  s.matchMetodo = 'manual';
  s.matchScore = 100;
  cerrar('modal-vincular');
  renderSolicitudes();
  notify(`Vinculado: ${s.proveedor} → ${prov.nombre}`);
}

export function renderVincTipo() {
  const tipo = document.getElementById('vinc-nuevo-tipo').value;
  const lbl = document.getElementById('vinc-lbl-cuenta');
  const ph = document.getElementById('vinc-nuevo-cuenta');
  if (tipo === 'CLABE') { lbl.textContent = 'CLABE Interbancaria (18 dígitos)'; ph.placeholder = '000000000000000000'; }
  else if (tipo === 'Cuenta BBVA') { lbl.textContent = 'Número de Cuenta BBVA (10 dígitos)'; ph.placeholder = '0000000000'; }
  else { lbl.textContent = 'Cuenta corta'; ph.placeholder = 'Número de cuenta'; }
  validarVincCuenta();
}

export function validarVincCuenta() {
  const tipo = document.getElementById('vinc-nuevo-tipo').value;
  const val = document.getElementById('vinc-nuevo-cuenta').value.trim();
  const st = document.getElementById('vinc-cuenta-status');
  const bancoEl = document.getElementById('vinc-banco');
  if (!val) { bancoEl.value = ''; st.innerHTML = ''; return; }
  if (tipo === 'CLABE') {
    if (val.length === 18) {
      const b = getBanco(val) || 'Banco desconocido';
      bancoEl.value = b;
      st.innerHTML = `<span class="cuenta-ok">✓ CLABE válida · ${b}</span>`;
    } else {
      bancoEl.value = '';
      st.innerHTML = `<span class="cuenta-err">${val.length}/18 dígitos</span>`;
    }
  } else {
    bancoEl.value = 'BBVA';
    st.innerHTML = `<span class="cuenta-ok">✓ BBVA</span>`;
  }
}

export function confirmarNuevoProv() {
  const s = state.solicitudesData.find(x => x.uid === state.vincUid);
  if (!s) return;
  const nombre = document.getElementById('vinc-nuevo-nombre').value.trim().toUpperCase();
  const cuenta = document.getElementById('vinc-nuevo-cuenta').value.trim();
  const tipo = document.getElementById('vinc-nuevo-tipo').value;
  const cat = document.getElementById('vinc-cat').value;
  if (!nombre) { notify('El nombre es obligatorio', 'error'); return; }
  if (!cuenta) { notify('La cuenta es obligatoria', 'error'); return; }
  if (tipo === 'CLABE' && cuenta.length !== 18) { notify('CLABE debe tener 18 dígitos', 'error'); return; }
  const nuevoProv = {
    id: state.nextId++, nombre, cuenta,
    banco: getBanco(cuenta) || 'BBVA', tipo_cuenta: tipo,
    clabe: tipo === 'CLABE' ? cuenta : '', num_cuenta: tipo !== 'CLABE' ? cuenta : '',
    rfc: '', categoria: cat, proyectos: [s.proyecto], activo: true
  };
  state.proveedores.push(nuevoProv);
  document.getElementById('cnt-prov').textContent = state.proveedores.length;
  s.match = nuevoProv;
  s.vinculadoManual = true;
  s.matchMetodo = 'nuevo';
  s.matchScore = 100;
  cerrar('modal-vincular');
  renderSolicitudes();
  notify(`Proveedor agregado y vinculado: ${nombre}`);
}
