# Brief capture-address-note-fix (fix de la revisión de C6, nivel C)

## Objetivo
En `apps/web/src/app/app/capture/capture-customer.tsx` (~línea 185) el estado visual usa `noteForAddress` (validada por firma version+contenido) pero el mensaje usa `noteFor` y puede conservar una alerta obsoleta tras cambiar la dirección. Renderiza ESTADO y MENSAJE desde la misma nota validada por firma.

## Alcance
- Editar SOLO `capture-customer.tsx`. No tocar el enlace a Directorio (ya lo consume la página de Clientes) ni `field-hint.tsx` (el `tabIndex={-1}` es lo pedido).
- Prohibido: git commit/push.

## Hecho cuando
- Una dirección editada nunca muestra el mensaje de la nota anterior. lint, typecheck y test web en verde; si extraes la lógica a `lib/` añade un test.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Puertas desde `apps/web`: `corepack pnpm lint`, `typecheck`, `test` (tail -40). Informe en `.agents/reports/capture-address-note-fix.md` (≤10 líneas) con bloque ``` con comando y salida real.
