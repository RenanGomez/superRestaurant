# Brief k0-capture-landing-diag (diagnóstico, sin escritura de código)

## Objetivo
Responder con `archivo:línea` cuatro preguntas sobre la creación de borradores de Captura. Solo lectura; entrega el informe.

## Preguntas
1. ¿El comando de creación de borrador (`create()` en `apps/web/src/app/app/capture/capture-workspace.tsx`, la server action en `capture/actions.ts` y el endpoint del API en `apps/api/src/captures.ts`) acepta `customerId` y el canal (`channel`/fulfillment) al crearse, o se asignan después con otro comando?
2. ¿El contrato del borrador (`packages/shared-types`) tiene un campo de nombre/teléfono de contacto para «Recoger» sin cliente del directorio?
3. ¿La lista de borradores (`capture-drafts` del API) trae `customerId` y se puede filtrar por cliente?
4. ¿Qué bloquea hoy confirmar un borrador sin cliente según el canal (dominio, API o SQL)? ¿Existe en el servidor la regla «Domicilio exige cliente»?

## Contexto mínimo
- Decisión de Emmanuel (2026-11-20): Recoger sin cliente guarda nombre (y teléfono opcional) en un campo del borrador; si falta, se abrirá una tarea B de API con contract test. Domicilio exige cliente y la regla debe estar en el servidor.
- Usa `codegraph explore` antes de abrir archivos. No edites nada.

## Hecho cuando
- Informe de ≤25 líneas con las 4 respuestas (sí/no + archivo:línea) y, por cada «falta», una propuesta de tarea B de una línea.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Cada afirmación lleva archivo:línea; sin evidencia = NO VERIFICADO.
