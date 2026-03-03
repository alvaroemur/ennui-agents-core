/**
 * In-memory registry: workspaces, users, workspace_memberships, tenants, agents, deployments, assignments, runs.
 * Load from JSON file at startup; optional write-back on mutations.
 */

import { readFile, writeFile } from "fs/promises";
import { neon } from "@neondatabase/serverless";

const MAX_RUNS = Number(process.env.SWITCHBOARD_MAX_RUNS || 2000);
const DATABASE_URL = String(
    process.env.SWITCHBOARD_DATABASE_URL ||
    process.env.DATABASE_URL ||
    ""
).trim();

/**
 * @typedef {object} RunRecord
 * @property {string} runId
 * @property {string|null} workspaceId
 * @property {string|null} tenantId
 * @property {string|null} agentId
 * @property {string|null} deploymentId
 * @property {"running"|"success"|"error"} status
 * @property {string} startedAt
 * @property {string|null} finishedAt
 * @property {number|null} durationMs
 * @property {string|null} provider
 * @property {object|null} usage
 * @property {object|null} error
 */

/** @type {{ workspaces: object[], users: object[], workspace_memberships: object[], tenants: object[], agents: object[], deployments: object[], assignments: object[], runs: RunRecord[] }} */
let store = { workspaces: [], users: [], workspace_memberships: [], tenants: [], agents: [], deployments: [], assignments: [], runs: [] };

let registryPath = null;
let sqlClient = null;
let dbInitPromise = null;
let dbInitWarningShown = false;

function hasDbConfigured() {
    return DATABASE_URL.length > 0;
}

function parseDbJson(raw) {
    if (raw == null) return null;
    if (typeof raw === "object") return raw;
    if (typeof raw === "string") {
        try {
            return JSON.parse(raw);
        } catch (_) {
            return null;
        }
    }
    return null;
}

function toDbJson(value) {
    return JSON.stringify(value == null ? null : value);
}

async function ensureDbReady() {
    if (!hasDbConfigured()) return false;
    if (sqlClient) return true;
    if (!dbInitPromise) {
        dbInitPromise = (async () => {
            sqlClient = neon(DATABASE_URL);
            await ensureSchema();
        })();
    }
    try {
        await dbInitPromise;
        return true;
    } catch (error) {
        sqlClient = null;
        dbInitPromise = null;
        if (!dbInitWarningShown) {
            dbInitWarningShown = true;
            console.warn("Switchboard: Neon unavailable, fallback to file registry.", error?.message || String(error));
        }
        return false;
    }
}

async function ensureSchema() {
    await sqlClient`
        CREATE TABLE IF NOT EXISTS switchboard_workspaces (
            id text PRIMARY KEY,
            data jsonb NOT NULL
        )
    `;
    await sqlClient`
        CREATE TABLE IF NOT EXISTS switchboard_users (
            id text PRIMARY KEY,
            data jsonb NOT NULL
        )
    `;
    await sqlClient`
        CREATE TABLE IF NOT EXISTS switchboard_workspace_memberships (
            workspace_id text NOT NULL,
            user_id text NOT NULL,
            data jsonb NOT NULL,
            PRIMARY KEY (workspace_id, user_id)
        )
    `;
    await sqlClient`
        CREATE TABLE IF NOT EXISTS switchboard_tenants (
            id text PRIMARY KEY,
            workspace_id text NOT NULL,
            data jsonb NOT NULL
        )
    `;
    await sqlClient`
        CREATE TABLE IF NOT EXISTS switchboard_agents (
            id text PRIMARY KEY,
            data jsonb NOT NULL
        )
    `;
    await sqlClient`
        CREATE TABLE IF NOT EXISTS switchboard_deployments (
            id text PRIMARY KEY,
            workspace_id text,
            data jsonb NOT NULL
        )
    `;
    await sqlClient`
        CREATE TABLE IF NOT EXISTS switchboard_assignments (
            tenant_id text NOT NULL,
            agent_id text NOT NULL,
            deployment_id text,
            data jsonb NOT NULL,
            PRIMARY KEY (tenant_id, agent_id)
        )
    `;
    await sqlClient`
        CREATE TABLE IF NOT EXISTS switchboard_runs (
            run_id text PRIMARY KEY,
            workspace_id text,
            tenant_id text,
            agent_id text,
            deployment_id text,
            status text NOT NULL,
            started_at timestamptz NOT NULL,
            finished_at timestamptz,
            duration_ms integer,
            provider text,
            usage jsonb,
            error jsonb,
            data jsonb NOT NULL
        )
    `;
    await sqlClient`
        CREATE INDEX IF NOT EXISTS idx_switchboard_runs_started_at
        ON switchboard_runs (started_at DESC)
    `;
    await sqlClient`
        CREATE INDEX IF NOT EXISTS idx_switchboard_runs_workspace_status
        ON switchboard_runs (workspace_id, status)
    `;
}

async function pruneRunsDb() {
    await sqlClient`
        DELETE FROM switchboard_runs
        WHERE run_id IN (
            SELECT run_id
            FROM switchboard_runs
            ORDER BY started_at DESC
            OFFSET ${MAX_RUNS}
        )
    `;
}

