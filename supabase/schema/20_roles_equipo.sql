-- ============================================================================
-- 20_roles_equipo.sql — Roles del equipo (Etapa 2)
-- ============================================================================
-- 4 perfiles: admin / capturista (escriben) · contabilidad / lector (solo ven).
--
--   Admin        — Alfonso        — alfongmp@gmail.com
--   Capturista   — Julio          — encuentra.sistemas@gmail.com
--   Lector       — Hector Vázquez — hvazquezf@gmail.com
--   Lector       — Juan Pablo G.  — juanpablogurria@gmail.com
--   Contabilidad — Ericka Méndez  — erickamdz.dehur@gmail.com  (crear su usuario primero)
--
-- ⚠️ CORRER EN DOS PASOS POR SEPARADO. Postgres NO permite usar un valor de enum
--    recién creado en la MISMA transacción:
--      1) Corre PRIMERO el Paso 1 y dale Run.
--      2) LUEGO corre el Paso 2 en otra ejecución.
--
-- ⚠️ Ericka (erickamdz.dehur@gmail.com) AÚN NO TIENE USUARIO. Créala primero en
--    Authentication → Users → Add user → Auto Confirm. Mientras no exista, el
--    Paso 2 simplemente la salta (no da error). Vuelve a correr el Paso 2 cuando
--    ya esté creada para asignarle 'contabilidad'.
-- ============================================================================


-- ===== PASO 1 — agregar los 2 perfiles de solo-lectura al enum (idempotente) =====
-- Corre SOLO esto primero. Si ya existen, no hace nada.
alter type app_role add value if not exists 'contabilidad';
alter type app_role add value if not exists 'lector';


-- ===== PASO 2 — asignar (o crear) la membresía con su rol, por email =====
-- Corre esto DESPUÉS del Paso 1 (en otra ejecución).
-- INSERT…ON CONFLICT: agrega a quien falte en el tenant y actualiza el rol de
-- quien ya esté. Requiere que la persona YA exista en Auth (haya iniciado sesión
-- o se haya creado en Authentication). A quien no exista aún, lo salta.
insert into public.tenant_users (tenant_id, user_id, role, activo)
select t.id, u.id, v.role::app_role, true
from public.tenants t
cross join (values
  ('alfongmp@gmail.com',          'admin'),
  ('encuentra.sistemas@gmail.com','capturista'),
  ('hvazquezf@gmail.com',         'lector'),
  ('juanpablogurria@gmail.com',   'lector'),
  ('erickamdz.dehur@gmail.com',   'contabilidad')
) as v(email, role)
join auth.users u on u.email = v.email
where t.slug = 'dehur'
on conflict (tenant_id, user_id) do update
  set role = excluded.role, activo = true;


-- ===== Verificación (opcional) — corre esto para confirmar los roles =====
-- select u.email, tu.role, tu.activo
--   from public.tenant_users tu
--   join auth.users u on u.id = tu.user_id
--  order by tu.role, u.email;
