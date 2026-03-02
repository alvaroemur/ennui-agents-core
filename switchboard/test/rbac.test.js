import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    authenticateRequest,
    canRead,
    canUseChat,
    canWrite,
    getPrincipalAccountId,
    isAdmin,
    isRbacEnabled,
} from "../src/rbac.js";

const ENV_KEYS = [
    "SWITCHBOARD_RBAC_ENABLED",
    "SWITCHBOARD_CORE_KEYS",
    "SWITCHBOARD_KEYS_PATH",
    "SWITCHBOARD_AUTH_GOOGLE_ENABLED",
    "SWITCHBOARD_AUTH_GOOGLE_CLIENT_ID",
    "SWITCHBOARD_ADMIN_EMAILS",
    "SWITCHBOARD_AUTH_GOOGLE_ALLOWED_HOSTED_DOMAINS",
    "GOOGLE_CLIENT_ID",
    "SWITCHBOARD_AUTH_JWT_ENABLED",
    "SWITCHBOARD_AUTH_JWT_SECRET",
    "SWITCHBOARD_AUTH_JWT_ISSUER",
    "SWITCHBOARD_AUTH_JWT_AUDIENCE",
    "CORE_AUTH_JWT_SECRET",
];

function signHs256Jwt(payload, secret) {
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const content = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac("sha256", secret).update(content).digest("base64url");
    return `${content}.${signature}`;
}

