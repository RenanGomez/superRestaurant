Hallazgos: no identifiqué P1/P2/P3 en el diff revisado.

El contexto usa `React.cache`; las comprobaciones de membresía, sucursal y roles revisadas se conservan. Los estados de carga incorporan `role="status"`, `aria-busy` y animación condicionada a movimiento permitido.

Verificación:
```text
git -C C:\tmp\sr-wt\web-nav-perf-r1-fix1 log -1 --format='%h %s'
2e369bb6 fix(web): acentos en pantallas de carga
```
NO VERIFICADO: comportamiento en navegador, pruebas de la app y mediciones de rendimiento; esta revisión fue estática. AGENTS.md §10 no contiene una plantilla de reporte.

VEREDICTO: APROBAR