function normalizeBasicRecord(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return { ...data };
}

async function writeSnapshotToDb(snapshot) {
    await sqlClient`DELETE FROM switchboard_assignments`;
    await sqlClient`DELETE FROM switchboard_deployments`;
    await sqlClient`DELETE FROM switchboard_agents`;
    await sqlClient`DELETE FROM switchboard_tenants`;
    await sqlClient`DELETE FROM switchboard_workspace_memberships`;
    await sqlClient`DELETE FROM switchboard_users`;
    await sqlClient`DELETE FROM switchboard_workspaces`;
    await sqlClient`DELETE FROM switchboard_runs`;

    for (const ws of snapshot.workspaces || []) {
        const normalized = normalizeBasicRecord(ws);
        if (!normalized?.id) continue;
        await sqlClient`
            INSERT INTO switchboard_workspaces (id, data)
            VALUES (${String(normalized.id)}, ${toDbJson(normalized)}::jsonb)
        `;
    }
    for (const usr of snapshot.users || []) {
        const normalized = normalizeBasicRecord(usr);
        if (!normalized?.id) continue;
        await sqlClient`
            INSERT INTO switchboard_users (id, data)
            VALUES (${String(normalized.id)}, ${toDbJson(normalized)}::jsonb)
        `;
    }
    for (const mem of snapshot.workspace_memberships || []) {
        const normalized = normalizeBasicRecord(mem);
        const wsId = normalized?.workspaceId != null ? String(normalized.workspaceId) : "";
        const uId = normalized?.userId != null ? String(normalized.userId) : "";
        if (!wsId || !uId) continue;
        await sqlClient`
            INSERT INTO switchboard_workspace_memberships (workspace_id, user_id, data)
            VALUES (${wsId}, ${uId}, ${toDbJson(normalized)}::jsonb)
        `;
    }
    for (const tenant of snapshot.tenants || []) {
        const normalized = normalizeBasicRecord(tenant);
        if (!normalized?.id) continue;
        const wsId = normalized.workspaceId != null ? String(normalized.workspaceId) : "";
        await sqlClient`
            INSERT INTO switchboard_tenants (id, workspace_id, data)
            VALUES (${String(normalized.id)}, ${wsId}, ${toDbJson(normalized)}::jsonb)
        `;
    }
    for (const agent of snapshot.agents || []) {
        const normalized = normalizeBasicRecord(agent);
        if (!normalized?.id) continue;
        await sqlClient`
            INSERT INTO switchboard_agents (id, data)
            VALUES (${String(normalized.id)}, ${toDbJson(normalized)}::jsonb)
        `;
    }
    for (const deployment of snapshot.deployments || []) {
        const normalized = normalizeBasicRecord(deployment);
        if (!normalized?.id) continue;
        const wsId = normalized.workspaceId != null ? String(normalized.workspaceId) : null;
        await sqlClient`
            INSERT INTO switchboard_deployments (id, workspace_id, data)
            VALUES (${String(normalized.id)}, ${wsId}, ${toDbJson(normalized)}::jsonb)
        `;
    }
    for (const assignment of snapshot.assignments || []) {
        const normalized = normalizeBasicRecord(assignment);
        const tenantId = normalized?.tenantId != null ? String(normalized.tenantId) : "";
        const agentId = normalized?.agentId != null ? String(normalized.agentId) : "";
        if (!tenantId || !agentId) continue;
        const deploymentId = normalized.deploymentId != null ? String(normalized.deploymentId) : null;
        await sqlClient`
            INSERT INTO switchboard_assignments (tenant_id, agent_id, deployment_id, data)
            VALUES (${tenantId}, ${agentId}, ${deploymentId}, ${toDbJson(normalized)}::jsonb)
        `;
    }
    for (const run of snapshot.runs || []) {
        const normalized = normalizeRun(run);
        await upsertRunDb(normalized);
    }
    await pruneRunsDb();
}

async function readSnapshotFromDb() {
    const [
        workspacesRows,
        usersRows,
        membershipsRows,
        tenantsRows,
        agentsRows,
        deploymentsRows,
        assignmentsRows,
        runsRows
    ] = await Promise.all([
        sqlClient`SELECT data FROM switchboard_workspaces ORDER BY id`,
        sqlClient`SELECT data FROM switchboard_users ORDER BY id`,
        sqlClient`SELECT data FROM switchboard_workspace_memberships ORDER BY workspace_id, user_id`,
        sqlClient`SELECT data FROM switchboard_tenants ORDER BY id`,
        sqlClient`SELECT data FROM switchboard_agents ORDER BY id`,
        sqlClient`SELECT data FROM switchboard_deployments ORDER BY id`,
        sqlClient`SELECT data FROM switchboard_assignments ORDER BY tenant_id, agent_id`,
        sqlClient`SELECT data FROM switchboard_runs ORDER BY started_at DESC`,
    ]);
    return {
        workspaces: workspacesRows.map((r) => parseDbJson(r.data)).filter(Boolean),
        users: usersRows.map((r) => parseDbJson(r.data)).filter(Boolean),
        workspace_memberships: membershipsRows.map((r) => parseDbJson(r.data)).filter(Boolean),
        tenants: tenantsRows.map((r) => parseDbJson(r.data)).filter(Boolean),
        agents: agentsRows.map((r) => parseDbJson(r.data)).filter(Boolean),
        deployments: deploymentsRows.map((r) => parseDbJson(r.data)).filter(Boolean),
        assignments: assignmentsRows.map((r) => parseDbJson(r.data)).filter(Boolean),
        runs: runsRows.map((r) => normalizeRun(parseDbJson(r.data))).filter(Boolean),
    };
}

