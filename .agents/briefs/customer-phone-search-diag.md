# Brief customer-phone-search-diag (D1, diagnóstico, SIN escritura)

## Objetivo
Explicar por qué buscar el teléfono 6622751352 en el directorio de clientes devuelve también a un cliente con 6622900622 (smoke punto 2), y proponer el fix.

## Alcance
- Solo lectura. No edites código. Puedes crear un test temporal SOLO en `.harness/state/tmp/` y borrarlo.
- Leer: `apps/web/src/lib/customer-directory.ts` (filtro `includes` ~línea 87, `getCustomerDirectorySuggestions` ~59), y el SQL `search_customer_directory` en `supabase/migrations/20260920000100*.sql` (~31-34 y 75-76: busca la subcadena `strpos(normalized_value, key)`). Busca migraciones posteriores que redefinan esa función.
- Prohibido: consultas a base remota, git commit/push.

## Contexto mínimo
Por la regla de subcadena, 6622751352 no debería devolver 6622900622. Sospechosos: un segundo teléfono del mismo cliente, un `normalized_value` mal formado (formato de normalización, prefijo de país, espacios), o el filtro web `includes` sobre texto combinado (nombre + teléfono).

## Hecho cuando
Informe con: causa más probable (cita archivo:línea), evidencia (salida real de un test o de la lectura), fix propuesto, y si es nivel C (sólo filtro web) o B (SQL: migración nueva + sonda rollback-only). Si hace falta una consulta read-only a `app.customer_phones`, di exactamente cuál para que el orquestador la corra.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail). Informe en `.agents/reports/customer-phone-search-diag.md` (≤15 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
