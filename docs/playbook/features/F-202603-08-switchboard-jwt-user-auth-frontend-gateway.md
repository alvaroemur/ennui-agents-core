# F-202603-08-switchboard-jwt-user-auth-frontend-gateway

## Meta

- Estado: `candidate`
- Owner: alvaromur
- Fecha creacion: 2026-03-01
- Ultima actualizacion: 2026-03-01

## Objetivo

Habilitar autenticacion de usuarios (JWT) en `switchboard` para que `gateway` frontend-only administre cuentas/tenants/agentes sin exponer `core-keys` en cliente.

## Contexto

- El `gateway` sera frontend puro, sin backend intermedio.
- El modelo actual con `core-key` en browser no es seguro para credenciales de servicio.
- Se necesita authn/authz orientada a usuario y scope de cuentas.

## Definition of done

- [ ] Existe contrato de claims JWT (roles, allowedAccounts, defaultAccountId).
- [ ] `switchboard` valida JWT por issuer/audience/JWKS.
- [ ] Endpoints protegidos aplican RBAC por usuario y `allowedAccounts`.
- [ ] Frontend funciona sin `CORE_BFF_API_KEY`.
- [ ] Core-keys quedan restringidas a uso M2M.

## Priorizacion

- Impacto: alto
- Esfuerzo: alto
- Prioridad: alta

## Dependencias

- Tecnicas: `F-202603-03` (RBAC base), `F-202603-06` (BFF endpoint), proveedor IdP/JWKS.
- De negocio: definicion de login y modelo de roles por cuenta.

## Siguiente accion

Cerrar contrato de claims JWT con el equipo de `gateway` y fijar valores de `issuer/audience/jwks` para mover la feature a `validated`.

## Artefactos tecnicos

- `docs/playbook/frontend-gateway-jwt-access-plan.md`

## Historial de estado

- 2026-03-01: `inbox` (idea inicial: gateway frontend-only sin exponer secrets).
- 2026-03-01: `candidate` (plan tecnico de migracion JWT por fases documentado).
