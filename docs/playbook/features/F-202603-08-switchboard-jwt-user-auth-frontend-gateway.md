# F-202603-08-switchboard-jwt-user-auth-frontend-gateway

## Meta

- Estado: `in_progress`
- Owner: alvaromur
- Fecha creacion: 2026-03-01
- Ultima actualizacion: 2026-03-03

## Objetivo

Habilitar autenticacion de usuarios (JWT) para que un **hipotético front-end** pueda consumir la API **core** (`core/*`) sin exponer `core-keys` en el cliente. La validación JWT se integra en core (que usa el módulo switchboard/rbac internamente para authz).

## Contexto

- No existe producto «gateway» en el repo; las referencias son a un hipotético front-end (p. ej. SPA) que consumiria core.
- La API publica es **core** (`GET /core/me`, `POST /core/relay/chat`, etc.); core ya soporta core-key para M2M.
- En un front-end no debe usarse `core-key`; se necesita JWT de usuario con claims (roles, allowedWorkspaces).

## Definition of done

- [ ] Existe contrato de claims JWT (roles, allowedWorkspaces, defaultWorkspaceId).
- [ ] Core (con lógica de auth en switchboard/rbac) valida JWT por issuer/audience/JWKS.
- [ ] Endpoints `core/*` protegidos aplican RBAC por usuario y `allowedWorkspaces` (claims JWT).
- [ ] Frontend funciona sin `CORE_BFF_API_KEY`.
- [ ] Core-keys quedan restringidas a uso M2M.

## Contrato C0 cerrado (listo para implementacion)

### Claims JWT acordados

```json
{
  "sub": "user-123",
  "iss": "https://auth.example.com",
  "aud": "core-switchboard",
  "exp": 1760000000,
  "roles": ["operador-cuenta"],
  "allowedWorkspaces": ["inspiro-agents"],
  "defaultWorkspaceId": "inspiro-agents"
}
```

### Reglas de compatibilidad de claims (transicion)

- Canonico: `allowedWorkspaces` y `defaultWorkspaceId`.
- Compatibilidad temporal permitida en C1: aceptar `allowedAccounts` y `defaultAccountId` si llegan desde IdP legacy.
- Criterio de cierre C1: mantener solo claims canonicos en emisores activos.

### Parametros de validacion acordados

- `issuer`: obligatorio (valor definido por entorno de despliegue).
- `audience`: obligatorio (`core-switchboard` por defecto, configurable por entorno).
- `jwks`: obligatorio para modo productivo de JWT de usuario.
- Nota de implementacion: el runtime actual soporta validacion JWT HS256 por `secret` + `issuer/audience`; la validacion por JWKS se implementa en ejecucion C1 sin cambiar el contrato de claims.

### Criterios de aceptacion para iniciar C1

- Contrato de claims y parametros de validacion congelado (este documento + `docs/frontend-jwt-access-plan.md`).
- Regla de seguridad congelada: `core-key` solo M2M; frontend usa JWT.
- Alcance de implementacion definido: authn en core/switchboard, authz por `allowedWorkspaces` en `core/*`.

## Priorizacion

- Impacto: alto
- Esfuerzo: alto
- Prioridad: alta

## Dependencias

- Tecnicas: F-202603-03 (RBAC base, done), API publica core/* ya existe (F-202603-09); proveedor IdP/JWKS para emisión de JWT.
- De negocio: definicion de login y modelo de roles por workspace.

## Siguiente accion

Ejecutar en C1 la implementacion JWT end-to-end en `core/*` (issuer/audience/jwks), con compatibilidad temporal de claims legacy y pruebas de regresion RBAC como primer bloque de cierre para habilitar front-end.

## Artefactos tecnicos

- `docs/frontend-jwt-access-plan.md`
- `docs/core-contract-v1.md`

## Historial de estado

- 2026-03-01: `inbox` (idea inicial: hipotético front-end sin exponer secrets).
- 2026-03-01: `candidate` (plan tecnico de migracion JWT por fases documentado).
- 2026-03-03: `validated` (contrato C0 de claims + parametros issuer/audience/jwks acordado).
- 2026-03-03: `ready` (feature preparada para ejecucion C1; implementacion pendiente).
- 2026-03-03: `in_progress` (prioridad C1 confirmada; ejecucion secuencial iniciada antes de F-06/F-05).
