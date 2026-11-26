I'll start with read-only inspection to ground the review in real state (branch, files on disk, and the author's claimed invariants).
Working tree is on `docs/ola-0-arranque`; the recipe files exist only on the branch (glob found none on disk). Reading the author's claimed invariants and the error base classes from the branch (read-only via `git show`), plus confirming the diff is authentic.
Key signal: the brief forbids creating `units.ts` ("existe (dependencia)... Prohibido: ... units.ts"), yet the diff shows `units.ts` and `units.test.ts` as **new files**. Let me verify whether `units.ts` exists on `origin/main` (i.e. a scope/merge-authority problem) and confirm the imported errors exist.
`origin/main` **does** contain `units.ts`, but the diff presents it as a *new file* — meaning this branch was cut from an older base and independently re-created `units.ts`. That's an integration/split-authority hazard for a level‑A domain module. Let me confirm the divergence and the merge-base.
`origin/main` merged `units.ts` (PR #80, `0bcd80d0`); this branch's merge-base is `81c9a2d6` (older), so the branch **re-added** `units.ts` with *different* `applyFraction` semantics (`remainder: 1` vs main's `remainder: residual`). Confirming the merge-base lacks the file, and running the adversarial checks inline (pure computation — branch files aren't on disk and Plan Mode forbids writing them).
Backticks broke the shell quoting; rerunning the same inline check without template literals.
Shell is mangling quotes in `-e`. Piping the script via stdin avoids that (no file written).
Confirmed divergence and behavior. Final read-only check: does `origin/main` also already ship `units.test.ts` (add/add on two files)?
VEREDICTO: CAMBIOS
P1 `packages/domain/src/inventory/units.ts:113` la rama RE-CREA `units.ts` y `units.test.ts` que ya existen en `origin/main` (blobs distintos; merge-base `81c9a2d6` no los tiene) y cambia `applyFraction` a `remainder:1` en vez de `remainder:residual`; el brief lo prohibía ("existe… no lo modifiques"). Merge a main = conflicto add/add + regresión de auditoría. Evidencia: `git diff origin/main:…units.ts harness/m3-dom-recipe:…units.ts`.
P2 `packages/domain/src/inventory/recipe-explosion.ts:140` `modifierIds` duplicados no se deduplican → doble consumo (doble envío); ningún test lo cubre.
P2 `packages/domain/src/inventory/recipe-explosion.ts:143` `modifierId` desconocido/typo se ignora en silencio → subconsumo; sin prueba.
P2 `packages/domain/src/inventory/recipe-explosion.ts:112` invariante "quantity entero ≥1" sin prueba que falle al quitar el guard (qty0 lanza, pero no hay test que lo afirme).
P3 `packages/domain/src/inventory/units.test.ts:45` no cubre residual≥2 (5·1/3, 7·2/3) → no distingue `remainder:1` de `remainder:2`; la regresión de auditoría pasa oculta.
```text
# node <script inline fiel a la lógica de la rama; archivos de rama no están en disco y Plan Mode read-only prohíbe escribirlos> | stdin -> salida real:
 5*1/3: main={"quantity":2,"remainder":2} branch={"quantity":2,"remainder":1}
 7*2/3: main={"quantity":5,"remainder":2} branch={"quantity":5,"remainder":1}
 one modifier  qty2 => [{"itemId":"cheese","unit":"g","quantity":460,"remainder":0}]
 DUP modifier  qty2 => [{"itemId":"cheese","unit":"g","quantity":520,"remainder":0}]
 typo modifier qty1 => [{"itemId":"cheese","unit":"g","quantity":200,"remainder":0}]
 qty0 => threw INVALID_QUANTITY
```
Leído fuera del diff para juzgar: `.agents/briefs/m3-dom-recipe.md`; `packages/domain/src/errors.ts` (InvalidQuantityError existe).
NO VERIFICADO: ejecución contra el artefacto compilado de la rama (Plan Mode read-only prohíbe escribir/checkout); la divergencia main-vs-rama está además probada por `git diff` de blobs.