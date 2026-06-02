-- ============================================================================
-- Etapa B — Bloque 7: resto de tablas de datos (espejo del Sheet)
-- ============================================================================
-- facturas, factura_pagos, traspasos, movimientos_internos, creditos, pagares,
-- pagos_pagare, unidades, presupuesto_unidad, costo_asignaciones,
-- partidas_catalogo, partidas_obra.
--
-- Mismo molde multi-tenant que los bloques 5 y 6. Decisión: los id (propios y de
-- referencia) se guardan como TEXT — la app los compara con String() de todos
-- modos, y así evitamos fallos de inserción por tipos mixtos o vacíos. Dinero
-- como numeric, banderas como boolean, listas/JSON como jsonb. Supabase NO
-- recalcula nada (es espejo).
--
-- IDEMPOTENTE.
-- ============================================================================

create table if not exists public.facturas (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  factura_id text not null,
  numero_factura text not null default '',
  razon_social text not null default '',
  proveedor_id text not null default '',
  nombre_proveedor text not null default '',
  fecha_factura text not null default '',
  fecha_vencimiento text not null default '',
  fecha_pago_total text not null default '',
  monto_total numeric not null default 0,
  monto_pagado numeric not null default 0,
  saldo_pendiente numeric not null default 0,
  estatus_factura text not null default '',
  proyecto text not null default '',
  observaciones text not null default '',
  activo boolean not null default true,
  uuid text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, factura_id)
);

create table if not exists public.factura_pagos (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  factura_pago_id text not null,
  factura_id text not null default '',
  pago_id text not null default '',
  proveedor_id text not null default '',
  monto_aplicado numeric not null default 0,
  fecha_pago text not null default '',
  estatus text not null default '',
  observaciones text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, factura_pago_id)
);

create table if not exists public.traspasos (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  traspaso_id text not null,
  tipo text not null default '',
  cuenta_origen_id text not null default '',
  cuenta_origen_tipo text not null default '',
  cuenta_origen_nombre text not null default '',
  proyecto_origen text not null default '',
  cuenta_destino_id text not null default '',
  cuenta_destino_tipo text not null default '',
  cuenta_destino_nombre text not null default '',
  proyecto_destino text not null default '',
  monto numeric not null default 0,
  fecha text not null default '',
  concepto text not null default '',
  referencia text not null default '',
  estatus text not null default '',
  fecha_registro text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, traspaso_id)
);

create table if not exists public.movimientos_internos (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  id text not null,
  fecha text not null default '',
  tipo text not null default '',
  origen text not null default '',
  destino text not null default '',
  monto numeric not null default 0,
  concepto text not null default '',
  referencia text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

create table if not exists public.creditos (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  credito_id text not null,
  nombre text not null default '',
  banco text not null default '',
  tipo_credito text not null default '',
  monto_autorizado numeric not null default 0,
  tasa_base numeric not null default 0,
  proyecto text not null default '',
  cuenta_pago text not null default '',
  estatus text not null default '',
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, credito_id)
);

create table if not exists public.pagares (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pagare_id text not null,
  credito_id text not null default '',
  numero_pagare text not null default '',
  monto numeric not null default 0,
  fecha_disposicion text not null default '',
  fecha_vencimiento text not null default '',
  tasa numeric not null default 0,
  estatus text not null default '',
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, pagare_id)
);

create table if not exists public.pagos_pagare (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pago_id text not null,
  pagare_id text not null default '',
  credito_id text not null default '',
  fecha_pago text not null default '',
  monto_intereses numeric not null default 0,
  concepto text not null default '',
  estatus text not null default '',
  fecha_real_pago text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, pago_id)
);

create table if not exists public.unidades (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  unidad_id text not null,
  proyecto text not null default '',
  nombre text not null default '',
  tipo text not null default '',
  indiviso_pct numeric not null default 0,
  superficie_m2 numeric not null default 0,
  estatus text not null default '',
  orden numeric not null default 0,
  activo boolean not null default true,
  plano_x numeric,
  plano_y numeric,
  plano_w numeric,
  plano_h numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, unidad_id)
);

create table if not exists public.presupuesto_unidad (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  presupuesto_id text not null,
  unidad_id text not null default '',
  partida text not null default '',
  sub_partida text not null default '',
  monto_presupuestado numeric not null default 0,
  costo_inicial numeric not null default 0,
  notas text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, presupuesto_id)
);

create table if not exists public.costo_asignaciones (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asignacion_id text not null,
  pago_id text not null default '',
  unidad_id text not null default '',
  proyecto text not null default '',
  metodo text not null default '',
  monto_asignado numeric not null default 0,
  factor numeric not null default 0,
  fecha_asignacion text not null default '',
  partida_override text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, asignacion_id)
);

create table if not exists public.partidas_catalogo (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partida_id text not null,
  partida text not null default '',
  subpartidas jsonb not null default '[]'::jsonb,
  orden numeric not null default 0,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, partida_id)
);

create table if not exists public.partidas_obra (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partida_obra_id text not null,
  nombre text not null default '',
  proyecto text not null default '',
  partida_admin text not null default '',
  sub_partida_admin text not null default '',
  orden numeric not null default 0,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, partida_obra_id)
);

-- ---------- RLS + GRANTs + trigger updated_at (en loop, sin repetir) ---------
do $$
declare
  t text;
  tablas text[] := array[
    'facturas', 'factura_pagos', 'traspasos', 'movimientos_internos',
    'creditos', 'pagares', 'pagos_pagare', 'unidades', 'presupuesto_unidad',
    'costo_asignaciones', 'partidas_catalogo', 'partidas_obra'
  ];
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
-- Tras "Migrar a Supabase" desde la app, los conteos deben cuadrar con lo que
-- ves en la app (Facturas, Traspasos, Créditos, etc.).
