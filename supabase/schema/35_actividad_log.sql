-- ============================================================================
-- 35_actividad_log.sql — Registro de ACTIVIDAD del equipo (dashboard solo-admin)
-- ============================================================================
-- Qué hace: cada INSERT / UPDATE / DELETE en las tablas de captura queda
-- registrado con QUIÉN (email + rol del JWT), QUÉ tabla/fila y CUÁNDO — escrito
-- por TRIGGERS del servidor (imposible de falsear u omitir desde el navegador).
-- La página "📈 Actividad del equipo" (solo admin) lo consulta bajo demanda.
--
-- Candados:
--   · Nadie puede ESCRIBIR el log vía API (sin policy de insert; el trigger es
--     SECURITY DEFINER y se salta RLS).
--   · Solo el ADMIN puede LEERLO/DEPURARLO (policies con is_admin()).
--   · Escrituras sin sesión (SQL Editor, migraciones) NO ensucian el log.
--   · Updates "fantasma" (re-guardar sin cambios, típico del upsert de la app)
--     NO se registran.
--   · Borrados MASIVOS (espejos de tabla) = 1 sola fila con n_filas.
--
-- IDEMPOTENTE: se puede correr dos veces sin romper nada.
-- ⚠️ Se corre A MANO en el SQL Editor de Supabase. El log arranca VACÍO:
--    registra actividad desde el momento en que se corre.
-- ============================================================================

-- ---------- 1. Tabla ----------
create table if not exists public.actividad_log (
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  log_id      bigint      generated always as identity primary key,
  ocurrido_en timestamptz not null default now(),
  user_id     uuid,
  email       text        not null default '',
  rol         text        not null default '',
  tabla       text        not null,
  operacion   text        not null,          -- INSERT | UPDATE | DELETE
  fila_id     text        not null default '',
  n_filas     integer     not null default 1 -- >1 solo en borrados masivos
);

create index if not exists idx_actividad_log_tenant_fecha
  on public.actividad_log (tenant_id, ocurrido_en desc);

-- ---------- 2. RLS: leer/depurar SOLO ADMIN; escribir NADIE (solo el trigger) --
alter table public.actividad_log enable row level security;

drop policy if exists "actividad_log_select_admin" on public.actividad_log;
create policy "actividad_log_select_admin" on public.actividad_log for select
  using (tenant_id = public.current_tenant_id() and public.is_admin());

drop policy if exists "actividad_log_delete_admin" on public.actividad_log;
create policy "actividad_log_delete_admin" on public.actividad_log for delete
  using (tenant_id = public.current_tenant_id() and public.is_admin());

-- Sin policy de INSERT/UPDATE y sin esos grants → el API no puede escribir el log.
grant select, delete on public.actividad_log to authenticated;

-- ---------- 3. Trigger POR FILA (INSERT y UPDATE) ---------------------------
create or replace function public.fn_actividad_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   jsonb;
  v_uid   uuid := auth.uid();
  v_idcol text := TG_ARGV[0];
begin
  -- Sin sesión (SQL Editor, service_role, migraciones): no registrar.
  if v_uid is null then
    return coalesce(NEW, OLD);
  end if;

  -- Update fantasma (la app re-guarda filas completas sin cambios): no registrar.
  if TG_OP = 'UPDATE'
     and (to_jsonb(NEW) - 'updated_at' - 'created_at') = (to_jsonb(OLD) - 'updated_at' - 'created_at') then
    return NEW;
  end if;

  v_row := to_jsonb(coalesce(NEW, OLD));

  insert into public.actividad_log (tenant_id, user_id, email, rol, tabla, operacion, fila_id)
  values (
    (v_row->>'tenant_id')::uuid,
    v_uid,
    coalesce(auth.jwt() ->> 'email', ''),
    coalesce(public.current_user_role()::text, ''),
    TG_TABLE_NAME,
    TG_OP,
    coalesce(v_row ->> v_idcol, '')
  );
  return coalesce(NEW, OLD);
