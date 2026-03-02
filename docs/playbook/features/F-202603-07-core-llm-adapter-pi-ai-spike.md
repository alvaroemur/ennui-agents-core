# F-202603-07-core-llm-adapter-pi-ai-spike

## Meta

- Estado: `inbox`
- Owner: alvaromur
- Fecha creacion: 2026-03-01
- Ultima actualizacion: 2026-03-01

## Objetivo

Validar tecnicamente el uso de `@mariozechner/pi-ai` como adaptador LLM unificado en Core para reducir complejidad de providers y preparar la implementacion de `F-202603-06`.

## Contexto

- Core hoy usa `src/llm.js` con integracion propia para OpenAI, Gemini y OpenRouter, mas monitoreo/masking en `src/llm-proxy/`.
- La feature `F-202603-06` requiere una capa BFF de trafico LLM mas robusta, extensible y desacoplada.
- `pi-mono` aporta una libreria multi-provider madura (`pi-ai`) que puede reutilizarse sin mover la logica de cuenta/RBAC/routing de `switchboard`.

## Definition of done

- [ ] Existe PoC que reemplaza o envuelve `src/llm.js` usando `pi-ai` sin romper el contrato actual (`text`, `provider`, `usage`).
- [ ] Se valida que `llm-proxy` mantiene monitoreo y masking con la integracion propuesta.
- [ ] Se documenta comparativa tecnica entre implementacion actual y `pi-ai` (capabilities, riesgos, costo de migracion).
- [ ] Se registra decision go/no-go y plan de integracion con `F-202603-06`.

## Priorizacion

- Impacto: alto
- Esfuerzo: medio
- Prioridad: media

## Dependencias

- Tecnicas: `F-202603-06`, `F-202603-01`, `F-202603-04`.
- De negocio: alineacion de estrategia BFF Core-Switchboard.

## Siguiente accion

Definir alcance minimo de PoC (ruta de entrada, modelo inicial y criterios de comparacion) para mover esta feature a `candidate`.

## Historial de estado

- 2026-03-01: `inbox` (creacion)
