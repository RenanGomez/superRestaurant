# Lecciones del loop autonomo

Maximo 150 lineas, curado por el orquestador. Cada fallo de CI repetido, hallazgo
P1/P2 de revision o tarea `parked` produce una regla concreta. Las reglas se
incluyen en `docs/agentic/WORKER_RULES.md` para todos los workers.

## Reglas activas

- En los briefs, los comandos de test se ejecutan con el cwd del paquete (`pnpm --filter X exec ...` corre en `apps/web`, etc.): usa rutas relativas al paquete (`node .test-dist/lib/...`), no a la raíz del worktree.
- dsh agota el turno si encadena demasiadas puertas: una sola cadena de verificación al final, y el informe se emite aunque quede algo `NO VERIFICADO`.
- Ningún worker commitea: el orquestador commitea, publica y fusiona desde el worktree.
- Si `gh pr create` falla con un error GraphQL transitorio, verifica `gh pr list --head <rama>` y usa el endpoint REST `gh api .../pulls`; no repitas la mutación.

## Proceso

- Una leccion por regla, en una sola frase accionable: "en X, siempre Y".
- Si una leccion se repite tres veces, se actualiza la plantilla de brief
  (`docs/templates/CONTEXT_PACKET.md`).
- El digest semanal propone lecciones nuevas y las que deben retirarse; el
  orquestador decide y edita este archivo.
