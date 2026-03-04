# Archive de Features

Este archivo contiene el consolidado de las features que han sido cerradas (`done` o `dropped`) para mantener el directorio de features limpio y con un volumen manejable de archivos activos. Los archivos completos de cada feature archivada estan en **`features/archive/`**; en este documento solo se listan el resumen y criterios. La lista activa de trabajo son las features en estado distinto de `done`/`dropped` (archivos `F-*.md` en el propio directorio `features/`).

**Nota**: Algunas features archivadas mencionan «Gateway» como consumidor; ese producto fue eliminado. En el playbook activo se habla de un **hipotético front-end** o cliente que consuma la API core.

## Estructura de registro

Al archivar una feature, se debe preservar la siguiente información:
- **ID y Título**: Ejemplo: `F-202603-01-core-switchboard-contract-v1`
- **Estado final**: `done` o `dropped`
- **Fechas clave**: Creado, Iniciado, Cerrado
- **Resumen**: Breve descripción del objetivo
- **Criterio de Done**: Verificación final realizada

---

## Features Archivadas

### F-202603-01-core-switchboard-contract-v1
- **Estado final**: `done`
- **Fechas**: Creado 2026-03-01, Cerrado 2026-03-01
- **Resumen**: Contrato v1 entre switchboard (control plane) y core (data plane): `/health`, `/api/chat`, `/api/config`; versionado, errores y headers de correlación.
- **Criterio**: Documento de contrato v1 publicado, smoke test local switchboard → core.

### F-202603-02-switchboard-persistence-domain-db
- **Estado final**: `dropped`
- **Fechas**: Creado 2026-03-01, Postergado 2026-03-01
- **Resumen**: Persistencia de switchboard en DB (clients, agents, deployments, assignments). Sustituida por F-202603-10 (modelo de dominio completo en DB).
- **Criterio**: Postergada a favor de F-202603-10; fallback por archivos en uso.

### F-202603-03-switchboard-rbac-multitenant-basico
- **Estado final**: `done`
- **Fechas**: Creado 2026-03-01, Cerrado 2026-03-01
- **Resumen**: RBAC en switchboard: authn por core-key, authz por rol (admin-tecnico, operador-cuenta, lector-cuenta), scope por accountId/workspace; rechazo de clientId legacy.
- **Criterio**: Matriz rol-permiso documentada, RBAC v2 estable, tests de authn/authz.

### F-202603-04-switchboard-runs-traceability-minima
- **Estado final**: `done`
- **Fechas**: Creado 2026-03-01, Cerrado 2026-03-01
- **Resumen**: Trazabilidad de runs: creación/cierre por request, metadata (runId, accountId, agentId, deploymentId, latencia), endpoints GET /api/runs y GET /api/runs/:runId, header X-Run-Id.
- **Criterio**: Runs creados y finalizados por chat, E2E validado con core en K8s. Nota: API pública de chat pasó a `POST /core/relay/chat` (F-202603-09); runs se consultan vía core.

### F-202603-09-core-api-publica-unificada-relay
- **Estado final**: `done`
- **Fechas**: Creado 2026-03-01, Cerrado 2026-03-02
- **Resumen**: API pública unificada bajo `core/*`: health, me, workspaces, tenants, agents, runs, y `POST /core/relay/chat` como endpoint canónico de chat orquestado; switchboard interno.
- **Criterio**: Contrato v1 en core-contract-v1.md, rutas core/* implementadas, seed mock, retiro de legacy inmediato.

### F-202603-10-core-db-domain-completo
- **Estado final**: `done`
- **Fechas**: Creado 2026-03-02, Cerrado 2026-03-02
- **Resumen**: Modelo de dominio completo en DB (Neon/Postgres): workspaces, users, workspace_memberships, tenants, agents, deployments, assignments, runs; nomenclatura workspaces en todo el stack.
- **Criterio**: Esquema en switchboard/src/registry.js, seed Inspiro Agents/Aliantza/Inspiro Agents Web, endpoints core adaptados.

### F-202603-08-switchboard-jwt-user-auth-frontend-gateway
- **Estado final**: `done`
- **Fechas**: Creado 2026-03-01, Cerrado 2026-03-03
- **Resumen**: JWT de usuario para hipotético front-end en core/*: validación issuer/audience/JWKS, RBAC por allowedWorkspaces; core-keys solo M2M.
- **Criterio**: JWT end-to-end en core/*, validación JWKS, E2E sin core-key en cliente; pruebas en core-c1.test.js y switchboard:test.

### F-202603-06-core-bff-agent-proxy
- **Estado final**: `done`
- **Fechas**: Creado 2026-03-01, Cerrado 2026-03-03
- **Resumen**: BFF centraliza LLM: runtime devuelve solo «qué decir» (contrato v2 reply); core ejecuta llm-proxy y responde al cliente; fallback legacy activo.
- **Criterio**: POST /core/relay/chat con responseMode v2, core centraliza LLM, trazabilidad; pruebas E2E en core-c1.test.js.

### F-202603-05-switchboard-assignment-promotion-audit
- **Estado final**: `done`
- **Fechas**: Creado 2026-03-01, Cerrado 2026-03-03
- **Resumen**: Promoción y rollback de assignments con auditoría: from/to, actor, health-check previo, rollback al deployment anterior; persistencia en DB y fallback.
- **Criterio**: Endpoints promote/rollback/audit en core, eventos auditables, health-check obligatorio; pruebas en core-c1.test.js.