async function maybeSeedDbFromJson(path) {
    const rows = await sqlClient`
        SELECT
            (SELECT COUNT(*)::int FROM switchboard_workspaces) AS workspaces_count,
            (SELECT COUNT(*)::int FROM switchboard_tenants) AS tenants_count,
            (SELECT COUNT(*)::int FROM switchboard_agents) AS agents_count,
            (SELECT COUNT(*)::int FROM switchboard_deployments) AS deployments_count,
            (SELECT COUNT(*)::int FROM switchboard_assignments) AS assignments_count,
            (SELECT COUNT(*)::int FROM switchboard_runs) AS runs_count
    `;
    const info = rows?.[0] || {};
    const total =
        Number(info.workspaces_count || 0) +
        Number(info.tenants_count || 0) +
        Number(info.agents_count || 0) +
        Number(info.deployments_count || 0) +
        Number(info.assignments_count || 0) +
        Number(info.runs_count || 0);
    if (total > 0 || !path) return;
    try {
        const raw = await readFile(path, "utf8");
        const data = JSON.parse(raw);
        const seed = {
            workspaces: Array.isArray(data.workspaces) ? data.workspaces : (Array.isArray(data.accounts) ? data.accounts : []),
            users: Array.isArray(data.users) ? data.users : [],
            workspace_memberships: Array.isArray(data.workspace_memberships) ? data.workspace_memberships : [],
            tenants: Array.isArray(data.tenants) ? data.tenants : [],
            agents: Array.isArray(data.agents) ? data.agents : [],
            deployments: Array.isArray(data.deployments) ? data.deployments : [],
            assignments: Array.isArray(data.assignments) ? data.assignments : [],
            runs: Array.isArray(data.runs) ? data.runs : [],
        };
        await writeSnapshotToDb(seed);
    } catch (_) {
        // No seed file available; start with empty DB state.
    }
}

function mustHaveId(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return "";
    const id = data.id != null ? String(data.id).trim() : "";
    return id;
}

export function setRegistryPath(path) {
    registryPath = path;
}

export function getStore() {
    return store;
}

/**
 * @param {string} [path]
 */
export async function loadRegistry(path = registryPath) {
    if (await ensureDbReady()) {
        await maybeSeedDbFromJson(path);
        store = await readSnapshotFromDb();
        trimRuns();
        return store;
    }
    if (!path) return store;
    try {
        const raw = await readFile(path, "utf8");
        const data = JSON.parse(raw);
        store = {
            workspaces: Array.isArray(data.workspaces) ? data.workspaces : (Array.isArray(data.accounts) ? data.accounts : []),
            users: Array.isArray(data.users) ? data.users : [],
            workspace_memberships: Array.isArray(data.workspace_memberships) ? data.workspace_memberships : [],
            tenants: Array.isArray(data.tenants) ? data.tenants : [],
            agents: data.agents || [],
            deployments: data.deployments || [],
            assignments: data.assignments || [],
            runs: data.runs || [],
        };
        trimRuns();
        return store;
    } catch (e) {
        console.warn("Switchboard: could not load registry from", path, e?.message);
        return store;
    }
}

export async function saveRegistry() {
    if (await ensureDbReady()) {
        await pruneRunsDb();
        return;
    }
    if (!registryPath) return;
    try {
        await writeFile(registryPath, JSON.stringify(store, null, 2), "utf8");
    } catch (e) {
        console.warn("Switchboard: could not save registry", e?.message);
    }
}

function toMillis(value) {
    if (!value || typeof value !== "string") return 0;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
}

function trimRuns() {
    if (!Array.isArray(store.runs)) store.runs = [];
    if (store.runs.length <= MAX_RUNS) return;
    store.runs = [...store.runs]
        .sort((a, b) => toMillis(b?.startedAt) - toMillis(a?.startedAt))
        .slice(0, MAX_RUNS);
}

function toInt(value, fallback) {
    if (value == null || value === "") return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.trunc(n);
}

function normalizeIso(value) {
    if (!value || typeof value !== "string") return null;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString();
}

