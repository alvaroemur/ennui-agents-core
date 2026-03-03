# F-202603-06-core-bff-agent-proxy

## Meta

- Estado: `ready`
- Owner: alvaromur
- Fecha creacion: 2026-03-01
- Ultima actualizacion: 2026-03-03

## Objetivo

Evolucionar el BFF (core) para que sea **core** quien realice la llamada a LLM y aplique monitoreo/masking, mientras los agentes (internos y externos) solo devuelven «qué decir». Hoy el flujo es: core reenvía a runtime (deployment) y el **runtime** hace agente + LLM; esta feature plantea invertir eso: core invoca al agente (HTTP), recibe contenido a decir, y **core** llama al LLM y responde al cliente.

## Estado respecto a F-202603-09 (ya hecho)

- **Entregado por F-202603-09**: Superficie pública única `core/*`; endpoint canónico de chat **`POST /core/relay/chat`**; core resuelve workspace/tenant/agent → deployment y reenvía el request al runtime; runs y trazabilidad. El cliente ya no usa `POST /api/chat` en switchboard (eliminado); usa `POST /core/relay/chat`.
- **Pendiente (alcance de esta feature)**: Que el **BFF (core)** sea quien llame al LLM y los agentes (runtime) solo devuelvan el contenido a decir. Implica: (1) contrato del runtime que devuelva solo «qué decir»; (2) core invoca agente, luego core llama a `callLLM`/llm-proxy y devuelve la respuesta; (3) monitoreo y masking centralizados en core.

## Contexto

- Core ya es la única cara pública (F-09). Falta el paso de «BFF envía a LLM»: hoy el runtime (deployment) hace agente + LLM; el objetivo es que el runtime solo ejecute el agente y devuelva el contenido, y core haga la llamada a LLM.
- Agentes **internos** y externos se invocan por HTTP (deployment con `baseUrl`); mismo contrato.
- Core no debe ser experto en ningún agente: solo proxy genérico, tráfico LLM (`llm-proxy`), monitoreo y masking.

## Decisiones de diseño (registradas 2026-03-01; vigentes)

- Agentes internos: **siempre por HTTP** (deployment con `baseUrl`; mismo contrato que externos).
- Agentes devuelven **solo «qué decir»**; el **BFF (core) envía** (llamada a LLM, monitoreo, masking, respuesta al cliente).
- Todo bajo **core** (switchboard interno); superficie pública `core/*`.

## Artefactos tecnicos

- Borrador de integracion para un hipotético cliente front-end: `docs/bff-integration-v2.md`.
- Contrato publico vigente: `docs/core-contract-v1.md`.

## Definition of done

- [x] Existe endpoint canónico de chat en core (`POST /core/relay/chat`) y proxy a deployment (entregado en F-202603-09).
- [ ] Contrato v2 (o actualización) que define responsabilidades del BFF: core invoca agente (HTTP), recibe «qué decir», core llama a LLM (`llm-proxy`), aplica monitoreo/masking y responde al cliente.
- [ ] Runtime (agente) devuelve solo el contenido a decir; core realiza la llamada a LLM y envía la respuesta al cliente.
- [ ] Agentes internos y externos se invocan por HTTP (mismo contrato); core no contiene lógica experta por agente.
- [ ] Runs y trazabilidad se mantienen; el BFF sigue registrando runs al hacer proxy e invocación a LLM.

## Contrato C0 cerrado (listo para implementacion)

### Responsabilidades congeladas

- Runtime (agente) devuelve solo la intencion/respuesta base ("que decir"), sin invocar LLM.
- Core mantiene el endpoint publico `POST /core/relay/chat`, invoca runtime por HTTP, llama a LLM via `llm-proxy`, y responde al cliente.
- Monitoreo, masking y trazabilidad (`runId`) quedan centralizados en core.

### Contrato logico core -> runtime (v2)

- Entrada minima desde core: `workspaceId`, `tenantId`, `agentId`, `messages`, `metadata`.
- Salida minima del runtime:
  - `reply` (string o estructura equivalente de contenido a decir),
  - `trace.agentRunId` (opcional),
  - `metadata` (opcional para diagnostico).
- Salida prohibida como dependencia de contrato: el runtime no debe ser responsable de `provider`, `usage` ni llamada directa a LLM.

### Compatibilidad de migracion (C1)

- Se permite modo transitorio para deployments legacy mientras migran al contrato v2.
- Core debe mantener control de rollback por deployment si un runtime aun no cumple v2.
- Criterio de cierre funcional de feature: todo deployment activo en contrato v2 y core centralizando trafico LLM.

## Priorizacion

- Impacto: alto
- Esfuerzo: alto
- Prioridad: media (siguiente iteración tras Fase 1 MVP)

## Dependencias

- Tecnicas: F-202603-01, F-202603-04, F-202603-03, F-202603-09 (todas done). Contrato actual: `core-contract-v1.md`.
- De negocio: alineación con visión «Core como BFF» y agentes extraíbles.

## Siguiente accion

Iniciar `in_progress` en C1 implementando el flujo v2 en core/runtime con bandera de migracion y pruebas de regresion de runs + RBAC.

## Historial de estado

- 2026-03-01: `inbox` (creación; decisiones de diseño registradas en avance y backlog).
- 2026-03-01: `candidate` (existe borrador tecnico de integracion para hipotético cliente; contrato/migracion v2).
- 2026-03-02: Alcance revisado: F-09 ya entregó endpoint canónico y proxy; pendiente que core sea quien llame al LLM y agentes solo devuelvan «qué decir».
- 2026-03-03: `validated` (contrato C0 core->runtime y responsabilidades del BFF cerradas).
- 2026-03-03: `ready` (feature lista para ejecucion C1; implementacion pendiente).
