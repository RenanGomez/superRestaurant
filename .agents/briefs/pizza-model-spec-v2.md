# Brief pizza-model-spec-v2 (P3-0 corregida, nivel A, SIN escritura)

## Objetivo
Entrega en tu respuesta final la especificación CORREGIDA completa (L0 la guarda en `docs/architecture/PIZZA_MODEL_V2.md`). Parte de `docs/architecture/PIZZA_MODEL_V2.md` (incluye la revisión Codex con 3 P1 y 2 P2 al final) y resuelve TODOS los hallazgos.

## Decisiones de Emmanuel (2026-11-20), ya cerradas
- Mitad y mitad entre especialidades: precio de la MÁS CARA. Extra: precio propio de la opción. N gratis POR PRODUCTO. Mitad/N: cuenta 1 por ingrediente; «N» sola sin atajo.
- En mitad y mitad de personalizadas con N distinto rige la N de la mitad MÁS CARA.
- Un ingrediente en ambas mitades se cobra UNA VEZ por pizza (se deduplica por opción antes de aplicar N).
- Aprobados los supuestos: quitar ingrediente de especialidad sin descuento (sustituto = opción adicional cobrada); tipo de producto derivado de la categoría por referencia estable; quitar producto publicado = borrar del catálogo con historial por snapshots.

## Debe incluir
Cambio versionado para permitir dos mitades personalizadas (dominio y las dos funciones SQL) con pruebas de que lo legado no cambia; idempotencia (replay mismo payload, conflicto con payload distinto, concurrencia) por actor y scope; pruebas de historial tras cambiar catálogo y de aislamiento con referencias cruzadas; tabla de casos de precio (0, N, N+1, N+k, mitades, repetidos, N distintos) con enteros menores y redondeo; división en P3-1…P3-5 con archivos.

## Alcance
Solo lectura. Prohibido git commit/push. Informe final completo en la respuesta y en `.agents/reports/pizza-model-spec-v2.md`.
