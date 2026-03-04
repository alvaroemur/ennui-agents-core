/**
 * POST /core/runtime/chat — runtime execution endpoint used by relay.
 */

import { getRuntime, callLLM } from "../../index.js";
import { loadAgentConfig, listAgentIds } from "../../agent-config/loader.js";
import { getDefaultLlmApiKeys, hasAnyLlmApiKey } from "../../llm/api-keys.js";
import { getFingerprintPrefix, loadCoreConfig } from "../../core-config/index.js";
import {
    composeSystemPromptWithSignature,
    createExecutionFingerprint,
} from "../../tracing/signature.js";

/**
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @param {object} options
 * @param {string} options.body - raw request body
 * @param {object} options.CORS_HEADERS
 * @param {(res: any, code: number, data: object, headers?: object) => void} options.jsonResponse
 */
export async function handleAgentChat(req, res, { body: rawBody, CORS_HEADERS, jsonResponse }) {
    let body;
    try {
        body = JSON.parse(rawBody || "{}");
    } catch {
        jsonResponse(res, 400, { error: "Invalid JSON" });
        return;
    }

    const { agentId, tenantId, messages, appendSystemPrompt, preferredProvider, signature, responseMode } = body;
    if (!agentId || typeof agentId !== "string" || !agentId.trim()) {
        let allowed = [];
        try {
            allowed = await listAgentIds({ tenantId });
        } catch (_) {}
        jsonResponse(res, 400, { error: "Missing or invalid agentId", allowed });
        return;
    }
    let allowedIds = [];
    try {
        allowedIds = await listAgentIds({ tenantId });
    } catch (_) {}
    if (allowedIds.length > 0 && !allowedIds.includes(agentId)) {
        jsonResponse(res, 400, { error: "Unknown agentId", allowed: allowedIds });
        return;
    }
    if (!Array.isArray(messages)) {
        jsonResponse(res, 400, { error: "messages must be an array" });
        return;
    }

    let config;
    try {
        config = await loadAgentConfig(agentId, { tenantId });
    } catch (e) {
        jsonResponse(res, 502, { error: "Failed to load agent config", detail: e?.message || String(e) });
        return;
    }

    let coreConfig = null;
    try {
        coreConfig = await loadCoreConfig();
    } catch (_) {
        coreConfig = null;
    }
    const fingerprintPrefix = getFingerprintPrefix(coreConfig);
    const fingerprint = createExecutionFingerprint({
        agentId,
        preferredProvider,
        messageCount: messages.length,
        requestId: req.headers["x-request-id"],
        fingerprintPrefix,
    });
    const runId = `core-${fingerprint.slice(-8)}`;
    const env = String(process.env.CORE_ENV || process.env.NODE_ENV || "dev").trim() || "dev";
    const trace = {
        fingerprint,
        runId,
        env,
        fingerprintPrefix: fingerprintPrefix || undefined,
        signatureSource: "unknown",
    };

    let runtime;
    let systemPrompt;
    try {
        runtime = await getRuntime(agentId, config);
        systemPrompt = runtime.buildSystemPrompt(config);
    } catch (e) {
        jsonResponse(res, 502, { error: "Failed to resolve runtime", detail: e?.message || String(e) });
        return;
    }
    if (appendSystemPrompt && typeof appendSystemPrompt === "string" && appendSystemPrompt.trim()) {
        systemPrompt = systemPrompt + "\n\n" + appendSystemPrompt.trim();
    }

    // Runtime contract v2: return intent/reply and let core relay execute LLM centrally.
    if (responseMode === "v2") {
        let reply = null;
        if (typeof runtime.buildReply === "function") {
            reply = await runtime.buildReply({
                config,
                tenantId,
                messages,
                metadata: body?.metadata && typeof body.metadata === "object" ? body.metadata : {},
            });
        }
        if (typeof reply !== "string" || !reply.trim()) {
            // Backward-compatible default: return the same prompt context previously used for local LLM call.
            reply = systemPrompt;
        }
        jsonResponse(res, 200, {
            reply,
            metadata: {
                runtimeId:
                    (typeof config?.runtimeId === "string" && config.runtimeId.trim()) ||
                    agentId,
            },
            trace: {
                agentRunId: runId,
                fingerprint,
            },
        });
        return;
    }

    const defaultApiKeys = getDefaultLlmApiKeys(preferredProvider);

    if (!String(process.env.LLM_PROXY_URL || "").trim() && !hasAnyLlmApiKey(defaultApiKeys)) {
        jsonResponse(res, 503, { error: "API keys not configured" });
        return;
    }

    try {
        const signatureResult = composeSystemPromptWithSignature({
            basePrompt: systemPrompt,
            customSignature: signature,
            apiKeys: defaultApiKeys,
            env,
            runId,
            fingerprint,
            agentLine: `CORE GATEWAY BACKEND · ${agentId}`,
        });
        systemPrompt = signatureResult.systemPrompt;
        trace.signatureSource = signatureResult.signatureSource;

        const result = await callLLM({
            systemPrompt,
            contents: messages,
            trace,
        });

        if (!result.text) {
            const errMsg =
                result.data?.error?.message || "El servicio de IA no generó una respuesta.";
            jsonResponse(res, 200, {
                text: null,
                error: /user not found|invalid.*key|unauthorized|authentication/i.test(String(errMsg))
                    ? "API key inválida o no reconocida. Revisa las variables de entorno."
                    : errMsg,
                provider: result.provider ?? undefined,
                trace,
            });
            return;
        }

        let payload = null;
        let completion = null;
        let textForClient = result.text;
        if (runtime.parsePayload) {
            payload = runtime.parsePayload(result.text, config);
            if (payload && runtime.stripPayloadForDisplay) {
                textForClient = runtime.stripPayloadForDisplay(result.text, config);
            }
            if (payload && runtime.computeCompletion) {
                completion = runtime.computeCompletion(config, payload);
            }
        }

        jsonResponse(res, 200, {
            text: textForClient,
            payload: payload ?? undefined,
            completion: completion ?? undefined,
            usage: result.usage ?? undefined,
            provider: result.provider ?? undefined,
            trace,
        });
    } catch (e) {
        console.error("agent-chat error", e);
        jsonResponse(res, 500, { error: "Request failed", detail: e?.message || String(e), trace });
    }
}
