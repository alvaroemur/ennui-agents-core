/**
 * Resolve (clientId, agentId) → baseUrl and forward POST to {baseUrl}/api/chat.
 */

import { resolveEndpoint } from "./registry.js";

const FORWARD_TIMEOUT_MS = 60000;

/**
 * @param {string} clientId
 * @param {string} agentId
 * @param {string} body - raw JSON body to forward
 * @param {object} headers - optional extra headers
 * @returns {{ statusCode: number, body: string, headers?: object } | { error: string, detail?: string, statusCode: number }}
 */
export async function forwardChat(clientId, agentId, body, headers = {}) {
    const baseUrl = resolveEndpoint(clientId, agentId);
    if (!baseUrl) {
        return {
            statusCode: 404,
            error: "No assignment for client and agent",
            detail: `clientId=${clientId}, agentId=${agentId}`,
        };
    }

    const url = baseUrl.replace(/\/$/, "") + "/api/chat";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...headers,
            },
            body,
            signal: controller.signal,
        });
        clearTimeout(timeout);
        const text = await res.text();
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            parsed = { error: "Invalid JSON from downstream", detail: text.slice(0, 200) };
        }
        if (!res.ok) {
            return {
                statusCode: 502,
                error: "Downstream error",
                detail: parsed?.error || parsed?.detail || text.slice(0, 200),
            };
        }
        return { statusCode: res.status, body: text, parsed };
    } catch (e) {
        clearTimeout(timeout);
        const isTimeout = e?.name === "AbortError";
        return {
            statusCode: 502,
            error: "Deployment unreachable",
            detail: isTimeout ? "Timeout" : (e?.message || String(e)),
        };
    }
}
