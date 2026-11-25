# Cierre de M2 (offline) — 2026-11-25

Cierre formal de la Fase 3 con la evidencia disponible. Lo que depende de humanos o del remoto queda marcado y no bloquea M3.

## Evidencia en `main`

| Pieza | PR | Verificación |
|---|---|---|
| Contratos y motor de sync | #31 | unitarias de dominio y sync-engine |
| Merge de dominio y conflictos | #36, #37, #53, #71 | matriz de conflictos + PG17 multi-dispositivo |
| SQL de sync (ledger, dedup, changelog, revisión) | #39 | pg-verify desde cero |
| `POST /sync/push` | #60 | integración + PG |
| Pull por cursor y revisión manual | #65 | integración + PG |
| `POST /sync/devices` y registro desde el puente | #79, o0-devices-fix | 6 pruebas API + 14 del puente |
| Almacén cifrado web (AES-GCM, AAD con scope, purga, rotación) | #62, #74 | 13 + 15 pruebas |
| Líder entre pestañas y protocolo `STORAGE_COMMIT_FAILED` | #73 | 4 pruebas |
| Almacén cifrado mobile (SQLCipher, DEK, purga) | #56, #66 | 11 + 14 + 10 + 8 pruebas |
| Banner y cola mobile | #63 | 6 pruebas del ciclo + 53 previas |
| PWA, barra de estado, POS offline con efectivo, caché KDS | #54, #58/#67, #59 | suites de web/KDS + `e2e:offline` |
| Aserciones visuales §5.3 | #76 | 17 pruebas + spec `@offline-visual` |
| Matriz offline y runbook | #57 | documento |

## Pendiente (no bloquea M3)

1. **Migraciones remotas** `20261121000100` y `20261123000300`…`000600`: no aplicadas en el Supabase de desarrollo. Procedimiento y comando exacto en `docs/runbooks/`; queda como lote BLOCKED hasta ejecutarlo con la sesión con permisos.
2. **Verificación visual real** del KDS offline y de IndexedDB: el spec `@offline-visual` corre con `E2E_VISUAL=1` contra entorno local; falta la captura para la revisión estética humana.
3. **Dispositivo iOS/Android real**: exclusión de backup iOS, `PRAGMA cipher_version` y Keychain solo se comprueban en Development/EAS Build.
4. **Impresora Bluetooth física**: el puerto existe (#42); falta prueba con hardware.

## Riesgos aceptados

- La clave no extraíble del almacén web vive en el mismo IndexedDB y no protege frente a XSS (ADR-005 §4.2).
- `packages/sync-engine` revoca el scope si el dispositivo no está registrado; el puente ya registra antes del primer push, pero un transporte sin `registerDevice` conserva el camino antiguo (deuda P2 en `debt.md`).
