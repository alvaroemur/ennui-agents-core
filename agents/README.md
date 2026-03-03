# agents/

Carpeta de **lógica de runtimes** (sin `config.json` en repo).

- `consultor/runtime.js` — runtime del consultor (chat general).
- `collector/runtime.js` — runtime unificado para readiness + ROI.

La configuración de agentes se carga desde DB (tabla `switchboard_agents`) por tenant
`inspiro-agents-web` en `tenantConfigs.<tenantId>`.
Cada config debe declarar `runtimeId` para resolver su runtime (ej. `consultor` o `collector`).
