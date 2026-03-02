/**
 * core: runtimes, LLM API, config, auth, persistence, HTTP API.
 * Usable as installed package or via API server.
 */

import * as general from "./general.js";
import * as collector from "./collector.js";
import { callLLM as callLLMProxy } from "./llm-proxy/index.js";
import { createPersistence } from "./persistence/index.js";
import { listAgentIds, loadAgentConfig } from "./config-loader.js";
import {
    composeSystemPromptWithSignature,
    createExecutionFingerprint,
} from "./signature.js";

export { buildSystemPrompt as buildGeneralSystemPrompt } from "./general.js";
export {
    buildSystemPrompt as buildCollectorSystemPrompt,
    parsePayload as parseCollectorPayload,
    stripPayloadForDisplay as stripCollectorPayloadForDisplay,
    computeCompletion as computeCollectorCompletion,
    validatePayload as validateCollectorPayload,
} from "./collector.js";
export { callLLM } from "./llm-proxy/index.js";
export { convertToOpenAIMessages } from "./llm.js";
export {
    composeSystemPromptWithSignature,
    createExecutionFingerprint,
} from "./signature.js";
export { createPersistence } from "./persistence/index.js";
export { listAgentIds, loadAgentConfig } from "./config-loader.js";
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

/**
 * Resolve runtime for an agent config (general vs collector).
 */
export function getRuntime(config) {
    const type = config?.agentType ?? (config?.id ? "collector" : "general");
    if (type === "general") {
        return {
            buildSystemPrompt: general.buildSystemPrompt,
        };
    }
    return {
        buildSystemPrompt: collector.buildSystemPrompt,
        parsePayload: collector.parsePayload,
        stripPayloadForDisplay: collector.stripPayloadForDisplay,
        computeCompletion: collector.computeCompletion,
    };
}

/**
 * Single entry point: build prompt, call LLM, parse payload if collector.
 */
export async function respond({ config, messages, apiKeys, persistence, signature, trace = {} }) {
    const runtime = getRuntime(config);
    const basePrompt = runtime.buildSystemPrompt(config);
    const env = String(trace?.env || process.env.CORE_ENV || process.env.NODE_ENV || "dev").trim() || "dev";
    const fingerprintPrefix =
        typeof trace?.fingerprintPrefix === "string" && trace.fingerprintPrefix.trim()
            ? trace.fingerprintPrefix.trim()
            : String(process.env.CORE_FINGERPRINT_PREFIX || "").trim();
    const fingerprint =
        typeof trace?.fingerprint === "string" && trace.fingerprint.trim()
            ? trace.fingerprint.trim()
            : createExecutionFingerprint({
                  agentId: config?.id || config?.agentType || "general",
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
        agentLine: `CORE GATEWAY BACKEND · ${config?.id || "agent"}`,
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
