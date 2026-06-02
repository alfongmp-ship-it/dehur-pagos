-- ============================================================================
-- Etapa B — Bloque 8: tabla `pendientes_confirmacion` (espejo del Sheet)
-- ============================================================================
-- Pagos generados pero aún SIN confirmar. Es transitoria (se vacía al confirmar
-- la cola), pero se persiste para no perderla al recargar. Se migra para que en
-- Fase 2 (lectura desde Supabase) siga sobreviviendo a un reload, igual que hoy.
--
-- id como TEXT (puede venir de Date.now()+random). El reparto planificado va en
-- `asignaciones_planificadas` (jsonb con forma {a:[...], m:metodo}).
--
-- IDEMPOTENTE.
-- ============================================================================

create table if not exists public.pendientes_confirmacion (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  id text not null,
  proveedor_id text not null default '',
  factura_id text not null default '',
  nombre text not null default '',
  cuenta text not null default '',
  banco text not null default '',
  tipo text not null default '',
  concepto text not null default '',
  importe numeric not null default 0,
  proyecto text not null default '',
  partida text not null default '',
  cuenta_cargo text not null default '',
  fecha_gen text not null default '',
  confirmado boolean not null default true,
  sub_partida text not null default '',
  asignaciones_planificadas jsonb not null default '{"a":[],"m":null}'::jsonb,
  partida_obra text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

-- ---------- RLS + GRANTs + trigger updated_at --------------------------------
do $$
declare
  t text := 'pendientes_confirmacion';
begin
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
end$$;
