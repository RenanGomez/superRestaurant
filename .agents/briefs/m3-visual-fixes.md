# Brief m3-visual-fixes (nivel C · falso positivo de área táctil)

## Hallazgo real del pase visual (12 combinaciones, sesión válida)

4 de 12 pasan (almacenes y compras, escritorio y 390×844). Las otras 8 fallan **solo** por
`target-size` en los botones de ayuda de campo:

```
- [target-size] Área táctil menor a 44×44px: control «Ayuda sobre Insumo» (20×20px)
- [target-size] Área táctil menor a 44×44px: control «Ayuda sobre Almacén» (20×20px)
- [target-size] Área táctil menor a 44×44px: control «Ayuda sobre Producto» (20×20px)
```

No hay desborde, ni errores de consola, ni fallos de red, ni diálogos nativos, ni nombres
accesibles faltantes en esos 8: el único bloqueo es esa regla.

## Causa

`apps/web/src/components/field-hint.tsx` dibuja un botón de 20×20 px **con un pseudo-elemento
`before:-inset-3`** que amplía el área real de pulsación a 44×44 px (por eso el componente es
deliberadamente pequeño y el resto de la app lo usa igual). El auditor
(`apps/web/e2e/visual/assert-ui.ts` → `readSnapshot`) mide solo `getBoundingClientRect()` del
botón, así que no ve la expansión y reporta un falso positivo.

## Qué hay que hacer

1. `apps/web/src/lib/visual-assert.ts`: nueva función pura exportada, p. ej.
   `effectiveTargetSize(control)` o mejor `hitAreaFromInsets(...)`, o extender `VisualControl` con
   un campo calculado. Diseño recomendado: añadir a `VisualControl` dos campos opcionales
   `insetLeft/insetTop/insetRight/insetBottom` (px, negativos = expansión) y que `findViolations`
   compare contra `width - insetLeft - insetRight` y `height - insetTop - insetBottom`, con mínimo 0.
   Solo cuentan insets de pseudo-elementos que **de verdad** amplían el hit area.
2. `apps/web/e2e/visual/assert-ui.ts`: al leer cada control, calcula la expansión de `::before` y
   `::after` con `window.getComputedStyle(element, "::before")`: exige `content !== "none"`,
   `position === "absolute"` y `pointer-events !== "none"`; acepta `inset`/`top/right/bottom/left`
   numéricos en px y toma, por eje, la mayor expansión de los dos pseudo-elementos. No inventes
   expansión para `position: static/relative` ni para valores no negativos.
3. `apps/web/src/lib/visual-assert.test.ts`: casos nuevos (botón 20×20 con -12 px por lado pasa;
   20×20 sin expansión falla; expansión parcial que no llega a 44 falla; `pointer-events: none`
   no cuenta; no romper los casos existentes).
4. **No toques** `field-hint.tsx`, componentes de inventario, la spec visual ni las reglas
   `accessible-name`, `horizontal-overflow`, `console-error`, `network-failure`, `native-dialog`,
   `focus-visible`: el gate no se relaja, solo se mide el área real.
5. Si al medir bien **queda** algún control realmente pequeño, no lo estilices: anótalo en el
   informe con nombre, tamaño y tab.

## Archivos (exactos, único escritor)

- `apps/web/src/lib/visual-assert.ts`
- `apps/web/src/lib/visual-assert.test.ts`
- `apps/web/e2e/visual/assert-ui.ts`

Prohibido tocar: `apps/api/**`, `supabase/**`, `packages/**`, `apps/web/src/components/**`,
`apps/web/e2e/journeys/**`, `apps/web/e2e/visual/inventario.spec.ts`, `package.json`.

## Reglas de la sesión

- No hagas `git commit`, `git push`, ni crees ramas o PRs.
- **No ejecutes Playwright ni PostgreSQL**; el orquestador corre el pase visual. Sí puedes ejecutar
  las unitarias de web y el lint/typecheck.

## Puertas que debes ejecutar

```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/web run typecheck
& $PNPM --filter @super-restaurant/web run lint
& $PNPM --filter @super-restaurant/web run test
```

## Hecho cuando

Las tres puertas en verde, los casos nuevos cubren la expansión por pseudo-elemento y el informe en
`.agents/reports/m3-visual-fixes.md` dice qué se cambió, qué falsos positivos cubre y qué controles
pequeños reales quedan (si alguno). Aplica AGENTS §14 y §15.
