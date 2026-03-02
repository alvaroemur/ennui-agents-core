# Features Ledger

Este directorio gestiona el ciclo de maduracion de features.

## Flujo de estados

`inbox` -> `candidate` -> `validated` -> `ready` -> `in_progress` -> `done` / `dropped`

## Reglas

- Solo features en `ready` pueden pasar al plan activo de `state.md`.
- Cada feature usa un archivo propio `F-YYYYMM-NN-slug-corto.md`.
- El archivo de feature debe registrar cambios de estado y decisiones clave.
- Evitar duplicidad: detalles de feature viven en su propio archivo.

## Rubrica de madurez (4 criterios)

1. Objetivo claro.
2. Definition of done verificable.
3. Priorizacion definida.
4. Dependencias y siguiente accion identificadas.
