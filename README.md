# superRestaurant

superRestaurant es un sistema POS greenfield y API-first para restaurantes, con clientes web, mobile y KDS. El desarrollo parte del plan maestro y conserva el prototipo remoto legado como referencia separada; no se mezcla automáticamente con este monorepo.

## Estado actual

El repositorio está en la base inicial del monorepo con pnpm y Turborepo. ADR-010 seleccionó la arquitectura híbrida: Supabase administrado para PostgreSQL/Auth y Storage cuando un módulo lo requiera, con NestJS como única frontera de escritura crítica. ADR-001 registra los límites de implementación; las aplicaciones, el schema productivo, la cola y el transporte Realtime todavía no están implementados o elegidos.

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
