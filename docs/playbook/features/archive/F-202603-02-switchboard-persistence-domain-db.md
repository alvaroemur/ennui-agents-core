# F-202603-02-switchboard-persistence-domain-db

## Meta

- Estado: `dropped` (postergada)
- Owner: alvaromur
- Fecha creacion: 2026-03-01
- Ultima actualizacion: 2026-03-01

## Objetivo

Reemplazar la persistencia principal de `switchboard` basada en JSON por una base de datos para `clients`, `agents`, `deployments` y `assignments`.

## Contexto

`registry.json` sirve para desarrollo rapido pero no cubre concurrencia, auditoria, consistencia ni operacion robusta de un Gateway multi-tenant.

## Definition of done

- [x] Se define esquema inicial con llaves y constraints para dominio base.
- [x] Existe estrategia de migracion desde `switchboard/data/registry.json`.
- [x] CRUD `/api/registry/*` funciona con DB sin romper contrato HTTP actual.
- [x] Reinicios de servicio conservan informacion de dominio.
- [ ] Validar en entorno Neon real con datos de staging y concurrencia basica.

## Priorizacion

- Impacto: alto
- Esfuerzo: alto
- Prioridad: alta

## Dependencias

- Tecnicas: contrato v1 `switchboard` <-> `core`.
- De negocio: decision de motor de DB para MVP.

## Siguiente accion

Mantener fallback local por archivos y reactivar esta feature cuando se requiera persistencia productiva en DB.

## Historial de estado

- 2026-03-01: `inbox` (creacion)
- 2026-03-01: `candidate` (pendiente de decisiones criticas de DB)
- 2026-03-01: `validated` (Neon/Postgres aprobado para MVP)
- 2026-03-01: `ready` (alcance y DoD cerrados)
- 2026-03-01: `in_progress` (implementacion DB opcional + fallback + seed)
- 2026-03-01: `dropped` (postergada por decision de operar local por archivos)
