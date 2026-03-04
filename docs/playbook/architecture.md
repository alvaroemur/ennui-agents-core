# Architecture

## Objetivo

Definir una vista unica y canonica de la arquitectura `core + switchboard`, alineada con:

- contrato de integracion `switchboard <-> core` v1,
- RBAC v2 multi-tenant por workspace (`workspaceId` / `allowedWorkspaces`),
- estado operativo registrado en `avance.md`.

Este documento reemplaza y consolida la documentacion previa separada de:

- arquitectura core/gateway,
- contrato switchboard/core v1,
- matriz RBAC v1.

## Sistema y limites

- **`core`**: unica superficie publica. Expone `core/*` (health, me, workspaces, tenants, agents, assignments: promote/rollback/audit, runs, trace/events, trace/active-connections, auth/users, **POST /core/relay/chat**). Integra internamente el modulo switchboard (registro, RBAC) y el runtime de agentes.
- **`switchboard`**: modulo **interno** (control plane). Registro (workspaces, tenants, agents, deployments, assignments, runs), RBAC por workspace, resolucion tenant+agent→deployment. No se expone como API publica separada.
- **Cliente / hipotético front-end**: Cualquier aplicacion (p. ej. SPA) que consuma la API publica de **core** (`POST /core/relay/chat`, `GET /core/runs`, etc.) con core-key (M2M) o JWT de usuario. No hay producto «gateway» en el repo; se habla de un consumidor hipotetico.

Contrato publico canonico: `docs/core-contract-v1.md`.

### Diagrama de componentes (estado actual)

```mermaid
flowchart LR
    CL[Cliente / front-end] -->|POST /core/relay/chat + auth| CORE[Core]
    CORE --> REG[(Registry: workspaces, tenants, agents, assignments, runs)]
    CORE --> CK[(core-keys / JWT)]
    CORE -->|forward replyMode=v2| RT[Runtime / deployment]
    RT -->|reply + trace| CORE
    CORE -->|LLM call| LLM[LLM provider]
    LLM --> CORE
    CORE -->|response + X-Run-Id| CL
```

## Contrato operativo actual (v1)

### Flujo canonico de chat (API publica, v1.1)

1. Cliente (p. ej. un hipotético front-end) llama **`POST /core/relay/chat`** en **core** con auth (core-key o JWT) y body `workspaceId`, `tenantId`, `agentId`, `messages`.
2. Core autentica y autoriza (RBAC por workspace).
3. Core usa el registro (switchboard interno) para resolver `tenantId + agentId -> deployment`.
4. Core crea `run` (`running`) y reenvia a `deployment.baseUrl` (runtime) con `responseMode=v2`.
5. **Flujo v2 (canonico)**: runtime ejecuta solo el agente y devuelve «qué decir» (`reply` + trace); **core** llama a LLM (llm-proxy), aplica monitoreo/masking y responde al cliente. **Fallback legacy**: si el runtime devuelve respuesta final (`text`), core la acepta temporalmente.
6. Core cierra `run` (`success`/`error`) y devuelve respuesta con `X-Run-Id`.

### Responsabilidades por componente

- **core**
  - Expone API publica `core/*` (health, me, workspaces, tenants, agents, assignments promote/rollback/audit, runs, trace/events, trace/active-connections, auth/users, **POST /core/relay/chat**).
  - Usa switchboard (interno) para registro y RBAC.
  - Orquesta runs y reenvio al runtime (deployment).
- **switchboard** (interno)
  - Registro: workspaces, tenants, agents, deployments, assignments, runs.
  - RBAC por workspace; resolucion tenant+agent→deployment.
  - No expone endpoints publicos; core invoca su logica internamente.

### Payload minimo de `POST /core/relay/chat`

```json
{
  "workspaceId": "inspiro-agents",
  "tenantId": "aliantza",
  "agentId": "aliantza-compras",
  "messages": [
    { "role": "user", "parts": [{ "text": "Hola" }] }
  ],
  "metadata": {}
}
```

### Payload esperado de exito desde core

