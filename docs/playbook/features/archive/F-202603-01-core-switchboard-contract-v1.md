# F-202603-01-core-switchboard-contract-v1

## Meta

- Estado: `done`
- Owner: alvaromur
- Fecha creacion: 2026-03-01
- Ultima actualizacion: 2026-03-01

## Objetivo

Definir y publicar un contrato v1 claro entre `switchboard` (control plane) y `core` (data plane) para endpoints y trazabilidad minima.

## Contexto

El roadmap requiere separar responsabilidades: Gateway administra cuentas y enrutamiento, mientras los agentes siguen operando como servicios independientes. Sin contrato estable, cada mejora de `switchboard` puede romper integraciones.

## Definition of done

- [x] Existe documento de contrato v1 para `/health`, `/api/chat` y `/api/config`.
- [x] Se define versionado del contrato y politica de compatibilidad hacia atras.
- [x] Se documentan errores estandar y headers de correlacion (`runId`/trace).
- [x] Hay smoke test local `switchboard -> core` para flujo happy path.

## Priorizacion

- Impacto: alto
- Esfuerzo: medio
- Prioridad: alta

## Dependencias

- Tecnicas: ninguna bloqueante.
- De negocio: alineacion de alcance del MVP Gateway.

## Siguiente accion

Mantener versionado de contrato y actualizarlo en cada cambio breaking de API.

## Historial de estado

- 2026-03-01: `inbox` (creacion)
- 2026-03-01: `candidate` (alineado con roadmap Fase 1)
- 2026-03-01: `validated` (alcance definido)
- 2026-03-01: `ready` (lista para ejecucion)
- 2026-03-01: `in_progress` (documento v1 publicado, pendiente smoke test happy path)
- 2026-03-01: `done` (E2E local `switchboard -> core` validado)
- Nota: validacion hecha con credencial OpenAI dummy; se confirma contrato/transporte, no calidad de respuesta del modelo.
