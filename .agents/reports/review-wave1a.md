**Veredicto: CORREGIR**

- **P2** [field-hint.tsx](</C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/web/src/components/field-hint.tsx:52>): `tabIndex={-1}` impide acceder a la ayuda con teclado. Retirarlo y verificar apertura y cierre con teclado.
- **P2** [capture-customer.tsx](</C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/capture/capture-customer.tsx:185>): el estado visual usa `noteForAddress`, pero el mensaje usa `noteFor` y puede conservar una alerta obsoleta tras cambiar la dirección. Renderizar ambos desde la nota validada por firma.
- **P2** [capture-customer.tsx](</C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/capture/capture-customer.tsx:192>): el enlace añade `customerId`, pero el Directorio no lo consume; no abre la ficha indicada. Implementar la selección inicial o quitar el parámetro.
- **Verificación:** lectura estática del parche y archivos relacionados.
```text
Get-Content .harness/state/tmp/wave1a.patch -TotalCount 5
diff --git a/apps/web/src/app/app/app-nav.tsx b/apps/web/src/app/app/app-nav.tsx
index fbf487a3..312d1a3a 100644
--- a/apps/web/src/app/app/app-nav.tsx
+++ b/apps/web/src/app/app/app-nav.tsx
@@ -2,7 +2,7 @@
```
NO VERIFICADO: navegador y pruebas en ejecución; la revisión fue de solo lectura. No se escribió el reporte solicitado por el modo de filesystem de solo lectura.