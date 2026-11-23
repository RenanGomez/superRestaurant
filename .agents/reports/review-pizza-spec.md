**Veredicto: CORREGIR.**

- **P1 · Precio y orden:** N es por producto, pero no se define qué N rige al combinar dos productos personalizados ni en una selección mixta. Fijar identidad, asignación y ejemplos para cada combinación.
- **P1 · Precio y orden / Redondeo:** no se define cómo deduplicar una opción presente en ambas mitades cuando pertenece a grupos o productos con precios distintos. Especificar identidad, precio y alcance antes de aplicar N y redondeo.
- **P1 · SQL / Compatibilidad:** la propuesta admite dos mitades personalizadas, pero el dominio y ambas funciones SQL actuales las rechazan. Especificar el cambio versionado y probar también que las selecciones legadas conserven su comportamiento.
- **P2 · SQL / Pruebas:** «conservar idempotencia» y «doble envío» no precisan replay con payload idéntico, conflicto con payload distinto ni concurrencia. Definir esos resultados por actor y scope y añadir pruebas.
- **P2 · Snapshot / Pruebas:** falta exigir pruebas de historial tras cambiar catálogo y de aislamiento con referencias cruzadas de producto, grupo y opción. Añadirlas para confirmar inmutabilidad y tenancy.
- **NO VERIFICADO:** ejecución de pruebas y CodeGraph; no había herramienta CodeGraph disponible. §10 de AGENTS.md no contiene plantilla de reporte.
- **Archivo no creado:** la sesión está restringida a lectura. El informe se entrega aquí.
```text
rg -n '^## 10\.' AGENTS.md
225:## 10. Multi-restaurante, sucursales y autorización
```