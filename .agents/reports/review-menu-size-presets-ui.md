- **P1** [menu-draft-storage.ts:57](<C:/tmp/sr-wt/menu-size-presets-ui/apps/web/src/lib/menu-draft-storage.ts:57>): recuperar un borrador antiguo sustituye los presets publicados por `[]`. Al publicar puede borrarlos de la nueva versión o dejar referencias inválidas.
- **P2** [menu-catalog-editor.tsx:554](<C:/tmp/sr-wt/menu-size-presets-ui/apps/web/src/app/app/menu/menu-catalog-editor.tsx:554>): desactivar un preset conserva las referencias de sus variantes; el dominio rechaza esa publicación.
- **P2** [menu-catalog-editor.tsx:549](<C:/tmp/sr-wt/menu-size-presets-ui/apps/web/src/app/app/menu/menu-catalog-editor.tsx:549>): no se validan nombres duplicados sin distinguir mayúsculas, espacios ni nombres compuestos solo de espacios; el servidor rechaza el borrador sin señalar el preset.
- **P2** [menu-catalog-editor.tsx:558](<C:/tmp/sr-wt/menu-size-presets-ui/apps/web/src/app/app/menu/menu-catalog-editor.tsx:558>): el diálogo de eliminación no gestiona el foco ni asocia su descripción; un usuario de teclado o lector de pantalla puede no recibir la confirmación.
- **P3** [menu-catalog-editor.tsx:559](<C:/tmp/sr-wt/menu-size-presets-ui/apps/web/src/app/app/menu/menu-catalog-editor.tsx:559>): muestra «1 productos afectados».
- Verificación: existe prueba de `updatePresetVariants`; `reorder` actualiza `displayOrder`. El borrador enviado incluye las seis claves exigidas por `isDraftRecord`.
- NO VERIFICADO: lint, typecheck, tests, build y navegador real; revisión solicitada de solo lectura. AGENTS.md §10 no contiene plantilla de informe.
```text
rg -n 'function reorder|displayOrder|updatePresetVariants' apps/web/src/lib/menu-reorder.ts apps/web/src/lib -g '*test.ts'
apps/web/src/lib/menu-reorder.ts:13:  return next.map((item, index) => ({ ...item, displayOrder: index + 1 }));
apps/web/src/lib\menu-draft-storage.test.ts:84:  const renamed = updatePresetVariants(products, "s1", "Grande");
```
VEREDICTO: CAMBIOS