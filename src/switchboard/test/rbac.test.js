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
    getPrincipalWorkspaceId,
    isAdmin,
    isRbacEnabled,
} from "../rbac.js";

const ENV_KEYS = [
    "SWITCHBOARD_RBAC_ENABLED",
    "SWITCHBOARD_CORE_KEYS",
    "SWITCHBOARD_KEYS_PATH",
    "SWITCHBOARD_AUTH_JWT_ENABLED",
    "SWITCHBOARD_AUTH_JWT_SECRET",
    "SWITCHBOARD_AUTH_JWT_ISSUER",
    "SWITCHBOARD_AUTH_JWT_AUDIENCE",
];

function signHs256Jwt(payload, secret) {
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const content = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac("sha256", secret).update(content).digest("base64url");
    return `${content}.${signature}`;
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
        assert.equal(auth.principal?.workspaceId, null);
    } finally {
        restoreEnv(env);
    }
});

test("authenticateRequest reports missing-key when key is absent", async () => {
    const env = snapshotEnv();
    try {
        process.env.SWITCHBOARD_RBAC_ENABLED = "true";
        process.env.SWITCHBOARD_CORE_KEYS = JSON.stringify([{ key: "k1", workspaceId: "acc-1" }]);
        delete process.env.SWITCHBOARD_KEYS_PATH;

        const auth = await authenticateRequest({ headers: {} }, { getWorkspaceById: async () => ({}) });
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
        process.env.SWITCHBOARD_CORE_KEYS = JSON.stringify([{ key: "k1", workspaceId: "acc-1" }]);
        delete process.env.SWITCHBOARD_KEYS_PATH;

        const auth = await authenticateRequest(
            { headers: { authorization: "Bearer unknown" } },
            { getWorkspaceById: async () => ({ id: "acc-1", role: "operador-cuenta", status: "active" }) }
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
        process.env.SWITCHBOARD_CORE_KEYS = JSON.stringify([{ key: "k1", workspaceId: "acc-1" }]);
        delete process.env.SWITCHBOARD_KEYS_PATH;

        const auth = await authenticateRequest({ headers: { authorization: "Bearer k1" } }, {});
        assert.equal(auth.principal, null);
        assert.equal(auth.reason, "workspace-resolver-missing");
    } finally {
        restoreEnv(env);
    }
});

test("authenticateRequest reports account-not-found for missing account", async () => {
    const env = snapshotEnv();
    try {
        process.env.SWITCHBOARD_RBAC_ENABLED = "true";
        process.env.SWITCHBOARD_CORE_KEYS = JSON.stringify([{ key: "k1", workspaceId: "acc-1" }]);
        delete process.env.SWITCHBOARD_KEYS_PATH;

        const auth = await authenticateRequest(
            { headers: { authorization: "Bearer k1" } },
            { getWorkspaceById: async () => null }
        );
        assert.equal(auth.principal, null);
        assert.equal(auth.reason, "workspace-not-found");
    } finally {
        restoreEnv(env);
    }
});

test("authenticateRequest rejects inactive and invalid-role accounts", async () => {
    const env = snapshotEnv();
    try {
        process.env.SWITCHBOARD_RBAC_ENABLED = "true";
        process.env.SWITCHBOARD_CORE_KEYS = JSON.stringify([{ key: "k1", workspaceId: "acc-1" }]);
        delete process.env.SWITCHBOARD_KEYS_PATH;

        const inactive = await authenticateRequest(
            { headers: { authorization: "Bearer k1" } },
            { getWorkspaceById: async () => ({ id: "acc-1", role: "operador-cuenta", status: "inactive" }) }
        );
        assert.equal(inactive.principal, null);
        assert.equal(inactive.reason, "workspace-inactive");

        const invalidRole = await authenticateRequest(
            { headers: { authorization: "Bearer k1" } },
            { getWorkspaceById: async () => ({ id: "acc-1", role: "owner", status: "active" }) }
        );
        assert.equal(invalidRole.principal, null);
        assert.equal(invalidRole.reason, "invalid-workspace-role");
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
                keys: [{ id: "key-1", label: "gw", key: "k1", workspaceId: "acc-1", status: "active" }],
            },
            async () => {
                const auth = await authenticateRequest(
                    { headers: { "x-api-key": "k1" } },
                    { getWorkspaceById: async () => ({ id: "acc-1", role: "operador-cuenta", status: "active" }) }
                );
                assert.equal(auth.enabled, true);
                assert.equal(auth.reason, undefined);
                assert.deepEqual(auth.principal, {
                    role: "operador-cuenta",
                    workspaceId: "acc-1",
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

test("authenticateRequest accepts valid user JWT when JWT auth is enabled", async () => {
    const env = snapshotEnv();
    try {
        const now = Math.floor(Date.now() / 1000);
        process.env.SWITCHBOARD_RBAC_ENABLED = "true";
        process.env.SWITCHBOARD_AUTH_JWT_ENABLED = "true";
        process.env.SWITCHBOARD_AUTH_JWT_SECRET = "test-secret";
        process.env.SWITCHBOARD_AUTH_JWT_ISSUER = "core-auth";
        process.env.SWITCHBOARD_AUTH_JWT_AUDIENCE = "core-switchboard";
        process.env.SWITCHBOARD_CORE_KEYS = JSON.stringify([{ key: "k1", workspaceId: "acc-1" }]);
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
            { getWorkspaceById: async () => ({ id: "acc-1", role: "operador-cuenta", status: "active" }) }
        );
        assert.equal(auth.enabled, true);
        assert.equal(auth.principal?.role, "admin-tecnico");
        assert.equal(auth.principal?.subject, "user-1");
    } finally {
        restoreEnv(env);
    }
});

test("permission matrix enforces scope and role rules", () => {
    const admin = { role: "admin-tecnico", workspaceId: null };
    const operatorA = { role: "operador-cuenta", workspaceId: "acc-a" };
    const readerA = { role: "lector-cuenta", workspaceId: "acc-a" };

    assert.equal(isAdmin(admin), true);
    assert.equal(isAdmin(operatorA), false);
    assert.equal(getPrincipalWorkspaceId(operatorA), "acc-a");
    assert.equal(getPrincipalWorkspaceId(null), null);

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
    const operator = { role: "operador-cuenta", workspaceId: null, allowedWorkspaces: ["acc-a", "acc-b"] };
    const reader = { role: "lector-cuenta", workspaceId: null, allowedWorkspaces: ["acc-a"] };

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
