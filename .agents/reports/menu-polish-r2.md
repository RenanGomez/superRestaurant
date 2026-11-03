# menu-polish-r2 — hecha

## Resumen por punto
1. Color categoría: botón redondo con color activo o anillo punteado, abre popover de 8 muestras, cierra al elegir o deseleccionar; sin texto «Automático»; aria-label y aria-pressed preservados.
2. Foto: enlace «Fotos del menú» eliminado; tocar miniatura abre modal siempre; botón «Cargar foto» (sin foto) o «Reemplazar» (con foto); «Quitar» limpia y mantiene modal abierto; botones centrados.
3. Fila categoría: «Activo», «?» y «×» centrados verticalmente respecto al input de nombre usando EditorRowActions.
4. Duplicar producto: botón «Duplicar» añadido en fila 3 junto a «+ Añadir tamaño» reutilizando copyProduct.
5. Opciones de modificador: alineación de 3 niveles (etiqueta h-5, control h-11, línea auxiliar reservada min-h-4); anchos [3rem_minmax(0,1fr)_7.5rem_6rem_auto]; a 390 px columna única.
6. Encabezado grupo: bloque derecho [Duplicar] [Activo] [?] [×] sin huecos ni separación con el borde.
7. Mitades: borde superior de la sección eliminado.
8. Texto: etiqueta y ayuda renombradas a «Ingredientes que se pueden agregar».
9. Alineación general: sistema de 3 niveles implementado en EditorField y EditorRowActions en todas las filas; targets ≥ 44 px.

## Archivos editados (en worktree C:\tmp\sr-wt\menu-polish-r2)
- apps/web/src/lib/menu-fields.ts (+5 líneas: constantes de clase de layout)
- apps/web/src/lib/menu-fields.test.ts (+8 líneas: validación de constantes)
- apps/web/src/app/app/menu/menu-catalog-editor.tsx (+485/-194 líneas: puntos 1-9)

## Salida literal de las puertas
Command: turbo run lint typecheck test build --filter=@super-restaurant/web
Tasks:    12 successful, 12 total
Cached:    12 cached, 12 total
Time:    141ms >>> FULL TURBO

Detalle:
- @super-restaurant/web:lint: eslint --max-warnings=0 -> 0 errors, 0 warnings
- @super-restaurant/web:typecheck: tsc --noEmit -> OK
- @super-restaurant/web:test: 7 test suites, 7 passed, 0 failed
- @super-restaurant/web:build: next build -> Compiled successfully, static pages generated (5/5)

## Commit en worktree
- Rama: gemini/menu-polish-r2
- Hash: d90ff5332830b24bf84ff602bd60a908f2ca04dc
- Mensaje: fix(web-menu): polish round 2

## Brecha de navegador
- http://localhost:8082 no responde (puerto inactivo en el entorno).
- user.json existe pero no hay servidor de desarrollo corriendo para evitar arrancar procesos no autorizados.
- Verificación garantizada por build de producción Next.js, pruebas unitarias y análisis de selectores.

## Riesgos y pendientes
- Ninguno bloqueante. Los cambios son exclusivos de presentación en apps/web sin alterar API, SQL ni contratos compartidos.
- Listo para revisión y merge por el orquestador hacia main.
