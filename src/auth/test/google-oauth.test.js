import test from "node:test";
import assert from "node:assert/strict";
import { AuthHttpError, loginWithGoogle } from "../google-oauth.js";

const ENV_KEYS = [
    "CORE_AUTH_GOOGLE_ENABLED",
    "CORE_AUTH_GOOGLE_CLIENT_ID",
    "CORE_AUTH_GOOGLE_CLIENT_SECRET",
    "CORE_AUTH_GOOGLE_REDIRECT_URI",
    "CORE_AUTH_GOOGLE_SCOPES",
    "CORE_AUTH_GOOGLE_ALLOWED_HOSTED_DOMAINS",
    "CORE_AUTH_MASTER_EMAILS",
    "CORE_AUTH_GOOGLE_ADMIN_EMAILS",
    "CORE_AUTH_GOOGLE_ALLOW_ANY_ADMIN",
    "CORE_AUTH_LEGACY_EMAIL_ALLOWLIST_FALLBACK",
    "CORE_AUTH_JWT_SECRET",
    "CORE_AUTH_JWT_ISSUER",
    "CORE_AUTH_JWT_AUDIENCE",
    "CORE_AUTH_JWT_TTL_SEC",
];

function snapshotEnv() {
    return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
    for (const key of ENV_KEYS) {
        if (snapshot[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = snapshot[key];
        }
    }
}

function buildGoogleTokeninfoFetch({ email = "user@example.com", sub = "google-sub-1" } = {}) {
    return async (url) => {
        const asText = String(url);
        if (!asText.startsWith("https://oauth2.googleapis.com/tokeninfo?")) {
            throw new Error(`Unexpected URL in test fetch: ${asText}`);
        }
        return new Response(
            JSON.stringify({
                aud: process.env.CORE_AUTH_GOOGLE_CLIENT_ID,
                exp: String(Math.floor(Date.now() / 1000) + 600),
                email,
                email_verified: "true",
                sub,
                name: "Test User",
            }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }
        );
    };
}

test("loginWithGoogle emits RBAC claims from resolved access profile", async () => {
    const env = snapshotEnv();
    const previousFetch = global.fetch;
    try {
        process.env.CORE_AUTH_GOOGLE_ENABLED = "true";
        process.env.CORE_AUTH_GOOGLE_CLIENT_ID = "client-id-123.apps.googleusercontent.com";
        process.env.CORE_AUTH_JWT_SECRET = "jwt-secret";
        process.env.CORE_AUTH_JWT_ISSUER = "core-auth";
        process.env.CORE_AUTH_JWT_AUDIENCE = "core-switchboard";
        process.env.CORE_AUTH_LEGACY_EMAIL_ALLOWLIST_FALLBACK = "false";
        process.env.CORE_AUTH_MASTER_EMAILS = "owner@example.com";

        global.fetch = buildGoogleTokeninfoFetch({
            email: "operator@example.com",
            sub: "google-sub-operator",
        });

        const result = await loginWithGoogle({
            idToken: "fake-id-token",
            resolveAccessProfile: async (email) => {
                assert.equal(email, "operator@example.com");
                return {
                    status: "active",
                    role: "operador-cuenta",
                    allowedAccounts: ["inspiro-agents"],
                    defaultAccountId: "inspiro-agents",
                };
            },
        });

        assert.equal(result.user.email, "operator@example.com");
        assert.equal(result.user.role, "operador-cuenta");
        assert.equal(result.claims.role, "operador-cuenta");
        assert.deepEqual(result.claims.allowedAccounts, ["inspiro-agents"]);
        assert.equal(result.claims.defaultAccountId, "inspiro-agents");
    } finally {
        global.fetch = previousFetch;
        restoreEnv(env);
    }
});

test("loginWithGoogle denies non-allowlisted user when no profile exists", async () => {
    const env = snapshotEnv();
    const previousFetch = global.fetch;
    try {
        process.env.CORE_AUTH_GOOGLE_ENABLED = "true";
        process.env.CORE_AUTH_GOOGLE_CLIENT_ID = "client-id-123.apps.googleusercontent.com";
        process.env.CORE_AUTH_JWT_SECRET = "jwt-secret";
        process.env.CORE_AUTH_JWT_ISSUER = "core-auth";
        process.env.CORE_AUTH_JWT_AUDIENCE = "core-switchboard";
        process.env.CORE_AUTH_MASTER_EMAILS = "alvaro.e.mur@gmail.com";
        process.env.CORE_AUTH_LEGACY_EMAIL_ALLOWLIST_FALLBACK = "false";

        global.fetch = buildGoogleTokeninfoFetch({
            email: "outsider@example.com",
            sub: "google-sub-outsider",
        });

        await assert.rejects(
            loginWithGoogle({
                idToken: "fake-id-token",
                resolveAccessProfile: async () => null,
            }),
            (error) => {
                assert.ok(error instanceof AuthHttpError);
                assert.equal(error.statusCode, 403);
                assert.equal(error.errorCode, "access_denied");
                return true;
            }
        );
    } finally {
        global.fetch = previousFetch;
        restoreEnv(env);
    }
});

test("loginWithGoogle rejects inactive access profile", async () => {
    const env = snapshotEnv();
    const previousFetch = global.fetch;
    try {
        process.env.CORE_AUTH_GOOGLE_ENABLED = "true";
        process.env.CORE_AUTH_GOOGLE_CLIENT_ID = "client-id-123.apps.googleusercontent.com";
        process.env.CORE_AUTH_JWT_SECRET = "jwt-secret";
        process.env.CORE_AUTH_JWT_ISSUER = "core-auth";
        process.env.CORE_AUTH_JWT_AUDIENCE = "core-switchboard";
        process.env.CORE_AUTH_MASTER_EMAILS = "owner@example.com";
        process.env.CORE_AUTH_LEGACY_EMAIL_ALLOWLIST_FALLBACK = "false";

        global.fetch = buildGoogleTokeninfoFetch({
            email: "blocked@example.com",
            sub: "google-sub-blocked",
        });

        await assert.rejects(
            loginWithGoogle({
                idToken: "fake-id-token",
                resolveAccessProfile: async () => ({
                    status: "inactive",
                    role: "lector-cuenta",
                    allowedAccounts: ["inspiro-agents"],
                    defaultAccountId: "inspiro-agents",
                }),
            }),
            (error) => {
                assert.ok(error instanceof AuthHttpError);
                assert.equal(error.statusCode, 403);
                assert.equal(error.errorCode, "access_inactive");
                return true;
            }
        );
    } finally {
        global.fetch = previousFetch;
        restoreEnv(env);
    }
});
