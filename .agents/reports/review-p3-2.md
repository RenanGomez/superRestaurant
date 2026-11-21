**CORREGIR**

- **P1 — Pruebas bloqueadas:** [pizza_model_v2_invariants.sql:636](/C:/Users/Emmanuel%20G/Documents/ChatGPT/superRestaurant/supabase/tests/pizza_model_v2_invariants.sql:636) llama `pg_temp.price` con un argumento; su definición exige dos. La primera confirmación positiva abortará antes de probarse. **Fix:** eliminar esa llamada, cuyo resultado se sobrescribe en la línea siguiente.
- **P2 — Límites de modificadores:** [migración:1880](/C:/Users/Emmanuel%20G/Documents/ChatGPT/superRestaurant/supabase/migrations/20261120000100_pizza_model_v2.sql:1880) excluye los grupos pizza de la validación de cantidades; el constructor tampoco aplica sus mínimos y máximos. Una selección puede saltarse esos límites. **Fix:** validarlos por mitad y grupo, con pruebas negativas.
- **P2 — Cocina y lectura:** [migración:2061](/C:/Users/Emmanuel%20G/Documents/ChatGPT/superRestaurant/supabase/migrations/20261120000100_pizza_model_v2.sql:2061) guarda `pizzaHalves`, pero [fraction-halves.ts:15](/C:/Users/Emmanuel%20G/Documents/ChatGPT/superRestaurant/apps/api/src/fraction-halves.ts:15) solo lee `fractionBreakdown`. **Fix:** adaptar los lectores antes de habilitar V2 y probar el snapshot histórico.
- Las diferencias textuales de las dos funciones copiadas conservan las ramas previas y añaden la rama V2. **NO VERIFICADO:** ejecución SQL, concurrencia, paridad efectiva de los diez vectores y análisis CodeGraph; no se ejecutó SQL y CodeGraph no estaba disponible.
- La §10 de AGENTS.md no contiene una plantilla de informe. Verificación:
```text
rg -n '^## 10\.' AGENTS.md
225:## 10. Multi-restaurante, sucursales y autorización
```