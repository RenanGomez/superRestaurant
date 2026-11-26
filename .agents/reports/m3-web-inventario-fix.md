Now the UI file:
## Estado — done; puntos 1, 2 y 4 aplicados, punto 3 documentado (no existe helper `inert`/`aria-hidden` de shell en el repo).
## Qué hice
- `actions.ts`: `fetch` con `signal: AbortSignal.timeout(10_000)`; `TimeoutError`/`AbortError`→`timeout` («El servidor tardó demasiado. Reintenta.»), 401→`unauthenticated` («Vuelve a iniciar sesión»), 403→`denied`; `saving` impide cerrar el diálogo y el error se pinta dentro, sin reabrir otro.
- `inventory-workspace.tsx`: validación y `<option>` derivados de `INVENTORY_UNITS` (etiquetas con `inventoryUnitLabel`), contrato intacto. Fondo del diálogo: sin helper en el repo, se deja el foco atrapado + Escape como estaba.
## Archivos tocados — `apps/web/src/app/app/inventario/{actions.ts,inventory-workspace.tsx}`; `git status --short`: ` M` ambos (más `.agents/*` previos sin trackear).
## Verificación (Node 24.19.0)
```
$ & $PNPM --filter @super-restaurant/web lint      # $ eslint --max-warnings=0 --config ../../eslint.config.mjs src  (sin errores)
$ & $PNPM --filter @super-restaurant/web typecheck # $ tsc --noEmit --project tsconfig.json  (sin salida)
$ & $PNPM --filter @super-restaurant/web test      # 67 suites "ℹ fail 0"; última "ℹ pass 7" / "ℹ fail 0"
$ & $PNPM --filter @super-restaurant/web build     # "✓ Compiled successfully in 2.6s"; "Finished TypeScript in 9.6s"
```
## Riesgos / dudas
- Verificación visual en navegador no ejecutada (prohibida por el brief); queda para el orquestador.
## Notas propuestas — ninguna.