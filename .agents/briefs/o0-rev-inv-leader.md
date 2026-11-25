# Brief o0-rev-inv-leader (revision dsh · foco invariants de o0-web-leader)

## Objetivo
Revisar el cambio de `o0-web-leader` y emitir veredicto explícito.

Diff: 182fbb6c...harness/o0-web-leader

Tiempo estimado: 10 min. Solo lectura del código de producción: no edites archivos del repo.

## Foco 1 — invariantes (AGENTS §8–§12): dinero y cantidades enteras (sin float), idempotencia, scope Restaurant/Branch, inmutabilidad y auditoría (actor, motivo, timestamp). Revisa que ninguna ruta permita duplicar, cruzar tenant o editar evidencia. Si falta una prueba de un invariante, es P1.

## Qué revisar
1. Lee el diff adjunto (rango `182fbb6c...harness/o0-web-leader`). No explores el repo entero: solo los archivos del diff y sus consumidores directos.
2. Contrasta con el brief del autor en `.agents/briefs/o0-web-leader.md` y con `docs/adr/ADR-013.md` si el cambio es de inventario.
3. Comprueba si los comandos de puerta del informe del autor son coherentes con el código (no los re-ejecutes todos; ejecuta solo lo que necesites para tu foco).

## Formato de salida (obligatorio)
- Primera línea exactamente `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`.
- Lista de hallazgos con severidad `P1`/`P2`/`P3`, archivo:línea, qué falla y qué prueba lo demuestra.
- Si tu foco es `tests`, incluye el bloque con la prueba adversarial que escribiste y su salida real.
- Sin P1 abiertos el veredicto es APROBAR; cualquier P1 ⇒ CAMBIOS.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe. Sin evidencia ejecutada donde tu foco lo exige = NO VERIFICADO.
Aplica los criterios de `/ponytail-review`: bugs, seguridad, carga real, pruebas, qué sobra.
