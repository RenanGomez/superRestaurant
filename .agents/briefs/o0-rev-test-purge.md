# Brief o0-rev-test-purge (revision dsh · foco tests de o0-web-purge)

## Objetivo
Revisar el cambio de `o0-web-purge` y emitir veredicto explícito.

Diff: 182fbb6c...harness/o0-web-purge

Tiempo estimado: 10 min. Solo lectura del código de producción: no edites archivos del repo.

## Foco 2 — pruebas adversariales: por cada invariante que el autor afirma, comprueba que hay una prueba que falla si se rompe. Escribe y EJECUTA al menos una prueba adversarial propia (doble envío, pérdida de liderazgo, revocación, AAD de otro scope, timeout) en `.harness/state/tmp/`, sin tocar el código de producción, y pega la salida real. Una afirmación sin prueba ejecutable es P1.

## Qué revisar
1. Lee el diff adjunto (rango `182fbb6c...harness/o0-web-purge`). No explores el repo entero: solo los archivos del diff y sus consumidores directos.
2. Contrasta con el brief del autor en `.agents/briefs/o0-web-purge.md` y con `docs/adr/ADR-013.md` si el cambio es de inventario.
3. Comprueba si los comandos de puerta del informe del autor son coherentes con el código (no los re-ejecutes todos; ejecuta solo lo que necesites para tu foco).

## Formato de salida (obligatorio)
- Primera línea exactamente `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`.
- Lista de hallazgos con severidad `P1`/`P2`/`P3`, archivo:línea, qué falla y qué prueba lo demuestra.
- Si tu foco es `tests`, incluye el bloque con la prueba adversarial que escribiste y su salida real.
- Sin P1 abiertos el veredicto es APROBAR; cualquier P1 ⇒ CAMBIOS.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe. Sin evidencia ejecutada donde tu foco lo exige = NO VERIFICADO.
Aplica los criterios de `/ponytail-review`: bugs, seguridad, carga real, pruebas, qué sobra.
