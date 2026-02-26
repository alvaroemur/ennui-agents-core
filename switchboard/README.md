# Switchboard

Centralita: conecta cada petición (clientId + agentId) con el deployment correcto. Proxy de chat por cliente, API de registro (CRUD) y centro de control (UI). Vive bajo **inspiro-agents/**.

## Endpoints

- **GET /** y **GET /control** — Centro de control (UI): listado de clients, agents, deployments, assignments, estado de cada deployment y promoción.
- **POST /api/chat** — Header `X-Client-Id` + body `{ agentId, messages, ... }`. Resuelve Assignment → Deployment → reenvía a `{baseUrl}/api/chat`. También acepta **/switchboard/chat** y **/orchestrator/chat** (compat).
- **GET /health** — `{ ok: true }`.
- **GET /api/status** — Estado agregado para dashboard: `{ ok, timestamp, switchboard: { ok }, deployments: [...] }`.
- **GET /api/registry/status** — Estado de todos los deployments (GET {baseUrl}/health de cada uno).
- **/api/registry/clients**, **agents**, **deployments**, **assignments** — CRUD. Promoción = `PATCH /api/registry/assignments/:clientId/:agentId` con `{ "deploymentId": "..." }`.

## Configuración

- **REGISTRY_PATH**: ruta al JSON del registro. Por defecto `./data/registry.json`. Se persiste en disco al hacer mutaciones.
- **PORT**: puerto (default 3010).

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
  -H "X-Client-Id: inspiro-comercial" \
  -d '{"agentId":"consultor-ia","messages":[{"role":"user","parts":[{"text":"Hola"}]}]}'
```

Probar registro:

```bash
curl http://localhost:3010/api/registry/assignments
curl http://localhost:3010/api/registry/status
```
