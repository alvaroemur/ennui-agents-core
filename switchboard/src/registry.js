/**
 * In-memory registry: accounts, agents, deployments, assignments, runs.
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
 * @property {string|null} accountId
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

/** @type {{ accounts: object[], agents: object[], deployments: object[], assignments: object[], runs: RunRecord[] }} */
let store = { accounts: [], agents: [], deployments: [], assignments: [], runs: [] };

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
        CREATE TABLE IF NOT EXISTS switchboard_accounts (
            id text PRIMARY KEY,
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
            account_id text,
            data jsonb NOT NULL
        )
    `;
    await sqlClient`
        CREATE TABLE IF NOT EXISTS switchboard_assignments (
            account_id text NOT NULL,
            agent_id text NOT NULL,
            deployment_id text,
            data jsonb NOT NULL,
            PRIMARY KEY (account_id, agent_id)
        )
    `;
    await sqlClient`
        CREATE TABLE IF NOT EXISTS switchboard_runs (
            run_id text PRIMARY KEY,
            account_id text,
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
        CREATE INDEX IF NOT EXISTS idx_switchboard_runs_account_status
        ON switchboard_runs (account_id, status)
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
    await sqlClient`DELETE FROM switchboard_accounts`;
    await sqlClient`DELETE FROM switchboard_runs`;

    for (const account of snapshot.accounts || []) {
        const normalized = normalizeBasicRecord(account);
        if (!normalized?.id) continue;
        await sqlClient`
            INSERT INTO switchboard_accounts (id, data)
            VALUES (${String(normalized.id)}, ${toDbJson(normalized)}::jsonb)
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
        const accountId = normalized.accountId != null ? String(normalized.accountId) : null;
        await sqlClient`
            INSERT INTO switchboard_deployments (id, account_id, data)
            VALUES (${String(normalized.id)}, ${accountId}, ${toDbJson(normalized)}::jsonb)
        `;
    }
    for (const assignment of snapshot.assignments || []) {
        const normalized = normalizeBasicRecord(assignment);
        const accountId = normalized?.accountId != null ? String(normalized.accountId) : "";
        const agentId = normalized?.agentId != null ? String(normalized.agentId) : "";
        if (!accountId || !agentId) continue;
        const deploymentId = normalized.deploymentId != null ? String(normalized.deploymentId) : null;
        await sqlClient`
            INSERT INTO switchboard_assignments (account_id, agent_id, deployment_id, data)
            VALUES (${accountId}, ${agentId}, ${deploymentId}, ${toDbJson(normalized)}::jsonb)
        `;
    }
    for (const run of snapshot.runs || []) {
        const normalized = normalizeRun(run);
        await upsertRunDb(normalized);
    }
    await pruneRunsDb();
}

async function readSnapshotFromDb() {
    const [accountsRows, agentsRows, deploymentsRows, assignmentsRows, runsRows] = await Promise.all([
        sqlClient`SELECT data FROM switchboard_accounts ORDER BY id`,
        sqlClient`SELECT data FROM switchboard_agents ORDER BY id`,
        sqlClient`SELECT data FROM switchboard_deployments ORDER BY id`,
        sqlClient`SELECT data FROM switchboard_assignments ORDER BY account_id, agent_id`,
        sqlClient`SELECT data FROM switchboard_runs ORDER BY started_at DESC`,
    ]);
    return {
        accounts: accountsRows.map((r) => parseDbJson(r.data)).filter(Boolean),
        agents: agentsRows.map((r) => parseDbJson(r.data)).filter(Boolean),
        deployments: deploymentsRows.map((r) => parseDbJson(r.data)).filter(Boolean),
        assignments: assignmentsRows.map((r) => parseDbJson(r.data)).filter(Boolean),
        runs: runsRows.map((r) => normalizeRun(parseDbJson(r.data))).filter(Boolean),
    };
}

async function maybeSeedDbFromJson(path) {
    const rows = await sqlClient`
        SELECT
            (SELECT COUNT(*)::int FROM switchboard_accounts) AS accounts_count,
            (SELECT COUNT(*)::int FROM switchboard_agents) AS agents_count,
            (SELECT COUNT(*)::int FROM switchboard_deployments) AS deployments_count,
            (SELECT COUNT(*)::int FROM switchboard_assignments) AS assignments_count,
            (SELECT COUNT(*)::int FROM switchboard_runs) AS runs_count
    `;
    const info = rows?.[0] || {};
    const total =
        Number(info.accounts_count || 0) +
        Number(info.agents_count || 0) +
        Number(info.deployments_count || 0) +
        Number(info.assignments_count || 0) +
        Number(info.runs_count || 0);
    if (total > 0 || !path) return;
    try {
        const raw = await readFile(path, "utf8");
        const data = JSON.parse(raw);
        const seed = {
            accounts: Array.isArray(data.accounts) ? data.accounts : [],
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
            accounts: Array.isArray(data.accounts) ? data.accounts : [],
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
        accountId: record.accountId ? String(record.accountId) : null,
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
    if (!start || !end) return null;
    return Math.max(0, end - start);
}

export async function findAssignment(accountId, agentId) {
    if (await ensureDbReady()) {
        return getAssignment(accountId, agentId);
    }
    return store.assignments.find(
        (a) => a.accountId === accountId && a.agentId === agentId
    );
}

export async function findDeployment(id) {
    if (await ensureDbReady()) {
        return getDeployment(id);
    }
    return store.deployments.find((d) => d.id === id);
}

export async function resolveEndpoint(accountId, agentId) {
    const assignment = await findAssignment(accountId, agentId);
    if (!assignment) return null;
    const deployment = await findDeployment(assignment.deploymentId);
    if (!deployment) return null;
    return deployment.baseUrl;
}

// CRUD helpers for registry API
export async function listAccounts() {
    if (await ensureDbReady()) {
        const rows = await sqlClient`SELECT data FROM switchboard_accounts ORDER BY id`;
        return rows.map((r) => parseDbJson(r.data)).filter(Boolean);
    }
    return store.accounts;
}
export async function getAccount(id) {
    if (await ensureDbReady()) {
        const rows = await sqlClient`
            SELECT data
            FROM switchboard_accounts
            WHERE id = ${String(id)}
            LIMIT 1
        `;
        return rows.length ? parseDbJson(rows[0].data) : undefined;
    }
    return store.accounts.find((a) => a.id === id);
}
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
export async function listDeployments(accountId = null) {
    if (await ensureDbReady()) {
        const rows = accountId
            ? await sqlClient`
                SELECT data
                FROM switchboard_deployments
                WHERE account_id = ${String(accountId)}
                ORDER BY id
            `
            : await sqlClient`SELECT data FROM switchboard_deployments ORDER BY id`;
        return rows.map((r) => parseDbJson(r.data)).filter(Boolean);
    }
    if (accountId) return store.deployments.filter((d) => d.accountId === accountId);
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
export async function listAssignments(accountId = null) {
    if (await ensureDbReady()) {
        const rows = accountId
            ? await sqlClient`
                SELECT data
                FROM switchboard_assignments
                WHERE account_id = ${String(accountId)}
                ORDER BY account_id, agent_id
            `
            : await sqlClient`SELECT data FROM switchboard_assignments ORDER BY account_id, agent_id`;
        return rows.map((r) => parseDbJson(r.data)).filter(Boolean);
    }
    if (accountId) return store.assignments.filter((a) => a.accountId === accountId);
    return store.assignments;
}
export async function getAssignment(accountId, agentId) {
    if (await ensureDbReady()) {
        const rows = await sqlClient`
            SELECT data
            FROM switchboard_assignments
            WHERE account_id = ${String(accountId)}
              AND agent_id = ${String(agentId)}
            LIMIT 1
        `;
        return rows.length ? parseDbJson(rows[0].data) : undefined;
    }
    return findAssignment(accountId, agentId);
}

export async function createAccount(data) {
    const id = mustHaveId(data);
    if (!id) return null;
    if (await ensureDbReady()) {
        const payload = { ...data, id };
        const rows = await sqlClient`
            INSERT INTO switchboard_accounts (id, data)
            VALUES (${id}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (id) DO NOTHING
            RETURNING data
        `;
        return rows.length ? parseDbJson(rows[0].data) : null;
    }
    if (await getAccount(id)) return null;
    store.accounts.push(data);
    return data;
}
export async function updateAccount(id, data) {
    if (await ensureDbReady()) {
        const current = await getAccount(id);
        if (!current) return null;
        const payload = { ...current, ...data, id: String(id) };
        await sqlClient`
            INSERT INTO switchboard_accounts (id, data)
            VALUES (${String(id)}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (id) DO UPDATE
            SET data = EXCLUDED.data
        `;
        return payload;
    }
    const i = store.accounts.findIndex((a) => a.id === id);
    if (i < 0) return null;
    store.accounts[i] = { ...store.accounts[i], ...data };
    return store.accounts[i];
}
export async function deleteAccount(id) {
    if (await ensureDbReady()) {
        const deleted = await sqlClient`
            DELETE FROM switchboard_accounts
            WHERE id = ${String(id)}
            RETURNING id
        `;
        if (!deleted.length) return false;
        await sqlClient`
            DELETE FROM switchboard_assignments
            WHERE account_id = ${String(id)}
        `;
        return true;
    }
    const i = store.accounts.findIndex((a) => a.id === id);
    if (i < 0) return false;
    store.accounts.splice(i, 1);
    store.assignments = store.assignments.filter((a) => a.accountId !== id);
    return true;
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

export async function createDeployment(data) {
    const id = mustHaveId(data);
    if (!id) return null;
    if (await ensureDbReady()) {
        const payload = { ...data, id };
        const accountId = payload.accountId != null ? String(payload.accountId) : null;
        const rows = await sqlClient`
            INSERT INTO switchboard_deployments (id, account_id, data)
            VALUES (${id}, ${accountId}, ${toDbJson(payload)}::jsonb)
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
        const accountId = payload.accountId != null ? String(payload.accountId) : null;
        await sqlClient`
            INSERT INTO switchboard_deployments (id, account_id, data)
            VALUES (${String(id)}, ${accountId}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (id) DO UPDATE
            SET
                account_id = EXCLUDED.account_id,
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
    store.assignments = store.assignments.filter((a) => a.deploymentId !== id);
    return true;
}

export async function createAssignment(data) {
    const accountId = data?.accountId != null ? String(data.accountId).trim() : "";
    const agentId = data?.agentId != null ? String(data.agentId).trim() : "";
    if (!accountId || !agentId) return null;
    if (await ensureDbReady()) {
        const payload = { ...data, accountId, agentId };
        const deploymentId = payload.deploymentId != null ? String(payload.deploymentId) : null;
        const rows = await sqlClient`
            INSERT INTO switchboard_assignments (account_id, agent_id, deployment_id, data)
            VALUES (${accountId}, ${agentId}, ${deploymentId}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (account_id, agent_id) DO NOTHING
            RETURNING data
        `;
        return rows.length ? parseDbJson(rows[0].data) : null;
    }
    if (await getAssignment(accountId, agentId)) return null;
    const payload = { ...data, accountId, agentId };
    store.assignments.push(payload);
    return payload;
}
export async function updateAssignment(accountId, agentId, data) {
    if (await ensureDbReady()) {
        const current = await getAssignment(accountId, agentId);
        if (!current) return null;
        const payload = { ...current, ...data, accountId: String(accountId), agentId: String(agentId) };
        const deploymentId = payload.deploymentId != null ? String(payload.deploymentId) : null;
        await sqlClient`
            INSERT INTO switchboard_assignments (account_id, agent_id, deployment_id, data)
            VALUES (${String(accountId)}, ${String(agentId)}, ${deploymentId}, ${toDbJson(payload)}::jsonb)
            ON CONFLICT (account_id, agent_id) DO UPDATE
            SET
                deployment_id = EXCLUDED.deployment_id,
                data = EXCLUDED.data
        `;
        return payload;
    }
    const a = await findAssignment(accountId, agentId);
    if (!a) return null;
    if (data.deploymentId !== undefined) a.deploymentId = data.deploymentId;
    return a;
}
export async function deleteAssignment(accountId, agentId) {
    if (await ensureDbReady()) {
        const deleted = await sqlClient`
            DELETE FROM switchboard_assignments
            WHERE account_id = ${String(accountId)}
              AND agent_id = ${String(agentId)}
            RETURNING account_id
        `;
        return deleted.length > 0;
    }
    const i = store.assignments.findIndex(
        (a) => a.accountId === accountId && a.agentId === agentId
    );
    if (i < 0) return false;
    store.assignments.splice(i, 1);
    return true;
}

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
            account_id,
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
            ${run.accountId},
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
            account_id = EXCLUDED.account_id,
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
        accountId:
            typeof filters.accountId === "string" && filters.accountId.trim()
                ? filters.accountId.trim()
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
    if (normalizedFilters.accountId) {
        items = items.filter((r) => r.accountId === normalizedFilters.accountId);
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
