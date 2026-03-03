/**
 * PoC adapter: same contract as src/llm/core.js callLLM, implemented with @mariozechner/pi-ai.
 * Used when USE_PI_AI=true. Single provider (preferred); no fallback chain.
 */

import { getModel, complete } from "@mariozechner/pi-ai";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.5-flash";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

function sanitizeApiKey(key) {
    if (typeof key !== "string") return "";
    return key.replace(/\r\n?|\n/g, "").trim();
}

/**
 * Map our preferredProvider (openai | gemini | openrouter) to pi-ai provider id.
 * pi-ai uses "google" for Gemini.
 */
function toPiAiProvider(preferred) {
    const p = (preferred || "openai").toLowerCase();
    if (p === "gemini") return "google";
    if (p === "openrouter") return "openrouter";
    return "openai";
}

/**
 * Resolve model id for the preferred provider from apiKeys.
 */
function getModelId(provider, apiKeys) {
    if (provider === "openai") return apiKeys.openaiModel || DEFAULT_OPENAI_MODEL;
    if (provider === "google") return apiKeys.geminiModel || DEFAULT_GEMINI_MODEL;
    if (provider === "openrouter") return apiKeys.openRouterModel || DEFAULT_OPENROUTER_MODEL;
    return DEFAULT_OPENAI_MODEL;
}

/**
 * Get API key for the given provider (same names as our apiKeys).
 */
function getApiKey(provider, apiKeys) {
    if (provider === "openai") return sanitizeApiKey(apiKeys.openaiKey ?? "");
    if (provider === "google") return sanitizeApiKey(apiKeys.geminiKey ?? "");
    if (provider === "openrouter") return sanitizeApiKey(apiKeys.openRouterKey ?? "");
    return "";
}

/**
 * Convert our contents (Gemini-like: role + parts with text/inlineData) to pi-ai Context.messages.
 * UserMessage: { role: 'user', content: string | ContentBlock[], timestamp }.
 * AssistantMessage (history): minimal shape for context.
 */
function contentsToPiAiMessages(contents) {
    const messages = [];
    const now = Date.now();
    const zeroUsage = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };

    for (const c of contents || []) {
        const role = c.role === "model" ? "assistant" : "user";
        const parts = c.parts || [];

        if (role === "user") {
            const hasImage = parts.some((p) => p.inlineData);
            if (hasImage) {
                const content = parts
                    .map((p) => {
                        if (p.text) return { type: "text", text: p.text };
                        if (p.inlineData)
                            return {
                                type: "image",
                                data: p.inlineData.data,
                                mimeType: p.inlineData.mimeType || "image/png",
                            };
                        return null;
                    })
                    .filter(Boolean);
                messages.push({ role: "user", content, timestamp: now });
            } else {
                const text = parts.map((p) => p.text).filter(Boolean).join("\n") || "";
                messages.push({ role: "user", content: text, timestamp: now });
            }
        } else {
            const text = parts.map((p) => p.text).filter(Boolean).join("\n") || "";
            messages.push({
                role: "assistant",
                content: text ? [{ type: "text", text }] : [],
                api: "openai-completions",
                provider: "openai",
                model: "unknown",
                usage: zeroUsage,
                stopReason: "stop",
                timestamp: now,
            });
        }
    }

    return messages;
}

/**
 * Same contract as src/llm/core.js callLLM.
 * Returns { text, provider, response?, data?, usage?: { inputTokens, outputTokens } }.
 */
export async function callLLMPiAI({
    systemPrompt,
    contents,
    jsonMode = false,
    apiKeys = {},
}) {
    const preferred = (apiKeys.preferredProvider || "openai").toLowerCase();
    const provider = toPiAiProvider(preferred);
    const modelId = getModelId(provider, apiKeys);
    const apiKey = getApiKey(provider, apiKeys);

    if (!apiKey) {
        return {
            text: null,
            provider: preferred === "gemini" ? "gemini" : preferred,
            response: { ok: false, status: 401 },
            data: {
                error: {
                    message: `No API key configured for ${preferred}. Set OPENAI_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY.`,
                },
            },
        };
    }

    let model;
    try {
        model = getModel(provider, modelId);
    } catch (err) {
        return {
            text: null,
            provider: preferred === "gemini" ? "gemini" : preferred,
            response: { ok: false, status: 400 },
            data: {
                error: {
                    message: `Unsupported model for pi-ai: ${provider}/${modelId}. ${err?.message || err}`,
                },
            },
        };
    }

    if (!model) {
        return {
            text: null,
            provider: preferred === "gemini" ? "gemini" : preferred,
            response: { ok: false, status: 400 },
            data: {
                error: {
                    message: `Model not found: ${provider}/${modelId}. Use a model ID known to @mariozechner/pi-ai.`,
                },
            },
        };
    }

    const context = {
        systemPrompt: systemPrompt || undefined,
        messages: contentsToPiAiMessages(contents),
    };

    const options = { apiKey };
    // jsonMode: pi-ai does not expose response_format in generic StreamOptions for this PoC; can be added per-provider later.

    try {
        const response = await complete(model, context, options);

        const textBlocks = (response.content || []).filter((b) => b.type === "text");
        const text = textBlocks.length > 0 ? textBlocks.map((b) => b.text).join("\n") : null;

        const usage = response.usage
            ? {
                  inputTokens: response.usage.input ?? 0,
                  outputTokens: response.usage.output ?? 0,
              }
            : undefined;

        const outProvider = preferred === "gemini" ? "gemini" : preferred;

        const data = text != null ? { choices: [{ message: { content: text } }] } : {};
        return {
            text,
            provider: outProvider,
            response: { ok: true, status: 200 },
            data,
            usage:
                usage && (usage.inputTokens > 0 || usage.outputTokens > 0)
                    ? usage
                    : undefined,
        };
    } catch (err) {
        const status = err?.status ?? err?.statusCode ?? 503;
        return {
            text: null,
            provider: preferred === "gemini" ? "gemini" : preferred,
            response: { ok: false, status: typeof status === "number" ? status : 503 },
            data: {
                error: {
                    message: err?.message || String(err) || "pi-ai request failed.",
                },
            },
        };
    }
}
