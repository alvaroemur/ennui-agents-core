# Gateway BFF Integration v2

## Estado del documento

- Estado: `draft`
- Version: `v0.1`
- Fecha: `2026-03-01`
- Scope: cambios en `inspiro-agents/gateway` para integrar el flujo BFF de `core-switchboard`.

## Objetivo

Definir un contrato tecnico de integracion para que `gateway` migre de `POST /api/chat` al nuevo endpoint BFF, sin romper trazabilidad (`runId`) ni controles de tenancy (`accountId` + core-key).

## Decisiones de integracion (propuestas)

1. Endpoint canonico nuevo: `POST /api/bff/chat`.
2. `POST /api/chat` se mantiene solo como compatibilidad temporal durante migracion controlada.
3. `gateway` no invoca agentes directo; solo invoca `core-switchboard`.
4. `gateway` envia contexto conversacional; BFF decide proxy de agente + trafico LLM.

## Contrato HTTP propuesto (v2)

### Request

- Method: `POST`
- Path: `/api/bff/chat`
- Headers requeridos:
  - `Authorization: Bearer <core-key>`
  - `X-Account-Id: <accountId>`
  - `Content-Type: application/json`
- Headers recomendados:
  - `X-Request-Id: <uuid>`

Body minimo:

```json
{
  "agentId": "consultor-ia",
  "messages": [
    { "role": "user", "parts": [{ "text": "Hola" }] }
  ],
  "appendSystemPrompt": "opcional",
  "preferredProvider": "openai",
  "metadata": {
    "channel": "web",
    "sessionId": "sess-123"
  }
}
```

### Response (200)

Headers:

- `X-Run-Id: <runId>`

Body esperado:

```json
{
  "text": "respuesta final",
  "provider": "openai",
  "usage": {
    "inputTokens": 100,
    "outputTokens": 50
  },
  "trace": {
    "runId": "run-123",
    "agentRunId": "agent-run-456",
    "fingerprint": "fp-abc"
  }
}
```

### Errores esperados

| HTTP | error | Causa |
|---|---|---|
| 400 | `bad_request` | payload invalido o uso de naming legacy (`clientId`) |
| 401 | `unauthorized` | core-key ausente o invalida |
| 403 | `forbidden` | rol sin permiso o `accountId` fuera de scope |
| 404 | `not_found` | assignment/deployment no resuelto |
| 502 | `downstream_error` | fallo al invocar agente/core |
| 500 | `internal_error` | error no controlado |

## Cambios requeridos en `gateway`

1. Agregar configuracion:
   - `CORE_BFF_BASE_URL`
   - `CORE_BFF_CHAT_PATH` (default temporal `/api/chat`, target `/api/bff/chat`)
   - `CORE_BFF_TIMEOUT_MS`
2. Crear cliente HTTP unico para BFF con:
   - inyeccion de `Authorization` y `X-Account-Id`,
   - propagacion opcional de `X-Request-Id`,
   - lectura de `X-Run-Id` en respuestas.
3. Adaptar capa de parseo para aceptar shape v1/v2 mientras dure la migracion.
4. Exponer `runId` en logs de negocio y trazas de soporte.

## Plan de migracion recomendado

1. **Preparacion en gateway**
   - introducir variables de entorno y adapter de cliente BFF.
   - mantener default en `/api/chat`.
2. **Compatibilidad dual**
   - habilitar en entornos de prueba el path nuevo `/api/bff/chat`.
   - ejecutar smoke tests de regresion funcional.
3. **Cutover**
   - cambiar default de `CORE_BFF_CHAT_PATH` a `/api/bff/chat`.
   - monitorear tasa de error por `4xx/5xx` y latencia por `X-Run-Id`.
4. **Cierre**
   - retirar uso de `/api/chat` en gateway.
   - coordinar retiro definitivo del endpoint legacy en BFF.

## Criterios de aceptacion para gateway

- Chat funcional por `/api/bff/chat` para al menos una cuenta productiva/staging.
- `X-Run-Id` visible en logs de gateway y util para soporte.
- Errores 401/403/404/502 mapeados a mensajes de UX o codigos internos consistentes.
- Sin referencias a `clientId` en headers, query o body.

## Riesgos y mitigaciones

- Riesgo: drift de contrato entre equipos.
  - Mitigacion: tratar este doc como referencia de integracion hasta publicar contrato v2 final en `F-202603-06`.
- Riesgo: cambio abrupto de path.
  - Mitigacion: flag `CORE_BFF_CHAT_PATH` + fase de compatibilidad dual.
- Riesgo: regresion en trazabilidad.
  - Mitigacion: test explicito de presencia/propagacion de `X-Run-Id`.

## Referencias

- `docs/playbook/architecture.md`
- `docs/playbook/features/F-202603-06-core-bff-agent-proxy.md`
- `docs/playbook/state.md`
