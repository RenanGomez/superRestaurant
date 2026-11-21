# Brief z5-address-form-settlement (Formulario de dirección por colonia, nivel C)

## Objetivo
Formulario de dirección por colonia. Smoke r2, ola 2.

## Fuente de verdad
Z5 de `docs/architecture/DELIVERY_ZONES_V2.md` §10 y plan Z5: `AddressForm` con calle y número, interior, colonia (combobox del catálogo, debounce 500 ms, CP solo lectura), referencias; ocultar localidad, estado, país y CP; en `capture/capture-customer.tsx` mostrar el motivo exacto del API.

## Hecho cuando
Puertas web en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Prohibido: git commit/push, aplicar migraciones en remoto, tocar archivos fuera del alcance. Informe de ≤15 líneas con bloque con comando y salida real; sin evidencia = NO VERIFICADO.
