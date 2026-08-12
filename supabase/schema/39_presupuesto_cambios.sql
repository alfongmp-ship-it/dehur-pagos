-- ============================================================================
-- 39_presupuesto_cambios.sql — Libro de VARIACIONES del presupuesto (inmutable)
-- ============================================================================
-- Cada cambio de monto presupuestado (casa × partida) queda registrado con
-- ANTES → DESPUÉS, el MOTIVO (obligatorio en la app), quién y cuándo. Así nunca
-- se pierde dónde empezó el presupuesto ni el porqué de cada movimiento:
--   original de una fila = su primer registro · actual = presupuesto vigente ·
--   actual − Σ deltas = original (cuadre que la app muestra en las tarjetas).
--
-- INMUTABLE A NIVEL BD: solo hay policies de SELECT e INSERT — nadie (ni el
-- admin desde la app) puede editar ni borrar la historia.
--
-- Sin triggers de actividad (bloque 35): esta tabla ES un registro; no se
-- loguea el log.
--
-- ADITIVO e IDEMPOTENTE. ⚠️ Se corre A MANO en el SQL Editor de Supabase.
-- (El código tolera que no exista: la app avisa "los cambios no se están
--  registrando" hasta que se corra.)
-- ============================================================================

-- ---------- 1. Tabla ----------
create table if not exists public.presupuesto_cambios (
  tenant_id      uuid        not null references public.tenants(id) on delete cascade,
  cambio_id      text        not null,
  presupuesto_id text        not null default '',
  unidad_id      integer     not null default 0,
  partida        text        not null default '',
  sub_partida    text        not null default '',
  monto_anterior numeric     not null default 0,
  monto_nuevo    numeric     not null default 0,
  motivo         text        not null default '',
  usuario_email  text        not null default '',
  origen         text        not null default 'cambio',  -- alta | cambio | baja | plantilla
  created_at     timestamptz not null default now(),
  primary key (tenant_id, cambio_id)
);

create index if not exists idx_presup_cambios_unidad
  on public.presupuesto_cambios (tenant_id, unidad_id, created_at desc);

-- ---------- 2. RLS: leer y AGREGAR por tenant; jamás editar/borrar ----------
alter table public.presupuesto_cambios enable row level security;

drop policy if exists "presup_cambios_select_tenant" on public.presupuesto_cambios;
create policy "presup_cambios_select_tenant" on public.presupuesto_cambios for select
  using (tenant_id = public.current_tenant_id());

drop policy if exists "presup_cambios_insert_tenant" on public.presupuesto_cambios;
create policy "presup_cambios_insert_tenant" on public.presupuesto_cambios for insert
  with check (tenant_id = public.current_tenant_id());

-- SIN policy de UPDATE ni DELETE y sin esos grants → historia inmutable.
grant select, insert on public.presupuesto_cambios to authenticated;

-- ---------- Verificación ----------
-- Tras cambiar un monto en 📋 Presupuestos (la app pide el motivo):
-- select created_at, usuario_email, unidad_id, partida, sub_partida,
--        monto_anterior, monto_nuevo, motivo, origen
--   from public.presupuesto_cambios order by created_at desc limit 20;
