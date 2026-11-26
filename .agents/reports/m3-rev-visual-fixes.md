VEREDICTO: APROBAR

Checklist (sobre `harness/m3-visual-fixes`, HEAD de trabajo = `main`):
1. OK — `visual-assert.ts:63-66` exige `content` generado, `position: absolute` y `pointer-events !== none`; px no válido cae a shorthand y, si tampoco es px, a 0; `expansion()` solo cuenta insets negativos, así que los positivos no expanden.
2. OK — `visual-assert.ts:94-98` aplica `Math.max(0, …)`; `findViolations` usa `targetSize` solo para `target-size` (`:154`); `describeControl` (`:126`) solo se usa en ese mensaje; `accessible-name` sigue usando `width/height`.
3. OK — `assert-ui.ts:122-123` lee `getComputedStyle(element, pseudo)` del propio control, `::before`/`::after` se capturan en el mismo `page.evaluate` (`:152-153`); `screenshot` y demás reglas intactos.
4. OK — tests nuevos: 20×20 con −12 pasa a 44×44 y 20×20 sin expansión falla (`/20×20px/`), más parcial, insets positivos, pointer-events none, sin contenido/no absoluto, shorthand y merge.
5. Riesgo residual real (P3).

P1: ninguno. P2: ninguno.
P3-1 `visual-assert.ts:63`: no verifica que el control sea el bloque contenedor del pseudo (su `position`). Un `::before` absoluto con inset negativo en un control `static` se ancla a un ancestro posicionado, no al control: un control <44 podría pasar sin que su área real crezca.
P3-2 `visual-assert.ts:63`: insets declarados ≠ área golpeable; no descuenta `overflow:hidden`/`clip-path` en ancestros ni `transform: scale(0)` del pseudo.
P3-3 `assert-ui.ts:122`: no detecta oclusión por otro elemento con mayor z-index sobre el pseudo.
NO VERIFICADO: comportamiento en navegador real (Playwright prohibido por el brief); el juicio anterior es sobre el código y los tests del diff.

```
$ git diff --stat main...harness/m3-visual-fixes
 apps/web/e2e/visual/assert-ui.ts       | 50 +++++++++++++++--
 apps/web/src/lib/visual-assert.test.ts | 99 ++++++++++++++++++++++++++++++++++
 apps/web/src/lib/visual-assert.ts      | 97 +++++++++++++++++++++++++++++++++-
 3 files changed, 241 insertions(+), 5 deletions(-)

$ git show harness/m3-visual-fixes:apps/web/src/lib/visual-assert.ts | Select-String ...
63: export function insetsFromPseudo(style: PseudoStyle): ControlInsets | null {
66:   if (style.pointerEvents === "none") return null;
94: export function effectiveTargetSize(control: VisualControl): EffectiveSize {
154:     const targetSize = effectiveTargetSize(control);

$ git show harness/m3-visual-fixes:apps/web/e2e/visual/assert-ui.ts | Select-String ...
122:     function pseudoStyle(element: Element, pseudo: "::before" | "::after"): PseudoStyle {
123:       const style = window.getComputedStyle(element, pseudo);
152:         before: pseudoStyle(element, "::before"),
153:         after: pseudoStyle(element, "::after"),
```