# core

Paquete base para agentes: runtimes, llamadas LLM, auth opcional por API key, persistence, API HTTP y CLI.

## Contenido

| Parte | Descripción |
|---|---|
| `src/` | Runtime `general` y `collector`, `config-loader`, API HTTP, auth, persistence |
| `src/llm-proxy/` | Wrapper de LLM con monitoreo de tráfico y masking de datos sensibles |
| `agents/` | Configuración de agentes (`config.json` por agente) |
| `.core-config/` | Configuración externa del deploy (`core.json` + subcuentas/agentes) |
| `bin/` | CLI (`core list`, `core health`) |
| `switchboard/` | Switchboard y scripts relacionados |
| `k8s/` | Manifiestos para deployment |

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
# recomendado en local
CONFIG_DIR=. npm run dev

# modo start (por defecto espera CONFIG_DIR=/app/config)
npm run start
```

Endpoints principales:

- `GET /health` y `GET /`
- `GET /api/config`
- `GET /api/config/core`
- `GET /api/config/subaccounts`
- `GET /api/config/agents/:agentId/config.json`
- `POST /api/chat` (alias: `POST /agent-chat`)
- `GET /api/auth/google/config`
- `GET /api/auth/google/url?redirectUri=...&state=...`
- `POST /api/auth/google/login`

Ejemplo de request a chat:

```json
{
  "agentId": "consultor",
  "messages": [
    { "role": "user", "parts": [{ "text": "Hola" }] }
  ],
  "signature": "Opcional: firma del cliente (bloque ```...``` o texto plano).",
  "appendSystemPrompt": "Opcional",
  "preferredProvider": "openai"
}
```

Comportamiento de firma en `POST /api/chat`:

- Si el cliente envía `signature`, se usa esa firma.
- Si el prompt del agente ya inicia con una firma, se respeta.
- Si no hay firma, Core inyecta una firma por defecto (`core gateway backend`) como boilerplate para front-ends.
- En todos los casos se agrega metadata de ejecución con `fingerprint` para trazabilidad.
- El `fingerprint` soporta prefijo configurable por deploy (`CORE_FINGERPRINT_PREFIX` o `.core-config/core.json` en `tracing.fingerprintPrefix`).
- Detalle del formato/base: `docs/core-signature.md`.

El response incluye `trace` con datos de seguimiento:

```json
{
  "text": "...",
  "provider": "openai",
  "trace": {
    "fingerprint": "ia-gateway-2f3c9d0a14f8b7e1",
    "fingerprintPrefix": "ia-gateway-",
    "runId": "core-4f8b7e1",
    "env": "production",
    "signatureSource": "core-default"
  }
}
```

## Variables de entorno

Generales:

- `PORT` (default: `3000`)
- `CONFIG_DIR`
- `CORE_CONFIG_DIR` (default: `${CONFIG_DIR}/.core-config`)
- `CORE_ENV` (default: `dev`; valor usado en metadata de firma)
- `CORE_FINGERPRINT_PREFIX` (opcional; prefijo para `trace.fingerprint`, ej. `ia-gateway-`)
- `CORE_API_KEY` o `API_KEY` (si está definido, la API exige auth)

Auth de requests (cuando hay API key):

- Header `X-API-Key: <key>`
- o `Authorization: Bearer <key>`

Auth de deploy (opcional desde `.core-config/core.json`):

- Si `auth.deployToken` está definido, Core exige el header configurado en `auth.headerName`
- Header por defecto: `x-core-deploy-token`

Google OAuth (login de usuario + emisión de JWT interno):

- `CORE_AUTH_GOOGLE_ENABLED` (default: `false`)
- `CORE_AUTH_GOOGLE_CLIENT_ID` (requerido cuando OAuth está activo)
- `CORE_AUTH_GOOGLE_CLIENT_SECRET` (requerido para intercambio `code -> id_token`)
- `CORE_AUTH_GOOGLE_REDIRECT_URI` (opcional; fallback de `redirectUri`)
- `CORE_AUTH_GOOGLE_SCOPES` (opcional; CSV, default `openid,email,profile`)
- `CORE_AUTH_GOOGLE_ALLOWED_HOSTED_DOMAINS` (opcional; CSV de dominios de Google Workspace)
- `CORE_AUTH_GOOGLE_ADMIN_EMAILS` (CSV de emails permitidos como `admin-tecnico`)
- `CORE_AUTH_GOOGLE_ALLOW_ANY_ADMIN` (default: `false`; solo para entornos de desarrollo)
- `CORE_AUTH_JWT_SECRET` (requerido para firmar JWT interno)
- `CORE_AUTH_JWT_ISSUER` (default: `core-auth`)
- `CORE_AUTH_JWT_AUDIENCE` (default: `core-switchboard`)
- `CORE_AUTH_JWT_TTL_SEC` (default: `3600`)
- `CORE_AUTH_ADMIN_ALLOWED_ACCOUNTS` (opcional; CSV para claim `allowedAccounts`)
- `CORE_AUTH_DEFAULT_ACCOUNT_ID` (opcional; fallback de `defaultAccountId`)

LLM providers (cualquiera de estas):

- `OPENAI_API_KEY` o `OPENAI_KEY`
- `GEMINI_API_KEY` o `GEMINI_KEY`
- `OPENROUTER_API_KEY` o `OPENROUTER_KEY`

Proxy y monitoreo de tráfico LLM:

- `LLM_PROXY_URL`: si existe, `callLLM` reenvía ahí en lugar de llamar directo a providers
- `LLM_TRAFFIC_MONITOR_ENABLED` (default: `true`; desactiva con `false`, `0`, `off`, `no`)

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

## Kubernetes y Docker

Ver `k8s/README.md`.

Build desde este módulo:

```bash
docker build -t core:latest -f Dockerfile .
```
