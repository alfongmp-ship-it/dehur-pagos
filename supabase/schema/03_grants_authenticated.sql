-- ============================================================================
-- Fase 0 / Etapa A — Bloque 3: GRANT permisos al rol authenticated
-- ============================================================================
-- Sin esto, los usuarios logueados reciben 403 al hacer queries — la RLS no
-- alcanza si el GRANT base no existe.
--
-- Esto sucede porque al crear el proyecto desactivamos "Automatically expose
-- new tables" (correcto para seguridad). Ahora tenemos que GRANT cada tabla
-- a mano. Es buena practica: zero-trust por default.
--
-- IDEMPOTENTE: GRANT puede correrse multiples veces sin problema.
-- ============================================================================

-- ---------- Permisos en las tablas multi-tenant base ------------------------
grant usage on schema public to authenticated, anon;

grant select on public.tenants to authenticated;
grant select, insert, update, delete on public.tenant_users to authenticated;

-- ---------- Permisos para ejecutar las funciones helper de RLS --------------
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------- Verificacion -----------------------------------------------------
-- Despues de correr esto, vuelve al app y reintenta el login.
-- Si sigue dando 403, corre esta consulta de debug:
--
--   select grantee, table_name, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public'
--     and table_name in ('tenants', 'tenant_users');
--
-- Debes ver al menos: authenticated | tenant_users | SELECT
--                     authenticated | tenants      | SELECT
