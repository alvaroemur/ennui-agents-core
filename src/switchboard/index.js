/**
 * Switchboard: proxy de chat via core relay, API de registro, /health, centro de control (UI).
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
    canWrite,
    getPrincipalWorkspaceId,
    isAdmin,
} from "./rbac.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const DEFAULT_REGISTRY_PATH = join(__dirname, "data", "registry.json");

const PORT = Number(process.env.PORT) || 3010;
const REGISTRY_PATH = process.env.REGISTRY_PATH || DEFAULT_REGISTRY_PATH;

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

// Registry REST: /api/registry/workspaces, tenants, users, memberships, agents, deployments, assignments
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

    // workspaces (alias: accounts for backward compat) — solo admin puede crear/editar/eliminar workspaces
    if (entity === "workspaces" || entity === "accounts") {
        if (req.method === "GET" && !id) {
            const workspaces = await reg.listWorkspaces();
            if (isAdmin(principal)) {
                jsonResponse(res, 200, workspaces);
                return;
            }
            const scopedWorkspaceId = getPrincipalWorkspaceId(principal);
            const own = workspaces.filter((w) => w.id === scopedWorkspaceId);
            jsonResponse(res, 200, own);
            return;
        }
        if (req.method === "GET" && id) {
            if (!canRead(principal, id)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            const workspace = await reg.getWorkspace(id);
            if (!workspace) { jsonResponse(res, 404, { error: "Not found" }); return; }
            jsonResponse(res, 200, workspace);
            return;
        }
        if (req.method === "POST" && !id) {
            if (!isAdmin(principal)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            const data = JSON.parse(body || "{}");
            const created = await reg.createWorkspace(data);
            if (!created) { jsonResponse(res, 409, { error: "Already exists" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 201, created);
            return;
        }
        if (req.method === "PATCH" && id) {
            if (!isAdmin(principal)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            const data = JSON.parse(body || "{}");
            const updated = await reg.updateWorkspace(id, data);
            if (!updated) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 200, updated);
            return;
        }
        if (req.method === "DELETE" && id) {
            if (!isAdmin(principal)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            const ok = await reg.deleteWorkspace(id);
            if (!ok) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            res.writeHead(204, CORS_HEADERS);
            res.end();
            return;
        }
    }

    // tenants — operador puede CRUD en workspaces que puede escribir
    if (entity === "tenants") {
        const q = parseUrl(req).searchParams;
        const queryWorkspaceId = q.get("workspaceId");
        const workspaceIdParam = isAdmin(principal) ? queryWorkspaceId : (getPrincipalWorkspaceId(principal) || null);
        if (req.method === "GET" && !id) {
            const tenants = await reg.listTenants(workspaceIdParam || undefined);
            if (!isAdmin(principal) && workspaceIdParam) {
                const filtered = tenants.filter((t) => t.workspaceId === workspaceIdParam);
                jsonResponse(res, 200, filtered);
                return;
            }
            jsonResponse(res, 200, tenants);
            return;
        }
        if (req.method === "GET" && id) {
            const tenant = await reg.getTenant(id);
            if (!tenant) { jsonResponse(res, 404, { error: "Not found" }); return; }
            if (!canRead(principal, tenant.workspaceId)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            jsonResponse(res, 200, tenant);
            return;
        }
        if (req.method === "POST" && !id) {
            const data = JSON.parse(body || "{}");
            const workspaceId = data.workspaceId != null ? String(data.workspaceId) : "";
            if (!canWrite(principal, workspaceId)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            const created = await reg.createTenant(data);
            if (!created) { jsonResponse(res, 409, { error: "Already exists" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 201, created);
            return;
        }
        if (req.method === "PATCH" && id) {
            const existing = await reg.getTenant(id);
            if (!existing) { jsonResponse(res, 404, { error: "Not found" }); return; }
            if (!canWrite(principal, existing.workspaceId)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            const data = JSON.parse(body || "{}");
            const updated = await reg.updateTenant(id, data);
            if (!updated) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 200, updated);
            return;
        }
        if (req.method === "DELETE" && id) {
            const existing = await reg.getTenant(id);
            if (!existing) { jsonResponse(res, 404, { error: "Not found" }); return; }
            if (!canWrite(principal, existing.workspaceId)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            const ok = await reg.deleteTenant(id);
            if (!ok) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            res.writeHead(204, CORS_HEADERS);
            res.end();
            return;
        }
    }

    // users — crear usuario solo admin; operador invita mediante workspace_memberships
    if (entity === "users") {
        if (req.method === "GET" && !id) {
            const users = await reg.listUsers();
            jsonResponse(res, 200, users);
            return;
        }
        if (req.method === "GET" && id) {
            const user = await reg.getUser(id);
            if (!user) { jsonResponse(res, 404, { error: "Not found" }); return; }
            jsonResponse(res, 200, user);
            return;
        }
        if (req.method === "POST" && !id) {
            if (!isAdmin(principal)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            const data = JSON.parse(body || "{}");
            const created = await reg.createUser(data);
            if (!created) { jsonResponse(res, 409, { error: "Already exists" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 201, created);
            return;
        }
    }

    // workspace_memberships (alias: memberships) — operador puede invitar (POST) a su workspace
    if (entity === "workspace_memberships" || entity === "memberships") {
        const q = parseUrl(req).searchParams;
        const queryWorkspaceId = q.get("workspaceId");
        const queryUserId = q.get("userId");
        if (req.method === "GET" && !id) {
            const list = await reg.listWorkspaceMemberships(queryWorkspaceId || undefined, queryUserId || undefined);
            if (queryWorkspaceId && !isAdmin(principal) && !canRead(principal, queryWorkspaceId)) {
                jsonResponse(res, 403, { error: "Forbidden" });
                return;
            }
            jsonResponse(res, 200, list);
            return;
        }
        if (req.method === "POST" && !id) {
            const data = JSON.parse(body || "{}");
            const workspaceId = data.workspaceId != null ? String(data.workspaceId) : "";
            if (!canWrite(principal, workspaceId)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            const created = await reg.createWorkspaceMembership(data);
            if (!created) { jsonResponse(res, 409, { error: "Already exists" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 201, created);
            return;
        }
    }

    // agents — catálogo global; solo admin puede crear/editar/eliminar
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
            if (!isAdmin(principal)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            const data = JSON.parse(body || "{}");
            const created = await reg.createAgent(data);
            if (!created) { jsonResponse(res, 409, { error: "Already exists" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 201, created);
            return;
        }
        if (req.method === "PATCH" && id) {
            if (!isAdmin(principal)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            const data = JSON.parse(body || "{}");
            const updated = await reg.updateAgent(id, data);
            if (!updated) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 200, updated);
            return;
        }
        if (req.method === "DELETE" && id) {
            if (!isAdmin(principal)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
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
            const q = parseUrl(req).searchParams;
            if (q.has("clientId")) {
                jsonResponse(res, 400, {
                    error: "Legacy query param not supported",
                    detail: "Use workspaceId instead of clientId",
                });
                return;
            }
            const queryWorkspaceId = q.get("workspaceId");
            const workspaceIdParam = isAdmin(principal) ? queryWorkspaceId : (getPrincipalWorkspaceId(principal) || null);
            const deployments = await reg.listDeployments(workspaceIdParam || undefined);
            if (!isAdmin(principal)) {
                const tenants = await reg.listTenants(workspaceIdParam);
                const assignmentLists = await Promise.all(tenants.map((t) => reg.listAssignments(t.id)));
                const deploymentIds = new Set(assignmentLists.flat().map((a) => a.deploymentId).filter(Boolean));
                jsonResponse(res, 200, deployments.filter((d) => deploymentIds.has(d.id)));
                return;
            }
            jsonResponse(res, 200, deployments);
            return;
        }
        if (req.method === "GET" && id) {
            const d = await reg.getDeployment(id);
            if (!d) { jsonResponse(res, 404, { error: "Not found" }); return; }
            if (!isAdmin(principal)) {
                const scopedWorkspaceId = getPrincipalWorkspaceId(principal);
                const tenants = await reg.listTenants(scopedWorkspaceId);
                let hasAccess = false;
                for (const t of tenants) {
                    const assignments = await reg.listAssignments(t.id);
                    if (assignments.some((a) => a.deploymentId === id)) { hasAccess = true; break; }
                }
                if (!hasAccess) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            }
            jsonResponse(res, 200, d);
            return;
        }
        if (req.method === "POST" && !id) {
            const data = JSON.parse(body || "{}");
            const workspaceId = data.workspaceId != null ? String(data.workspaceId) : "";
            if (!canWrite(principal, workspaceId)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
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
            const existing = await reg.getDeployment(id);
            if (!existing) { jsonResponse(res, 404, { error: "Not found" }); return; }
            if (!canWrite(principal, existing.workspaceId)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
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
            const existing = await reg.getDeployment(id);
            if (!existing) { jsonResponse(res, 404, { error: "Not found" }); return; }
            if (!canWrite(principal, existing.workspaceId)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            const ok = await reg.deleteDeployment(id);
            if (!ok) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            res.writeHead(204, CORS_HEADERS);
            res.end();
            return;
        }
    }

    // assignments — operador puede CRUD en tenants de su workspace (conexiones, relay al agente)
    if (entity === "assignments") {
        const q = parseUrl(req).searchParams;
        if (q.has("clientId")) {
            jsonResponse(res, 400, {
                error: "Legacy query param not supported",
                detail: "Use workspaceId or tenantId instead of clientId",
            });
            return;
        }
        const queryWorkspaceId = q.get("workspaceId");
        const queryTenantId = q.get("tenantId");
        const workspaceIdParam = isAdmin(principal) ? queryWorkspaceId : (getPrincipalWorkspaceId(principal) || null);
        if (req.method === "GET" && !id) {
            if (queryTenantId) {
                if (!isAdmin(principal)) {
                    const tenant = await reg.getTenant(queryTenantId);
                    if (!tenant || !canRead(principal, tenant.workspaceId)) {
                        jsonResponse(res, 403, { error: "Forbidden" });
                        return;
                    }
                }
                jsonResponse(res, 200, await reg.listAssignments(queryTenantId));
                return;
            }
            if (workspaceIdParam) {
                const tenants = await reg.listTenants(workspaceIdParam);
                const assignmentLists = await Promise.all(tenants.map((t) => reg.listAssignments(t.id)));
                const flat = assignmentLists.flat();
                jsonResponse(res, 200, flat);
                return;
            }
            jsonResponse(res, 200, await reg.listAssignments(null));
            return;
        }
        if (req.method === "POST" && !id) {
            const data = JSON.parse(body || "{}");
            const tenantId = data.tenantId != null ? String(data.tenantId) : "";
            const tenant = await reg.getTenant(tenantId);
            if (!tenant) { jsonResponse(res, 404, { error: "Not found", detail: "Tenant not found" }); return; }
            if (!canWrite(principal, tenant.workspaceId)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            const created = await reg.createAssignment(data);
            if (!created) { jsonResponse(res, 409, { error: "Already exists" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 201, created);
            return;
        }
        if (req.method === "PATCH" && id && id2) {
            const tenant = await reg.getTenant(id);
            if (!tenant) { jsonResponse(res, 404, { error: "Not found" }); return; }
            if (!canWrite(principal, tenant.workspaceId)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
            const data = JSON.parse(body || "{}");
            const updated = await reg.updateAssignment(id, id2, data);
            if (!updated) { jsonResponse(res, 404, { error: "Not found" }); return; }
            await reg.saveRegistry();
            jsonResponse(res, 200, updated);
            return;
        }
        if (req.method === "DELETE" && id && id2) {
            const tenant = await reg.getTenant(id);
            if (!tenant) { jsonResponse(res, 404, { error: "Not found" }); return; }
            if (!canWrite(principal, tenant.workspaceId)) { jsonResponse(res, 403, { error: "Forbidden" }); return; }
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
        getWorkspaceById: reg.getWorkspace,
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

    // GET /api/me — current principal (role, workspaceId, subject) for UI
    if (req.method === "GET" && path === "/api/me") {
        if (!principal) {
            jsonResponse(res, 401, { error: "Unauthorized" });
            return;
        }
        jsonResponse(res, 200, {
            role: principal.role,
            workspaceId: principal.workspaceId ?? null,
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
        const requestedWorkspaceId = q.get("workspaceId");
        const scopedWorkspaceId = getPrincipalWorkspaceId(principal);
        if (!isAdmin(principal) && requestedWorkspaceId && requestedWorkspaceId !== scopedWorkspaceId) {
            jsonResponse(res, 403, { error: "Forbidden" });
            return;
        }
        const data = await reg.listRuns({
            workspaceId: isAdmin(principal) ? requestedWorkspaceId : (scopedWorkspaceId || null),
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
        if (!canRead(principal, run.workspaceId || null)) {
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
