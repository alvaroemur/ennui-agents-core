/**
 * ennui-agents-core HTTP API: POST /api/chat, GET /health, GET /api/config.
 * Config from CONFIG_DIR. Optional auth via ENNUI_API_KEY or API_KEY.
 */

import http from "http";
import { handleAgentChat } from "./routes/agent-chat.js";
import { loadAgentConfig, listAgentIds } from "../config-loader.js";
import { requireApiKey } from "../auth/index.js";

const PORT = Number(process.env.PORT) || 3000;
const CONFIG_DIR = process.env.CONFIG_DIR || "/app/config";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Client-Id, X-API-Key, Authorization",
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

    // Optional API key auth (skip for health)
    if (path !== "/health" && path !== "/") {
        if (requireApiKey(req, res, jsonResponse)) return;
    }

    if (req.method === "GET" && (path === "/health" || path === "/")) {
        jsonResponse(res, 200, { ok: true, configDir: CONFIG_DIR });
        return;
    }

    if (req.method === "GET" && path === "/api/config") {
        try {
            const agentIds = await listAgentIds();
            jsonResponse(res, 200, { agentIds });
        } catch (e) {
            jsonResponse(res, 500, { error: "Failed to list agents", detail: e?.message || String(e) });
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
    console.log(`ennui-agents-core API on port ${PORT} (CONFIG_DIR=${CONFIG_DIR})`);
});
