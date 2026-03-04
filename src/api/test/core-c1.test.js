import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import net from "node:net";
import http from "node:http";
import { spawn } from "node:child_process";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;

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

async function waitForHealth(baseUrl, path = "/health", timeoutMs = 8000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(`${baseUrl}${path}`);
            if (response.ok) return;
        } catch (_) {
            // Retry.
        }
        await delay(100);
    }
    throw new Error(`Server did not become healthy on ${baseUrl}${path}`);
}

function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = "";
        req.on("data", (chunk) => {
            raw += String(chunk);
        });
        req.on("end", () => {
            try {
                resolve(raw ? JSON.parse(raw) : {});
            } catch (error) {
                reject(error);
            }
        });
        req.on("error", reject);
    });
}

async function startMockRuntimeServer(name, { chatPath = "/core/runtime/chat" } = {}) {
    const requests = [];
    const runtimeChatPath = typeof chatPath === "string" && chatPath.trim() ? chatPath.trim() : "/core/runtime/chat";
    const port = await reservePort();
    const server = http.createServer(async (req, res) => {
        if (req.method === "GET" && req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, runtime: name }));
            return;
        }
        if (req.method === "POST" && req.url === runtimeChatPath) {
            const body = await parseJsonBody(req);
            requests.push({
                headers: req.headers,
                body,
                url: req.url,
            });
            if (body?.responseMode === "v2") {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(
                    JSON.stringify({
                        reply: `Asistente ${name}: responde de forma breve y útil.`,
                        trace: { agentRunId: `agent-${name}-run` },
                    })
                );
                return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ text: `legacy-${name}` }));
            return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
    });
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        chatPath: runtimeChatPath,
        requests,
        stop: async () => {
            await new Promise((resolve) => server.close(resolve));
        },
    };
}

async function startMockLlmProxyServer() {
    const requests = [];
    const port = await reservePort();
    const server = http.createServer(async (req, res) => {
        if (req.method === "POST" && req.url === "/llm") {
            const body = await parseJsonBody(req);
            requests.push(body);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    text: "respuesta-desde-llm-proxy",
                    provider: "proxy",
                    usage: { inputTokens: 11, outputTokens: 7 },
                })
            );
            return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
    });
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        stop: async () => {
            await new Promise((resolve) => server.close(resolve));
        },
    };
}

function signHs256Jwt(payload, secret) {
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const content = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac("sha256", secret).update(content).digest("base64url");
    return `${content}.${signature}`;
}

