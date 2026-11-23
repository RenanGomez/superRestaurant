**Veredicto: CORREGIR**

- **P2** [capture-customer-search.tsx](</C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/capture/capture-customer-search.tsx:190>): cada reintento genera otro `contactId` con la misma clave de idempotencia. Tras una respuesta perdida, el reintento cambia el comando y puede entrar en conflicto. Conservar el comando completo para reintentos y probar ese caso.
- **P2** [capture-customer-search.tsx](</C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/capture/capture-customer-search.tsx:64>): al cambiar de consulta A a B y volver a A, reaparece el resultado anterior mientras se busca; si falla la búsqueda, permanece seleccionable. Invalidar el resultado al cambiar la consulta y mostrar el error.
- **P2** [photo-crop-dialog.tsx](</C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/menu/photo-crop-dialog.tsx:181>): se puede cancelar durante el procesamiento, pero la operación asíncrona todavía puede llamar a `onConfirm` y subir la foto. Invalidar el procesamiento al cancelar o desmontar y comprobarlo antes de confirmar.
- **P3** [menu-draft-storage.ts](</C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/web/src/lib/menu-draft-storage.ts:89>): sobra una línea en blanco al final; retirarla.

**Verificación:** revisión estática del diff y archivos relacionados.
```text
git diff --check -- apps/web
apps/web/src/lib/menu-draft-storage.ts:89: new blank line at EOF.
```
NO VERIFICADO: pruebas y navegador; la revisión fue de solo lectura. No se escribió `.agents/reports/review-wave1b.md` por la restricción de solo lectura. AGENTS.md §10 no contiene una plantilla de reporte.