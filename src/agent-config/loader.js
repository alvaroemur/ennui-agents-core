/**
 * Agent config loader from switchboard registry (DB/file-backed).
 * Configs are resolved per tenant (default: inspiro-agents-web).
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as reg from "../switchboard/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = join(__dirname, "..", "..");
const DEFAULT_REGISTRY_PATH =
    process.env.REGISTRY_PATH || join(CORE_ROOT, "src", "switchboard", "data", "registry.json");
const DEFAULT_CONFIG_TENANT_ID = "inspiro-agents-web";
const AGENT_ID_ALIASES = {
    consultor: "consultor-ia",
};

let registryLoadPromise = null;

function resolveTenantId(options) {
    const candidate =
        typeof options?.tenantId === "string" && options.tenantId.trim()
            ? options.tenantId.trim()
            : DEFAULT_CONFIG_TENANT_ID;
    return candidate || "inspiro-agents-web";
}

function resolveLookupAgentIds(agentId) {
    const ids = [];
    if (typeof agentId === "string" && agentId.trim()) ids.push(agentId.trim());
    const alias = AGENT_ID_ALIASES[agentId];
    if (typeof alias === "string" && alias.trim() && !ids.includes(alias.trim())) {
        ids.push(alias.trim());
    }
    return ids;
}

async function ensureRegistryLoaded() {
    if (!registryLoadPromise) {
        reg.setRegistryPath(DEFAULT_REGISTRY_PATH);
        registryLoadPromise = reg.loadRegistry().catch((error) => {
            registryLoadPromise = null;
            throw error;
        });
    }
    await registryLoadPromise;
}

function extractTenantConfig(agentRecord, tenantId) {
    if (!agentRecord || typeof agentRecord !== "object" || Array.isArray(agentRecord)) return null;
    const byTenant =
        agentRecord.tenantConfigs &&
        typeof agentRecord.tenantConfigs === "object" &&
        !Array.isArray(agentRecord.tenantConfigs)
            ? agentRecord.tenantConfigs[tenantId]
            : null;
    const baseConfig =
        byTenant && typeof byTenant === "object" && !Array.isArray(byTenant)
            ? byTenant
            : agentRecord.config &&
                typeof agentRecord.config === "object" &&
                !Array.isArray(agentRecord.config)
              ? agentRecord.config
              : null;
    if (!baseConfig) return null;
    const config = { ...baseConfig };
    if (
        !config.runtimeId &&
        typeof agentRecord.runtimeId === "string" &&
        agentRecord.runtimeId.trim()
    ) {
        config.runtimeId = agentRecord.runtimeId.trim();
    }
    if (!config.id && typeof agentRecord.id === "string" && agentRecord.id.trim()) {
        config.id = agentRecord.id.trim();
    }
    return config;
}

/**
 * @param {{ tenantId?: string }} [options]
 * @returns {Promise<string[]>} agent IDs with available tenant config
 */
export async function listAgentIds(options = {}) {
    const tenantId = resolveTenantId(options);
    try {
        await ensureRegistryLoaded();
        const assignments = await reg.listAssignments(tenantId);
        const candidateIds = [
            ...new Set(
                (Array.isArray(assignments) ? assignments : [])
                    .map((a) => (a?.agentId != null ? String(a.agentId).trim() : ""))
                    .filter(Boolean)
            ),
        ];

        const available = [];
        for (const id of candidateIds) {
            const agent = await reg.getAgent(id);
            const cfg = extractTenantConfig(agent, tenantId);
            if (cfg) available.push(id);
        }
        return available.sort();
    } catch (_) {
        return [];
    }
}

/**
 * @param {string} agentId
 * @param {{ tenantId?: string }} [options]
 * @returns {Promise<object>} parsed config
 */
export async function loadAgentConfig(agentId, options = {}) {
    if (!agentId || typeof agentId !== "string" || !agentId.trim()) {
        throw new Error("Missing or invalid agentId");
    }
    const tenantId = resolveTenantId(options);
    await ensureRegistryLoaded();
    const lookupIds = resolveLookupAgentIds(agentId.trim());
    for (const candidateId of lookupIds) {
        const agent = await reg.getAgent(candidateId);
        const config = extractTenantConfig(agent, tenantId);
        if (config) return config;
    }
    throw new Error(`Agent config not found for '${agentId.trim()}' and tenant '${tenantId}'`);
}
