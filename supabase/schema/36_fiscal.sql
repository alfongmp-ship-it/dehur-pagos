-- ============================================================================
-- 36_fiscal.sql — Marcas FISCALES (pestaña "🧾 Fiscal" de Costos por Unidad)
-- ============================================================================
-- Soporte de la vista fiscal ESTRICTA (solo lo deducible), separada de la
-- gerencial. Regla híbrida:
--   · El devengado de FACTURAS cuenta solo (CFDI) — salvo factura EXCLUIDA aquí
--     o tipo de comprobante distinto de "Factura" (auto-excluido en el cliente).
--   · Los pagos SIN factura cuentan SOLO si el admin los APRUEBA aquí.
-- Cada marca guarda motivo, quién y cuándo (defendible ante contabilidad).
--
-- SOLO-ADMIN en todo (leer/crear/editar/borrar): la vista fiscal es del dueño.
-- La tabla vive SOLO en Supabase (sin respaldo a Sheets, como costo_asignaciones).
--
-- ADITIVO e IDEMPOTENTE. ⚠️ Se corre A MANO en el SQL Editor de Supabase.
-- (El código tolera que aún no exista: la pestaña avisa hasta que se corra.)
-- ============================================================================

-- ---------- 1. Tabla ----------
create table if not exists public.fiscal_marcas (
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  marca_id      text        not null,
  doc_tipo      text        not null,              -- 'pago' | 'factura'
  doc_id        text        not null,              -- id del pago o de la factura
  incluir       boolean     not null default true, -- pago: true = APROBADO deducible · factura: false = EXCLUIDA
  motivo        text        not null default '',
  usuario_email text        not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, marca_id)
);

create index if not exists idx_fiscal_marcas_doc
  on public.fiscal_marcas (tenant_id, doc_tipo, doc_id);

-- ---------- 2. RLS: TODO solo-admin (patrón 35_actividad_log) ----------------
alter table public.fiscal_marcas enable row level security;

drop policy if exists "fiscal_marcas_select_admin" on public.fiscal_marcas;
create policy "fiscal_marcas_select_admin" on public.fiscal_marcas for select
  using (tenant_id = public.current_tenant_id() and public.is_admin());

drop policy if exists "fiscal_marcas_insert_admin" on public.fiscal_marcas;
create policy "fiscal_marcas_insert_admin" on public.fiscal_marcas for insert
  with check (tenant_id = public.current_tenant_id() and public.is_admin());

drop policy if exists "fiscal_marcas_update_admin" on public.fiscal_marcas;
create policy "fiscal_marcas_update_admin" on public.fiscal_marcas for update
  using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());

drop policy if exists "fiscal_marcas_delete_admin" on public.fiscal_marcas;
create policy "fiscal_marcas_delete_admin" on public.fiscal_marcas for delete
  using (tenant_id = public.current_tenant_id() and public.is_admin());

grant select, insert, update, delete on public.fiscal_marcas to authenticated;

-- updated_at automático (helper del bloque 01)
drop trigger if exists trg_fiscal_marcas_updated_at on public.fiscal_marcas;
create trigger trg_fiscal_marcas_updated_at
  before update on public.fiscal_marcas
  for each row execute function public.set_updated_at();

-- ---------- 3. Auditoría: las marcas quedan en el registro de Actividad ------
-- Reusa las funciones del bloque 35 (correr el 35 ANTES que este bloque).
drop trigger if exists trg_fiscal_marcas_actividad on public.fiscal_marcas;
create trigger trg_fiscal_marcas_actividad
  after insert or update on public.fiscal_marcas
  for each row execute function public.fn_actividad_log('marca_id');

drop trigger if exists trg_fiscal_marcas_actividad_del on public.fiscal_marcas;
create trigger trg_fiscal_marcas_actividad_del
  after delete on public.fiscal_marcas
  referencing old table as filas_borradas
  for each statement execute function public.fn_actividad_log_del('marca_id');

-- ---------- Verificación ----------
-- Tras aprobar/excluir algo desde la pestaña 🧾 Fiscal:
-- select doc_tipo, doc_id, incluir, motivo, usuario_email, created_at
--   from public.fiscal_marcas order by created_at desc limit 20;
--
-- Un rol NO admin no debe ver filas (regresa vacío):
-- (probar con la sesión de un capturista en la app)
