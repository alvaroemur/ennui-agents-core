# Traceability Live Requirements (Backend)

## Objetivo

Definir el contrato backend para soportar una experiencia de Traceability en tiempo casi real en `gateway` (hipotético front-end), incluyendo:

- Active Connections
- Live Inbox
- Kanban por estados (`Idle`, `Needs Prompt`, `Completed`)
- Run Inspector por `runId`

Este documento asume autenticacion ya resuelta (Bearer token con JWT/core-key) y compatibilidad con filtros por `workspaceId`, `tenantId` y `agentId`. Sirve como especificación para la feature `F-202603-11` y para alinear las integraciones con los consumidores.

## Principios de contrato

- Respuestas JSON, UTF-8, `Content-Type: application/json`.
- Timestamps en ISO-8601 UTC (`2026-03-04T22:15:11.021Z`).
- Orden descendente por recencia por defecto.
- Filtros consistentes entre endpoints (`workspaceId`, `tenantId`, `agentId`).
- Idempotencia de eventos por `eventId`.
- `runId` como identificador estable para correlacion entre lista, eventos e inspector.

## Modelo canonico de estado

### Estados de run (`runStatus`)

- `idle`
- `needs_prompt`
- `running`
- `completed`
- `failed`
- `cancelled`
- `timeout`

### Mapeo de UI (Kanban)

- `Idle`: `idle`, `running`
- `Needs Prompt`: `needs_prompt`
- `Completed`: `completed`, `failed`, `cancelled`, `timeout`

### Estado de conexion (`connectionState`)

- `active`
- `closed`

## Endpoint 1: Listado de runs

### `GET /core/runs`

Listado de runs para tabla/kanban y snapshot inicial.

#### Query params

- `workspaceId` (string, opcional)
- `tenantId` (string, opcional)
- `agentId` (string, opcional)
- `status` (string, opcional)
- `limit` (number, opcional, default `100`, max `500`)
- `offset` (number, opcional, default `0`)
- `updatedAfter` (ISO datetime, opcional)

#### Response 200

```json
{
  "items": [
    {
      "runId": "run_bd43485c8774443a96348a0148c95dc4",
      "traceId": "trace_f6bd9f4f",
      "workspaceId": "inspiro-agents",
      "tenantId": "aliantza",
      "agentId": "aliantza-consultor",
      "status": "needs_prompt",
      "provider": "openai",
      "startedAt": "2026-03-04T22:12:00.000Z",
      "updatedAt": "2026-03-04T22:12:06.000Z",
      "durationMs": 620,
      "deploymentId": "comercial-prod",
      "usage": {
        "inputTokens": 102,
        "outputTokens": 44,
        "totalTokens": 146
      }
    }
  ],
  "total": 1,
  "limit": 100,
  "offset": 0
}
```

#### Requisitos funcionales

- `runId`, `status`, `startedAt`, `updatedAt` son obligatorios por item.
- `usage.totalTokens` puede omitirse si aun no esta disponible.
- `updatedAfter` debe filtrar por `updatedAt > updatedAfter`.

## Endpoint 2: Detalle de run (Inspector)

### `GET /core/runs/:runId`

Detalle profundo para Run Inspector.

#### Response 200

```json
{
  "runId": "run_bd43485c8774443a96348a0148c95dc4",
  "traceId": "trace_f6bd9f4f",
  "workspaceId": "inspiro-agents",
  "tenantId": "aliantza",
  "agentId": "aliantza-consultor",
  "status": "completed",
  "provider": "openai",
  "startedAt": "2026-03-04T22:12:00.000Z",
  "updatedAt": "2026-03-04T22:12:06.000Z",
  "durationMs": 620,
  "deploymentId": "comercial-prod",
  "usage": {
    "inputTokens": 102,
    "outputTokens": 44,
    "totalTokens": 146
  },
  "request": {
    "messages": []
  },
  "response": {
    "text": "Resultado de ejemplo"
  },
  "error": null,
  "timeline": [
    {
      "eventId": "evt_01JNBX2",
      "type": "status_changed",
      "at": "2026-03-04T22:12:06.000Z",
      "fromStatus": "running",
      "toStatus": "completed"
    }
  ]
}
```

