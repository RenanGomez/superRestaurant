I'll start by reading the diff as instructed.
Now let me read the actual files to verify the diff in full context.
Now the test file in full.
Let me check how idempotency keys are generated/typed in the contracts to judge the branch-scoping risk, and confirm no prior assertions were dropped.
The file appears to have changed between reads (possible concurrent edit). Let me re-check current state.
The working tree changed under me. Re-reading the current diff for the test file.
Concurrent edits are landing (1c cross-branch, 1d duplicate lines). I must review the current tree. Reading both files fresh.
VEREDICTO: CORREGIR

Snapshot (`git diff --numstat`): migración 170/52, test 269/4 — el árbol cambió durante la revisión; los casos 1c (cross-branch) y 1d (líneas duplicadas) ya están incluidos.
P1: ninguno. La recepción persiste actor/dispositivo reales (`migration:582-583`) y el replay retorna en `migration:520` antes del UPDATE, así que no los sobrescribe ni duplica movimientos (`migration:501-521`).
P2-1 · `supabase/tests/inventory_purchasing_invariants.sql:510-537` — no hay aserción de `received_by`/`received_device_id` tras el replay autorizado (`:511-512`) ni el segundo receive (`:526-527`); la única posterior (`:488`) proviene de un actor ajeno que falla el guard de auth (`migration:475-495`) y nunca entra a la rama replay. Corrección: tras `:537` afirmar `received_device_id = device` (el replay no manda `deviceId`) y, con un segundo manager válido, `received_by` intacto.
P3-1 · `supabase/migrations/20261126000400_inventory_purchasing.sql:291-294` — la guarda `v_unit_cost_minor < 0` es inalcanzable: el regex `:288` (`^[0-9]{1,18}$`) ya rechaza `-`; "negative unit cost" (`test:263-277`) pasa por el regex, no por la guarda. Corrección: quitar la guarda o cambiar la validación a cast+check.
P3-2 · `migration:220` y `:52-54` — `btrim` solo recorta espacios, no `\t`/`\n`; una clave con tab/salto en los bordes pasa "sin espacios". Corrección: regex de no-espacio o normalizar.
P3-3 · `migration:436`,`:547`,`:583` — `deviceId` es opcional: una primera recepción sin él deja `received_device_id` NULL (§8 exige dispositivo en mutaciones sensibles). Corrección: exigir `deviceId` en el primer receive o documentar la excepción.
Evidencia:
```
$ git diff --numstat -- supabase/migrations/20261126000400_inventory_purchasing.sql supabase/tests/inventory_purchasing_invariants.sql
170	52	supabase/migrations/20261126000400_inventory_purchasing.sql
269	4	supabase/tests/inventory_purchasing_invariants.sql
$ Select-String -Pattern "received_by|received_device_id" (test) → líneas 464,467,488,586,589
0 coincidencias entre 510-559 (replay y segundo receive sin aserción de auditoría)
```