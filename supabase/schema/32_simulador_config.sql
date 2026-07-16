-- ============================================================================
-- Bloque 32: config del SIMULADOR (Fase 3 · presupuesto de caja)
-- ============================================================================
-- Agrega la clave `simulador.horizonte_meses` a estrategia_config para TODOS los
-- tenants (mismo molde que los seeds del bloque 30).
--
-- OJO: el Presupuesto de caja YA funciona sin correr esto — si la fila falta, el
-- código cae de vuelta a `score.horizonte_meses` (6). Correr este bloque solo sirve
-- para poder editar el horizonte del PRESUPUESTO por separado del score (p. ej.
-- proyectar a 12 meses sin alargar el horizonte del ahorro de intereses del score),
-- desde la pestaña Configuración (grupo Dirección).
--
-- Requisito previo: bloque 30 (crea estrategia_config). IDEMPOTENTE: se puede correr
-- las veces que quieras (on conflict do nothing).
-- ============================================================================
insert into public.estrategia_config (tenant_id, clave, valor, descripcion, grupo)
select t.id, s.clave, s.valor::jsonb, s.descripcion, s.grupo
from public.tenants t
cross join (values
  ('simulador.horizonte_meses', '6', 'Meses que proyecta el presupuesto de caja (Fase 3)', 'direccion')
) as s(clave, valor, descripcion, grupo)
on conflict (tenant_id, clave) do nothing;

-- ---------- Verificación -----------------------------------------------------
--   select valor from public.estrategia_config where clave = 'simulador.horizonte_meses';
--   (esperado: 6 — o el valor que edites luego en Configuración)
