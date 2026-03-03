/**
 * core HTTP API: GET /health, GET /api/config, POST /core/runtime/chat.
 * Config from CONFIG_DIR (+ optional .core-config).
 * Optional auth via CORE_API_KEY/API_KEY and/or .core-config/core.json deployToken.
 */

import "dotenv/config";
import http from "http";
import { handleAgentChat } from "./routes/agent-chat.js";
import { loadAgentConfig, listAgentIds } from "../agent-config/loader.js";
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
import * as reg from "../switchboard/registry.js";
import { forwardChat } from "../switchboard/proxy.js";
import { authenticateRequest, canRead, canUseChat, getPrincipalWorkspaceId, isAdmin } from "../switchboard/rbac.js";
import { randomUUID } from "crypto";

const PORT = Number(process.env.PORT) || 3000;
const CONFIG_DIR = process.env.CONFIG_DIR || "/app/config";
const REGISTRY_PATH = process.env.REGISTRY_PATH || "./src/switchboard/data/registry.json";

reg.setRegistryPath(REGISTRY_PATH);
try {
    await reg.loadRegistry();
} catch (error) {
    console.warn("Core: failed to load registry, continuing with empty state.", error?.message || String(error));
}

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, X-API-Key, X-Core-Deploy-Token, Authorization",
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

    const auth = await authenticateRequest(req, {
        getWorkspaceById: reg.getWorkspace,
    });
    const principal = auth.principal;

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

    // --- NEW /core/* ROUTES ---
    if (path.startsWith("/core/")) {
        // GET /core/health
        if (req.method === "GET" && path === "/core/health") {
            jsonResponse(res, 200, { ok: true });
            return;
        }

        // POST /core/runtime/chat
        if (req.method === "POST" && path === "/core/runtime/chat") {
            const body = await parseBody(req);
            await handleAgentChat(req, res, {
                body,
                CORS_HEADERS,
                jsonResponse: (res, code, data, h) => jsonResponse(res, code, data, h),
            });
            return;
        }

        // GET /core/me
        if (req.method === "GET" && path === "/core/me") {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            jsonResponse(res, 200, {
                role: principal.role,
                workspaceId: principal.accountId ?? null,
                subject: principal.subject ?? null,
            });
            return;
        }

        // GET /core/workspaces
        if (req.method === "GET" && path === "/core/workspaces") {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            const workspaces = await reg.listWorkspaces();
            if (isAdmin(principal)) {
                jsonResponse(res, 200, workspaces);
                return;
            }
            const allowed = workspaces.filter(w => canRead(principal, w.id));
            jsonResponse(res, 200, allowed);
            return;
        }

        // GET /core/workspaces/:workspaceId/tenants
        const tenantsMatch = path.match(/^\/core\/workspaces\/([^/]+)\/tenants$/);
        if (req.method === "GET" && tenantsMatch) {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            const workspaceId = tenantsMatch[1];
            if (!canRead(principal, workspaceId)) {
                jsonResponse(res, 403, { error: "forbidden" });
                return;
            }
            const tenants = await reg.listTenants(workspaceId);
            jsonResponse(res, 200, tenants);
            return;
        }

        // GET /core/tenants/:tenantId/agents
        const agentsMatch = path.match(/^\/core\/tenants\/([^/]+)\/agents$/);
        if (req.method === "GET" && agentsMatch) {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            const tenantId = agentsMatch[1];
            const tenant = await reg.getTenant(tenantId);
            if (!tenant) {
                jsonResponse(res, 404, { error: "not_found" });
                return;
            }
            if (!canRead(principal, tenant.accountId)) {
                jsonResponse(res, 403, { error: "forbidden" });
                return;
            }
            const assignments = await reg.listAssignments(tenantId);
            const agentIds = assignments.map(a => a.agentId);
            const allAgents = await reg.listAgents();
            const tenantAgents = allAgents.filter(a => agentIds.includes(a.id));
            jsonResponse(res, 200, tenantAgents);
            return;
        }

        // GET /core/runs
        if (req.method === "GET" && path === "/core/runs") {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            const q = url.searchParams;
            const requestedWorkspaceId = q.get("workspaceId");
            const scopedWorkspaceId = getPrincipalWorkspaceId(principal);
            if (!isAdmin(principal) && requestedWorkspaceId && requestedWorkspaceId !== scopedWorkspaceId) {
                jsonResponse(res, 403, { error: "forbidden" });
                return;
            }
            const data = await reg.listRuns({
                workspaceId: isAdmin(principal) ? requestedWorkspaceId : (scopedWorkspaceId || null),
                tenantId: q.get("tenantId"),
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

        // GET /core/runs/:runId
        const runMatch = path.match(/^\/core\/runs\/([^/]+)$/);
        if (req.method === "GET" && runMatch) {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            const runId = runMatch[1];
            const run = await reg.getRun(runId);
            if (!run) {
                jsonResponse(res, 404, { error: "not_found" });
                return;
            }
            if (!canRead(principal, run.workspaceId)) {
                jsonResponse(res, 403, { error: "forbidden" });
                return;
            }
            jsonResponse(res, 200, run);
            return;
        }

        // POST /core/relay/chat
        if (req.method === "POST" && path === "/core/relay/chat") {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            let runId = null;
            try {
                let parsed;
                try {
                    parsed = JSON.parse(await parseBody(req) || "{}");
                } catch {
                    jsonResponse(res, 400, { error: "bad_request", message: "Invalid JSON" });
                    return;
                }

                runId = `run_${randomUUID().replace(/-/g, "")}`;
                const { workspaceId, tenantId, agentId, messages, metadata } = parsed;

                if (!workspaceId || !tenantId || !agentId) {
                    jsonResponse(res, 400, { error: "bad_request", message: "Missing workspaceId, tenantId or agentId" });
                    return;
                }

                if (!canUseChat(principal, workspaceId)) {
                    jsonResponse(res, 403, { error: "forbidden", message: "Insufficient permissions for this workspace" });
                    return;
                }

                await reg.createRun({
                    runId,
                    workspaceId,
                    tenantId,
                    agentId,
                    deploymentId: null,
                    status: "running",
                    startedAt: new Date().toISOString(),
                    finishedAt: null,
                    durationMs: null,
                    provider: null,
                    usage: null,
                    error: null,
                });
                await reg.saveRegistry();

                async function failAndRespond(statusCode, errorCode, message) {
                    try {
                        await reg.finalizeRunError(runId, {
                            finishedAt: new Date().toISOString(),
                            error: { code: errorCode, message, statusCode },
                        });
                        await reg.saveRegistry();
                    } catch (_) {}
                    jsonResponse(res, statusCode, { error: errorCode, message, trace: { runId } }, { "X-Run-Id": runId });
                }

                const assignment = await reg.findAssignment(tenantId, agentId);
                if (!assignment) {
                    await failAndRespond(404, "not_found", "Assignment not found");
                    return;
                }

                const deployment = await reg.findDeployment(assignment.deploymentId);
                if (!deployment) {
                    await failAndRespond(404, "not_found", "Deployment not found");
                    return;
                }

                await reg.updateRun(runId, { deploymentId: deployment.id });
                await reg.saveRegistry();

                const forwardBody = JSON.stringify({
                    agentId,
                    tenantId,
                    messages,
                    metadata
                });

                const result = await forwardChat(deployment.baseUrl, forwardBody);
                if (result.error) {
                    await failAndRespond(result.statusCode || 502, "downstream_error", result.error);
                    return;
                }

                await reg.finalizeRunSuccess(runId, {
                    provider: result.provider ?? null,
                    usage: result.usage ?? null,
                    finishedAt: new Date().toISOString(),
                });
                await reg.saveRegistry();

                const responseData = result.parsed ?? JSON.parse(result.body);
                if (!responseData.trace) responseData.trace = {};
                responseData.trace.runId = runId;

                jsonResponse(res, result.statusCode, responseData, { "X-Run-Id": runId });
                return;
            } catch (error) {
                if (runId) {
                    try {
                        await reg.finalizeRunError(runId, {
                            finishedAt: new Date().toISOString(),
                            error: { code: "internal_error", message: error?.message, statusCode: 500 },
                        });
                        await reg.saveRegistry();
                    } catch (_) {}
                }
                jsonResponse(res, 500, { error: "internal_error", message: error?.message }, runId ? { "X-Run-Id": runId } : {});
                return;
            }
        }
    }

    jsonResponse(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
    console.log(`core API on port ${PORT} (CONFIG_DIR=${CONFIG_DIR})`);
});
