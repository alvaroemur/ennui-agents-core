import { createHmac } from "crypto";

const GOOGLE_AUTH_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const DEFAULT_GOOGLE_SCOPES = ["openid", "email", "profile"];
const DEFAULT_JWT_ISSUER = "core-auth";
const DEFAULT_JWT_AUDIENCE = "core-switchboard";
const DEFAULT_JWT_TTL_SEC = 3600;
const ADMIN_ROLE = "admin-tecnico";

function parseBool(value, fallback = false) {
    if (value == null) return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return fallback;
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
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

function toPositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function trimString(value) {
    return typeof value === "string" ? value.trim() : "";
}

export class AuthHttpError extends Error {
    constructor(statusCode, errorCode, message, detail = null) {
        super(message);
        this.name = "AuthHttpError";
        this.statusCode = statusCode;
        this.errorCode = errorCode;
        this.detail = detail;
    }
}

function getGoogleScopes() {
    const fromEnv = parseCsv(process.env.CORE_AUTH_GOOGLE_SCOPES);
    return fromEnv.length > 0 ? fromEnv : DEFAULT_GOOGLE_SCOPES;
}

function getGoogleClientId() {
    return trimString(process.env.CORE_AUTH_GOOGLE_CLIENT_ID);
}

function getGoogleClientSecret() {
    return trimString(process.env.CORE_AUTH_GOOGLE_CLIENT_SECRET);
}

function getGoogleRedirectUri() {
    return trimString(process.env.CORE_AUTH_GOOGLE_REDIRECT_URI);
}

function getJwtSecret() {
    return trimString(process.env.CORE_AUTH_JWT_SECRET);
}

function getJwtIssuer() {
    return trimString(process.env.CORE_AUTH_JWT_ISSUER) || DEFAULT_JWT_ISSUER;
}

function getJwtAudience() {
    return trimString(process.env.CORE_AUTH_JWT_AUDIENCE) || DEFAULT_JWT_AUDIENCE;
}

function getJwtTtlSec() {
    return toPositiveInt(process.env.CORE_AUTH_JWT_TTL_SEC, DEFAULT_JWT_TTL_SEC);
}

function isGoogleAuthEnabled() {
    return parseBool(process.env.CORE_AUTH_GOOGLE_ENABLED, false);
}

function getAdminEmails() {
    return parseCsv(process.env.CORE_AUTH_GOOGLE_ADMIN_EMAILS).map((item) => normalizeEmail(item));
}

function getAdminAllowedAccounts() {
    return parseCsv(process.env.CORE_AUTH_ADMIN_ALLOWED_ACCOUNTS);
}

function allowAnyAdminWhenNoList() {
    return parseBool(process.env.CORE_AUTH_GOOGLE_ALLOW_ANY_ADMIN, false);
}

function getAllowedHostedDomains() {
    return parseCsv(process.env.CORE_AUTH_GOOGLE_ALLOWED_HOSTED_DOMAINS).map((item) => item.toLowerCase());
}

function resolveRedirectUri(requestedRedirectUri) {
    const requested = trimString(requestedRedirectUri);
    if (requested) return requested;
    return getGoogleRedirectUri();
}

function requireGoogleEnabled() {
    if (!isGoogleAuthEnabled()) {
        throw new AuthHttpError(503, "google_auth_disabled", "Google OAuth is disabled.");
    }
}

function requireGoogleClientId() {
    const clientId = getGoogleClientId();
    if (!clientId) {
        throw new AuthHttpError(500, "auth_config_error", "Missing CORE_AUTH_GOOGLE_CLIENT_ID.");
    }
    return clientId;
}

function requireJwtSecret() {
    const secret = getJwtSecret();
    if (!secret) {
        throw new AuthHttpError(500, "auth_config_error", "Missing CORE_AUTH_JWT_SECRET.");
    }
    return secret;
}

function createBase64Url(input) {
    return Buffer.from(input).toString("base64url");
}

function signJwt(payload, secret) {
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = createBase64Url(JSON.stringify(header));
    const encodedPayload = createBase64Url(JSON.stringify(payload));
    const content = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac("sha256", secret).update(content).digest("base64url");
    return `${content}.${signature}`;
}

export function getGoogleOAuthPublicConfig() {
    const enabled = isGoogleAuthEnabled();
    return {
        enabled,
        provider: "google",
        clientId: getGoogleClientId() || null,
        scopes: getGoogleScopes(),
        redirectUri: getGoogleRedirectUri() || null,
        roleModel: {
            defaultRole: ADMIN_ROLE,
        },
    };
}

export function buildGoogleAuthUrl({ redirectUri, state } = {}) {
    requireGoogleEnabled();
    const clientId = requireGoogleClientId();
    const resolvedRedirectUri = resolveRedirectUri(redirectUri);
    if (!resolvedRedirectUri) {
        throw new AuthHttpError(400, "missing_redirect_uri", "Missing redirectUri.");
    }
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: resolvedRedirectUri,
        response_type: "code",
        scope: getGoogleScopes().join(" "),
        access_type: "online",
        include_granted_scopes: "true",
        prompt: "select_account",
    });
    const normalizedState = trimString(state);
    if (normalizedState) params.set("state", normalizedState);
    return `${GOOGLE_AUTH_BASE_URL}?${params.toString()}`;
}

async function parseResponseJson(response) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { error_description: text.slice(0, 500) };
    }
}

