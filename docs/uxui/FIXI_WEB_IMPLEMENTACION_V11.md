# Implementación Fixi Web UX/UI v1.1

## Resumen

Se trasladó la implementación UX/UI al repositorio independiente `serviciosdigitalesmx/fixi-repairshop-v4`, partiendo de su `main` y conservando el comportamiento de negocio. El cambio cubre la matriz de 17 pantallas auditadas en los documentos de esta carpeta.

El frontend se ajustó para navegación adaptable, densidad operativa, listas móviles, filtros agrupados, formularios accesibles y paneles contextuales. Las pantallas modificadas incluyen Inicio, Órdenes, Tablero, detalle y recepción de órdenes, pagos, Punto de venta, Caja, Clientes, Inventario, Compras y Transferencias.

## Cambios compartidos

- Sidebar compacto en anchos intermedios, grupos desplegables accesibles y eliminación de la acción global redundante de crear órdenes.
- Drawer con Escape, control de foco, bloqueo de scroll, cierre contextual y soporte de móvil a pantalla completa.
- Tablas que exponen encabezados como etiquetas para presentación móvil; pestañas con teclado y errores de campo asociados accesiblemente.
- Controles táctiles de al menos 44 px y reducción de animación global.
- Filtros secundarios agrupados con contador y limpieza sin perder la búsqueda principal.

## Pantallas y comportamiento

- Inicio: accesos operativos por permisos y métricas con valores y notas acomodados para distintos anchos.
- Órdenes y Tablero: filtros persistentes, tarjetas móviles y agrupación por estados devueltos por la API.
- Detalle y recepción: resumen 70/30, falla reportada expandible, pestañas contextuales y navegación anterior en el flujo de cuatro pasos.
- Operación comercial: drawers para cobro, estado, caja, cliente, producto y transferencia; carrito móvil colapsable.
- Administración: contexto de búsqueda y posición al regresar de clientes; productos inicialmente de solo lectura y confirmación al descartar cambios.

No se agregaron endpoints, campos de negocio, permisos, transiciones ni datos ficticios. El diff de aplicación se limita al frontend y pruebas de componentes; backend y migraciones permanecen sin cambios.

## Pruebas y evidencia

- GitHub Actions del `main` extraído, commit `0ae523b5`: backend build/unit/integration, frontend lint/types/unit/build, Docker/Compose y Playwright pasaron.
- No se ejecutaron builds ni pruebas locales, de acuerdo con `AGENTS.md`.
- PR de migración UX en el repositorio nuevo: pendiente de crear y validar en GitHub Actions.
- La API productiva `/fixi4/readyz` respondió HTTP 200. El árbol `backend/` del origen actual coincide con el código desplegado en producción; no se requirió reiniciar el servicio ni migrar la base.
- La conexión Vercel al repositorio independiente y el preview asociado a este PR quedan pendientes de completar y verificar.
- No se ejecutaron cobros, cierres de caja, operaciones con datos productivos ni cambios de DNS.

## Rama y entrega

- Base: `main` de `serviciosdigitalesmx/fixi-repairshop-v4`.
- Fuente de código: snapshot de `codex/fixi-repairshop` en `serviciosdigitalesmx/hotel-pms-mexico`.
- Se abrió el nuevo repositorio como privado y sin arrastrar el historial completo del PMS.
- PR de este repositorio, resultado final de Actions, deployment Vercel, SHA final y estado de producción: actualizar después de completar la validación.

## Riesgos residuales

- No hay migración de datos del producto anterior a PostgreSQL/EF Core.
- El acceso SSH al VPS no se verificó porque la huella del host no está registrada; se mantuvo `StrictHostKeyChecking`.
- Las diferencias fiscales y legales entre Argentina y México siguen documentadas en [`ADOPTION_STATUS.md`](../ADOPTION_STATUS.md).
