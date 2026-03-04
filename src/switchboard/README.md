# Switchboard

Módulo **interno** de control: registro (workspaces, tenants, agentes, deployments, assignments, runs), RBAC por workspace y centro de control (UI). Vive en `src/switchboard/`. La API pública de chat está en **core**: `POST /core/relay/chat` (ver `docs/core-contract-v1.md`). Switchboard expone solo la API de registro y status cuando se ejecuta en modo standalone (puerto 3010); integrado en core, las rutas públicas son `core/*`.

## Endpoints (modo standalone, puerto 3010)

- **GET /** y **GET /control** — Centro de control (UI): listado de workspaces, agents, deployments, assignments, estado de cada deployment y promoción.
- **GET /health** — `{ ok: true }`.
- **GET /api/status** — Estado agregado para dashboard: `{ ok, timestamp, switchboard: { ok }, deployments: [...] }`.
- **GET /api/runs** — Lista de ejecuciones con filtros (`workspaceId`, `tenantId`, `agentId`, `deploymentId`, `status`, `provider`, `from`, `to`, `limit`, `offset`).
- **GET /api/runs/:runId** — Detalle de una ejecucion.
- **GET /api/registry/status** — Estado de todos los deployments (GET {baseUrl}/health de cada uno).
- **/api/registry/workspaces** — CRUD; solo **admin-tecnico** puede crear/editar/eliminar.
- **/api/registry/tenants** — CRUD; **operador-cuenta** puede gestionar tenants en workspaces donde tiene permiso.
- **/api/registry/users** — Listado, GET por id; POST (crear usuario) solo **admin-tecnico**. Invitar a un workspace: **memberships**.
- **/api/registry/workspace_memberships** (alias **memberships**) — Listado `?workspaceId=&userId=`; **operador-cuenta** puede POST (invitar a su workspace).
- **/api/registry/agents** — CRUD; solo **admin-tecnico** (catálogo global de agentes).
- **/api/registry/deployments** — CRUD; **operador-cuenta** puede crear/editar/eliminar deployments en su workspace (baseUrl).
- **/api/registry/assignments** — CRUD; **operador-cuenta** gestiona asignaciones en tenants de su workspace. Listado: `?workspaceId=` o `?tenantId=`. Promoción: `PATCH /api/registry/assignments/:tenantId/:agentId` con `{ "deploymentId": "..." }`.

Chat público (orquestado por workspace/tenant/agent): usar **core** en puerto 3000, `POST /core/relay/chat`. Trazabilidad: response incluye `trace.runId` y header `X-Run-Id`; los runs se consultan en core con `GET /core/runs` y `GET /core/runs/:runId`.

## Configuración

- **SWITCHBOARD_DATABASE_URL**: connection string Postgres/Neon. Si existe, el registro usa DB como backend principal.
- **DATABASE_URL**: alternativa a `SWITCHBOARD_DATABASE_URL`.
- **REGISTRY_PATH**: ruta al JSON del registro. Por defecto (desde raíz): `./src/switchboard/data/registry.json`; en standalone el módulo usa `data/registry.json` relativo a `src/switchboard/`.
- **PORT**: puerto (default 3010).
- **SWITCHBOARD_MAX_RUNS**: maximo de runs retenidos (default 2000), tanto en fallback JSON como en DB.
- **SWITCHBOARD_RBAC_ENABLED**: activa RBAC (`true/false`).
- **SWITCHBOARD_KEYS_PATH**: ruta a archivo JSON de core-keys (default dentro de `src/switchboard/`: `data/core-keys.json`).

Nota de resiliencia: si la DB no está disponible, se usa fallback de archivo/estado en memoria.

Auth: `Authorization: Bearer <core-key>` o `X-API-Key` (M2M); o `Authorization: Bearer <user-jwt>` si JWT está habilitado (`SWITCHBOARD_AUTH_JWT_ENABLED` + `SWITCHBOARD_AUTH_JWT_ISSUER` + `SWITCHBOARD_AUTH_JWT_AUDIENCE` + JWKS recomendado con `SWITCHBOARD_AUTH_JWT_JWKS_URL`/`SWITCHBOARD_AUTH_JWT_JWKS`; `SWITCHBOARD_AUTH_JWT_SECRET` queda como compatibilidad HS256).

## Desarrollo local

Desde la raíz del repo:

```bash
# Core (incluye switchboard integrado)
CONFIG_DIR=. npm run dev

# Solo switchboard en 3010 (CRUD registro)
npm run switchboard:dev
```

Tests RBAC: `npm run switchboard:test` (desde la raíz). Cobertura: unit tests de `rbac.js`, smoke tests HTTP (`401`, `403`, rechazo de inputs legacy).
