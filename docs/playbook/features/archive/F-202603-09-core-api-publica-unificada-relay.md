# F-202603-09-core-api-publica-unificada-relay

## Meta

- Estado: `done`
- Owner: alvaromur
- Fecha creacion: 2026-03-01
- Ultima actualizacion: 2026-03-01 (ready para ejecucion)

## Objetivo

Unificar la superficie publica del sistema bajo `core` con contratos minimos en `core/*`, dejando `switchboard` como modulo interno de control y habilitando un endpoint relay/proxy para trafico cliente <-> agente con monitoreo y masking.

## Contexto

El repositorio acumulo capas y variables de entorno heredadas (`core` y `switchboard`) con responsabilidades cruzadas de auth y routing. Se requiere simplificar la arquitectura para operar como orquestador de agentes con una cara publica unica (`core`), conservando internamente el control plane (cuentas/workspaces, tenants y asignaciones).

Adicionalmente, se define que:
- `tenant` es entidad separada en el dominio.
- El seed inicial puede usar agentes mock para desbloquear integracion y UX, y luego reemplazarlos por conexiones reales.
- Todos los agentes, incluidos los legacy dentro del repo, se consumen por HTTP API.

## Blueprint v1 (materializado)

### Modelo de dominio canonico

- `workspaces` (alias operativo temporal: `accounts`)
- `tenants` (entidad separada)
- `agents`
- `deployments`
- `assignments` (`tenantId + agentId -> deploymentId`)
- `runs`
- `users`
- `workspace_memberships` (rol por workspace)

### Contrato publico minimo (`core/*`)

- `GET /core/health`
- `GET /core/me`
- `GET /core/workspaces`
- `GET /core/workspaces/:workspaceId/tenants`
- `GET /core/tenants/:tenantId/agents`
- `GET /core/runs`
- `GET /core/runs/:runId`
- `POST /core/relay/chat` (relay/proxy canonico)

### Artefacto de contrato v1

- `docs/playbook/core-contract-v1.md`

### Responsabilidad de `POST /core/relay/chat`

- authn/authz por JWT de usuario y scope de workspace/tenant.
- resolucion `tenant + agent -> deployment`.
- invocacion HTTP a agente (interno o externo).
- monitoreo y masking en core antes/despues de invocar LLM.
- registro de `run` y respuesta con correlacion (`runId`).

### Seed inicial (mock)

- Workspace: `Inspiro Agents`.
- Tenants:
  - `Aliantza`
  - `Inspiro Agents Web`
- Agentes:
  - `Aliantza`: 1 mock (`Aliantza-Compras`).
  - `Inspiro Agents Web`: 4 mocks.

### Migracion por fases

1. Publicar superficie canonica en `core/*`.
2. Retirar rutas legacy de forma inmediata (sin ventana dual de compatibilidad).
3. Actualizar consumidores/documentacion al contrato canonico y cerrar contrato v1.

## Definition of done

- [x] Existe contrato publico canonico en `core/*` con pocos endpoints y responsabilidades acotadas.
- [x] Existe endpoint relay/proxy (en `core/*`) que intermedia cliente <-> agente y aplica monitoreo + masking.
- [x] `switchboard` queda interno al sistema (no expuesto como producto/API publica separada de `core`).
- [x] Se define modelo relacional con entidades separadas: `workspaces` (o `accounts`), `users`, `roles/memberships`, `tenants`, `agents`, `assignments`, `runs`.
- [x] Se migra persistencia de JSON a DB relacional con soporte `JSONB` para configuraciones de agente cuando aplique.
- [x] Seed inicial disponible con mockups: workspace `Inspiro Agents`, tenants `Aliantza` e `Inspiro Agents Web`, con 1 agente mock en `Aliantza` (`Aliantza-Compras`) y 4 agentes mock en `Inspiro Agents Web`.
- [x] Se elimina ambiguedad de variables de entorno y se publica matriz canonica de env vars por modulo/fase de migracion.

## Priorizacion

- Impacto: alto
- Esfuerzo: alto
- Prioridad: alta

## Dependencias

- Tecnicas: `F-202603-02`, `F-202603-04`, `F-202603-06`, `F-202603-08`.
- De negocio: cierre de vocabulario canonico (`workspace` vs `account`) y politica de roles por workspace/tenant.

## Siguiente accion

Iniciar implementacion (`in_progress`) en proxima sesion con este orden:

1. Exponer rutas publicas `core/*` y `POST /core/relay/chat`.
2. Integrar resolucion `workspaceId + tenantId + agentId -> deployment`.
3. Mantener monitoreo/masking y correlacion `X-Run-Id` en la nueva ruta.
4. Adaptar tests HTTP al contrato v1 (`core-contract-v1.md`).
5. Actualizar docs operativas y checklist de cierre.

## Historial de estado

- 2026-03-01: `inbox` (creacion)
- 2026-03-01: `candidate` (blueprint v1 de dominio + contrato `core/*` + retiro legacy inmediato aprobado)
- 2026-03-01: `validated` (contrato publico v1 documentado en `core-contract-v1.md`)
- 2026-03-01: `ready` (scope y orden de ejecucion cerrados para proxima sesion)
- 2026-03-02: `in_progress` (implementando rutas `core/*` y conectando seed)
- 2026-03-02: `done` (rutas publicas migradas a `core/*`, persistencia adaptada a tenants)