function normalizeRun(record) {
    return {
        runId: String(record.runId),
        workspaceId: record.workspaceId ? String(record.workspaceId) : (record.accountId ? String(record.accountId) : null),
        tenantId: record.tenantId ? String(record.tenantId) : null,
        agentId: record.agentId ? String(record.agentId) : null,
        deploymentId: record.deploymentId ? String(record.deploymentId) : null,
        status: record.status === "success" || record.status === "error" ? record.status : "running",
        startedAt: normalizeIso(record.startedAt) || new Date().toISOString(),
        finishedAt: normalizeIso(record.finishedAt),
        durationMs:
            Number.isFinite(Number(record.durationMs)) && Number(record.durationMs) >= 0
                ? Math.round(Number(record.durationMs))
                : null,
        provider: record.provider ? String(record.provider) : null,
        usage:
            record.usage && typeof record.usage === "object" && !Array.isArray(record.usage)
                ? record.usage
                : null,
        error:
            record.error && typeof record.error === "object" && !Array.isArray(record.error)
                ? record.error
                : null,
    };
}

function calcDurationMs(startedAt, finishedAt) {
    const start = toMillis(startedAt);
    const end = toMillis(finishedAt);
    if (!start || end === 0) return null;
    return Math.max(0, end - start);
}

export async function findAssignment(tenantId, agentId) {
    if (await ensureDbReady()) {
        return getAssignment(tenantId, agentId);
    }
    return store.assignments.find(
        (a) => a.tenantId === tenantId && a.agentId === agentId
    );
}

export async function findDeployment(id) {
    if (await ensureDbReady()) {
        return getDeployment(id);
    }
    return store.deployments.find((d) => d.id === id);
}

export async function resolveEndpoint(tenantId, agentId) {
    const assignment = await findAssignment(tenantId, agentId);
    if (!assignment) return null;
    const deployment = await findDeployment(assignment.deploymentId);
    if (!deployment) return null;
    return deployment.baseUrl;
}

// CRUD helpers for registry API

// WORKSPACES
export async function listWorkspaces() {
    if (await ensureDbReady()) {
        const rows = await sqlClient`SELECT data FROM switchboard_workspaces ORDER BY id`;
        return rows.map((r) => parseDbJson(r.data)).filter(Boolean);
    }
    return store.workspaces;
}
export async function getWorkspace(id) {
    if (await ensureDbReady()) {
        const rows = await sqlClient`
            SELECT data
            FROM switchboard_workspaces
            WHERE id = ${String(id)}
            LIMIT 1
        `;
        return rows.length ? parseDbJson(rows[0].data) : undefined;
    }
    return store.workspaces.find((a) => a.id === id);
}
export async function createWorkspace(data) {
    const id = mustHaveId(data);
    if (!id) return null;
    if (await ensureDbReady()) {
        const payload = { ...data, id };
        const rows = await sqlClient`
            INSERT INTO switchboard_workspaces (id, data)
            VALUES (${id}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (id) DO NOTHING
            RETURNING data
        `;
        return rows.length ? parseDbJson(rows[0].data) : null;
    }
    if (await getWorkspace(id)) return null;
    store.workspaces.push(data);
    return data;
}
export async function updateWorkspace(id, data) {
    if (await ensureDbReady()) {
        const current = await getWorkspace(id);
        if (!current) return null;
        const payload = { ...current, ...data, id: String(id) };
        await sqlClient`
            INSERT INTO switchboard_workspaces (id, data)
            VALUES (${String(id)}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (id) DO UPDATE
            SET data = EXCLUDED.data
        `;
        return payload;
    }
    const i = store.workspaces.findIndex((a) => a.id === id);
    if (i < 0) return null;
    store.workspaces[i] = { ...store.workspaces[i], ...data };
    return store.workspaces[i];
}
export async function deleteWorkspace(id) {
    if (await ensureDbReady()) {
        const deleted = await sqlClient`
            DELETE FROM switchboard_workspaces
            WHERE id = ${String(id)}
            RETURNING id
        `;
        if (!deleted.length) return false;
        await sqlClient`DELETE FROM switchboard_tenants WHERE workspace_id = ${String(id)}`;
        return true;
    }
    const i = store.workspaces.findIndex((a) => a.id === id);
    if (i < 0) return false;
    store.workspaces.splice(i, 1);
    store.tenants = store.tenants.filter((t) => t.workspaceId !== id);
    return true;
}

// USERS
export async function listUsers() {
    if (await ensureDbReady()) {
        const rows = await sqlClient`SELECT data FROM switchboard_users ORDER BY id`;
        return rows.map((r) => parseDbJson(r.data)).filter(Boolean);
    }
    return store.users;
}
export async function getUser(id) {
    if (await ensureDbReady()) {
        const rows = await sqlClient`
            SELECT data
            FROM switchboard_users
            WHERE id = ${String(id)}
            LIMIT 1
        `;
        return rows.length ? parseDbJson(rows[0].data) : undefined;
    }
    return store.users.find((u) => u.id === id);
}
export async function createUser(data) {
    const id = mustHaveId(data);
    if (!id) return null;
    if (await ensureDbReady()) {
        const payload = { ...data, id };
        const rows = await sqlClient`
            INSERT INTO switchboard_users (id, data)
            VALUES (${id}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (id) DO NOTHING
            RETURNING data
        `;
        return rows.length ? parseDbJson(rows[0].data) : null;
    }
    if (await getUser(id)) return null;
    store.users.push(data);
    return data;
}

