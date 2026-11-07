# Publicación de Fixi 4V en Hostinger

## Flujo confirmado en el repositorio

1. Los cambios entran a `main` solo después de CI.
2. El workflow construye `backend/` y publica una imagen con etiqueta de commit en GHCR.
3. El resumen del job `Publish immutable Fixi 4V image` registra la referencia `ghcr.io/serviciosdigitalesmx/fixi-repairshop-v4@sha256:…` para Compose.
4. No existe un paso automático de SSH ni un despliegue automático al VPS en GitHub Actions.

## Actualización del servicio

El stack de producción se describe en [`compose.vps.yml`](./compose.vps.yml). La base PostgreSQL y las fotos viven en volúmenes propios del stack `fixi4`; no eliminar volúmenes ni ejecutar `down -v`.

Con la ruta real del checkout y una conexión SSH cuya huella de host haya sido verificada en Hostinger:

1. Respaldar PostgreSQL y las fotos antes de una versión que cambie el esquema.
2. En el `.env` del servidor, establecer `FIXI4_IMAGE` con el digest exacto publicado por Actions. No usar una etiqueta mutable.
3. Desde el directorio que contiene `compose.vps.yml` y `.env`, ejecutar:

   ```sh
   docker compose --env-file .env -f compose.vps.yml pull api
   docker compose --env-file .env -f compose.vps.yml up -d api
   docker compose --env-file .env -f compose.vps.yml ps
   curl -fsS https://api-fixi.serviciosdigitalesmx.online/fixi4/readyz
   ```

La API aplica migraciones EF Core al iniciar. No apuntarla a la base de la aplicación anterior ni copiar sus datos o credenciales automáticamente.

## Estado observado

El 7 de noviembre de 2026, `https://api-fixi.serviciosdigitalesmx.online/fixi4/readyz` respondió HTTP 200. El intento de inspeccionar el VPS por SSH no pudo autenticar la huella de `api-fixi.serviciosdigitalesmx.online`; se mantuvo la verificación estricta y no se desplegó por SSH. Por eso, la ruta real del checkout, digest activo, estado de backups y comandos ejecutados en Hostinger todavía deben confirmarse en el servidor.
