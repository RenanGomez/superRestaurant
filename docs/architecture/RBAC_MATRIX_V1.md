# Matriz RBAC v1

Estado: **PROPUESTA — implementada, pendiente de revisión humana**
Versión de contrato: `1`

## Alcance

Esta matriz define permisos mínimos y explícitos por Restaurant/Branch para las
capacidades P0/P1. No existe herencia implícita entre roles: cada celda es una
concesión deliberada. NestJS revalida membresía activa, scope exacto y permiso
en cada operación; la UI nunca es autoridad.

Los permisos de lectura no autorizan mutaciones. Las cancelaciones se separan
entre ítems pendientes y enviados a cocina. Una cancelación enviada requiere
además motivo, evidencia y autorización de supervisor en el flujo de dominio.

## Matriz

| Permiso | owner | admin | manager | supervisor | cashier | waiter | kitchen | viewer | auditor |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `branch.select` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `branch.settings.manage` | ✓ | ✓ | ✓ |  |  |  |  |  |  |
| `memberships.manage` | ✓ | ✓ |  |  |  |  |  |  |  |
| `catalog.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| `catalog.manage` | ✓ | ✓ | ✓ |  |  |  |  |  |  |
| `tables.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| `tables.manage` | ✓ | ✓ | ✓ |  |  |  |  |  |  |
| `orders.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `orders.create` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |
| `orders.update` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |
| `orders.cancel.pending` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |
| `orders.cancel.sent` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |
| `kds.read` | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ |
| `kds.transition` | ✓ | ✓ | ✓ | ✓ |  |  | ✓ |  |  |
| `payments.collect` | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |  |
| `refunds.create` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |
| `cash-register.manage` | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |  |
| `reports.read` | ✓ | ✓ | ✓ | ✓ |  |  |  | ✓ | ✓ |

## Reglas de evolución

- Cambiar una concesión o el significado de un permiso requiere una nueva
  versión y pruebas de regresión; no se reinterpreta silenciosamente v1.
- Roles personalizados y excepciones por usuario quedan fuera de v1.
- Un actor con varios roles obtiene la unión de permisos vigentes en la misma
  membresía y scope; roles de otra Branch nunca participan.
- Entradas desconocidas, duplicadas, hostiles o no versionadas se deniegan.
- El primer endpoint de negocio restringido debe probar HTTP `403`, false pairs,
  revocación con token vivo y ausencia de efectos antes de persistir.
