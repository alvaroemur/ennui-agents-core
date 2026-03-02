/**
 * core API: health, config desde agents/, y POST /api/chat (con runtime opcional).
 * CONFIG_DIR por defecto = ./agents (raíz del módulo).
 */

import http from "http";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { listAgentIds, loadAgentConfig } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CONFIG_DIR = process.env.CONFIG_DIR || ROOT;

const PORT = Number(process.env.PORT) || 3000;

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Client-Id",
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

// Resolver agentIds desde CONFIG_DIR/agents (misma estructura que agents-api)
async function listIds() {
    const agentsDir = join(CONFIG_DIR, "agents");
    const { readdir, readFile } = await import("fs/promises");
    try {
        const entries = await readdir(agentsDir, { withFileTypes: true });
        const ids = [];
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            try {
                await readFile(join(agentsDir, e.name, "config.json"), "utf8");
                ids.push(e.name);
            } catch {
                // no config
            }
        }
        return ids;
    } catch {
        return [];
    }
}

async function loadConfig(agentId) {
    const path = join(CONFIG_DIR, "agents", agentId, "config.json");
    const { readFile } = await import("fs/promises");
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;

    if (req.method === "GET" && (path === "/health" || path === "/")) {
        jsonResponse(res, 200, { ok: true, configDir: CONFIG_DIR });
        return;
    }

    if (req.method === "GET" && path === "/api/config") {
        try {
            const agentIds = await listIds();
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
            const config = await loadConfig(agentId);
            jsonResponse(res, 200, config);
        } catch (e) {
            jsonResponse(res, 404, { error: "Agent config not found", agentId });
        }
        return;
    }

    if (req.method === "POST" && (path === "/api/chat" || path === "/agent-chat")) {
        // Runtime opcional: si existe @inspiro/agents, usarlo; si no, 501
        let respond;
        try {
            const agents = await import("@inspiro/agents");
            respond = agents.respond;
        } catch {
            respond = null;
        }
        if (!respond) {
            jsonResponse(res, 501, {
                error: "Chat runtime not available",
                detail: "Install @inspiro/agents (or set CONFIG_DIR to an agents-api config) for POST /api/chat",
            });
            return;
        }
        const body = await parseBody(req);
        let payload;
        try {
            payload = JSON.parse(body || "{}");
        } catch {
            jsonResponse(res, 400, { error: "Invalid JSON" });
            return;
        }
        const { agentId, messages, appendSystemPrompt, preferredProvider } = payload;
        if (!agentId || !messages) {
            jsonResponse(res, 400, { error: "agentId and messages required" });
            return;
        }
        try {
            const config = await loadConfig(agentId);
            const apiKeys = {};
            if (process.env.OPENAI_API_KEY) apiKeys.openai = process.env.OPENAI_API_KEY;
            if (process.env.GOOGLE_API_KEY) apiKeys.google = process.env.GOOGLE_API_KEY;
            const result = await respond({
                config,
                messages,
                appendSystemPrompt,
                preferredProvider,
                apiKeys,
            });
            jsonResponse(res, 200, result);
        } catch (e) {
            jsonResponse(res, 500, {
                error: "Chat failed",
                detail: e?.message || String(e),
            });
        }
        return;
    }

    jsonResponse(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
    console.log(`core API on port ${PORT} (CONFIG_DIR=${CONFIG_DIR})`);
});
