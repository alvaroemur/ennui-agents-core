# Documentacion de `ennui-agents-core`

## Regla principal

- `docs/` (raiz): describe el sistema **actual** (as-is).
- `docs/playbook/`: describe el sistema **objetivo** (to-be), roadmap y fases de evolucion.
- `docs/_meta/`: contrato documental y su historial de cambios.

## Como decidir donde escribir

1. Si el contenido ya esta implementado y operativo, documentalo en `docs/`.
2. Si el contenido es una propuesta, plan o migracion futura, documentalo en `docs/playbook/`.
3. Cuando un plan se implemente, actualiza `docs/` y deja en `playbook/` referencia de cierre.

## Indice rapido (estado actual)

- `core-contract-v1.md`: contrato HTTP publico canonico de core.
- `core-keys-rotation-runbook.md`: runbook operativo de rotacion de credenciales.
- `bff-integration-v2.md`: contrato de integracion de cliente/BFF.
- `frontend-jwt-access-plan.md`: plan de acceso JWT para cliente web.
- `core-signature.md`: firma por defecto y reglas de fingerprint.
- `src-reorganization-eval.md`: evaluacion de reorganizacion tecnica de `src/`.
- `core-gateway-arquitectura.md`: reservado para arquitectura vigente (actualmente pendiente de contenido).

## Gobierno documental

- Contrato activo: `docs/_meta/contract.yaml`.
- Historial de cambios del contrato: `docs/_meta/contract-changelog.md`.
