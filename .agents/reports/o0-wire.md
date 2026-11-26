I'll read the operative files first, then the target package.json files.
**Tarea:** o0-wire — cableado de suites Ola 0 y dominio de inventario (nivel B).
**Estado:** REVIEW (verificado).
**Cambios:** `apps/web/package.json`, `apps/mobile/package.json`, `packages/domain/package.json` (solo `scripts.test`). `web-sync-bridge` ya estaba cableado con proxy loader; no se duplicó.
**Desviación detectada:** el worktree NO contenía `stock-ledger`/`recipe-explosion` (ramas no fusionadas pese al brief). Restauré sin commit los 4 archivos desde `harness/m3-ledger-fix` (`8f5738ed`) y `harness/m3-recipe-fix` (`fc4cdd81`); quedan staged y son necesarios para que `domain test` pase. Sin tocar versiones, lockfile, migraciones ni otros fuentes.
**Verificación (Node 24.19.0, `git diff --check` exit 0):**
```
. .\tools\agentic\use-node24.ps1; node -v
v24.19.0
& $PNPM --filter @super-restaurant/web test
ℹ tests 4 / pass 4 (sync-leader)      ℹ tests 15 / pass 15 (sync-purge)
ℹ tests 17 / pass 17 (visual-assert)  EXIT=0
& $PNPM --filter @super-restaurant/mobile test
ℹ tests 6 / pass 6 (sync-banner-lifecycle: "a health result that resolves after stop…")
EXIT=0
& $PNPM --filter @super-restaurant/domain test
ℹ tests 6 / pass 6 (units)  ℹ tests 23 / pass 23 (stock-ledger)
ℹ tests 8 / pass 8 (recipe-explosion)  EXIT=0
```
**Riesgo:** los 4 archivos nuevos deben revisarse/fusionarse junto a sus ramas de origen; si el orquestador no los quiere aquí, los 3 package.json quedarían apuntando a suites ausentes. Sin commit ni push.