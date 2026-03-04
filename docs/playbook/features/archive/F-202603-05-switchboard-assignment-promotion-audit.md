# F-202603-05-switchboard-assignment-promotion-audit

## Meta

- Estado: `done`
- Owner: alvaromur
- Fecha creacion: 2026-03-01
- Ultima actualizacion: 2026-03-03

## Objetivo

Habilitar promocion y rollback de assignments por cuenta con auditoria de cambios y validaciones basicas de salud.

## Contexto

Para operar en vivo, un hipotético front-end o operador necesita poder cambiar el deployment activo de una asignación sin perder trazabilidad ni control de riesgo. Hoy las asignaciones (tenant + agent → deployment) viven en el registro (DB o registry.json); esta feature añade promoción/rollback con validación de salud y auditoría, sin cambiar el modelo actual.

## Definition of done

- [x] Cada cambio de assignment guarda `from -> to`, actor y timestamp.
- [x] Antes de promover, el deployment destino valida `GET /health`.
- [x] Existe endpoint de rollback al deployment anterior inmediato.
- [x] Auditoria por cuenta consultable por rango de fechas.

## Implementacion C1 (2026-03-03)

- Se implementan endpoints en core:
  - `POST /core/workspaces/:workspaceId/assignments/promote`
  - `POST /core/workspaces/:workspaceId/assignments/rollback`
  - `GET /core/workspaces/:workspaceId/assignments/audit`
- Promocion y rollback registran evento auditable con `eventId`, `fromDeploymentId`, `toDeploymentId`, actor, motivo, `healthCheck`, resultado y `timestamp`.
- `promote` exige health-check previo (`GET /health`) del deployment destino.
- `rollback` toma como objetivo el deployment anterior inmediato desde la ultima transicion exitosa auditada.
- Persistencia de auditoria disponible en DB (`switchboard_assignment_audit`) y en fallback file (`assignment_audit` en `registry.json`).
- Cobertura automatizada en `src/api/test/core-c1.test.js` para `promote/rollback/audit` y persistencia en fallback.

## Contrato C0 cerrado (listo para implementacion)

### Modelo de evento de auditoria acordado

```json
{
  "eventId": "evt-123",
  "workspaceId": "inspiro-agents",
  "tenantId": "aliantza",
  "agentId": "aliantza-compras",
  "fromDeploymentId": "dep-a",
  "toDeploymentId": "dep-b",
  "action": "promote",
  "actor": {
    "type": "user",
    "subject": "user-123",
    "role": "operador-cuenta"
  },
  "reason": "canary ok",
  "result": "success",
  "healthCheck": {
    "url": "https://dep-b.example.com/health",
    "statusCode": 200,
    "latencyMs": 82
  },
  "timestamp": "2026-03-03T10:00:00Z"
}
```

### Reglas operativas acordadas

- `promote` exige health-check previo del deployment destino (`GET /health` con timeout configurable).
- `rollback` siempre apunta al deployment anterior inmediato registrado en auditoria.
- Todo intento (exitoso o fallido) deja evento auditable.
- El actor se toma del principal autenticado en core (JWT o core-key M2M), con `workspaceId` obligatorio.

### Superficie API objetivo (C1)

- `POST /core/workspaces/:workspaceId/assignments/promote`
- `POST /core/workspaces/:workspaceId/assignments/rollback`
- `GET /core/workspaces/:workspaceId/assignments/audit?from=&to=&tenantId=&agentId=`

Nota: los paths quedan congelados para implementacion C1; ajustes menores de naming solo si afectan compatibilidad con `core-contract`.

## Priorizacion

- Impacto: medio
- Esfuerzo: medio
- Prioridad: media

## Dependencias

- Tecnicas: persistencia robusta de dominio y RBAC.
- De negocio: politica operativa de promocion/rollback.

## Siguiente accion

Definir politica de retencion/archivado de `assignment_audit` para volumen alto y observabilidad operativa en C2.

## Historial de estado

- 2026-03-01: `inbox` (creacion)
- 2026-03-03: `candidate` (alcance tecnico de promotion/rollback priorizado para C0).
- 2026-03-03: `validated` (modelo de evento de auditoria y superficie API objetivo cerrados).
- 2026-03-03: `ready` (feature lista para ejecucion C1; implementacion pendiente).
- 2026-03-03: `in_progress` (implementacion de endpoints y persistencia de auditoria).
- 2026-03-03: `done` (promote/rollback/audit en core con health-check y pruebas E2E).
