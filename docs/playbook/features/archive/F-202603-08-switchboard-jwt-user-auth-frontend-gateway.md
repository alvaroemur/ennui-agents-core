# F-202603-08-switchboard-jwt-user-auth-frontend-gateway

## Meta

- Estado: `done`
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

- [x] Existe contrato de claims JWT (roles, allowedWorkspaces, defaultWorkspaceId).
- [x] Core (con lógica de auth en switchboard/rbac) valida JWT por issuer/audience/JWKS.
- [x] Endpoints `core/*` protegidos aplican RBAC por usuario y `allowedWorkspaces` (claims JWT).
- [x] Frontend funciona sin `CORE_BFF_API_KEY`.
- [x] Core-keys quedan restringidas a uso M2M.

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

Mantener compatibilidad temporal de claims legacy solo durante migracion de emisores; retirar fallback cuando todos los IdP emitan claims canonicos.

## Avance de implementacion C1 (2026-03-03)

- `src/switchboard/rbac.js` ahora valida JWT con `issuer` + `audience` obligatorios y firma via JWKS (`SWITCHBOARD_AUTH_JWT_JWKS_URL`/`SWITCHBOARD_AUTH_JWT_JWKS`), manteniendo compatibilidad HS256 (`SWITCHBOARD_AUTH_JWT_SECRET`) para transicion.
- Se mantiene compatibilidad temporal de claims legacy (`allowedAccounts`, `defaultAccountId`) mapeando a naming canonico (`allowedWorkspaces`, `defaultWorkspaceId`).
- Se endurece scope en `core/*`: `POST /core/runtime/chat` requiere principal autenticado y valida permiso de chat por workspace del tenant.
- Ajuste de consistencia de workspace en rutas core: lectura de tenant por `workspaceId` (con fallback legacy) y correccion del filtro en `GET /core/runs` para respetar `allowedWorkspaces`.
- Pruebas de regresion RBAC/JWT en verde (`npm run switchboard:test`, 15/15), incluyendo caso RS256 con JWKS.
- Validacion E2E en `src/api/test/core-c1.test.js`:
  - acceso a `core/*` con JWT de usuario sin `CORE_BFF_API_KEY`,
  - mantenimiento de operacion M2M via `core-key`.

## Ampliacion C2 (2026-03-04): allowlist por email + RBAC por usuario

- Se incorpora `auth_users` en registry (file/Neon) para definir acceso por email con perfil RBAC:
  - `email`, `status`, `role`, `allowedAccounts`, `defaultAccountId`, `providers.google.sub`.
- El login Google (`/api/auth/google/login`) resuelve el perfil por email desde `auth_users` y emite JWT con claims de rol/scope por usuario.
- Se agregan endpoints de administracion:
  - `GET /core/auth/users`
  - `POST /core/auth/users`
  - `PATCH /core/auth/users/:email`
- Solo las cuentas maestras (`CORE_AUTH_MASTER_EMAILS`) pueden gestionar la allowlist/perfiles.
- El fallback legacy por `CORE_AUTH_GOOGLE_ADMIN_EMAILS` queda opcional mediante `CORE_AUTH_LEGACY_EMAIL_ALLOWLIST_FALLBACK=true`.
- `core/me` ahora incluye `email` del principal JWT para trazabilidad operativa.

## Artefactos tecnicos

- `docs/frontend-jwt-access-plan.md`
- `docs/core-contract-v1.md`

## Historial de estado

- 2026-03-01: `inbox` (idea inicial: hipotético front-end sin exponer secrets).
- 2026-03-01: `candidate` (plan tecnico de migracion JWT por fases documentado).
- 2026-03-03: `validated` (contrato C0 de claims + parametros issuer/audience/jwks acordado).
- 2026-03-03: `ready` (feature preparada para ejecucion C1; implementacion pendiente).
- 2026-03-03: `in_progress` (prioridad C1 confirmada; ejecucion secuencial iniciada antes de F-06/F-05).
- 2026-03-03: implementacion parcial C1 completada (JWT con JWKS + hardening RBAC en endpoints `core/*` + regresion automatizada en verde).
- 2026-03-03: `done` (JWT end-to-end en `core/*`, validacion JWKS y cobertura E2E JWT + M2M).
