/**
 * core: runtimes, LLM API, config, auth, persistence, HTTP API.
 * Usable as installed package or via API server.
 */

import { callLLM as callLLMProxy } from "./llm-proxy/index.js";
import { createPersistence } from "./persistence/index.js";
import { listAgentIds, loadAgentConfig } from "./agent-config/loader.js";
import { loadRuntime } from "./runtime/loader.js";
import {
    composeSystemPromptWithSignature,
    createExecutionFingerprint,
} from "./tracing/signature.js";

export { callLLM } from "./llm-proxy/index.js";
export { convertToOpenAIMessages } from "./llm/core.js";
export {
    composeSystemPromptWithSignature,
    createExecutionFingerprint,
} from "./tracing/signature.js";
export { createPersistence } from "./persistence/index.js";
export { listAgentIds, loadAgentConfig } from "./agent-config/loader.js";
export { loadRuntime as loadAgentRuntime } from "./runtime/loader.js";
export { getRequiredApiKey, getApiKeyFromRequest, requireApiKey } from "./auth/index.js";
export {
    getCoreConfigDir,
    loadCoreConfig,
    listSubaccountConfigs,
    toPublicCoreConfig,
    toPublicSubaccountConfig,
    getFingerprintPrefix,
    getDeployAuthConfig,
} from "./core-config/index.js";

function resolveAgentId(inputAgentId, config) {
    if (typeof inputAgentId === "string" && inputAgentId.trim()) return inputAgentId.trim();
    if (typeof config?.agentId === "string" && config.agentId.trim()) return config.agentId.trim();
    if (typeof config?.id === "string" && config.id.trim()) return config.id.trim();
    throw new Error("Missing agentId for runtime resolution");
}

function resolveRuntimeId(agentId, config) {
    if (typeof config?.runtimeId === "string" && config.runtimeId.trim()) {
        return config.runtimeId.trim();
    }
    return resolveAgentId(agentId, config);
}

/**
 * Resolve runtime for an agent, honoring config.runtimeId when present.
 */
export async function getRuntime(agentId, config = null) {
    return loadRuntime(resolveRuntimeId(agentId, config));
}

/**
 * Single entry point: build prompt, call LLM, parse payload when runtime supports it.
 */
export async function respond({
    agentId,
    config,
    messages,
    apiKeys,
    persistence,
    signature,
    trace = {},
}) {
    const resolvedAgentId = resolveAgentId(agentId, config);
    const runtime = await getRuntime(resolvedAgentId, config);
    const basePrompt = runtime.buildSystemPrompt(config);
    const env =
        String(trace?.env || process.env.CORE_ENV || process.env.NODE_ENV || "dev").trim() ||
        "dev";
    const fingerprintPrefix =
        typeof trace?.fingerprintPrefix === "string" && trace.fingerprintPrefix.trim()
            ? trace.fingerprintPrefix.trim()
            : String(process.env.CORE_FINGERPRINT_PREFIX || "").trim();
    const fingerprint =
        typeof trace?.fingerprint === "string" && trace.fingerprint.trim()
            ? trace.fingerprint.trim()
            : createExecutionFingerprint({
                  agentId: resolvedAgentId,
                  preferredProvider: apiKeys?.preferredProvider,
                  messageCount: Array.isArray(messages) ? messages.length : 0,
                  requestId: trace?.requestId,
                  fingerprintPrefix,
              });
    const runId =
        typeof trace?.runId === "string" && trace.runId.trim()
            ? trace.runId.trim()
            : `core-${fingerprint.slice(-8)}`;
    const signatureResult = composeSystemPromptWithSignature({
        basePrompt,
        customSignature: signature,
        apiKeys: apiKeys || {},
        env,
        runId,
        fingerprint,
        agentLine: `CORE GATEWAY BACKEND · ${resolvedAgentId}`,
    });
    const systemPrompt = signatureResult.systemPrompt;
    const responseTrace = {
        ...trace,
        env,
        runId,
        fingerprint,
        fingerprintPrefix: fingerprintPrefix || undefined,
        signatureSource: signatureResult.signatureSource,
    };
    const result = await callLLMProxy({
        systemPrompt,
        contents: messages,
        apiKeys: apiKeys || {},
        trace: responseTrace,
    });
    const text = result.text;
    let payload = null;
    let completion = null;
    if (runtime.parsePayload && text) {
        payload = runtime.parsePayload(text, config);
        if (payload && runtime.computeCompletion) {
            completion = runtime.computeCompletion(config, payload);
        }
    }
    return { text, payload, completion, trace: responseTrace };
}