async function exchangeCodeForGoogleTokens({ code, redirectUri }) {
    const normalizedCode = trimString(code);
    if (!normalizedCode) {
        throw new AuthHttpError(400, "missing_code", "Missing authorization code.");
    }
    const clientId = requireGoogleClientId();
    const clientSecret = getGoogleClientSecret();
    if (!clientSecret) {
        throw new AuthHttpError(500, "auth_config_error", "Missing CORE_AUTH_GOOGLE_CLIENT_SECRET.");
    }
    const resolvedRedirectUri = resolveRedirectUri(redirectUri);
    if (!resolvedRedirectUri) {
        throw new AuthHttpError(400, "missing_redirect_uri", "Missing redirectUri.");
    }

    const body = new URLSearchParams({
        code: normalizedCode,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: resolvedRedirectUri,
        grant_type: "authorization_code",
    });

    let response;
    try {
        response = await fetch(GOOGLE_TOKEN_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
        });
    } catch (error) {
        throw new AuthHttpError(
            502,
            "google_oauth_unreachable",
            "Google OAuth token endpoint is unreachable.",
            error?.message || String(error)
        );
    }

    const payload = await parseResponseJson(response);
    if (!response.ok) {
        throw new AuthHttpError(
            401,
            "google_oauth_code_invalid",
            "Failed to exchange Google OAuth code.",
            payload?.error_description || payload?.error || null
        );
    }
    const idToken = trimString(payload?.id_token);
    if (!idToken) {
        throw new AuthHttpError(401, "google_id_token_missing", "Google token response did not include id_token.");
    }
    return payload;
}

async function verifyGoogleIdToken(idToken) {
    const normalizedIdToken = trimString(idToken);
    if (!normalizedIdToken) {
        throw new AuthHttpError(400, "missing_id_token", "Missing idToken.");
    }
    const clientId = requireGoogleClientId();

    let response;
    try {
        const url = `${GOOGLE_TOKENINFO_URL}?${new URLSearchParams({ id_token: normalizedIdToken }).toString()}`;
        response = await fetch(url);
    } catch (error) {
        throw new AuthHttpError(
            502,
            "google_oauth_unreachable",
            "Google tokeninfo endpoint is unreachable.",
            error?.message || String(error)
        );
    }

    const claims = await parseResponseJson(response);
    if (!response.ok) {
        throw new AuthHttpError(
            401,
            "google_id_token_invalid",
            "Google idToken is invalid.",
            claims?.error_description || claims?.error || null
        );
    }

    const aud = trimString(claims?.aud);
    if (!aud || aud !== clientId) {
        throw new AuthHttpError(401, "google_audience_mismatch", "Google idToken audience mismatch.");
    }

    const expEpoch = toPositiveInt(claims?.exp, 0);
    const nowEpoch = Math.floor(Date.now() / 1000);
    if (!expEpoch || expEpoch <= nowEpoch) {
        throw new AuthHttpError(401, "google_token_expired", "Google idToken is expired.");
    }

    const email = normalizeEmail(claims?.email);
    const emailVerifiedRaw = claims?.email_verified;
    const emailVerified = emailVerifiedRaw === true || String(emailVerifiedRaw).toLowerCase() === "true";
    if (!email || !emailVerified) {
        throw new AuthHttpError(403, "google_email_not_verified", "Google account email is not verified.");
    }

    const allowedDomains = getAllowedHostedDomains();
    if (allowedDomains.length > 0) {
        const hostedDomain = trimString(claims?.hd).toLowerCase();
        if (!hostedDomain || !allowedDomains.includes(hostedDomain)) {
            throw new AuthHttpError(403, "google_domain_not_allowed", "Google hosted domain is not allowed.");
        }
    }

    return {
        sub: trimString(claims?.sub),
        email,
        name: trimString(claims?.name) || null,
        picture: trimString(claims?.picture) || null,
    };
}

function ensureAdminAccess(email) {
    const adminEmails = getAdminEmails();
    if (adminEmails.length === 0 && allowAnyAdminWhenNoList()) {
        return;
    }
    if (adminEmails.length === 0) {
        throw new AuthHttpError(
            403,
            "admin_allowlist_missing",
            "No admin allowlist configured. Set CORE_AUTH_GOOGLE_ADMIN_EMAILS."
        );
    }
    if (!adminEmails.includes(normalizeEmail(email))) {
        throw new AuthHttpError(403, "admin_access_denied", "Your account is not allowed as admin-tecnico.");
    }
}

function createCoreSessionToken(googleUser) {
    const secret = requireJwtSecret();
    const now = Math.floor(Date.now() / 1000);
    const ttlSec = getJwtTtlSec();
    const allowedAccounts = getAdminAllowedAccounts();
    const defaultAccountId =
        trimString(process.env.CORE_AUTH_DEFAULT_ACCOUNT_ID) || (allowedAccounts[0] || null);

    const payload = {
        iss: getJwtIssuer(),
        aud: getJwtAudience(),
        sub: googleUser.sub || googleUser.email,
        iat: now,
        exp: now + ttlSec,
        authProvider: "google",
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture,
        role: ADMIN_ROLE,
        roles: [ADMIN_ROLE],
        allowedAccounts,
        defaultAccountId,
    };
    return {
        token: signJwt(payload, secret),
        expiresIn: ttlSec,
        claims: payload,
    };
}

export async function loginWithGoogle({ code, idToken, redirectUri } = {}) {
    requireGoogleEnabled();

    let token = trimString(idToken);
    if (!token) {
        const tokenResponse = await exchangeCodeForGoogleTokens({ code, redirectUri });
        token = trimString(tokenResponse?.id_token);
    }

    const googleUser = await verifyGoogleIdToken(token);
    ensureAdminAccess(googleUser.email);
    const session = createCoreSessionToken(googleUser);

    return {
        accessToken: session.token,
        tokenType: "Bearer",
        expiresIn: session.expiresIn,
        user: {
            sub: googleUser.sub || googleUser.email,
            email: googleUser.email,
            name: googleUser.name,
            picture: googleUser.picture,
            role: ADMIN_ROLE,
        },
        claims: session.claims,
    };
}
