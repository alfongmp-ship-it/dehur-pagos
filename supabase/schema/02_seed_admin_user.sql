-- ============================================================================
-- Fase 0 / Etapa A — Bloque 2: Registra a tu usuario como admin de Dehur
-- ============================================================================
-- ANTES DE CORRER:
-- 1. Crea tu usuario en Authentication → Users (Add user → Create new user)
-- 2. Copia el "User UID" que aparece
-- 3. Reemplaza '<TU_USER_ID>' abajo con ese UID
-- 4. Corre este SQL
-- ============================================================================

insert into public.tenant_users (tenant_id, user_id, role)
select
  t.id,
  '<TU_USER_ID>'::uuid,  -- ← REEMPLAZA con tu user_id real
  'admin'::app_role
from public.tenants t
where t.slug = 'dehur'
on conflict (tenant_id, user_id) do update
  set role = 'admin',
      activo = true;

-- Verificacion:
select
  tu.role,
  t.nombre as tenant,
  u.email as usuario,
  tu.activo
from public.tenant_users tu
join public.tenants t on t.id = tu.tenant_id
join auth.users u on u.id = tu.user_id
where t.slug = 'dehur';
