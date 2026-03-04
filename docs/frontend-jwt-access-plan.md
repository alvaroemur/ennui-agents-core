# Frontend JWT Access Plan (hipotético front-end)

## Estado del documento

- Estado: `draft`
- Version: `v0.1`
- Fecha: `2026-03-01`
- Scope: acceso de usuarios desde un **hipotético front-end** a `core` sin exponer secretos. No existe producto «gateway» en el repo; este plan describe el diseño para cualquier cliente web que consuma la API core.

## Objetivo

Permitir que un hipotético front-end (p. ej. SPA) sea la interfaz de administracion de cuenta/tenants/agentes usando identidad de usuario (JWT), evitando uso de `core-key` en el cliente web.

## Diagnostico actual

- El modelo vigente de `switchboard` usa `core-key` en `Authorization` para autenticar cuenta.
- En un frontend puro, cualquier key incluida en config/bundle queda expuesta.
- Esto permite impersonacion de cuenta si una key se filtra.

## Principios de diseño

1. Credenciales de usuario en browser (OIDC/OAuth2 PKCE), no secretos de plataforma.
2. `switchboard` valida JWT de usuario y aplica RBAC por scope de workspaces/tenants.
3. `core-key` queda para integraciones maquina-a-maquina (M2M), no para UI.
4. Migracion incremental sin cortar operacion actual.

## Modelo objetivo

### Entrada desde frontend

- `Authorization: Bearer <user-jwt>`
- `X-Workspace-Id: <workspaceId>` (opcional si viene en claim default)

### Claims minimos requeridos (propuesta)

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

### Reglas de autorizacion

- `admin-tecnico`: puede operar todos los workspaces.
- `operador-cuenta`: lectura/escritura/chat solo en `allowedWorkspaces`.
- `lector-cuenta`: solo lectura en `allowedWorkspaces`.

Si el request trae `X-Workspace-Id` fuera de scope -> `403`.

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

- Extender authz para usar `allowedWorkspaces`/roles de JWT.
- Mantener matriz RBAC vigente en endpoints `runs`, `chat`, `registry`.

### Fase 3: Migracion de front-end

- El hipotético front-end deja de enviar core-key.
- El front-end envia solo JWT del usuario logueado.
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
  - tests de scope `allowedWorkspaces`.

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
- RBAC por usuario aplicado a workspaces permitidos.
- Frontend funcional sin core-key en cliente.
- Core-key restringida a uso M2M.

## Referencias

- `docs/playbook/architecture.md`
- `docs/bff-integration-v2.md`
- `docs/playbook/state.md`
