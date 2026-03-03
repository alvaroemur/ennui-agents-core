# src

Código del paquete **core**: orquestación, carga de runtimes por agente, LLM, configuración, auth, persistencia y API HTTP.

## Estructura

| Ruta | Descripción |
|------|-------------|
| `index.js` | Punto de entrada del paquete: `getRuntime(agentId)`, `respond`, `callLLM`, `listAgentIds`, `loadAgentConfig`, `createPersistence`, `requireApiKey`, exports de config y signature |
| `runtime/loader.js` | Carga dinámica de `agents/{runtimeId}/runtime.js` |
| `agent-config/loader.js` | Carga de configuración de agente desde switchboard registry (DB), por tenant |
| `tracing/signature.js` | Firma de ejecución y fingerprint para trazabilidad |
| `llm/core.js` | Llamadas a proveedores LLM (OpenAI, Gemini, OpenRouter); conversión a mensajes OpenAI |
| `llm/pi-ai.js` | Adaptador opcional `@mariozechner/pi-ai` (PoC) |
| `llm-proxy/` | Wrapper de LLM: reenvío opcional a proxy (`LLM_PROXY_URL`), monitoreo de tráfico y masking de datos sensibles |
| `auth/` | Auth por API key y deploy token; Google OAuth para JWT de usuario |
| `core-config/` | Configuración externa (`.core-config/core.json`, subcuentas); versión pública sin tokens |
| `persistence/` | Persistencia (Neon opcional); `createPersistence` para uso en agentes |
| `api/` | Servidor HTTP: rutas `core/*` (health, runtime/chat, me, workspaces, tenants, agents, runs, relay/chat), `/api/config`, OAuth |
| `switchboard/` | Módulo interno: registro (workspaces, tenants, agentes, deployments, assignments, runs), RBAC, proxy; datos en `switchboard/data/`, tests en `switchboard/test/` |

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

El servidor HTTP se arranca desde la raíz del repo (`npm run dev` / `npm run start`); ver `README.md` en la raíz y `docs/playbook/core-contract-v1.md` para la API pública.
