# Revisión · m3-dsh-debt-clean (nivel B)

No leas `.agents/reports/*`, no salgas del repo y no ejecutes PostgreSQL. Responde en ≤ 12 líneas.

Diff: main...harness/m3-dsh-debt-clean

Comprueba:
1. El header `x-device-id` se valida **antes** de cualquier efecto y un valor inválido devuelve 400 con el código que ya usa el módulo, sin romper el caso sin header.
2. El borrado de `items.module.ts` no deja imports colgados ni cambia el registro de controladores/proveedores de `AppModule`.
3. Las aserciones SQL son reales: comparan `pg_proc.prosecdef`, propietario y `proconfig` de las funciones correctas (mismo nombre y firma que las migraciones) y fallan con un mensaje útil.
4. No hay cambios de contrato, migraciones nuevas ni pruebas tautológicas; el mapeo `23505` de recetas está realmente cubierto y no enmascara otros estados.

Salida: `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR` y hallazgos con `archivo:línea`. Marca P1/P2/P3.
