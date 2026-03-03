# State

## Objetivo del proyecto

Mantener y evolucionar `ennui-agents-core` como paquete base para agentes con:
- runtime reutilizable,
- API HTTP y CLI estables,
- soporte multi-provider para LLM,
- despliegue reproducible en Docker/K8s.

## Estado actual

- Playbook inicializado.
- Se detectan cambios de codigo e infraestructura en curso en el repositorio.
- Features Fase 1 formalizadas en el ledger.
- Decidido: mantener `switchboard` como modulo interno separado del runtime, con superficie publica unificada bajo `core`.
- API publica canonica: `core/*` (health, me, workspaces, tenants, agents, runs, `POST /core/relay/chat`). Chat orquestado solo en core; switchboard sin endpoint de chat publico.
- Features activas:
  - Features `in_progress`:
    - `F-202603-08-switchboard-jwt-user-auth-frontend-gateway` (foco inmediato para habilitar front-end con JWT sobre `core/*`).
  - Features `ready` para ejecucion secuencial C1:
    - `F-202603-06-core-bff-agent-proxy`
    - `F-202603-05-switchboard-assignment-promotion-audit`
- Features cerradas:
  - `F-202603-01-core-switchboard-contract-v1` (`done`)
  - `F-202603-03-switchboard-rbac-multitenant-basico` (`done`)
  - `F-202603-04-switchboard-runs-traceability-minima` (`done`)
  - `F-202603-09-core-api-publica-unificada-relay` (`done`)
  - `F-202603-10-core-db-domain-completo` (`done`)
- `F-202603-02-switchboard-persistence-domain-db` queda postergada (`dropped`) a favor de F-202603-10.
- Persistencia: esquema DB completo en Neon/Postgres (`workspaces`, `users`, `workspace_memberships`, `tenants`, `agents`, `deployments`, `assignments`, `runs`); si no hay DB, fallback a `registry.json`. Configuracion de agentes consolidada en DB; el repo no usa `config.json` por agente.
- RBAC v2 con scope por workspace:
  - core-key o JWT de usuario identifica al principal; rol y `allowedWorkspaces` se resuelven desde registro/claims.
  - inputs legacy `clientId` rechazados (`400`).
- Core-keys modeladas a nivel cuenta/deploy con registro local (`core-keys.json`) para consumidores M2M.
- Decision de direccion: un hipotético front-end operaria sin `core-key` en el browser; autenticacion de usuario (JWT).
  - `core-key` no debe vivir en cliente web.
  - `core-key` queda para integraciones M2M/controladas.
- Decision de direccion (nueva): API publica canonica en `core/*` con contratos minimos.
  - `switchboard` queda como modulo interno para control plane (workspaces/cuentas, tenants, asignacion de agentes).
  - `tenant` se define como entidad separada del dominio.
- `F-202603-09-core-api-publica-unificada-relay` pasa a `ready` con contrato v1 y handoff:
  - modelo canonico `workspace/tenant/agent/assignment/run/user/membership`,
  - contrato publico minimo en `core/*`,
  - retiro de legacy inmediato (sin fase dual) y seed inicial con agentes mock.
  - artefacto canonico: `docs/core-contract-v1.md`.
- Hardening post-RBAC iniciado:
  - suite automatizada de tests RBAC en `switchboard/test`,
  - workflow CI dedicado para ejecutar tests de RBAC en cambios de `switchboard`,
  - runbook operativo de rotacion segura de `core-keys` en `docs/core-keys-rotation-runbook.md`.

## Plan activo (alineado a `roadmap.md` v0.2 / inicio de Fase C1)

1. Ejecutar `F-202603-08` (foco actual) en `in_progress`:
   - implementar validacion JWT end-to-end (`issuer`, `audience`, `jwks`) en `core/*`,
   - aplicar RBAC por `allowedWorkspaces` en todos los endpoints protegidos.
2. Al cerrar `F-202603-08`, ejecutar `F-202603-06` en `in_progress`:
   - implementar flujo runtime v2 (agente devuelve «que decir»),
   - centralizar llamada LLM y masking/monitoreo en core.
3. Al estabilizar `F-202603-06`, ejecutar `F-202603-05` en `in_progress`:
   - implementar endpoints de `promote`/`rollback` y auditoria,
   - forzar health-check previo en promotion y rollback inmediato seguro.
4. Gate de salida C1:
   - `F-202603-08` y `F-202603-05` en `done`,
   - `F-202603-06` en `validated` o `done` con rollout gradual.

## Restricciones

- Evitar duplicidad documental; `state.md` manda ante conflicto.
- Mantener compatibilidad con Node.js >= 20.
- Cambios de despliegue deben estar probados internamente en Docker/K8s.

## Decisiones activas

- Usar este playbook como unica referencia operativa de sesion.
- Gestionar trabajo nuevo mediante el flujo de features del ledger.
- Mantener `switchboard` como modulo interno de control con superficie publica unificada bajo `core`.
- **Consumidores de la API**: No existe un producto «gateway» en el repo; las referencias a front-end o cliente en el playbook aluden a un **hipotético front-end** que podria consumir la API `core/*` (p. ej. una SPA que gestione workspaces/tenants/agentes con JWT o core-key M2M).
- Orden C1 confirmado: ejecucion secuencial `F-08` -> `F-06` -> `F-05`.
- Politica de fallback confirmada: en prod solo degradacion de emergencia (con alerta y retorno a DB como objetivo inmediato).
- Observabilidad minima acordada para salida cloud: nivel B (`runId`, estado, latencia, provider, tokens, costo estimado + SLO/alertas base).
- Freeze del contrato `core/*` v1.1 fijado al cierre de C1.

## Backlog (no comprometido)

- Spike tecnico de adaptador LLM en Core: integrar paquete `@mariozechner/pi-ai` (API unificada multi-provider, esquema compatible OpenAI) para validar reemplazo de `src/llm/core.js` y decision go/no-go (`F-202603-07`, candidate).
- Implementar politica de fallback ya acordada (prod solo emergencia degradada) con señalizacion operativa y retorno a DB.
- Implementar observabilidad minima acordada (nivel B) para trafico LLM y corridas.
- Estandarizar estrategia de masking de datos sensibles.
- Preparar paquete de salida cloud (Fase C2): ingress real + smoke E2E autenticado + checklist de release por entorno.
