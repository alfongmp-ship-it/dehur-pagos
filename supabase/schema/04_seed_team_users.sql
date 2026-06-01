-- ============================================================================
-- Fase 0 / Etapa A — Bloque 4: agrega testers del equipo al tenant Dehur
-- ============================================================================
-- Enlaza a uno o varios compañeros (ya creados en Auth) al tenant "Dehur" con
-- rol 'admin' — "sin bloques todavía". Más adelante se bajan a 'aprobador' o
-- 'capturista' con un UPDATE (ver el final de este archivo).
--
-- ANTES DE CORRER:
-- 1. Crea cada usuario en Authentication → Users → Add user → Create new user.
--    Marca "Auto Confirm User" para que entren sin depender del correo.
-- 2. Reemplaza los emails de abajo por los reales.
-- 3. Corre este SQL en el SQL Editor (pegar todo → Run).
--
-- IDEMPOTENTE: on conflict do update. Resuelve los user_id por email, así que
-- NO hace falta copiar los User UID a mano.
-- ============================================================================

insert into public.tenant_users (tenant_id, user_id, role)
select t.id, u.id, 'admin'::app_role
from public.tenants t
join auth.users u on u.email = any (array[
  'tester1@correo.com',   -- ← reemplaza por el email real
  'tester2@correo.com'    -- ← reemplaza por el email real
])
where t.slug = 'dehur'
on conflict (tenant_id, user_id) do update
  set role = excluded.role,
      activo = true;

-- ---------- Verificación -----------------------------------------------------
-- Deben aparecer 3 filas (tú + 2 testers), todas con activo = true.
select
  tu.role,
  t.nombre as tenant,
  u.email  as usuario,
  tu.activo
from public.tenant_users tu
join public.tenants t   on t.id = tu.tenant_id
join auth.users     u   on u.id = tu.user_id
where t.slug = 'dehur'
order by tu.created_at;

-- ============================================================================
-- MÁS ADELANTE — poner candados bajando el rol de un tester:
--
--   update public.tenant_users tu set role = 'aprobador'  -- o 'capturista'
--   from auth.users u
--   where tu.user_id = u.id and u.email = 'tester1@correo.com';
-- ============================================================================
