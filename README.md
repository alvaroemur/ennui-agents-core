# core

Paquete base para agentes: runtimes, llamadas LLM, auth por core-key (M2M) o JWT de usuario, persistence, API HTTP unificada bajo `core/*` y CLI.

La API pública canónica está bajo el prefijo **`/core/*`** (contrato v1). El módulo **switchboard** es interno (control plane: workspaces, tenants, agentes, asignaciones, runs). Ver `docs/playbook/state.md` y `docs/core-contract-v1.md`.

## Contenido

| Parte | Descripción |
|---|---|
| `src/` | Orquestación de runtimes, `config-loader` (DB), API HTTP (incl. rutas `core/*`), auth, persistence |
| `src/llm-proxy/` | Wrapper de LLM con monitoreo de tráfico y masking de datos sensibles |
| `agents/` | Lógica de runtimes (`consultor`, `collector`) |
| `.core-config/` | Configuración externa del deploy (`core.json` + subcuentas/agentes) |
| `bin/` | CLI (`core list`, `core health`) |
| `src/switchboard/` | Módulo interno: registro (workspaces, tenants, agentes, deployments, assignments, runs), RBAC, proxy de chat |
| `k8s/` | Manifiestos para deployment |
| `docs/playbook/` | Estado, contrato público v1, runbooks y features |

## Requisitos

- Node.js `>=20`

## Uso como paquete

```js
import {
  getRuntime,
  respond,
  callLLM,
  listAgentIds,
  loadAgentConfig,
  createPersistence,
  requireApiKey,
} from "core";
```

## API HTTP

```bash
# recomendado en local (libera el puerto 3000 si ya está en uso)
CONFIG_DIR=. npm run dev

# recarga automática al guardar cambios en src/
npm run dev:watch

# modo start (por defecto espera CONFIG_DIR=/app/config)
npm run start
```

### API pública canónica (`core/*`)

Autenticación: `Authorization: Bearer <core-key>` o `X-API-Key` (M2M), o `Authorization: Bearer <user-jwt>`. Scope por workspace. Contrato: `docs/core-contract-v1.md`.

| Método y ruta | Descripción |
|---------------|-------------|
| `GET /core/health` | Health check |
| `GET /core/me` | Sesión (rol, workspaceId, allowedWorkspaces) |
| `GET /core/workspaces` | Lista de workspaces del principal |
| `GET /core/workspaces/:workspaceId/tenants` | Tenants del workspace |
| `GET /core/tenants/:tenantId/agents` | Agentes asignados al tenant |
| `POST /core/workspaces/:workspaceId/assignments/promote` | Promociona assignment con health-check y auditoría |
| `POST /core/workspaces/:workspaceId/assignments/rollback` | Rollback al deployment previo inmediato con auditoría |
| `GET /core/workspaces/:workspaceId/assignments/audit` | Auditoría de cambios de assignments por rango/filtros |
| `GET /core/runs` | Lista de runs (filtros: workspaceId, tenantId, agentId, etc.) |
| `GET /core/runs/:runId` | Detalle de un run |
| `POST /core/relay/chat` | Chat orquestado: resuelve tenant+agent → deployment y reenvía al runtime |

Ejemplo de request a **`POST /core/relay/chat`**:

```json
{
  "workspaceId": "inspiro-agents",
  "tenantId": "aliantza",
  "agentId": "aliantza-compras",
  "messages": [
    { "role": "user", "parts": [{ "text": "Hola" }] }
  ],
  "metadata": { "sessionId": "sess-123", "channel": "web" }
}
```

Response incluye `text`, `provider`, `usage` y `trace` (p. ej. `runId`, `fingerprint`). Header de correlación: `X-Run-Id`.

### Otros endpoints

- `GET /health`, `GET /` — health legacy
- `GET /api/config`, `GET /api/config/core`, `GET /api/config/subaccounts`, `GET /api/config/agents/:agentId/config.json` — configuración
- `POST /core/runtime/chat` — endpoint interno de ejecución de runtime (llamado por relay/deployments). Si implementas un agente externo (p. ej. Aliantza-Compras), ver **`docs/agent-runtime-contract.md`**.
- `GET /api/auth/google/config`, `GET /api/auth/google/url`, `POST /api/auth/google/login` — OAuth Google para JWT de usuario

Tests rápidos:

- `npm run switchboard:test` — RBAC y regresión de control-plane.
- `npm run api:test` — integración C1 (`relay` v2, JWT, promotion/rollback/audit).

Comportamiento de firma en chat (relay y `/core/runtime/chat`): si el cliente envía `signature` se usa; si no, se respeta la del agente o se inyecta una por defecto. Se añade metadata con `fingerprint` (configurable con `CORE_FINGERPRINT_PREFIX` o `.core-config/core.json` → `tracing.fingerprintPrefix`). Ver `docs/core-signature.md`.

## Variables de entorno

Generales:

