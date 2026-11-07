# Plan de implementación UX/UI v1.1

## Orden de bloques y alcance

1. **Auditoría**: inventario/rutas, contratos declarados, permisos visibles, límites runtime y criterios (registrados en archivos hermanos).
2. **Fundación compartida**: targets táctiles, errores accesibles, tabs teclado, drawer, lista móvil y densidad responsive; eliminar animación global de página; corregir CTA global redundante.
3. **Núcleo operativo**: detalle de orden (70/30 y tabs próximos), recepción (4 pasos preservados), y presentación contextual de operaciones existentes.
4. **Operación**: órdenes, tablero, inicio, punto de venta, caja y ventas.
5. **Administración**: clientes, inventario, compras, transferencias, facturas, reportes, mensajes, configuración y suscripción.
6. **Verificación remota**: CI GitHub Actions y preview Vercel desde el repositorio independiente. No build/test local según `AGENTS.md`. La publicación de frontend a producción ocurre al integrar a `main` cuando Vercel esté conectado al repositorio destino.

## Criterios de no regresión

- Mantener rutas, API, modelos, guards, tenant/sucursal, estado de suscripción, idempotencia, reglas de estados, caja, pagos, inventario y transiciones.
- Cada filtro/acción seguirá respaldado por un estado o llamada existente.
- No ejecutar operaciones financieras ni crear datos de prueba en producción.
- Reportar pendientes si CI, preview, credenciales de staging o runtime no están disponibles; nunca marcar como aprobado lo que no se ejecutó.

## Dependencias y secuencia

Base compartida primero; pantallas después. El componente de lista móvil será opt-in para no afectar tablas de reportes/controles complejos. El drawer será reutilizable y no se migrarán todos los modales si eso arriesga operaciones; migrar formularios contextuales identificados por pantalla, preservando confirmaciones como diálogos.

## Verificación prevista

- Revisión estática y `git diff --check` local (sin ejecutar build/tests por política del repositorio).
- Push rama y PR hacia `main` en `serviciosdigitalesmx/fixi-repairshop-v4`.
- Esperar los checks configurados por GitHub Actions: backend/frontend, Docker y Playwright si corren con el PR.
- No presentar un preview como despliegue productivo. Verificar el deployment del commit en `main` tras integrar el PR.
