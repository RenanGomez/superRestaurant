# Brief o0-rev-test-leader (revision dsh - foco tests de o0-web-leader)

## Reglas de acceso (importante)
- Tu cwd es la raiz del repo principal. Puedes ejecutar git y usar `git show harness/o0-web-leader:<ruta>` para leer la rama.
- NO accedas a `C:\Users\<usuario>\harness-wt\**` ni a rutas fuera del repo: el sandbox lo rechaza y el run muere sin informe.
- Si necesitas ejecutar codigo de la rama, copia los archivos con `git show` a `.harness/state/tmp/o0-rev-test-leader/` y ejecutalos ahi. No modifiques archivos del repo.
- No encadenes comandos largos: un comando por paso, como maximo 10 pasos.

Diff: 182fbb6c...harness/o0-web-leader

## Objetivo
Foco 2 - pruebas adversariales: por cada invariante que el autor afirma, comprueba que hay una prueba que falla si se rompe. Escribe y EJECUTA al menos una prueba adversarial propia (doble envio, perdida de liderazgo, revocacion, AAD de otro scope, timeout) y pega la salida real. Una afirmacion sin prueba ejecutable es P1.

## Que revisar
1. Lee el diff adjunto (rango `182fbb6c...harness/o0-web-leader`). Solo los archivos del diff y sus consumidores directos (con `git show`).
2. Contrasta con `.agents/briefs/o0-web-leader.md`.
3. Si necesitas correr algo, una sola ejecucion acotada en `.harness/state/tmp/o0-rev-test-leader/`.

## Formato de salida (obligatorio)
- La PRIMERA linea, exactamente: `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`.
- Luego los hallazgos, uno por linea: `P1|P2|P3 <archivo:linea> <que falla> <prueba que lo demuestra>`.
- Si tu foco es `tests`, incluye el bloque con la prueba adversarial y su salida real.
- Cualquier P1 abierto implica CAMBIOS. Maximo 20 lineas.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe.
