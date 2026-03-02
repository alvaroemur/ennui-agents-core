# .core-config

Configuracion externa para operar una instancia de Core.

## Archivos

- `core.json`: configuracion general de la cuenta/deploy (branding, entorno, auth del deploy).
- `*.json` (excepto `core.json`): configuraciones de subcuenta + agente.

## Convencion recomendada para subcuentas

`<subcuenta>-<agente>.json`

Ejemplo:

- `aliantza-agente-de-compras.json`

## Variables de entorno relacionadas

- `CONFIG_DIR`: base para resolver `.core-config` y `agents`.
- `CORE_CONFIG_DIR`: ruta explicita de `.core-config` (si no se define, usa `${CONFIG_DIR}/.core-config`).

## Seguridad

- Nunca subir tokens reales al repositorio.
- Usa placeholders en archivos de ejemplo y define secretos reales en despliegue (K8s Secret, variables de entorno, etc.).
- Si `auth.deployToken` esta vacio en `core.json`, la validacion de ese token queda desactivada.
