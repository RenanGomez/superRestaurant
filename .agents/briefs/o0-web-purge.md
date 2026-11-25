# Brief o0-web-purge · ronda 2 (nivel A · corrige hallazgos de revisión)

## Contexto
Ronda 1 ya está commiteada en tu rama (`apps/web/src/lib/offline/sync-store.ts`, `sync-purge.ts`, `sync-purge.test.ts`). La revisión de invariantes devolvió `VEREDICTO: CAMBIOS`. Corrige SOLO lo siguiente, sin tocar `sync-leader.ts` ni el resto de la app.

Tiempo estimado: 25 min.

## Correcciones obligatorias
### P1 — un almacén bloqueado o en cuarentena no se puede purgar ni rotar
`purgeReplica`, `purgeAll`, `purgeForScope` y `rotateKey` deben fallar cerrado con `STORAGE_LOCKED` o `STORAGE_QUARANTINED` cuando el `META` del dispositivo está marcado, antes de borrar o re-cifrar nada. Nunca se elimina la clave de un almacén bloqueado (la evidencia debe seguir siendo inspeccionable). Añade prueba: almacén bloqueado con evidencia → `purgeAll()` y `rotateKey()` lanzan y los slots/claves siguen intactos; lo mismo en cuarentena.

### P1 — aislamiento de `purgeForScope`
La prueba actual solo tiene un scope. Añade dos scopes (`restaurantA|branchA` y `restaurantB|branchB`) con su réplica y su outbox, purga uno y afirma con aserciones explícitas que la réplica y la evidencia del otro siguen legibles y que su clave no se retiró.

### P2 — compatibilidad de AAD v1 → v2
La ronda 1 cambió la AAD a v2 (con scope). Un almacén creado con v1 quedaría ilegible y en cuarentena. Implementa lectura dual: al descifrar acepta `sr-sync-v1` y `sr-sync-v2` y re-cifra en v2 en la siguiente escritura (o marca `aadVersion` en `META`); nunca declares `STATE_CORRUPT` por un slot v1 válido. Añade prueba de upgrade: escribe con AAD v1, abre con el código nuevo, `loadState` funciona y tras un `commit` el slot queda en v2.

### P3 — evidencia previa tras rotación
Hoy `rotateKey` borra la clave anterior y el slot inactivo queda ilegible. Conserva la clave del slot inactivo hasta el siguiente `commit` (o documenta y prueba que `inspectPreviousEvidence` devuelve `null` de forma determinista, sin cuarentena). Elige la opción con menos código y pruébala.

### P3 — normalización de scope
`purgeForScope` debe comparar identificadores normalizados (UUID case-insensitive) para no purgar cero filas en silencio; añade la prueba.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/web lint
& $PNPM --filter @super-restaurant/web typecheck
Push-Location apps/web
& $PNPM exec tsc --ignoreConfig --target ES2024 --module ESNext --moduleResolution Bundler --lib ES2024,DOM --types node --outDir .test-dist --rootDir src --strict --skipLibCheck src/lib/offline/sync-store.ts src/lib/offline/sync-store.test.ts src/lib/offline/sync-purge.ts src/lib/offline/sync-purge.test.ts
node .test-dist/lib/offline/sync-store.test.js
node .test-dist/lib/offline/sync-purge.test.js
Pop-Location
```
`pnpm exec` corre en el directorio del paquete: `node .test-dist/...` va dentro de `apps/web`, no en la raíz del worktree.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con los bloques de comando y su salida real, y una línea por hallazgo indicando cómo quedó. Sin evidencia = NO VERIFICADO.
Aplica Ponytail: cambio más pequeño correcto, sin recortar validación, seguridad ni pruebas.
