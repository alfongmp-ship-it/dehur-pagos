-- ============================================================================
-- Fase 0 / Etapa A — Bloque 1: Cimientos multi-tenant
-- ============================================================================
-- Crea: tenants, tenant_users, enum de roles, funciones helper para RLS,
--       y registra a Dehur como tenant inicial.
--
-- IDEMPOTENTE: puede correrse varias veces sin romper nada.
-- ============================================================================

-- ---------- 1. Extensiones necesarias ----------------------------------------
create extension if not exists "uuid-ossp";

-- ---------- 2. Enum de roles ------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type app_role as enum (
      'admin',        -- Acceso total: ve y modifica todo, gestiona usuarios
      'aprobador',    -- Ve todo, confirma pagos, NO captura ni elimina
      'capturista',   -- Captura datos, NO confirma pagos ni elimina
      'solo_lectura'  -- Solo ve, sin botones de accion
    );
  end if;
end$$;

-- ---------- 3. Tabla tenants -------------------------------------------------
-- Una fila por empresa. Hoy solo "Dehur"; manana cada cliente nuevo.
create table if not exists public.tenants (
  id           uuid primary key default uuid_generate_v4(),
  nombre       text not null unique,
  slug         text not null unique,
  activo       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.tenants is
  'Multi-tenant root: una fila por empresa cliente. Toda tabla de datos referencia tenant_id.';

-- ---------- 4. Tabla tenant_users -------------------------------------------
-- Relaciona usuarios de auth.users con tenants y les asigna un rol.
-- Un usuario puede estar en VARIOS tenants (futuro SaaS: un consultor que ve
-- varias constructoras). Por ahora basta con 1:1.
create table if not exists public.tenant_users (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         app_role not null default 'capturista',
  activo       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index if not exists idx_tenant_users_user on public.tenant_users(user_id);
create index if not exists idx_tenant_users_tenant on public.tenant_users(tenant_id);

comment on table public.tenant_users is
  'Membership: que usuario pertenece a que tenant con que rol. Un usuario puede estar en varios tenants.';

-- ---------- 5. Funciones helper para usar dentro de policies RLS -------------

-- Devuelve el tenant_id "activo" del usuario que ejecuta la query.
-- Si el usuario solo pertenece a un tenant, devuelve ese.
-- (Futuro: si pertenece a varios, se podra setear uno como activo via JWT claim.)
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tu.tenant_id
  from public.tenant_users tu
  where tu.user_id = auth.uid()
    and tu.activo = true
  limit 1;
$$;

comment on function public.current_tenant_id() is
  'Tenant activo del usuario logueado. Usado por RLS para filtrar filas.';

-- Devuelve el rol del usuario en su tenant activo.
create or replace function public.current_user_role()
returns app_role
language sql
stable
security definer
set search_path = public
as $$
  select tu.role
  from public.tenant_users tu
  where tu.user_id = auth.uid()
    and tu.activo = true
  limit 1;
$$;

comment on function public.current_user_role() is
  'Rol del usuario logueado en su tenant activo. Usado por RLS para permitir/denegar operaciones.';

-- Helper: el usuario es admin del tenant?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_user_role() = 'admin', false);
$$;

-- ---------- 6. RLS en tenants y tenant_users --------------------------------
alter table public.tenants enable row level security;
alter table public.tenant_users enable row level security;

-- Solo puedes ver tenants donde eres miembro.
drop policy if exists "tenants_select_member" on public.tenants;
create policy "tenants_select_member"
  on public.tenants
  for select
  using (
    id in (select tenant_id from public.tenant_users where user_id = auth.uid() and activo = true)
  );

-- Solo admins pueden actualizar el tenant.
drop policy if exists "tenants_update_admin" on public.tenants;
create policy "tenants_update_admin"
  on public.tenants
  for update
  using (id = current_tenant_id() and is_admin());

-- Ver miembros: cualquier miembro del tenant los ve.
drop policy if exists "tenant_users_select_same_tenant" on public.tenant_users;
create policy "tenant_users_select_same_tenant"
  on public.tenant_users
  for select
  using (tenant_id = current_tenant_id());

-- Solo admins pueden agregar/quitar/modificar miembros del tenant.
drop policy if exists "tenant_users_insert_admin" on public.tenant_users;
create policy "tenant_users_insert_admin"
  on public.tenant_users
  for insert
  with check (tenant_id = current_tenant_id() and is_admin());

drop policy if exists "tenant_users_update_admin" on public.tenant_users;
create policy "tenant_users_update_admin"
  on public.tenant_users
  for update
  using (tenant_id = current_tenant_id() and is_admin());

drop policy if exists "tenant_users_delete_admin" on public.tenant_users;
create policy "tenant_users_delete_admin"
  on public.tenant_users
  for delete
  using (tenant_id = current_tenant_id() and is_admin());

-- ---------- 7. Trigger para mantener updated_at ------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tenants_updated_at on public.tenants;
create trigger trg_tenants_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

drop trigger if exists trg_tenant_users_updated_at on public.tenant_users;
create trigger trg_tenant_users_updated_at
  before update on public.tenant_users
  for each row execute function public.set_updated_at();

-- ---------- 8. Seed: registrar el tenant "Dehur" -----------------------------
-- IDEMPOTENTE: si ya existe, no inserta.
insert into public.tenants (nombre, slug)
values ('Dehur Territorial', 'dehur')
on conflict (slug) do nothing;

-- ============================================================================
-- DESPUES DE CORRER ESTE SQL:
-- 1. Ve a Authentication → Users en el dashboard de Supabase
-- 2. Click "Add user" → "Create new user" → mete tu email + password
--    (no marques "Auto Confirm User" si quieres probar el flujo de email,
--     pero marca "Auto Confirm" para acelerar Etapa A)
-- 3. Copia el user_id que aparece
-- 4. Corre el SIGUIENTE bloque SQL (02_seed_admin_user.sql) reemplazando
--    el placeholder con tu user_id
-- ============================================================================