```json
{
  "text": "respuesta",
  "provider": "openai",
  "usage": {
    "inputTokens": 100,
    "outputTokens": 50
  },
  "trace": {
    "runId": "core-xxxx",
    "fingerprint": "fp-xxxx"
  }
}
```

### Secuencia `POST /core/relay/chat` (v1.1, flujo v2)

```mermaid
sequenceDiagram
    participant G as Cliente / front-end
    participant C as Core
    participant R as Registry (interno)
    participant RT as Runtime (deployment)
    participant LLM as LLM (llm-proxy)

    G->>C: POST /core/relay/chat (Authorization, workspaceId, tenantId, agentId, messages)
    C->>C: authn (core-key o JWT) + authz por workspace
    alt no autorizado
        C-->>G: 401/403
    else autorizado
        C->>R: resolver assignment + deployment
        alt no encontrado
            C-->>G: 404
        else ok
            C->>C: crear run (running)
            C->>RT: POST {baseUrl}/core/runtime/chat (responseMode=v2, ...)
            RT-->>C: reply, trace.agentRunId
            C->>LLM: llamada LLM con reply
            LLM-->>C: text, provider, usage
            C->>C: cerrar run (success/error)
            C-->>G: 200 + X-Run-Id + body
        end
    end
```

### Errores y trazabilidad

- Error de routing/infra: `4xx/5xx` con `error`, `detail`, `runId`.
- Error downstream runtime: `502` con `error`, `detail`, `runId`.
- Correlacion minima: header `X-Run-Id` + consulta en `GET /core/runs/:runId`.

## Flujograma de endpoints y flujos

Todos los endpoints de la API publica (`core/*`) y los flujos asociados. Rutas legacy (`/health`, `/api/config`, `/api/auth/google/*`) se documentan en README y contrato v1.

### Diagrama de flujos por endpoint

```mermaid
flowchart TB
    subgraph Entrada
        CL[Cliente]
    end
    subgraph Core["Core API"]
        CORE[Router]
        AUTH[Authn: core-key / JWT]
        RBAC[Authz: RBAC]
    end
    REG[(Registry)]
    RT[Runtime]
    LLM[LLM]

    CL -->|todos los endpoints| CORE

    CORE -->|GET /core/health| R200[200 OK]
    CORE -->|resto| AUTH

    AUTH -->|GET /core/me| REG
    AUTH -->|workspaces, tenants, agents, runs, trace, audit| RBAC
    AUTH -->|auth/users| REG

    RBAC --> REG
    REG -->|datos| R200

    CORE -->|promote / rollback| RBAC
    RBAC -->|health-check| RT
    RBAC --> REG

    CORE -->|POST /core/relay/chat| AUTH
    AUTH -->|canUseChat| RBAC
    RBAC --> REG
    REG -->|assignment + deployment| CORE
    CORE -->|crear run| REG
    CORE -->|POST /core/runtime/chat| RT
    RT -->|reply + trace| CORE
    CORE -->|llm-proxy| LLM
    LLM --> CORE
    CORE -->|finalize run| REG
    CORE -->|200 + X-Run-Id| CL
```

### Resumen de flujo por endpoint

