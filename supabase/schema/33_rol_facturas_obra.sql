-- ============================================================================
-- 33_rol_facturas_obra.sql — Rol "facturas_obra" (captura de facturas acotada)
-- ============================================================================
-- Perfil para quien captura facturas SIN ver el resto de la app:
--
--   Facturas (obra) — Anahi — <CORREO_DE_ANAHI>
--
-- QUÉ PUEDE: crear / editar / BORRAR facturas, ligar pagos a facturas y repartir
--   el costo de la factura a las casas (devengado) — los mismos poderes que el rol
--   'facturas' (Gonzalo).
-- QUÉ VE: SOLO Facturas, Pagos a Facturas y Costos por Unidad (el resto del menú
--   se le oculta, igual que el rol 'obra'), y sin la barra de saldos del header.
-- QUÉ NO PUEDE: capturar/editar pagos del historial, dispersión, confirmar pagos,
--   traspasos, créditos, configuración ni respaldos.
--
-- ⚠️ El gating de VISTA es del lado del cliente (RLS sigue siendo por tenant, no por
--    rol), igual que 'obra' y 'facturas'. Para alguien de confianza es suficiente;
--    no es blindaje a nivel servidor. NO se requieren cambios de RLS.
--
-- ⚠️ CORRER EN DOS PASOS POR SEPARADO (como 21_rol_facturas.sql / 24_rol_obra.sql):
--    Postgres NO permite usar un valor de enum recién creado en la MISMA transacción.
--      1) Corre PRIMERO el Paso 1 y dale Run.
--      2) LUEGO corre el Paso 2 en otra ejecución.
--
-- ⚠️ Anahi debe EXISTIR en Auth primero (Authentication → Users → Add user → Auto
--    Confirm, o que inicie sesión una vez). Mientras no exista, el Paso 2 simplemente
--    la salta (no da error); vuelve a correrlo cuando ya esté creada.
--
-- ⚠️ Sustituye <CORREO_DE_ANAHI> por el correo real con el que entrará.
-- ============================================================================


-- ===== PASO 1 — agregar el valor 'facturas_obra' al enum (idempotente) =====
-- Corre SOLO esto primero. Si ya existe, no hace nada.
alter type app_role add value if not exists 'facturas_obra';


-- ===== PASO 2 — asignar (o crear) la membresía de Anahi, por email =====
-- Corre esto DESPUÉS del Paso 1 (en otra ejecución).
-- INSERT…ON CONFLICT: la agrega al tenant y, si ya estaba, actualiza su rol.
insert into public.tenant_users (tenant_id, user_id, role, activo)
select t.id, u.id, v.role::app_role, true
from public.tenants t
cross join (values
  ('<CORREO_DE_ANAHI>', 'facturas_obra')
) as v(email, role)
join auth.users u on u.email = v.email
where t.slug = 'dehur'
on conflict (tenant_id, user_id) do update
  set role = excluded.role, activo = true;


-- ===== Verificación (opcional) =====
-- select u.email, tu.role, tu.activo
--   from public.tenant_users tu
--   join auth.users u on u.id = tu.user_id
--  where tu.role = 'facturas_obra';
