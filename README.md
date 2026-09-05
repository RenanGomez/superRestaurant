# superRestaurant

superRestaurant es un sistema POS greenfield y API-first para restaurantes, con clientes web, mobile y KDS. El desarrollo parte del plan maestro y conserva el prototipo remoto legado como referencia separada; no se mezcla automáticamente con este monorepo.

## Estado actual

El repositorio usa un monorepo con pnpm y Turborepo. ADR-010 seleccionó la arquitectura híbrida: Supabase administrado para PostgreSQL/Auth y Storage cuando un módulo lo requiera, con NestJS como única frontera de escritura crítica. ADR-001 registra sus límites; ADR-011 seleccionó e implementó Socket.IO con recuperación durable por cursor para Realtime. ADR-012 adopta Supabase Queues/PGMQ privado para el primer workload asíncrono aprobado; la cola permanece deliberadamente sin aprovisionar hasta entonces.

## Requisitos locales

- Node.js 24.19.0
- pnpm 11.19.0

## Descargar la modernización

La rama principal contiene el greenfield; el prototipo legado permanece solo
en el historial recuperable:

```sh
git clone https://github.com/RenanGomez/superRestaurant.git
cd superRestaurant
pnpm install --frozen-lockfile
```

## Comandos

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Documentación operativa

- [Plan maestro](PLAN_MODERNIZACION_POS_RESTAURANTE.md)
- [Copia del plan en docs](docs/PLAN_MODERNIZACION_POS_RESTAURANTE.md)
- [TODO](TODO.md)
- [Notas del proyecto](PROJECT_NOTES.md)
- [Handoff](HANDOFF.md)
- [Instrucciones para agentes](AGENTS.md)
- [ADR-006: estrategia Git greenfield](docs/adr/ADR-006.md)
- [Auditoría preliminar de licencias de terceros](docs/THIRD_PARTY_LICENSE_AUDIT.md)

## Licencia

Copyright (c) 2026 Emmanuel Renan Gomez Alvarez. Todos los derechos reservados.
superRestaurant es software propietario y no se concede permiso de uso, copia,
modificación o distribución sin autorización escrita del titular. Consulta
[LICENSE](LICENSE). Las dependencias de terceros conservan sus propias licencias.
