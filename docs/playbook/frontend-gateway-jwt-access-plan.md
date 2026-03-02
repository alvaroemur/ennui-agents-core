# Frontend Gateway JWT Access Plan

## Estado del documento

- Estado: `draft`
- Version: `v0.1`
- Fecha: `2026-03-01`
- Scope: acceso de usuarios desde `gateway` (frontend-only) a `switchboard/core` sin exponer secretos.

## Objetivo

Permitir que `gateway` (solo frontend) sea la interfaz de administracion de cuenta/tenants/agentes usando identidad de usuario (JWT), evitando uso de `core-key` en cliente web.

## Diagnostico actual

- El modelo vigente de `switchboard` usa `core-key` en `Authorization` para autenticar cuenta.
- En un frontend puro, cualquier key incluida en config/bundle queda expuesta.
- Esto permite impersonacion de cuenta si una key se filtra.

## Principios de diseño

1. Credenciales de usuario en browser (OIDC/OAuth2 PKCE), no secretos de plataforma.
2. `switchboard` valida JWT de usuario y aplica RBAC por scope de cuentas/tenants.
3. `core-key` queda para integraciones maquina-a-maquina (M2M), no para UI.
4. Migracion incremental sin cortar operacion actual.

## Modelo objetivo

### Entrada desde frontend

- `Authorization: Bearer <user-jwt>`
- `X-Account-Id: <accountId>` (opcional si viene en claim default)

### Claims minimos requeridos (propuesta)

```json
{
  "sub": "user-123",
  "iss": "https://auth.example.com",
  "aud": "core-switchboard",
  "exp": 1760000000,
  "roles": ["operador-cuenta"],
  "allowedAccounts": ["inspiro-comercial"],
  "defaultAccountId": "inspiro-comercial"
}
```

### Reglas de autorizacion

- `admin-tecnico`: puede operar todas las cuentas.
- `operador-cuenta`: lectura/escritura/chat solo en `allowedAccounts`.
- `lector-cuenta`: solo lectura en `allowedAccounts`.

Si el request trae `X-Account-Id` fuera de scope -> `403`.

## Estrategia de migracion por fases

### Fase 0: Preparacion

- Documentar contrato de claims y proveedor de identidad (issuer, audience, JWKS URL).
- Agregar configuracion JWT en `switchboard`:
  - `SWITCHBOARD_AUTH_JWT_ENABLED`
  - `SWITCHBOARD_AUTH_JWT_ISSUER`
  - `SWITCHBOARD_AUTH_JWT_AUDIENCE`
  - `SWITCHBOARD_AUTH_JWT_JWKS_URL`

### Fase 1: Authn dual (sin breaking)

- `switchboard` acepta:
  - JWT usuario (nuevo),
  - core-key (legacy y M2M).
- Resolver principal unificado:
  - tipo `user` desde JWT,
  - tipo `service` desde core-key.

### Fase 2: RBAC por usuario

- Extender authz para usar `allowedAccounts`/roles de JWT.
- Mantener matriz RBAC vigente en endpoints `runs`, `chat`, `registry`.

### Fase 3: Migracion de frontend

- `gateway` deja de enviar core-key.
- `gateway` envia solo JWT del usuario logueado.
- Variables frontend permitidas:
  - `CORE_BFF_BASE_URL`
  - `CORE_BFF_CHAT_PATH`
  - `CORE_BFF_TIMEOUT_MS`
- Variables prohibidas en frontend:
  - `CORE_BFF_API_KEY`
  - credenciales de servicio.

### Fase 4: Cierre

- Deshabilitar uso de core-key para flujos de UI.
- Mantener core-key solo en canales M2M controlados.
- Actualizar docs y smoke tests finales.

## Cambios tecnicos por modulo

1. `switchboard/src/rbac.js`
   - validar JWT y mapear claims -> principal.
   - mantener soporte core-key para `principal.type=service`.
2. `switchboard/src/index.js`
   - priorizar auth JWT para requests browser.
   - conservar errores consistentes (`401`, `403`, `400 legacy`).
3. `switchboard/test/*`
   - tests de JWT valido/expirado/issuer invalido/audience invalido.
   - tests de scope `allowedAccounts`.

## Matriz de riesgos

- Riesgo: divergencia entre claims reales del IdP y modelo esperado.
  - Mitigacion: contrato de claims validado antes de implementar.
- Riesgo: convivir JWT + core-key aumenta complejidad temporal.
  - Mitigacion: fases con fecha de retiro y telemetria por tipo de auth.
- Riesgo: CORS o expiracion de token rompe UX.
  - Mitigacion: smoke tests end-to-end y manejo de refresh token en frontend.

## Definition of done (plan)

- Contrato de claims versionado y aceptado.
- `switchboard` valida JWT con JWKS.
- RBAC por usuario aplicado a cuentas permitidas.
- Frontend funcional sin core-key en cliente.
- Core-key restringida a uso M2M.

## Referencias

- `docs/playbook/architecture.md`
- `docs/playbook/gateway-bff-integration-v2.md`
- `docs/playbook/state.md`
