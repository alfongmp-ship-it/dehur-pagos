-- ============================================================================
-- 20_roles_equipo.sql — Roles del equipo (Etapa 2)
-- ============================================================================
-- 4 perfiles: admin / capturista (escriben) · contabilidad / lector (solo ven).
--
-- ⚠️ CORRER EN DOS PASOS POR SEPARADO. Postgres NO permite usar un valor de enum
--    recién creado en la MISMA transacción, así que:
--      1) Corre PRIMERO el Paso 1 (agrega los valores al enum) y dale Run.
--      2) LUEGO corre el Paso 2 (asigna los roles) en otra ejecución.
-- ============================================================================


-- ===== PASO 1 — agregar los 2 perfiles de solo-lectura al enum (idempotente) =====
-- Corre SOLO esto primero. Si ya existen, no hace nada.
alter type app_role add value if not exists 'contabilidad';
alter type app_role add value if not exists 'lector';


-- ===== PASO 2 — asignar el rol de cada persona por email =====
-- Corre esto DESPUÉS del Paso 1 (en otra ejecución).
-- ✏️ REEMPLAZA los emails de Julio, Contabilidad y Lector por los reales.

-- Admin (Alfonso) — TODO
update public.tenant_users tu
   set role = 'admin'::app_role
  from auth.users u
 where tu.user_id = u.id
   and u.email = 'alfongmp@gmail.com';

-- Capturista (Julio) — captura/edita/borra-de-uno + confirma pagos + actualiza saldos
update public.tenant_users tu
   set role = 'capturista'::app_role
  from auth.users u
 where tu.user_id = u.id
   and u.email = 'EMAIL_DE_JULIO@ejemplo.com';

-- Contabilidad — solo ver (ve toda la app)
update public.tenant_users tu
   set role = 'contabilidad'::app_role
  from auth.users u
 where tu.user_id = u.id
   and u.email = 'EMAIL_DE_CONTABILIDAD@ejemplo.com';

-- Lector — solo ver (ve toda la app)
update public.tenant_users tu
   set role = 'lector'::app_role
  from auth.users u
 where tu.user_id = u.id
   and u.email = 'EMAIL_DEL_LECTOR@ejemplo.com';


-- ===== Verificación (opcional) — corre esto para confirmar los roles =====
-- select u.email, tu.role, tu.activo
--   from public.tenant_users tu
--   join auth.users u on u.id = tu.user_id
--  order by tu.role;
