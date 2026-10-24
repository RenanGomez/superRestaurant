# SUB-001 — <Título corto y descriptivo>
Agente: [Nativo Gemini | Codex | Claude]
Nivel: [Trivial | Estándar | Complejo]
Modelo asignado: [flash_lite | flash | pro | codex-medium | sonnet | etc.]
Esfuerzo de razonamiento: [low | medium | high]

## Objetivo
[Una o dos frases exactas. Qué debe ser cierto y verificable al terminar.]

## Archivos
- Editable: `src/path/to/file.ext` (líneas X–Y si aplica)
- Solo lectura: `src/path/to/reference.ext`
- Contexto: `.agents/context.md`, `.agents/notes/<tema>.md`

## Restricciones
- No tocar ningún archivo fuera de los listados en "Editable".
- Mantener las convenciones y estilo de `.agents/context.md`.
- No introducir dependencias externas sin autorización explícita.
- Respetar los finales de línea existentes (CRLF / LF).

## Criterios de Aceptación
- [ ] Criterio 1: Funcionalidad implementada.
- [ ] Criterio 2: Pruebas unitarias cubriendo el caso de éxito y de borde.
- [ ] Criterio 3: Linter y build pasan sin advertencias nuevas.

## Verificación
`<comando exacto de verificación>`

## Formato de Salida
Generar reporte de máximo 15 líneas en `.agents/reports/SUB-001.md` siguiendo la plantilla.
