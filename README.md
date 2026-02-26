# @ennui-agents/core

**Contenedor de todo:** runtimes, LLM API, auth, persistence, API HTTP, CLI, **switchboard** y **agents**. Un solo paquete; usable como dependencia o vía API.

## Contenido

| Parte | Descripción |
|-------|-------------|
| **src/** | Runtimes (general, collector), LLM API (OpenAI, Gemini, OpenRouter), config-loader, auth, persistence, API HTTP |
| **switchboard/** | Routing por cliente (X-Client-Id), registro, centro de control (UI) |
| **agents/** | Unidades de agente (consultor, roi-calculator, readiness-evaluator, etc.): cada una con config.json |
| **bin/** | CLI: listar agentes, health de la API |
| **k8s/** | Deployment, service, configmap, secret, ingress |

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
} from "@ennui-agents/core";
```

## Uso vía API

```bash
CONFIG_DIR=/path/to/config node src/api/server.js
# o desde el repo raíz: npm run start (ennui-agents usa core)
```

Variables de entorno: `CONFIG_DIR`, `PORT`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `ENNUI_API_KEY` (opcional, para auth).

## K8s

Ver [k8s/README.md](k8s/README.md). Build desde la raíz del repo:  
`docker build -t ennui-agents-core:latest -f ennui-agents-core/Dockerfile .`
