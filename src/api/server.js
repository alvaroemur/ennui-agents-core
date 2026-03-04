/**
 * core HTTP API: GET /health, GET /api/config, POST /core/runtime/chat.
 * Config from CONFIG_DIR (+ optional .core-config).
 * Auth via switchboard RBAC (core keys and/or user JWT).
 */

import "dotenv/config";
import http from "http";
import { handleAgentChat } from "./routes/agent-chat.js";
import { loadAgentConfig, listAgentIds } from "../agent-config/loader.js";
import {
    AuthHttpError,
    buildGoogleAuthUrl,
    getGoogleOAuthPublicConfig,
    loginWithGoogle,
} from "../auth/google-oauth.js";
import {
    listSubaccountConfigs,
    getFingerprintPrefix,
    loadCoreConfig,
    toPublicCoreConfig,
    toPublicSubaccountConfig,
} from "../core-config/index.js";
import * as reg from "../switchboard/registry.js";
import { forwardChat } from "../switchboard/proxy.js";
import { authenticateRequest, canRead, canUseChat, canWrite, getPrincipalWorkspaceId, isAdmin } from "../switchboard/rbac.js";
import { callLLM } from "../llm-proxy/index.js";
import { getDefaultLlmApiKeys, hasAnyLlmApiKey, normalizeCustomLlmApiKeys } from "../llm/api-keys.js";
import { composeSystemPromptWithSignature, createExecutionFingerprint } from "../tracing/signature.js";
import { randomUUID } from "crypto";

const PORT = Number(process.env.PORT) || 3000;
const CONFIG_DIR = process.env.CONFIG_DIR || "/app/config";
const REGISTRY_PATH = process.env.REGISTRY_PATH || "./src/switchboard/data/registry.json";
const ASSIGNMENT_HEALTHCHECK_TIMEOUT_MS = Number(process.env.CORE_ASSIGNMENT_HEALTHCHECK_TIMEOUT_MS || 5000);
const VALID_AUTH_USER_ROLES = new Set(["admin-tecnico", "operador-cuenta", "lector-cuenta"]);
const VALID_AUTH_USER_STATUSES = new Set(["active", "inactive"]);

reg.setRegistryPath(REGISTRY_PATH);
try {
    await reg.loadRegistry();
} catch (error) {
    console.warn("Core: failed to load registry, continuing with empty state.", error?.message || String(error));
}

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, X-API-Key, X-Core-Deploy-Token, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
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

function getRelayApiKeys(preferredProvider = null) {
    return getDefaultLlmApiKeys(preferredProvider);
}

function parseCsv(value) {
    if (typeof value !== "string") return [];
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function normalizeEmail(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function getMasterEmails() {
    const configured = parseCsv(process.env.CORE_AUTH_MASTER_EMAILS).map((item) => normalizeEmail(item));
    if (configured.length > 0) return configured;
    return [normalizeEmail("alvaro.e.mur@gmail.com")];
}

function hasRelayLlmPathConfigured(apiKeys) {
    const hasProxy = Boolean(String(process.env.LLM_PROXY_URL || "").trim());
    if (hasProxy) return true;
    return hasAnyLlmApiKey(apiKeys);
}

function getRequestBearerToken(req) {
    const value = req?.headers?.authorization;
    if (typeof value === "string" && value.trim()) return value.trim();
    return null;
}

function getRequestApiKeyHeader(req) {
    const value = req?.headers?.["x-api-key"];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) return value[0].trim();
    return null;
}

function getActorFromPrincipal(principal) {
    const isJwtPrincipal = Array.isArray(principal?.allowedWorkspaces) || principal?.keyLabel === "jwt-user";
    return {
        type: isJwtPrincipal ? "user" : "service",
        subject: principal?.subject ?? "unknown",
        role: principal?.role ?? null,
    };
}

function getPrincipalEmail(principal) {
    const direct = normalizeEmail(principal?.email);
    if (direct) return direct;
    const subject = normalizeEmail(principal?.subject);
    if (subject.includes("@")) return subject;
    return null;
}

function isMasterPrincipal(principal) {
    const email = getPrincipalEmail(principal);
    if (!email) return false;
    return getMasterEmails().includes(email);
}

function normalizeAllowedAccounts(value) {
    if (!Array.isArray(value)) return null;
    const unique = new Set();
    for (const item of value) {
        if (typeof item !== "string") continue;
        const normalized = item.trim();
        if (!normalized) continue;
        unique.add(normalized);
    }
    return Array.from(unique);
}

function sanitizeAuthUserInput(input, options = {}) {
    const { partial = false, emailOverride = null, actor = null } = options;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return { error: "Body must be a JSON object." };
    }
    const payload = {};

    const email = normalizeEmail(emailOverride || input.email);
    if (!partial || email) {
        if (!email) return { error: "Missing or invalid email." };
        payload.email = email;
    }

    if (!partial || Object.prototype.hasOwnProperty.call(input, "role")) {
        const role = typeof input.role === "string" ? input.role.trim() : "";
        if (!VALID_AUTH_USER_ROLES.has(role)) {
            return { error: "Invalid role. Expected admin-tecnico, operador-cuenta or lector-cuenta." };
        }
        payload.role = role;
    }

    if (Object.prototype.hasOwnProperty.call(input, "status")) {
        const status = typeof input.status === "string" ? input.status.trim().toLowerCase() : "";
        if (!VALID_AUTH_USER_STATUSES.has(status)) {
            return { error: "Invalid status. Expected active or inactive." };
        }
        payload.status = status;
    }

    if (Object.prototype.hasOwnProperty.call(input, "allowedAccounts") || Object.prototype.hasOwnProperty.call(input, "allowedWorkspaces")) {
        const allowedAccounts = normalizeAllowedAccounts(input.allowedAccounts ?? input.allowedWorkspaces);
        if (!allowedAccounts) return { error: "allowedAccounts must be an array of workspace ids." };
        payload.allowedAccounts = allowedAccounts;
    }

    if (Object.prototype.hasOwnProperty.call(input, "defaultAccountId") || Object.prototype.hasOwnProperty.call(input, "defaultWorkspaceId")) {
        const rawDefault = input.defaultAccountId ?? input.defaultWorkspaceId;
        const defaultAccountId = typeof rawDefault === "string" ? rawDefault.trim() : "";
        payload.defaultAccountId = defaultAccountId || null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "googleSub")) {
        const googleSub = typeof input.googleSub === "string" ? input.googleSub.trim() : "";
        payload.googleSub = googleSub || "";
    }

    if (!partial) payload.createdBy = actor;
    payload.updatedBy = actor;
    return { payload };
}

