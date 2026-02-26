/**
 * Load agent config from CONFIG_DIR/agents/{agentId}/config.json.
 * CONFIG_DIR por defecto = raíz del core (donde están agents/ y switchboard/).
 */

import { readFile, readdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = join(__dirname, "..");
const CONFIG_DIR = process.env.CONFIG_DIR || CORE_ROOT;

/**
 * @returns {Promise<string[]>} agent IDs that have config.json
 */
export async function listAgentIds() {
    const agentsDir = join(CONFIG_DIR, "agents");
    try {
        const entries = await readdir(agentsDir, { withFileTypes: true });
        const ids = [];
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            try {
                await readFile(join(agentsDir, e.name, "config.json"), "utf8");
                ids.push(e.name);
            } catch {
                // no config.json, skip
            }
        }
        return ids;
    } catch (e) {
        return [];
    }
}

/**
 * @param {string} agentId
 * @returns {Promise<object>} parsed config
 */
export async function loadAgentConfig(agentId) {
    const path = join(CONFIG_DIR, "agents", agentId, "config.json");
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
}
