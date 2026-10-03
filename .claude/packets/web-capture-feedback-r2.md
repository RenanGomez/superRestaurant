# web-capture-feedback-r2 (addendum; `codex exec review` sobre el commit de captura, log `.claude/runs/web-capture-feedback/review-r1.log`)

## Tarea
web-capture-feedback-r2 · capa: L2 (Codex) · nivel C (`apps/web/src/app/app/capture/*`). Base: HEAD actual de `codex/web-capture-feedback` en `C:\tmp\sr-wt\web-capture-feedback`.

## Decisiones del orquestador sobre los tres P2
- **Precio estimado en cliente** (`capture-selection.ts:36-55`): se mantiene por decisión registrada en PROJECT_NOTES (2026-10-01): es la suma de precios que el servidor ya entregó en el release, etiquetada «Estimado», y el precio definitivo lo fija el servidor al agregar la línea. No lo cambies; sólo asegúrate de que la etiqueta diga «Estimado» y de que, si el release no trae precio para algún modificador, no se muestre cifra (texto «se confirma al agregar»). Queda en TODO un endpoint nivel B de cotización previa.
- **Varios turnos abiertos** (`capture-workspace.tsx:775-776`): no puede ocurrir; la base de datos impone un único turno abierto por sucursal (índice único en `operational_shifts`). Sin selector. Si la respuesta trajera más de uno, trátalo como error de datos: botón deshabilitado con «Hay más de un turno abierto; avisa al administrador».
- **Identificador de borradores** (`capture-workspace.tsx:852-855`): corrígelo. Mientras la bandeja no traiga cliente, cada fila muestra un folio corto legible (los últimos 6 caracteres del id en mayúsculas, p. ej. «B02748E9» como hace caja) junto con canal y hora; cuando llegue el nombre del cliente (paquete API en curso), el folio pasa a segunda línea. Nunca «Sin cliente» como único texto.

## Criterios
- [ ] Los dos ajustes anteriores con prueba unitaria del helper de folio corto.
- [ ] Puertas `pnpm --filter @super-restaurant/web lint && typecheck && test && build`.
- [ ] Informe breve. No hagas commit.