function getTenantWorkspaceId(tenant) {
    if (!tenant || typeof tenant !== "object") return null;
    if (typeof tenant.workspaceId === "string" && tenant.workspaceId.trim()) return tenant.workspaceId.trim();
    if (typeof tenant.accountId === "string" && tenant.accountId.trim()) return tenant.accountId.trim();
    return null;
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function normalizeChatPath(input) {
    if (typeof input !== "string") return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith("/")) return null;
    if (trimmed.includes("?") || trimmed.includes("#")) return null;
    return trimmed;
}

function normalizeEndpointUrl(input) {
    if (typeof input !== "string") return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
        return parsed.toString();
    } catch (_) {
        return null;
    }
}

function toSlug(value) {
    if (typeof value !== "string") return "";
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-");
}

async function checkDeploymentHealth(baseUrl) {
    let url;
    try {
        const base = String(baseUrl || "").trim();
        url = new URL("/health", base.endsWith("/") ? base : `${base}/`).toString();
    } catch (_) {
        return {
            ok: false,
            url: String(baseUrl || ""),
            statusCode: null,
            latencyMs: 0,
            error: "invalid_base_url",
        };
    }
    const controller = new AbortController();
    const startedAt = Date.now();
    const timeout = setTimeout(() => controller.abort(), ASSIGNMENT_HEALTHCHECK_TIMEOUT_MS);
    try {
        const response = await fetch(url, { method: "GET", signal: controller.signal });
        clearTimeout(timeout);
        return {
            ok: response.ok,
            url,
            statusCode: response.status,
            latencyMs: Date.now() - startedAt,
        };
    } catch (error) {
        clearTimeout(timeout);
        return {
            ok: false,
            url,
            statusCode: null,
            latencyMs: Date.now() - startedAt,
            error: error?.name === "AbortError" ? "timeout" : (error?.message || String(error)),
        };
    }
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
                resolveAccessProfile: async (email) => {
                    const authUser = await reg.getAuthUserByEmail(email);
                    if (!authUser) return null;
                    return {
                        status: authUser.status,
                        role: authUser.role,
                        allowedAccounts: authUser.allowedAccounts,
                        defaultAccountId: authUser.defaultAccountId,
                    };
                },
            });
            const sessionEmail = normalizeEmail(result?.user?.email);
            if (sessionEmail) {
                const existing = await reg.getAuthUserByEmail(sessionEmail);
                if (existing) {
                    await reg.updateAuthUser(sessionEmail, {
                        googleSub: result?.user?.sub || "",
                        updatedBy: "google-login",
                    });
                    await reg.saveRegistry();
                }
            }
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
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            const body = await parseBody(req);
            let parsedBody;
            try {
                parsedBody = JSON.parse(body || "{}");
            } catch {
                jsonResponse(res, 400, { error: "bad_request", message: "Invalid JSON" });
                return;
            }
            const tenantId = typeof parsedBody?.tenantId === "string" ? parsedBody.tenantId.trim() : "";
            if (!tenantId) {
                jsonResponse(res, 400, { error: "bad_request", message: "Missing tenantId" });
                return;
            }
            const tenant = await reg.getTenant(tenantId);
            if (!tenant) {
                jsonResponse(res, 404, { error: "not_found", message: "Tenant not found" });
                return;
            }
            const tenantWorkspaceId =
                (typeof tenant.workspaceId === "string" && tenant.workspaceId.trim()) ||
                (typeof tenant.accountId === "string" && tenant.accountId.trim()) ||
                null;
            if (!canUseChat(principal, tenantWorkspaceId)) {
                jsonResponse(res, 403, { error: "forbidden" });
                return;
            }
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
                workspaceId: principal.workspaceId ?? null,
                subject: principal.subject ?? null,
                email: getPrincipalEmail(principal),
                allowedWorkspaces: Array.isArray(principal.allowedWorkspaces) ? principal.allowedWorkspaces : undefined,
            });
            return;
        }

        // GET /core/auth/users
        if (req.method === "GET" && path === "/core/auth/users") {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            if (!isMasterPrincipal(principal)) {
                jsonResponse(res, 403, { error: "forbidden", message: "Master account required." });
                return;
            }
            const items = await reg.listAuthUsers();
            jsonResponse(res, 200, { items });
            return;
        }

        // POST /core/auth/users
        if (req.method === "POST" && path === "/core/auth/users") {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            if (!isMasterPrincipal(principal)) {
                jsonResponse(res, 403, { error: "forbidden", message: "Master account required." });
                return;
            }
            let payload;
            try {
                payload = JSON.parse(await parseBody(req) || "{}");
            } catch {
                jsonResponse(res, 400, { error: "bad_request", message: "Invalid JSON body." });
                return;
            }
            const actor = getPrincipalEmail(principal) || principal.subject || "master";
            const sanitized = sanitizeAuthUserInput(payload, { partial: false, actor });
            if (sanitized.error) {
                jsonResponse(res, 400, { error: "bad_request", message: sanitized.error });
                return;
            }
            const created = await reg.createAuthUser(sanitized.payload);
            if (!created) {
                jsonResponse(res, 409, { error: "conflict", message: "Auth user already exists or payload is invalid." });
                return;
            }
            await reg.saveRegistry();
            jsonResponse(res, 201, { item: created });
            return;
        }

        // PATCH /core/auth/users/:email
        const authUsersMatch = path.match(/^\/core\/auth\/users\/([^/]+)$/);
        if (req.method === "PATCH" && authUsersMatch) {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            if (!isMasterPrincipal(principal)) {
                jsonResponse(res, 403, { error: "forbidden", message: "Master account required." });
                return;
            }
            let payload;
            try {
                payload = JSON.parse(await parseBody(req) || "{}");
            } catch {
                jsonResponse(res, 400, { error: "bad_request", message: "Invalid JSON body." });
                return;
            }
            let targetEmail = "";
            try {
                targetEmail = normalizeEmail(decodeURIComponent(authUsersMatch[1] || ""));
            } catch (_) {
                targetEmail = "";
            }
            if (!targetEmail) {
                jsonResponse(res, 400, { error: "bad_request", message: "Invalid email path parameter." });
                return;
            }
            const actor = getPrincipalEmail(principal) || principal.subject || "master";
            const sanitized = sanitizeAuthUserInput(payload, { partial: true, emailOverride: targetEmail, actor });
            if (sanitized.error) {
                jsonResponse(res, 400, { error: "bad_request", message: sanitized.error });
                return;
            }
            const updated = await reg.updateAuthUser(targetEmail, sanitized.payload);
            if (!updated) {
                jsonResponse(res, 404, { error: "not_found", message: "Auth user not found." });
                return;
            }
            await reg.saveRegistry();
            jsonResponse(res, 200, { item: updated });
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
        if (req.method === "POST" && tenantsMatch) {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            const workspaceId = tenantsMatch[1];
            if (!canWrite(principal, workspaceId)) {
                jsonResponse(res, 403, { error: "forbidden" });
                return;
            }
            const workspace = await reg.getWorkspace(workspaceId);
            if (!workspace) {
                jsonResponse(res, 404, { error: "not_found", message: "Workspace not found" });
                return;
            }
            let payload;
            try {
                payload = JSON.parse(await parseBody(req) || "{}");
            } catch {
                jsonResponse(res, 400, { error: "bad_request", message: "Invalid JSON" });
                return;
            }
            const name = typeof payload?.name === "string" ? payload.name.trim() : "";
            if (!name) {
                jsonResponse(res, 400, { error: "bad_request", message: "Missing tenant name" });
                return;
            }
            const rawSlug = typeof payload?.slug === "string" ? payload.slug.trim() : "";
            const normalizedSlug = rawSlug ? toSlug(rawSlug) : "";
            if (rawSlug && !normalizedSlug) {
                jsonResponse(res, 400, { error: "bad_request", message: "Invalid tenant slug" });
                return;
            }
            const metadata = payload?.metadata;
            if (metadata !== undefined && !isPlainObject(metadata)) {
                jsonResponse(res, 400, { error: "bad_request", message: "metadata must be an object" });
                return;
            }

            const baseId = normalizedSlug || toSlug(name) || `tenant-${randomUUID().slice(0, 8)}`;
            let tenantId = baseId;
            let collisionCounter = 0;
            while (await reg.getTenant(tenantId)) {
                collisionCounter += 1;
                if (collisionCounter > 10) {
                    tenantId = `tenant-${randomUUID().slice(0, 8)}`;
                } else {
                    tenantId = `${baseId}-${collisionCounter}`;
                }
            }

            const tenantPayload = {
                id: tenantId,
                workspaceId,
                name,
                slug: normalizedSlug || tenantId,
                status: "active",
            };
            if (metadata !== undefined) tenantPayload.metadata = metadata;

            const created = await reg.createTenant(tenantPayload);
            if (!created) {
                jsonResponse(res, 409, { error: "conflict", message: "Tenant already exists" });
                return;
            }
            await reg.saveRegistry();
            jsonResponse(res, 201, created);
            return;
        }

        // POST /core/workspaces/:workspaceId/agent-endpoints
        const agentEndpointsMatch = path.match(/^\/core\/workspaces\/([^/]+)\/agent-endpoints$/);
        if (req.method === "POST" && agentEndpointsMatch) {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            const workspaceId = agentEndpointsMatch[1];
            if (!canWrite(principal, workspaceId)) {
                jsonResponse(res, 403, { error: "forbidden" });
                return;
            }
            const workspace = await reg.getWorkspace(workspaceId);
            if (!workspace) {
                jsonResponse(res, 404, { error: "not_found", message: "Workspace not found" });
                return;
            }
            let payload;
            try {
                payload = JSON.parse(await parseBody(req) || "{}");
            } catch {
                jsonResponse(res, 400, { error: "bad_request", message: "Invalid JSON" });
                return;
            }

            const agentId =
                (typeof payload?.agentId === "string" && payload.agentId.trim()) ||
                (typeof payload?.id === "string" && payload.id.trim()) ||
                "";
            if (!agentId) {
                jsonResponse(res, 400, { error: "bad_request", message: "Missing agentId or id" });
                return;
            }
            if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(agentId)) {
                jsonResponse(res, 400, { error: "bad_request", message: "Invalid agent id format" });
                return;
            }
            const baseUrl = normalizeBaseUrl(payload?.baseUrl);
            if (!baseUrl) {
                jsonResponse(res, 400, { error: "bad_request", message: "Invalid baseUrl" });
                return;
            }

            const name = typeof payload?.name === "string" && payload.name.trim() ? payload.name.trim() : agentId;
            const type = typeof payload?.type === "string" && payload.type.trim() ? payload.type.trim() : "chat";
            const versionTag =
                typeof payload?.versionTag === "string" && payload.versionTag.trim()
                    ? payload.versionTag.trim()
                    : "1.0.0";
            const metadata = payload?.metadata;
            if (metadata !== undefined && !isPlainObject(metadata)) {
                jsonResponse(res, 400, { error: "bad_request", message: "metadata must be an object" });
                return;
            }

            let wasCreated = false;
            let agent = await reg.getAgent(agentId);
            if (!agent) {
                const agentPayload = { id: agentId, name, type };
                if (metadata !== undefined) agentPayload.metadata = metadata;
                agent = await reg.createAgent(agentPayload);
                if (!agent) {
                    jsonResponse(res, 409, { error: "conflict", message: "Agent already exists" });
                    return;
                }
                wasCreated = true;
            } else {
                const agentPatch = {};
                if (typeof payload?.name === "string") agentPatch.name = name;
                if (typeof payload?.type === "string") agentPatch.type = type;
                if (metadata !== undefined) agentPatch.metadata = metadata;
                if (Object.keys(agentPatch).length > 0) {
                    agent = await reg.updateAgent(agentId, agentPatch);
                }
            }

            const deploymentId = `${agentId}-deploy`;
            const deploymentPayload = {
                id: deploymentId,
                workspaceId,
                name,
                baseUrl,
                versionTag,
            };
            if (metadata !== undefined) deploymentPayload.metadata = metadata;

            let deployment = await reg.getDeployment(deploymentId);
            if (!deployment) {
                deployment = await reg.createDeployment(deploymentPayload);
                if (!deployment) {
                    jsonResponse(res, 409, { error: "conflict", message: "Deployment already exists" });
                    return;
                }
                wasCreated = true;
            } else {
                const deploymentWorkspaceId =
                    (typeof deployment.workspaceId === "string" && deployment.workspaceId.trim()) || null;
                if (deploymentWorkspaceId && deploymentWorkspaceId !== workspaceId) {
                    jsonResponse(res, 409, { error: "conflict", message: "Deployment belongs to another workspace" });
                    return;
                }
                deployment = await reg.updateDeployment(deploymentId, deploymentPayload);
            }

            await reg.saveRegistry();
            jsonResponse(res, wasCreated ? 201 : 200, {
                id: agentId,
                agentId,
                deploymentId,
                baseUrl: deployment.baseUrl,
                name: agent.name ?? name,
                type: agent.type ?? type,
                versionTag: deployment.versionTag ?? versionTag,
                metadata: deployment.metadata ?? agent.metadata ?? null,
                agent,
                deployment,
            });
            return;
        }

        // GET|POST /core/workspaces/:workspaceId/assignments
        const assignmentsMatch = path.match(/^\/core\/workspaces\/([^/]+)\/assignments$/);
        if (req.method === "GET" && assignmentsMatch) {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            const workspaceId = assignmentsMatch[1];
            if (!canRead(principal, workspaceId)) {
                jsonResponse(res, 403, { error: "forbidden" });
                return;
            }
            const workspace = await reg.getWorkspace(workspaceId);
            if (!workspace) {
                jsonResponse(res, 404, { error: "not_found", message: "Workspace not found" });
                return;
            }
            const requestedTenantId = typeof url.searchParams.get("tenantId") === "string"
                ? url.searchParams.get("tenantId").trim()
                : "";
            const requestedAgentId = typeof url.searchParams.get("agentId") === "string"
                ? url.searchParams.get("agentId").trim()
                : "";

            let tenantIds = [];
            if (requestedTenantId) {
                const tenant = await reg.getTenant(requestedTenantId);
                if (!tenant || getTenantWorkspaceId(tenant) !== workspaceId) {
                    jsonResponse(res, 404, { error: "not_found", message: "Tenant not found in workspace" });
                    return;
                }
                tenantIds = [requestedTenantId];
            } else {
                const tenants = await reg.listTenants(workspaceId);
                tenantIds = tenants.map((tenant) => tenant.id);
            }

            const assignmentsByTenant = await Promise.all(tenantIds.map((tenantId) => reg.listAssignments(tenantId)));
            let assignments = assignmentsByTenant.flat();
            if (requestedAgentId) {
                assignments = assignments.filter((assignment) => assignment?.agentId === requestedAgentId);
            }
            jsonResponse(res, 200, assignments);
            return;
        }
        if (req.method === "POST" && assignmentsMatch) {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            const workspaceId = assignmentsMatch[1];
            if (!canWrite(principal, workspaceId)) {
                jsonResponse(res, 403, { error: "forbidden" });
                return;
            }
            const workspace = await reg.getWorkspace(workspaceId);
            if (!workspace) {
                jsonResponse(res, 404, { error: "not_found", message: "Workspace not found" });
                return;
            }
            let payload;
            try {
                payload = JSON.parse(await parseBody(req) || "{}");
            } catch {
                jsonResponse(res, 400, { error: "bad_request", message: "Invalid JSON" });
                return;
            }
            const tenantId = typeof payload?.tenantId === "string" ? payload.tenantId.trim() : "";
            const agentId = typeof payload?.agentId === "string" ? payload.agentId.trim() : "";
            const deploymentId = typeof payload?.deploymentId === "string" ? payload.deploymentId.trim() : "";
            if (!tenantId || !agentId || !deploymentId) {
                jsonResponse(res, 400, { error: "bad_request", message: "Missing tenantId, agentId or deploymentId" });
                return;
            }
            const tenant = await reg.getTenant(tenantId);
            if (!tenant || getTenantWorkspaceId(tenant) !== workspaceId) {
                jsonResponse(res, 404, { error: "not_found", message: "Tenant not found in workspace" });
                return;
            }
            const agent = await reg.getAgent(agentId);
            if (!agent) {
                jsonResponse(res, 404, { error: "not_found", message: "Agent not found" });
                return;
            }
            const deployment = await reg.findDeployment(deploymentId);
            if (!deployment) {
                jsonResponse(res, 404, { error: "not_found", message: "Deployment not found" });
                return;
            }
            const deploymentWorkspaceId =
                (typeof deployment.workspaceId === "string" && deployment.workspaceId.trim()) || null;
            if (deploymentWorkspaceId && deploymentWorkspaceId !== workspaceId) {
                jsonResponse(res, 400, { error: "bad_request", message: "Deployment outside workspace" });
                return;
            }
            const assignmentPayload = {
                tenantId,
                agentId,
                deploymentId,
            };
            if (Object.prototype.hasOwnProperty.call(payload, "bindingName")) {
                const bindingName = typeof payload.bindingName === "string" ? payload.bindingName.trim() : "";
                if (!bindingName) {
                    jsonResponse(res, 400, { error: "bad_request", message: "bindingName must be a non-empty string" });
                    return;
                }
                assignmentPayload.bindingName = bindingName;
            }
            if (Object.prototype.hasOwnProperty.call(payload, "contract")) {
                if (!isPlainObject(payload.contract)) {
                    jsonResponse(res, 400, { error: "bad_request", message: "contract must be an object" });
                    return;
                }
                assignmentPayload.contract = payload.contract;
            }
            if (Object.prototype.hasOwnProperty.call(payload, "chatPath")) {
                const chatPath = normalizeChatPath(payload.chatPath);
                if (!chatPath) {
                    jsonResponse(res, 400, {
                        error: "bad_request",
                        message: "chatPath must be a non-empty path starting with / and without query or fragment",
                    });
                    return;
                }
                assignmentPayload.chatPath = chatPath;
            }
            if (Object.prototype.hasOwnProperty.call(payload, "endpointUrl")) {
                const endpointUrl = normalizeEndpointUrl(payload.endpointUrl);
                if (!endpointUrl) {
                    jsonResponse(res, 400, {
                        error: "bad_request",
                        message: "endpointUrl must be an absolute http/https URL",
                    });
                    return;
                }
                assignmentPayload.endpointUrl = endpointUrl;
            }

            const created = await reg.createAssignment(assignmentPayload);
            if (!created) {
                jsonResponse(res, 409, { error: "conflict", message: "Assignment already exists" });
                return;
            }
            await reg.saveRegistry();
            jsonResponse(res, 201, created);
            return;
        }

        // PATCH /core/workspaces/:workspaceId/assignments/:tenantId/:agentId
        const assignmentConfigMatch = path.match(/^\/core\/workspaces\/([^/]+)\/assignments\/([^/]+)\/([^/]+)$/);
        if (req.method === "PATCH" && assignmentConfigMatch) {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            const workspaceId = assignmentConfigMatch[1];
            const tenantId = assignmentConfigMatch[2];
            const agentId = assignmentConfigMatch[3];
            if (!canWrite(principal, workspaceId)) {
                jsonResponse(res, 403, { error: "forbidden" });
                return;
            }
            const workspace = await reg.getWorkspace(workspaceId);
            if (!workspace) {
                jsonResponse(res, 404, { error: "not_found", message: "Workspace not found" });
                return;
            }
            const tenant = await reg.getTenant(tenantId);
            if (!tenant || getTenantWorkspaceId(tenant) !== workspaceId) {
                jsonResponse(res, 404, { error: "not_found", message: "Tenant not found in workspace" });
                return;
            }
            const assignment = await reg.findAssignment(tenantId, agentId);
            if (!assignment) {
                jsonResponse(res, 404, { error: "not_found", message: "Assignment not found" });
                return;
            }
            let payload;
            try {
                payload = JSON.parse(await parseBody(req) || "{}");
            } catch {
                jsonResponse(res, 400, { error: "bad_request", message: "Invalid JSON" });
                return;
            }

            const updates = {};
            if (Object.prototype.hasOwnProperty.call(payload, "deploymentId")) {
                const deploymentId = typeof payload.deploymentId === "string" ? payload.deploymentId.trim() : "";
                if (!deploymentId) {
                    jsonResponse(res, 400, { error: "bad_request", message: "deploymentId must be a non-empty string" });
                    return;
                }
                const deployment = await reg.findDeployment(deploymentId);
                if (!deployment) {
                    jsonResponse(res, 404, { error: "not_found", message: "Deployment not found" });
                    return;
                }
                const deploymentWorkspaceId =
                    (typeof deployment.workspaceId === "string" && deployment.workspaceId.trim()) || null;
                if (deploymentWorkspaceId && deploymentWorkspaceId !== workspaceId) {
                    jsonResponse(res, 400, { error: "bad_request", message: "Deployment outside workspace" });
                    return;
                }
                updates.deploymentId = deploymentId;
            }
            if (Object.prototype.hasOwnProperty.call(payload, "bindingName")) {
                if (payload.bindingName == null) {
                    updates.bindingName = null;
                } else {
                    const bindingName = typeof payload.bindingName === "string" ? payload.bindingName.trim() : "";
                    if (!bindingName) {
                        jsonResponse(res, 400, { error: "bad_request", message: "bindingName must be a non-empty string or null" });
                        return;
                    }
                    updates.bindingName = bindingName;
                }
            }
            if (Object.prototype.hasOwnProperty.call(payload, "contract")) {
                if (payload.contract == null) {
                    updates.contract = null;
                } else if (isPlainObject(payload.contract)) {
                    updates.contract = payload.contract;
                } else {
                    jsonResponse(res, 400, { error: "bad_request", message: "contract must be an object or null" });
                    return;
                }
            }
            if (Object.prototype.hasOwnProperty.call(payload, "chatPath")) {
                if (payload.chatPath == null) {
                    updates.chatPath = null;
                } else {
                    const chatPath = normalizeChatPath(payload.chatPath);
                    if (!chatPath) {
                        jsonResponse(res, 400, {
                            error: "bad_request",
                            message: "chatPath must be a non-empty path starting with / and without query or fragment",
                        });
                        return;
                    }
                    updates.chatPath = chatPath;
                }
            }
            if (Object.prototype.hasOwnProperty.call(payload, "endpointUrl")) {
                if (payload.endpointUrl == null) {
                    updates.endpointUrl = null;
                } else {
                    const endpointUrl = normalizeEndpointUrl(payload.endpointUrl);
                    if (!endpointUrl) {
                        jsonResponse(res, 400, {
                            error: "bad_request",
                            message: "endpointUrl must be an absolute http/https URL or null",
                        });
                        return;
                    }
                    updates.endpointUrl = endpointUrl;
                }
            }
            if (Object.keys(updates).length === 0) {
                jsonResponse(res, 400, { error: "bad_request", message: "No valid fields to update" });
                return;
            }
            const updated = await reg.updateAssignment(tenantId, agentId, updates);
            if (!updated) {
                jsonResponse(res, 404, { error: "not_found", message: "Assignment not found" });
                return;
            }
            await reg.saveRegistry();
            jsonResponse(res, 200, updated);
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
            const tenantWorkspaceId =
                (typeof tenant.workspaceId === "string" && tenant.workspaceId.trim()) ||
                (typeof tenant.accountId === "string" && tenant.accountId.trim()) ||
                null;
            if (!canRead(principal, tenantWorkspaceId)) {
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

        // POST /core/workspaces/:workspaceId/assignments/promote
        const promoteMatch = path.match(/^\/core\/workspaces\/([^/]+)\/assignments\/promote$/);
        if (req.method === "POST" && promoteMatch) {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            const workspaceId = promoteMatch[1];
            if (!canWrite(principal, workspaceId)) {
                jsonResponse(res, 403, { error: "forbidden" });
                return;
            }
            let payload;
            try {
                payload = JSON.parse(await parseBody(req) || "{}");
            } catch {
                jsonResponse(res, 400, { error: "bad_request", message: "Invalid JSON" });
                return;
            }
            const tenantId = typeof payload?.tenantId === "string" ? payload.tenantId.trim() : "";
            const agentId = typeof payload?.agentId === "string" ? payload.agentId.trim() : "";
            const toDeploymentId = typeof payload?.toDeploymentId === "string" ? payload.toDeploymentId.trim() : "";
            const reason = typeof payload?.reason === "string" ? payload.reason.trim() : "";
            if (!tenantId || !agentId || !toDeploymentId) {
                jsonResponse(res, 400, { error: "bad_request", message: "Missing tenantId, agentId or toDeploymentId" });
                return;
            }

            const tenant = await reg.getTenant(tenantId);
            const tenantWorkspaceId = getTenantWorkspaceId(tenant);
            if (!tenant || tenantWorkspaceId !== workspaceId) {
                jsonResponse(res, 404, { error: "not_found", message: "Tenant not found in workspace" });
                return;
            }
            const assignment = await reg.findAssignment(tenantId, agentId);
            if (!assignment) {
                jsonResponse(res, 404, { error: "not_found", message: "Assignment not found" });
                return;
            }
            const toDeployment = await reg.findDeployment(toDeploymentId);
            if (!toDeployment) {
                jsonResponse(res, 404, { error: "not_found", message: "Target deployment not found" });
                return;
            }
            const deploymentWorkspaceId =
                (typeof toDeployment.workspaceId === "string" && toDeployment.workspaceId.trim()) || null;
            if (deploymentWorkspaceId && deploymentWorkspaceId !== workspaceId) {
                jsonResponse(res, 400, { error: "bad_request", message: "Target deployment outside workspace" });
                return;
            }

            const fromDeploymentId =
                (typeof assignment.deploymentId === "string" && assignment.deploymentId.trim()) || null;
            const healthCheck = await checkDeploymentHealth(toDeployment.baseUrl);
            if (!healthCheck.ok) {
                const failureEvent = await reg.createAssignmentAuditEvent({
                    eventId: `evt_${randomUUID().replace(/-/g, "")}`,
                    workspaceId,
                    tenantId,
                    agentId,
                    fromDeploymentId,
                    toDeploymentId,
                    action: "promote",
                    actor: getActorFromPrincipal(principal),
                    reason: reason || null,
                    result: "failure",
                    healthCheck,
                    timestamp: new Date().toISOString(),
                });
                await reg.saveRegistry();
                jsonResponse(res, 502, {
                    error: "health_check_failed",
                    message: "Target deployment health-check failed",
                    healthCheck,
                    eventId: failureEvent?.eventId || null,
                });
                return;
            }

            const updatedAssignment = await reg.updateAssignment(tenantId, agentId, { deploymentId: toDeploymentId });
            if (!updatedAssignment) {
                jsonResponse(res, 404, { error: "not_found", message: "Assignment not found" });
                return;
            }
            const event = await reg.createAssignmentAuditEvent({
                eventId: `evt_${randomUUID().replace(/-/g, "")}`,
                workspaceId,
                tenantId,
                agentId,
                fromDeploymentId,
                toDeploymentId,
                action: "promote",
                actor: getActorFromPrincipal(principal),
                reason: reason || null,
                result: "success",
                healthCheck,
                timestamp: new Date().toISOString(),
            });
            await reg.saveRegistry();
            jsonResponse(res, 200, {
                assignment: updatedAssignment,
                auditEvent: event,
            });
            return;
        }

        // POST /core/workspaces/:workspaceId/assignments/rollback
        const rollbackMatch = path.match(/^\/core\/workspaces\/([^/]+)\/assignments\/rollback$/);
        if (req.method === "POST" && rollbackMatch) {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            const workspaceId = rollbackMatch[1];
            if (!canWrite(principal, workspaceId)) {
                jsonResponse(res, 403, { error: "forbidden" });
                return;
            }
            let payload;
            try {
                payload = JSON.parse(await parseBody(req) || "{}");
            } catch {
                jsonResponse(res, 400, { error: "bad_request", message: "Invalid JSON" });
                return;
            }
            const tenantId = typeof payload?.tenantId === "string" ? payload.tenantId.trim() : "";
            const agentId = typeof payload?.agentId === "string" ? payload.agentId.trim() : "";
            const reason = typeof payload?.reason === "string" ? payload.reason.trim() : "";
            if (!tenantId || !agentId) {
                jsonResponse(res, 400, { error: "bad_request", message: "Missing tenantId or agentId" });
                return;
            }
            const tenant = await reg.getTenant(tenantId);
            const tenantWorkspaceId = getTenantWorkspaceId(tenant);
            if (!tenant || tenantWorkspaceId !== workspaceId) {
                jsonResponse(res, 404, { error: "not_found", message: "Tenant not found in workspace" });
                return;
            }
            const assignment = await reg.findAssignment(tenantId, agentId);
            if (!assignment) {
                jsonResponse(res, 404, { error: "not_found", message: "Assignment not found" });
                return;
            }

            const history = await reg.listAssignmentAudit({
                workspaceId,
                tenantId,
                agentId,
                result: "success",
                limit: 1,
                offset: 0,
            });
            const lastSuccess = Array.isArray(history?.items) ? history.items[0] : null;
            const rollbackTargetId =
                (typeof lastSuccess?.fromDeploymentId === "string" && lastSuccess.fromDeploymentId.trim()) || null;
            if (!rollbackTargetId) {
                jsonResponse(res, 409, { error: "conflict", message: "No rollback target available" });
                return;
            }
            const rollbackTarget = await reg.findDeployment(rollbackTargetId);
            if (!rollbackTarget) {
                jsonResponse(res, 404, { error: "not_found", message: "Rollback target deployment not found" });
                return;
            }

            const healthCheck = await checkDeploymentHealth(rollbackTarget.baseUrl);
            if (!healthCheck.ok) {
                const failureEvent = await reg.createAssignmentAuditEvent({
                    eventId: `evt_${randomUUID().replace(/-/g, "")}`,
                    workspaceId,
                    tenantId,
                    agentId,
                    fromDeploymentId: assignment.deploymentId || null,
                    toDeploymentId: rollbackTargetId,
                    action: "rollback",
                    actor: getActorFromPrincipal(principal),
                    reason: reason || null,
                    result: "failure",
                    healthCheck,
                    timestamp: new Date().toISOString(),
                });
                await reg.saveRegistry();
                jsonResponse(res, 502, {
                    error: "health_check_failed",
                    message: "Rollback deployment health-check failed",
                    healthCheck,
                    eventId: failureEvent?.eventId || null,
                });
                return;
            }

            const updatedAssignment = await reg.updateAssignment(tenantId, agentId, {
                deploymentId: rollbackTargetId,
            });
            if (!updatedAssignment) {
                jsonResponse(res, 404, { error: "not_found", message: "Assignment not found" });
                return;
            }

            const event = await reg.createAssignmentAuditEvent({
                eventId: `evt_${randomUUID().replace(/-/g, "")}`,
                workspaceId,
                tenantId,
                agentId,
                fromDeploymentId: assignment.deploymentId || null,
                toDeploymentId: rollbackTargetId,
                action: "rollback",
                actor: getActorFromPrincipal(principal),
                reason: reason || null,
                result: "success",
                healthCheck,
                timestamp: new Date().toISOString(),
            });
            await reg.saveRegistry();
            jsonResponse(res, 200, {
                assignment: updatedAssignment,
                auditEvent: event,
            });
            return;
        }

        // GET /core/workspaces/:workspaceId/assignments/audit
        const auditMatch = path.match(/^\/core\/workspaces\/([^/]+)\/assignments\/audit$/);
        if (req.method === "GET" && auditMatch) {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            const workspaceId = auditMatch[1];
            if (!canRead(principal, workspaceId)) {
                jsonResponse(res, 403, { error: "forbidden" });
                return;
            }
            const q = url.searchParams;
            const data = await reg.listAssignmentAudit({
                workspaceId,
                tenantId: q.get("tenantId"),
                agentId: q.get("agentId"),
                action: q.get("action"),
                result: q.get("result"),
                from: q.get("from"),
                to: q.get("to"),
                limit: q.get("limit"),
                offset: q.get("offset"),
            });
            jsonResponse(res, 200, data);
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
            if (!isAdmin(principal) && requestedWorkspaceId && !canRead(principal, requestedWorkspaceId)) {
                jsonResponse(res, 403, { error: "forbidden" });
                return;
            }
            const data = await reg.listRuns({
                workspaceId: isAdmin(principal)
                    ? requestedWorkspaceId
                    : (requestedWorkspaceId || scopedWorkspaceId || null),
                tenantId: q.get("tenantId"),
                agentId: q.get("agentId"),
                deploymentId: q.get("deploymentId"),
                status: q.get("status"),
                provider: q.get("provider"),
                from: q.get("from"),
                to: q.get("to"),
                updatedAfter: q.get("updatedAfter"),
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
            run.timeline = await reg.getRunTimeline(runId);
            jsonResponse(res, 200, run);
            return;
        }

        // GET /core/trace/events
        const eventsMatch = path.match(/^\/core\/trace\/events\/?$/);
        if (req.method === "GET" && eventsMatch) {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            const q = url.searchParams;
            const requestedWorkspaceId = q.get("workspaceId");
            const scopedWorkspaceId = getPrincipalWorkspaceId(principal);
            if (!isAdmin(principal) && requestedWorkspaceId && !canRead(principal, requestedWorkspaceId)) {
                jsonResponse(res, 403, { error: "forbidden" });
                return;
            }
            const data = await reg.listTraceEvents({
                workspaceId: isAdmin(principal)
                    ? requestedWorkspaceId
                    : (requestedWorkspaceId || scopedWorkspaceId || null),
                tenantId: q.get("tenantId"),
                agentId: q.get("agentId"),
                cursor: q.get("cursor"),
                limit: q.get("limit"),
            });
            jsonResponse(res, 200, data, { "Cache-Control": "no-store" });
            return;
        }

        // GET /core/trace/active-connections
        const activeConnectionsMatch = path.match(/^\/core\/trace\/active-connections\/?$/);
        if (req.method === "GET" && activeConnectionsMatch) {
            if (!principal) {
                jsonResponse(res, 401, { error: "unauthorized" });
                return;
            }
            const q = url.searchParams;
            const requestedWorkspaceId = q.get("workspaceId");
            const scopedWorkspaceId = getPrincipalWorkspaceId(principal);
            if (!isAdmin(principal) && requestedWorkspaceId && !canRead(principal, requestedWorkspaceId)) {
                jsonResponse(res, 403, { error: "forbidden" });
                return;
            }
            const data = await reg.listActiveConnections({
                workspaceId: isAdmin(principal)
                    ? requestedWorkspaceId
                    : (requestedWorkspaceId || scopedWorkspaceId || null),
                tenantId: q.get("tenantId"),
                agentId: q.get("agentId"),
                limit: q.get("limit"),
            });
            jsonResponse(res, 200, data);
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
                const tenant = await reg.getTenant(tenantId);
                const tenantWorkspaceId = getTenantWorkspaceId(tenant);
                if (!tenant || tenantWorkspaceId !== workspaceId) {
                    jsonResponse(res, 404, { error: "not_found", message: "Tenant not found in workspace" });
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
                    workspaceId,
                    agentId,
                    tenantId,
                    messages,
                    metadata,
                    responseMode: "v2",
                    contract: assignment?.contract,
                });
                const forwardHeaders = {};
                const bearer = getRequestBearerToken(req);
                const xApiKey = getRequestApiKeyHeader(req);
                if (bearer) forwardHeaders.Authorization = bearer;
                if (xApiKey) forwardHeaders["X-API-Key"] = xApiKey;
                const requestId = typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"].trim() : "";
                if (requestId) forwardHeaders["X-Request-Id"] = requestId;

                const chatEndpointUrl = await reg.resolveChatEndpointUrl(tenantId, agentId);
                if (!chatEndpointUrl) {
                    await failAndRespond(502, "downstream_error", "Invalid deployment chat endpoint");
                    return;
                }
                const result = await forwardChat(chatEndpointUrl, forwardBody, forwardHeaders);
                if (result.error) {
                    await failAndRespond(result.statusCode || 502, "downstream_error", result.error);
                    return;
                }

                const responseData = result.parsed ?? JSON.parse(result.body || "{}");
                const runtimeReply = typeof responseData?.reply === "string" ? responseData.reply.trim() : "";
                if (runtimeReply) {
                    const defaultApiKeys = getRelayApiKeys(parsed?.preferredProvider);
                    const relayApiKeys =
                        normalizeCustomLlmApiKeys(parsed?.apiKeys, parsed?.preferredProvider) ||
                        normalizeCustomLlmApiKeys(
                            {
                                apiKey: parsed?.apiKey,
                                preferredProvider: parsed?.preferredProvider,
                            },
                            parsed?.preferredProvider,
                        );
                    const effectiveApiKeys = relayApiKeys || defaultApiKeys;

                    if (!hasRelayLlmPathConfigured(effectiveApiKeys)) {
                        await failAndRespond(503, "llm_unavailable", "LLM provider/API keys not configured");
                        return;
                    }
                    let coreConfig = null;
                    try {
                        coreConfig = await loadCoreConfig();
                    } catch (_) {
                        coreConfig = null;
                    }
                    const fingerprintPrefix = getFingerprintPrefix(coreConfig);
                    const fingerprint = createExecutionFingerprint({
                        agentId,
                        preferredProvider: effectiveApiKeys.preferredProvider,
                        messageCount: Array.isArray(messages) ? messages.length : 0,
                        requestId,
                        fingerprintPrefix,
                    });
                    const env = String(process.env.CORE_ENV || process.env.NODE_ENV || "dev").trim() || "dev";
                    const signatureResult = composeSystemPromptWithSignature({
                        basePrompt: runtimeReply,
                        customSignature: parsed?.signature,
                        apiKeys: effectiveApiKeys,
                        env,
                        runId,
                        fingerprint,
                        agentLine: `CORE BFF RELAY · ${agentId}`,
                    });
                    const llmPayload = {
                        systemPrompt: signatureResult.systemPrompt,
                        contents: Array.isArray(messages) ? messages : [],
                        trace: {
                            runId,
                            env,
                            fingerprint,
                            fingerprintPrefix: fingerprintPrefix || undefined,
                            signatureSource: signatureResult.signatureSource,
                        },
                    };
                    if (relayApiKeys) {
                        llmPayload.apiKeys = relayApiKeys;
                    }
                    const llmResult = await callLLM(llmPayload);
                    if (!llmResult?.text) {
                        const errMsg =
                            llmResult?.data?.error?.message ||
                            llmResult?.data?.error ||
                            "LLM returned empty response";
                        await failAndRespond(502, "llm_error", String(errMsg));
                        return;
                    }
                    await reg.finalizeRunSuccess(runId, {
                        provider: llmResult.provider ?? null,
                        usage: llmResult.usage ?? null,
                        finishedAt: new Date().toISOString(),
                    });
                    await reg.saveRegistry();
                    jsonResponse(res, 200, {
                        text: llmResult.text,
                        provider: llmResult.provider ?? null,
                        usage: llmResult.usage ?? null,
                        trace: {
                            runId,
                            fingerprint,
                            agentRunId:
                                (typeof responseData?.trace?.agentRunId === "string" && responseData.trace.agentRunId) ||
                                null,
                        },
                    }, { "X-Run-Id": runId });
                    return;
                }

                // Legacy runtime compatibility: downstream still returns final text/provider/usage.
                await reg.finalizeRunSuccess(runId, {
                    provider: result.provider ?? null,
                    usage: result.usage ?? null,
                    finishedAt: new Date().toISOString(),
                });
                await reg.saveRegistry();

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
