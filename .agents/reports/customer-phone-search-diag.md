**Diagnóstico:** causa probable: resultados de una búsqueda anterior permanecen visibles al editar el teléfono; solo se sustituyen cuando otra búsqueda responde ([customer-editor.tsx:110](<C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/customers/customer-editor.tsx:110>), [línea 189](<C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/customers/customer-editor.tsx:189>), [línea 220](<C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/customers/customer-editor.tsx:220>)). **NO VERIFICADO:** secuencia real del smoke.
Otra posibilidad: un segundo teléfono coincide; SQL busca cualquier teléfono activo y devuelve todos ([migración:75](<C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/supabase/migrations/20260920000100_improve_customer_directory_search.sql:75>), línea 93). No encontré redefiniciones posteriores.
El filtro web de sugerencias compara cada teléfono, no nombre y teléfono combinados ([customer-directory.ts:77](<C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/web/src/lib/customer-directory.ts:77>)).
```text
node -e "console.log('6622900622'.includes('6622751352')); console.log('526622751352'.includes('6622751352'))"
false
true
```
**Fix propuesto, nivel C:** vincular los resultados enviados a la consulta y ocultarlos al cambiarla; probar edición y respuestas tardías. Si la consulta siguiente revela datos inconsistentes, investigar su origen antes de proponer una migración **B** y sonda rollback-only.
**Consulta read-only para el orquestador** — sustituir `<restaurant_id>`:
```sql
SELECT p.customer_id,p.display_value,p.normalized_value FROM app.customer_phones p WHERE p.restaurant_id='<restaurant_id>'::uuid AND p.deleted_at IS NULL AND EXISTS (SELECT 1 FROM app.customer_phones q WHERE q.restaurant_id=p.restaurant_id AND q.customer_id=p.customer_id AND q.deleted_at IS NULL AND (regexp_replace(q.display_value,'[^0-9]','','g')='6622900622' OR strpos(q.normalized_value,'6622751352')>0)) ORDER BY p.customer_id,p.contact_id;
```
**NO VERIFICADO:** datos remotos; no se consultaron. No se guardó el informe: el entorno permite solo lectura. AGENTS.md §10 no contiene una plantilla de informe.