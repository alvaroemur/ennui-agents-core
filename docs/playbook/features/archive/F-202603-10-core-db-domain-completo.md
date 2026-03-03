# F-202603-10-core-db-domain-completo

## Meta

- Estado: `done`
- Owner: alvaromur
- Fecha creacion: 2026-03-02
- Ultima actualizacion: 2026-03-02

## Objetivo

Completar el modelo de dominio en base de datos para incluir Cuentas (Workspaces), Usuarios, Roles (Memberships), Tenants, Agentes, Deployments, Asignaciones y Runs, eliminando dependencias de archivos JSON en favor de Neon/Postgres y guardando configuraciones de agentes como JSONB.

## Contexto

El sistema evolucionó a tener la superficie pública en `core`. El modelo real de dominio necesita soportar usuarios (vía OAuth de Google) que pertenecen a múltiples workspaces. Los workspaces tienen tenants, y los tenants tienen agentes asignados con sus configuraciones. Se requiere que todo esto esté formalizado en una base de datos relacional para abandonar el fallback de JSON en la operación productiva.

## Definition of done

- [x] Esquema DB actualizado en `switchboard/src/registry.js` (tablas `switchboard_workspaces`, `switchboard_users`, `switchboard_workspace_memberships`, `switchboard_tenants`, etc.).
- [x] Renombre de `accounts` a `workspaces` en el esquema de base de datos y métodos de acceso del registro.
- [x] Datos semilla actualizados (Workspace "Inspiro Agents", Tenants "Aliantza" y "Inspiro Agents Web", y sus agentes).
- [x] Entidades `users` y `workspace_memberships` soportadas en operaciones CRUD del registro.
- [x] Endpoints de `core` adaptados para utilizar la nomenclatura de `workspaces` en todo el stack.

## Priorizacion

- Impacto: Alto
- Esfuerzo: Alto
- Prioridad: Alta

## Dependencias

- Tecnicas: Acceso a Neon para validación.
- De negocio: Definición de login por OAuth confirmada.

## Siguiente accion

Actualizar el esquema de la base de datos en `switchboard/src/registry.js` y el modelo en memoria.

## Historial de estado

- 2026-03-02: `inbox` (creacion)
- 2026-03-02: `candidate` (alineado con la necesidad de autenticación OAuth)
- 2026-03-02: `validated`
- 2026-03-02: `ready`
- 2026-03-02: `done` (esquema DB completo y endpoints actualizados a workspaces)
