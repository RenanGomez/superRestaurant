## Estado
done — atajos de Captura reparados; puertas web verdes.
## Qué hice
- Alt/Ctrl disparan con foco en input (letra sola no), `event.code` respalda `event.key`, Alt+K y Escape añadidos; tabla: Alt+N crea con borrador abierto (reusa `createAfterConfirmation`), Alt+R resetea/vuelve, Escape cierra nota/no-venta, leyenda. Archivos: `lib/shortcut-dispatch.ts` (+test) y `capture/capture-workspace.tsx`.
## Verificación
```
$ corepack pnpm lint && corepack pnpm typecheck        # sin salida
$ corepack pnpm test; echo EXIT:$?                    # EXIT:0
$ grep -c "^ok " log; grep -c "not ok" log            # 412 ; 0
$ node .test-dist/lib/shortcut-dispatch.test.js | tail -3
# pass 8
# fail 0
```
## Riesgos / dudas — «flujo de confirmación existente» = `createAfterConfirmation`; el borrador previo queda durable. NO VERIFICADO en navegador real.
## Notas propuestas — ninguna.
