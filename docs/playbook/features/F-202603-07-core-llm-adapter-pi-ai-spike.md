# F-202603-07-core-llm-adapter-pi-ai-spike

## Meta

- Estado: `candidate`
- Owner: alvaromur
- Fecha creacion: 2026-03-01
- Ultima actualizacion: 2026-03-02

## Objetivo

Validar tecnicamente el uso del **paquete** `@mariozechner/pi-ai` como adaptador LLM unificado en Core para reducir complejidad de providers y preparar la implementacion de `F-202603-06`.

## Contexto

- Core hoy usa `src/llm/core.js` con integracion propia para OpenAI, Gemini y OpenRouter, mas monitoreo/masking en `src/llm-proxy/`.
- La feature `F-202603-06` requiere una capa BFF de trafico LLM mas robusta, extensible y desacoplada.
- La integracion es con el **paquete npm** `@mariozechner/pi-ai` (directorio `packages/ai` del repo pi-mono): API unificada multi-provider (OpenAI, Anthropic, Google, OpenRouter, etc.) con esquema compatible en espiritu con OpenAI (`getModel`, `stream`/`complete`, `Context`). No se integra el monorepo pi-mono completo ni otros paquetes (coding-agent, web-ui, etc.).

## Alcance minimo del PoC

- **Ruta de entrada**: variable de entorno (ej. `USE_PI_AI=true`) que desvia las llamadas a un adaptador que usa `@mariozechner/pi-ai` en lugar de `src/llm/core.js`; sin env, se mantiene el comportamiento actual.
- **Modelo inicial**: un proveedor (ej. OpenAI u OpenRouter) con un modelo fijo para validar flujo completo.
- **Criterios de comparacion**: mismo payload de entrada produce salida equivalente en forma (`text`, `provider`, `usage` con `inputTokens`/`outputTokens`); `llm-proxy` recibe el mismo contrato.

## Definition of done

- [x] Existe PoC que reemplaza o envuelve `src/llm/core.js` usando `@mariozechner/pi-ai` sin romper el contrato actual (`text`, `provider`, `usage`).
- [x] Se valida que `llm-proxy` mantiene monitoreo y masking con la integracion propuesta.
- [ ] Se documenta comparativa tecnica entre implementacion actual y `pi-ai` (capabilities, riesgos, costo de migracion).
- [ ] Se registra decision go/no-go y plan de integracion con `F-202603-06`.

## Resultado PoC y decision

- **PoC validado (2026-03-02)**: El adaptador `src/llm/pi-ai.js` con `USE_PI_AI=true` funciona correctamente: mismo contrato que legacy (`text`, `provider`, `usage`), llm-proxy mantiene monitoreo y masking, y con API key real se obtiene respuesta y usage del modelo.
- **Integracion definitiva**: Queda para una iteracion posterior. Incluye (segun prioridad): hacer pi-ai el camino por defecto o sustituir por completo `src/llm/core.js`, documentar comparativa tecnica y cerrar decision go/no-go con plan para `F-202603-06`.

## Priorizacion

- Impacto: alto
- Esfuerzo: medio
- Prioridad: media

## Dependencias

- Tecnicas: `F-202603-06`, `F-202603-01`, `F-202603-04`.
- De negocio: alineacion de estrategia BFF Core-Switchboard.

## Siguiente accion

En iteracion posterior: (1) comparativa tecnica actual vs pi-ai y decision go/no-go con plan para F-202603-06; (2) integracion definitiva (pi-ai por defecto o sustitucion completa de legacy).

## Historial de estado

- 2026-03-01: `inbox` (creacion)
- 2026-03-02: `candidate` (alcance minimo del PoC definido; integracion acotada al paquete `@mariozechner/pi-ai`)
- 2026-03-02: PoC implementado: `src/llm/pi-ai.js` (adaptador), `USE_PI_AI` en `src/llm/core.js`, monitoreo/masking en llm-proxy validado.
