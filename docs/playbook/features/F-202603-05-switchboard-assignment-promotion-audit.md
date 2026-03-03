# F-202603-05-switchboard-assignment-promotion-audit

## Meta

- Estado: `ready`
- Owner: alvaromur
- Fecha creacion: 2026-03-01
- Ultima actualizacion: 2026-03-03

## Objetivo

Habilitar promocion y rollback de assignments por cuenta con auditoria de cambios y validaciones basicas de salud.

## Contexto

Para operar en vivo, un hipotético front-end o operador necesita poder cambiar el deployment activo de una asignación sin perder trazabilidad ni control de riesgo. Hoy las asignaciones (tenant + agent → deployment) viven en el registro (DB o registry.json); esta feature añade promoción/rollback con validación de salud y auditoría, sin cambiar el modelo actual.

## Definition of done

- [ ] Cada cambio de assignment guarda `from -> to`, actor y timestamp.
- [ ] Antes de promover, el deployment destino valida `GET /health`.
- [ ] Existe endpoint de rollback al deployment anterior inmediato.
- [ ] Auditoria por cuenta consultable por rango de fechas.

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

Iniciar `in_progress` en C1 implementando endpoints, persistencia de auditoria y rollback seguro con pruebas de health-check.

## Historial de estado

- 2026-03-01: `inbox` (creacion)
- 2026-03-03: `candidate` (alcance tecnico de promotion/rollback priorizado para C0).
- 2026-03-03: `validated` (modelo de evento de auditoria y superficie API objetivo cerrados).
- 2026-03-03: `ready` (feature lista para ejecucion C1; implementacion pendiente).
