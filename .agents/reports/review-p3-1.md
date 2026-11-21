**VEREDICTO: CORREGIR**

- **P1** [menu.ts:793](</C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/packages/domain/src/menu.ts:793>) y [index.ts:1376](</C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/packages/shared-types/src/index.ts:1376>): ambos aceptan ingredientes de receta inexistentes o ajenos al grupo base. Validar referencias y scope en ambos límites; añadir pruebas negativas.
- **P1** [fraction-pricing.ts:747](</C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/packages/domain/src/fraction-pricing.ts:747>): el snapshot carece de `schemaVersion`, release, tamaño y estación por mitad exigidos por la especificación. Extender el contrato y comprobar su lectura fail-closed.
- **P2** [menu.ts:788](</C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/packages/domain/src/menu.ts:788>): dominio no aplica los límites de 24 grupos extra y 40 ingredientes de receta que aplica shared-types. Unificar límites y probar paridad.
- **NO VERIFICADO:** ejecución de pruebas y compatibilidad completa API/web/mobile; los scripts de prueba escriben y eliminan archivos, y el entorno es de solo lectura. CodeGraph no está disponible.
- **NO CREADO:** `.agents/reports/review-p3-1.md`; el entorno impide escribir. La sección 10 de AGENTS.md no contiene una plantilla de reporte.

```text
> rg -n '## 10\.' AGENTS.md
225:## 10. Multi-restaurante, sucursales y autorización
```