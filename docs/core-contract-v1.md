# Core Public Contract v1

## Estado del documento

- Estado: `accepted`
- Version: `v1.1`
- Fecha: `2026-03-03`
- Feature: `F-202603-09-core-api-publica-unificada-relay`

## Objetivo

Definir el contrato HTTP publico minimo de `core` bajo `core/*` para la siguiente iteracion de implementacion.

## Principios

1. Superficie publica unica: `core/*`.
2. Rutas legacy retiradas de forma inmediata (sin fase dual de compatibilidad).
3. `switchboard` queda interno al sistema (control plane), no como API publica separada.
4. Agentes internos y externos se invocan por HTTP.

Para implementadores de agentes (p. ej. Aliantza-Compras): **`docs/agent-runtime-contract.md`** — el agente debe exponer `POST /core/runtime/chat` y no llamar a la IA directamente; Core orquesta el chat y la llamada LLM.

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
- `POST /core/workspaces/:workspaceId/tenants`
- `GET /core/tenants/:tenantId/agents`
- `POST /core/workspaces/:workspaceId/agent-endpoints`
- `GET /core/workspaces/:workspaceId/assignments`
- `POST /core/workspaces/:workspaceId/assignments`
- `PATCH /core/workspaces/:workspaceId/assignments/:tenantId/:agentId`
- `POST /core/workspaces/:workspaceId/assignments/promote`
- `POST /core/workspaces/:workspaceId/assignments/rollback`
- `GET /core/workspaces/:workspaceId/assignments/audit?from=&to=&tenantId=&agentId=`

### Administración (usuarios permitidos)

Solo cuentas maestras (`CORE_AUTH_MASTER_EMAILS`) pueden usar estos endpoints:

- `GET /core/auth/users` — Lista de usuarios en la allowlist (email, status, role, allowedWorkspaces, etc.).
- `POST /core/auth/users` — Crear o actualizar perfil de usuario permitido.
- `PATCH /core/auth/users/:email` — Actualizar perfil por email.

### Trazabilidad

- `GET /core/runs`
- `GET /core/runs/:runId`

### Orquestacion canonica

- `POST /core/relay/chat`

Semantica v1.1:

- Core invoca runtime por HTTP (`POST {deployment}/core/runtime/chat`) con `responseMode=v2`.
- En contrato v2, runtime devuelve `reply` + `trace.agentRunId` (sin llamar a LLM).
- Core ejecuta la llamada LLM, aplica monitoreo/masking y responde al cliente.
- Compatibilidad: si un runtime legacy devuelve respuesta final (`text`), core la acepta temporalmente.

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

## Provisioning para Gateway

### Registrar tenant

- `POST /core/workspaces/:workspaceId/tenants`
- Body:

```json
{
  "name": "Mi Tenant",
  "slug": "mi-tenant",
  "metadata": {}
}
```

### Registrar endpoint de agente (agente + URL)

- `POST /core/workspaces/:workspaceId/agent-endpoints`
- Body:

```json
{
  "agentId": "mi-agente",
  "baseUrl": "https://agent.example.com",
  "name": "Mi Agente",
  "type": "chat",
  "versionTag": "v1",
  "metadata": {}
}
```

### Configuracion tenant+agente (binding + contract)

- Crear assignment: `POST /core/workspaces/:workspaceId/assignments`
- Actualizar assignment: `PATCH /core/workspaces/:workspaceId/assignments/:tenantId/:agentId`
- Leer assignments: `GET /core/workspaces/:workspaceId/assignments?tenantId=&agentId=`

Campos soportados:

- `bindingName` (string)
- `contract` (object JSON)
- `chatPath` (string opcional): path relativo para invocar el runtime del agente (ej. `/core/runtime/chat` o `/v1/chat`).
- `endpointUrl` (string opcional): URL absoluta del endpoint de chat del agente. Si se define, tiene prioridad sobre `chatPath`.

Fallback: si no se define `chatPath` ni `endpointUrl`, Core usa `{deployment.baseUrl}/core/runtime/chat`.

El `contract` del assignment se inyecta al runtime en `POST /core/relay/chat`.

## Modelo de errores v1

| HTTP | error | Causa |
|---|---|---|
| 400 | `bad_request` | payload invalido o IDs inconsistentes |
| 401 | `unauthorized` | credencial ausente/invalida |
| 403 | `forbidden` | scope/rol insuficiente |
| 404 | `not_found` | workspace/tenant/agent/assignment inexistente |
| 409 | `conflict` | recurso ya existe o colision de estado |
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
