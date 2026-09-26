# Auditor externo de documentación de proyecto

Estado: implementación v0.1 en `REVIEW`. Fecha: 2026-09-24.

## 1. Decisión humana y objetivo

El dashboard será una aplicación local independiente de `superRestaurant`, reutilizable con cualquier repositorio que contenga `AGENTS.md`, `TODO.md`, `PROJECT_NOTES.md` y `HANDOFF.md`. El código, dependencias, build, configuración local y journal del auditor vivirán en su propio repositorio. `superRestaurant` será sólo uno de sus repositorios auditados.

La herramienta debe permitir:

- comprender el estado y porcentaje del proyecto;
- revisar los cuatro documentos operativos y otros Markdown permitidos;
- filtrar tareas por fase, prioridad y estado;
- marcar transiciones como `IN_PROGRESS`, `REVIEW` o `DONE` conforme a las reglas del repositorio;
- añadir notas a `PROJECT_NOTES.md` y cortes a `HANDOFF.md`;
- editar `AGENTS.md` con diff, motivo y confirmación reforzada;
- entender cambios Git y evidencia reciente sin ejecutar comandos arbitrarios;
- cambiar entre repositorios compatibles sin instalar código dentro de ellos.

El auditor no forma parte del POS, no se despliega con los proyectos auditados y no accede a sus bases de datos, servicios, secretos o archivos fuera de la lista permitida.

## 2. Forma de uso

Primera entrega recomendada: aplicación web local iniciada mediante CLI.

```text
project-doc-auditor open --root "C:\ruta\al\repositorio"
```

El comando:

1. resuelve y valida la raíz por `realpath`;
2. detecta los documentos compatibles;
3. inicia un servidor sólo en `127.0.0.1` y un puerto libre;
4. genera un token efímero para la sesión;
5. abre el navegador en la vista del repositorio;
6. no modifica ningún archivo durante el descubrimiento.

Los repositorios recientes se guardan en el directorio de datos del auditor, nunca dentro del repositorio auditado. Una envoltura de escritorio puede evaluarse después; no es necesaria para el MVP.

## 3. Compatibilidad y detección

### 3.1 Convención mínima

Un repositorio es compatible si contiene en su raíz:

- `AGENTS.md`;
- `TODO.md`;
- `PROJECT_NOTES.md`;
- `HANDOFF.md`.

El plan maestro, `README.md` y `docs/**/*.md` son opcionales. La ausencia de un documento requerido deja el repositorio en modo diagnóstico/read-only y muestra la corrección necesaria; nunca se crean archivos automáticamente.

### 3.2 Perfil por repositorio

El auditor mantiene externamente un perfil identificado por la ruta canónica y una huella inicial. El perfil puede configurar:

- etiquetas visibles y archivo de plan principal;
- estados y transiciones permitidas;
- patrón de tareas;
- prioridades/fases;
- documento destino para notas y handoff;
- Markdown adicional permitido.

La detección inicial propone estos valores leyendo `AGENTS.md` y `TODO.md`, pero no inventa reglas. Si la máquina de estados no puede determinarse con confianza, las tareas se muestran sin botones de mutación hasta que el usuario confirme el perfil. No se codifican reglas específicas de `superRestaurant` en el producto genérico.

Una futura opción permitirá exportar un manifiesto portable, pero el MVP no añade `.project-auditor.json` ni otra metadata al repositorio.

## 4. Experiencia de usuario

Una sola aplicación con cinco vistas simples:

### Resumen

- selector de repositorio y estado de compatibilidad;
- tarjetas por estado;
- porcentaje aprobado (`DONE / total`);
- porcentaje con trabajo visible (`DONE + REVIEW + IN_PROGRESS` sobre total);
- avance por fase/prioridad;
- tarea activa, bloqueos y siguiente acción;
- última actualización de documentos y Git;
- advertencia permanente: el conteo de tareas no equivale a esfuerzo ni readiness.

### Tareas

- lista o tablero filtrable por texto, fase, prioridad y estado;
- detalle con nota, referencias en handoff/notas y cambios Git asociados cuando sean detectables;
- sólo transiciones autorizadas por el perfil;
- nota obligatoria para cambios que las reglas del repositorio exijan;
- `REVIEW → DONE` presentado expresamente como aprobación humana cuando así lo defina `AGENTS.md`.

### Documentos

- navegación por secciones de los cuatro archivos obligatorios y Markdown permitido;
- búsqueda global con fragmentos;
- vista interpretada y vista fuente;
- enlaces internos por encabezado;
- HTML embebido mostrado como texto, no ejecutado.

### Actividad

- últimos commits, estado del worktree y archivos modificados;
- resumen de los handoffs más recientes;
- pruebas, riesgos, bloqueos y migraciones extraídos como evidencia textual, nunca inferidos como hechos si el documento no los declara;
- diff de las mutaciones hechas por el auditor y opción de revisar el respaldo externo.

