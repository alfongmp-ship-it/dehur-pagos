-- ============================================================================
-- 47_factura_clase.sql — Clase de costo de cada factura (Directo / Indirecto de obra)
-- ============================================================================
-- Contabilidad separa las facturas en COSTOS DIRECTOS DE OBRA y COSTOS
-- INDIRECTOS DE OBRA. Esta tabla guarda esa clase por factura (y su cuenta
-- contable), cargada en Facturas → "📥 Subir clase de costo" con el reporte de
-- contabilidad tal cual, o marcada a mano en bloque.
--
-- Vive APARTE de `facturas` (como fiscal_marcas): no se agregan columnas a la
-- tabla de facturas, así ningún guardado, realtime ni respaldo de facturas puede
-- borrarla ni pisarla. Una fila por factura: sin fila = "sin clasificar".
--
-- NO cambia ningún dato existente: crea UNA tabla VACÍA, sus permisos y nada más.
-- Leen todos los usuarios de la empresa; escribe SOLO el admin.
--
-- ADITIVO e IDEMPOTENTE (se puede correr dos veces). ⚠️ Se corre A MANO en el
-- SQL Editor de Supabase. (La app avisa "corre el SQL 47" hasta que exista.)
-- ============================================================================

create table if not exists public.factura_clase (
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,
  factura_id      text        not null,
  clase           text        not null check (clase in ('directo', 'indirecto')),
  cuenta_contable text        not null default '',
  fuente          text        not null default '',          -- 'excel' (reporte subido) | 'manual'
  lote            text        not null default '',          -- archivo · hoja de donde vino
  usuario         text        not null default '',
  actualizado     timestamptz not null default now(),
  primary key (tenant_id, factura_id)
);

alter table public.factura_clase enable row level security;

drop policy if exists "factura_clase_select" on public.factura_clase;
create policy "factura_clase_select" on public.factura_clase for select
  using (tenant_id = (select public.current_tenant_id()));

drop policy if exists "factura_clase_insert_admin" on public.factura_clase;
create policy "factura_clase_insert_admin" on public.factura_clase for insert
  with check (tenant_id = (select public.current_tenant_id()) and (select public.is_admin()));

drop policy if exists "factura_clase_update_admin" on public.factura_clase;
create policy "factura_clase_update_admin" on public.factura_clase for update
  using (tenant_id = (select public.current_tenant_id()) and (select public.is_admin()))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.is_admin()));

drop policy if exists "factura_clase_delete_admin" on public.factura_clase;
create policy "factura_clase_delete_admin" on public.factura_clase for delete
  using (tenant_id = (select public.current_tenant_id()) and (select public.is_admin()));

grant select, insert, update, delete on public.factura_clase to authenticated;

-- ---------- Verificación (correr después) ----------
-- Debe existir la tabla (y estar vacía la primera vez):
-- select count(*) from public.factura_clase;
--
-- Después de subir el reporte en la app, cuántas quedaron de cada clase:
-- select clase, count(*) from public.factura_clase group by clase;

-- ---------- DESHACER (solo si se quiere quitar todo lo del SQL 47) ----------
-- Borra la tabla y las clases cargadas. Las facturas NO se tocan.
-- drop table if exists public.factura_clase;
