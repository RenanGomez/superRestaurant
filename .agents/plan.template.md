# Plan de Trabajo y Estado de Tareas

> Mantenido activamente por el Orquestador. Refleja el estado en tiempo real.
> Estados válidos de tareas de usuario: TODO | IN_PROGRESS | REVIEW | DONE | BLOCKED | CANCELLED
> Estados de subtareas: pendiente | en curso | hecha | bloqueada

---

## Tarea en Curso

### [T-001] Título de la tarea activa
- **Estado:** IN_PROGRESS
- **Objetivo:** [Descripción clara de lo que debe ser cierto al finalizar]
- **Subtareas:**
  - [x] `SUB-001` [Descripción de subtarea hecha] (`hecha`)
  - [/] `SUB-002` [Descripción de subtarea en curso] (`en curso`)
  - [ ] `SUB-003` [Descripción de subtarea pendiente] (`pendiente`)
- **Siguiente acción:** [Detalle inmediato de lo que el orquestador lanzará a continuación]

---

## Tareas Pendientes (TODO)

- [ ] `[T-002]` [P1] [Descripción corta] — Dependencias: ninguna
- [ ] `[T-003]` [P2] [Descripción corta] — Dependencias: T-002

---

## En Revisión (REVIEW)

*(Tareas verificadas por el orquestador esperando confirmación final del usuario)*

- `[T-000]` [Título] — [Comando de verificación ejecutado y resultado]

---

## Bloqueadas (BLOCKED)

- `[T-XXX]` [Título] — Motivo del bloqueo: [esperando decisión del usuario / recurso externo]
