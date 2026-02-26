/**
 * @ennui-agents/core: runtimes, LLM API, config, auth, persistence, HTTP API.
 * Usable as installed package or via API server.
 */

import * as general from "./general.js";
import * as collector from "./collector.js";
import * as llm from "./llm.js";
import { createPersistence } from "./persistence/index.js";
import { listAgentIds, loadAgentConfig } from "./config-loader.js";

export { buildSystemPrompt as buildGeneralSystemPrompt } from "./general.js";
export {
    buildSystemPrompt as buildCollectorSystemPrompt,
    parsePayload as parseCollectorPayload,
    stripPayloadForDisplay as stripCollectorPayloadForDisplay,
    computeCompletion as computeCollectorCompletion,
    validatePayload as validateCollectorPayload,
} from "./collector.js";
export { callLLM, convertToOpenAIMessages } from "./llm.js";
export { createPersistence } from "./persistence/index.js";
export { listAgentIds, loadAgentConfig } from "./config-loader.js";
export { getRequiredApiKey, getApiKeyFromRequest, requireApiKey } from "./auth/index.js";

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
export async function respond({ config, messages, apiKeys, persistence }) {
    const runtime = getRuntime(config);
    const systemPrompt = runtime.buildSystemPrompt(config);
    const result = await llm.callLLM({
        systemPrompt,
        contents: messages,
        apiKeys: apiKeys || {},
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
    return { text, payload, completion };
}