// WORKSPACE MEMBERSHIPS
export async function listWorkspaceMemberships(workspaceId = null, userId = null) {
    if (await ensureDbReady()) {
        let q;
        if (workspaceId && userId) {
            q = sqlClient`SELECT data FROM switchboard_workspace_memberships WHERE workspace_id = ${String(workspaceId)} AND user_id = ${String(userId)}`;
        } else if (workspaceId) {
            q = sqlClient`SELECT data FROM switchboard_workspace_memberships WHERE workspace_id = ${String(workspaceId)}`;
        } else if (userId) {
            q = sqlClient`SELECT data FROM switchboard_workspace_memberships WHERE user_id = ${String(userId)}`;
        } else {
            q = sqlClient`SELECT data FROM switchboard_workspace_memberships`;
        }
        const rows = await q;
        return rows.map((r) => parseDbJson(r.data)).filter(Boolean);
    }
    let res = store.workspace_memberships;
    if (workspaceId) res = res.filter((m) => m.workspaceId === workspaceId);
    if (userId) res = res.filter((m) => m.userId === userId);
    return res;
}
export async function createWorkspaceMembership(data) {
    const workspaceId = data?.workspaceId != null ? String(data.workspaceId).trim() : "";
    const userId = data?.userId != null ? String(data.userId).trim() : "";
    if (!workspaceId || !userId) return null;
    if (await ensureDbReady()) {
        const payload = { ...data, workspaceId, userId };
        const rows = await sqlClient`
            INSERT INTO switchboard_workspace_memberships (workspace_id, user_id, data)
            VALUES (${workspaceId}, ${userId}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (workspace_id, user_id) DO NOTHING
            RETURNING data
        `;
        return rows.length ? parseDbJson(rows[0].data) : null;
    }
    const exists = store.workspace_memberships.find(m => m.workspaceId === workspaceId && m.userId === userId);
    if (exists) return null;
    const payload = { ...data, workspaceId, userId };
    store.workspace_memberships.push(payload);
    return payload;
}

// TENANTS
export async function listTenants(workspaceId = null) {
    if (await ensureDbReady()) {
        const rows = workspaceId
            ? await sqlClient`SELECT data FROM switchboard_tenants WHERE workspace_id = ${String(workspaceId)} ORDER BY id`
            : await sqlClient`SELECT data FROM switchboard_tenants ORDER BY id`;
        return rows.map((r) => parseDbJson(r.data)).filter(Boolean);
    }
    if (workspaceId) return store.tenants.filter((t) => t.workspaceId === workspaceId);
    return store.tenants;
}
export async function getTenant(id) {
    if (await ensureDbReady()) {
        const rows = await sqlClient`
            SELECT data
            FROM switchboard_tenants
            WHERE id = ${String(id)}
            LIMIT 1
        `;
        return rows.length ? parseDbJson(rows[0].data) : undefined;
    }
    return store.tenants.find((t) => t.id === id);
}
export async function createTenant(data) {
    const id = mustHaveId(data);
    if (!id) return null;
    if (await ensureDbReady()) {
        const payload = { ...data, id };
        const workspaceId = payload.workspaceId != null ? String(payload.workspaceId) : "";
        const rows = await sqlClient`
            INSERT INTO switchboard_tenants (id, workspace_id, data)
            VALUES (${id}, ${workspaceId}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (id) DO NOTHING
            RETURNING data
        `;
        return rows.length ? parseDbJson(rows[0].data) : null;
    }
    if (await getTenant(id)) return null;
    store.tenants.push(data);
    return data;
}
export async function updateTenant(id, data) {
    if (await ensureDbReady()) {
        const current = await getTenant(id);
        if (!current) return null;
        const payload = { ...current, ...data, id: String(id) };
        const workspaceId = payload.workspaceId != null ? String(payload.workspaceId) : "";
        await sqlClient`
            INSERT INTO switchboard_tenants (id, workspace_id, data)
            VALUES (${String(id)}, ${workspaceId}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (id) DO UPDATE
            SET
                workspace_id = EXCLUDED.workspace_id,
                data = EXCLUDED.data
        `;
        return payload;
    }
    const i = store.tenants.findIndex((t) => t.id === id);
    if (i < 0) return null;
    store.tenants[i] = { ...store.tenants[i], ...data };
    return store.tenants[i];
}
export async function deleteTenant(id) {
    if (await ensureDbReady()) {
        const deleted = await sqlClient`
            DELETE FROM switchboard_tenants
            WHERE id = ${String(id)}
            RETURNING id
        `;
        if (!deleted.length) return false;
        await sqlClient`
            DELETE FROM switchboard_assignments
            WHERE tenant_id = ${String(id)}
        `;
        return true;
    }
    const i = store.tenants.findIndex((t) => t.id === id);
    if (i < 0) return false;
    store.tenants.splice(i, 1);
    store.assignments = store.assignments.filter((a) => a.tenantId !== id);
    return true;
}

