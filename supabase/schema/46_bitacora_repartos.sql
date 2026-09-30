-- ============================================================================
-- 46_bitacora_repartos.sql — Bitácora INMUTABLE de repartos + lotes de rehacer
-- ============================================================================
-- Para que el reparto de costos a casas sea AUDITABLE SIEMPRE y se pueda
-- rehacer / deshacer (p.ej. "una semana después supe que la casa ya estaba
-- escriturada: le pongo la fecha y rehago sus repartos").
--
--   · reparto_bitacora: CADA cambio a costo_asignaciones (alta, cambio, baja),
--     venga de donde venga (modal, reparto en bloque, importador, 🔧 rehacer,
--     SQL). Guarda el ANTES y el DESPUÉS completos, quién y cuándo. La llena
--     un trigger: la app no puede saltársela. (El registro de Actividad del
--     bloque 35 solo guarda quién/cuándo, no los valores.)
--   · reparto_lotes: una fila por corrida de 🔧 Rehacer / 🧹 Duplicados /
--     ↩️ Restaurar, con el MOTIVO y el detalle necesario para devolver casas
--     (selección original y monto de cada parte).
--
-- Ambas son de SOLO ESCRITURA HACIA ADELANTE: nadie puede editar, borrar ni
-- vaciar (sin políticas UPDATE/DELETE y con triggers que lo rechazan). Única
-- excepción: si algún día se elimina un tenant completo, sus filas se van en
-- cascada con él.
--
-- NO cambia ningún dato existente: crea 2 tablas VACÍAS, 2 funciones, triggers
-- y permisos. NO agrega columnas a costo_asignaciones (el guardado/realtime no
-- cambia). Si algo sale mal se quita con el bloque DESHACER del final.
--
-- ADITIVO e IDEMPOTENTE (se puede correr dos veces). ⚠️ Se corre A MANO en el
-- SQL Editor de Supabase, de preferencia cuando nadie esté guardando repartos
-- (toma un candado de milisegundos sobre costo_asignaciones). Supabase avisará
-- "operación destructiva" por los "drop ... if exists": solo quitan objetos que
-- crea este mismo archivo; no borran datos. (La app avisa "corre el SQL 46"
-- hasta que exista; mientras, 🔧 / 🧹 / ↩️ no aplican nada.)
--
-- PRE-CHEQUEO (primera vez): esto debe devolver null en las dos columnas; si no,
-- ya existe una versión anterior de las tablas → avisar antes de correr:
--   select to_regclass('public.reparto_bitacora'), to_regclass('public.reparto_lotes');
-- ============================================================================

-- ---------- 1. Bitácora de cambios ----------
create table if not exists public.reparto_bitacora (
  tenant_id      uuid        not null references public.tenants(id) on delete cascade,
  bitacora_id    bigint      generated always as identity primary key,
  creado         timestamptz not null default now(),
  usuario        text        not null default '',
  operacion      text        not null,                 -- INSERT | UPDATE | DELETE
  asignacion_id  text        not null default '',
  factura_id     text        not null default '',
  pago_id        text        not null default '',
  unidad_id      text        not null default '',
  antes          jsonb,
  despues        jsonb
);
create index if not exists idx_reparto_bitacora_asig  on public.reparto_bitacora (tenant_id, asignacion_id);
create index if not exists idx_reparto_bitacora_fact  on public.reparto_bitacora (tenant_id, factura_id) where factura_id <> '';
create index if not exists idx_reparto_bitacora_pago  on public.reparto_bitacora (tenant_id, pago_id) where pago_id <> '';
create index if not exists idx_reparto_bitacora_fecha on public.reparto_bitacora (tenant_id, creado desc);

-- ---------- 2. Lotes (corridas de rehacer / duplicados / restaurar) ----------
create table if not exists public.reparto_lotes (
  tenant_id  uuid        not null references public.tenants(id) on delete cascade,
  lote_id    text        not null,
  creado     timestamptz not null default now(),
  usuario    text        not null default '',
  tipo       text        not null default '',          -- rehacer_cierre | quitar_duplicado | restaurar | anulado
  motivo     text        not null default '',
  detalle    jsonb       not null default '{}'::jsonb,
  primary key (tenant_id, lote_id)
);
create index if not exists idx_reparto_lotes_fecha on public.reparto_lotes (tenant_id, creado desc);

-- ---------- 3. Trigger que llena la bitácora ----------
-- security definer: escribe aunque el usuario no tenga permiso directo de INSERT.
-- Usa variables jsonb (seguro en DELETE, donde NEW no existe).
create or replace function public.fn_bitacora_repartos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := null;
  v_new jsonb := null;
  v_row jsonb;
begin
  if TG_OP <> 'INSERT' then v_old := to_jsonb(OLD); end if;
  if TG_OP <> 'DELETE' then v_new := to_jsonb(NEW); end if;

  -- Update fantasma (re-guardado sin cambios): no registrar.
  if TG_OP = 'UPDATE'
     and (v_new - 'updated_at' - 'created_at') = (v_old - 'updated_at' - 'created_at') then
    return NEW;
  end if;

  v_row := coalesce(v_new, v_old);

  -- Tenant que se está eliminando completo (cascada): no hay a quién registrarle.
  if not exists (select 1 from public.tenants t where t.id = (v_row->>'tenant_id')::uuid) then
    return coalesce(NEW, OLD);
  end if;

  insert into public.reparto_bitacora
    (tenant_id, usuario, operacion, asignacion_id, factura_id, pago_id, unidad_id, antes, despues)
  values (
    (v_row->>'tenant_id')::uuid,
    coalesce(auth.jwt() ->> 'email', case when auth.uid() is null then 'sistema/sql' else '' end),
    TG_OP,
    coalesce(v_row->>'asignacion_id', ''),
    coalesce(v_row->>'factura_id', ''),
    coalesce(v_row->>'pago_id', ''),
    coalesce(v_row->>'unidad_id', ''),
    v_old,
    v_new
  );
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_costo_asignaciones_bitacora on public.costo_asignaciones;
create trigger trg_costo_asignaciones_bitacora
  after insert or update or delete on public.costo_asignaciones
  for each row execute function public.fn_bitacora_repartos();

-- Sello del SERVIDOR en cada lote: quién (sesión) y cuándo (now()). La app ordena
-- los lotes por "creado" para saber cuál es el más reciente: no se confía en el cliente.
create or replace function public.fn_reparto_lotes_sello()
returns trigger
language plpgsql
as $$
begin
  NEW.creado := now();
  NEW.usuario := coalesce(nullif(auth.jwt() ->> 'email', ''), NEW.usuario, '');
  return NEW;
end;
$$;

drop trigger if exists trg_reparto_lotes_sello on public.reparto_lotes;
create trigger trg_reparto_lotes_sello
  before insert on public.reparto_lotes
  for each row execute function public.fn_reparto_lotes_sello();

-- ---------- 4. Inmutables: nadie edita, borra ni vacía ----------
-- Única excepción: el borrado EN CASCADA al eliminar un tenant completo (lo
-- ejecuta la llave foránea desde dentro de otro trigger: pg_trigger_depth() > 1).
-- Un DELETE directo (depth = 1) o un TRUNCATE siempre se rechazan.
create or replace function public.fn_bitacora_inmutable()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' and pg_trigger_depth() > 1 then
    return OLD;
  end if;
  raise exception 'La bitácora de repartos es inmutable: no se puede % en %', TG_OP, TG_TABLE_NAME;
end;
$$;

drop trigger if exists trg_reparto_bitacora_inmutable on public.reparto_bitacora;
create trigger trg_reparto_bitacora_inmutable
  before update or delete on public.reparto_bitacora
  for each row execute function public.fn_bitacora_inmutable();

drop trigger if exists trg_reparto_lotes_inmutable on public.reparto_lotes;
create trigger trg_reparto_lotes_inmutable
  before update or delete on public.reparto_lotes
  for each row execute function public.fn_bitacora_inmutable();

drop trigger if exists trg_reparto_bitacora_no_truncate on public.reparto_bitacora;
create trigger trg_reparto_bitacora_no_truncate
  before truncate on public.reparto_bitacora
  for each statement execute function public.fn_bitacora_inmutable();

drop trigger if exists trg_reparto_lotes_no_truncate on public.reparto_lotes;
create trigger trg_reparto_lotes_no_truncate
  before truncate on public.reparto_lotes
  for each statement execute function public.fn_bitacora_inmutable();

-- ---------- 5. RLS: solo el admin del tenant lee; lotes: admin agrega ----------
alter table public.reparto_bitacora enable row level security;
alter table public.reparto_lotes    enable row level security;

drop policy if exists "reparto_bitacora_select_admin" on public.reparto_bitacora;
create policy "reparto_bitacora_select_admin" on public.reparto_bitacora for select
  using (tenant_id = (select public.current_tenant_id()) and (select public.is_admin()));
-- (sin INSERT/UPDATE/DELETE para clientes: solo el trigger escribe)

drop policy if exists "reparto_lotes_select_admin" on public.reparto_lotes;
create policy "reparto_lotes_select_admin" on public.reparto_lotes for select
  using (tenant_id = (select public.current_tenant_id()) and (select public.is_admin()));

drop policy if exists "reparto_lotes_insert_admin" on public.reparto_lotes;
create policy "reparto_lotes_insert_admin" on public.reparto_lotes for insert
  with check (tenant_id = (select public.current_tenant_id()) and (select public.is_admin()));

grant select on public.reparto_bitacora to authenticated;
grant select, insert on public.reparto_lotes to authenticated;

-- ---------- Verificación (correr después) ----------
-- 1) Existen las dos tablas y el trigger:
-- select table_name from information_schema.tables where table_schema = 'public'
--   and table_name in ('reparto_bitacora', 'reparto_lotes');
-- select tgname from pg_trigger where tgname = 'trg_costo_asignaciones_bitacora';
--
-- 2) Después de repartir cualquier factura desde la app, aparece su registro:
-- select creado, usuario, operacion, factura_id, pago_id, unidad_id,
--        antes->>'monto_asignado' as antes, despues->>'monto_asignado' as despues
--   from public.reparto_bitacora order by creado desc limit 20;
--
-- 3) Es inmutable (debe FALLAR con "La bitácora de repartos es inmutable"; funciona
--    aunque la tabla esté vacía, y el rollback protege todo si algo faltara):
-- begin; truncate public.reparto_lotes; rollback;

-- ---------- DESHACER (solo si se quiere quitar TODO lo del SQL 46) ----------
-- Quita el trigger de costo_asignaciones y borra la bitácora y los lotes (se
-- pierde lo que ya se hubiera registrado). Los repartos NO se tocan.
-- Para usarlo: quitar los "-- " de las 6 líneas y correrlas JUNTAS (primero el
-- trigger: borrar solo la tabla sin quitarlo haría fallar los guardados de repartos).
-- drop trigger if exists trg_costo_asignaciones_bitacora on public.costo_asignaciones;
-- drop table if exists public.reparto_bitacora;
-- drop table if exists public.reparto_lotes;
-- drop function if exists public.fn_bitacora_repartos();
-- drop function if exists public.fn_bitacora_inmutable();
-- drop function if exists public.fn_reparto_lotes_sello();
