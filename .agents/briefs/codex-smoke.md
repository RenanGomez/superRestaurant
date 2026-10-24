# codex-smoke — prueba trivial de sólo lectura del lanzador común
Agente: Codex   Nivel de rigor: C   Complejidad: Trivial

## Objetivo
Comprobar que el lanzador `.harness/bin/agent.ps1 -Engine codex` funciona de punta a punta sin escribir nada.

## Archivos (sólo lectura)
- apps/web/e2e/routes.ts
- apps/web/package.json (sólo la sección "scripts")

## Tarea
1. Cuenta cuántas rutas hay en `APP_ROUTES` y cuántas en `PUBLIC_ROUTES` de `apps/web/e2e/routes.ts`.
2. Lista los nombres de los scripts de `apps/web/package.json` que empiezan por `e2e`.

## Restricciones
- No modificar ningún archivo. No ejecutar comandos de instalación ni de red.

## Criterios de aceptación
- El reporte contiene los dos conteos y la lista de scripts, y nada más.

## Verificación
Ninguna (sólo lectura).

## Formato de salida
Reporte según `.harness/ORCHESTRATOR.md` §8, en `.agents/reports/codex-smoke.md`, máximo 15 líneas.
