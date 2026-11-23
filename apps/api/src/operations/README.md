# Observabilidad de la API

`GET /health` comprueba que el proceso responde y sirve para sondas de infraestructura.
`GET /api/v1/health` conserva el endpoint público versionado para clientes existentes;
ambos indican liveness y no consultan dependencias. `GET /ready` comprueba PostgreSQL
y responde 503 cuando falla o tarda más de dos segundos.

`GET /metrics` requiere `Authorization: Bearer <METRICS_TOKEN>`. Si la variable no
está configurada, responde 404. El token debe configurarse como secreto del servicio.
Las métricas son acumuladores por proceso, sin datos personales.

Se acepta `x-correlation-id` con 8 a 64 caracteres alfanuméricos o guiones; de otro
modo se genera un UUID. El identificador aparece en la respuesta y en la línea de
acceso de cada request; los demás logs todavía no lo propagan automáticamente.
