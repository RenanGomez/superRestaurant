Estado: **NO VERIFICADO** el motivo concreto; faltan las zonas configuradas de la sucursal.
Código: [delivery-zone.ts](/C:/Users/Emmanuel%20G/Documents/ChatGPT/superRestaurant/packages/domain/src/delivery-zone.ts:75) compara exactamente: primero CP y luego localidad; no normaliza mayúsculas, acentos ni espacios.
[Captura](/C:/Users/Emmanuel%20G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/capture/capture-customer.tsx:107) envía ambos campos actuales; NO VERIFICADO qué valores llegaron en el smoke.
Dato: HANDOFF registra `not_covered` para CP 85860 y plantea que falte en la zona; no confirma esa hipótesis.
Fix: si falta el CP, Emmanuel debe agregarlo a la zona activa correcta en `/app/delivery-zones`; si hay diferencias de localidad, evaluar normalización en dominio con pruebas.
Consulta read-only para el orquestador, sustituyendo los UUID de la sucursal: `SELECT id, name, active, deleted_at, postal_codes, localities FROM app.delivery_zones WHERE restaurant_id = '<restaurant-uuid>' AND branch_id = '<branch-uuid>';`
Regresión: el historial revisado muestra estos últimos cambios; no demuestra por sí solo una regresión:
```text
git log --oneline -15 -- apps/api/src/delivery-zones.ts apps/web/src/app/app/delivery-match-action.ts
a0139909 feat(web): zona, cargo y promesa al validar direccion en directorio y captura
04b4c90e feat(api): POST /delivery-zones/match (zona, cargo y promesa sin persistir)
```
NO VERIFICADO: ejecución en navegador y datos remotos; no se consultó la base.
NO SE GUARDÓ el informe: el entorno permite solo lectura; AGENTS.md §10 no contiene una plantilla de reporte.