/**
 * In-memory registry: clients, agents, deployments, assignments.
 * Load from JSON file at startup; optional write-back on mutations.
 */

import { readFile, writeFile } from "fs/promises";

/** @type {{ clients: object[], agents: object[], deployments: object[], assignments: object[] }} */
let store = { clients: [], agents: [], deployments: [], assignments: [] };

let registryPath = null;

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
    if (!path) return store;
    try {
        const raw = await readFile(path, "utf8");
        const data = JSON.parse(raw);
        store = {
            clients: data.clients || [],
            agents: data.agents || [],
            deployments: data.deployments || [],
            assignments: data.assignments || [],
        };
        return store;
    } catch (e) {
        console.warn("Switchboard: could not load registry from", path, e?.message);
        return store;
    }
}

export async function saveRegistry() {
    if (!registryPath) return;
    try {
        await writeFile(registryPath, JSON.stringify(store, null, 2), "utf8");
    } catch (e) {
        console.warn("Switchboard: could not save registry", e?.message);
    }
}

export function findAssignment(clientId, agentId) {
    return store.assignments.find(
        (a) => a.clientId === clientId && a.agentId === agentId
    );
}

export function findDeployment(id) {
    return store.deployments.find((d) => d.id === id);
}

export function resolveEndpoint(clientId, agentId) {
    const assignment = findAssignment(clientId, agentId);
    if (!assignment) return null;
    const deployment = findDeployment(assignment.deploymentId);
    if (!deployment) return null;
    return deployment.baseUrl;
}

// CRUD helpers for registry API
export function listClients() {
    return store.clients;
}
export function getClient(id) {
    return store.clients.find((c) => c.id === id);
}
export function listAgents() {
    return store.agents;
}
export function getAgent(id) {
    return store.agents.find((a) => a.id === id);
}
export function listDeployments(clientId = null) {
    if (clientId) return store.deployments.filter((d) => d.clientId === clientId);
    return store.deployments;
}
export function getDeployment(id) {
    return store.deployments.find((d) => d.id === id);
}
export function listAssignments(clientId = null) {
    if (clientId) return store.assignments.filter((a) => a.clientId === clientId);
    return store.assignments;
}
export function getAssignment(clientId, agentId) {
    return findAssignment(clientId, agentId);
}

export function createClient(data) {
    if (getClient(data.id)) return null;
    store.clients.push(data);
    return data;
}
export function updateClient(id, data) {
    const i = store.clients.findIndex((c) => c.id === id);
    if (i < 0) return null;
    store.clients[i] = { ...store.clients[i], ...data };
    return store.clients[i];
}
export function deleteClient(id) {
    const i = store.clients.findIndex((c) => c.id === id);
    if (i < 0) return false;
    store.clients.splice(i, 1);
    store.assignments = store.assignments.filter((a) => a.clientId !== id);
    return true;
}

export function createAgent(data) {
    if (getAgent(data.id)) return null;
    store.agents.push(data);
    return data;
}
export function updateAgent(id, data) {
    const i = store.agents.findIndex((a) => a.id === id);
    if (i < 0) return null;
    store.agents[i] = { ...store.agents[i], ...data };
    return store.agents[i];
}
export function deleteAgent(id) {
    const i = store.agents.findIndex((a) => a.id === id);
    if (i < 0) return false;
    store.agents.splice(i, 1);
    store.assignments = store.assignments.filter((a) => a.agentId !== id);
    return true;
}

export function createDeployment(data) {
    if (getDeployment(data.id)) return null;
    store.deployments.push(data);
    return data;
}
export function updateDeployment(id, data) {
    const i = store.deployments.findIndex((d) => d.id === id);
    if (i < 0) return null;
    store.deployments[i] = { ...store.deployments[i], ...data };
    return store.deployments[i];
}
export function deleteDeployment(id) {
    const i = store.deployments.findIndex((d) => d.id === id);
    if (i < 0) return false;
    store.deployments.splice(i, 1);
    store.assignments = store.assignments.filter((a) => a.deploymentId !== id);
    return true;
}

export function createAssignment(data) {
    if (getAssignment(data.clientId, data.agentId)) return null;
    store.assignments.push(data);
    return data;
}
export function updateAssignment(clientId, agentId, data) {
    const a = findAssignment(clientId, agentId);
    if (!a) return null;
    if (data.deploymentId !== undefined) a.deploymentId = data.deploymentId;
    return a;
}
export function deleteAssignment(clientId, agentId) {
    const i = store.assignments.findIndex(
        (a) => a.clientId === clientId && a.agentId === agentId
    );
    if (i < 0) return false;
    store.assignments.splice(i, 1);
    return true;
}
