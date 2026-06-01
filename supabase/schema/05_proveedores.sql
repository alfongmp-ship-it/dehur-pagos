-- ============================================================================
-- Etapa B — Bloque 5: tabla `proveedores` (rebanada de prueba de la migración)
-- ============================================================================
-- Primera tabla de DATOS en Supabase. Es un ESPEJO de la pestaña `proveedores`
-- del Google Sheet: guarda exactamente lo mismo, con los MISMOS IDs que genera
-- la app (no usamos serial/identity de Postgres, porque otras tablas referencian
-- esos IDs).
--
-- Patrón multi-tenant idéntico a tenant_users (01_tenants_and_roles.sql):
-- cada fila lleva tenant_id y la RLS la filtra por el tenant del usuario logueado.
--
-- IDEMPOTENTE: create ... if not exists, drop policy if exists. Se puede correr
-- varias veces sin romper nada.
-- ============================================================================

-- ---------- 1. Tabla ---------------------------------------------------------
create table if not exists public.proveedores (
  tenant_id            uuid    not null references public.tenants(id) on delete cascade,
  id                   bigint  not null,                 -- ID que genera la app (max+1)
  nombre               text    not null default '',
  rfc                  text    not null default '',
  banco                text    not null default '',
  tipo_cuenta          text    not null default '',
  cuenta               text    not null default '',
  clabe                text    not null default '',
  categoria            text    not null default '',
  subcategoria         text    not null default '',
  proyectos            jsonb   not null default '[]'::jsonb,  -- lista de nombres de proyecto
  activo               boolean not null default true,
  bloqueada_para_pago  boolean not null default false,
  aliases              jsonb   not null default '[]'::jsonb,  -- lista de nombres alternativos
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (tenant_id, id)
);

comment on table public.proveedores is
  'Espejo de la pestaña proveedores del Sheet. tenant_id + id (generado por la app) = PK.';

-- ---------- 2. Trigger updated_at -------------------------------------------
-- Reusa public.set_updated_at() definido en 01_tenants_and_roles.sql.
drop trigger if exists trg_proveedores_updated_at on public.proveedores;
create trigger trg_proveedores_updated_at
  before update on public.proveedores
  for each row execute function public.set_updated_at();

-- ---------- 3. RLS -----------------------------------------------------------
alter table public.proveedores enable row level security;

-- Ver: cualquier miembro del tenant.
drop policy if exists "proveedores_select_tenant" on public.proveedores;
create policy "proveedores_select_tenant"
  on public.proveedores
  for select
  using (tenant_id = public.current_tenant_id());

-- Insertar/actualizar/borrar: dentro del tenant activo del usuario.
-- (El control fino por rol se hará en la app; aquí basta con aislar por tenant.)
drop policy if exists "proveedores_insert_tenant" on public.proveedores;
create policy "proveedores_insert_tenant"
  on public.proveedores
  for insert
  with check (tenant_id = public.current_tenant_id());

drop policy if exists "proveedores_update_tenant" on public.proveedores;
create policy "proveedores_update_tenant"
  on public.proveedores
  for update
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists "proveedores_delete_tenant" on public.proveedores;
create policy "proveedores_delete_tenant"
  on public.proveedores
  for delete
  using (tenant_id = public.current_tenant_id());

-- ---------- 4. GRANTs al rol authenticated -----------------------------------
-- Igual que en 03_grants_authenticated.sql: sin esto, 403 de PostgREST.
grant select, insert, update, delete on public.proveedores to authenticated;

-- ---------- 5. Verificación --------------------------------------------------
-- Tras correr esto y "Migrar Proveedores a Supabase" desde la app:
--
--   select count(*) from public.proveedores;
--
-- Debe coincidir con el número de proveedores que ves en la app / en el Sheet.
