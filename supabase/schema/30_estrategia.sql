-- ============================================================================
-- Bloque 30: MÓDULO ESTRATEGIA (Fase 2 — tablero de score, solo lectura)
-- ============================================================================
-- Dos tablas nuevas. Mismo molde multi-tenant de siempre (RLS por tenant, grants
-- a authenticated, trigger updated_at, idempotente):
--
--   estrategia_config        → parámetros del motor (clave → valor jsonb).
--                              REGLA: ningún supuesto vive en el código; todos
--                              aquí, editables desde la UI de Configuración.
--   estrategia_flags_unidad  → marcas por unidad: bloqueo (sale del ranking),
--                              compromiso (ancla arriba), estrategica (bono).
--
-- Estrategia NO escribe en ninguna otra tabla (unidades, ventas, cobros,
-- créditos, historial, saldos… solo se LEEN del state).
--
-- Los SEEDS de configuración se insertan para TODOS los tenants existentes con
-- on conflict do nothing (correr de nuevo no pisa valores editados). Para un
-- tenant nuevo, la app usa el default de código (cfg() nunca truena) y el botón
-- "restaurar default" escribe la fila.
--
-- El tiempo real va en un bloque APARTE (31), cuando el módulo esté validado.
-- IDEMPOTENTE: se puede correr varias veces sin romper nada.
-- ============================================================================

-- ---------- estrategia_config ------------------------------------------------
create table if not exists public.estrategia_config (
  tenant_id    uuid    not null references public.tenants(id) on delete cascade,
  clave        text    not null,               -- ej. 'prob_cobro.vendida'
  valor        jsonb   not null,               -- número, booleano, string o lista
  descripcion  text    not null default '',    -- qué controla, en lenguaje del negocio
  grupo        text    not null default 'general',  -- ventas | obra | tesoreria | direccion
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, clave)
);

-- ---------- estrategia_flags_unidad -------------------------------------------
create table if not exists public.estrategia_flags_unidad (
  tenant_id         uuid    not null references public.tenants(id) on delete cascade,
  flag_id           text    not null,              -- UUID generado por la app
  unidad_id         text    not null default '',   -- ref lógica a unidades
  proyecto          text    not null default '',
  tipo              text    not null default 'bloqueo',  -- bloqueo | compromiso | estrategica
  categoria         text    not null default '',   -- bloqueo: tecnico|cliente|permiso|proveedor|otro
  fecha_compromiso  text    not null default '',   -- compromiso: fecha pactada de entrega
  nota              text    not null default '',
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (tenant_id, flag_id)
);

-- ---------- RLS + GRANTs + trigger updated_at (mismo patrón que 06/28) --------
do $$
declare
  t text;
  tablas text[] := array['estrategia_config', 'estrategia_flags_unidad'];
begin
  foreach t in array tablas loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "%1$s_select_tenant" on public.%1$I', t);
    execute format('create policy "%1$s_select_tenant" on public.%1$I for select using (tenant_id = public.current_tenant_id())', t);

    execute format('drop policy if exists "%1$s_insert_tenant" on public.%1$I', t);
    execute format('create policy "%1$s_insert_tenant" on public.%1$I for insert with check (tenant_id = public.current_tenant_id())', t);

    execute format('drop policy if exists "%1$s_update_tenant" on public.%1$I', t);
    execute format('create policy "%1$s_update_tenant" on public.%1$I for update using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id())', t);

    execute format('drop policy if exists "%1$s_delete_tenant" on public.%1$I', t);
    execute format('create policy "%1$s_delete_tenant" on public.%1$I for delete using (tenant_id = public.current_tenant_id())', t);

    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
end$$;

