# Brief customer-search-stale-results (D1-fix, nivel C)

## Objetivo
En el editor de Clientes, al cambiar el teléfono/nombre los resultados de la búsqueda anterior siguen visibles (smoke punto 2: 6622751352 mostraba al cliente 6622900622). Deben ocultarse al cambiar la consulta y las respuestas tardías no deben pisar una consulta más nueva.

## Alcance
- Editar SOLO `apps/web/src/app/app/customers/customer-editor.tsx` (~líneas 110, 189, 220; ubica por símbolo, la tarea C2 puede haber movido líneas) y, si extraes lógica pura, `apps/web/src/lib/customer-directory.ts` + `customer-directory.test.ts`.
- Prohibido: API, SQL, otros archivos, git commit/push.

## Contexto mínimo
Diagnóstico de Codex: los resultados sólo se sustituyen cuando otra búsqueda responde. Fix: vincular los resultados a la consulta que los generó (guardar `query` junto con la lista y mostrar sólo si coincide con la consulta actual), cancelar/ignorar respuestas de consultas obsoletas (contador o token de petición) y vaciar al cambiar la entrada. No cambies el debounce ni el parámetro `?customerId=` que añadió C2.

## Hecho cuando
- Test unitario de la lógica pura (consulta cambiada ⇒ sin resultados visibles; respuesta tardía ignorada). lint, typecheck y test web en verde con salida real.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Puertas desde `apps/web`: `corepack pnpm lint`, `typecheck`, `test` (tail -40). Informe en `.agents/reports/customer-search-stale-results.md` (≤12 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
