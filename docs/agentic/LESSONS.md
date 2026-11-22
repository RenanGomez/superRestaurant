# Lecciones del loop autonomo

Maximo 150 lineas, curado por el orquestador. Cada fallo de CI repetido, hallazgo
P1/P2 de revision o tarea `parked` produce una regla concreta. Las reglas se
incluyen en `docs/agentic/WORKER_RULES.md` para todos los workers.

## Reglas activas

- Aun sin lecciones registradas.

## Proceso

- Una leccion por regla, en una sola frase accionable: "en X, siempre Y".
- Si una leccion se repite tres veces, se actualiza la plantilla de brief
  (`docs/templates/CONTEXT_PACKET.md`).
- El digest semanal propone lecciones nuevas y las que deben retirarse; el
  orquestador decide y edita este archivo.
