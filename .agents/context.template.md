# Contexto del Proyecto

> Documento vivo de referencia rápida para el Orquestador y los Sub-agentes.
> Límite recomendado: máximo 150-200 líneas. Solo hechos vigentes, no histórico.

---

## 1. Stack Tecnológico y Entorno

- **Lenguaje / Runtime:** [Ej. Node.js 20 LTS / Python 3.11 / Rust 1.78 / C# .NET 8]
- **Frameworks principales:** [Ej. FastAPI / React 18 / Next.js 14 / Godot 4.6]
- **Base de datos / Storage:** [Ej. PostgreSQL 16 / SQLite / Redis / JSON local]
- **Herramientas de testing:** [Ej. pytest / jest / vitest / cargo test]
- **Sistema Operativo objetivo:** Windows / Linux / Multiplataforma

---

## 2. Estructura de Directorios

- `src/` — Código fuente de la aplicación.
- `tests/` — Suites de pruebas unitarias e integración.
- `docs/` — Documentación complementaria y especificaciones.
- `.agents/` — Sistema de orquestación, briefs, reportes y notas.

---

## 3. Comandos Canónicos

```bash
# Instalación de dependencias
[comando_instalar]

# Compilación / Build / Typecheck
[comando_build]

# Ejecución de pruebas completa
[comando_test_all]

# Ejecución de un test unitario específico
[comando_test_single]

# Linter y formateador
[comando_lint]

# Inicio de la aplicación en modo desarrollo
[comando_dev]
```

---

## 4. Convenciones de Código y Arquitectura

- **Estilo:** [Ej. PEP 8 para Python / ESLint + Prettier para JS / Rustfmt]
- **Nomenclatura:** [Ej. camelCase para funciones, PascalCase para clases, UPPER_SNAKE para constantes]
- **Manejo de errores:** [Ej. Excepciones tipadas / Result types / Fail-fast]
- **Tipado estricto:** [Ej. TypeScript estricto / Type annotations en Python obligatorias]

---

## 5. Decisiones Técnicas y Contratos Vigentes

- [Decisión 1]: [Resumen de 1 línea]
- [Decisión 2]: [Resumen de 1 línea]
