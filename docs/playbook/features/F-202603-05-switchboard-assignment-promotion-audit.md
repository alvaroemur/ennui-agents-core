# F-202603-05-switchboard-assignment-promotion-audit

## Meta

- Estado: `inbox`
- Owner: alvaromur
- Fecha creacion: 2026-03-01
- Ultima actualizacion: 2026-03-01

## Objetivo

Habilitar promocion y rollback de assignments por cuenta con auditoria de cambios y validaciones basicas de salud.

## Contexto

Para operar clientes en vivo, el Gateway necesita cambiar deployment activo sin perder trazabilidad ni control de riesgo.

## Definition of done

- [ ] Cada cambio de assignment guarda `from -> to`, actor y timestamp.
- [ ] Antes de promover, el deployment destino valida `GET /health`.
- [ ] Existe endpoint de rollback al deployment anterior inmediato.
- [ ] Auditoria por cuenta consultable por rango de fechas.

## Priorizacion

- Impacto: medio
- Esfuerzo: medio
- Prioridad: media

## Dependencias

- Tecnicas: persistencia robusta de dominio y RBAC.
- De negocio: politica operativa de promocion/rollback.

## Siguiente accion

Definir modelo de evento de auditoria para cambios de assignment.

## Historial de estado

- 2026-03-01: `inbox` (creacion)
