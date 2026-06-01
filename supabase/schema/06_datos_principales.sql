-- ============================================================================
-- Etapa B — Bloque 6: tablas de datos principales (espejo del Sheet)
-- ============================================================================
-- proyectos, cuentas_propias, empleados, historial.
--
-- Mismo molde multi-tenant que proveedores (05): tenant_id + id propio de la app
-- (NO serial), columnas que calcan los gsSaveX, RLS por tenant y grants a
-- authenticated. Supabase NO recalcula nada (saldos, etc.) — solo guarda.
--
-- IDEMPOTENTE: create if not exists / drop policy if exists. Se puede recorrer
-- varias veces sin romper nada.
-- ============================================================================

-- ---------- proyectos (id de texto: paraiso/entorno/dt...) -------------------
create table if not exists public.proyectos (
  tenant_id         uuid    not null references public.tenants(id) on delete cascade,
  id                text    not null,
  nombre            text    not null default '',
  empresa           text    not null default '',
  cuenta            text    not null default '',
  clabe             text    not null default '',
  color             text    not null default '',
  activo            boolean not null default true,
  saldo             numeric not null default 0,
  ultima_act_saldo  text    not null default '',
  es_concentradora  boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (tenant_id, id)
);

-- ---------- cuentas_propias --------------------------------------------------
create table if not exists public.cuentas_propias (
  tenant_id             uuid    not null references public.tenants(id) on delete cascade,
  cuenta_id             bigint  not null,
  nombre                text    not null default '',
  banco                 text    not null default '',
  clabe                 text    not null default '',
  numero_cuenta         text    not null default '',
  proyecto              text    not null default '',
  tipo                  text    not null default 'General',
  saldo                 numeric not null default 0,
  ultima_actualizacion  text    not null default '',
  activo                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  primary key (tenant_id, cuenta_id)
);

-- ---------- empleados --------------------------------------------------------
create table if not exists public.empleados (
  tenant_id     uuid    not null references public.tenants(id) on delete cascade,
  id            bigint  not null,
  nombre        text    not null default '',
  puesto        text    not null default '',
  empresa       text    not null default '',
  banco         text    not null default '',
  tipo_cuenta   text    not null default '',
  cuenta        text    not null default '',
  clabe         text    not null default '',
  rfc           text    not null default '',
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, id)
);

-- ---------- historial (id de texto, secuencial estable de la app) ------------
create table if not exists public.historial (
  tenant_id      uuid    not null references public.tenants(id) on delete cascade,
  id             text    not null,
  proveedor_id   text    not null default '',
  factura_id     text    not null default '',
  fecha          text    not null default '',
  nombre         text    not null default '',
  banco          text    not null default '',
  tipo           text    not null default '',
  concepto       text    not null default '',
  importe        numeric not null default 0,
  proyecto       text    not null default '',
  cuenta_origen  text    not null default '',
  tipo_registro  text    not null default 'Pago',
  partida        text    not null default '',
  sub_partida    text    not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (tenant_id, id)
);

-- ---------- RLS + GRANTs + trigger updated_at (en loop, sin repetir) ---------
-- Mismo patrón para las 4 tablas: aislar por tenant, permitir CRUD dentro del
-- tenant del usuario, grants a authenticated y trigger de updated_at.
do $$
declare
  t text;
  tablas text[] := array['proyectos', 'cuentas_propias', 'empleados', 'historial'];
begin
  foreach t in array tablas loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "%1$s_select_tenant" on public.%1$I', t);
    execute format('create policy "%1$s_select_tenant" on public.%1$I for select using (tenant_id = public.current_tenant_id())', t);

    execute format('drop policy if exists "%1$s_insert_tenant" on public.%1$I', t);
    execute format('create policy "%1$s_insert_tenant" on public.%1$I for insert with check (tenant_id = public.current_tenant_id())', t);

    execute format('drop policy if exists "%1$s_update_tenant" on public.%1$I', t);
    execute format('create policy "%1$s_update_tenant" on public.%1$I for update using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id())', t);

    execute format('drop policy if exists "%1$s_delete_tenant" on public.%1$I', t);
    execute format('create policy "%1$s_delete_tenant" on public.%1$I for delete using (tenant_id = public.current_tenant_id())', t);

    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
end$$;

-- ---------- Verificación -----------------------------------------------------
-- Tras correr esto y "Migrar TODO a Supabase" desde la app:
--   select 'proyectos' t, count(*) from public.proyectos
--   union all select 'cuentas_propias', count(*) from public.cuentas_propias
--   union all select 'empleados', count(*) from public.empleados
--   union all select 'historial', count(*) from public.historial;
-- Deben coincidir con lo que ves en la app.
