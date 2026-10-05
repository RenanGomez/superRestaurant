# web-caja-cobro-corte-r2 (resolver conflicto materializado y alinear con el API final)

## Tarea
web-caja-cobro-corte-r2 · capa: L2 (Codex, `-Resume`) · nivel C. Worktree `C:\tmp\sr-wt\web-caja-cobro-corte`.

## Situación
El orquestador ejecutó `git merge main` en este worktree (main ya integró el API de caja con dos correcciones posteriores a tu base: `change = tendered − amount − tip` y el parser del reporte exige `tipsMinor/cashTipsMinor/movementCount/movements`). Hay marcadores de conflicto sólo en `apps/web/src/lib/finance.test.ts` (ambos lados actualizaron la fixture del reporte). **No ejecutes comandos `git`**; edita archivos. El orquestador commitea el merge.

## Criterios
- [ ] `finance.test.ts` sin marcadores, conservando las pruebas de ambos lados (fixture completa del reporte y la prueba de rechazo del reporte viejo de main).
- [ ] Alinear la pantalla con la regla final: el cambio que muestra la UI viene del `POST /payments/quote` (ya descuenta la propina); el texto de ayuda dice «Cambio después de propina»; el botón «Cobrar» se deshabilita si el recibido no cubre cobro + propina (el servidor también lo rechaza).
- [ ] Puertas `pnpm --filter @super-restaurant/web lint && typecheck && test && build` y `git diff --check`.
- [ ] Informe de tres líneas. No hagas commit.
