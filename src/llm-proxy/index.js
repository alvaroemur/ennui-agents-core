/**
 * LLM proxy wrapper for monitoring + masking.
 * This module is the single entry point for model traffic inside core.
 */

import { callLLM as callLLMReal } from "../llm/core.js";
import { createTrafficMonitor } from "./monitor.js";
import { maskForTelemetry } from "./mask.js";

const TELEMETRY_PREVIEW_LIMIT = 1500;

function isMonitoringEnabled() {
    const raw = String(process.env.LLM_TRAFFIC_MONITOR_ENABLED ?? "true").trim().toLowerCase();
    return !["0", "false", "off", "no"].includes(raw);
}

const trafficMonitor = createTrafficMonitor({
    enabled: isMonitoringEnabled(),
});

function trimPreview(text, max = TELEMETRY_PREVIEW_LIMIT) {
    if (typeof text !== "string") return text;
    if (text.length <= max) return text;
    return `${text.slice(0, max)}...[truncated]`;
}

function toTelemetryPreview(payload) {
    const masked = maskForTelemetry(payload);
    if (typeof masked === "string") return trimPreview(masked);
    try {
        return trimPreview(JSON.stringify(masked));
    } catch (_) {
        return trimPreview(String(masked));
    }
}

function getModelFromRequest(provider, apiKeys = {}) {
    if (provider === "gemini") return apiKeys.geminiModel || "gemini-2.5-flash";
    if (provider === "openrouter") return apiKeys.openRouterModel || "google/gemini-2.5-flash";
    return apiKeys.openaiModel || "gpt-4o-mini";
}

async function forwardToHttpProxy(proxyUrl, payload) {
    const response = await fetch(proxyUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    const data = await response.json();
    return {
        text: data?.text ?? null,
        provider: data?.provider ?? "proxy",
        response: {
            ok: response.ok,
            status: response.status,
        },
        data,
        usage: data?.usage,
    };
}

/**
 * Same contract as src/llm/core.js callLLM.
 * If LLM_PROXY_URL exists, forwards payload to that URL instead of direct providers.
 */
export async function callLLM(payload) {
    const startedAt = Date.now();
    const requestPreview = toTelemetryPreview(payload);

    try {
        const proxyUrl = String(process.env.LLM_PROXY_URL || "").trim();
        const result = proxyUrl
            ? await forwardToHttpProxy(proxyUrl, payload)
            : await callLLMReal(payload);

        const durationMs = Date.now() - startedAt;
        const responsePreview = toTelemetryPreview({
            text: result?.text ?? null,
            data: result?.data ?? null,
        });

        trafficMonitor.emitSuccess({
            provider: result?.provider ?? payload?.apiKeys?.preferredProvider ?? "unknown",
            model: getModelFromRequest(result?.provider, payload?.apiKeys),
            durationMs,
            responseStatus: result?.response?.status ?? null,
            usage: result?.usage ?? null,
            fingerprint: payload?.trace?.fingerprint ?? null,
            fingerprintPrefix: payload?.trace?.fingerprintPrefix ?? null,
            runId: payload?.trace?.runId ?? null,
            executionEnv: payload?.trace?.env ?? null,
            signatureSource: payload?.trace?.signatureSource ?? null,
            requestPreview,
            responsePreview,
        });

        return result;
    } catch (error) {
        const durationMs = Date.now() - startedAt;
        trafficMonitor.emitError(
            {
                provider: payload?.apiKeys?.preferredProvider ?? "unknown",
                model: getModelFromRequest(payload?.apiKeys?.preferredProvider, payload?.apiKeys),
                durationMs,
                fingerprint: payload?.trace?.fingerprint ?? null,
                fingerprintPrefix: payload?.trace?.fingerprintPrefix ?? null,
                runId: payload?.trace?.runId ?? null,
                executionEnv: payload?.trace?.env ?? null,
                signatureSource: payload?.trace?.signatureSource ?? null,
                requestPreview,
            },
            error,
        );
        throw error;
    }
}
