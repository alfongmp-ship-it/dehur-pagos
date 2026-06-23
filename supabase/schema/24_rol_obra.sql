-- ============================================================================
-- 24_rol_obra.sql — Rol "obra" (residente de obra, solo-lectura acotado)
-- ============================================================================
-- Perfil para el residente de obra (Gustavo): SOLO VE Costos por Unidad, Facturas y
-- Pagos a Facturas (el resto del menú se le oculta en el cliente). No puede editar nada.
--
--   Obra — Gustavo — CORREO_DE_GUSTAVO@gmail.com   (crear su usuario primero)
--
-- ⚠️ El gating de VISTA es del lado del cliente (RLS sigue siendo por tenant, no por
--    rol). Para alguien de confianza es suficiente; no es blindaje a nivel servidor.
--
-- ⚠️ CORRER EN DOS PASOS POR SEPARADO (como 20_roles_equipo.sql): Postgres NO permite
--    usar un valor de enum recién creado en la MISMA transacción.
--      1) Corre PRIMERO el Paso 1 y dale Run.
--      2) LUEGO corre el Paso 2 en otra ejecución.
--
-- ⚠️ Gustavo debe EXISTIR en Auth primero (que inicie sesión una vez, o créalo en
--    Authentication → Users → Add user → Auto Confirm). Mientras no exista, el Paso 2
--    simplemente lo salta (no da error); vuelve a correrlo cuando ya esté creado.
-- ============================================================================


-- ===== PASO 1 — agregar el rol 'obra' al enum (idempotente) =====
-- Corre SOLO esto primero.
alter type app_role add value if not exists 'obra';


-- ===== PASO 2 — asignar (o crear) la membresía de Gustavo con el rol 'obra' =====
-- Corre esto DESPUÉS del Paso 1 (en otra ejecución). Reemplaza el correo por el real.
insert into public.tenant_users (tenant_id, user_id, role, activo)
select t.id, u.id, v.role::app_role, true
from public.tenants t
cross join (values
  ('CORREO_DE_GUSTAVO@gmail.com', 'obra')
) as v(email, role)
join auth.users u on u.email = v.email
where t.slug = 'dehur'
on conflict (tenant_id, user_id) do update
  set role = excluded.role, activo = true;


-- ===== Verificación (opcional) =====
-- select u.email, tu.role, tu.activo
--   from public.tenant_users tu
--   join auth.users u on u.id = tu.user_id
--  where u.email = 'CORREO_DE_GUSTAVO@gmail.com';
