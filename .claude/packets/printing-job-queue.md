# Paquete de contexto: printing-job-queue

## Tarea
printing-job-queue · capa L2 (Codex) · riesgo moderado

## Objetivo
Extender `packages/printing` con (a) interfaz `PrinterPort` como adaptador de puerto: `write(bytes: Uint8Array): Promise<void>` y `describe(): { kind: "bluetooth"|"usb"|"network"|"mock"; id: string }`; (b) `MockPrinterPort` en memoria que puede configurarse para fallar N veces; (c) cola pura determinística de trabajos de impresión con jobId (idempotente: dos veces = no-op), destino (`kds`|`printer`|`reprint`), bytes, estado `pending|delivered|failed`, intentos, último error; max intentos configurable; reintentos nunca duplican trabajo entregado. Métodos: `enqueue`, `deliverNext(port)`, `retry(jobId)`, `snapshot()` retorna lista congelada. Implementa la matriz de estados por destino que S6.3 (sección 4, líneas 64–67) y decisiones 4–5 en §5.1 de `docs/architecture/P2_ORDER_CHANGE_CANCELLATION_SLICE.md` requieren.

## Criterios de aceptación (verificables)
- [ ] `PrinterPort` interface con `write()` y `describe()` exactos; MockPrinterPort inyectable.
- [ ] `enqueue(jobId, destination, bytes)` idempotente: mismo jobId rechaza o ignora segunda vez.
- [ ] Estados: pending → delivered (éxito), pending → failed (agotados intentos).
- [ ] `deliverNext(port)`: retorna trabajo pending o null; llamadas sucesivas avanzan; marca delivered si éxito.
- [ ] `retry(jobId)` desde failed → pending; max intentos configurable (default 3); rechaza reintento sin límite.
- [ ] Snapshot retorna lista congelada `readonly` de trabajos sin PII en `lastErrorCode` (ej: "E_WRITE_TIMEOUT" no "Puerto /dev/USB0…").
- [ ] MockPrinterPort se falla con `.failNextN(count)` y lanza luego exactamente `count` veces antes de éxito.
- [ ] Timestamp: caller suministra `now: Date | number` (ms); nunca se usa `Date.now()` internamente.
- [ ] ≥8 casos de prueba: enqueue idempotente, entrega exitosa, agotamiento, reintento, snapshot congelado, fallos inyectados, rechazo de duplicado, transiciones de estado.

## Archivos de entrada
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\printing\src\escpos.ts (líneas 1–70): demostración de encoder sin I/O real; byte-exacto.
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\printing\src\escpos.test.ts (líneas 1–28): patrón de pruebas con `node:test` y `assert/strict`.
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\printing\src\index.ts (líneas 1–4): exportaciones actuales; agregar adaptadores.
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\printing\package.json (líneas 23–27): script test; registrar `print-job-queue.test.js`.
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\docs\architecture\P2_ORDER_CHANGE_CANCELLATION_SLICE.md (líneas 64–67, §5.1 decisiones 4–5): invariantes S6.3 y S6.1.

## Símbolos relevantes
| Archivo | Símbolo | Por qué importa |
|---|---|---|
| escpos.ts | `EscPosEncoder` | Demostración de generación Uint8Array sin I/O; sin timers, sin Date.now(). |
| escpos.test.ts | test() | Patrón node:test; assert/strict/deepEqual para bytes congelados. |
| index.ts | exports | Agregar PrinterPort, MockPrinterPort, PrintJobQueue. |
| P2_ORDER_CHANGE_CANCELLATION_SLICE.md §6.3 | "registrar por destino `pending \| delivered \| failed`" | Contrato exacto de cola: tres estados, reintento selectivo, sin duplicados. |
| payment.ts (patterns) | idempotencyKey, priorAttempt | Patrón existente en dominio: idempotencia en segundo intento, verificación exacta. |

## Invariantes que NO deben cambiar
- Ningún código en packages/printing accede a `Date.now()` ni timers; `now` viene del llamador siempre.
- `lastErrorCode` es string de código abstracto (ej: "E_PORT_TIMEOUT"), nunca ruta, IP, mensaje de proveedor.
- Snapshot retorna `readonly`, nunca mutable; llamador no puede mutar la lista interna.
- `jobId` (caller-supplied) determina idempotencia exacta; misma clave dos veces no crea trabajo nuevo.
- Queue no usa ORM, Prisma, NestJS, React, acceso a red; Pure TypeScript/Node, test-only mock.
- Retries nunca pueden duplicar `delivered` job: hash exacto de jobId + estado previo; CAS local.

## Fuera de alcance
- No implementar Bluetooth/USB/network concreto aún; MockPrinterPort es único real en esta tarea.
- No habilitar endpoint Nest, HTTP, DB, migration SQL ni conectar a KDS ahora; sólo dominio puro + pruebas.
- No offline sync, Cloud, persistence; queue vive sólo en memoria durante lifetime del servidor/proceso.
- No configuración de destino desde DB, catálogo o usuario; hardcoded en llamador por ahora.
- No WebSocket, evento KDS recovery, reimpresión manual real; S6.3 contempla esos detalles pero esta tarea es estructura.

## Verificación
```bash
cd C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant
pnpm --filter @super-restaurant/printing build
pnpm --filter @super-restaurant/printing lint
pnpm --filter @super-restaurant/printing typecheck
pnpm --filter @super-restaurant/printing test
```

## Formato de salida esperado
1. Resumen (3–6 líneas): qué se añadió a packages/printing (PrinterPort, MockPrinterPort, PrintJobQueue).
2. Archivos tocados: escpos.ts sin cambio; index.ts con tres exportaciones; test-dist/print-job-queue.test.js vía tsc.
3. Salida literal de lint/typecheck/test: `✓ 8+ pruebas pasaron`; ceros errores de lint/type.
4. Riesgos/dudas: ninguno si se sigue el patrón de escpos. Próxima tarea: adaptador NestJS.

## Nota arquitectónica
**Riesgo sugerido: moderado** — Ningún acceso a I/O real, pero idempotencia y máquina de estados requieren precisión. **Capa sugerida: L2** — Módulo aislado, puro, testeable; buen candidato para Codex. CodeGraph y tests existentes validan consumidores. **Decisión: S6.3 §4 líneas 64–67 y §5.1 decisiones 4–5** son fuentes directas. **Integración posterior**: S6.3 fan-out, KDS y nueva migración.