| Endpoint | Flujo |
|----------|--------|
| `GET /core/health` | Cliente → Core → `200 { ok: true }` (sin auth). |
| `GET /core/me` | Cliente → Core → Auth (core-key/JWT) → principal (rol, workspaceId, allowedWorkspaces) → `200`. |
| `GET /core/workspaces` | Cliente → Core → Auth → RBAC → Registry (list workspaces, filtrado por allowedWorkspaces si no admin) → `200`. |
| `GET /core/workspaces/:id/tenants` | Cliente → Core → Auth → RBAC (scope workspace) → Registry (list tenants) → `200`. |
| `GET /core/tenants/:id/agents` | Cliente → Core → Auth → RBAC (scope tenant/workspace) → Registry (assignments + agents) → `200`. |
| `POST /core/workspaces/:id/assignments/promote` | Cliente → Core → Auth → RBAC (write) → Registry (tenant, assignment, deployment) → health-check GET al deployment target → Registry (update assignment + audit event) → `200` / `502` si health falla. |
| `POST /core/workspaces/:id/assignments/rollback` | Cliente → Core → Auth → RBAC (write) → Registry (assignment + último audit success) → health-check al deployment de rollback → Registry (update assignment + audit event) → `200`. |
| `GET /core/workspaces/:id/assignments/audit` | Cliente → Core → Auth → RBAC (read) → Registry (listAssignmentAudit con filtros) → `200`. |
| `GET /core/auth/users` | Cliente → Core → Auth → comprobación master (CORE_AUTH_MASTER_EMAILS) → Registry (listAuthUsers) → `200`. |
| `POST /core/auth/users` | Cliente → Core → Auth → master → validación body → Registry (createAuthUser) → `201`. |
| `PATCH /core/auth/users/:email` | Cliente → Core → Auth → master → validación body → Registry (updateAuthUser) → `200`. |
| `GET /core/runs` | Cliente → Core → Auth → RBAC (scope workspace si no admin) → Registry (listRuns con filtros) → `200`. |
| `GET /core/runs/:runId` | Cliente → Core → Auth → RBAC (scope del run) → Registry (getRun + getRunTimeline) → `200`. |
| `GET /core/trace/events` | Cliente → Core → Auth → RBAC → Registry (listTraceEvents) → `200`. |
| `GET /core/trace/active-connections` | Cliente → Core → Auth → RBAC → Registry (listActiveConnections) → `200`. |
| `POST /core/relay/chat` | Cliente → Core → Auth → RBAC (canUseChat) → Registry (tenant, assignment, deployment) → crear run (running) → POST a `{deployment.baseUrl}/core/runtime/chat` (responseMode=v2) → Runtime devuelve `reply` → Core llama LLM (llm-proxy) → Core finaliza run (success/error) → `200` + `X-Run-Id` (ver secuencia detallada más arriba). |
| `POST /core/runtime/chat` | **Interno**: invocado por Core (relay) hacia el deployment; no es endpoint público. Auth + RBAC por tenant; ejecuta agente local y devuelve `reply` + trace. |

## Seguridad y tenancy (RBAC v2)

- Separacion explicita authn/authz:
  - authn: `core-key` (M2M) o JWT de usuario.
  - authz: rol y `allowedWorkspaces` desde registro o claims JWT.
- Roles activos:
  - `admin-tecnico`: acceso total.
  - `operador-cuenta`: lectura + chat en sus workspaces.
  - `lector-cuenta`: solo lectura en sus workspaces (sin chat).
- Naming canonico: `workspaceId`, `tenantId` en API publica.

### Matriz RBAC por endpoint (API publica `core/*`)

| Endpoint | admin-tecnico | operador-cuenta | lector-cuenta |
|---|---|---|---|
| `GET /core/health` | Allow | Allow | Allow |
| `GET /core/me` | Allow | Allow | Allow |
| `GET /core/workspaces` | Allow (all) | Allow (solo sus workspaces) | Allow (solo sus workspaces) |
| `GET /core/workspaces/:id/tenants` | Allow | Allow (scope workspace) | Allow (scope workspace) |
| `GET /core/tenants/:id/agents` | Allow | Allow (scope tenant) | Allow (scope tenant) |
| `GET /core/runs` | Allow (all) | Allow (scope workspace) | Allow (scope workspace) |
| `GET /core/runs/:runId` | Allow | Allow (si run en su scope) | Allow (si run en su scope) |
| `GET /core/trace/events` | Allow (all) | Allow (scope workspace) | Allow (scope workspace) |
| `GET /core/trace/active-connections` | Allow (all) | Allow (scope workspace) | Allow (scope workspace) |
| `POST /core/workspaces/:id/assignments/promote` | Allow | Allow (scope workspace, write) | Deny |
| `POST /core/workspaces/:id/assignments/rollback` | Allow | Allow (scope workspace, write) | Deny |
| `GET /core/workspaces/:id/assignments/audit` | Allow | Allow (scope workspace) | Allow (scope workspace) |
| `POST /core/relay/chat` | Allow | Allow (scope workspace/tenant) | Deny |
| `GET /core/auth/users` | Allow (solo master) | Deny | Deny |
| `POST /core/auth/users` | Allow (solo master) | Deny | Deny |
| `PATCH /core/auth/users/:email` | Allow (solo master) | Deny | Deny |

