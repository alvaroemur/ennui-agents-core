/**
 * POST /api/chat — same contract as agents-api. Uses core runtimes + llm.
 */

import { getRuntime, callLLM } from "../../index.js";
import { loadAgentConfig, listAgentIds } from "../../config-loader.js";

function sanitizeApiKey(k) {
    if (typeof k !== "string") return "";
    return k.replace(/\r\n?|\n/g, "").trim();
}

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

    const { agentId, messages, appendSystemPrompt, preferredProvider } = body;
    if (!agentId || typeof agentId !== "string" || !agentId.trim()) {
        let allowed = [];
        try {
            allowed = await listAgentIds();
        } catch (_) {}
        jsonResponse(res, 400, { error: "Missing or invalid agentId", allowed });
        return;
    }
    let allowedIds = [];
    try {
        allowedIds = await listAgentIds();
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
        config = await loadAgentConfig(agentId);
    } catch (e) {
        jsonResponse(res, 502, { error: "Failed to load agent config", detail: e?.message || String(e) });
        return;
    }

    const apiKeys = {
        geminiKey: sanitizeApiKey(process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || ""),
        openRouterKey: sanitizeApiKey(process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || ""),
        openaiKey: sanitizeApiKey(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || ""),
        geminiModel: "gemini-2.5-flash",
        openRouterModel: "google/gemini-2.5-flash",
        openaiModel: "gpt-4o-mini",
        preferredProvider: preferredProvider || "openai",
    };

    if (!apiKeys.geminiKey && !apiKeys.openRouterKey && !apiKeys.openaiKey) {
        jsonResponse(res, 503, { error: "API keys not configured" });
        return;
    }

    try {
        const runtime = getRuntime(config);
        let systemPrompt = runtime.buildSystemPrompt(config);
        if (appendSystemPrompt && typeof appendSystemPrompt === "string" && appendSystemPrompt.trim()) {
            systemPrompt = systemPrompt + "\n\n" + appendSystemPrompt.trim();
        }

        const result = await callLLM({
            systemPrompt,
            contents: messages,
            apiKeys,
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
        });
    } catch (e) {
        console.error("agent-chat error", e);
        jsonResponse(res, 500, { error: "Request failed", detail: e?.message || String(e) });
    }
}
