/**
 * RBAC v2 for switchboard.
 *
 * Enabled with:
 * - SWITCHBOARD_RBAC_ENABLED=true
 * - SWITCHBOARD_CORE_KEYS='[{"key":"...","accountId":"inspiro-comercial"}]'
 * - or key file at SWITCHBOARD_KEYS_PATH (default: ../data/core-keys.json)
 *
 * In RBAC v2 a core-key only authenticates.
 * Role authorization comes from the account record in registry.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createLocalJWKSet, createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";

const VALID_ROLES = new Set(["admin-tecnico", "operador-cuenta", "lector-cuenta"]);
const DEFAULT_KEYS_PATH = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "data",
    "core-keys.json"
);
const textEncoder = new TextEncoder();
const remoteJwksCache = new Map();
const localJwksCache = new Map();

function parseBool(value, fallback = false) {
    if (value == null) return fallback;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return fallback;
    if (["1", "true", "yes", "on"].includes(raw)) return true;
    if (["0", "false", "no", "off"].includes(raw)) return false;
    return fallback;
}

function normalizeCoreKeyEntry(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const key = typeof entry.key === "string" ? entry.key.trim() : "";
    const workspaceId = typeof entry.workspaceId === "string" ? entry.workspaceId.trim() : (typeof entry.accountId === "string" ? entry.accountId.trim() : "");
    const label = typeof entry.label === "string" ? entry.label.trim() : null;
    const keyId = typeof entry.id === "string" ? entry.id.trim() : null;
    const status = typeof entry.status === "string" ? entry.status.trim().toLowerCase() : "active";
    if (!key || !workspaceId) return null;
    if (status && status !== "active") return null;
    return {
        key,
        workspaceId,
        label,
        keyId,
    };
}

function readKeysFromEnv() {
    const raw = String(process.env.SWITCHBOARD_CORE_KEYS || "").trim();
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map(normalizeCoreKeyEntry).filter(Boolean);
    } catch (_) {
        return [];
    }
}

function readKeysFromFile() {
    const configuredPath = String(process.env.SWITCHBOARD_KEYS_PATH || "").trim();
    const path = configuredPath ? resolve(configuredPath) : DEFAULT_KEYS_PATH;
    if (!existsSync(path)) return [];
    try {
        const raw = readFileSync(path, "utf8");
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.keys)
                ? parsed.keys
                : [];
        return list.map(normalizeCoreKeyEntry).filter(Boolean);
    } catch (_) {
        return [];
    }
}

function readAllCoreKeys() {
    return [...readKeysFromEnv(), ...readKeysFromFile()];
}

function getBearerKey(req) {
    const auth = req?.headers?.authorization;
    if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
        return auth.slice(7).trim();
    }
    const xApiKey = req?.headers?.["x-api-key"];
    if (typeof xApiKey === "string") return xApiKey.trim();
    if (Array.isArray(xApiKey) && typeof xApiKey[0] === "string") return xApiKey[0].trim();
    return "";
}

function isJwtEnabled() {
    return parseBool(process.env.SWITCHBOARD_AUTH_JWT_ENABLED, false);
}

function isJwtOnlyMode() {
    return parseBool(process.env.SWITCHBOARD_AUTH_JWT_ONLY, false);
}

function getJwtSecret() {
    const configured = typeof process.env.SWITCHBOARD_AUTH_JWT_SECRET === "string"
        ? process.env.SWITCHBOARD_AUTH_JWT_SECRET.trim()
        : "";
    return configured || "";
}

function getJwtIssuer() {
    const value = typeof process.env.SWITCHBOARD_AUTH_JWT_ISSUER === "string"
        ? process.env.SWITCHBOARD_AUTH_JWT_ISSUER.trim()
        : "";
    return value || null;
}

function getJwtAudience() {
    const value = typeof process.env.SWITCHBOARD_AUTH_JWT_AUDIENCE === "string"
        ? process.env.SWITCHBOARD_AUTH_JWT_AUDIENCE.trim()
        : "";
    return value || null;
}

function getJwtJwksRawConfig() {
    const directUrl = typeof process.env.SWITCHBOARD_AUTH_JWT_JWKS_URL === "string"
        ? process.env.SWITCHBOARD_AUTH_JWT_JWKS_URL.trim()
        : "";
    if (directUrl) return directUrl;
    const generic = typeof process.env.SWITCHBOARD_AUTH_JWT_JWKS === "string"
        ? process.env.SWITCHBOARD_AUTH_JWT_JWKS.trim()
        : "";
    return generic || "";
}

function looksLikeJson(raw) {
    if (!raw) return false;
    return raw.startsWith("{") || raw.startsWith("[");
}

function buildLocalJwksResolver(raw) {
    if (!raw) return null;
    const cacheKey = `json:${raw}`;
    if (localJwksCache.has(cacheKey)) return localJwksCache.get(cacheKey);
    try {
        const parsed = JSON.parse(raw);
        const jwks = Array.isArray(parsed) ? { keys: parsed } : parsed;
        if (!jwks || typeof jwks !== "object" || !Array.isArray(jwks.keys)) return null;
        const resolver = createLocalJWKSet(jwks);
        localJwksCache.set(cacheKey, resolver);
        return resolver;
    } catch (_) {
        return null;
    }
}

function buildRemoteJwksResolver(raw) {
    if (!raw) return null;
    let url;
    try {
        url = new URL(raw);
    } catch (_) {
        return null;
    }
    const cacheKey = `url:${url.toString()}`;
    if (remoteJwksCache.has(cacheKey)) return remoteJwksCache.get(cacheKey);
    const resolver = createRemoteJWKSet(url);
    remoteJwksCache.set(cacheKey, resolver);
    return resolver;
}

function getJwtJwksResolver() {
    const raw = getJwtJwksRawConfig();
    if (!raw) return null;
    if (looksLikeJson(raw)) {
        return buildLocalJwksResolver(raw);
    }
    return buildRemoteJwksResolver(raw);
}

function getJwtValidationOptions() {
    const issuer = getJwtIssuer();
    const audience = getJwtAudience();
    if (!issuer || !audience) return null;
    return { issuer, audience };
}

function isLikelyJwt(token) {
    if (typeof token !== "string") return false;
    return token.split(".").length === 3;
}

async function verifyJwtWithSecret(token, options) {
    const secret = getJwtSecret();
    if (!secret) return null;
    try {
        const { payload } = await jwtVerify(token, textEncoder.encode(secret), {
            issuer: options.issuer,
            audience: options.audience,
            algorithms: ["HS256"],
        });
        return payload;
    } catch (_) {
        return null;
    }
}

async function verifyJwtWithJwks(token, options) {
    const resolver = getJwtJwksResolver();
    if (!resolver) return null;
    try {
        const { payload } = await jwtVerify(token, resolver, {
            issuer: options.issuer,
            audience: options.audience,
        });
        return payload;
    } catch (_) {
        return null;
    }
}

function normalizeAllowedAccounts(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
}

function resolveRoleFromClaims(payload) {
    const directRole = typeof payload?.role === "string" ? payload.role.trim() : "";
    if (VALID_ROLES.has(directRole)) return directRole;
    if (Array.isArray(payload?.roles)) {
        for (const role of payload.roles) {
            const normalized = typeof role === "string" ? role.trim() : "";
            if (VALID_ROLES.has(normalized)) return normalized;
        }
    }
    return "";
}

function resolveEmailFromClaims(payload) {
    if (typeof payload?.email !== "string") return null;
    const normalized = payload.email.trim().toLowerCase();
    return normalized || null;
}

async function authenticateJwtPrincipal(token) {
    if (!isJwtEnabled()) return null;
    if (!isLikelyJwt(token)) return null;
    const options = getJwtValidationOptions();
    if (!options) return null;
    let alg = "";
    try {
        const header = decodeProtectedHeader(token);
        alg = typeof header?.alg === "string" ? header.alg : "";
    } catch (_) {
        return null;
    }

    let payload = null;
    if (alg === "HS256") {
        payload = await verifyJwtWithSecret(token, options);
        if (!payload) payload = await verifyJwtWithJwks(token, options);
    } else {
        payload = await verifyJwtWithJwks(token, options);
        if (!payload) payload = await verifyJwtWithSecret(token, options);
    }
    if (!payload) return null;

    const role = resolveRoleFromClaims(payload);
    if (!role) return null;
    const email = resolveEmailFromClaims(payload);

    const allowedWorkspaces = normalizeAllowedAccounts(payload?.allowedWorkspaces || payload?.allowedAccounts);
    const defaultWorkspaceId = typeof payload?.defaultWorkspaceId === "string"
        ? payload.defaultWorkspaceId.trim()
        : (typeof payload?.defaultAccountId === "string" ? payload.defaultAccountId.trim() : "");
    const scopedWorkspaceId = defaultWorkspaceId || allowedWorkspaces[0] || null;

    return {
        role,
        workspaceId: role === "admin-tecnico" ? null : scopedWorkspaceId,
        subject:
            (typeof payload?.sub === "string" && payload.sub) ||
            (typeof payload?.email === "string" && payload.email) ||
            "jwt-user",
        keyId: null,
        keyLabel: "jwt-user",
        allowedWorkspaces,
        email,
    };
}

export function isRbacEnabled() {
    return parseBool(process.env.SWITCHBOARD_RBAC_ENABLED, false);
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {{ getWorkspaceById?: (workspaceId: string) => Promise<any> }} [deps]
 * @returns {Promise<{ enabled: boolean, principal: null | { role: string, workspaceId: string | null, subject: string | null, keyId: string | null, keyLabel: string | null, email?: string | null, allowedWorkspaces?: string[] }, reason?: string }>}
 */