async function startCoreServer({ registryPath, keysPath, llmProxyUrl, extraEnv = {} }) {
    const port = await reservePort();
    const child = spawn("node", ["src/api/server.js"], {
        cwd: REPO_ROOT,
        env: {
            ...process.env,
            PORT: String(port),
            REGISTRY_PATH: registryPath,
            SWITCHBOARD_DATABASE_URL: "",
            SWITCHBOARD_RBAC_ENABLED: "true",
            SWITCHBOARD_KEYS_PATH: keysPath,
            SWITCHBOARD_AUTH_JWT_ONLY: "false",
            LLM_PROXY_URL: llmProxyUrl,
            ...extraEnv,
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
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
        await waitForHealth(baseUrl);
    } catch (error) {
        if (!child.killed) child.kill("SIGTERM");
        await new Promise((resolve) => child.once("exit", resolve));
        throw new Error(`${error.message}\n${output}`);
    }
    return {
        baseUrl,
        stop: async () => {
            if (!child.killed) child.kill("SIGTERM");
            await new Promise((resolve) => child.once("exit", resolve));
        },
    };
}

async function setupStack() {
    const tempDir = await mkdtemp(join(tmpdir(), "core-c1-test-"));
    const runtimeA = await startMockRuntimeServer("A");
    const runtimeB = await startMockRuntimeServer("B");
    const llmProxy = await startMockLlmProxyServer();
    const registryPath = join(tempDir, "registry.json");
    const keysPath = join(tempDir, "core-keys.json");
    const registry = {
        workspaces: [
            { id: "inspiro-agents", role: "operador-cuenta", status: "active" },
        ],
        users: [],
        workspace_memberships: [],
        tenants: [
            { id: "aliantza", workspaceId: "inspiro-agents", status: "active" },
        ],
        agents: [
            { id: "aliantza-compras", type: "chat", name: "Aliantza Compras" },
        ],
        deployments: [
            { id: "dep-a", workspaceId: "inspiro-agents", baseUrl: runtimeA.baseUrl },
            { id: "dep-b", workspaceId: "inspiro-agents", baseUrl: runtimeB.baseUrl },
        ],
        assignments: [
            { tenantId: "aliantza", agentId: "aliantza-compras", deploymentId: "dep-a" },
        ],
        assignment_audit: [],
        runs: [],
    };
    const keys = {
        keys: [
            { id: "op-key", label: "operator", key: "op-key", workspaceId: "inspiro-agents", status: "active" },
        ],
    };
    await writeFile(registryPath, JSON.stringify(registry, null, 2), "utf8");
    await writeFile(keysPath, JSON.stringify(keys, null, 2), "utf8");

    return {
        tempDir,
        registryPath,
        keysPath,
        runtimeA,
        runtimeB,
        llmProxy,
    };
}

async function teardownStack(stack, core = null) {
    try {
        if (core) await core.stop();
    } finally {
        await stack.runtimeA.stop();
        await stack.runtimeB.stop();
        await stack.llmProxy.stop();
        await rm(stack.tempDir, { recursive: true, force: true });
    }
}

test("C1 relay v2 centraliza llamada LLM en core", async () => {
    const stack = await setupStack();
    const core = await startCoreServer({
        registryPath: stack.registryPath,
        keysPath: stack.keysPath,
        llmProxyUrl: `${stack.llmProxy.baseUrl}/llm`,
    });
    try {
        const relayResponse = await fetch(`${core.baseUrl}/core/relay/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer op-key",
                "X-Request-Id": "req-relay-v2",
            },
            body: JSON.stringify({
                workspaceId: "inspiro-agents",
                tenantId: "aliantza",
                agentId: "aliantza-compras",
                messages: [{ role: "user", parts: [{ text: "Hola" }] }],
            }),
        });
        assert.equal(relayResponse.status, 200);
        const runId = relayResponse.headers.get("x-run-id");
        assert.ok(runId);
        const relayPayload = await relayResponse.json();
        assert.equal(relayPayload.text, "respuesta-desde-llm-proxy");
        assert.equal(relayPayload.provider, "proxy");
        assert.equal(relayPayload.trace?.runId, runId);
        assert.equal(stack.runtimeA.requests.length, 1);
        assert.equal(stack.runtimeA.requests[0].body?.responseMode, "v2");
        assert.equal(stack.llmProxy.requests.length, 1);

        const runResponse = await fetch(`${core.baseUrl}/core/runs/${runId}`, {
            headers: { Authorization: "Bearer op-key" },
        });
        assert.equal(runResponse.status, 200);
        const runPayload = await runResponse.json();
        assert.equal(runPayload.status, "completed");
        assert.equal(runPayload.provider, "proxy");
    } finally {
        await teardownStack(stack, core);
    }
});

test("C1 promote/rollback genera auditoria y aplica health-check", async () => {
    const stack = await setupStack();
    const core = await startCoreServer({
        registryPath: stack.registryPath,
        keysPath: stack.keysPath,
        llmProxyUrl: `${stack.llmProxy.baseUrl}/llm`,
    });
    try {
        const promoteResponse = await fetch(`${core.baseUrl}/core/workspaces/inspiro-agents/assignments/promote`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer op-key",
            },
            body: JSON.stringify({
                tenantId: "aliantza",
                agentId: "aliantza-compras",
                toDeploymentId: "dep-b",
                reason: "canary ok",
            }),
        });
        assert.equal(promoteResponse.status, 200);
        const promotePayload = await promoteResponse.json();
        assert.equal(promotePayload.assignment?.deploymentId, "dep-b");
        assert.equal(promotePayload.auditEvent?.action, "promote");
        assert.equal(promotePayload.auditEvent?.result, "success");

        const rollbackResponse = await fetch(`${core.baseUrl}/core/workspaces/inspiro-agents/assignments/rollback`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer op-key",
            },
            body: JSON.stringify({
                tenantId: "aliantza",
                agentId: "aliantza-compras",
                reason: "rollback test",
            }),
        });
        assert.equal(rollbackResponse.status, 200);
        const rollbackPayload = await rollbackResponse.json();
        assert.equal(rollbackPayload.assignment?.deploymentId, "dep-a");
        assert.equal(rollbackPayload.auditEvent?.action, "rollback");
        assert.equal(rollbackPayload.auditEvent?.result, "success");

        const auditResponse = await fetch(
            `${core.baseUrl}/core/workspaces/inspiro-agents/assignments/audit?tenantId=aliantza&agentId=aliantza-compras`,
            { headers: { Authorization: "Bearer op-key" } }
        );
        assert.equal(auditResponse.status, 200);
        const auditPayload = await auditResponse.json();
        assert.ok(auditPayload.total >= 2);
        assert.equal(auditPayload.items[0].action, "rollback");
        assert.equal(auditPayload.items[1].action, "promote");
    } finally {
        await teardownStack(stack, core);
    }
});

test("Gateway provisioning crea tenant/agent-endpoint/assignment e inyecta contract en relay", async () => {
    const stack = await setupStack();
    const core = await startCoreServer({
        registryPath: stack.registryPath,
        keysPath: stack.keysPath,
        llmProxyUrl: `${stack.llmProxy.baseUrl}/llm`,
    });
    try {
        const tenantRes = await fetch(`${core.baseUrl}/core/workspaces/inspiro-agents/tenants`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer op-key",
            },
            body: JSON.stringify({
                name: "Gateway Tenant",
                metadata: { source: "gateway" },
            }),
        });
        assert.equal(tenantRes.status, 201);
        const tenantPayload = await tenantRes.json();
        assert.equal(tenantPayload.workspaceId, "inspiro-agents");
        assert.equal(tenantPayload.name, "Gateway Tenant");
        assert.ok(tenantPayload.id);

        const endpointRes = await fetch(`${core.baseUrl}/core/workspaces/inspiro-agents/agent-endpoints`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer op-key",
            },
            body: JSON.stringify({
                agentId: "gateway-agent",
                baseUrl: stack.runtimeB.baseUrl,
                name: "Gateway Agent",
                type: "chat",
                versionTag: "v1",
                metadata: { owner: "gateway" },
            }),
        });
        assert.equal(endpointRes.status, 201);
        const endpointPayload = await endpointRes.json();
        assert.equal(endpointPayload.agentId, "gateway-agent");
        assert.equal(endpointPayload.deploymentId, "gateway-agent-deploy");
        assert.equal(endpointPayload.baseUrl, stack.runtimeB.baseUrl);

        const assignmentRes = await fetch(`${core.baseUrl}/core/workspaces/inspiro-agents/assignments`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer op-key",
            },
            body: JSON.stringify({
                tenantId: tenantPayload.id,
                agentId: "gateway-agent",
                deploymentId: "gateway-agent-deploy",
                bindingName: "gateway-public",
                contract: { locale: "es-PE" },
            }),
        });
        assert.equal(assignmentRes.status, 201);
        const assignmentPayload = await assignmentRes.json();
        assert.equal(assignmentPayload.bindingName, "gateway-public");
        assert.deepEqual(assignmentPayload.contract, { locale: "es-PE" });

        const listRes = await fetch(
            `${core.baseUrl}/core/workspaces/inspiro-agents/assignments?tenantId=${tenantPayload.id}&agentId=gateway-agent`,
            { headers: { Authorization: "Bearer op-key" } }
        );
        assert.equal(listRes.status, 200);
        const listPayload = await listRes.json();
        assert.equal(listPayload.length, 1);
        assert.equal(listPayload[0].bindingName, "gateway-public");
        assert.deepEqual(listPayload[0].contract, { locale: "es-PE" });

        const patchRes = await fetch(
            `${core.baseUrl}/core/workspaces/inspiro-agents/assignments/${tenantPayload.id}/gateway-agent`,
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer op-key",
                },
                body: JSON.stringify({
                    bindingName: "gateway-public-v2",
                    contract: { locale: "es-PE", channel: "web" },
                }),
            }
        );
        assert.equal(patchRes.status, 200);
        const patchPayload = await patchRes.json();
        assert.equal(patchPayload.bindingName, "gateway-public-v2");
        assert.deepEqual(patchPayload.contract, { locale: "es-PE", channel: "web" });

        const relayRes = await fetch(`${core.baseUrl}/core/relay/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer op-key",
            },
            body: JSON.stringify({
                workspaceId: "inspiro-agents",
                tenantId: tenantPayload.id,
                agentId: "gateway-agent",
                messages: [{ role: "user", parts: [{ text: "Hola gateway" }] }],
            }),
        });
        assert.equal(relayRes.status, 200);
        assert.equal(stack.runtimeB.requests.length, 1);
        assert.deepEqual(stack.runtimeB.requests[0].body?.contract, {
            locale: "es-PE",
            channel: "web",
        });
    } finally {
        await teardownStack(stack, core);
    }
});

