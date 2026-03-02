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
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const DEFAULT_KEYS_PATH = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
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

function normalizeCoreKeyEntry(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const key = typeof entry.key === "string" ? entry.key.trim() : "";
    const accountId = typeof entry.accountId === "string" ? entry.accountId.trim() : "";
    const label = typeof entry.label === "string" ? entry.label.trim() : null;
    const keyId = typeof entry.id === "string" ? entry.id.trim() : null;
    const status = typeof entry.status === "string" ? entry.status.trim().toLowerCase() : "active";
    if (!key || !accountId) return null;
    if (status && status !== "active") return null;
    return {
        key,
        accountId,
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

function isGoogleAuthEnabled() {
    return parseBool(process.env.SWITCHBOARD_AUTH_GOOGLE_ENABLED, false);
}

function getGoogleClientId() {
    const explicit = typeof process.env.SWITCHBOARD_AUTH_GOOGLE_CLIENT_ID === "string"
        ? process.env.SWITCHBOARD_AUTH_GOOGLE_CLIENT_ID.trim()
        : "";
    if (explicit) return explicit;
    const fallback = typeof process.env.GOOGLE_CLIENT_ID === "string"
        ? process.env.GOOGLE_CLIENT_ID.trim()
        : "";
    if (fallback) return fallback;
    const coreFallback = typeof process.env.CORE_AUTH_GOOGLE_CLIENT_ID === "string"
        ? process.env.CORE_AUTH_GOOGLE_CLIENT_ID.trim()
        : "";
    return coreFallback || "";
}

function getGoogleAdminEmails() {
    return parseCsv(process.env.SWITCHBOARD_ADMIN_EMAILS).map((item) => normalizeEmail(item));
}

/**
 * Parses SWITCHBOARD_GOOGLE_OPERADORES (e.g. "alvaro@inspiro:gateway,other@corp:other-acc").
 * Returns array of { email, accountId }.
 */
function getGoogleOperadores() {
    const raw = typeof process.env.SWITCHBOARD_GOOGLE_OPERADORES === "string"
        ? process.env.SWITCHBOARD_GOOGLE_OPERADORES.trim()
        : "";
    if (!raw) return [];
    const entries = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const result = [];
    for (const entry of entries) {
        const idx = entry.indexOf(":");
        if (idx <= 0) continue;
        const email = normalizeEmail(entry.slice(0, idx));
        const accountId = entry.slice(idx + 1).trim();
        if (email && accountId) result.push({ email, accountId });
    }
    return result;
}

function getGoogleAllowedDomains() {
    return parseCsv(process.env.SWITCHBOARD_AUTH_GOOGLE_ALLOWED_HOSTED_DOMAINS).map((item) => item.toLowerCase());
}

function isJwtEnabled() {
    return parseBool(process.env.SWITCHBOARD_AUTH_JWT_ENABLED, false);
}

function getJwtSecret() {
    const configured = typeof process.env.SWITCHBOARD_AUTH_JWT_SECRET === "string"
        ? process.env.SWITCHBOARD_AUTH_JWT_SECRET.trim()
        : "";
    if (configured) return configured;
    const fallback = typeof process.env.CORE_AUTH_JWT_SECRET === "string"
        ? process.env.CORE_AUTH_JWT_SECRET.trim()
        : "";
    return fallback || "";
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

function looksLikeGoogleJwt(token) {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = parseJsonBase64Url(parts[1]);
    const issuer = typeof payload?.iss === "string" ? payload.iss.trim() : "";
    return GOOGLE_ISSUERS.has(issuer);
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

async function fetchGoogleTokenInfo(idToken) {
    const query = new URLSearchParams({ id_token: idToken }).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?${query}`, {
            signal: controller.signal,
        });
        if (!response.ok) return null;
        return await response.json();
    } catch (_) {
        return null;
    } finally {
        clearTimeout(timeout);
    }
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

async function authenticateGooglePrincipal(token) {
    if (!isGoogleAuthEnabled()) return null;
    if (!isLikelyJwt(token) || !looksLikeGoogleJwt(token)) return null;

    const clientId = getGoogleClientId();
    if (!clientId) return null;

    const claims = await fetchGoogleTokenInfo(token);
    if (!claims || typeof claims !== "object") return null;

    const aud = typeof claims.aud === "string" ? claims.aud.trim() : "";
    if (!aud || aud !== clientId) return null;

    const issuer = typeof claims.iss === "string" ? claims.iss.trim() : "";
    if (!GOOGLE_ISSUERS.has(issuer)) return null;

    const exp = Number(claims.exp);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(exp) || exp <= now) return null;

    const email = normalizeEmail(claims.email);
    const emailVerified = claims.email_verified === true || String(claims.email_verified).toLowerCase() === "true";
    if (!email || !emailVerified) return null;

    const allowedDomains = getGoogleAllowedDomains();
    if (allowedDomains.length > 0) {
        const hostedDomain = typeof claims.hd === "string" ? claims.hd.trim().toLowerCase() : "";
        if (!hostedDomain || !allowedDomains.includes(hostedDomain)) return null;
    }

    const adminEmails = getGoogleAdminEmails();
    if (adminEmails.includes(email)) {
        return {
            role: "admin-tecnico",
            accountId: null,
            subject: email,
            keyId: null,
            keyLabel: "google-user",
            allowedAccounts: [],
        };
    }

    const operadores = getGoogleOperadores();
    const operadorEntry = operadores.find((o) => o.email === email);
    if (operadorEntry) {
        return {
            role: "operador-cuenta",
            accountId: operadorEntry.accountId,
            subject: email,
            keyId: null,
            keyLabel: "google-user",
            allowedAccounts: [operadorEntry.accountId],
        };
    }

    return null;
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

    const allowedAccounts = normalizeAllowedAccounts(payload?.allowedAccounts);
    const defaultAccountId = typeof payload?.defaultAccountId === "string"
        ? payload.defaultAccountId.trim()
        : "";
    const scopedAccountId = defaultAccountId || allowedAccounts[0] || null;

    return {
        role,
        accountId: role === "admin-tecnico" ? null : scopedAccountId,
        subject:
            (typeof payload?.sub === "string" && payload.sub) ||
            (typeof payload?.email === "string" && payload.email) ||
            "jwt-user",
        keyId: null,
        keyLabel: "jwt-user",
        allowedAccounts,
    };
}

export function isRbacEnabled() {
    return parseBool(process.env.SWITCHBOARD_RBAC_ENABLED, false);
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {{ getAccountById?: (accountId: string) => Promise<any> }} [deps]
 * @returns {Promise<{ enabled: boolean, principal: null | { role: string, accountId: string | null, subject: string | null, keyId: string | null, keyLabel: string | null }, reason?: string }>}
 */
export async function authenticateRequest(req, deps = {}) {
    if (!isRbacEnabled()) {
        return {
            enabled: false,
            principal: {
                role: "admin-tecnico",
                accountId: null,
                subject: "rbac-disabled",
                keyId: null,
                keyLabel: "rbac-disabled",
            },
        };
    }

    const key = getBearerKey(req);
    if (!key) return { enabled: true, principal: null, reason: "missing-key" };

    const googlePrincipal = await authenticateGooglePrincipal(key);
    if (googlePrincipal) {
        return {
            enabled: true,
            principal: googlePrincipal,
        };
    }

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

    const getAccountById = typeof deps.getAccountById === "function" ? deps.getAccountById : null;
    if (!getAccountById) return { enabled: true, principal: null, reason: "account-resolver-missing" };

    const account = await getAccountById(match.accountId);
    if (!account || typeof account !== "object") {
        return { enabled: true, principal: null, reason: "account-not-found" };
    }

    const accountStatus = typeof account.status === "string" ? account.status.trim().toLowerCase() : "active";
    if (accountStatus && accountStatus !== "active") {
        return { enabled: true, principal: null, reason: "account-inactive" };
    }

    const role = typeof account.role === "string" ? account.role.trim() : "";
    if (!VALID_ROLES.has(role)) {
        return { enabled: true, principal: null, reason: "invalid-account-role" };
    }

    return {
        enabled: true,
        principal: {
            role,
            accountId: typeof account.id === "string" ? account.id : match.accountId,
            subject: match.label || match.keyId || match.accountId,
            keyId: match.keyId || null,
            keyLabel: match.label || null,
        },
    };
}

export function isAdmin(principal) {
    return principal?.role === "admin-tecnico";
}

export function getPrincipalAccountId(principal) {
    if (!principal) return null;
    return principal.accountId || null;
}

function getPrincipalAllowedAccounts(principal) {
    if (!principal || !Array.isArray(principal.allowedAccounts)) return [];
    return principal.allowedAccounts.filter((item) => typeof item === "string" && item.trim());
}

export function canRead(principal, accountId) {
    if (!principal) return false;
    if (isAdmin(principal)) return true;
    const allowedAccounts = getPrincipalAllowedAccounts(principal);
    if (allowedAccounts.length > 0) {
        if (!accountId) return true;
        return allowedAccounts.includes(accountId);
    }
    const scoped = getPrincipalAccountId(principal);
    if (!accountId) return Boolean(scoped);
    return scoped === accountId;
}

export function canWrite(principal, accountId) {
    if (!principal) return false;
    if (isAdmin(principal)) return true;
    if (principal.role !== "operador-cuenta") return false;
    const allowedAccounts = getPrincipalAllowedAccounts(principal);
    if (allowedAccounts.length > 0) {
        if (!accountId) return true;
        return allowedAccounts.includes(accountId);
    }
    const scoped = getPrincipalAccountId(principal);
    if (!accountId) return Boolean(scoped);
    return scoped === accountId;
}

export function canUseChat(principal, accountId) {
    if (!principal) return false;
    if (isAdmin(principal)) return true;
    if (principal.role !== "operador-cuenta") return false;
    const allowedAccounts = getPrincipalAllowedAccounts(principal);
    if (allowedAccounts.length > 0) {
        if (!accountId) return true;
        return allowedAccounts.includes(accountId);
    }
    const scoped = getPrincipalAccountId(principal);
    if (!accountId) return Boolean(scoped);
    return scoped === accountId;
}
