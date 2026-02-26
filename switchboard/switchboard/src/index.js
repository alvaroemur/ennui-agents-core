/**
 * Switchboard: proxy /api/chat (X-Client-Id + body), API de registro, /health, centro de control (UI).
 */

import http from "http";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { forwardChat } from "./proxy.js";
import * as reg from "./registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

const PORT = Number(process.env.PORT) || 3010;
const REGISTRY_PATH = process.env.REGISTRY_PATH || "./data/registry.json";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Client-Id",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

reg.setRegistryPath(REGISTRY_PATH);
await reg.loadRegistry();

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

function parseUrl(req) {
    return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
}

// Build deployments health array (used by /api/registry/status and GET /api/status)
async function getDeploymentsStatus() {
    const deployments = reg.listDeployments();
    const results = [];
    for (const d of deployments) {
        const url = d.baseUrl.replace(/\/$/, "") + "/health";
        const start = Date.now();
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 5000);
            const r = await fetch(url, { signal: ctrl.signal });
            clearTimeout(t);
            const ok = r.ok;
            const latencyMs = Date.now() - start;
            results.push({ deploymentId: d.id, baseUrl: d.baseUrl, ok, latencyMs });
        } catch (e) {
            results.push({
                deploymentId: d.id,
                baseUrl: d.baseUrl,
                ok: false,
                error: e?.name === "AbortError" ? "Timeout" : (e?.message || String(e)),
            });
        }
    }
    return results;
}

async function handleRegistryStatus(res) {
    const results = await getDeploymentsStatus();
    jsonResponse(res, 200, { deployments: results });
}