end;
$$;

-- ---------- 4. Trigger POR SENTENCIA (DELETE) -------------------------------
-- Un espejo de tabla (DELETE masivo) genera UNA fila de log con n_filas, no miles.
create or replace function public.fn_actividad_log_del()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
  v_tid uuid;
  v_fid text;
begin
  if v_uid is null then return null; end if;
  select count(*), min(tenant_id) into v_n, v_tid from filas_borradas;
  if coalesce(v_n, 0) = 0 then return null; end if;
  -- Si fue UNA sola fila, registrar su id de negocio (TG_ARGV[0] = columna id).
  if v_n = 1 then
    execute format('select %I::text from filas_borradas limit 1', TG_ARGV[0]) into v_fid;
  end if;
  insert into public.actividad_log (tenant_id, user_id, email, rol, tabla, operacion, fila_id, n_filas)
  values (
    v_tid, v_uid,
    coalesce(auth.jwt() ->> 'email', ''),
    coalesce(public.current_user_role()::text, ''),
    TG_TABLE_NAME, 'DELETE', coalesce(v_fid, ''), v_n
  );
  return null;
end;
$$;

-- ---------- 5. Alta de los triggers en las tablas de captura ----------------
do $$
declare
  r record;
  tablas jsonb := '{
    "facturas":           "factura_id",
    "factura_pagos":      "factura_pago_id",
    "historial":          "id",
    "traspasos":          "traspaso_id",
    "presupuesto_unidad": "presupuesto_id",
    "costo_asignaciones": "asignacion_id",
    "unidades":           "unidad_id"
  }'::jsonb;
begin
  for r in select key as t, value #>> '{}' as idcol from jsonb_each(tablas) loop
    -- AFTER (no BEFORE): el upsert ON CONFLICT dispararía doble con BEFORE.
    execute format('drop trigger if exists trg_%1$s_actividad on public.%1$I', r.t);
    execute format(
      'create trigger trg_%1$s_actividad after insert or update on public.%1$I
         for each row execute function public.fn_actividad_log(%2$L)', r.t, r.idcol);
    execute format('drop trigger if exists trg_%1$s_actividad_del on public.%1$I', r.t);
    execute format(
      'create trigger trg_%1$s_actividad_del after delete on public.%1$I
         referencing old table as filas_borradas
         for each statement execute function public.fn_actividad_log_del(%2$L)', r.t, r.idcol);
  end loop;
end$$;

-- ---------- 6. RPC de resumen (agrupado en el servidor) ---------------------
-- PostgREST no agrupa y el select crudo topa en 1000 filas; esta función agrega
-- por persona/tabla/operación. El candado is_admin() va DENTRO (es definer).
create or replace function public.actividad_resumen(desde timestamptz)
returns table (user_id uuid, email text, rol text, tabla text, operacion text, n bigint, ultima timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select l.user_id, max(l.email) as email, max(l.rol) as rol, l.tabla, l.operacion,
         sum(l.n_filas)::bigint as n, max(l.ocurrido_en) as ultima
  from public.actividad_log l
  where l.tenant_id = public.current_tenant_id()
    and public.is_admin()
    and l.ocurrido_en >= desde
  group by l.user_id, l.tabla, l.operacion
  order by n desc;
$$;
grant execute on function public.actividad_resumen(timestamptz) to authenticated;

-- ---------- Verificación (correr tras capturar/editar algo con la app) ------
-- select ocurrido_en, email, rol, tabla, operacion, fila_id, n_filas
--   from public.actividad_log order by ocurrido_en desc limit 20;
--
-- Resumen de la última hora:
-- select * from public.actividad_resumen(now() - interval '1 hour');
--
-- Depuración manual (opcional; también hay botón en la página Actividad):
-- delete from public.actividad_log where ocurrido_en < now() - interval '180 days';
