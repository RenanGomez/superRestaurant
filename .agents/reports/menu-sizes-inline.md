# menu-sizes-inline — hecha · Riesgos/pendientes: ninguno; presets siguen en BD sin uso, sin migración.
Cambios: pestaña «Tamaños» y presets fuera; nombre libre por variante y payload de guardado con `sizePresetId: null`; borradores viejos con `sizePresets` cargan y migran.
Archivos: apps/web/src/lib/menu-tabs.ts (+test), apps/web/src/lib/menu-draft-storage.ts (+test), apps/web/src/app/app/menu/menu-catalog-editor.tsx
Verificación:
```
$ corepack pnpm typecheck && corepack pnpm lint; echo EXIT:$?
EXIT:0
$ corepack pnpm test > "$TEMP/web-test.log" 2>&1; echo EXIT:$?; grep -E "three required|legacy draft|save payload" "$TEMP/web-test.log"
EXIT:0
ok 11 - a legacy draft with size presets loads and drops the preset links
ok 12 - the save payload never keeps a size preset link
```
