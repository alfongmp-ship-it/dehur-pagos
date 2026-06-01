# Supabase — Schema y migrations

Esta carpeta versiona el schema de Postgres que vive en Supabase.

## Estructura

- `schema/` — bloques SQL numerados. Se corren en orden, son idempotentes.
- `functions/` — Edge Functions (mirror a Sheets, backup diario). Vendrán en Etapa D.

## Cómo aplicar un bloque

1. Abre Supabase Dashboard → tu proyecto → **SQL Editor** (icono `>_` en sidebar).
2. Click **+ New query**.
3. Abre el archivo `.sql` en tu editor, copia TODO el contenido.
4. Pégalo en el SQL Editor.
5. Click **Run** (o `Ctrl+Enter`).
6. Verifica el output. Si dice "Success. No rows returned" o muestra una tabla de resultados sin error, está bien.

## Orden de bloques

| # | Archivo | Qué hace | Cuándo correr |
|---|---|---|---|
| 1 | `01_tenants_and_roles.sql` | Tabla `tenants`, `tenant_users`, enum `app_role`, RLS, helpers, seed de "Dehur" | Una vez al setup inicial |
| 2 | `02_seed_admin_user.sql` | Te agrega como admin del tenant Dehur | Una vez, después de crear tu usuario en Auth |
| 3 | `03_grants_authenticated.sql` | GRANT a `authenticated` sobre tablas base (evita 403) | Una vez al setup inicial |
| 4 | `04_seed_team_users.sql` | Agrega testers del equipo al tenant Dehur (por email) | Cada vez que invites a alguien |
| 5 | `05_proveedores.sql` | Tabla `proveedores` (espejo del Sheet) + RLS + grants | Etapa B — rebanada de prueba |
| 6 | `06_datos_principales.sql` | Tablas `proyectos`, `cuentas_propias`, `empleados`, `historial` | Etapa B — bloque 1 |
| 7+ | (vendrán) | Resto: facturas, traspasos, créditos, costos, partidas | Etapa B (resto) |

## Idempotencia

Todos los bloques usan `create table if not exists`, `do $$ ... if not exists`,
y `on conflict do nothing` o `do update`. Puedes correr cualquier bloque varias
veces sin romper nada.

## Si algo se rompe

Supabase Dashboard → Database → **Tables** te muestra el estado actual.
Si algo quedó mal, puedes hacer `drop table xyz cascade;` en SQL Editor
para volver a empezar — solo PERDERÁS los datos de esa tabla.