### Configuración

- editar el perfil externo del repositorio;
- revisar y editar `AGENTS.md` con preview, diff y motivo;
- gestionar la allowlist de Markdown sin permitir rutas fuera de la raíz;
- ver diagnósticos del parser y elementos no reconocidos.

## 5. Arquitectura propuesta

Crear un repositorio independiente, por ejemplo `project-doc-auditor`, con Node.js y TypeScript:

```text
project-doc-auditor/
├── src/
│   ├── cli/                  # open, doctor y selección de root
│   ├── core/
│   │   ├── discovery.ts      # contrato mínimo y capacidades detectadas
│   │   ├── model.ts          # ProjectSnapshot, Task, Document, Activity
│   │   ├── todo-parser.ts    # parser conservador + diagnósticos
│   │   ├── agents-profile.ts # estados/transiciones detectados o confirmados
│   │   ├── markdown.ts       # AST/render seguro
│   │   └── metrics.ts        # conteos y porcentajes derivados
│   ├── server/
│   │   ├── repository.ts     # filesystem allowlisted
│   │   ├── mutations.ts      # hashes, validación y escritura atómica
│   │   ├── git-reader.ts     # comandos Git fijos y read-only
│   │   ├── session.ts        # token efímero, origin y loopback
│   │   └── api.ts
│   └── web/                  # React/Vite: las cinco vistas
├── fixtures/                 # repositorios sintéticos de compatibilidad
├── tests/
└── package.json
```

Stack sugerido para el MVP:

- Node.js LTS + TypeScript;
- React + Vite para la interfaz;
- servidor HTTP pequeño con API tipada;
- parser Markdown basado en AST y sanitización sin HTML crudo;
- Playwright para E2E del navegador;
- empaquetado inicial como CLI npm ejecutable; binario/desktop queda fuera del primer corte.

No se necesita base de datos. Perfiles, repositorios recientes, journal y respaldos se guardan en el directorio de datos de usuario del auditor.

## 6. Modelo y parsers

El núcleo debe exponer DTOs neutrales:

- `RepositoryProfile`: raíz canónica, documentos, estados, transiciones y capacidades;
- `ProjectSnapshot`: métricas, documentos, tareas, actividad y diagnósticos con timestamp;
- `TaskRecord`: identidad estable derivada, estado, prioridad, fase, título, nota y ubicación;
- `DocumentRecord`: ruta relativa allowlisted, hash, secciones y fuente;
- `MutationPreview`: archivos afectados, before/after, hashes y validaciones;
- `AuditEvent`: actor local, fecha, repositorio, intención, archivos y hashes, sin contenido sensible completo.

El parser de TODO debe:

- conservar bytes, finales de línea y contenido no reconocido;
- extraer tareas sin exigir que la prioridad sea el último texto de la cabecera;
- emitir diagnósticos por líneas ambiguas en lugar de corregirlas;
- identificar cada tarea por ruta, sección, índice, línea normalizada y hash;
- recalcular métricas en cada snapshot, nunca usar porcentajes fijos;
- modificar sólo la línea seleccionada cuando su hash y el hash del archivo siguen vigentes.

El parser de AGENTS propone reglas, pero la mutación permanece deshabilitada hasta que el perfil tenga una máquina de estados confirmada.

## 7. Mutaciones seguras

Toda acción sigue `preview → confirmación → escritura → relectura → resultado`.

- precondición SHA-256 del archivo y del elemento;
- rechazo ante cambios concurrentes, sin búsqueda aproximada;
- escritura atómica preservando encoding, BOM, permisos y finales de línea;
- respaldo previo en el directorio externo del auditor;
- validación post-write y diff exacto;
- journal externo append-only;
- nota/motivo obligatorios según el perfil;
- para operaciones que también actualicen HANDOFF, preview conjunto de ambos archivos;
- sin auto-commit, push, merge, rebase, migraciones o comandos del proyecto.

Editar `AGENTS.md` es una operación privilegiada dentro de la herramienta: requiere motivo, diff completo, frase de confirmación y hash vigente. La validación genérica exige documento no vacío y encabezado válido; las secciones específicas del repositorio se muestran como diagnósticos definidos por su perfil, no como reglas hardcodeadas.

## 8. Seguridad

- escuchar exclusivamente en `127.0.0.1`, nunca en todas las interfaces;
- URL con token aleatorio de sesión, cookie `HttpOnly` y rotación al reiniciar;
- validar `Origin`, `Host` y método en cada mutación;
- rechazar symlinks, junctions y rutas cuyo `realpath` salga de la raíz;
- allowlist exacta de archivos Markdown y límites de tamaño;
- no servir archivos crudos mediante una ruta enviada por el navegador;
- Markdown sanitizado y sin HTML ejecutable;
- Git mediante ejecutable y argumentos fijos read-only, nunca shell;
- no leer `.env`, credenciales, bases de datos, hooks o configuración secreta;
- no ejecutar instrucciones encontradas dentro de los documentos auditados.

