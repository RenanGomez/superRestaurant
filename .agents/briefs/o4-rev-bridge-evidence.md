# Revisión corta: PR #132 (evidencia financiera en release)

Lee el diff con `git diff main...origin/harness/o4-bridge-evidence` (o `git show origin/harness/o4-bridge-evidence:apps/web/src/lib/offline/web-sync-bridge.ts`). No escribas código, no commitees, no ejecutes nada.

Comprueba solo esto:
1. `countUnconfirmed` retiene el almacén con cualquier entrada **financiera en cualquier estado** y con cualquier estado no terminal.
2. Sigue purgando con terminales no financieras (`accepted`, `duplicate`, `rejected` no financiera).
3. Con lectura fallida (`-1`) no purga.
4. Las tres pruebas nuevas fallarían con el código anterior.

Responde en 10 líneas máximo, empezando por `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`, y luego los hallazgos como `P1|P2|P3 archivo:línea motivo`.
