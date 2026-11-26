# REGLA DURA: no escribas NINGÚN archivo, no uses `>` ni `$env:TEMP` ni `$env:USERPROFILE` (el sandbox lo rechaza y pierdes el turno). Lee siempre con `git show <sha>:<ruta>` y `Select-String` sobre la tubería.

# Brief m3-rev-grant-fix (revisión A · confirmación del fix P2)

Diff: 02a243d4..4bd759ab

Revisa SOLO el commit de corrección del P2 en el PR #122. No ejecutes PostgreSQL ni Playwright.

Comprueba que:

1. `parseMovementRequest` rechaza `compensatesMovementId` no nulo antes de cualquier SQL y el
   controlador responde 400 (no 500 ni 503).
2. No se rompe un `compensatesMovementId: null` explícito ni la ausencia del campo, y las
   transferencias siguen funcionando.
3. La unitaria nueva falla si alguien vuelve a aceptar la compensación silenciosa.
4. La prueba SQL de `42501` es correcta como `app_api` y no se traga otros errores.

Entrega `VEREDICTO: APROBAR|CORREGIR` con P1/P2/P3, archivo y línea.
