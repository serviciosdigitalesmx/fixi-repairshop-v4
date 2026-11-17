# QA web de escritorio local

Ejecutar desde este checkout en PowerShell 7:

```powershell
pwsh -File scripts/run-web-qa.ps1
```

El comando compila la API, crea una base nueva dedicada, inicia API/Vite y ejecuta primero acceso/recepción, luego los demás escenarios en Chromium visible, con un solo trabajador. No usa GitHub Actions, producción ni migraciones EF. `EnsureCreated` se permite exclusivamente sobre la base nueva verificada vacía. No prueba actualizaciones de esquema.

Requisitos de esta estación:
- .NET 8 en `D:\Tools\fixi-dotnet`, Node/npm y Python existentes. Nuevas instalaciones/cachés/artefactos en D.
- Docker con el contenedor PostgreSQL 16 `fixi-web-qa-20261117-pg`, etiqueta `fixi.qa=web-20261117`, puerto loopback 15439, volumen de datos en D.
- Contraseña privada del PostgreSQL de pruebas en `D:\QA\fixi-web-20261117\runtime\pg-password`; no copiarla al repositorio.
- Puertos locales 15173 y 18170 libres o procesos pertenecientes a este checkout.

Opciones: `-Group Smoke|Integrity|Inventory|Baseline|All`, `-ReuseServices`. Sin `-ReuseServices`, cada ejecución crea otra base descartable; no elimina las anteriores. Solo detiene procesos propios. Mantiene autorización, validaciones, proveedores externos deshabilitados y simulación de pagos deshabilitada. JWT de un minuto exclusivamente en QA para probar expiración real.

No cambiar expectativas para obtener verde: el caso existente de selección/checkout de suscripción queda bloqueado si falta proveedor real y conserva su fallo/exit code. Los demás escenarios continúan. No representa una transacción aprobada.

Los originales de capturas/trazas/logs permanecen privados en `D:\QA\fixi-web-20261117\runtime`. Solo compartir las copias saneadas en `D:\QA\fixi-web-20261117\evidence`, después de comprobar `privacy-manifest.json`. No publicar runtime, base, uploads, tokens ni cookies. Las trazas saneadas conservan navegación/HTTP y ocultan credenciales/enlaces firmados; sus documentos binarios PDF se retiran.

Las pruebas nuevas hacen lecturas reales después de recargar. La fixture común audita la revisión final por entidad de las escrituras observadas; no sustituye pruebas de cada revisión intermedia, concurrencia distribuida ni controles funcionales no asertados. Consultar la matriz del informe de ejecución para límites reales.
