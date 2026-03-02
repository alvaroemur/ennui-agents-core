# Playbook del proyecto

Este playbook centraliza estado, decisiones y avance de `ennui-agents-core`.

## Estructura canonica

```txt
docs/playbook/
├── README.md
├── state.md
├── avance.md
└── features/
    ├── README.md
    ├── _template.md
    └── F-*.md
```

## Reglas documentales

- `state.md` es la fuente de verdad para estado actual y plan activo.
- `avance.md` es una bitacora cronologica de trabajo ejecutado.
- Cada feature vive en `features/F-*.md` y no se duplica en otros documentos.
- Solo features en estado `ready` pueden entrar al plan activo.

## Mapa documental

- Estado global y decisiones: `docs/playbook/state.md`
- Avance historico: `docs/playbook/avance.md`
- Arquitectura consolidada (`core + switchboard`): `docs/playbook/architecture.md`
- Integracion tecnica para cambios en `gateway` (BFF v2): `docs/playbook/gateway-bff-integration-v2.md`
- Plan de acceso JWT para `gateway` frontend-only: `docs/playbook/frontend-gateway-jwt-access-plan.md`
- Runbook de rotacion segura de `core-keys`: `docs/playbook/core-keys-rotation-runbook.md`
- Ledger de features y flujo: `docs/playbook/features/README.md`
- Plantilla para nuevas features: `docs/playbook/features/_template.md`
