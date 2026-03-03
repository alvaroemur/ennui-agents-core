/**
 * Runtime loader for runtime modules.
 * Resolves: CONFIG_DIR/agents/{runtimeId}/runtime.js
 */

import { join, dirname } from "path";
import { access } from "fs/promises";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = join(__dirname, "..", "..");
const CONFIG_DIR = process.env.CONFIG_DIR || CORE_ROOT;

function normalizeRuntimeId(runtimeId) {
    if (typeof runtimeId !== "string" || !runtimeId.trim()) {
        throw new Error("Missing or invalid runtimeId for runtime resolution");
    }
    const normalized = runtimeId.trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(normalized)) {
        throw new Error(`Invalid runtimeId for runtime resolution: ${normalized}`);
    }
    return normalized;
}

/**
 * Load runtime module by runtime ID.
 * @param {string} runtimeId
 * @returns {Promise<object>} runtime contract
 */
export async function loadRuntime(runtimeId) {
    const normalizedRuntimeId = normalizeRuntimeId(runtimeId);
    const runtimePath = join(CONFIG_DIR, "agents", normalizedRuntimeId, "runtime.js");
    try {
        await access(runtimePath);
    } catch {
        throw new Error(`Runtime not found for runtimeId '${normalizedRuntimeId}'`);
    }

    const mod = await import(pathToFileURL(runtimePath).href);
    const runtime = mod?.default && typeof mod.default === "object" ? mod.default : mod;
    if (typeof runtime?.buildSystemPrompt !== "function") {
        throw new Error(
            `Invalid runtime for '${normalizedRuntimeId}': buildSystemPrompt(config) is required`
        );
    }
    return runtime;
}