export async function authenticateRequest(req, deps = {}) {
    if (!isRbacEnabled()) {
        return {
            enabled: false,
            principal: {
                role: "admin-tecnico",
                workspaceId: null,
                subject: "rbac-disabled",
                keyId: null,
                keyLabel: "rbac-disabled",
                email: null,
            },
        };
    }

    const key = getBearerKey(req);
    if (!key) return { enabled: true, principal: null, reason: "missing-key" };

    const jwtPrincipal = await authenticateJwtPrincipal(key);
    if (jwtPrincipal) {
        return {
            enabled: true,
            principal: jwtPrincipal,
        };
    }

    if (isJwtOnlyMode()) {
        return {
            enabled: true,
            principal: null,
            reason: isJwtEnabled() ? "jwt-required" : "jwt-auth-disabled",
        };
    }

    const keys = readAllCoreKeys();
    const match = keys.find((entry) => entry.key === key);
    if (!match) return { enabled: true, principal: null, reason: "invalid-key" };

    const getWorkspaceById = typeof deps.getWorkspaceById === "function" ? deps.getWorkspaceById : null;
    if (!getWorkspaceById) return { enabled: true, principal: null, reason: "workspace-resolver-missing" };

    const workspace = await getWorkspaceById(match.workspaceId);
    if (!workspace || typeof workspace !== "object") {
        return { enabled: true, principal: null, reason: "workspace-not-found" };
    }

    const workspaceStatus = typeof workspace.status === "string" ? workspace.status.trim().toLowerCase() : "active";
    if (workspaceStatus && workspaceStatus !== "active") {
        return { enabled: true, principal: null, reason: "workspace-inactive" };
    }

    const role = typeof workspace.role === "string" ? workspace.role.trim() : "";
    if (!VALID_ROLES.has(role)) {
        return { enabled: true, principal: null, reason: "invalid-workspace-role" };
    }

    return {
        enabled: true,
        principal: {
            role,
            workspaceId: typeof workspace.id === "string" ? workspace.id : match.workspaceId,
            subject: match.label || match.keyId || match.workspaceId,
            keyId: match.keyId || null,
            keyLabel: match.label || null,
            email: null,
        },
    };
}

