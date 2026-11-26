# Revisión B · m3-sql-purchasing-fix (nivel A, auditoría y pruebas)

Solo lectura. No ejecutes tests/PG, no leas `.agents/reports/*` ni rutas fuera del repo. Responde en ≤ 20 líneas.

Lee solo:
`git diff -- supabase/migrations/20261126000400_inventory_purchasing.sql supabase/tests/inventory_purchasing_invariants.sql`

Contexto: se añaden `received_by`/`received_device_id` a la recepción, idempotencia de creación y pruebas nuevas; el verificador rollback-only del orquestador ya está verde.

Busca:
1. ¿La recepción guarda actor y dispositivo reales y el replay/second receive no los sobrescribe ni duplica movimientos?
2. ¿Las pruebas nuevas prueban de verdad: replay con misma clave, conflicto con payload distinto, `unitCostMinor` negativo/decimal/texto/19 dígitos, moneda inválida, clave ausente/vacía/con espacios, proveedor de otro restaurante y auditoría?
3. ¿Las pruebas nuevas rompen o relajan alguna aserción previa (replay de recepción, saldos, costo, moneda)?
4. ¿Alguna prueba pasa por la razón equivocada (excepción distinta a la esperada) o quedó tautológica?
5. ¿Falta cubrir algo P1/P2 para declarar cerrado el P1 de #91?

Salida: primera línea `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR`; hallazgos P1/P2/P3 numerados con `archivo:línea` y corrección.
