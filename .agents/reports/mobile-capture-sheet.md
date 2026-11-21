# mobile-capture-sheet · R2-2 · nivel C · REVIEW

Cambio: `apps/web/src/app/app/capture/product-sheet.tsx` (+17/−5). La hoja inferior ya existía (`items-end`, `92dvh`, cierre, 44 px, cotización y errores visibles desde el API); se añadió foto del producto con respaldo color/inicial, `min-h-0 + overflow-y-auto + overscroll-contain`, footer con `env(safe-area-inset-bottom)` y bloqueo del scroll de fondo solo bajo 640 px. `Escape` y el backdrop ahora respetan `closeDisabled`. Escritorio conserva modal centrado.
Reutiliza: `menuImagePublicUrl`, `useMenuImageBaseUrl`, `uiButton/uiOption`, cotización y estimación existentes; ningún cálculo de dinero nuevo en cliente. Sin helpers puros nuevos.

```text
corepack pnpm lint 2>&1 | tail -20
$ eslint --max-warnings=0 --config ../../eslint.config.mjs src
corepack pnpm typecheck 2>&1 | tail -20
$ tsc --noEmit --project tsconfig.json
corepack pnpm test > /tmp/web-test.log 2>&1; echo "EXIT=$?"
EXIT=0
tests=424 pass=424 fail=0
```

NO VERIFICADO: visual 390×844 y escritorio; requiere sesión autenticada y catálogo real, no se abrió navegador.
Siguiente: verificación visual de Emmanuel; revisión lista para REVIEW.