// AGENTS
export async function listAgents() {
    if (await ensureDbReady()) {
        const rows = await sqlClient`SELECT data FROM switchboard_agents ORDER BY id`;
        return rows.map((r) => parseDbJson(r.data)).filter(Boolean);
    }
    return store.agents;
}
export async function getAgent(id) {
    if (await ensureDbReady()) {
        const rows = await sqlClient`
            SELECT data
            FROM switchboard_agents
            WHERE id = ${String(id)}
            LIMIT 1
        `;
        return rows.length ? parseDbJson(rows[0].data) : undefined;
    }
    return store.agents.find((a) => a.id === id);
}
export async function createAgent(data) {
    const id = mustHaveId(data);
    if (!id) return null;
    if (await ensureDbReady()) {
        const payload = { ...data, id };
        const rows = await sqlClient`
            INSERT INTO switchboard_agents (id, data)
            VALUES (${id}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (id) DO NOTHING
            RETURNING data
        `;
        return rows.length ? parseDbJson(rows[0].data) : null;
    }
    if (await getAgent(id)) return null;
    store.agents.push(data);
    return data;
}
export async function updateAgent(id, data) {
    if (await ensureDbReady()) {
        const current = await getAgent(id);
        if (!current) return null;
        const payload = { ...current, ...data, id: String(id) };
        await sqlClient`
            INSERT INTO switchboard_agents (id, data)
            VALUES (${String(id)}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (id) DO UPDATE
            SET data = EXCLUDED.data
        `;
        return payload;
    }
    const i = store.agents.findIndex((a) => a.id === id);
    if (i < 0) return null;
    store.agents[i] = { ...store.agents[i], ...data };
    return store.agents[i];
}
export async function deleteAgent(id) {
    if (await ensureDbReady()) {
        const deleted = await sqlClient`
            DELETE FROM switchboard_agents
            WHERE id = ${String(id)}
            RETURNING id
        `;
        if (!deleted.length) return false;
        await sqlClient`
            DELETE FROM switchboard_assignments
            WHERE agent_id = ${String(id)}
        `;
        return true;
    }
    const i = store.agents.findIndex((a) => a.id === id);
    if (i < 0) return false;
    store.agents.splice(i, 1);
    store.assignments = store.assignments.filter((a) => a.agentId !== id);
    return true;
}

// DEPLOYMENTS
export async function listDeployments(workspaceId = null) {
    if (await ensureDbReady()) {
        const rows = workspaceId
            ? await sqlClient`
                SELECT data
                FROM switchboard_deployments
                WHERE workspace_id = ${String(workspaceId)}
                ORDER BY id
            `
            : await sqlClient`SELECT data FROM switchboard_deployments ORDER BY id`;
        return rows.map((r) => parseDbJson(r.data)).filter(Boolean);
    }
    if (workspaceId) return store.deployments.filter((d) => d.workspaceId === workspaceId);
    return store.deployments;
}
export async function getDeployment(id) {
    if (await ensureDbReady()) {
        const rows = await sqlClient`
            SELECT data
            FROM switchboard_deployments
            WHERE id = ${String(id)}
            LIMIT 1
        `;
        return rows.length ? parseDbJson(rows[0].data) : undefined;
    }
    return store.deployments.find((d) => d.id === id);
}
export async function createDeployment(data) {
    const id = mustHaveId(data);
    if (!id) return null;
    if (await ensureDbReady()) {
        const payload = { ...data, id };
        const workspaceId = payload.workspaceId != null ? String(payload.workspaceId) : null;
        const rows = await sqlClient`
            INSERT INTO switchboard_deployments (id, workspace_id, data)
            VALUES (${id}, ${workspaceId}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (id) DO NOTHING
            RETURNING data
        `;
        return rows.length ? parseDbJson(rows[0].data) : null;
    }
    if (await getDeployment(id)) return null;
    store.deployments.push(data);
    return data;
}
export async function updateDeployment(id, data) {
    if (await ensureDbReady()) {
        const current = await getDeployment(id);
        if (!current) return null;
        const payload = { ...current, ...data, id: String(id) };
        const workspaceId = payload.workspaceId != null ? String(payload.workspaceId) : null;
        await sqlClient`
            INSERT INTO switchboard_deployments (id, workspace_id, data)
            VALUES (${String(id)}, ${workspaceId}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (id) DO UPDATE
            SET
                workspace_id = EXCLUDED.workspace_id,
                data = EXCLUDED.data
        `;
        return payload;
    }
    const i = store.deployments.findIndex((d) => d.id === id);
    if (i < 0) return null;
    store.deployments[i] = { ...store.deployments[i], ...data };
    return store.deployments[i];
}
export async function deleteDeployment(id) {
    if (await ensureDbReady()) {
        const deleted = await sqlClient`
            DELETE FROM switchboard_deployments
            WHERE id = ${String(id)}
            RETURNING id
        `;
        if (!deleted.length) return false;
        await sqlClient`
            DELETE FROM switchboard_assignments
            WHERE deployment_id = ${String(id)}
        `;
        return true;
    }
    const i = store.deployments.findIndex((d) => d.id === id);
    if (i < 0) return false;
    store.deployments.splice(i, 1);
    store.assignments = store.assignments.filter((a) => a.deploymentId === id);
    return true;
}

