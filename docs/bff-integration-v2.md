# BFF Integration v2 (hipotético cliente)

## Estado del documento

- Estado: `draft`
- Version: `v0.1`
- Fecha: `2026-03-01`
- Scope: contrato de integracion para un **hipotético front-end o cliente** que consuma el flujo BFF de core. No existe producto «gateway» en el repo.

## Objetivo

Definir un contrato tecnico para que un hipotético cliente (p. ej. SPA) consuma el endpoint de chat de core (`POST /core/relay/chat` ya canonico), con trazabilidad (`runId`) y controles de tenancy (workspace/tenant + core-key o JWT).

## Decisiones de integracion (propuestas)

1. Endpoint canonico actual: `POST /core/relay/chat` (ver core-contract-v1.md).
2. Un hipotético front-end no invoca agentes directo; solo invoca core.
3. El cliente envia contexto conversacional (workspaceId, tenantId, agentId, messages); core resuelve y reenvía al runtime.

## Contrato HTTP propuesto (v2)

### Request

- Method: `POST`
- Path: `/core/relay/chat`
- Headers requeridos:
  - `Authorization: Bearer <user-jwt>` (UI) o `Authorization: Bearer <core-key>` (M2M)
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
| 401 | `unauthorized` | JWT/core-key ausente o invalido |
| 403 | `forbidden` | rol sin permiso o `workspaceId` fuera de scope |
| 404 | `not_found` | assignment/deployment no resuelto |
| 502 | `downstream_error` | fallo al invocar agente/core |
| 500 | `internal_error` | error no controlado |

## Cambios requeridos en un hipotético cliente

1. Configuracion sugerida:
   - `CORE_BFF_BASE_URL`
   - `CORE_BFF_CHAT_PATH` (p. ej. `/core/relay/chat`)
   - `CORE_BFF_TIMEOUT_MS`
2. Crear cliente HTTP unico para BFF con:
   - inyeccion de `Authorization`,
   - propagacion opcional de `X-Request-Id`,
   - lectura de `X-Run-Id` en respuestas.
3. Adaptar capa de parseo para aceptar shape v1/v2 mientras dure la migracion.
4. Exponer `runId` en logs de negocio y trazas de soporte.

## Plan de migracion recomendado

1. **Preparacion en el cliente**
   - introducir variables de entorno y adapter de cliente BFF.
   - endpoint canonico: `POST /core/relay/chat`.
2. **Validacion**
   - habilitar en entornos de prueba el consumo de `POST /core/relay/chat`.
   - ejecutar smoke tests de regresion funcional.
3. **Cutover**
   - confirmar uso de `CORE_BFF_CHAT_PATH` apuntando a `/core/relay/chat`.
   - monitorear tasa de error por `4xx/5xx` y latencia por `X-Run-Id`.
4. **Cierre**
   - usar solo `POST /core/relay/chat` (endpoint canonico).
   - coordinar con core cualquier retiro de rutas legacy si aplica.

## Criterios de aceptacion para el cliente

- Chat funcional por `POST /core/relay/chat` para al menos un workspace/tenant productivo o staging.
- `X-Run-Id` visible en logs del cliente y util para soporte.
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
