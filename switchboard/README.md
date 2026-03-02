# Switchboard

Centralita: conecta cada petición (`accountId` + `agentId`) con el deployment correcto. Proxy de chat por cuenta, API de registro (CRUD) y centro de control (UI). Vive bajo **inspiro-agents/**.

## Endpoints

- **GET /** y **GET /control** — Centro de control (UI): listado de accounts, agents, deployments, assignments, estado de cada deployment y promoción.
- **POST /api/chat** — Header `X-Account-Id` + body `{ agentId, messages, ... }`. Si la core-key ya está asociada a una cuenta, `X-Account-Id` puede omitirse. Resuelve Assignment → Deployment → reenvía a `{baseUrl}/api/chat`.
- **GET /health** — `{ ok: true }`.
- **GET /api/status** — Estado agregado para dashboard: `{ ok, timestamp, switchboard: { ok }, deployments: [...] }`.
- **GET /api/runs** — Lista de ejecuciones con filtros (`accountId`, `agentId`, `deploymentId`, `status`, `provider`, `from`, `to`, `limit`, `offset`).
- **GET /api/runs/:runId** — Detalle de una ejecucion.
- **GET /api/registry/status** — Estado de todos los deployments (GET {baseUrl}/health de cada uno).
- **/api/registry/accounts**, **agents**, **deployments**, **assignments** — CRUD. Promoción = `PATCH /api/registry/assignments/:accountId/:agentId` con `{ "deploymentId": "..." }`.

Notas de trazabilidad de chat:

- `POST /api/chat` devuelve header `X-Run-Id` para correlacion.
- Cada llamada guarda un run con estado `running|success|error` y metadata operativa minima.

## Configuración

- **SWITCHBOARD_DATABASE_URL**: connection string Postgres/Neon. Si existe, `switchboard` usa DB como backend principal del registro.
- **DATABASE_URL**: alternativa a `SWITCHBOARD_DATABASE_URL`.
- **REGISTRY_PATH**: ruta al JSON del registro (default `./data/registry.json`). Si hay DB vacia, se usa una sola vez para seed inicial.
- **PORT**: puerto (default 3010).
- **SWITCHBOARD_MAX_RUNS**: maximo de runs retenidos (default 2000), tanto en fallback JSON como en DB.
- **SWITCHBOARD_RBAC_ENABLED**: activa RBAC (`true/false`).
- **SWITCHBOARD_CORE_KEYS**: JSON array de core-keys. Ejemplo:

```json
[
  { "id": "key-platform-01", "label": "Platform Admin", "key": "adm", "accountId": "platform", "status": "active" },
  { "id": "key-inspiro-01", "label": "Inspiro Gateway", "key": "op1", "accountId": "inspiro-comercial", "status": "active" }
]
```

- **SWITCHBOARD_KEYS_PATH**: ruta a archivo JSON de core-keys (default `./data/core-keys.json` cuando se corre desde `switchboard/`).

Ejemplo de core-key:

```json
{
  "id": "key-inspiro-gateway-01",
  "label": "Inspiro Agents Gateway Access",
  "key": "token-en-claro",
  "accountId": "inspiro-comercial",
  "status": "active"
}
```

Nota de resiliencia:

- Si la DB no esta disponible, `switchboard` cae a fallback de archivo/estado en memoria para no bloquear la operacion local.

Nota de auth:

- Cuando RBAC esta activo, se acepta:
  - `Authorization: Bearer <google-id-token>` para usuarios de `gateway` (modo simple recomendado).
    - `SWITCHBOARD_AUTH_GOOGLE_ENABLED=true`
    - `SWITCHBOARD_AUTH_GOOGLE_CLIENT_ID=<google-client-id>`
    - `SWITCHBOARD_ADMIN_EMAILS=email1,email2`
  - `Authorization: Bearer <core-key>` o `X-API-Key` (M2M legacy).
  - `Authorization: Bearer <user-jwt>` si JWT auth está habilitado.
- Variables para JWT de usuario:
  - `SWITCHBOARD_AUTH_JWT_ENABLED=true`
  - `SWITCHBOARD_AUTH_JWT_SECRET` (o fallback `CORE_AUTH_JWT_SECRET`)
  - `SWITCHBOARD_AUTH_JWT_ISSUER` (opcional)
  - `SWITCHBOARD_AUTH_JWT_AUDIENCE` (opcional)

## Desarrollo local (desde inspiro-agents)

Con **agents-api** en otro terminal (puerto 3000), el registro por defecto apunta assignments a `comercial-staging` (baseUrl `http://localhost:3000`):

```bash
# Terminal 1
cd agents-api && npm install && npm run dev

# Terminal 2
cd switchboard && npm install && npm run dev
```

Probar proxy:

```bash
curl -X POST http://localhost:3010/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Account-Id: inspiro-comercial" \
  -d '{"agentId":"consultor-ia","messages":[{"role":"user","parts":[{"text":"Hola"}]}]}'
```

Probar registro:

```bash
curl http://localhost:3010/api/registry/assignments
curl http://localhost:3010/api/registry/status
```

## Tests RBAC

Ejecutar suite:

```bash
cd switchboard
npm test
```

Cobertura inicial de hardening:

- Unit tests de `src/rbac.js` (authn, authz y matriz de permisos por rol).
- Smoke tests HTTP RBAC (`401`, `403`, rechazo de `clientId` legacy en query/body).