export function isAdmin(principal) {
    return principal?.role === "admin-tecnico";
}

export function getPrincipalWorkspaceId(principal) {
    if (!principal) return null;
    return principal.workspaceId || null;
}

function getPrincipalAllowedWorkspaces(principal) {
    if (!principal || !Array.isArray(principal.allowedWorkspaces)) return [];
    return principal.allowedWorkspaces.filter((item) => typeof item === "string" && item.trim());
}

export function canRead(principal, workspaceId) {
    if (!principal) return false;
    if (isAdmin(principal)) return true;
    const allowedWorkspaces = getPrincipalAllowedWorkspaces(principal);
    if (allowedWorkspaces.length > 0) {
        if (!workspaceId) return true;
        return allowedWorkspaces.includes(workspaceId);
    }
    const scoped = getPrincipalWorkspaceId(principal);
    if (!workspaceId) return Boolean(scoped);
    return scoped === workspaceId;
}

export function canWrite(principal, workspaceId) {
    if (!principal) return false;
    if (isAdmin(principal)) return true;
    if (principal.role !== "operador-cuenta") return false;
    const allowedWorkspaces = getPrincipalAllowedWorkspaces(principal);
    if (allowedWorkspaces.length > 0) {
        if (!workspaceId) return true;
        return allowedWorkspaces.includes(workspaceId);
    }
    const scoped = getPrincipalWorkspaceId(principal);
    if (!workspaceId) return Boolean(scoped);
    return scoped === workspaceId;
}

export function canUseChat(principal, workspaceId) {
    if (!principal) return false;
    if (isAdmin(principal)) return true;
    if (principal.role !== "operador-cuenta") return false;
    const allowedWorkspaces = getPrincipalAllowedWorkspaces(principal);
    if (allowedWorkspaces.length > 0) {
        if (!workspaceId) return true;
        return allowedWorkspaces.includes(workspaceId);
    }
    const scoped = getPrincipalWorkspaceId(principal);
    if (!workspaceId) return Boolean(scoped);
    return scoped === workspaceId;
}