function createUnsignedJwt(payload) {
    const header = { alg: "none", typ: "JWT" };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encodedHeader}.${encodedPayload}.x`;
}

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

async function withTempKeys(entries, run) {
    const dir = await mkdtemp(join(tmpdir(), "switchboard-rbac-test-"));
    const path = join(dir, "keys.json");
    try {
        await writeFile(path, JSON.stringify(entries, null, 2), "utf8");
        process.env.SWITCHBOARD_KEYS_PATH = path;
        await run();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

test("authenticateRequest returns admin principal when RBAC is disabled", async () => {
    const env = snapshotEnv();
    try {
        process.env.SWITCHBOARD_RBAC_ENABLED = "false";
        delete process.env.SWITCHBOARD_CORE_KEYS;
        delete process.env.SWITCHBOARD_KEYS_PATH;

        const auth = await authenticateRequest({ headers: {} }, {});
        assert.equal(auth.enabled, false);
        assert.equal(auth.principal?.role, "admin-tecnico");
        assert.equal(auth.principal?.accountId, null);
    } finally {
        restoreEnv(env);
    }
});

test("authenticateRequest reports missing-key when key is absent", async () => {
    const env = snapshotEnv();
    try {
        process.env.SWITCHBOARD_RBAC_ENABLED = "true";
        process.env.SWITCHBOARD_CORE_KEYS = JSON.stringify([{ key: "k1", accountId: "acc-1" }]);
        delete process.env.SWITCHBOARD_KEYS_PATH;

        const auth = await authenticateRequest({ headers: {} }, { getAccountById: async () => ({}) });
        assert.equal(auth.enabled, true);
        assert.equal(auth.principal, null);
        assert.equal(auth.reason, "missing-key");
    } finally {
        restoreEnv(env);
    }
});

test("authenticateRequest reports invalid-key for unknown bearer key", async () => {
    const env = snapshotEnv();
    try {
        process.env.SWITCHBOARD_RBAC_ENABLED = "true";
        process.env.SWITCHBOARD_CORE_KEYS = JSON.stringify([{ key: "k1", accountId: "acc-1" }]);
        delete process.env.SWITCHBOARD_KEYS_PATH;

        const auth = await authenticateRequest(
            { headers: { authorization: "Bearer unknown" } },
            { getAccountById: async () => ({ id: "acc-1", role: "operador-cuenta", status: "active" }) }
        );
        assert.equal(auth.principal, null);
        assert.equal(auth.reason, "invalid-key");
    } finally {
        restoreEnv(env);
    }
});

test("authenticateRequest reports account-resolver-missing for valid key without resolver", async () => {
    const env = snapshotEnv();
    try {
        process.env.SWITCHBOARD_RBAC_ENABLED = "true";
        process.env.SWITCHBOARD_CORE_KEYS = JSON.stringify([{ key: "k1", accountId: "acc-1" }]);
        delete process.env.SWITCHBOARD_KEYS_PATH;

        const auth = await authenticateRequest({ headers: { authorization: "Bearer k1" } }, {});
        assert.equal(auth.principal, null);
        assert.equal(auth.reason, "account-resolver-missing");
    } finally {
        restoreEnv(env);
    }
});

test("authenticateRequest reports account-not-found for missing account", async () => {
    const env = snapshotEnv();
    try {
        process.env.SWITCHBOARD_RBAC_ENABLED = "true";
        process.env.SWITCHBOARD_CORE_KEYS = JSON.stringify([{ key: "k1", accountId: "acc-1" }]);
        delete process.env.SWITCHBOARD_KEYS_PATH;

        const auth = await authenticateRequest(
            { headers: { authorization: "Bearer k1" } },
            { getAccountById: async () => null }
        );
        assert.equal(auth.principal, null);
        assert.equal(auth.reason, "account-not-found");
    } finally {
        restoreEnv(env);
    }
});

test("authenticateRequest rejects inactive and invalid-role accounts", async () => {
    const env = snapshotEnv();
    try {
        process.env.SWITCHBOARD_RBAC_ENABLED = "true";
        process.env.SWITCHBOARD_CORE_KEYS = JSON.stringify([{ key: "k1", accountId: "acc-1" }]);
        delete process.env.SWITCHBOARD_KEYS_PATH;

        const inactive = await authenticateRequest(
            { headers: { authorization: "Bearer k1" } },
            { getAccountById: async () => ({ id: "acc-1", role: "operador-cuenta", status: "inactive" }) }
        );
        assert.equal(inactive.principal, null);
        assert.equal(inactive.reason, "account-inactive");

        const invalidRole = await authenticateRequest(
            { headers: { authorization: "Bearer k1" } },
            { getAccountById: async () => ({ id: "acc-1", role: "owner", status: "active" }) }
        );
        assert.equal(invalidRole.principal, null);
        assert.equal(invalidRole.reason, "invalid-account-role");
    } finally {
        restoreEnv(env);
    }
});

test("authenticateRequest accepts x-api-key and returns normalized principal", async () => {
    const env = snapshotEnv();
    try {
        process.env.SWITCHBOARD_RBAC_ENABLED = "true";
        delete process.env.SWITCHBOARD_CORE_KEYS;
        await withTempKeys(
            {
                keys: [{ id: "key-1", label: "gw", key: "k1", accountId: "acc-1", status: "active" }],
            },
            async () => {
                const auth = await authenticateRequest(
                    { headers: { "x-api-key": "k1" } },
                    { getAccountById: async () => ({ id: "acc-1", role: "operador-cuenta", status: "active" }) }
                );
                assert.equal(auth.enabled, true);
                assert.equal(auth.reason, undefined);
                assert.deepEqual(auth.principal, {
                    role: "operador-cuenta",
                    accountId: "acc-1",
                    subject: "gw",
                    keyId: "key-1",
                    keyLabel: "gw",
                });
            }
        );
    } finally {
        restoreEnv(env);
    }
});

test("authenticateRequest accepts Google id_token for allowlisted admin email", async () => {
    const env = snapshotEnv();
    const originalFetch = global.fetch;
    try {
        const now = Math.floor(Date.now() / 1000);
        process.env.SWITCHBOARD_RBAC_ENABLED = "true";
        process.env.SWITCHBOARD_AUTH_GOOGLE_ENABLED = "true";
        process.env.SWITCHBOARD_AUTH_GOOGLE_CLIENT_ID = "google-client-123";
        process.env.SWITCHBOARD_ADMIN_EMAILS = "admin@example.com";
        process.env.SWITCHBOARD_CORE_KEYS = JSON.stringify([{ key: "core-key", accountId: "acc-1" }]);

        global.fetch = async () => ({
            ok: true,
            json: async () => ({
                aud: "google-client-123",
                iss: "https://accounts.google.com",
                exp: String(now + 600),
                email: "admin@example.com",
                email_verified: "true",
                hd: "example.com",
            }),
        });

        const googleLikeToken = createUnsignedJwt({
            iss: "https://accounts.google.com",
            aud: "google-client-123",
            exp: now + 600,
            email: "admin@example.com",
        });
        const auth = await authenticateRequest(
            { headers: { authorization: `Bearer ${googleLikeToken}` } },
            { getAccountById: async () => ({ id: "acc-1", role: "operador-cuenta", status: "active" }) }
        );
        assert.equal(auth.enabled, true);
        assert.equal(auth.principal?.role, "admin-tecnico");
        assert.equal(auth.principal?.subject, "admin@example.com");
    } finally {
        global.fetch = originalFetch;
        restoreEnv(env);
    }
});

test("authenticateRequest accepts Google operador when in SWITCHBOARD_GOOGLE_OPERADORES", async () => {
    const env = snapshotEnv();
    const originalFetch = global.fetch;
    try {
        const now = Math.floor(Date.now() / 1000);
        process.env.SWITCHBOARD_RBAC_ENABLED = "true";
        process.env.SWITCHBOARD_AUTH_GOOGLE_ENABLED = "true";
        process.env.SWITCHBOARD_AUTH_GOOGLE_CLIENT_ID = "google-client-123";
        process.env.SWITCHBOARD_ADMIN_EMAILS = "admin@example.com";
        process.env.SWITCHBOARD_GOOGLE_OPERADORES = "operator@example.com:gateway";

        global.fetch = async () => ({
            ok: true,
            json: async () => ({
                aud: "google-client-123",
                iss: "https://accounts.google.com",
                exp: String(now + 600),
                email: "operator@example.com",
                email_verified: "true",
                hd: "example.com",
            }),
        });

        const googleLikeToken = createUnsignedJwt({
            iss: "https://accounts.google.com",
            aud: "google-client-123",
            exp: now + 600,
            email: "operator@example.com",
        });
        const auth = await authenticateRequest(
            { headers: { authorization: `Bearer ${googleLikeToken}` } },
            {}
        );
        assert.equal(auth.enabled, true);
        assert.equal(auth.principal?.role, "operador-cuenta");
        assert.equal(auth.principal?.accountId, "gateway");
        assert.equal(auth.principal?.subject, "operator@example.com");
    } finally {
        global.fetch = originalFetch;
        restoreEnv(env);
    }
});

test("authenticateRequest accepts valid user JWT when JWT auth is enabled", async () => {
    const env = snapshotEnv();
    try {
        const now = Math.floor(Date.now() / 1000);
        process.env.SWITCHBOARD_RBAC_ENABLED = "true";
        process.env.SWITCHBOARD_AUTH_JWT_ENABLED = "true";
        process.env.SWITCHBOARD_AUTH_JWT_SECRET = "test-secret";
        process.env.SWITCHBOARD_AUTH_JWT_ISSUER = "core-auth";
        process.env.SWITCHBOARD_AUTH_JWT_AUDIENCE = "core-switchboard";
        process.env.SWITCHBOARD_CORE_KEYS = JSON.stringify([{ key: "k1", accountId: "acc-1" }]);
        delete process.env.SWITCHBOARD_KEYS_PATH;

        const token = signHs256Jwt(
            {
                iss: "core-auth",
                aud: "core-switchboard",
                sub: "user-1",
                role: "admin-tecnico",
                iat: now - 10,
                exp: now + 300,
            },
            "test-secret"
        );
        const auth = await authenticateRequest(
            { headers: { authorization: `Bearer ${token}` } },
            { getAccountById: async () => ({ id: "acc-1", role: "operador-cuenta", status: "active" }) }
        );
        assert.equal(auth.enabled, true);
        assert.equal(auth.principal?.role, "admin-tecnico");
        assert.equal(auth.principal?.subject, "user-1");
    } finally {
        restoreEnv(env);
    }
});

test("permission matrix enforces scope and role rules", () => {
    const admin = { role: "admin-tecnico", accountId: null };
    const operatorA = { role: "operador-cuenta", accountId: "acc-a" };
    const readerA = { role: "lector-cuenta", accountId: "acc-a" };

    assert.equal(isAdmin(admin), true);
    assert.equal(isAdmin(operatorA), false);
    assert.equal(getPrincipalAccountId(operatorA), "acc-a");
    assert.equal(getPrincipalAccountId(null), null);

    assert.equal(canRead(admin, "acc-b"), true);
    assert.equal(canRead(operatorA, "acc-a"), true);
    assert.equal(canRead(operatorA, "acc-b"), false);
    assert.equal(canRead(readerA, "acc-a"), true);
    assert.equal(canRead(readerA, "acc-b"), false);

    assert.equal(canWrite(admin, "acc-b"), true);
    assert.equal(canWrite(operatorA, "acc-a"), true);
    assert.equal(canWrite(operatorA, "acc-b"), false);
    assert.equal(canWrite(readerA, "acc-a"), false);

    assert.equal(canUseChat(admin, "acc-b"), true);
    assert.equal(canUseChat(operatorA, "acc-a"), true);
    assert.equal(canUseChat(operatorA, "acc-b"), false);
    assert.equal(canUseChat(readerA, "acc-a"), false);
});

test("permission matrix supports allowedAccounts claim for JWT principals", () => {
    const operator = { role: "operador-cuenta", accountId: null, allowedAccounts: ["acc-a", "acc-b"] };
    const reader = { role: "lector-cuenta", accountId: null, allowedAccounts: ["acc-a"] };

    assert.equal(canRead(operator, "acc-b"), true);
    assert.equal(canRead(operator, "acc-c"), false);
    assert.equal(canWrite(operator, "acc-a"), true);
    assert.equal(canUseChat(operator, "acc-b"), true);

    assert.equal(canRead(reader, "acc-a"), true);
    assert.equal(canRead(reader, "acc-b"), false);
    assert.equal(canWrite(reader, "acc-a"), false);
    assert.equal(canUseChat(reader, "acc-a"), false);
});

test("isRbacEnabled parses common boolean values", () => {
    const env = snapshotEnv();
    try {
        process.env.SWITCHBOARD_RBAC_ENABLED = "yes";
        assert.equal(isRbacEnabled(), true);
        process.env.SWITCHBOARD_RBAC_ENABLED = "0";
        assert.equal(isRbacEnabled(), false);
    } finally {
        restoreEnv(env);
    }
});
