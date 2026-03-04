# Roadmap

Documento vivo para cerrar `core` como backend del sistema de gestion de agentes.

## Vision actualizada (v0.2)

### Declaracion de vision

- `core` es la unica superficie publica para operar el sistema (`core/*`).
- `switchboard` queda como modulo interno de control plane (registro + RBAC + resolucion de assignments).
- Los agentes (internos o externos) se consumen por HTTP como data plane desacoplado.
- Un hipotetico front-end consume `core/*` con JWT de usuario; las `core-keys` quedan solo para M2M.
- La operacion debe ser trazable por `runId` y gobernable por workspace/tenant.

### Principios vigentes

- API publica unificada y estable en `core/*`.
- Separacion control plane vs data plane, sin duplicar APIs publicas.
- Seguridad por defecto: authn (core-key o JWT) + authz RBAC por `allowedWorkspaces`.
- Persistencia prioritaria en DB (Neon/Postgres) con fallback controlado para continuidad.
- Cloud-ready: despliegue y pruebas internas en Docker/K8s antes de salida cloud.

### Senales de cierre de vision

- Existe un flujo productivo unico para chat en `POST /core/relay/chat`.
- Un usuario de workspace puede operar solo su scope (sin fugas cross-tenant).
- Los cambios de assignment tienen trazabilidad y rollback operativo.
- JWT para front-end esta activo sin exponer `core-key` en browser.
- Core tiene criterios minimos de salida cloud (ingress real + smoke tests + runbook).

## Evolucion del plan (v0.1 -> v0.2)

### Que ya evoluciono positivamente

| Tema | Plan original (v0.1) | Estado actual (v0.2) | Lectura |
|---|---|---|---|
| Superficie publica | "Gateway" como idea general | `core/*` canonico y operativo | Se redujo ambiguedad y se simplifico entrada |
| Rol de switchboard | Duda entre servicio/modulo | Modulo interno en `src/switchboard/` | Menos friccion operativa |
| Dominio de datos | MVP con registro simple | Esquema DB completo + fallback | Avance mayor al esperado en Fase 1 |
| Trazabilidad de ejecuciones | Objetivo futuro | Runs implementados y consultables | Base real para operacion |
| RBAC | Necesario para MVP | RBAC v2 por workspace + tests CI | Seguridad base estable |
| Legacy de rutas | Posible convivencia temporal | Retiro de legacy y contrato canonico | Menos deuda de compatibilidad |

### Donde el plan se desvio del original

- Se elimino el concepto de "producto Gateway" en el repo y se formalizo `core` como cara publica unica.
- Se acelero la consolidacion arquitectonica (contrato canonico + retiro de legacy) antes de cerrar capacidades de producto.
- Se adelanto persistencia robusta y hardening RBAC, y se pospuso producto/finops/observabilidad avanzada.

### Que se complejizo

- Cambio de lenguaje de dominio (`client/account` -> `workspace/tenant`) en docs, contratos y codigo.
- Convivencia de dos modelos de authn (core-key M2M + JWT usuario) con politicas RBAC compartidas.
- F-202603-06 exige inversion de flujo (agente devuelve "que decir", core ejecuta LLM) y nuevo contrato runtime.
- Operacion dual DB + fallback archivo agrega decisiones de consistencia y cutover.

## Gap actual para cerrar Core como backend

| Capacidad clave | Estado | Gap para cierre | Feature/artefacto |
|---|---|---|---|
| API publica unificada `core/*` | Hecho | Endurecer versionado y compatibilidad minima | `core-contract-v1.md` |
| Dominio y persistencia | Hecho (DB + fallback) | Politica explicita de uso de fallback en prod | F-202603-10 (done) |
| Authn/Authz base | Hecho C1 | Mantener rollout de claims canonicos en IdP | F-202603-08 (done) |
| BFF central de trafico LLM | Hecho C1 (con fallback legacy) | Retirar fallback runtime legacy al completar migracion | F-202603-06 (done) |
| Promotion/rollback de assignments | Hecho C1 | Definir retencion/archivado de auditoria | F-202603-05 (done) |
| Observabilidad de costo/uso | Parcial tecnico | Definir minimo operable para salida cloud | backlog `state.md` |
| Salida cloud | Parcial | Ingress real + checklist release + smoke E2E | plan activo `state.md` |

## Oportunidades de mejora para cerrar la vision

### 1) Cerrar JWT primero (impacto alto, riesgo bajo/medio)

- Definir contrato final de claims (`roles`, `allowedWorkspaces`, `defaultWorkspaceId`).
- Implementar validacion `issuer/audience/jwks` en flujo estable.
- Criterio de cierre: front-end opera `core/*` sin `core-key`.

### 2) Cerrar contrato runtime v2 para F-06 (impacto alto, riesgo medio/alto)

- Congelar payload agente->core con salida "que decir" + metadata minima.
- Mantener flag de migracion para no romper deployments actuales.
- Criterio de cierre: core centraliza llamada LLM + masking + monitoreo.

