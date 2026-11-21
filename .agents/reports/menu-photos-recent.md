# menu-photos-recent — hecha

Cambios: una sola lista «Fotos recientes» que ya incluye la foto actual (A, B y C en el mismo render, sin esperar al efecto); `saved` muestra «Guardado en el borrador ✓» tras subir, reemplazar, copiar o quitar; el botón del modal dice «Listo». Test nuevo de la secuencia A→B→C.
Archivos: `apps/web/src/app/app/menu/menu-catalog-editor.tsx`, `apps/web/src/lib/menu-used-images.test.ts`.
Verificación:
```
$ corepack pnpm lint && corepack pnpm typecheck   # ambos exit 0
$ eslint --max-warnings=0 --config ../../eslint.config.mjs src
$ tsc --noEmit --project tsconfig.json
$ corepack pnpm test                              # EXIT=0; 0 líneas "not ok"
1089:# Subtest: uploading A, replacing it with B and adding C shows all three in the same render
1090:ok 5 - uploading A, replacing it with B and adding C shows all three in the same render
```
Riesgos/pendientes: interpretación visual en navegador NO VERIFICADO (sólo unitarias y puertas). Sin cambios de API/SQL.
Notas: el árbol ya traía cambios ajenos (M0–M2) en el mismo archivo; no se revirtieron.
