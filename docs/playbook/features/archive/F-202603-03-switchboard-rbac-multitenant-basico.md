# F-202603-03-switchboard-rbac-multitenant-basico

## Meta

- Estado: `done`
- Owner: alvaromur
- Fecha creacion: 2026-03-01
- Ultima actualizacion: 2026-03-01 (cierre)

## Objetivo

Agregar autenticacion y RBAC basico en `switchboard` para separar accesos de admin tecnico, operador de cuenta y lector de cuenta.

## Contexto

El Gateway debe ser accesible por clientes y por usuarios tecnicos, con distintos niveles de manipulacion y sin cruces entre tenants.

## Definition of done

- [x] Existe matriz rol-permiso documentada por endpoint.
- [x] Middleware de authz aplica permisos para operaciones de lectura y escritura.
- [x] Requests cross-tenant no autorizados reciben `403`.
- [x] Se incluyen pruebas minimas de autorizacion positiva y negativa.
- [x] Se soporta core-key de acceso por cuenta/deploy con authn separada de authz.
- [x] Se registra seguimiento para tests automatizados de autorizacion en CI como hardening posterior al cierre.

## Priorizacion

- Impacto: alto
- Esfuerzo: alto
- Prioridad: alta

## Dependencias

- Tecnicas: modelo persistente de cuentas/usuarios.
- De negocio: definicion inicial de roles y politicas.

## Siguiente accion

Feature cerrada. Seguimiento remanente: hardening de CI (tests automatizados de autorizacion) y rotacion segura de core-keys.

## Historial de estado

- 2026-03-01: `inbox` (creacion)
- 2026-03-01: `candidate` (requiere diseno de seguridad del MVP)
- 2026-03-01: `validated` (roles y restricciones definidos)
- 2026-03-01: `ready` (alcance MVP cerrado)
- 2026-03-01: `in_progress` (RBAC por token implementado y smoke testeado)
- 2026-03-01: `in_progress` (token registry local por cuenta/deploy integrado)
- 2026-03-01: `in_progress` (RBAC v2 sin retrocompat: `accountId`/`core-key`, rechazo explicito de `clientId` legacy)
- 2026-03-01: `done` (RBAC v2 estable y consolidado en runtime/documentacion; pendientes de hardening movidos a seguimiento)
