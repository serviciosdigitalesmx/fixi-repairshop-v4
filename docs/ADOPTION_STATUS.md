# Fixi 4V — estado de independencia y producción

## Código y procedencia

- Repositorio independiente: `serviciosdigitalesmx/fixi-repairshop-v4`.
- Rama estable: `main`.
- Snapshot de origen: `serviciosdigitalesmx/hotel-pms-mexico`, rama `codex/fixi-repairshop`, commit `1b275ea6cbd116fff35d1051dd3d4f1b0f92ee8e`.
- El commit inicial de extracción contiene el árbol del producto Fixi 4V; no arrastra el historial del PMS al repositorio nuevo.
- Stack del producto: frontend React/TypeScript/Vite, API ASP.NET Core 8 y PostgreSQL.

## Estado observado de producción al 7 de noviembre de 2026

- La API `https://api-fixi.serviciosdigitalesmx.online/fixi4/readyz` respondió HTTP 200 durante la verificación. Esto confirma disponibilidad del endpoint, pero no identifica por sí solo el digest activo del contenedor.
- El proyecto Vercel `fixi-monolith-web` todavía estaba conectado a `serviciosdigitalesmx/hotel-pms-mexico`; su último deployment de producción observado usaba el commit `13621171` de `codex/fixi-repairshop`.
- La conexión Vercel a este repositorio nuevo y una publicación desde su rama `main` siguen siendo pasos de migración; no deben confundirse con el preview de un PR.
- La composición VPS `deploy/compose.vps.yml` define un stack `fixi4` con PostgreSQL y almacenamiento propios. La API arranca migraciones EF Core en esa base. No se debe apuntar a la base del producto anterior.
- El workflow actual valida y publica imágenes; no contiene un paso automático de SSH al VPS. El procedimiento documentado para el VPS actualiza el stack con Docker Compose y un digest de imagen.

## Datos y compatibilidad

1. No existe migración de datos desde la aplicación Spring/Flyway anterior a EF Core. Esta extracción no copia clientes, órdenes, usuarios, contraseñas ni grants.
2. La autorización del backend .NET conserva aislamiento por organización y sucursal; no hereda automáticamente los grants globales del producto anterior.
3. Hay diferencias regionales pendientes de revisión: fiscalidad ARCA/AFIP, textos legales y cobros de Argentina no equivalen a CFDI ni a condiciones comerciales de México.
4. Los valores de precios, integraciones de pagos, correo, WhatsApp y administración global deben comprobarse con cuentas reales antes de habilitar altas o cobros.
5. No ejecutar migraciones contra la base del producto anterior ni cambiar dominios de producción si eso pudiera presentar una base vacía como si fueran datos perdidos.

## Validación

GitHub Actions es la fuente autoritativa para backend, frontend, Docker, Compose y Playwright. Un HTTP 200 de salud confirma disponibilidad, no valida por sí solo versión, integraciones de pagos, correo, backups ni restauración.
