/**
 * External core configuration loader.
 * Reads:
 * - .core-config/core.json
 * - .core-config/*.json (subaccount-agent configs)
 */

import { readFile, readdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = join(__dirname, "..", "..");
const BASE_CONFIG_DIR = process.env.CONFIG_DIR || CORE_ROOT;
const CORE_CONFIG_DIR = process.env.CORE_CONFIG_DIR || join(BASE_CONFIG_DIR, ".core-config");

const DEFAULT_DEPLOY_AUTH_HEADER = "x-core-deploy-token";
const SENSITIVE_KEY_REGEX = /(token|secret|password|authorization|api[_-]?key)/i;

function parseJson(raw, filePath) {
    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(`Invalid JSON at ${filePath}: ${error?.message || String(error)}`);
    }
}

async function readJsonFile(path) {
    const raw = await readFile(path, "utf8");
    return parseJson(raw, path);
}

function redactSensitive(value) {
    if (value == null) return value;
    if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
    if (typeof value !== "object") return value;
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
        if (SENSITIVE_KEY_REGEX.test(key)) {
            out[key] = "[REDACTED]";
            continue;
        }
        out[key] = redactSensitive(raw);
    }
    return out;
}

export function getCoreConfigDir() {
    return CORE_CONFIG_DIR;
}

/**
 * @returns {Promise<object|null>} core.json contents, or null when missing
 */
export async function loadCoreConfig() {
    const path = join(CORE_CONFIG_DIR, "core.json");
    try {
        return await readJsonFile(path);
    } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
    }
}

/**
 * @returns {Promise<Array<{fileName: string, config: object}>>}
 */
export async function listSubaccountConfigs() {
    try {
        const entries = await readdir(CORE_CONFIG_DIR, { withFileTypes: true });
        const jsonFiles = entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "core.json")
            .map((entry) => entry.name)
            .sort();

        const items = [];
        for (const fileName of jsonFiles) {
            const path = join(CORE_CONFIG_DIR, fileName);
            const config = await readJsonFile(path);
            items.push({ fileName, config });
        }
        return items;
    } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
    }
}

/**
 * Removes secrets from core config responses.
 * @param {object|null} coreConfig
 * @returns {object|null}
 */
export function toPublicCoreConfig(coreConfig) {
    if (!coreConfig || typeof coreConfig !== "object") return null;
    const next = redactSensitive(coreConfig);
    if (next.auth && typeof next.auth === "object") {
        const auth = { ...next.auth };
        const hasDeployToken =
            typeof coreConfig?.auth?.deployToken === "string" &&
            coreConfig.auth.deployToken.trim().length > 0;
        delete auth.deployToken;
        auth.hasDeployToken = hasDeployToken;
        next.auth = auth;
    }
    return next;
}

/**
 * Removes obvious secrets from subaccount-agent config responses.
 * @param {object|null} config
 * @returns {object|null}
 */
export function toPublicSubaccountConfig(config) {
    if (!config || typeof config !== "object") return null;
    const next = redactSensitive(config);
    if (next.auth && typeof next.auth === "object") {
        const auth = { ...next.auth };
        const hasClientToken =
            typeof config?.auth?.clientToken === "string" &&
            config.auth.clientToken.trim().length > 0;
        delete auth.clientToken;
        auth.hasClientToken = hasClientToken;
        next.auth = auth;
    }
    return next;
}

function firstNonEmptyString(values) {
    for (const value of values) {
        if (typeof value !== "string") continue;
        const trimmed = value.trim();
        if (trimmed) return trimmed;
    }
    return "";
}

/**
 * Resolve fingerprint prefix for execution tracing.
 * Priority:
 * 1) CORE_FINGERPRINT_PREFIX env var
 * 2) core.json tracing.fingerprintPrefix
 * 3) core.json fingerprintPrefix
 * @param {object|null} coreConfig
 * @returns {string}
 */
export function getFingerprintPrefix(coreConfig) {
    return firstNonEmptyString([
        process.env.CORE_FINGERPRINT_PREFIX,
        coreConfig?.tracing?.fingerprintPrefix,
        coreConfig?.fingerprintPrefix,
    ]);
}

/**
 * @param {object|null} coreConfig
 * @returns {{ headerName: string, headerKey: string, token: string }|null}
 */
export function getDeployAuthConfig(coreConfig) {
    if (!coreConfig || typeof coreConfig !== "object") return null;
    const auth = coreConfig.auth;
    if (!auth || typeof auth !== "object") return null;
    const rawToken = typeof auth.deployToken === "string" ? auth.deployToken.trim() : "";
    if (!rawToken) return null;
    const rawHeader = typeof auth.headerName === "string" ? auth.headerName.trim() : "";
    const headerName = rawHeader || DEFAULT_DEPLOY_AUTH_HEADER;
    return {
        headerName,
        headerKey: headerName.toLowerCase(),
        token: rawToken,
    };
}
