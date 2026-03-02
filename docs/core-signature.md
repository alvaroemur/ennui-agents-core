# Firma por defecto de Core

Esta es la adaptacion de la firma ASCII para `core` (backend del gateway).

## Objetivo

- `core` inserta esta firma cuando el cliente no define una propia.
- Sirve como boilerplate para firmas de front-ends.
- Siempre agrega metadata con `fingerprint` para trazabilidad por ejecucion.

## Template que inyecta Core

```
           ▗             
▞▀▖▛▀▖▛▀▖▌ ▌▄  ▞▀▘▞▀▖▙▀▖▞▀▖
▛▀ ▌ ▌▌ ▌▌ ▌▐  ▌  ▌ ▌▌  ▛▀ 
▝▀▘▘ ▘▘ ▘▝▀▘▀▘ ▝▀▘▝▀ ▘  ▝▀▘

🎛️ ennui core · github.com/alvaroemur
NOMBRE DEL AGENTE v0.0 · BREVE DESCRIPCIÓN DE SUS CAPACIDADES
  ↳ RUNTIME v0.0
  → ennui-core v0.1
  → LLM_PROVIDER/MODELO
  ▪ env:ENV · run:RUN_ID · fingerprint:<fingerprint>
```

Notas:

- Contraste inverso: `ENNUI` con bloque alto, `core` con bloque bajo.
- `fingerprint` es obligatorio en metadata.
- `fingerprint` puede llevar prefijo configurable por deploy (ej. `ia-gateway-6f9e2b10c3ab4d11`).
- `run` se deriva del fingerprint cuando no se recibe uno externo.

## Prefijo de fingerprint por deploy

Para marcar de que deploy viene cada ejecucion, Core permite configurar un prefijo:

- Variable de entorno: `CORE_FINGERPRINT_PREFIX`
- O en `.core-config/core.json`: `tracing.fingerprintPrefix`

Prioridad: env var > `core.json`.

Ejemplo:

```json
{
  "tracing": {
    "fingerprintPrefix": "ia-gateway-"
  }
}
```

Con esa config, el metadata queda asi:

```text
  ▪ env:prod · run:core-3ab4d11f · fingerprint:ia-gateway-6f9e2b10c3ab4d11
```

## Reglas de aplicacion

1. Si request trae `signature`, se usa esa firma.
2. Si el `systemPrompt` ya inicia con firma, se respeta.
3. Si no hay firma, `core` inyecta la firma por defecto.
4. En todos los casos se fuerza `fingerprint` en la linea `▪`.
