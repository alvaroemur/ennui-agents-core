# F-202603-06-core-bff-agent-proxy

## Meta

- Estado: `candidate`
- Owner: alvaromur
- Fecha creacion: 2026-03-01
- Ultima actualizacion: 2026-03-01 (doc tecnico gateway v2)

## Objetivo

Evolucionar Core-Switchboard como BFF único: un endpoint que sustituye a `/api/chat`, sirve de proxy entre el cliente (Gateway) y agentes de múltiples tipos (internos y externos), y centraliza tráfico a LLMs, monitoreo y enmascaramiento. Los agentes solo devuelven «qué decir»; el BFF es quien envía.

## Contexto

- Core-Switchboard debe ser explícitamente el BFF del Gateway. Todo (orquestación, proxy, LLM, monitoreo, masking) forma parte de **core-switchboard**.
- El endpoint actual `/api/chat` se sustituye por uno nuevo (nombre a definir); no se mantiene como alias indefinido.
- Agentes **internos** se invocan también **por HTTP** (mismo contrato que externos); no hay invocación in-process. Los internos son un deployment con `baseUrl` (p. ej. servicio local).
- Agentes (externos e internos) **solo devuelven el contenido a decir**; el **endpoint (core-switchboard)** es quien **envía**: realiza la llamada a LLM cuando corresponde, aplica monitoreo y masking, y devuelve la respuesta al cliente.
- Core no debe ser experto en ningún agente: solo lógica genérica para invocar al agente (proxy), tráfico a LLMs, monitoreo y enmascaramiento de payloads. La arquitectura debe permitir extraer agentes a servicios externos sin rediseñar el sistema.

## Decisiones de diseño (registradas 2026-03-01)

- Nuevo endpoint **sustituye** a `POST /api/chat` (migración controlada; luego retirada del path antiguo).
- Agentes internos: **siempre por HTTP** (deployment con `baseUrl`; mismo contrato que externos).
- Agentes devuelven **solo «qué decir»**; el **BFF envía** (llamada a LLM, monitoreo, masking, respuesta al cliente).
- Todo bajo **core-switchboard** (un solo sistema BFF).

## Artefactos tecnicos

- Borrador de integracion para cambios en `gateway`: `docs/playbook/gateway-bff-integration-v2.md`.

## Definition of done

- [ ] Existe contrato v2 (o actualización del contrato) que define el nuevo endpoint y responsabilidades del BFF (proxy, envío, LLM, monitoreo, masking).
- [ ] El nuevo endpoint sustituye a `POST /api/chat`; migración documentada y path antiguo retirado según plan.
- [ ] Agentes internos se invocan por HTTP (deployment local con mismo contrato que externos).
- [ ] Agentes (internos y externos) devuelven solo el contenido a decir; el BFF realiza la llamada a LLM cuando aplica, monitoreo y masking, y envía la respuesta al cliente.
- [ ] Core no contiene lógica experta por agente; solo dispatcher/proxy genérico, tráfico LLM (`llm-proxy`), monitoreo y enmascaramiento.
- [ ] Runs y trazabilidad se mantienen (F-202603-04); el BFF sigue registrando runs al hacer proxy/invocación.

## Priorizacion

- Impacto: alto
- Esfuerzo: alto
- Prioridad: media (siguiente iteración tras Fase 1 MVP)

## Dependencias

- Tecnicas: F-202603-01 (evolución a contrato v2), F-202603-04 (runs), F-202603-03 (RBAC).
- De negocio: alineación con visión «Core como BFF» y agentes extraíbles.

## Siguiente accion

Validar el borrador tecnico con el equipo de `gateway` (endpoint, headers y estrategia de migracion) y cerrar contrato v2 final para mover la feature a `validated`.

## Historial de estado

- 2026-03-01: `inbox` (creación; decisiones de diseño registradas en avance y backlog).
- 2026-03-01: `candidate` (existe borrador tecnico de integracion con `gateway` para contrato/migracion v2).