### Configuracion de core-keys

- `SWITCHBOARD_RBAC_ENABLED=true`
- `SWITCHBOARD_CORE_KEYS=<json-array>`
- o archivo JSON en `SWITCHBOARD_KEYS_PATH` (default: path relativo al modulo switchboard, p. ej. `src/switchboard/data/core-keys.json`)

Formato (naming canonico: `workspaceId`):

```json
[
  { "id": "key-admin-01", "label": "Inspiro Agents Admin", "key": "adm", "workspaceId": "inspiro-agents", "status": "active" },
  { "id": "key-client-01", "label": "Cliente M2M", "key": "op1", "workspaceId": "inspiro-agents", "status": "active" }
]
```

## Persistencia y despliegue

- Registro: DB Neon/Postgres con esquema completo (workspaces, users, workspace_memberships, tenants, agents, deployments, assignments, runs). Fallback a archivo `registry.json` si no hay DB.
- Validacion E2E: core con `POST /core/relay/chat`, runs y dominio en DB o fallback.
- Baseline de despliegue: Docker/K8s local validado para core.

## Seguridad minima de integracion

- **core** autentica al cliente (front-end con JWT o integracion M2M con core-key) y aplica RBAC por workspace (usando el registro/switchboard interno).
- El rol y `allowedWorkspaces` se resuelven desde el registro o los claims JWT.
- Recomendado: TLS y secretos fuera de repositorio.

## Direccion de autenticacion para un hipotético front-end

Contexto:

- Un hipotético front-end (p. ej. SPA) podria administrar cuenta/tenants/agentes consumiendo `core/*`.
- En el front-end no se deben exponer secretos de servicio (`core-key`); usar JWT de usuario.

Dirección objetivo:

- Authn principal por JWT de usuario (OIDC/OAuth2 PKCE).
- `switchboard` valida `issuer/audience/jwks` y aplica RBAC por claims (`roles`, `allowedWorkspaces`).
- `core-key` se mantiene para integraciones M2M (no UI).

Referencia de plan: `docs/frontend-jwt-access-plan.md` (Fase 0-4; redactado para un hipotético front-end).

## Smoke test minimo

1. `GET /core/health` devuelve `200` y `ok=true`.
2. `POST /core/relay/chat` con auth (core-key o JWT) y body valido (workspaceId, tenantId, agentId, messages) devuelve respuesta con `X-Run-Id`.
3. `GET /core/runs/{runId}` devuelve el run (`success` o `error`).

## Estado actual del BFF (F-202603-06 cerrada)

La feature **F-202603-06-core-bff-agent-proxy** está cerrada (`done`). Comportamiento implementado:

- Core centraliza proxy a agentes + LLM + monitoreo/masking en `POST /core/relay/chat`.
- Agentes internos y externos se invocan por HTTP (mismo contrato).
- En contrato v2, los agentes devuelven «qué decir» (`reply`); core centraliza envío a LLM y respuesta al cliente.
- Trazabilidad de runs y RBAC se mantienen en el flujo. Detalle: `docs/playbook/features/archive/F-202603-06-core-bff-agent-proxy.md`.

### Esquema actual (BFF centralizado)

```mermaid
flowchart LR
    CL[Cliente] --> BFF[Core BFF /core/relay/chat]
    BFF -->|invoke por HTTP| AG1[Agent interno]
    BFF -->|invoke por HTTP| AG2[Agent externo]
    AG1 -->|reply| BFF
    AG2 -->|reply| BFF
    BFF --> LLM[LLM + monitoring + masking]
    LLM --> BFF
    BFF --> CL
```

## Referencias canonicas

- `docs/playbook/avance.md`
- `docs/playbook/state.md`
- `docs/core-contract-v1.md`
- `docs/bff-integration-v2.md`
- `docs/frontend-jwt-access-plan.md`
- `docs/core-keys-rotation-runbook.md`
- `docs/playbook/features/archive/F-202603-06-core-bff-agent-proxy.md`
