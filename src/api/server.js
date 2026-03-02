/**
 * core HTTP API: POST /api/chat, GET /health, GET /api/config.
 * Config from CONFIG_DIR (+ optional .core-config).
 * Optional auth via CORE_API_KEY/API_KEY and/or .core-config/core.json deployToken.
 */

import http from "http";
import { handleAgentChat } from "./routes/agent-chat.js";
import { loadAgentConfig, listAgentIds } from "../config-loader.js";
import { requireApiKey, requireDeployToken } from "../auth/index.js";
import {
    AuthHttpError,
    buildGoogleAuthUrl,
    getGoogleOAuthPublicConfig,
    loginWithGoogle,
} from "../auth/google-oauth.js";
import {
    listSubaccountConfigs,
    loadCoreConfig,
    toPublicCoreConfig,
    toPublicSubaccountConfig,
} from "../core-config/index.js";

const PORT = Number(process.env.PORT) || 3000;
const CONFIG_DIR = process.env.CONFIG_DIR || "/app/config";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Client-Id, X-Request-Id, X-API-Key, X-Core-Deploy-Token, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(res, statusCode, data, headers = {}) {
    res.writeHead(statusCode, { "Content-Type": "application/json", ...CORS_HEADERS, ...headers });
    res.end(JSON.stringify(data));
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => resolve(body));
        req.on("error", reject);
    });
}

const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;

    const isPublicAuthPath =
        (req.method === "GET" && path === "/api/auth/google/config") ||
        (req.method === "GET" && path === "/api/auth/google/url") ||
        (req.method === "POST" && path === "/api/auth/google/login");

    // Optional API key auth (skip for health and OAuth bootstrap)
    if (path !== "/health" && path !== "/" && !isPublicAuthPath) {
        if (requireApiKey(req, res, jsonResponse)) return;
        if (await requireDeployToken(req, res, jsonResponse)) return;
    }

    if (req.method === "GET" && path === "/api/auth/google/config") {
        jsonResponse(res, 200, getGoogleOAuthPublicConfig());
        return;
    }

    if (req.method === "GET" && path === "/api/auth/google/url") {
        try {
            const authUrl = buildGoogleAuthUrl({
                redirectUri: url.searchParams.get("redirectUri") || undefined,
                state: url.searchParams.get("state") || undefined,
            });
            jsonResponse(res, 200, { authUrl, provider: "google" });
        } catch (error) {
            const statusCode = error instanceof AuthHttpError ? error.statusCode : 500;
            const errorCode = error instanceof AuthHttpError ? error.errorCode : "internal_error";
            const detail = error instanceof AuthHttpError ? error.detail : null;
            jsonResponse(res, statusCode, {
                error: errorCode,
                message: error?.message || "Failed to build Google auth URL.",
                detail,
            });
        }
        return;
    }

    if (req.method === "POST" && path === "/api/auth/google/login") {
        let payload;
        try {
            payload = JSON.parse(await parseBody(req) || "{}");
        } catch (_) {
            jsonResponse(res, 400, { error: "bad_request", message: "Invalid JSON body." });
            return;
        }

        try {
            const result = await loginWithGoogle({
                code: payload?.code,
                idToken: payload?.idToken,
                redirectUri: payload?.redirectUri,
            });
            jsonResponse(res, 200, result);
        } catch (error) {
            const statusCode = error instanceof AuthHttpError ? error.statusCode : 500;
            const errorCode = error instanceof AuthHttpError ? error.errorCode : "internal_error";
            const detail = error instanceof AuthHttpError ? error.detail : null;
            jsonResponse(res, statusCode, {
                error: errorCode,
                message: error?.message || "Google OAuth login failed.",
                detail,
            });
        }
        return;
    }

    if (req.method === "GET" && (path === "/health" || path === "/")) {
        let deploymentName = null;
        try {
            const coreConfig = await loadCoreConfig();
            deploymentName = coreConfig?.branding?.deploymentName || coreConfig?.accountName || null;
        } catch (_) {
            deploymentName = null;
        }
        jsonResponse(res, 200, { ok: true, configDir: CONFIG_DIR, deploymentName });
        return;
    }

    if (req.method === "GET" && path === "/api/config") {
        try {
            const [agentIds, coreConfig] = await Promise.all([
                listAgentIds(),
                loadCoreConfig(),
            ]);
            jsonResponse(res, 200, {
                agentIds,
                core: toPublicCoreConfig(coreConfig),
            });
        } catch (e) {
            jsonResponse(res, 500, { error: "Failed to list agents", detail: e?.message || String(e) });
        }
        return;
    }

    if (req.method === "GET" && path === "/api/config/core") {
        try {
            const coreConfig = await loadCoreConfig();
            jsonResponse(res, 200, { core: toPublicCoreConfig(coreConfig) });
        } catch (e) {
            jsonResponse(res, 500, { error: "Failed to load core config", detail: e?.message || String(e) });
        }
        return;
    }

    if (req.method === "GET" && path === "/api/config/subaccounts") {
        try {
            const items = await listSubaccountConfigs();
            jsonResponse(res, 200, {
                items: items.map((item) => ({
                    fileName: item.fileName,
                    config: toPublicSubaccountConfig(item.config),
                })),
            });
        } catch (e) {
            jsonResponse(res, 500, { error: "Failed to list subaccounts", detail: e?.message || String(e) });
        }
        return;
    }

    const configMatch = path.match(/^\/api\/config\/agents\/([^/]+)\/config\.json$/);
    if (req.method === "GET" && configMatch) {
        const agentId = configMatch[1];
        try {
            const config = await loadAgentConfig(agentId);
            jsonResponse(res, 200, config);
        } catch (e) {
            jsonResponse(res, 404, { error: "Agent config not found", agentId });
        }
        return;
    }

    if (req.method === "POST" && (path === "/api/chat" || path === "/agent-chat")) {
        const body = await parseBody(req);
        await handleAgentChat(req, res, {
            body,
            CORS_HEADERS,
            jsonResponse: (res, code, data, h) => jsonResponse(res, code, data, h),
        });
        return;
    }

    jsonResponse(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
    console.log(`core API on port ${PORT} (CONFIG_DIR=${CONFIG_DIR})`);
});
