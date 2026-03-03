# Contract Changelog

## 2026-03-03

- Se crea `docs/_meta/contract.yaml` (version `1`) en modo bootstrap.
- Se define modelo minimalista de `docs/`:
  - sin subcarpetas nuevas fuera de `playbook/`,
  - lenguaje simple y conciso,
  - prioridad a tablas/listas/diagramas.
- Se activa frontmatter obligatorio para documentos user-friendly.
- Se fija politica de sincronizacion con `docs/playbook/` como fuente operativa.
- Se elimina requerimiento de mappings para docs fuera de `playbook` (`mappings: []` y `mapping_required: false`).
- Se corrige el modelo de fuentes de verdad:
  - `docs/` (raiz) define el estado actual implementado (as-is).
  - `docs/playbook/` mantiene el roadmap y la evolucion objetivo (to-be).
- Se actualiza `deduplication.operational_source` para reflejar `docs/*.md`.
- Se agrega `planning_source` para `docs/playbook/**/*.md`.
- Se ajusta `playbook_bridge.sync_policy` a modo dual (`docs-as-is` + `playbook-to-be`).
