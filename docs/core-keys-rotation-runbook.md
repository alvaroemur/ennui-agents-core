# Core-Keys Rotation Runbook

## Estado del documento

- Estado: `operativo`
- Version: `v0.1`
- Fecha: `2026-03-01`
- Scope: rotacion segura de `core-keys` para `switchboard` sin downtime.

## Objetivo

Rotar credenciales (`core-keys`) de cuentas y plataforma minimizando riesgo operativo, manteniendo disponibilidad de `POST /core/relay/chat` y trazabilidad de incidencias.

## Supuestos y precondiciones

- RBAC habilitado: `SWITCHBOARD_RBAC_ENABLED=true`.
- Fuente de keys activa:
  - `SWITCHBOARD_CORE_KEYS` (env JSON), o
  - `SWITCHBOARD_KEYS_PATH` (archivo JSON).
- Existe al menos una key de respaldo para `admin-tecnico`.
- Los consumidores (p. ej. un hipotético front-end o integraciones M2M) pueden cambiar key por variable de entorno sin redeploy de código.

## Estrategia recomendada

Usar rotacion por superposicion (overlap):

1. Alta de key nueva (sin retirar key vieja).
2. Cambio de consumidores (cliente que use la key) a key nueva.
3. Verificacion operativa.
4. Retiro de key vieja.

Nunca hacer reemplazo destructivo en un solo paso.

## Proceso operativo (paso a paso)

### 1) Preparacion

1. Identificar keys a rotar:
   - `id`, `accountId`, consumidor, entorno (dev/staging/prod).
2. Crear nueva key robusta y registrar metadata:
   - `id` nuevo,
   - `status: active`,
   - `createdAt` ISO.
3. Actualizar fuente de keys con **ambas** keys activas (vieja + nueva).
4. Aplicar cambio en entorno objetivo.

Checklist:

- [ ] La nueva key autentica `accountId` correcto.
- [ ] No se modifico rol en `registry.accounts`.
- [ ] Existe plan de rollback para volver temporalmente a key vieja.

### 2) Validacion de autenticacion/autorizacion

Ejecutar pruebas con key nueva:

1. `GET /core/runs` con key nueva:
   - esperado `200` para su scope (workspace).
2. `POST /core/relay/chat` con body valido (workspaceId, tenantId, agentId, messages) en scope de la key:
   - esperado `200` o error funcional downstream, pero no `401/403`.
   - esperado header `X-Run-Id`.
3. Prueba negativa:
   - request fuera de scope -> `403`.

Si falla autenticacion (`401`) o scope (`403` inesperado), no retirar key vieja.

### 3) Cutover de consumidores

1. Cambiar secreto en el consumidor (p. ej. front-end o servicio M2M) para usar key nueva.
2. Reiniciar/recargar despliegue consumidor.
3. Monitorear durante ventana acordada:
   - tasa de `401`,
   - tasa de `403` inesperados,
   - disponibilidad de chat,
   - correlacion por `X-Run-Id`.

### 4) Retiro de key vieja

1. Confirmar trafico estable con key nueva.
2. Marcar key vieja como inactiva o eliminarla de la fuente de keys.
3. Aplicar cambio y verificar que no hay regresion.
4. Registrar evento en bitacora (`avance.md`/ops log).

## Rollback

Si hay regresion tras cutover:

1. Rehabilitar key vieja (o reinsertarla) en fuente de keys.
2. Revertir secreto de consumidor a key previa.
3. Verificar `GET /core/runs` y `POST /core/relay/chat`.
4. Abrir incidente con:
   - ventana temporal,
   - errores observados (`401/403/5xx`),
   - `runId` de ejemplos.

## Formato recomendado de key

```json
{
  "id": "key-inspiro-gateway-02",
  "label": "Cliente M2M / rotación 2026-03",
  "key": "base64-or-random-secret",
  "accountId": "inspiro-comercial",
  "status": "active",
  "createdAt": "2026-03-01T12:00:00Z"
}
```

## Smoke test minimo de rotacion

1. Cargar key nueva en `switchboard` manteniendo key vieja.
2. `GET /core/runs` con key nueva -> `200`.
3. `POST /core/relay/chat` con key nueva y body en scope -> response con `X-Run-Id`.
4. Cambiar consumidor a key nueva.
5. Retirar key vieja y repetir pasos 2-3.

## Criterios de salida

- Cero errores `401` por credencial invalida tras ventana de estabilizacion.
- Sin incremento anomalo de `403` por scope.
- Trazabilidad disponible (`X-Run-Id` presente en respuestas).
- Key vieja retirada o inactiva de forma auditable.

## Referencias

- `docs/playbook/architecture.md`
- `docs/playbook/state.md`
- `src/switchboard/data/core-keys.json`
