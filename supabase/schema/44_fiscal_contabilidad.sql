-- ============================================================================
-- 44_fiscal_contabilidad.sql — Abrir la LECTURA de fiscal_marcas a contabilidad
-- ============================================================================
-- La página 🧾 Fiscal (nueva en el menú) la ven el admin Y contabilidad (Ericka).
-- Sin este SQL, a contabilidad la RLS del 36 le regresa VACÍO en fiscal_marcas y
-- la Deducibilidad le mostraría totales sin las marcas (números incompletos).
--
-- SOLO cambia el SELECT. Escribir marcas (insert/update/delete) sigue siendo
-- exclusivo del admin — contabilidad consulta y exporta, no marca.
--
-- ADITIVO e IDEMPOTENTE. ⚠️ Se corre A MANO en el SQL Editor de Supabase.
-- Requiere el 36 corrido antes (crea la tabla y las demás policies).
-- ============================================================================

drop policy if exists "fiscal_marcas_select_admin" on public.fiscal_marcas;
create policy "fiscal_marcas_select_admin" on public.fiscal_marcas for select
  using (
    tenant_id = public.current_tenant_id()
    and (public.is_admin() or public.current_user_role() = 'contabilidad')
  );

-- ---------- Verificación ----------
-- Con la sesión de contabilidad (Ericka) en la app: abrir 🧾 Fiscal → la pestaña
-- Deducibilidad debe mostrar los MISMOS totales que ve el admin (marcas incluidas).
-- Con un capturista: la página ni aparece en su menú y la tabla le regresa vacío:
-- select count(*) from public.fiscal_marcas;
