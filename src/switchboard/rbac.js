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
import { createHmac, timingSafeEqual } from "crypto";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const VALID_ROLES = new Set(["admin-tecnico", "operador-cuenta", "lector-cuenta"]);
const DEFAULT_KEYS_PATH = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "data",
    "core-keys.json"
);

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

function isLikelyJwt(token) {
    if (typeof token !== "string") return false;
    return token.split(".").length === 3;
}

function parseJsonBase64Url(value) {
    try {
        const decoded = Buffer.from(value, "base64url").toString("utf8");
        return JSON.parse(decoded);
    } catch (_) {
        return null;
    }
}

function verifyJwtHs256(token, secret) {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = parseJsonBase64Url(encodedHeader);
    const payload = parseJsonBase64Url(encodedPayload);
    if (!header || !payload) return null;
    if (header.alg !== "HS256") return null;

    const expected = createHmac("sha256", secret)
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest();
    let provided;
    try {
        provided = Buffer.from(encodedSignature, "base64url");
    } catch (_) {
        return null;
    }
    if (provided.length !== expected.length) return null;
    if (!timingSafeEqual(provided, expected)) return null;
    return payload;
}

function hasAudience(claim, expectedAudience) {
    if (!expectedAudience) return true;
    if (Array.isArray(claim)) return claim.includes(expectedAudience);
    if (typeof claim === "string") return claim === expectedAudience;
    return false;
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

function authenticateJwtPrincipal(token) {
    if (!isJwtEnabled()) return null;
    if (!isLikelyJwt(token)) return null;
    const secret = getJwtSecret();
    if (!secret) return null;

    const payload = verifyJwtHs256(token, secret);
    if (!payload) return null;

    const now = Math.floor(Date.now() / 1000);
    const exp = Number(payload?.exp);
    if (!Number.isFinite(exp) || exp <= now) return null;
    if (payload?.nbf != null) {
        const nbf = Number(payload.nbf);
        if (Number.isFinite(nbf) && nbf > now) return null;
    }

    const issuer = getJwtIssuer();
    if (issuer && payload?.iss !== issuer) return null;
    if (!hasAudience(payload?.aud, getJwtAudience())) return null;

    const role = resolveRoleFromClaims(payload);
    if (!role) return null;

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
    };
}

export function isRbacEnabled() {
    return parseBool(process.env.SWITCHBOARD_RBAC_ENABLED, false);
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {{ getWorkspaceById?: (workspaceId: string) => Promise<any> }} [deps]
 * @returns {Promise<{ enabled: boolean, principal: null | { role: string, workspaceId: string | null, subject: string | null, keyId: string | null, keyLabel: string | null, allowedWorkspaces?: string[] }, reason?: string }>}
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
            },
        };
    }

    const key = getBearerKey(req);
    if (!key) return { enabled: true, principal: null, reason: "missing-key" };

    const jwtPrincipal = authenticateJwtPrincipal(key);
    if (jwtPrincipal) {
        return {
            enabled: true,
            principal: jwtPrincipal,
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
