Now implementing the fix. First, add the derivation helper to the bridge:
## Estado
done — deviceId de sync por (tablet, actor) y orden registro→push asertado.

## Qué hice
- `syncDeviceIdForActor(base, actor)` deriva un UUID v4/variante `[89ab]` con `stableEntityId`; el mount usa ese id y la identidad base en localStorage queda intacta.
- Prueba multi-actor: mismo tablet, dos deviceId distintos, binding por actor simulado (sin 403); el test existente ahora asierta el orden real `["register","push"]`.

## Archivos tocados
- `apps/web/src/lib/offline/web-sync-bridge.ts` — helper + comentario de decisión.
- `apps/web/src/components/offline-runtime-mount.tsx` — deriva el id por actor.
- `apps/web/src/lib/offline/web-sync-bridge.test.ts` — orden y escenario multi-actor.

## Verificación
```powershell
. .\tools\agentic\use-node24.ps1; node -v; & $PNPM --filter @super-restaurant/web lint; & $PNPM --filter @super-restaurant/web typecheck; git diff --check
v24.19.0 / $ eslint --max-warnings=0 ... src / $ tsc --noEmit ... / git diff --check: clean
node --import ./test/proxy-esm-loader.mjs .test-dist/lib/offline/web-sync-bridge.test.js
# tests 14  # pass 14  # fail 0
```

## Riesgos / dudas
ninguna; el id base del navegador y el almacenamiento por actor no cambian.

## Notas propuestas
- El deviceId enviado al API es por actor; un segundo cajero no reutiliza la fila del primero.