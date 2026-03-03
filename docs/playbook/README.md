# Playbook del proyecto

Este playbook centraliza estado, decisiones y avance de `ennui-agents-core`.

## Estructura canonica

```txt
docs/playbook/
├── README.md
├── state.md
├── avance.md
├── architecture.md
├── roadmap.md
└── features/
    ├── README.md
    ├── _template.md
    ├── _archive.md          # Consolidado features cerradas (resumen)
    ├── archive/             # Archivos F-*.md de features done/dropped
    └── F-*.md               # Features activas (inbox, candidate, validated, ready, in_progress)
```

Los artefactos de contrato y runbook (`core-contract-v1.md`, `core-keys-rotation-runbook.md`, `bff-integration-v2.md`, `frontend-jwt-access-plan.md`) viven en **`docs/`** (raiz); el playbook los referencia.

## Reglas documentales

- `state.md` es la fuente de verdad para estado actual y plan activo.
- `avance.md` es una bitacora cronologica de trabajo ejecutado.
- Cada feature vive en `features/F-*.md` y no se duplica en otros documentos.
- Solo features en estado `ready` pueden entrar al plan activo.

## Mapa documental

| Documento | Uso |
|-----------|-----|
| `state.md` | Fuente de verdad: estado, plan activo, decisiones, backlog |
| `avance.md` | Bitacora cronologica de trabajo ejecutado |
| `architecture.md` | Arquitectura consolidada core + switchboard, RBAC |
| `docs/core-contract-v1.md` | Contrato publico API `core/*` (health, me, workspaces, tenants, agents, runs, `POST /core/relay/chat`) |
| `docs/core-keys-rotation-runbook.md` | Rotacion segura de core-keys |
| `docs/bff-integration-v2.md` | Integracion tecnica para hipotético cliente (BFF v2) |
| `docs/frontend-jwt-access-plan.md` | Plan JWT para hipotético front-end (sin core-key en browser) |
| `features/README.md` | Ledger de features, flujo de estados |
| `features/_template.md` | Plantilla para nuevas features |
| `features/_archive.md` | Consolidado de features cerradas (resumen); archivos completos en `features/archive/` |
