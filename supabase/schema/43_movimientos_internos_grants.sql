-- ============================================================================
-- 43_movimientos_internos_grants.sql — Permisos faltantes de movimientos_internos
-- ============================================================================
-- Incidente 2026-09-10: al completar un préstamo, la bitácora espejo en
-- movimientos_internos rebotaba con "permission denied for table" — a
-- `authenticated` le faltaban privilegios en la base VIVA. El 07_resto.sql de
-- HOY sí los otorga, pero ese archivo creció con el tiempo y la versión corrida
-- en su momento no cubría esta tabla (o no cubría UPDATE, que el guardado por
-- fila necesita: el upsert va como ON CONFLICT DO UPDATE).
--
-- Bloque PUNTUAL solo para esta tabla (no re-corre el 07 completo): RLS +
-- policies por tenant + grants + trigger de updated_at. Los traspasos afectados
-- SÍ se guardaron (y los saldos se ajustaron); solo faltó su renglón de
-- bitácora — se recaptura o reconstruye aparte.
--
-- ADITIVO e IDEMPOTENTE. ⚠️ Se corre A MANO en el SQL Editor de Supabase.
-- ============================================================================

alter table public.movimientos_internos enable row level security;

drop policy if exists "movimientos_internos_select_tenant" on public.movimientos_internos;
create policy "movimientos_internos_select_tenant" on public.movimientos_internos
  for select using (tenant_id = public.current_tenant_id());

drop policy if exists "movimientos_internos_insert_tenant" on public.movimientos_internos;
create policy "movimientos_internos_insert_tenant" on public.movimientos_internos
  for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists "movimientos_internos_update_tenant" on public.movimientos_internos;
create policy "movimientos_internos_update_tenant" on public.movimientos_internos
  for update using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists "movimientos_internos_delete_tenant" on public.movimientos_internos;
create policy "movimientos_internos_delete_tenant" on public.movimientos_internos
  for delete using (tenant_id = public.current_tenant_id());

grant select, insert, update, delete on public.movimientos_internos to authenticated;

drop trigger if exists trg_movimientos_internos_updated_at on public.movimientos_internos;
create trigger trg_movimientos_internos_updated_at
  before update on public.movimientos_internos
  for each row execute function public.set_updated_at();

-- ---------- Verificación ----------
-- 1) Privilegios efectivos:
-- select privilege_type from information_schema.role_table_grants
--  where table_name = 'movimientos_internos' and grantee = 'authenticated';
--    → debe listar SELECT, INSERT, UPDATE, DELETE.
-- 2) En la app: completar un préstamo de prueba → sin toast rojo, y el renglón
--    aparece en Movimientos Internos y sobrevive una recarga.
