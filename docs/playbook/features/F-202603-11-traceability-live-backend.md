# F-202603-11-traceability-live-backend

## Meta

- Estado: `done`
- Owner: alvaromur
- Fecha creacion: 2026-03-04
- Ultima actualizacion: 2026-03-04

## Objetivo

Implementar el contrato backend necesario para soportar una experiencia de Traceability Live (Kanban, Inbox, Inspector) en clientes de `core`, materializando la especificacion `docs/traceability-live-requirements.md`.

## Contexto

- La especificacion define 4 grandes bloques de informacion: listado de runs (con `runStatus` ampliado), detalle de run (Inspector), feed de eventos (Live Inbox) y conexiones activas (Active Connections).
- Actualmente `core` provee endpoints basicos para listar y obtener runs, pero su modelo de estado está limitado a `running`, `success`, `error`. Tampoco cuenta con historial de eventos, `traceId`, ni metadata profunda de `request`/`response`.
- Se requiere adaptar la API progresivamente sin romper la operacion actual y definir como core obtendra informacion de eventos y estados finos desde los rumbos de ejecucion.

## Definition of done

El trabajo de esta feature se puede dividir en fases. Como DoD general de la feature:

- [x] Contrato HTTP de `GET /core/runs` y `GET /core/runs/:runId` alineado con la especificacion (soporte a nuevos status `completed`, `failed`, etc, inclusion de `updatedAt` y `traceId` si corresponde).
- [x] Endpoint de eventos en `GET /core/trace/events` implementado y funcionando (o plan documentado de mitigacion / descarte / simplificacion para MVP de polling).
- [x] Endpoint de conexiones en `GET /core/trace/active-connections` implementado (o plan definido para Fase 2 de Live).
- [x] Todo el contrato incluye scope/filtro por `workspaceId` integrado con RBAC existente.
- [x] Documentacion (como `core-contract-v1.x.md` o anexo) actualizada.

## Priorizacion

- Impacto: Alto (habilita casos de uso avanzados de UI)
- Esfuerzo: Alto (requiere persistencia de eventos / timeline)
- Prioridad: Alta para el track de producto/front-end

## Dependencias

- Depende de RBAC y contratos base de F-09 / F-08 / F-04 (ya cerradas).
- Se alinea con los SLOs y observabilidad basica definidos en C2.

## Siguiente accion

Feature completada. La iteración abordó de inmediato todo el backend de Live Traceability (ampliación de estatus, almacenamiento de trace events con Neon/fallback, cursor pagination y endpoint de conexiones activas).

## Historial de estado

- 2026-03-04: `inbox` (creacion tras ideate inicial de Traceability Live).
- 2026-03-04: `in_progress` -> `done` (implementación de store de eventos, endpoints nuevos, y adaptación de status `completed`/`failed`).
