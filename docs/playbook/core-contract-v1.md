# Core Public Contract v1

## Estado del documento

- Estado: `draft-accepted`
- Version: `v1`
- Fecha: `2026-03-01`
- Feature: `F-202603-09-core-api-publica-unificada-relay`

## Objetivo

Definir el contrato HTTP publico minimo de `core` bajo `core/*` para la siguiente iteracion de implementacion.

## Principios

1. Superficie publica unica: `core/*`.
2. Rutas legacy retiradas de forma inmediata (sin fase dual de compatibilidad).
3. `switchboard` queda interno al sistema (control plane), no como API publica separada.
4. Agentes internos y externos se invocan por HTTP.

## Autenticacion y autorizacion

- Modo principal de UI: `Authorization: Bearer <user-jwt>`.
- Modo M2M controlado: `Authorization: Bearer <core-key>` o `X-API-Key`.
- Scope minimo esperado para JWT de usuario:
  - `roles`
  - `allowedWorkspaces`
  - `defaultWorkspaceId` (opcional)

## Endpoints canonicos v1

### Health y sesion

- `GET /core/health`
- `GET /core/me`

### Dominio

- `GET /core/workspaces`
- `GET /core/workspaces/:workspaceId/tenants`
- `GET /core/tenants/:tenantId/agents`

### Trazabilidad

- `GET /core/runs`
- `GET /core/runs/:runId`

### Orquestacion canonica

- `POST /core/relay/chat`

Body minimo:

```json
{
  "workspaceId": "inspiro-agents",
  "tenantId": "aliantza",
  "agentId": "aliantza-compras",
  "messages": [
    { "role": "user", "parts": [{ "text": "Hola" }] }
  ],
  "metadata": {
    "sessionId": "sess-123",
    "channel": "web"
  }
}
```

Response esperado:

```json
{
  "text": "respuesta final",
  "provider": "openai",
  "usage": {
    "inputTokens": 100,
    "outputTokens": 50
  },
  "trace": {
    "runId": "run-123",
    "fingerprint": "fp-abc"
  }
}
```

Header de correlacion obligatorio:

- `X-Run-Id: <runId>`

## Modelo de errores v1

| HTTP | error | Causa |
|---|---|---|
| 400 | `bad_request` | payload invalido o IDs inconsistentes |
| 401 | `unauthorized` | credencial ausente/invalida |
| 403 | `forbidden` | scope/rol insuficiente |
| 404 | `not_found` | workspace/tenant/agent/assignment inexistente |
| 502 | `downstream_error` | error invocando agente |
| 500 | `internal_error` | error no controlado |

## Seed inicial aceptado (mock)

- Workspace: `Inspiro Agents`
- Tenants:
  - `Aliantza`
  - `Inspiro Agents Web`
- Agentes:
  - `Aliantza`: `Aliantza-Compras` (mock)
  - `Inspiro Agents Web`: 4 agentes mock

## Alcance de la siguiente sesion

1. Implementar ruteo publico `core/*` con `POST /core/relay/chat`.
2. Ajustar RBAC a scope por `workspaceId` y `tenantId`.
3. Conectar seed mock en persistencia activa.
4. Actualizar pruebas HTTP de contrato v1.
5. Publicar checklist de migracion cerrada (sin legacy).
