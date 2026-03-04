# Contrato para runtimes de agente (deployments)

Documento dirigido a **quien implementa o despliega un agente** (p. ej. Aliantza-Compras) que Core invoca por HTTP. Alinea el código del agente con el flujo orquestado por Core.

## Resumen en tres puntos

1. **Exponer tu propia API**: el agente debe exponer un endpoint de chat (p. ej. **`POST /agent/chat`**) para que Core (relay) pueda invocarlo cuando un cliente hace chat.
2. **Endpoint configurable por binding**: el **path** (o la URL completa) del endpoint es **variable**: se define en la configuración del **binding** (assignment) para cada tenant+agente. Así puedes tener por agente su propio endpoint según el contrato.
3. **No llamar a la IA directamente**: el agente **no** debe llamar a ningún proveedor LLM (OpenAI, etc.). Debe devolver **`reply`** y dejar que **Core** ejecute la llamada LLM vía su flujo centralizado (`POST /core/relay/chat` → runtime → Core llama a LLM → respuesta al cliente).

---

## 1. El agente debe exponer un endpoint de chat (path variable)

- **Core** recibe el chat del cliente en **`POST /core/relay/chat`**, resuelve `tenantId + agentId` → **assignment** (binding) → deployment y reenvía la petición al endpoint configurado para ese agente.
- El **endpoint** al que Core hace el POST es **configurable por binding**: en el assignment se define el path (p. ej. `/agent/chat`) o la URL completa. Por defecto se usa **`{baseUrl}/core/runtime/chat`**; si en el binding defines otro path o URL, Core usará ese valor.
- Por tanto, el servicio del agente debe implementar **el endpoint que hayas registrado en el binding** (por convención, **`POST /core/runtime/chat`**) y responder con el contrato indicado más abajo.

**Request** que Core enviará al runtime (mismo cuerpo que recibe Core en relay, con campos añadidos como `responseMode`):

- `workspaceId`, `tenantId`, `agentId`: contexto de orquestación.
- `messages`: array de mensajes (p. ej. `[{ "role": "user", "parts": [{ "text": "..." }] }]`).
- `responseMode`: `"v2"` (canónico). En v2 el runtime solo devuelve `reply`; Core hace la llamada LLM.
- `metadata`: opcional (sessionId, channel, etc.).
- Opcionales: `appendSystemPrompt`, `signature`, `preferredProvider`, etc.

**Response esperada del runtime (v2)**:

- HTTP **200**.
- Body JSON con al menos:
  - **`reply`** (string): el contenido que el agente quiere que se envíe al modelo (p. ej. system prompt + instrucciones para “qué decir”). Core usará este `reply` para llamar al LLM y devolver la respuesta final al cliente.
  - **`trace`** (opcional): p. ej. `{ "agentRunId": "...", "fingerprint": "..." }`.
  - **`metadata`** (opcional): p. ej. `runtimeId`.

Ejemplo mínimo de respuesta v2:

```json
{
  "reply": "Eres Aliantza Compras. Responde en español, breve y accionable.\n\nContexto del usuario: ...",
  "trace": { "agentRunId": "core-abc12345", "fingerprint": "fp-xxx" },
  "metadata": { "runtimeId": "aliantza-compras" }
}
```

Si el runtime devuelve otro status (4xx/5xx), Core devolverá 502 al cliente con el detalle del downstream.

### Configuración en el binding (assignment)

En el **assignment** (binding) que une tenant + agente con un deployment se define, según el contrato, la configuración de ese agente. Incluye:

- **Endpoint de chat**: path relativo al `baseUrl` del deployment (p. ej. `chatPath: "/core/runtime/chat"`) o URL completa (p. ej. `endpointUrl`). Si no se define, Core usa por defecto `{baseUrl}/core/runtime/chat`.
- **contract**: objeto inyectado en el body que Core envía al runtime (locale, channel, etc.).
- **bindingName**: nombre del binding.

Así, para cada agente tienes su endpoint (y el resto de la config) en el binding.

---

## 2. El agente debe usar el flujo Core (relay) y no llamar a la IA

- El **cliente** (front-end o integración) debe hablar con **Core** mediante **`POST /core/relay/chat`**, no con el agente directamente.
- El **agente** (runtime) no debe llamar a APIs de IA (OpenAI, Anthropic, etc.). En el flujo v2:
  1. Cliente → **POST /core/relay/chat** (Core).
  2. Core → **POST** al endpoint del agente (definido en el binding, p. ej. `{baseUrl}/core/runtime/chat`) con `responseMode=v2`.
  3. Tu agente calcula **qué debe decir el asistente** (prompt, instrucciones, contexto) y lo devuelve en **`reply`**.
  4. **Core** llama al LLM (llm-proxy), aplica monitoreo/masking y responde al cliente.

Así, la “IA” se usa solo en Core; el código del agente se limita a producir **`reply`** y opcionalmente trace/metadata.

**Resumen para el código del agente**:

- Implementar el **endpoint de chat** que tengas configurado en el binding (por convención **`POST /core/runtime/chat`**) y, cuando `responseMode === "v2"`, responder con **`reply`** (y opcionalmente `trace`, `metadata`).
- **No** llamar a ningún proveedor LLM desde el agente; Core orquesta: recibe el chat, te pide `reply` y luego Core hace la llamada LLM.

---

## Referencias

- Contrato público de Core: **`docs/core-contract-v1.md`**.
- Arquitectura y flujo relay/runtime: **`docs/playbook/architecture.md`** (secuencia `POST /core/relay/chat` y tabla de endpoints).
- Implementación de referencia del runtime en este repo: **`src/api/routes/agent-chat.js`** (manejo de `responseMode === "v2"` y construcción de `reply`).