test("Relay usa chatPath y endpointUrl configurados en el assignment", async () => {
    const stack = await setupStack();
    const runtimePath = await startMockRuntimeServer("path", { chatPath: "/v1/chat" });
    const runtimeAbsolute = await startMockRuntimeServer("absolute", { chatPath: "/runtime/custom" });
    let core = null;
    try {
        core = await startCoreServer({
            registryPath: stack.registryPath,
            keysPath: stack.keysPath,
            llmProxyUrl: `${stack.llmProxy.baseUrl}/llm`,
        });

        const tenantRes = await fetch(`${core.baseUrl}/core/workspaces/inspiro-agents/tenants`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer op-key",
            },
            body: JSON.stringify({ name: "Endpoint Tenant" }),
        });
        assert.equal(tenantRes.status, 201);
        const tenantPayload = await tenantRes.json();

        const endpointRes = await fetch(`${core.baseUrl}/core/workspaces/inspiro-agents/agent-endpoints`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer op-key",
            },
            body: JSON.stringify({
                agentId: "endpoint-agent",
                baseUrl: runtimePath.baseUrl,
                name: "Endpoint Agent",
                type: "chat",
                versionTag: "v1",
            }),
        });
        assert.equal(endpointRes.status, 201);

        const assignmentRes = await fetch(`${core.baseUrl}/core/workspaces/inspiro-agents/assignments`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer op-key",
            },
            body: JSON.stringify({
                tenantId: tenantPayload.id,
                agentId: "endpoint-agent",
                deploymentId: "endpoint-agent-deploy",
                chatPath: "/v1/chat",
            }),
        });
        assert.equal(assignmentRes.status, 201);

        const relayWithPathRes = await fetch(`${core.baseUrl}/core/relay/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer op-key",
            },
            body: JSON.stringify({
                workspaceId: "inspiro-agents",
                tenantId: tenantPayload.id,
                agentId: "endpoint-agent",
                messages: [{ role: "user", parts: [{ text: "Primer mensaje" }] }],
            }),
        });
        assert.equal(relayWithPathRes.status, 200);
        assert.equal(runtimePath.requests.length, 1);
        assert.equal(runtimePath.requests[0].url, "/v1/chat");

        const patchRes = await fetch(
            `${core.baseUrl}/core/workspaces/inspiro-agents/assignments/${tenantPayload.id}/endpoint-agent`,
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer op-key",
                },
                body: JSON.stringify({
                    endpointUrl: `${runtimeAbsolute.baseUrl}/runtime/custom`,
                }),
            }
        );
        assert.equal(patchRes.status, 200);

        const relayWithAbsoluteRes = await fetch(`${core.baseUrl}/core/relay/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer op-key",
            },
            body: JSON.stringify({
                workspaceId: "inspiro-agents",
                tenantId: tenantPayload.id,
                agentId: "endpoint-agent",
                messages: [{ role: "user", parts: [{ text: "Segundo mensaje" }] }],
            }),
        });
        assert.equal(relayWithAbsoluteRes.status, 200);
        assert.equal(runtimePath.requests.length, 1);
        assert.equal(runtimeAbsolute.requests.length, 1);
        assert.equal(runtimeAbsolute.requests[0].url, "/runtime/custom");
    } finally {
        await runtimePath.stop();
        await runtimeAbsolute.stop();
        await teardownStack(stack, core);
    }
});