// ASSIGNMENTS
export async function listAssignments(tenantId = null) {
    if (await ensureDbReady()) {
        const rows = tenantId
            ? await sqlClient`
                SELECT data
                FROM switchboard_assignments
                WHERE tenant_id = ${String(tenantId)}
                ORDER BY tenant_id, agent_id
            `
            : await sqlClient`SELECT data FROM switchboard_assignments ORDER BY tenant_id, agent_id`;
        return rows.map((r) => parseDbJson(r.data)).filter(Boolean);
    }
    if (tenantId) return store.assignments.filter((a) => a.tenantId === tenantId);
    return store.assignments;
}
export async function getAssignment(tenantId, agentId) {
    if (await ensureDbReady()) {
        const rows = await sqlClient`
            SELECT data
            FROM switchboard_assignments
            WHERE tenant_id = ${String(tenantId)}
              AND agent_id = ${String(agentId)}
            LIMIT 1
        `;
        return rows.length ? parseDbJson(rows[0].data) : undefined;
    }
    return findAssignment(tenantId, agentId);
}
export async function createAssignment(data) {
    const tenantId = data?.tenantId != null ? String(data.tenantId).trim() : "";
    const agentId = data?.agentId != null ? String(data.agentId).trim() : "";
    if (!tenantId || !agentId) return null;
    if (await ensureDbReady()) {
        const payload = { ...data, tenantId, agentId };
        const deploymentId = payload.deploymentId != null ? String(payload.deploymentId) : null;
        const rows = await sqlClient`
            INSERT INTO switchboard_assignments (tenant_id, agent_id, deployment_id, data)
            VALUES (${tenantId}, ${agentId}, ${deploymentId}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (tenant_id, agent_id) DO NOTHING
            RETURNING data
        `;
        return rows.length ? parseDbJson(rows[0].data) : null;
    }
    if (await getAssignment(tenantId, agentId)) return null;
    const payload = { ...data, tenantId, agentId };
    store.assignments.push(payload);
    return payload;
}
export async function updateAssignment(tenantId, agentId, data) {
    if (await ensureDbReady()) {
        const current = await getAssignment(tenantId, agentId);
        if (!current) return null;
        const payload = { ...current, ...data, tenantId: String(tenantId), agentId: String(agentId) };
        const deploymentId = payload.deploymentId != null ? String(payload.deploymentId) : null;
        await sqlClient`
            INSERT INTO switchboard_assignments (tenant_id, agent_id, deployment_id, data)
            VALUES (${String(tenantId)}, ${String(agentId)}, ${deploymentId}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (tenant_id, agent_id) DO UPDATE
            SET
                deployment_id = EXCLUDED.deployment_id,
                data = EXCLUDED.data
        `;
        return payload;
    }
    const a = await findAssignment(tenantId, agentId);
    if (!a) return null;
    if (data.deploymentId !== undefined) a.deploymentId = data.deploymentId;
    return a;
}
export async function deleteAssignment(tenantId, agentId) {
    if (await ensureDbReady()) {
        const deleted = await sqlClient`
            DELETE FROM switchboard_assignments
            WHERE tenant_id = ${String(tenantId)}
              AND agent_id = ${String(agentId)}
            RETURNING tenant_id
        `;
        return deleted.length > 0;
    }
    const i = store.assignments.findIndex(
        (a) => a.tenantId === tenantId && a.agentId === agentId
    );
    if (i < 0) return false;
    store.assignments.splice(i, 1);
    return true;
}

// RUNS
export async function getRun(runId) {
    if (await ensureDbReady()) {
        const rows = await sqlClient`
            SELECT data
            FROM switchboard_runs
            WHERE run_id = ${String(runId)}
            LIMIT 1
        `;
        return rows.length ? normalizeRun(parseDbJson(rows[0].data)) : undefined;
    }
    return store.runs.find((r) => r.runId === runId);
}

async function upsertRunDb(run) {
    await sqlClient`
        INSERT INTO switchboard_runs (
            run_id,
            workspace_id,
            tenant_id,
            agent_id,
            deployment_id,
            status,
            started_at,
            finished_at,
            duration_ms,
            provider,
            usage,
            error,
            data
        )
        VALUES (
            ${run.runId},
            ${run.workspaceId},
            ${run.tenantId},
            ${run.agentId},
            ${run.deploymentId},
            ${run.status},
            ${run.startedAt}::timestamptz,
            ${run.finishedAt}::timestamptz,
            ${run.durationMs},
            ${run.provider},
            ${toDbJson(run.usage)}::jsonb,
            ${toDbJson(run.error)}::jsonb,
            ${toDbJson(run)}::jsonb
        )
        ON CONFLICT (run_id) DO UPDATE
        SET
            workspace_id = EXCLUDED.workspace_id,
            tenant_id = EXCLUDED.tenant_id,
            agent_id = EXCLUDED.agent_id,
            deployment_id = EXCLUDED.deployment_id,
            status = EXCLUDED.status,
            started_at = EXCLUDED.started_at,
            finished_at = EXCLUDED.finished_at,
            duration_ms = EXCLUDED.duration_ms,
            provider = EXCLUDED.provider,
            usage = EXCLUDED.usage,
            error = EXCLUDED.error,
            data = EXCLUDED.data
    `;
}

