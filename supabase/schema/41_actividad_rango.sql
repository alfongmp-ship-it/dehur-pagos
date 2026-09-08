-- ============================================================================
-- 41_actividad_rango.sql — Actividad del equipo por DÍA específico / RANGO
-- ============================================================================
-- La RPC actividad_resumen(desde) del bloque 35 solo acepta cota inferior:
-- sirve para "última hora / hoy / 7 días" pero no para "el martes pasado" ni
-- "del 1 al 15". Estas dos funciones agregan la cota superior y el desglose
-- POR DÍA (la página 📈 Actividad las usa para el filtro de fechas y para el
-- reporte imprimible por usuario).
--
-- Mismo patrón de seguridad que el 35: SECURITY DEFINER con el candado
-- is_admin() DENTRO del where — a un no-admin le regresan vacío.
-- El día se corta en hora de MÉXICO (America/Mexico_City), no en UTC: un
-- movimiento de las 8pm no debe caer en "mañana".
--
-- ADITIVO e IDEMPOTENTE. ⚠️ Se corre A MANO en el SQL Editor de Supabase.
-- (Sin correrlo, la página avisa y las ventanas clásicas siguen funcionando.)
-- ============================================================================

-- ---------- 1. Resumen del rango (misma forma que actividad_resumen) --------
create or replace function public.actividad_resumen_rango(desde timestamptz, hasta timestamptz)
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
    and l.ocurrido_en < hasta
  group by l.user_id, l.tabla, l.operacion
  order by n desc;
$$;
grant execute on function public.actividad_resumen_rango(timestamptz, timestamptz) to authenticated;

-- ---------- 2. Desglose POR DÍA (para la tabla por día y el reporte) --------
create or replace function public.actividad_por_dia(desde timestamptz, hasta timestamptz)
returns table (dia date, user_id uuid, email text, rol text, tabla text, operacion text, n bigint)
language sql
stable
security definer
set search_path = public
as $$
  select (l.ocurrido_en at time zone 'America/Mexico_City')::date as dia,
         l.user_id, max(l.email) as email, max(l.rol) as rol, l.tabla, l.operacion,
         sum(l.n_filas)::bigint as n
  from public.actividad_log l
  where l.tenant_id = public.current_tenant_id()
    and public.is_admin()
    and l.ocurrido_en >= desde
    and l.ocurrido_en < hasta
  group by 1, l.user_id, l.tabla, l.operacion
  order by 1, n desc;
$$;
grant execute on function public.actividad_por_dia(timestamptz, timestamptz) to authenticated;

-- ---------- Verificación ----------
-- select * from public.actividad_resumen_rango(now() - interval '7 days', now());
-- select * from public.actividad_por_dia(now() - interval '7 days', now());