- `PORT` (default: `3000`)
- `CONFIG_DIR`
- `CORE_CONFIG_DIR` (default: `${CONFIG_DIR}/.core-config`)
- `CORE_ENV` (default: `dev`; valor usado en metadata de firma)
- `CORE_FINGERPRINT_PREFIX` (opcional; prefijo para `trace.fingerprint`, ej. `my-app-`)
- `CORE_API_KEY` o `API_KEY` (opcional; si está definido, la API exige auth)

Auth de requests:

- Header `X-API-Key: <key>` o `Authorization: Bearer <key>` (core-key para M2M; o JWT de usuario si está habilitado)

Auth de deploy (opcional desde `.core-config/core.json`):

- Si `auth.deployToken` está definido, Core exige el header configurado en `auth.headerName` (por defecto: `x-core-deploy-token`)

Control plane (RBAC y registro, módulo interno switchboard):

- `SWITCHBOARD_RBAC_ENABLED` (default: `true`)
- `SWITCHBOARD_KEYS_PATH` (default en módulo: `src/switchboard/data/core-keys.json`) — archivo de core-keys por workspace
- `SWITCHBOARD_DATABASE_URL` (opcional) — Postgres/Neon; si existe, el registro usa DB; si no, fallback a `registry.json`
- `REGISTRY_PATH` (default: `./src/switchboard/data/registry.json`) — registro cuando no hay DB
- `CORE_ASSIGNMENT_HEALTHCHECK_TIMEOUT_MS` (default: `5000`) — timeout de health-check para `promote`/`rollback`

JWT de usuario (opcional, para `core/me` y scope por workspace):

- `SWITCHBOARD_AUTH_JWT_ENABLED`, `SWITCHBOARD_AUTH_JWT_ISSUER`, `SWITCHBOARD_AUTH_JWT_AUDIENCE`
- Validación de firma: `SWITCHBOARD_AUTH_JWT_JWKS_URL` o `SWITCHBOARD_AUTH_JWT_JWKS` (recomendado), o `SWITCHBOARD_AUTH_JWT_SECRET` (HS256 legacy)

Google OAuth (login de usuario + emisión de JWT interno):

- `CORE_AUTH_GOOGLE_ENABLED`, `CORE_AUTH_GOOGLE_CLIENT_ID`, `CORE_AUTH_GOOGLE_CLIENT_SECRET`, `CORE_AUTH_GOOGLE_REDIRECT_URI`, `CORE_AUTH_GOOGLE_SCOPES`, `CORE_AUTH_GOOGLE_ALLOWED_HOSTED_DOMAINS`, `CORE_AUTH_MASTER_EMAILS`, `CORE_AUTH_JWT_SECRET`, etc. (ver `.env.example`)
- Allowlist + perfil RBAC por usuario se administra con:
  - `GET /core/auth/users`
  - `POST /core/auth/users`
  - `PATCH /core/auth/users/:email`
- Estos endpoints están restringidos a cuentas maestras (`CORE_AUTH_MASTER_EMAILS`).
- Fallback legacy por variables `CORE_AUTH_GOOGLE_ADMIN_EMAILS` / `CORE_AUTH_GOOGLE_ALLOW_ANY_ADMIN` se puede activar con `CORE_AUTH_LEGACY_EMAIL_ALLOWLIST_FALLBACK=true`.

LLM providers (al menos uno):

- `OPENAI_API_KEY` o `OPENAI_KEY`, `GEMINI_API_KEY` o `GEMINI_KEY`, `OPENROUTER_API_KEY` o `OPENROUTER_KEY`

Proxy y monitoreo de tráfico LLM:

- `LLM_PROXY_URL` — si existe, `callLLM` reenvía ahí
- `LLM_TRAFFIC_MONITOR_ENABLED` (default: `true`)
- `USE_PI_AI` — si está en `true`/`1`, las llamadas LLM usan el adaptador `@mariozechner/pi-ai` (PoC; ver F-202603-07)

Detalle de variables de switchboard (CRUD registro, runs, tests): `src/switchboard/README.md`. Rotación de core-keys: `docs/playbook/core-keys-rotation-runbook.md`.

## Modelo de configuración externa (`.core-config`)

`core.json` define la cuenta principal (branding, entorno y auth del deploy).  
Los demás archivos JSON representan configuraciones subcuenta-agente, por ejemplo:

- `.core-config/aliantza-agente-de-compras.json`

Notas:

- La API devuelve versión pública de estas configs (sin tokens).
- No subir tokens reales al repositorio.
- Puedes definir `tracing.fingerprintPrefix` para marcar fingerprints por deploy.

## CLI

```bash
core list
core agents
core health
```

Para `core health` se usa `CORE_API` (default: `http://localhost:3000`).

## Playbook y documentación

- **Estado y plan**: `docs/playbook/state.md`
- **Contrato público API**: `docs/playbook/core-contract-v1.md`
- **Rotación de core-keys**: `docs/playbook/core-keys-rotation-runbook.md`
- **Switchboard** (interno): `src/switchboard/README.md`

## Kubernetes y Docker

Ver `k8s/README.md`.

Build desde este módulo:

```bash
docker build -t core:latest -f Dockerfile .
```
