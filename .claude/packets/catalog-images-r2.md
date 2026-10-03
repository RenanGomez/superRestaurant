# catalog-images-r2 (addendum; `codex exec review` sobre 2882194, log `.claude/runs/catalog-images-review-r1.log`)

## Tarea
catalog-images-r2 · capa: L1 (`implementer-claude`, mismo escritor) · riesgo: alto · nivel A (contrato compartido, arranque del API, idempotencia). La migración `20261004000100` no está aplicada: si hace falta, edítala en sitio.

## Hallazgos a cerrar
- [P1] `packages/shared-types/src/index.ts:~1000`: `imagePath` obligatorio rompe productores existentes (el verificador de tenencia construye comandos sin el campo, y clientes previos también). Hacer el campo **opcional en entrada** (`imagePath?: string | null`; ausente ⇒ `null`) tanto en el comando `SaveMenuCatalogCommandV1` como en cualquier parser de release que consuman mobile/kds, y **siempre presente** (`string | null`) en la salida normalizada. Revertir los ajustes de fixtures que ya no hagan falta; mantener la prueba de que `imagePath` con forma inválida se rechaza. Verificar que el verificador de tenencia (`menuCatalogCommand()` en operations) vuelve a parsear.
- [P1] `apps/api/src/app.module.ts:213-216`: la factoría del adaptador de Storage lanza al arrancar si falta `SUPABASE_SECRET_KEY`. Hacerla perezosa: el módulo arranca siempre; `POST /menu/images` responde `503 { code: "MENU_IMAGES_UNCONFIGURED" }` (o el código equivalente del patrón del módulo) cuando falte la configuración, y la lee en el primer uso. Prueba unitaria del caso sin configuración. Documentar en ADR-011 las variables requeridas.
- [P2] `apps/api/src/menu-catalog-images.ts:67-71`: reintento con la misma `idempotencyKey` crea un segundo objeto huérfano. Derivar el nombre del objeto de forma determinista del comando (uuid derivado con SHA-256 de `restaurantId|actorId|idempotencyKey`, misma técnica `derivedUuid` de `orders.ts`), subir con `x-upsert: false` y tratar el 409 de Storage («already exists») como replay devolviendo el mismo `imagePath`/`publicUrl`; cualquier otra diferencia (target o MIME distintos bajo la misma clave) → conflict. Pruebas con adaptador falso: reintento idéntico → mismo path sin segunda subida efectiva; misma clave con target distinto → conflict.

## Criterios
- [ ] Puertas: shared-types test/typecheck/lint/build; api test/typecheck/lint/build; web lint/typecheck/test/build (toca fixtures y editor); mobile y kds typecheck.
- [ ] Sonda SQL local si la migración cambia. Commits `fix(shared-types)`, `fix(api)`, `docs(adr)`. Informe breve.
