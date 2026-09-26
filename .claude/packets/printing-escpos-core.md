## Tarea
printing-escpos-core · capa: L2 · riesgo: moderado

## Objetivo
Crear el paquete de workspace `packages/printing` (`@super-restaurant/printing`) con un codificador ESC/POS puro y un constructor de layout de "ticket de handoff" (entrega/recogida) que renderiza a bytes ESC/POS. Sin Bluetooth, sin I/O, sin adaptador de dispositivo: sólo encoder + layout + pruebas.

## Criterios de aceptación (verificables)
- [ ] `packages/printing/package.json`, `tsconfig.json`, `tsconfig.build.json`, `tsconfig.test.build.json` y `eslint.config.mjs` copian exactamente la estructura de `packages/domain` (mismos scripts `build`, `lint`, `typecheck`, `test`; `@super-restaurant/config` como devDependency; `exports` a `dist`). Dependencias de runtime permitidas: `@super-restaurant/domain` y `@super-restaurant/shared-types` como `workspace:*`; nada más.
- [ ] `src/escpos.ts`: encoder puro que acumula `Uint8Array` con `init`, `align(left|center|right)`, `bold(on|off)`, `text(string)` codificado en CP858 o CP1252 (elige una, documenta y cubre á é í ó ú ñ Ñ ¿ ¡ con prueba), `line`, `feed(n)`, `cut(partial|full)`, `raw(bytes)`, y `bytes()` que devuelve una copia inmutable.
- [ ] `src/handoff-ticket.ts`: `renderHandoffTicket(input)` recibe un objeto de entrada propio del paquete (`HandoffTicketInput`) construido a partir de los tipos reales `Order`/`OrderItem` de `packages/domain/src/order.ts` y `CaptureCustomerSnapshotV1`/`CaptureFulfillmentSnapshotV1` de `packages/shared-types/src/commercial-capture.ts`. Lee esos archivos antes de escribir; NO confíes en el bosquejo de tipos de este paquete. Renderiza: folio/orderId corto, canal, nombre del cliente, teléfono enmascarado a últimos 4 dígitos, dirección (streetLine, unit, locality, region, postalCode cuando existan), líneas con cantidad × nombre + modificadores + precio snapshot, subtotal/descuentos/total leídos del snapshot (nunca recalculados), instrucciones de entrega, fecha ISO recibida como string.
- [ ] Formateo de dinero: función pura interna `formatMinor(amountMinor, currency)` con `Intl.NumberFormat("es-MX")` y división por 100 sólo para render; documenta que asume 2 decimales y rechaza monedas con exponente distinto lanzando error tipado.
- [ ] Pruebas con `node:test` y `assert/strict`, mismo patrón que `packages/domain/src/money.test.ts`: encoder (secuencias exactas de bytes por comando, codificación de acentos), y ≥3 tickets completos con snapshot byte a byte (delivery con instrucciones, pickup sin dirección, ticket con descuento y modificadores). Incluye prueba de que el teléfono nunca aparece completo en los bytes.
- [ ] `src/index.ts` exporta sólo la API pública. Sin `any`, TypeScript 6 strict.
- [ ] `pnpm --filter @super-restaurant/printing build`, `lint`, `typecheck`, `test` en verde y `pnpm build` global incluye el paquete. Salida literal pegada.

## Archivos de entrada
- C:\tmp\sr-wt\printing-escpos-core\packages\domain\package.json, tsconfig.json, tsconfig.build.json, tsconfig.test.build.json, eslint.config.mjs: plantilla exacta a copiar.
- C:\tmp\sr-wt\printing-escpos-core\packages\config\eslint\base.mjs (4-82): reglas `domainRestrictedImports`; el paquete debe pasarlas.
- C:\tmp\sr-wt\printing-escpos-core\packages\domain\src\money.ts y money.test.ts: `Money` y patrón de pruebas.
- C:\tmp\sr-wt\printing-escpos-core\packages\domain\src\order.ts (48-120): tipos reales de Order/OrderItem/snapshots. Léelos completos.
- C:\tmp\sr-wt\printing-escpos-core\packages\shared-types\src\commercial-capture.ts (200-260): snapshots de cliente y cumplimiento.
- C:\tmp\sr-wt\printing-escpos-core\pnpm-workspace.yaml y turbo.json: autodescubrimiento.

## Símbolos relevantes
| Archivo | Símbolo | Por qué importa |
|---|---|---|
| packages/domain/src/money.ts | `Money` | amountMinor entero + ISO; nunca float |
| packages/domain/src/order.ts | `Order`, `OrderItem` | fuente de nombre/precio/modificadores congelados |
| packages/shared-types/src/commercial-capture.ts | `CaptureCustomerSnapshotV1`, `CaptureFulfillmentSnapshotV1` | datos de cliente y dirección |
| packages/config/eslint/base.mjs | `domainRestrictedImports` | prohíbe Nest/React/Prisma/red |

## Invariantes que NO deben cambiar
- Ningún archivo fuera de `packages/printing/**` se modifica (ni domain, ni shared-types, ni raíz).
- Dinero como minor units + ISO; el paquete sólo renderiza snapshots, nunca calcula totales.
- Sin red, storage, proceso, timers ni aleatoriedad: bytes deterministas.
- Teléfono enmascarado siempre; nunca imprimir PII más allá de nombre y dirección de entrega.

## Fuera de alcance
- Bluetooth, USB, colas de impresión, reintentos, adaptadores de dispositivo, KDS, UI.

## Verificación
- pnpm --filter @super-restaurant/printing build
- pnpm --filter @super-restaurant/printing lint
- pnpm --filter @super-restaurant/printing typecheck
- pnpm --filter @super-restaurant/printing test
- pnpm build

## Formato de salida esperado
1. Resumen (3-6 líneas). 2. Archivos creados. 3. Salida literal de los cinco comandos. 4. Riesgos o dudas. Commits locales con conventional commits (`feat(printing): ...`).