#### Requisitos funcionales

- Debe incluir siempre `runId` y `status`.
- Si no existe `runId`, responder `404`.
- `timeline` es opcional pero recomendado para depuracion.

## Endpoint 3: Active Connections

### `GET /core/trace/active-connections`

Vista agregada de conexiones activas para bloque superior.

#### Query params

- `workspaceId` (string, opcional)
- `tenantId` (string, opcional)
- `agentId` (string, opcional)
- `limit` (number, opcional, default `50`, max `200`)

#### Response 200

```json
{
  "items": [
    {
      "connectionId": "conn_9f32",
      "runId": "run_bd43485c8774443a96348a0148c95dc4",
      "workspaceId": "inspiro-agents",
      "tenantId": "aliantza",
      "agentId": "aliantza-consultor",
      "startedAt": "2026-03-04T22:12:00.000Z",
      "elapsedMs": 18230,
      "tokens": 146,
      "state": "active"
    }
  ],
  "total": 1
}
```

#### Requisitos funcionales

- Solo conexiones con `state=active`.
- `elapsedMs` debe ser no negativo.
- Si no hay conexiones: `items: []`, `total: 0`.

## Endpoint 4: Live Inbox (polling por cursor)

### `GET /core/trace/events`

Feed incremental de eventos para ticker Live Inbox.

#### Query params

- `cursor` (string, opcional)
- `workspaceId` (string, opcional)
- `tenantId` (string, opcional)
- `agentId` (string, opcional)
- `limit` (number, opcional, default `50`, max `200`)

#### Response 200

```json
{
  "items": [
    {
      "eventId": "evt_01JNBX2",
      "timestamp": "2026-03-04T22:12:06.000Z",
      "type": "status_changed",
      "runId": "run_bd43485c8774443a96348a0148c95dc4",
      "workspaceId": "inspiro-agents",
      "tenantId": "aliantza",
      "agentId": "aliantza-consultor",
      "fromStatus": "running",
      "toStatus": "completed",
      "message": "Status changed to completed"
    }
  ],
  "nextCursor": "cur_01JNBX2_00001230"
}
```

#### Requisitos funcionales

- `eventId` unico y estable por evento.
- Orden ascendente por tiempo dentro de cada pagina de `items`.
- `nextCursor` debe apuntar al ultimo evento servido.
- Si no hay eventos nuevos: `items: []` y `nextCursor` vigente.

## Errores esperados

Formato base de error:

```json
{
  "error": "string",
  "message": "string",
  "detail": "string opcional"
}
```

Codigos:

- `400`: query invalida (`limit`, `cursor`, fecha mal formada).
- `401`: token ausente/expirado.
- `403`: sin permisos sobre workspace/tenant solicitado.
- `404`: `runId` no encontrado (solo endpoint de detalle).
- `409`: estado inconsistente (opcional en casos de carrera).
- `429`: rate limit alcanzado (incluir `Retry-After`).
- `500`: error interno no recuperable.
- `503`: servicio temporalmente degradado.

## Requisitos de performance y operacion

- P95 `GET /core/runs` <= 800 ms para `limit <= 100`.
- P95 `GET /core/trace/events` <= 400 ms para `limit <= 50`.
- Tolerar polling cada 2-5 segundos por cliente sin throttling excesivo.
- Compresion HTTP habilitada (gzip/br).
- `Cache-Control: no-store` para eventos live.

## Requisitos de consistencia

- Todo evento de `status_changed` debe reflejarse en `GET /core/runs` dentro de una ventana maxima de 2 segundos.
- `runId` en `events` debe existir o haber existido en el dataset de runs del filtro actual.
- Cambios terminales (`completed`, `failed`, `cancelled`, `timeout`) no deben revertir a estados no terminales.
