-- ============================================================================
-- 45_rol_conciliacion.sql — Rol 'conciliacion' (Diana, contabilidad)
-- ============================================================================
-- Perfil: CONCILIA pagos con facturas. Liga/desliga pagos↔facturas y captura o
-- corrige facturas; NO borra facturas, NO captura pagos, NO reparte costos a
-- casas y NO ve el resto de la app (menú acotado a 4 páginas: Historial de
-- Pagos, Facturas, Pagos a Facturas y Costos por Unidad — esta última solo
-- para consultar).
--
-- ⚠️ SE CORRE A MANO en el SQL Editor de Supabase y en DOS PASOS SEPARADOS:
-- Postgres NO permite usar un valor de enum recién creado en la misma
-- transacción (patrón de 21_rol_facturas.sql / 33_rol_facturas_obra.sql).
--
-- ANTES del paso 2: crear a Diana en Authentication → Users (si no existe, el
-- insert no falla pero tampoco agrega nada).
--
-- NO toca RLS: las políticas de Supabase son por tenant_id; el control por rol
-- vive en el cliente (suficiente para equipo de confianza, no es blindaje).
-- ============================================================================

-- ---------- PASO 1: agregar el valor al enum (correr SOLO esto) -------------
alter type public.app_role add value if not exists 'conciliacion';


-- ---------- PASO 2: asignar el rol (correr DESPUÉS del paso 1) -------------
-- Reemplaza el correo por el de Diana antes de correr.
insert into public.tenant_users (tenant_id, user_id, role, activo)
select t.id, u.id, 'conciliacion', true
  from public.tenants t
  cross join auth.users u
 where lower(u.email) = lower('CORREO_DE_DIANA@ejemplo.com')
on conflict (tenant_id, user_id) do update
  set role = 'conciliacion', activo = true;

-- ---------- Verificación ----------------------------------------------------
-- select u.email, tu.role, tu.activo
--   from public.tenant_users tu join auth.users u on u.id = tu.user_id
--  where tu.role = 'conciliacion';
--
-- Diana debe CERRAR SESIÓN y volver a entrar: el rol se lee al iniciar sesión.