test("F-08 JWT permite acceso a core/me sin core-key", async () => {
    const stack = await setupStack();
    const jwtSecret = "jwt-test-secret";
    const core = await startCoreServer({
        registryPath: stack.registryPath,
        keysPath: stack.keysPath,
        llmProxyUrl: `${stack.llmProxy.baseUrl}/llm`,
        extraEnv: {
            SWITCHBOARD_AUTH_JWT_ENABLED: "true",
            SWITCHBOARD_AUTH_JWT_SECRET: jwtSecret,
            SWITCHBOARD_AUTH_JWT_ISSUER: "core-auth",
            SWITCHBOARD_AUTH_JWT_AUDIENCE: "core-switchboard",
        },
    });
    try {
        const now = Math.floor(Date.now() / 1000);
        const jwt = signHs256Jwt(
            {
                iss: "core-auth",
                aud: "core-switchboard",
                sub: "user-frontend",
                roles: ["operador-cuenta"],
                allowedWorkspaces: ["inspiro-agents"],
                defaultWorkspaceId: "inspiro-agents",
                iat: now - 10,
                exp: now + 300,
            },
            jwtSecret
        );
        const meResponse = await fetch(`${core.baseUrl}/core/me`, {
            headers: { Authorization: `Bearer ${jwt}` },
        });
        assert.equal(meResponse.status, 200);
        const mePayload = await meResponse.json();
        assert.equal(mePayload.subject, "user-frontend");
        assert.deepEqual(mePayload.allowedWorkspaces, ["inspiro-agents"]);

        const workspacesResponse = await fetch(`${core.baseUrl}/core/workspaces`, {
            headers: { Authorization: `Bearer ${jwt}` },
        });
        assert.equal(workspacesResponse.status, 200);
        const workspaces = await workspacesResponse.json();
        assert.equal(workspaces.length, 1);
        assert.equal(workspaces[0].id, "inspiro-agents");
    } finally {
        await teardownStack(stack, core);
    }
});