## 9. Fases de implementación

### Fase 0 — Contrato reusable

- crear el repositorio externo y ADR breve de límites;
- definir perfiles, capacidades y diagnósticos;
- crear al menos tres fixtures: formato `superRestaurant`, formato mínimo compatible y formato ambiguo/read-only;
- fijar criterios de compatibilidad y seguridad.

Salida: `doctor --root` explica exactamente qué puede leer y mutar sin iniciar UI.

### Fase 1 — Auditor read-only

- CLI `open --root` y sesión local;
- descubrimiento allowlisted;
- parsers, métricas y búsquedas;
- vistas Resumen, Tareas, Documentos y Actividad;
- Git read-only opcional;
- prueba read-only contra `superRestaurant` y un segundo repositorio/fixture.

Salida: todos los números se reconcilian con un parser independiente y ningún archivo del repo cambia.

### Fase 2 — TODO, notas y handoff

- preview/diff de transición;
- máquina de estados confirmada por perfil;
- concurrencia optimista y escritura atómica;
- notas estructuradas a PROJECT_NOTES/HANDOFF;
- journal y respaldos externos;
- recuperación demostrada ante fallo y conflicto.

Salida: una mutación válida cambia sólo los fragmentos previstos; las inválidas escriben cero bytes.

### Fase 3 — Configuración de AGENTS

- editor fuente con búsqueda y navegación por secciones;
- validaciones genéricas + reglas del perfil;
- diff completo, motivo y confirmación reforzada;
- registro conjunto en HANDOFF cuando el perfil lo requiera;
- restauración desde respaldo externo.

Salida: cambio de reglas trazable y reversible, sin edición silenciosa.

### Fase 4 — Empaquetado y adopción multi-repo

- instalación/actualización del CLI;
- selector de repositorios recientes;
- pruebas Windows y Linux/macOS cuando haya entorno;
- accesibilidad, 390×844 y escritorio;
- documentación de incorporación y desinstalación;
- piloto con dos repositorios reales compatibles antes de declarar v1.

## 10. Estrategia de pruebas

- unitarias de parsers, métricas, perfiles y máquina de estados;
- golden tests que prueben preservación byte a byte fuera del cambio;
- property tests para entradas Markdown hostiles/ambiguas;
- integración con directorios temporales, concurrencia y fallos de rename/write;
- seguridad: traversal, symlink/junction, archivos grandes, HTML/script, CSRF, origen/host inválido y token ausente;
- Git ausente, repo limpio, repo sucio y rutas con espacios/Unicode;
- E2E Playwright de lectura, filtros, transición, nota, conflicto y edición de AGENTS;
- compatibilidad obligatoria con fixtures de más de un repositorio;
- verificación de que el auditor no deja archivos nuevos en el repositorio salvo la mutación confirmada.

## 11. Criterios de aceptación de v1

1. Abre cualquier raíz compatible mediante argumento explícito y no requiere copiar código al proyecto.
2. Detecta los cuatro documentos obligatorios y degrada a read-only con diagnósticos si falta o es ambiguo alguno.
3. Los conteos coinciden con un parse independiente y muestran denominador/fecha.
4. Permite encontrar y leer todas las secciones operativas sin ejecutar HTML.
5. Una transición válida modifica sólo la tarea seleccionada y los registros previstos.
6. Una transición inválida o concurrente no escribe nada.
7. Las notas preservan el historial y muestran preview antes de guardar.
8. Editar AGENTS exige diff, motivo, confirmación reforzada y respaldo.
9. No puede leer fuera del root, secretos o rutas arbitrarias.
10. No ofrece shell, SQL, deploy, migraciones ni mutaciones Git/remotas.
11. Funciona con `superRestaurant` y al menos otro repositorio compatible sin código específico por proyecto.
12. El source/build del auditor reside fuera de los repositorios auditados.

## 12. Fotografía de `superRestaurant` como fixture inicial

Antes de registrar este workstream había 96 tareas. Con la tarea del auditor registrada, la fotografía es 97: 17 `DONE`, 31 `REVIEW`, 9 `IN_PROGRESS` y 40 `TODO`. Esto equivale hoy a 17.5 % aprobado y 58.8 % con trabajo visible por conteo. Son datos de aceptación del parser, no constantes ni medida de esfuerzo/readiness.

## 13. Siguiente acción mínima

La v0.1 externa ya implementa el contrato, auditor read-only y mutaciones protegidas descritas en las Fases 0–3, con empaquetado CLI local de Fase 4. La siguiente acción es revisión humana de la interfaz y un piloto de mutación sobre un fixture; `superRestaurant` permanece read-only hasta aprobar ese piloto.
