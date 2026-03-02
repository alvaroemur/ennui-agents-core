import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import net from "node:net";

const SWITCHBOARD_DIR = new URL("..", import.meta.url).pathname;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reservePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : 0;
            server.close((closeError) => {
                if (closeError) {
                    reject(closeError);
                    return;
                }
                resolve(port);
            });
        });
        server.on("error", reject);
    });
}

async function waitForHealth(baseUrl, timeoutMs = 8000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(`${baseUrl}/health`);
            if (response.ok) return;
        } catch (_) {
            // Retry until timeout.
        }
        await delay(100);
    }
    throw new Error(`Switchboard did not become healthy on ${baseUrl}`);
}

async function startSwitchboard() {
    const tempDir = await mkdtemp(join(tmpdir(), "switchboard-rbac-http-test-"));
    const registryPath = join(tempDir, "registry.json");
    const missingKeysPath = join(tempDir, "missing-keys.json");
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    const seed = {
        accounts: [
            { id: "inspiro-comercial", role: "operador-cuenta", status: "active" },
            { id: "platform", role: "admin-tecnico", status: "active" },
        ],
        agents: [],
        deployments: [],
        assignments: [],
        runs: [],
    };
    await writeFile(registryPath, JSON.stringify(seed, null, 2), "utf8");

    const child = spawn("node", ["src/index.js"], {
        cwd: SWITCHBOARD_DIR,
        env: {
            ...process.env,
            PORT: String(port),
            REGISTRY_PATH: registryPath,
            SWITCHBOARD_DATABASE_URL: "",
            SWITCHBOARD_RBAC_ENABLED: "true",
            SWITCHBOARD_KEYS_PATH: missingKeysPath,
            SWITCHBOARD_CORE_KEYS: JSON.stringify([
                { id: "k-op", label: "operator", key: "op-key", accountId: "inspiro-comercial", status: "active" },
                { id: "k-admin", label: "admin", key: "adm-key", accountId: "platform", status: "active" },
            ]),
        },
        stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
        output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
        output += String(chunk);
    });

    try {
        await waitForHealth(baseUrl);
        return {
            baseUrl,
            stop: async () => {
                if (!child.killed) child.kill("SIGTERM");
                await new Promise((resolve) => child.once("exit", resolve));
                await rm(tempDir, { recursive: true, force: true });
            },
        };
    } catch (error) {
        if (!child.killed) child.kill("SIGTERM");
        await new Promise((resolve) => child.once("exit", resolve));
        await rm(tempDir, { recursive: true, force: true });
        throw new Error(`${error.message}\n${output}`);
    }
}

let runtime;

test.before(async () => {
    runtime = await startSwitchboard();
});

test.after(async () => {
    if (runtime) await runtime.stop();
});

test("GET /api/runs requires auth when RBAC is enabled", async () => {
    const response = await fetch(`${runtime.baseUrl}/api/runs`);
    assert.equal(response.status, 401);
});

test("GET /api/runs denies operador for out-of-scope account", async () => {
    const response = await fetch(`${runtime.baseUrl}/api/runs?accountId=platform`, {
        headers: { Authorization: "Bearer op-key" },
    });
    assert.equal(response.status, 403);
});

test("GET /api/runs rejects legacy query param clientId", async () => {
    const response = await fetch(`${runtime.baseUrl}/api/runs?clientId=inspiro-comercial`, {
        headers: { Authorization: "Bearer adm-key" },
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /Legacy query param/i);
});

test("POST /api/chat rejects legacy clientId body and returns run header", async () => {
    const response = await fetch(`${runtime.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
            Authorization: "Bearer op-key",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            clientId: "inspiro-comercial",
            agentId: "consultor-ia",
            messages: [{ role: "user", parts: [{ text: "hola" }] }],
        }),
    });
    assert.equal(response.status, 400);
    assert.ok(response.headers.get("x-run-id"));
    const payload = await response.json();
    assert.match(payload.error, /Legacy clientId/i);
});
