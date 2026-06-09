-- ============================================================================
-- Bloque 9: Aviso de mantenimiento (banner self-serve a nivel tenant)
-- ============================================================================
-- Agrega a `tenants` un flag de mantenimiento + mensaje. El admin lo prende/
-- apaga desde la app y TODOS los miembros lo ven (banner arriba).
--
-- Seguridad: la RLS de tenants ya restringe el UPDATE solo a admin
-- (policy "tenants_update_admin" del bloque 01) y el SELECT a miembros del
-- tenant. Solo falta el GRANT de UPDATE al rol authenticated (hoy solo tiene
-- SELECT) para que el admin pueda escribir el flag vía la app.
--
-- IDEMPOTENTE.
-- ============================================================================

alter table public.tenants
  add column if not exists mantenimiento boolean not null default false;

alter table public.tenants
  add column if not exists mantenimiento_msg text not null default '';

-- Permitir UPDATE al rol authenticated (la RLS "tenants_update_admin" lo limita
-- a que solo el admin del tenant pueda hacerlo).
grant update on public.tenants to authenticated;

-- ---------- Verificación -----------------------------------------------------
-- select nombre, mantenimiento, mantenimiento_msg from public.tenants where slug = 'dehur';