test("Master account gestiona /core/auth/users y bloquea no-master", async () => {
    const stack = await setupStack();
    const jwtSecret = "jwt-master-secret";
    const core = await startCoreServer({
        registryPath: stack.registryPath,
        keysPath: stack.keysPath,
        llmProxyUrl: `${stack.llmProxy.baseUrl}/llm`,
        extraEnv: {
            SWITCHBOARD_AUTH_JWT_ENABLED: "true",
            SWITCHBOARD_AUTH_JWT_ONLY: "true",
            SWITCHBOARD_AUTH_JWT_SECRET: jwtSecret,
            SWITCHBOARD_AUTH_JWT_ISSUER: "core-auth",
            SWITCHBOARD_AUTH_JWT_AUDIENCE: "core-switchboard",
            CORE_AUTH_MASTER_EMAILS: "alvaro.e.mur@gmail.com",
            CORE_AUTH_LEGACY_EMAIL_ALLOWLIST_FALLBACK: "false",
        },
    });
    try {
        const now = Math.floor(Date.now() / 1000);
        const masterJwt = signHs256Jwt(
            {
                iss: "core-auth",
                aud: "core-switchboard",
                sub: "user-master",
                email: "alvaro.e.mur@gmail.com",
                roles: ["admin-tecnico"],
                iat: now - 10,
                exp: now + 300,
            },
            jwtSecret
        );
        const nonMasterJwt = signHs256Jwt(
            {
                iss: "core-auth",
                aud: "core-switchboard",
                sub: "user-not-master",
                email: "someone@example.com",
                roles: ["admin-tecnico"],
                iat: now - 10,
                exp: now + 300,
            },
            jwtSecret
        );

        const createRes = await fetch(`${core.baseUrl}/core/auth/users`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${masterJwt}`,
            },
            body: JSON.stringify({
                email: "reader@example.com",
                role: "lector-cuenta",
                allowedAccounts: ["inspiro-agents"],
                defaultAccountId: "inspiro-agents",
            }),
        });
        assert.equal(createRes.status, 201);
        const createdPayload = await createRes.json();
        assert.equal(createdPayload.item?.email, "reader@example.com");
        assert.equal(createdPayload.item?.role, "lector-cuenta");

        const listRes = await fetch(`${core.baseUrl}/core/auth/users`, {
            headers: { Authorization: `Bearer ${masterJwt}` },
        });
        assert.equal(listRes.status, 200);
        const listPayload = await listRes.json();
        assert.ok(Array.isArray(listPayload.items));
        assert.equal(listPayload.items.length, 1);

        const patchRes = await fetch(`${core.baseUrl}/core/auth/users/reader%40example.com`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${masterJwt}`,
            },
            body: JSON.stringify({
                role: "operador-cuenta",
                allowedAccounts: ["inspiro-agents"],
                defaultAccountId: "inspiro-agents",
                status: "active",
            }),
        });
        assert.equal(patchRes.status, 200);
        const patchPayload = await patchRes.json();
        assert.equal(patchPayload.item?.role, "operador-cuenta");

        const forbiddenRes = await fetch(`${core.baseUrl}/core/auth/users`, {
            headers: { Authorization: `Bearer ${nonMasterJwt}` },
        });
        assert.equal(forbiddenRes.status, 403);

        const meRes = await fetch(`${core.baseUrl}/core/me`, {
            headers: { Authorization: `Bearer ${masterJwt}` },
        });
        assert.equal(meRes.status, 200);
        const mePayload = await meRes.json();
        assert.equal(mePayload.email, "alvaro.e.mur@gmail.com");
    } finally {
        await teardownStack(stack, core);
    }
});

test("Assignment audit queda persistido en registry file fallback", async () => {
    const stack = await setupStack();
    const core = await startCoreServer({
        registryPath: stack.registryPath,
        keysPath: stack.keysPath,
        llmProxyUrl: `${stack.llmProxy.baseUrl}/llm`,
    });
    try {
        const response = await fetch(`${core.baseUrl}/core/workspaces/inspiro-agents/assignments/promote`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer op-key",
            },
            body: JSON.stringify({
                tenantId: "aliantza",
                agentId: "aliantza-compras",
                toDeploymentId: "dep-b",
            }),
        });
        assert.equal(response.status, 200);
    } finally {
        await core.stop();
    }
    const persisted = JSON.parse(await readFile(stack.registryPath, "utf8"));
    assert.ok(Array.isArray(persisted.assignment_audit));
    assert.equal(persisted.assignment_audit.length, 1);
    assert.equal(persisted.assignment_audit[0].action, "promote");
    await teardownStack(stack, null);
});