### 3) Entregar promotion/rollback con auditoria minima (impacto medio/alto, riesgo medio)

- Modelo de evento de auditoria (`from`, `to`, actor, timestamp, motivo).
- Health-check obligatorio previo a promote.
- Rollback al deployment previo con endpoint dedicado.

### 4) Definir "observabilidad minima de salida" (impacto alto, riesgo bajo)

- Panel/consulta base por run: estado, latencia, provider, tokens, costo estimado.
- SLO operativo inicial para `POST /core/relay/chat` y `GET /core/runs/:runId`.
- Alertas minimas de degradacion por deployment.

### 5) Cerrar paquete de salida cloud (impacto alto, riesgo medio)

- Host real de ingress + smoke E2E autenticado.
- Checklist de release por entorno (dev/staging/prod).
- Runbook de incidentes basico (auth, routing, degradacion LLM).

## Plan de cierre operativo (actualizado al inicio de C1)

### Fase C0 - Decisiones de arquitectura (cerrada)

Objetivo: evitar retrabajo y mover features a `ready`.

Entregables:
- Contrato JWT final (F-08) y valores de entorno cerrados.
- Contrato runtime v2 para F-06 (agente devuelve "que decir").
- Esquema de auditoria de assignments para F-05.

Resultado:
- F-08, F-06 y F-05 cerradas en `ready`.
- Gate C0 cumplido.

### Fase C1 - Cierre funcional de backend (cerrada)

Objetivo: dejar Core listo para operar como backend de gestion.

Entregables:
- JWT end-to-end en `core/*`.
- Flujo BFF central LLM habilitado (con estrategia de migracion controlada).
- Promotion/rollback con auditoria y health-check.
- Tests de regresion (RBAC + relay + assignments).

Gate de salida:
- F-08 y F-05 en `done`; F-06 en `validated` o `done` con rollout gradual.

Resultado de cierre:
- F-08 en `done` (JWT end-to-end en `core/*`, validacion JWKS y pruebas E2E JWT sin core-key).
- F-06 en `done` (runtime v2 `reply`, LLM centralizado en core relay, fallback legacy temporal).
- F-05 en `done` (promote/rollback con health-check y auditoria consultable).
- Tests de regresion C1 en verde (`switchboard:test` y `api:test`).

Plan acelerado recomendado (para acabar pronto):
- Ola 1 (dias 1-3): ejecutar F-08 end-to-end (JWT + RBAC por workspace) y cerrar pruebas de regresion auth.
- Ola 2 (dias 4-7): ejecutar F-06 con flag de migracion y validacion de contrato runtime v2.
- Ola 3 (dias 8-10): ejecutar F-05 (promote/rollback + auditoria), hardening final y smoke E2E.
- Regla operativa: no abrir alcance nuevo en C1; cualquier extra pasa al backlog C2.
- Orden confirmado de ejecucion: secuencial (`F-08` -> `F-06` -> `F-05`) para reducir riesgo de cambios simultaneos sobre el flujo de chat.

### Fase C2 - Hardening de salida cloud (activa)

Objetivo: reducir riesgo de operacion real.

Entregables:
- Ingress real + smoke tests post-deploy.
- Observabilidad minima y alertas base.
- Checklist release + runbook operativo consolidado.

Gate de salida:
- Criterios de salida cloud aprobados y trazabilidad completa por run.

## Decisiones ejecutivas cerradas (2026-03-03)

- Orden C1: ejecucion secuencial (`F-08` -> `F-06` -> `F-05`).
- Politica de fallback: permitido en dev/staging; en prod solo como degradacion de emergencia, con alerta y retorno a DB como objetivo inmediato.
- Observabilidad minima de salida (nivel B): `runId`, estado, latencia, provider, tokens y costo estimado, mas SLO inicial para `POST /core/relay/chat` y `GET /core/runs/:runId` con alertas base.
- Freeze de contrato: `core/*` v1.1 se congela al cierre de C1.
- Resultado: sin decisiones ejecutivas bloqueantes para avanzar en C2.

## Cadencia de seguimiento para cierre rapido

- Corte diario de 15 min con estado por feature (`F-08`, `F-06`, `F-05`) y bloqueos.
- Actualizar `state.md` solo cuando cambie estado o decision; evitar ruido documental.
- Registrar en `avance.md` un unico bloque diario con resultados verificables.
- Si una feature supera 2 dias sin avance real, reducir alcance o dividir entrega.

## Indicadores de cierre del roadmap

- `core/*` cubre operacion diaria sin rutas legacy.
- JWT usuario activo para front-end hipotetico y `core-key` restringida a M2M.
- Assignment promotion/rollback auditado y consultable.
- Runs trazables con `X-Run-Id` y consulta por API.
- Despliegue cloud de `core` validado con checklist y smoke E2E.
