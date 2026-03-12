import { state } from '../state.js';
import { getBanco, getTipo } from '../config/bancos.js';

export function normalizar(s) {
  return String(s || '').toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\b(SA|DE|CV|SRL|SC|RL|SL|SAPI|SDC|SPD|MEXICO|MEX|DEL|LOS|LAS|Y|E)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}

export function tokenizar(s) {
  return normalizar(s).split(' ').filter(t => t.length >= 3);
}

export function buscarProveedorSol(nombre, cuentaEmbebida) {
  if (!nombre && !cuentaEmbebida) return null;
  const proveedores = state.proveedores;

  // Strategy 1: Match by embedded account number (highest priority)
  if (cuentaEmbebida) {
    const clean = cuentaEmbebida.replace(/\D/g, '');
    if (clean.length >= 7) {
      for (const p of proveedores) {
        const pc = (p.cuenta || '').replace(/\D/g, '');
        const pk = (p.clabe || '').replace(/\D/g, '');
        const pn = (p.num_cuenta || '').replace(/\D/g, '');
        if ((pc && pc === clean) || (pk && pk === clean) || (pn && pn === clean)) {
          return { prov: p, score: 100, metodo: 'cuenta exacta' };
        }
        // Partial match (last 7 digits)
        if (clean.length >= 7 && pc.length >= 7 && pc.slice(-7) === clean.slice(-7)) {
          return { prov: p, score: 95, metodo: 'cuenta parcial' };
        }
      }
    }
  }

  const nombreNorm = normalizar(nombre);
  if (!nombreNorm) return null;

  // Strategy 1.5: Alias match
  for (const p of proveedores) {
    if (p.aliases && p.aliases.some(a => normalizar(a) === nombreNorm)) {
      return { prov: p, score: 98, metodo: 'alias' };
    }
  }

  // Strategy 2: Exact match
  for (const p of proveedores) {
    if (normalizar(p.nombre) === nombreNorm) {
      return { prov: p, score: 99, metodo: 'exacta' };
    }
  }

  // Strategy 3: Containment
  for (const p of proveedores) {
    const pn = normalizar(p.nombre);
    if (pn.includes(nombreNorm) || nombreNorm.includes(pn)) {
      return { prov: p, score: 90, metodo: 'contención' };
    }
  }

  // Strategy 4: Token-based scoring
  const tokens = tokenizar(nombre);
  if (tokens.length) {
    let best = null, bestScore = 0;
    for (const p of proveedores) {
      const pt = tokenizar(p.nombre);
      if (!pt.length) continue;
      const matching = tokens.filter(t => pt.some(pt2 => pt2.includes(t) || t.includes(pt2))).length;
      const score = (matching / Math.max(tokens.length, pt.length)) * 100;
      if (score > bestScore && score >= 50) {
        bestScore = score;
        best = p;
      }
    }
    if (best) return { prov: best, score: Math.round(bestScore), metodo: 'tokens' };
  }

  // Strategy 5: Long keyword match
  const longTokens = tokenizar(nombre).filter(t => t.length >= 8);
  for (const t of longTokens) {
    for (const p of proveedores) {
      if (normalizar(p.nombre).includes(t)) {
        return { prov: p, score: 60, metodo: 'keyword largo' };
      }
    }
  }

  return null;
}
