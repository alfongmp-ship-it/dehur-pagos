-- ============================================================================
-- 34_control_obra.sql — Base del "Control de Obra" (Fase 1)
-- ============================================================================
-- Objetivo: que cada costo asignado pueda llevar su PARTIDA DE OBRA (el catálogo
-- del residente: "Estructura - Losa planta baja") ADEMÁS de la partida ADMIN
-- (contable), sin perder ninguna de las dos. Hasta hoy `partida_override` tenía
-- doble significado (obra si venía de solicitud, admin si venía de factura);
-- este bloque crea el campo propio y ordena lo existente.
--
-- Incluye también (para las fases siguientes, inertes hasta que se despliegue
-- su código): el % de avance FÍSICO por partida del presupuesto y el realtime
-- de presupuesto_unidad.
--
-- ADITIVO e IDEMPOTENTE (se puede correr dos veces sin romper nada).
-- ⚠️ Se corre A MANO en el SQL Editor de Supabase, ANTES de subir el código.
-- ⚠️ La migración del punto 3 NO toca montos: solo re-etiqueta (ver
--    verificación al final: sum(monto_asignado) debe ser idéntico antes/después).
-- ============================================================================

-- ---------- 1. Partida de OBRA propia en las asignaciones de costo ----------
alter table public.costo_asignaciones add column if not exists partida_obra text not null default '';

-- ---------- 2. Avance FÍSICO por partida del presupuesto (Fase 4) -----------
alter table public.presupuesto_unidad add column if not exists avance_fisico numeric not null default 0;

-- ---------- 3. Migración: solicitudes viejas ya traían partida de OBRA ------
-- Las asignaciones nacidas de SOLICITUDES confirmadas escribieron el NOMBRE DE
-- OBRA (verbatim del catálogo) en partida_override. Se mueven a su campo:
--   partida_obra = nombre de obra, partida/sub_override = el ADMIN del mapeo.
-- SOLO filas de PAGO (factura_id='') — las de factura siempre eligieron admin.
-- 3a) match con la partida de obra ESPECÍFICA del proyecto (prioridad)
update public.costo_asignaciones ca
set partida_obra         = po.nombre,
    partida_override     = po.partida_admin,
    sub_partida_override = po.sub_partida_admin
from public.partidas_obra po
where po.tenant_id = ca.tenant_id
  and ca.factura_id = '' and ca.partida_obra = '' and ca.partida_override <> ''
  and po.proyecto <> '' and lower(trim(po.proyecto)) = lower(trim(ca.proyecto))
  and lower(trim(po.nombre)) = lower(trim(ca.partida_override))
  and po.partida_admin <> '';

-- 3b) match con la partida de obra MAESTRA (proyecto = '') para las restantes
update public.costo_asignaciones ca
set partida_obra         = po.nombre,
    partida_override     = po.partida_admin,
    sub_partida_override = po.sub_partida_admin
from public.partidas_obra po
where po.tenant_id = ca.tenant_id
  and ca.factura_id = '' and ca.partida_obra = '' and ca.partida_override <> ''
  and po.proyecto = ''
  and lower(trim(po.nombre)) = lower(trim(ca.partida_override))
  and po.partida_admin <> '';

-- ---------- 4. Realtime de presupuesto_unidad (Fase 3b) ---------------------
-- Publicación + fila completa en eventos (patrón del bloque 29). Inerte hasta
-- que el código se suscriba; correrlo ahora evita otro SQL después.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'presupuesto_unidad'
  ) then
    execute 'alter publication supabase_realtime add table public.presupuesto_unidad';
  end if;
  execute 'alter table public.presupuesto_unidad replica identity full';
end $$;

-- ---------- Verificación (correr ANTES y DESPUÉS; deben ser idénticos) ------
-- select count(*) as filas, round(sum(monto_asignado)::numeric, 2) as total
--   from public.costo_asignaciones;
--
-- Cuántas asignaciones quedaron etiquetadas con partida de obra (solo informativo):
-- select count(*) from public.costo_asignaciones where partida_obra <> '';
--
-- Realtime activo para presupuesto_unidad:
-- select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and tablename = 'presupuesto_unidad';
