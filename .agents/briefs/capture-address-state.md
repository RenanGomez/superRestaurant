# Brief capture-address-state (C6, nivel C)

## Objetivo
Estado de direcciones del cliente en Captura: limpiar el «inválida» pegado y explicar el motivo del bloqueo. Puntos 4 y 7 (parte UI).

## Alcance
- Editar SOLO `apps/web/src/app/app/capture/capture-customer.tsx`.
- Prohibido: otros archivos (`capture-workspace.tsx`, API, SQL), git commit/push.

## Contexto mínimo
- El estado local `note` (~línea 155) está indexado por `addressId` y sólo se limpia en «Editar», `saveAddress` o `refresh`. Limpiar `note[addressId]` cuando cambia la `version` o el contenido de la dirección.
- Mostrar el **motivo** del bloqueo («CP 85860 sin zona en Navojoa») en vez de «Fuera de cobertura» genérico, usando lo que ya devuelva `matchDeliveryAddress` (action en `apps/web/src/app/app/delivery-match-action.ts`). Si la respuesta no trae motivo, repórtalo y NO lo inventes.
- El enlace «Abrir el cliente en Directorio» (~línea 171) pasa a `/app/customers?customerId=<id>` (la página de Clientes la adapta otra tarea; tú sólo construyes el enlace).

## Hecho cuando
- lint, typecheck y test de `@super-restaurant/web` en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Puertas desde `apps/web`: `corepack pnpm lint`, `typecheck`, `test` (tail -40). Informe en `.agents/reports/capture-address-state.md` (≤12 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
