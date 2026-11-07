# Fixi 4V RepairShop — repositorio independiente

Lee y aplica primero el AGENTS.md global de Codex del usuario.

- Este repositorio es la fuente independiente de Fixi 4V: React/TypeScript/Vite y ASP.NET Core 8/PostgreSQL.
- La rama estable es `main`; entregar cambios por ramas y Pull Requests.
- El repositorio de origen `serviciosdigitalesmx/hotel-pms-mexico` conserva sus demás productos e historiales; no modificarlo como parte del desarrollo de este repositorio.
- GitHub Actions (`.github/workflows/ci.yml`) es la validación autoritativa. No ejecutar builds/tests locales. Se permite una vista de desarrollo conectada exclusivamente a la base demo aislada.
- No usar la base, credenciales, cookies, tokens ni SMTP de Fixi anterior. Las migraciones EF Core no se ejecutan sobre PostgreSQL de producción existente.
- No desplegar ni cambiar VPS/Vercel/DNS salvo autorización explícita para ese cambio.
- Preservar autorización server-side, aislamiento de organización/sucursal, reglas de órdenes, control de stock y rotación de sesión. No suponer equivalencia con `platform_admin_grant` del sistema anterior.
- Conservar procedencia y permiso documentados en `docs/UPSTREAM_AUTHORIZATION.md`. No atribuir una licencia pública que el upstream no haya publicado.
- Nunca incorporar `.env`, uploads, dumps, paquetes descargados ni material local de agentes.