export async function createRun(data) {
    if (!data || typeof data !== "object") return null;
    const runId = typeof data.runId === "string" ? data.runId.trim() : "";
    if (!runId) return null;
    if (await getRun(runId)) return null;
    const run = normalizeRun({ ...data, runId });
    if (await ensureDbReady()) {
        await upsertRunDb(run);
        await pruneRunsDb();
        return run;
    }
    store.runs.push(run);
    trimRuns();
    return run;
}

export async function updateRun(runId, patch) {
    if (await ensureDbReady()) {
        const current = await getRun(runId);
        if (!current) return null;
        const next = normalizeRun({
            ...current,
            ...(patch && typeof patch === "object" ? patch : {}),
            runId,
        });
        await upsertRunDb(next);
        await pruneRunsDb();
        return next;
    }
    const idx = store.runs.findIndex((r) => r.runId === runId);
    if (idx < 0) return null;
    const next = normalizeRun({
        ...store.runs[idx],
        ...(patch && typeof patch === "object" ? patch : {}),
    });
    store.runs[idx] = next;
    return next;
}

export async function finalizeRunSuccess(runId, { provider = null, usage = null, finishedAt } = {}) {
    const current = await getRun(runId);
    if (!current) return null;
    const doneAt = normalizeIso(finishedAt) || new Date().toISOString();
    return updateRun(runId, {
        status: "success",
        provider,
        usage,
        error: null,
        finishedAt: doneAt,
        durationMs: calcDurationMs(current.startedAt, doneAt),
    });
}

export async function finalizeRunError(runId, { error = null, provider = null, usage = null, finishedAt } = {}) {
    const current = await getRun(runId);
    if (!current) return null;
    const doneAt = normalizeIso(finishedAt) || new Date().toISOString();
    return updateRun(runId, {
        status: "error",
        provider,
        usage,
        error:
            error && typeof error === "object" && !Array.isArray(error)
                ? error
                : {
                      code: "RUN_ERROR",
                      message: typeof error === "string" ? error : "Run failed",
                  },
        finishedAt: doneAt,
        durationMs: calcDurationMs(current.startedAt, doneAt),
    });
}

/**
 * @param {object} filters
 * @returns {{ items: RunRecord[], total: number, limit: number, offset: number, filters: object }}
 */
export async function listRuns(filters = {}) {
    const normalizedFilters = {
        workspaceId:
            typeof filters.workspaceId === "string" && filters.workspaceId.trim()
                ? filters.workspaceId.trim()
                : (typeof filters.accountId === "string" && filters.accountId.trim() ? filters.accountId.trim() : null),
        tenantId:
            typeof filters.tenantId === "string" && filters.tenantId.trim()
                ? filters.tenantId.trim()
                : null,
        agentId: typeof filters.agentId === "string" && filters.agentId.trim() ? filters.agentId.trim() : null,
        deploymentId:
            typeof filters.deploymentId === "string" && filters.deploymentId.trim()
                ? filters.deploymentId.trim()
                : null,
        status: typeof filters.status === "string" && filters.status.trim() ? filters.status.trim() : null,
        provider: typeof filters.provider === "string" && filters.provider.trim() ? filters.provider.trim() : null,
        from: normalizeIso(filters.from),
        to: normalizeIso(filters.to),
    };
    const limit = Math.min(200, Math.max(1, toInt(filters.limit, 50)));
    const offset = Math.max(0, toInt(filters.offset, 0));

    let items = [];
    if (await ensureDbReady()) {
        const rows = await sqlClient`
            SELECT data
            FROM switchboard_runs
            ORDER BY started_at DESC
        `;
        items = rows
            .map((row) => normalizeRun(parseDbJson(row.data)))
            .filter(Boolean);
    } else {
        items = [...store.runs];
    }
    if (normalizedFilters.workspaceId) {
        items = items.filter((r) => r.workspaceId === normalizedFilters.workspaceId);
    }
    if (normalizedFilters.tenantId) {
        items = items.filter((r) => r.tenantId === normalizedFilters.tenantId);
    }
    if (normalizedFilters.agentId) items = items.filter((r) => r.agentId === normalizedFilters.agentId);
    if (normalizedFilters.deploymentId) items = items.filter((r) => r.deploymentId === normalizedFilters.deploymentId);
    if (normalizedFilters.status) items = items.filter((r) => r.status === normalizedFilters.status);
    if (normalizedFilters.provider) items = items.filter((r) => r.provider === normalizedFilters.provider);
    if (normalizedFilters.from) {
        const fromMs = toMillis(normalizedFilters.from);
        items = items.filter((r) => toMillis(r.startedAt) >= fromMs);
    }
    if (normalizedFilters.to) {
        const toMs = toMillis(normalizedFilters.to);
        items = items.filter((r) => toMillis(r.startedAt) <= toMs);
    }
    items.sort((a, b) => toMillis(b.startedAt) - toMillis(a.startedAt));
    const total = items.length;
    const page = items.slice(offset, offset + limit);
    return {
        items: page,
        total,
        limit,
        offset,
        filters: normalizedFilters,
    };
}
