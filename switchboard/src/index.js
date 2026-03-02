/**
 * Switchboard: proxy /api/chat (X-Account-Id + body), API de registro, /health, centro de control (UI).
 */

import http from "http";
import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { forwardChat } from "./proxy.js";
import * as reg from "./registry.js";
import {
    authenticateRequest,
    canRead,
    canUseChat,
    getPrincipalAccountId,
    isAdmin,
} from "./rbac.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

const PORT = Number(process.env.PORT) || 3010;
const REGISTRY_PATH = process.env.REGISTRY_PATH || "./data/registry.json";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Account-Id, Authorization, X-API-Key",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "X-Run-Id",
};

reg.setRegistryPath(REGISTRY_PATH);
try {
    await reg.loadRegistry();
} catch (error) {
    console.warn("Switchboard: failed to load registry, continuing with empty state.", error?.message || String(error));
}

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

function normalizeBaseUrl(input) {
    if (typeof input !== "string") return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
        const normalized = new URL(trimmed).toString();
        return normalized.replace(/\/$/, "");
    } catch (_) {
        return null;
    }
}

function getHeaderValue(headers, key) {
    const value = headers?.[key];
    if (Array.isArray(value)) return value[0] ?? "";
    if (typeof value === "string") return value;
    return "";
}

