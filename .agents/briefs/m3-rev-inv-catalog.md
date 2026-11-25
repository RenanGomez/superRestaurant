# Brief m3-rev-inv-catalog (revision dsh - foco invariants de m3-sql-catalog)

## Reglas de acceso (importante)
- Tu cwd es la raiz del repo principal. Puedes ejecutar git y usar `git show harness/m3-sql-catalog:<ruta>` para leer la rama.
- NO accedas a `C:\Users\<usuario>\harness-wt\**` ni a rutas fuera del repo: el sandbox lo rechaza y el run muere sin informe.
- Si necesitas ejecutar codigo de la rama, copia los archivos con `git show` a `.harness/state/tmp/m3-rev-inv-catalog/` y ejecutalos ahi. No modifiques archivos del repo.
- No encadenes comandos largos: un comando por paso, como maximo 10 pasos.

Diff: origin/main...harness/m3-sql-catalog

## Objetivo
Foco 1 - invariantes (AGENTS 8-12): dinero y cantidades enteras (sin float), idempotencia, scope Restaurant/Branch, inmutabilidad y auditoria (actor, motivo, timestamp). Revisa que ninguna ruta permita duplicar, cruzar tenant o editar evidencia. Si falta la prueba de un invariante, es P1.

## Que revisar
1. Lee el diff adjunto (rango `origin/main...harness/m3-sql-catalog`). Solo los archivos del diff y sus consumidores directos (con `git show`).
2. Contrasta con `.agents/briefs/m3-sql-catalog.md`.
3. Si necesitas correr algo, una sola ejecucion acotada en `.harness/state/tmp/m3-rev-inv-catalog/`.

## Formato de salida (obligatorio)
- La PRIMERA linea, exactamente: `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`.
- Luego los hallazgos, uno por linea: `P1|P2|P3 <archivo:linea> <que falla> <prueba que lo demuestra>`.
- Si tu foco es `tests`, incluye el bloque con la prueba adversarial y su salida real.
- Cualquier P1 abierto implica CAMBIOS. Maximo 20 lineas.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe.
