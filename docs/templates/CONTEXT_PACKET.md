# Paquete de contexto (plantilla)

Todo prompt de delegación a un subagente Claude, a Codex o a OpenRouter usa esta estructura y nada más. El orquestador la llena; el ejecutor no recibe historial de conversación.

```markdown
## Tarea
<id de TODO.md o nombre corto> · capa: L1 | L2 | L3 · riesgo: bajo | moderado | alto

## Objetivo
Una o dos frases. Qué debe existir al terminar.

## Criterios de aceptación (verificables)
- [ ] ...
- [ ] ...

## Archivos de entrada
- C:\ruta\absoluta\archivo.ts (líneas 10-80): por qué
- ...

## Símbolos relevantes
| Archivo | Símbolo | Por qué importa |
|---|---|---|

## Invariantes que NO deben cambiar
- dinero en minor units + ISO, nunca float;
- alcance Restaurant/Branch en toda consulta y mutación;
- ...

## Fuera de alcance
- ...

## Verificación
Comandos exactos que el ejecutor debe correr y cuyo resultado debe pegar en la salida:
- pnpm --filter <paquete> test
- pnpm --filter <paquete> typecheck
- pnpm --filter <paquete> lint

## Formato de salida esperado
1. Resumen de cambios (3-6 líneas).
2. Lista de archivos tocados.
3. Salida literal de los comandos de verificación.
4. Riesgos o dudas abiertas.
No pegues diffs completos en la salida; el orquestador los lee con `git diff`.
```

Reglas:

- un paquete = una tarea = un escritor;
- si un archivo de entrada supera 300 líneas, indica rango de líneas o pide primero un resumen L3;
- L3 sólo devuelve texto; nunca recibe permiso de escritura;
- L2 (Codex) trabaja en su propio worktree y nunca hace push, merge ni toca Supabase remoto;
- módulos de dinero, tenancy, esquema SQL y sync van a L1 `implementer-claude` con plan aprobado.
