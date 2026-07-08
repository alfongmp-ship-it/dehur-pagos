-- ============================================================================
-- Bloque 28: MÓDULO INGRESOS (Fase 1 — cartera pura)
-- ============================================================================
-- Tres tablas nuevas espejo del ciclo de cobro: clientes → ventas por unidad →
-- cobros. Mismo molde multi-tenant que proveedores (05) y datos principales (06):
-- tenant_id + id propio de la app (NO serial), RLS por tenant, grants a
-- authenticated, trigger updated_at. Supabase NO recalcula nada — solo guarda.
--
-- IDs: TEXT con UUID (crypto.randomUUID en la app). Igual que factura_pagos /
-- costo_asignaciones: un contador MAX+1 colisiona entre pestañas y el upsert se
-- pisa; UUID no colisiona.
--
-- IMPORTANTE — separación de Pagos: los cobros NO se insertan en historial ni
-- tocan costo_asignaciones. En Fase 1 el cobro NO afecta saldos de cuentas/
-- proyectos (efecto en saldo DIFERIDO). Las columnas cuenta_destino_* se crean
-- desde ya para no re-ALTERar cuando se habilite ese efecto.
--
-- El tiempo real (agregar a supabase_realtime + replica identity full) va en un
-- bloque APARTE (patrón 19), cuando el módulo esté validado.
--
-- IDEMPOTENTE: create if not exists / drop policy if exists. Se puede correr
-- varias veces sin romper nada.
-- ============================================================================

-- ---------- clientes ---------------------------------------------------------
create table if not exists public.clientes (
  tenant_id      uuid    not null references public.tenants(id) on delete cascade,
  cliente_id     text    not null,                 -- UUID generado por la app
  nombre         text    not null default '',
  rfc            text    not null default '',
  telefono       text    not null default '',
  email          text    not null default '',
  observaciones  text    not null default '',
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (tenant_id, cliente_id)
);

-- ---------- ventas (una fila por unidad vendida) -----------------------------
-- unidad_id / cliente_id / credito_id = refs lógicas (por id) a otras tablas.
-- proyecto se guarda por NOMBRE (como unidades), para filtros. monto_cobrado y
-- saldo_cliente son DERIVADOS: los recalcula la app por re-suma de cobros.
create table if not exists public.ventas (
  tenant_id                 uuid    not null references public.tenants(id) on delete cascade,
  venta_id                  text    not null,      -- UUID generado por la app
  unidad_id                 text    not null default '',   -- ref lógica a unidades
  proyecto                  text    not null default '',   -- nombre del proyecto
  cliente_id                text    not null default '',   -- ref lógica a clientes
  precio_venta              numeric not null default 0,
  tipo_credito              text    not null default '',    -- contado|bancario|infonavit|fovissste|cofinanciado|otro
  estatus_comercial         text    not null default 'apartada',  -- apartada|vendida|escriturada|cancelada
  fecha_apartado            text    not null default '',
  fecha_escritura_estimada  text    not null default '',
  fecha_escritura_real      text    not null default '',
  valor_liberacion          numeric not null default 0,     -- amortiza al crédito puente al escriturar (Fase 2)
  credito_id                text    not null default '',     -- ref lógica opcional a creditos
  monto_cobrado             numeric not null default 0,      -- DERIVADO (re-suma de cobros)
  saldo_cliente             numeric not null default 0,      -- DERIVADO = precio_venta - monto_cobrado
  observaciones             text    not null default '',
  activo                    boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  primary key (tenant_id, venta_id)
);

-- ---------- cobros (dinero recibido) -----------------------------------------
-- fecha = fecha REAL en que entró el dinero (editable). cuenta_destino_* se
-- guardan pero en Fase 1 NO afectan el saldo de esa cuenta (efecto diferido).
create table if not exists public.cobros (
  tenant_id            uuid    not null references public.tenants(id) on delete cascade,
  cobro_id             text    not null,           -- UUID generado por la app
  venta_id             text    not null default '',   -- ref lógica a ventas
  cliente_id           text    not null default '',   -- redundante para filtros
  proyecto             text    not null default '',
  fecha                text    not null default '',
  monto                numeric not null default 0,
  tipo_cobro           text    not null default 'abono',         -- enganche|mensualidad|liquidacion|adeudo|otro
  metodo               text    not null default 'transferencia', -- transferencia|deposito|efectivo|cheque
  cuenta_destino_tipo  text    not null default '',   -- 'proyecto' | 'cuenta'
  cuenta_destino_id    text    not null default '',   -- id del proyecto o cuenta propia
  referencia           text    not null default '',
  concepto             text    not null default '',
  observaciones        text    not null default '',
  activo               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (tenant_id, cobro_id)
);

-- ---------- RLS + GRANTs + trigger updated_at (en loop, sin repetir) ---------
-- Mismo patrón que 06: aislar por tenant, CRUD dentro del tenant del usuario,
-- grants a authenticated y trigger de updated_at. El control fino por rol es en
-- la app; aquí basta con aislar por tenant.
do $$
declare
  t text;
  tablas text[] := array['clientes', 'ventas', 'cobros'];
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
-- 1) Tablas creadas y vacías:
--   select 'clientes' t, count(*) from public.clientes
--   union all select 'ventas', count(*) from public.ventas
--   union all select 'cobros', count(*) from public.cobros;
--
-- 2) Aislamiento multi-tenant (RLS): un insert con OTRO tenant_id NO debe verse
--    desde tu sesión (el select filtra por current_tenant_id()).
