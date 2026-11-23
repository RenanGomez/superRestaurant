# capture-address-state — hecha
Cambios: la nota de cada dirección se ata a firma version+contenido, así el «inválida» deja de aplicarse cuando la dirección cambia; el bloqueo de cobertura muestra CP/localidad («CP 85860 sin zona en Navojoa»); el enlace a Directorio lleva `?customerId=`.
Archivos: apps/web/src/app/app/capture/capture-customer.tsx
Motivo del servidor: `DeliveryZoneMatchResultV1` no expone campo de motivo (`not_covered` trae `zoneId`/`zoneName` null); el texto se deriva de `postalCode`/`locality` enviados, no se inventa.
Verificación: `LINT=0`; typecheck sin salida (ok); test abajo.
```
$ corepack pnpm -C apps/web test   # tests 11 · pass 11 · fail 0 | tests 7 · pass 7 · fail 0
TEST_EXIT=0
```
Riesgos: otro agente editaba `capture-workspace.tsx`/`capture-workspace.test.ts` en paralelo; typecheck falló de forma transitoria y quedó verde al estabilizarse. Sin cambios fuera del archivo asignado.
