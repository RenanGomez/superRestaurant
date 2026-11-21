# Brief menu-product-actions (M2, nivel C)

## Objetivo
Menú de tres puntos en cada producto con Duplicar, Archivar y Quitar; sección «Archivados» (smoke menu-dup).

## Alcance
- Editar `apps/web/src/app/app/menu/menu-catalog-editor.tsx` (acciones ~686-700; diálogo de confirmación de Quitar ~594; ubica por símbolo). Si creas un componente de menú, nuevo archivo en `apps/web/src/app/app/menu/`.
- Prohibido: API, SQL, git commit/push.

## Contexto mínimo
- Botón ⋯ en la posición actual de «Quitar», menú accesible (flechas, Escape, foco devuelto) con Duplicar, Archivar y Quitar. Se eliminan de la tarjeta el botón «Duplicar» y la casilla «Activo».
- Archivar pone `active=false` (`MenuProductV1.active` ya existe, sin migración). Los archivados salen de su categoría y van a una sección «Archivados» al final, **colapsada por defecto**; allí el ⋯ ofrece «Desarchivar».
- Quitar abre un modal propio (reutiliza el diálogo existente; nada de `confirm()`) y elimina el producto del borrador.
- Revisa que `ACTIVE_HINT` y textos que hablan de «Activo» queden coherentes.

## Hecho cuando
- lint, typecheck y test web en verde; test unitario de la lógica pura (separar activos/archivados) si la extraes a `lib/`.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Sin alert/confirm/prompt; targets de 44 px. Puertas desde `apps/web`: `corepack pnpm lint`, `typecheck`, `test` (tail -40). Informe en `.agents/reports/menu-product-actions.md` (≤12 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
