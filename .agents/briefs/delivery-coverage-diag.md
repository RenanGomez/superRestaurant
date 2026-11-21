# Brief delivery-coverage-diag (D2, diagnóstico, SIN escritura)

## Objetivo
Explicar por qué en Captura ninguna dirección de cliente resulta «cubierta» (smoke puntos 7 y 11) y proponer el fix.

## Alcance
- Solo lectura. No edites código. Temporales sólo en `.harness/state/tmp/`, y bórralos.
- Leer: `apps/api/src/delivery-zones.ts` (~345-400, `DeliveryZonesService.matchAddress`, decide sólo con `{postalCode, locality}`), `apps/web/src/app/app/delivery-match-action.ts`, `apps/web/src/lib/delivery-zones.ts`, y el uso en `apps/web/src/app/app/capture/capture-customer.tsx`.
- Prohibido: consultas a base remota, git commit/push.

## Contexto mínimo
HANDOFF ya tenía pendiente «CP 85860 en Zonas». Hipótesis a descartar con evidencia: (a) datos: la zona de Navojoa no incluye el CP 85860 o la localidad no coincide por acentos/mayúsculas/espacios; (b) código: la comparación normaliza mal, o el web envía campos vacíos/`undefined`; (c) regresión reciente (revisa `git log --oneline -15 -- apps/api/src/delivery-zones.ts apps/web/src/app/app/delivery-match-action.ts`).

## Hecho cuando
Informe con: causa (archivo:línea), si es dato o código, el fix, y la parte que le toca a Emmanuel (ej. agregar el CP en /app/delivery-zones). Si necesitas una consulta read-only a las zonas configuradas, dila exacta para que la corra el orquestador.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail). Informe en `.agents/reports/delivery-coverage-diag.md` (≤15 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