-- ---------- SEEDS de configuración (para todos los tenants existentes) --------
-- Valores por defecto de calibración (estándares de industria); el cuestionario
-- real los afina EDITÁNDOLOS en la UI, jamás cambiando código.
insert into public.estrategia_config (tenant_id, clave, valor, descripcion, grupo)
select t.id, s.clave, s.valor::jsonb, s.descripcion, s.grupo
from public.tenants t
cross join (values
  -- VENTAS: probabilidad de cobro por situación comercial
  ('prob_cobro.escriturada', '0.99', 'Probabilidad de cobrar una unidad escriturada por cobrar', 'ventas'),
  ('prob_cobro.vendida',     '0.95', 'Probabilidad de cobrar una venta con crédito autorizado', 'ventas'),
  ('prob_cobro.apartada',    '0.65', 'Probabilidad de cobrar una apartada con crédito en trámite', 'ventas'),
  ('prob_cobro.disponible',  '0.35', 'Probabilidad de vender y cobrar una unidad sin cliente dentro del horizonte', 'ventas'),
  ('prob_cobro.adeudo',      '0.90', 'Probabilidad de cobrar adeudos de clientes en plan de pagos al escriturar', 'ventas'),
  -- VENTAS: meses de trámite tras terminar la obra, por situación
  ('lag_cobro.escriturada',  '0.5', 'Meses de trámite de cobro tras terminar obra (escriturada)', 'ventas'),
  ('lag_cobro.vendida',      '1.5', 'Meses de trámite de cobro tras terminar obra (vendida)', 'ventas'),
  ('lag_cobro.apartada',     '3',   'Meses de trámite de cobro tras terminar obra (apartada)', 'ventas'),
  ('lag_cobro.disponible',   '6',   'Meses estimados para vender y cobrar una unidad sin cliente', 'ventas'),
  -- VENTAS: ajuste al lag por tipo de crédito (meses; negativo = más rápido)
  ('lag_ajuste_credito.contado',      '-0.5', 'Ajuste de meses al cobro si la venta es de contado', 'ventas'),
  ('lag_ajuste_credito.infonavit',    '0',    'Ajuste de meses al cobro si el crédito es Infonavit', 'ventas'),
  ('lag_ajuste_credito.bancario',     '0.5',  'Ajuste de meses al cobro si el crédito es bancario', 'ventas'),
  ('lag_ajuste_credito.fovissste',    '0.5',  'Ajuste de meses al cobro si el crédito es Fovissste', 'ventas'),
  ('lag_ajuste_credito.cofinanciado', '1',    'Ajuste de meses al cobro si el crédito es cofinanciado', 'ventas'),
  ('lag_ajuste_credito.otro',         '0',    'Ajuste de meses al cobro para otros esquemas', 'ventas'),
  -- OBRA
  ('obra.ritmo_max_semanal',        '350000', 'Tope físico de avance por unidad ($/semana)', 'obra'),
  ('obra.max_frentes',              '4',      'Máximo de frentes simultáneos por proyecto (usado en Fase 3)', 'obra'),
  ('obra.ventana_congelamiento_sem','3',      'Semanas que dura congelada la lista de prioridades', 'obra'),
  ('obra.colchon_pct',              '0.08',   'Colchón sobre el costo por terminar (fracción del restante)', 'obra'),
  ('obra.colchon_min',              '60000',  'Colchón mínimo por cierre de casa ($)', 'obra'),
  ('obra.semanas_min_cierre',       '4',      'Semanas mínimas de calendario para cerrar una casa con avance >= 85%', 'obra'),
  -- TESORERÍA
  ('tesoreria.permite_prepago',         'false',  'El contrato del puente permite prepago voluntario', 'tesoreria'),
  ('tesoreria.pct_liberacion_default',  '0.55',   'Si la venta no trae valor de liberación: fracción del precio usada como estimación (se marca como estimada)', 'tesoreria'),
  ('tesoreria.dia_corte',               '"fin_de_mes"', 'Corte de intereses del crédito puente', 'tesoreria'),
  ('tesoreria.jerarquia_fondeo',        '["caja","prestamo_interno","disposicion"]', 'Orden de fondeo de la obra (Fase 3)', 'tesoreria'),
  ('tesoreria.colchon_prestamista_meses','1',     'Colchón (en meses de burn) que conserva el proyecto que presta (Fase 3)', 'tesoreria'),
  ('tesoreria.colchon_min_meses_burn',  '1',      'Colchón intocable por proyecto: meses de costo fijo', 'tesoreria'),
  -- DIRECCIÓN / SCORE
  ('direccion.partidas_fijas',       '[]',  'Partidas del historial que cuentan como costo fijo (elígelas del catálogo real en Configuración)', 'direccion'),
  ('direccion.burn_meses_promedio',  '3',   'Meses del promedio móvil para calcular el costo fijo', 'direccion'),
  ('direccion.reparto_corporativo',  '"proporcional_dispuesto"', 'Cómo se reparte el gasto de la concentradora entre proyectos', 'direccion'),
  ('direccion.modo_objetivo',        '"liquidez_primero"', 'Función objetivo del portafolio (Fase 3 ordena escenarios con esto)', 'direccion'),
  ('score.castigo_incertidumbre',    '1',   'Factor multiplicativo extra de castigo a estatus inciertos (1 = sin castigo extra)', 'direccion'),
  ('score.horizonte_meses',          '6',   'Horizonte (meses) del componente de ahorro de intereses del score', 'direccion'),
  ('score.bono_estrategica',         '10',  'Puntos de bono al score para unidades marcadas como estratégicas', 'direccion')
) as s(clave, valor, descripcion, grupo)
on conflict (tenant_id, clave) do nothing;

-- ---------- Verificación -----------------------------------------------------
-- 1) Tablas y seeds:
--   select grupo, count(*) from public.estrategia_config group by grupo order by grupo;
--   (esperado: direccion 7 · obra 6 · tesoreria 6 · ventas 15 = 34 filas por tenant)
--   select count(*) from public.estrategia_flags_unidad;   -- 0
-- 2) Aislamiento multi-tenant (RLS): un insert con OTRO tenant_id no debe verse
--    desde tu sesión.