// Build deployments health array (used by /api/registry/status and GET /api/status)
async function getDeploymentsStatus() {
    const deployments = await reg.listDeployments();
    const results = [];
    for (const d of deployments) {
        const baseUrl = normalizeBaseUrl(d.baseUrl);
        if (!baseUrl) {
            results.push({
                deploymentId: d.id,
                baseUrl: d.baseUrl ?? null,
                ok: false,
                error: "Invalid baseUrl",
            });
            continue;
        }
        const url = baseUrl + "/health";
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

// Registry REST: /api/registry/accounts, /api/registry/agents, /api/registry/deployments, /api/registry/assignments
async function handleRegistry(req, res, pathname, body, principal) {
    const segments = pathname.replace(/^\/api\/registry\/?/, "").split("/").filter(Boolean);

    // GET /api/registry/status
    if (segments[0] === "status") {
        if (!isAdmin(principal)) {
            jsonResponse(res, 403, { error: "Forbidden" });
            return;
        }
        await handleRegistryStatus(res);
        return;
    }

    const [entity, id, id2] = segments;
    const writeMethod = req.method === "POST" || req.method === "PATCH" || req.method === "DELETE";
    if (writeMethod && !isAdmin(principal)) {
        jsonResponse(res, 403, { error: "Forbidden" });
        return;
    }

    if (entity === "accounts") {
        if (req.method === "GET" && !id) {
            const accounts = await reg.listAccounts();
            if (isAdmin(principal)) {
                jsonResponse(res, 200, accounts);
                return;
            }
            const scopedAccountId = getPrincipalAccountId(principal);
            const own = accounts.filter((a) => a.id === scopedAccountId);
            jsonResponse(res, 200, own);
            return;
        }
        if (req.method === "GET" && id) {
            if (!canRead(principal, id)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            const account = await reg.getAccount(id);
            if (!account) { jsonResponse(res, 404, { error: "Not found" }); return; }
            jsonResponse(res, 200, account);
            return;
        }
        if (req.method === "POST" && !id) {
            const data = JSON.parse(body || "{}");
            const created = await reg.createAccount(data);
            if (!created) { jsonResponse(res, 409, { error: "Already exists" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 201, created);
            return;
        }
        if (req.method === "PATCH" && id) {
            const data = JSON.parse(body || "{}");
            const updated = await reg.updateAccount(id, data);
            if (!updated) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 200, updated);
            return;
        }
        if (req.method === "DELETE" && id) {
            const ok = await reg.deleteAccount(id);
            if (!ok) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            res.writeHead(204, CORS_HEADERS);
            res.end();
            return;
        }
    }

    if (entity === "agents") {
        if (req.method === "GET" && !id) {
            jsonResponse(res, 200, await reg.listAgents());
            return;
        }
        if (req.method === "GET" && id) {
            const a = await reg.getAgent(id);
            if (!a) { jsonResponse(res, 404, { error: "Not found" }); return; }
            jsonResponse(res, 200, a);
            return;
        }
        if (req.method === "POST" && !id) {
            const data = JSON.parse(body || "{}");
            const created = await reg.createAgent(data);
            if (!created) { jsonResponse(res, 409, { error: "Already exists" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 201, created);
            return;
        }
        if (req.method === "PATCH" && id) {
            const data = JSON.parse(body || "{}");
            const updated = await reg.updateAgent(id, data);
            if (!updated) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 200, updated);
            return;
        }
        if (req.method === "DELETE" && id) {
            const ok = await reg.deleteAgent(id);
            if (!ok) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            res.writeHead(204, CORS_HEADERS);
            res.end();
            return;
        }
    }

    if (entity === "deployments") {
        if (req.method === "GET" && !id) {
            if (isAdmin(principal)) {
                const q = parseUrl(req).searchParams;
                if (q.has("clientId")) {
                    jsonResponse(res, 400, {
                        error: "Legacy query param not supported",
                        detail: "Use accountId instead of clientId",
                    });
                    return;
                }
                const queryAccountId = q.get("accountId");
                jsonResponse(res, 200, await reg.listDeployments(queryAccountId || null));
                return;
            }
            const scopedAccountId = getPrincipalAccountId(principal);
            const assignments = await reg.listAssignments(scopedAccountId);
            const deploymentIds = new Set(assignments.map((a) => a.deploymentId).filter(Boolean));
            const allDeployments = await reg.listDeployments();
            jsonResponse(res, 200, allDeployments.filter((d) => deploymentIds.has(d.id)));
            return;
        }
        if (req.method === "GET" && id) {
            const d = await reg.getDeployment(id);
            if (!d) { jsonResponse(res, 404, { error: "Not found" }); return; }
            if (!isAdmin(principal)) {
                const scopedAccountId = getPrincipalAccountId(principal);
                const assignments = await reg.listAssignments(scopedAccountId);
                const hasAccess = assignments.some((a) => a.deploymentId === id);
                if (!hasAccess) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            }
            jsonResponse(res, 200, d);
            return;
        }
        if (req.method === "POST" && !id) {
            const data = JSON.parse(body || "{}");
            const normalizedBaseUrl = normalizeBaseUrl(data.baseUrl);
            if (!normalizedBaseUrl) {
                jsonResponse(res, 400, { error: "Invalid deployment baseUrl" });
                return;
            }
            data.baseUrl = normalizedBaseUrl;
            const created = await reg.createDeployment(data);
            if (!created) { jsonResponse(res, 409, { error: "Already exists" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 201, created);
            return;
        }
        if (req.method === "PATCH" && id) {
            const data = JSON.parse(body || "{}");
            if (Object.prototype.hasOwnProperty.call(data, "baseUrl")) {
                const normalizedBaseUrl = normalizeBaseUrl(data.baseUrl);
                if (!normalizedBaseUrl) {
                    jsonResponse(res, 400, { error: "Invalid deployment baseUrl" });
                    return;
                }
                data.baseUrl = normalizedBaseUrl;
            }
            const updated = await reg.updateDeployment(id, data);
            if (!updated) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 200, updated);
            return;
        }
        if (req.method === "DELETE" && id) {
            const ok = await reg.deleteDeployment(id);
            if (!ok) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            res.writeHead(204, CORS_HEADERS);
            res.end();
            return;
        }
    }

    if (entity === "assignments") {
        const q = parseUrl(req).searchParams;
        if (q.has("clientId")) {
            jsonResponse(res, 400, {
                error: "Legacy query param not supported",
                detail: "Use accountId instead of clientId",
            });
            return;
        }
        const queryAccountId = q.get("accountId");
        const accountIdParam = isAdmin(principal) ? queryAccountId : (getPrincipalAccountId(principal) || null);
        if (req.method === "GET" && !id) {
            jsonResponse(res, 200, await reg.listAssignments(accountIdParam || null));
            return;
        }
        if (req.method === "POST" && !id) {
            const data = JSON.parse(body || "{}");
            const created = await reg.createAssignment(data);
            if (!created) { jsonResponse(res, 409, { error: "Already exists" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 201, created);
            return;
        }
        if (req.method === "PATCH" && id && id2) {
            const data = JSON.parse(body || "{}");
            const updated = await reg.updateAssignment(id, id2, data);
            if (!updated) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 200, updated);
            return;
        }
        if (req.method === "DELETE" && id && id2) {
            const ok = await reg.deleteAssignment(id, id2);
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
    const auth = await authenticateRequest(req, {
        getAccountById: reg.getAccount,
    });
    const isPublicPath =
        (req.method === "GET" && path === "/health") ||
        (req.method === "GET" && (path === "/" || path === "/control" || path === "/control/"));
    if (!isPublicPath && auth.enabled && !auth.principal) {
        jsonResponse(res, 401, { error: "Unauthorized" });
        return;
    }
    const principal = auth.principal;

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

    // GET /api/me — current principal (role, accountId, subject) for UI
    if (req.method === "GET" && path === "/api/me") {
        if (!principal) {
            jsonResponse(res, 401, { error: "Unauthorized" });
            return;
        }
        jsonResponse(res, 200, {
            role: principal.role,
            accountId: principal.accountId ?? null,
            subject: principal.subject ?? null,
        });
        return;
    }

    // GET /api/status — aggregated status for dashboard (switchboard + deployments)
    if (req.method === "GET" && path === "/api/status") {
        if (!isAdmin(principal)) {
            jsonResponse(res, 403, { error: "Forbidden" });
            return;
        }
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

    // GET /api/runs — list runs with filters
    if (req.method === "GET" && path === "/api/runs") {
        const q = url.searchParams;
        if (q.has("clientId")) {
            jsonResponse(res, 400, {
                error: "Legacy query param not supported",
                detail: "Use accountId instead of clientId",
            });
            return;
        }
        const requestedAccountId = q.get("accountId");
        const scopedAccountId = getPrincipalAccountId(principal);
        if (!isAdmin(principal) && requestedAccountId && requestedAccountId !== scopedAccountId) {
            jsonResponse(res, 403, { error: "Forbidden" });
            return;
        }
        const data = await reg.listRuns({
            accountId: isAdmin(principal) ? requestedAccountId : (scopedAccountId || null),
            agentId: q.get("agentId"),
            deploymentId: q.get("deploymentId"),
            status: q.get("status"),
            provider: q.get("provider"),
            from: q.get("from"),
            to: q.get("to"),
            limit: q.get("limit"),
            offset: q.get("offset"),
        });
        jsonResponse(res, 200, data);
        return;
    }

    // GET /api/runs/:runId — run detail
    const runMatch = path.match(/^\/api\/runs\/([^/]+)$/);
    if (req.method === "GET" && runMatch) {
        const runId = runMatch[1];
        const run = await reg.getRun(runId);
        if (!run) {
            jsonResponse(res, 404, { error: "Run not found", runId });
            return;
        }
        if (!canRead(principal, run.accountId || null)) {
            jsonResponse(res, 403, { error: "Forbidden" });
            return;
        }
        jsonResponse(res, 200, { run });
        return;
    }

    // /api/registry/*
    if (path.startsWith("/api/registry")) {
        await handleRegistry(req, res, path, body, principal);
        return;
    }

    jsonResponse(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
    console.log(`Switchboard listening on port ${PORT} (REGISTRY_PATH=${REGISTRY_PATH})`);
});
