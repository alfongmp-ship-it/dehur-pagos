# 📋 Plantilla de secretos (committed)

Esta carpeta SÍ se sube al repo. Sirve para que tú (si cambias de máquina)
o un futuro colaborador sepan qué archivos crear en `.secrets/`.

## Cómo usar

1. Copia esta carpeta a `.secrets/` en la raíz del repo:
   ```powershell
   Copy-Item -Recurse .secrets.example .secrets
   ```
2. Reemplaza el contenido de cada archivo con la credencial real del dashboard
   de Supabase.
3. `.secrets/` está en `.gitignore` — no se va al repo.

## Verificación

```powershell
git ls-files | Select-String secrets
```

Solo deben aparecer archivos de `.secrets.example/`. Si aparece algo de
`.secrets/`, abortar.

## De dónde sacar cada cosa

| Archivo | Fuente |
|---|---|
| `service-role-key.txt` | Supabase Dashboard → Project Settings → API Keys → "service_role" (Reveal + Copy) |
| `db-password.txt` | Lo generaste al crear el proyecto. Si lo perdiste: Dashboard → Project Settings → Database → "Reset database password" |
| `supabase-url.txt` | Dashboard, arriba del nombre del proyecto. Ej: `https://kqvzuzymvpzyhnzmsmuu.supabase.co` |
| `supabase-anon-key.txt` | Dashboard → API Keys → "anon public" |
