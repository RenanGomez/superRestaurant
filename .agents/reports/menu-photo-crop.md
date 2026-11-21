# menu-photo-crop — REVIEW
Cambios: diálogo modal de encuadre antes de subir/reemplazar fotos del menú: marco 16:9, zoom (slider, botones, rueda, `+`/`-`), arrastre y flechas, sin `alert/confirm/prompt`; al confirmar recorta en canvas, reutiliza `fitMenuImageWithin`/`shrinkMenuImage` y entrega JPEG ≤2 MB.
Archivos: apps/web/src/app/app/menu/photo-crop-dialog.tsx (nuevo), apps/web/src/lib/menu-photo-crop.ts (nuevo), apps/web/src/lib/menu-photo-crop.test.ts (nuevo), apps/web/src/app/app/menu/menu-catalog-editor.tsx, apps/web/package.json, apps/web/tsconfig.test.build.json.
Verificación (desde `apps/web`):
```
$ corepack pnpm lint        → $ eslint --max-warnings=0 --config ../../eslint.config.mjs src
$ corepack pnpm typecheck   → $ tsc --noEmit --project tsconfig.json
$ corepack pnpm test        → ok 6 - extreme pans stay clamped and never leave empty borders
                              # fail 0   (EXIT:0)
```
Riesgos/pendientes: NO VERIFICADO en navegador real (no se levantó servidor); el encuadre 16:9 es una aproximación al `h-24 w-full` de la tarjeta, que no tiene proporción fija.
Notas: CodeGraph confirmó `PhotoCropDialog` con un solo llamador y sin referencias huérfanas; `menuPhotoCropRect` queda cubierto por 8 pruebas puras.
