# Reglas para workers AO

Aplican a toda sesión de worker abierta por el orquestador. Si el brief contradice
este archivo, manda el brief y se anota la diferencia en el reporte.

## Alcance y contexto

- Lee `AGENTS.md` y `TODO.md` antes de tocar código; después, solo la sección del
  plan que el brief cita.
- Una sesión = una tarea = un alcance. No arregles «de paso» archivos fuera de las
  rutas del brief; si lo ves necesario, repórtalo y espera instrucción.
- Un brief sin «hecho cuando» verificable con un comando no se ejecuta: pregunta.
- No inventes requisitos, tablas, campos ni dependencias que el brief no pida.

## Git y PRs

- Trabaja en `ao/<tarea>` (o la rama que indique el brief) y abre un solo PR por
  tarea contra la rama que indique el brief.
- **Nunca** hagas push a `main` ni fusiones PRs. Tampoco force-push, rebase
  destructivo ni reescritura de historia compartida.
- Commits convencionales y pequeños (`feat(modulo): …`, `fix(modulo): …`); incluye
  el id del ítem. Haz commit y push en cada paso verde: el trabajo no se pierde.
- PR de menos de 400 líneas cambiadas sin contar tests ni generados. Si no cabe,
  parte el ítem y avisa en vez de entregar un PR gigante.
- No toques `pnpm-lock.yaml`, `packages/shared-types/**` ni `supabase/migrations/**`
  salvo que el brief lo autorice; son carriles de un solo escritor.

## Datos, SQL y dinero

- No toques SQL ni migraciones salvo que el brief lo diga expresamente.
- Nunca edites una migración ya aplicada: se corrige con una nueva.
- No ejecutes SQL persistente, ni despliegues, ni cambies secretos o datos reales.
- Dinero en enteros de unidad menor + ISO; sin float. Alcance Restaurant/Branch en
  toda consulta y mutación. El servidor revalida; el cliente no decide.

## Verificación

- Corre los gates del nivel del brief. Nivel D: `git diff --check`. Niveles B/C/A:
  `pnpm lint && pnpm typecheck && pnpm test` (con `--filter` si el brief lo acota).
- Pega en el PR la salida real de los comandos, no un resumen inventado.
- **No declares verificado lo que no probaste.** Si una prueba no se puede correr,
  dilo y deja el ítem en REVIEW, no en DONE.
- Si el nivel pide navegador, no hay verificación visual sin captura real y consola
  limpia.

## Bloqueos y lecciones

- Ante ambigüedad, fallo de cuota, sandbox o una decisión de producto: reporta el
  bloqueo (`ao report --needs-input` o `--stuck`) en vez de ampliar el alcance.
- Tras dos intentos fallidos del mismo ítem, detente y reporta; no sigas probando
  variantes.
- Cuando CI o revisión repitan un fallo, el orquestador agrega la regla a
  `docs/agentic/LESSONS.md`; este archivo se actualiza con esas reglas y se mantiene
  curado, breve y sin duplicados.
