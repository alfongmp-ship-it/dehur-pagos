-- ============================================================================
-- 21_rol_facturas.sql — Rol dedicado 'facturas' (Fase 1 integración de facturas)
-- ============================================================================
-- Un perfil nuevo que captura/edita SOLO facturas y vincula pagos a facturas;
-- no toca el resto de la app (el gating es del lado cliente).
--
--   Facturas — Gonzalo — <CORREO_DE_GONZALO>   (crear su usuario primero)
--
-- ⚠️ CORRER EN DOS PASOS POR SEPARADO. Postgres NO permite usar un valor de enum
--    recién creado en la MISMA transacción:
--      1) Corre PRIMERO el Paso 1 y dale Run.
--      2) LUEGO corre el Paso 2 en otra ejecución.
--
-- ⚠️ Sustituye <CORREO_DE_GONZALO> por el correo real con el que entrará Gonzalo.
--
-- ⚠️ Gonzalo AÚN NO TIENE USUARIO. Créalo primero en Authentication → Users →
--    Add user → Auto Confirm. Mientras no exista, el Paso 2 simplemente lo salta
--    (no da error). Vuelve a correr el Paso 2 cuando ya esté creado.
--
-- Nota: NO se requieren cambios de RLS. Las políticas de las tablas de datos son
--    SOLO por tenant (tenant_id = current_tenant_id()); el control por rol vive en
--    el cliente. Con agregar a Gonzalo a tenant_users basta a nivel servidor.
-- ============================================================================


-- ===== PASO 1 — agregar el valor 'facturas' al enum (idempotente) =====
-- Corre SOLO esto primero. Si ya existe, no hace nada.
alter type app_role add value if not exists 'facturas';


-- ===== PASO 2 — asignar (o crear) la membresía con rol 'facturas', por email =====
-- Corre esto DESPUÉS del Paso 1 (en otra ejecución).
-- INSERT…ON CONFLICT: agrega a Gonzalo al tenant y, si ya estaba, actualiza su rol.
-- Requiere que Gonzalo YA exista en Auth; si no existe aún, lo salta.
insert into public.tenant_users (tenant_id, user_id, role, activo)
select t.id, u.id, v.role::app_role, true
from public.tenants t
cross join (values
  ('compras.gcardona09@gmail.com', 'facturas')
) as v(email, role)
join auth.users u on u.email = v.email
where t.slug = 'dehur'
on conflict (tenant_id, user_id) do update
  set role = excluded.role, activo = true;


-- ===== Verificación (opcional) — corre esto para confirmar el rol =====
-- select u.email, tu.role, tu.activo
--   from public.tenant_users tu
--   join auth.users u on u.id = tu.user_id
--  where tu.role = 'facturas';
