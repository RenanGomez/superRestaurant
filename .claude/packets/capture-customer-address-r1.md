# capture-customer-address-r1 · elegir cliente en un paso y resolver la dirección sin salir de la captura

## Tarea
capture-customer-address-r1 · capa L1 `implementer-claude` · nivel C (`apps/web/src/app/app/capture/capture-workspace.tsx`, nuevo `capture-customer.tsx` si conviene extraer la sección, `apps/web/src/app/app/capture/actions.ts` sólo para reexportar `customerDirectoryAction` si hace falta) · riesgo medio por tamaño del archivo (1424 líneas). Rama `claude/capture-customer-address-r1` desde `main` **después** de integrar `claude/capture-ux-r1`. No tocar `apps/api`, `packages/*` ni SQL: todas las operaciones existen ya en `apps/web/src/lib/customer-directory.ts` (`search`, `detail`, `profile`, `address`, `validate`) vía `customerDirectoryAction` de `apps/web/src/app/app/customers/actions.ts`.

## Hallazgos de Emmanuel (2026-11-01)
1. Flujo contraintuitivo: buscar → elegir candidato → «Elegir teléfono» → «Cliente guardado». Si el cliente tiene un solo teléfono, el paso sobra.
2. Al elegir un cliente no se ven sus datos ni su dirección para confirmar con él «¿esta es su dirección?».
3. El paso «5. Confirmar» dice «Falta guardar un cliente y una dirección validada para confirmar el domicilio» aunque el cliente ya tiene dirección; la sección «3. Entrega · dirección validada» no la muestra o la muestra deshabilitada («Pendiente de validación») y sólo ofrece un enlace a `/app/customers`. No se puede capturar ni validar una dirección ahí mismo.

## Cambios
1. **Selección en un paso.** Al tocar un candidato: si tiene un teléfono, `selectCustomer(contactId)` de inmediato; si tiene varios, mostrar los teléfonos como opciones inline dentro de la misma tarjeta (sin sección aparte). La sección «Elegir teléfono» desaparece.
2. **Tarjeta del cliente.** Debajo del buscador, una tarjeta con nombre, teléfono elegido y la lista de direcciones del cliente, cada una con: etiqueta, calle, colonia, localidad, CP y su estado para esta sucursal («Validada», «Sin validar», «Fuera de cobertura» cuando `validate` lo diga). Botón «Usar esta dirección» por fila; si no está validada, el botón ejecuta `validate` con la misma `customerDirectoryAction` y, si queda validada, continúa con `selectAddress(addressId, version)` sin otro toque. Si la validación falla por cobertura, mostrar el motivo en la fila y dejarla deshabilitada.
3. **Editar y agregar dirección inline.** Botón «Editar» por fila y «Agregar dirección» al final: formulario inline con los campos de `CustomerAddressFieldsV2` (reutilizar el formulario de `apps/web/src/app/app/customers/customer-editor.tsx` extrayéndolo a un componente compartido si es razonable; si no, duplicar sólo los campos y anotar la deuda). Guardar llama a `address`, luego `validate`, luego `selectAddress`. Errores de versión (`conflict`) se muestran con «Actualizar» que recarga el `detail`.
4. **Mensaje de confirmación.** El texto «Falta guardar un cliente y una dirección validada…» se mantiene sólo cuando de verdad falta; enlazar con un botón «Ir a la dirección» que hace scroll a la tarjeta. El enlace a Directorio se conserva como secundario.
5. Mantener `data-testid="rehydrated-customer-snapshot"` y todo lo que lean `apps/web/e2e/*` y los tests existentes de `capture-workspace`.

## Invariantes
Sin `any`, LF, sin `alert/confirm/prompt`, targets de 44 px, textos en español. El servidor sigue decidiendo validación y cobertura; la UI sólo muestra lo que devuelve. PII sólo en cuerpos POST de server actions.

## Verificación (Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía `node "<node24>\node_modules\corepack\dist\pnpm.js"`)
- `pnpm --filter @super-restaurant/web lint`, `typecheck`, `test`, `build`.
- Navegador con sesión (`apps/web/playwright/.auth/user.json` del checkout principal, copiar y borrar): cliente «Emmanuel Gomez · 6622751352» → un toque lo selecciona, se ve su dirección, «Usar esta dirección» valida y la deja marcada, el paso 5 permite confirmar. Agregar una dirección nueva desde la captura y usarla. Repetir a 390×844. Documentar la brecha si no hay sesión.

## Formato de salida
Resumen, archivos, salida literal de las puertas, brecha de verificación, riesgos. Commit local `feat(web-capture): ...`. Sin merge ni push.
