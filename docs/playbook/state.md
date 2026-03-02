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
- Decidido: mantener `switchboard` como servicio separado de `core` en el MVP.
- Features activas:
  - Sin features `in_progress` al cierre de Fase 1 MVP.
- Features cerradas:
  - `F-202603-01-core-switchboard-contract-v1` (`done`)
  - `F-202603-03-switchboard-rbac-multitenant-basico` (`done`)
  - `F-202603-04-switchboard-runs-traceability-minima` (`done`)
- `F-202603-02-switchboard-persistence-domain-db` queda postergada (`dropped`) para evitar ruido en esta fase.
- Persistencia activa de `switchboard`: fallback local por archivos (`registry.json`).
- RBAC v2 implementado con separación authn/authz:
  - core-key autentica cuenta (`accountId`),
  - rol se resuelve en `registry.accounts`,
  - inputs legacy `clientId` rechazados (`400`).
- Core-keys de acceso del Gateway modeladas a nivel cuenta/deploy con registro local (`core-keys.json`).
- Decision de direccion (nueva): `gateway` operara como frontend-only con autenticacion de usuario (JWT).
  - `core-key` no debe vivir en cliente web.
  - `core-key` queda para integraciones M2M/controladas.
- Hardening post-RBAC iniciado:
  - suite automatizada de tests RBAC en `switchboard/test`,
  - workflow CI dedicado para ejecutar tests de RBAC en cambios de `switchboard`,
  - runbook operativo de rotacion segura de `core-keys` en `docs/playbook/core-keys-rotation-runbook.md`.

## Plan activo

1. Definir backlog tecnico de promotion/audit (`F-202603-05`) para siguiente iteracion.
2. Mantener documentada la ruta de reactivacion de DB para cuando se retome `F-202603-02`.
3. Preparar despliegue cloud de `core`/`switchboard` con host real de ingress.
4. Ejecutar migracion de auth para frontend-only: JWT de usuario + RBAC por cuentas (`F-202603-08`).

## Restricciones

- Evitar duplicidad documental; `state.md` manda ante conflicto.
- Mantener compatibilidad con Node.js >= 20.
- Cambios de despliegue deben estar probados internamente en Docker/K8s.

## Decisiones activas

- Usar este playbook como unica referencia operativa de sesion.
- Gestionar trabajo nuevo mediante el flujo de features del ledger.
- Mantener `switchboard` separado de `core` durante la fase MVP.

## Backlog (no comprometido)

- Evolución Core a BFF: endpoint genérico para agentes que sustituye `/api/chat`, Core-Switchboard como proxy + envío + LLM + monitoreo/masking; agentes (internos y externos) por HTTP, devuelven «qué decir», BFF envía (`F-202603-06`).
- Migracion de acceso desde `gateway` frontend-only a JWT de usuario (sin `core-key` en browser) (`F-202603-08`).
- Spike tecnico de adaptador LLM en Core usando `@mariozechner/pi-ai` para validar reemplazo/encapsulado de `src/llm.js` y decision go/no-go (`F-202603-07`).
- Definir criterios de observabilidad para trafico LLM.
- Estandarizar estrategia de masking de datos sensibles.
- Añadir checklists de release por entorno.
