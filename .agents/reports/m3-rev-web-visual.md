VEREDICTO: CORREGIR

- P1: ninguna.
- P2 `apps/web/e2e/visual/inventario.spec.ts:29`: la etiqueta `@visual-inventario` no coincide con ningún `grep` de `playwright.config.ts:25-27` (solo se excluye `@offline`), así que la spec corre en los proyectos `desktop` y `mobile` (24 tests, 12 duplicados) y además bajo `Pixel 7` (`isMobile/hasTouch`) con `test.use({viewport})` encima; `offline-kds.spec.ts` sí queda filtrada por `@offline`. Debe añadirse `@offline` al tag o un `grep` propio al proyecto.
- P3 `inventario.spec.ts:9`: `visual-verify-2026-11-26` está fechada un día adelante (hoy 2026-11-25).
- Correctas: `REPO_ROOT` = raíz (4 niveles); `offline-kds.spec.ts:26` conserva la carpeta por defecto al omitir `captureDir`; `INVENTORY_TAB_LABELS[tab]` con `exact:true` coincide con el `<button role="tab">{INVENTORY_TAB_LABELS[tab]}</button>` de `inventory-workspace.tsx`.

```
node -e "…new URL('../../../../', 'file:///C:/r/apps/web/e2e/visual/assert-ui.ts')"
/C:/r/

pnpm --filter @super-restaurant/web exec playwright test --list --grep "@visual-inventario"
Total: 24 tests in 1 file
```