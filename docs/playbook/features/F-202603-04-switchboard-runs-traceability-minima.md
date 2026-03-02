# F-202603-04-switchboard-runs-traceability-minima

## Meta

- Estado: `done`
- Owner: alvaromur
- Fecha creacion: 2026-03-01
- Ultima actualizacion: 2026-03-01 (naming v2 `accountId`)

## Objetivo

Registrar y consultar ejecuciones (`runs`) en `switchboard` con estado, latencia y metadata tecnica minima por request.

## Contexto

Tu vision requiere que cada llamada de agente sea trazable por cuenta/agente/callId, incluyendo visibilidad operativa para Gateway y futura capa de costos.

## Definition of done

- [x] Cada `POST /api/chat` crea y finaliza un run (`running`, `success`, `error`).
- [x] Se guarda metadata: `runId`, `accountId`, `agentId`, `deploymentId`, `startedAt`, `finishedAt`, `durationMs`.
- [x] Se exponen endpoints `GET /api/runs` y `GET /api/runs/:runId`.
- [x] Se soportan filtros basicos (`accountId`, `agentId`, `status`, `provider`, `limit`, `offset`).
- [x] El response de chat incluye `X-Run-Id` para correlacion.
- [x] Se valida end-to-end con un deployment real/staging de `core`.

## Priorizacion

- Impacto: alto
- Esfuerzo: medio
- Prioridad: alta

## Dependencias

- Tecnicas: contrato de salida de `forwardChat` en `switchboard`.
- De negocio: ninguna bloqueante para MVP.

## Siguiente accion

Mantener monitoreo de runs y avanzar a metrica de costos en siguiente iteracion.

## Historial de estado

- 2026-03-01: `inbox` (creacion)
- 2026-03-01: `candidate` (alcance definido)
- 2026-03-01: `validated` (DoD verificable)
- 2026-03-01: `ready` (lista para ejecucion)
- 2026-03-01: `in_progress` (implementacion iniciada)
- 2026-03-01: `in_progress` (smoke test de endpoints y flujo de error validado)
- 2026-03-01: `done` (E2E local con `core` en K8s y run `success` validado)
- 2026-03-01: `done` (normalizacion terminologica `clientId` -> `accountId` en runtime/documentacion)
- Nota: la corrida E2E valida trazabilidad/run lifecycle; la respuesta de modelo no fue util por API key dummy.