// Registry REST: /api/registry/clients, /api/registry/agents, /api/registry/deployments, /api/registry/assignments
async function handleRegistry(req, res, pathname, body) {
    const segments = pathname.replace(/^\/api\/registry\/?/, "").split("/").filter(Boolean);

    // GET /api/registry/status
    if (segments[0] === "status") {
        await handleRegistryStatus(res);
        return;
    }

    const [entity, id, id2] = segments;

    if (entity === "clients") {
        if (req.method === "GET" && !id) {
            jsonResponse(res, 200, reg.listClients());
            return;
        }
        if (req.method === "GET" && id) {
            const c = reg.getClient(id);
            if (!c) { jsonResponse(res, 404, { error: "Not found" }); return; }
            jsonResponse(res, 200, c);
            return;
        }
        if (req.method === "POST" && !id) {
            const data = JSON.parse(body || "{}");
            const created = reg.createClient(data);
            if (!created) { jsonResponse(res, 409, { error: "Already exists" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 201, created);
            return;
        }
        if (req.method === "PATCH" && id) {
            const data = JSON.parse(body || "{}");
            const updated = reg.updateClient(id, data);
            if (!updated) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 200, updated);
            return;
        }
        if (req.method === "DELETE" && id) {
            const ok = reg.deleteClient(id);
            if (!ok) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            res.writeHead(204, CORS_HEADERS);
            res.end();
            return;
        }
    }

    if (entity === "agents") {
        if (req.method === "GET" && !id) {
            jsonResponse(res, 200, reg.listAgents());
            return;
        }
        if (req.method === "GET" && id) {
            const a = reg.getAgent(id);
            if (!a) { jsonResponse(res, 404, { error: "Not found" }); return; }
            jsonResponse(res, 200, a);
            return;
        }
        if (req.method === "POST" && !id) {
            const data = JSON.parse(body || "{}");
            const created = reg.createAgent(data);
            if (!created) { jsonResponse(res, 409, { error: "Already exists" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 201, created);
            return;
        }
        if (req.method === "PATCH" && id) {
            const data = JSON.parse(body || "{}");
            const updated = reg.updateAgent(id, data);
            if (!updated) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 200, updated);
            return;
        }
        if (req.method === "DELETE" && id) {
            const ok = reg.deleteAgent(id);
            if (!ok) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            res.writeHead(204, CORS_HEADERS);
            res.end();
            return;
        }
    }

    if (entity === "deployments") {
        const clientId = parseUrl(req).searchParams.get("clientId");
        if (req.method === "GET" && !id) {
            jsonResponse(res, 200, reg.listDeployments(clientId || null));
            return;
        }
        if (req.method === "GET" && id) {
            const d = reg.getDeployment(id);
            if (!d) { jsonResponse(res, 404, { error: "Not found" }); return; }
            jsonResponse(res, 200, d);
            return;
        }
        if (req.method === "POST" && !id) {
            const data = JSON.parse(body || "{}");
            const created = reg.createDeployment(data);
            if (!created) { jsonResponse(res, 409, { error: "Already exists" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 201, created);
            return;
        }
        if (req.method === "PATCH" && id) {
            const data = JSON.parse(body || "{}");
            const updated = reg.updateDeployment(id, data);
            if (!updated) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 200, updated);
            return;
        }
        if (req.method === "DELETE" && id) {
            const ok = reg.deleteDeployment(id);
            if (!ok) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            res.writeHead(204, CORS_HEADERS);
            res.end();
            return;
        }
    }

    if (entity === "assignments") {
        const clientIdParam = parseUrl(req).searchParams.get("clientId");
        if (req.method === "GET" && !id) {
            jsonResponse(res, 200, reg.listAssignments(clientIdParam || null));
            return;
        }
        if (req.method === "POST" && !id) {
            const data = JSON.parse(body || "{}");
            const created = reg.createAssignment(data);
            if (!created) { jsonResponse(res, 409, { error: "Already exists" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 201, created);
            return;
        }
        if (req.method === "PATCH" && id && id2) {
            const data = JSON.parse(body || "{}");
            const updated = reg.updateAssignment(id, id2, data);
            if (!updated) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 200, updated);
            return;
        }
        if (req.method === "DELETE" && id && id2) {
            const ok = reg.deleteAssignment(id, id2);
            if (!ok) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            res.writeHead(204, CORS_HEADERS);
            res.end();
            return;
        }
    }

    jsonResponse(res, 404, { error: "Not found" });
}

const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
    }

    const url = parseUrl(req);
    const path = url.pathname;
    const body = await parseBody(req);

    // Health (only /health; / serves UI)
    if (req.method === "GET" && path === "/health") {
        jsonResponse(res, 200, { ok: true });
        return;
    }

    // Centro de control UI: GET / or GET /control
    if (req.method === "GET" && (path === "/" || path === "/control" || path === "/control/")) {
        try {
            const html = await readFile(join(PUBLIC_DIR, "index.html"), "utf8");
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...CORS_HEADERS });
            res.end(html);
        } catch (e) {
            res.writeHead(404, { "Content-Type": "application/json", ...CORS_HEADERS });
            res.end(JSON.stringify({ error: "Control center UI not found" }));
        }
        return;
    }

    // GET /api/status — aggregated status for dashboard (switchboard + deployments)
    if (req.method === "GET" && path === "/api/status") {
        const deployments = await getDeploymentsStatus();
        const allOk = deployments.length === 0 || deployments.every((d) => d.ok);
        jsonResponse(res, 200, {
            ok: allOk,
            timestamp: new Date().toISOString(),
            switchboard: { ok: true },
            deployments,
        });
        return;
    }

    // POST /api/chat — proxy with X-Client-Id (paths: /api/chat, /switchboard/chat, /orchestrator/chat for compat)
    if (req.method === "POST" && (path === "/api/chat" || path === "/switchboard/chat" || path === "/orchestrator/chat")) {
        const clientId = req.headers["x-client-id"]?.trim() || JSON.parse(body || "{}").clientId?.trim();
        if (!clientId) {
            jsonResponse(res, 400, { error: "Missing or invalid clientId", detail: "Send X-Client-Id header or clientId in body" });
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(body || "{}");
        } catch {
            jsonResponse(res, 400, { error: "Invalid JSON" });
            return;
        }
        const agentId = parsed.agentId?.trim();
        if (!agentId) {
            jsonResponse(res, 400, { error: "Missing or invalid agentId" });
            return;
        }
        const assignment = reg.findAssignment(clientId, agentId);
        if (!assignment) {
            jsonResponse(res, 404, { error: "No assignment for client and agent", detail: `clientId=${clientId}, agentId=${agentId}` });
            return;
        }
        const deployment = reg.findDeployment(assignment.deploymentId);
        if (!deployment) {
            jsonResponse(res, 404, { error: "Deployment not found", detail: assignment.deploymentId });
            return;
        }
        if (Array.isArray(deployment.agentIds) && deployment.agentIds.length > 0 && !deployment.agentIds.includes(agentId)) {
            jsonResponse(res, 409, { error: "Agent not served by deployment", detail: `agentId=${agentId} not in deployment.agentIds` });
            return;
        }
        const forwardBody = JSON.stringify({
            agentId: parsed.agentId,
            messages: parsed.messages,
            appendSystemPrompt: parsed.appendSystemPrompt,
            preferredProvider: parsed.preferredProvider,
        });
        const result = await forwardChat(clientId, agentId, forwardBody);
        if (result.error) {
            jsonResponse(res, result.statusCode || 502, { error: result.error, detail: result.detail });
            return;
        }
        jsonResponse(res, result.statusCode, result.parsed ?? JSON.parse(result.body));
        return;
    }

    // /api/registry/*
    if (path.startsWith("/api/registry")) {
        await handleRegistry(req, res, path, body);
        return;
    }

    jsonResponse(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
    console.log(`Switchboard listening on port ${PORT} (REGISTRY_PATH=${REGISTRY_PATH})`);
});
