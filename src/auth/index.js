/**
 * Auth submodule: optional API key check for the API server.
 * If CORE_API_KEY (or API_KEY) is set, requests must provide X-API-Key
 * or Authorization: Bearer <key>.
 * Otherwise no check (open).
 */

import { getDeployAuthConfig, loadCoreConfig } from "../core-config/index.js";

/**
 * Returns the expected API key if auth is enabled, or null if disabled.
 * @returns {string|null}
 */
export function getRequiredApiKey() {
    const key =
        process.env.CORE_API_KEY ||
        process.env.API_KEY ||
        "";
    const trimmed = typeof key === "string" ? key.replace(/\r\n?|\n/g, "").trim() : "";
    return trimmed || null;
}

/**
 * Extracts API key from request: X-API-Key header or Authorization: Bearer <token>.
 * @param {import('http').IncomingMessage} req
 * @returns {string|null}
 */
export function getApiKeyFromRequest(req) {
    const header = req.headers["x-api-key"];
    if (header && typeof header === "string") return header.trim();
    const auth = req.headers.authorization;
    if (auth && typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
        return auth.slice(7).trim();
    }
    return null;
}

/**
 * Middleware: if auth is enabled, rejects with 401 when key is missing or invalid.
 * Call before handling the request; if it sends a response it returns true (caller should not continue).
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {(res: import('http').ServerResponse, status: number, data: object) => void} jsonResponse
 * @returns {boolean} true if response was sent (unauthorized), false to continue
 */
export function requireApiKey(req, res, jsonResponse) {
    const required = getRequiredApiKey();
    if (!required) return false;
    const provided = getApiKeyFromRequest(req);
    if (!provided || provided !== required) {
        jsonResponse(res, 401, { error: "Unauthorized", detail: "Missing or invalid API key" });
        return true;
    }
    return false;
}

function getHeaderValue(req, headerKey) {
    const value = req.headers[headerKey];
    if (Array.isArray(value)) return value[0] ?? null;
    if (typeof value === "string") return value;
    return null;
}

/**
 * Optional auth from .core-config/core.json.
 * If auth.deployToken exists, requests must provide the configured header.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {(res: import('http').ServerResponse, status: number, data: object) => void} jsonResponse
 * @returns {Promise<boolean>} true if response was sent (unauthorized/config error), false to continue
 */
export async function requireDeployToken(req, res, jsonResponse) {
    try {
        const coreConfig = await loadCoreConfig();
        const deployAuth = getDeployAuthConfig(coreConfig);
        if (!deployAuth) return false;

        const provided = (getHeaderValue(req, deployAuth.headerKey) || "").trim();
        if (!provided || provided !== deployAuth.token) {
            jsonResponse(res, 401, {
                error: "Unauthorized",
                detail: `Missing or invalid ${deployAuth.headerName} header`,
            });
            return true;
        }
        return false;
    } catch (error) {
        jsonResponse(res, 500, {
            error: "Auth configuration error",
            detail: error?.message || String(error),
        });
        return true;
    }
}
