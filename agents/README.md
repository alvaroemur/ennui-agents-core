# agents/

Cada subcarpeta es una **unidad de agente** con su propio código, skills y definiciones.

- **{agent-id}/config.json** — obligatorio: configuración del agente (agentType, prompts, schema, etc.).
- **{agent-id}/README.md** — descripción del agente.
- **{agent-id}/skills/** — (opcional) habilidades o fragmentos reutilizables.

El ID del agente para la API es el nombre de la carpeta (ej. `consultor`, `roi-calculator`, `readiness-evaluator`).
