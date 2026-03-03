/**
 * LLM API: OpenAI, Gemini, OpenRouter. No global state; apiKeys passed in.
 * When USE_PI_AI=true, calls are delegated to the @mariozechner/pi-ai adapter (see pi-ai.js).
 */

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.5-flash";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export function convertToOpenAIMessages(systemPrompt, contents) {
    const msgs = [];
    if (systemPrompt) msgs.push({ role: "system", content: systemPrompt });
    for (const c of contents || []) {
        const role = c.role === "model" ? "assistant" : "user";
        const hasImage = c.parts?.some((p) => p.inlineData);
        if (hasImage) {
            const contentParts = c.parts
                .map((p) => {
                    if (p.text) return { type: "text", text: p.text };
                    if (p.inlineData)
                        return {
                            type: "image_url",
                            image_url: {
                                url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`,
                            },
                        };
                    return null;
                })
                .filter(Boolean);
            msgs.push({ role, content: contentParts });
        } else {
            const text = c.parts?.map((p) => p.text).filter(Boolean).join("\n") ?? "";
            msgs.push({ role, content: text });
        }
    }
    return msgs;
}

function getProviderOrder(preferred, keys) {
    const defaultOrder = ["openai", "gemini", "openrouter"];
    const withKeys = defaultOrder.filter(
        (p) =>
            (p === "openai" && keys.openaiKey) ||
            (p === "gemini" && keys.geminiKey) ||
            (p === "openrouter" && keys.openRouterKey)
    );
    if (!withKeys.length) return [];
    if (preferred === "auto" || !preferred) return withKeys;
    const idx = withKeys.indexOf(preferred);
    if (idx === -1) return withKeys;
    return [preferred, ...withKeys.filter((p) => p !== preferred)];
}

function sanitizeApiKey(key) {
    if (typeof key !== "string") return "";
    return key.replace(/\r\n?|\n/g, "").trim();
}

async function tryOpenAI(systemPrompt, contents, jsonMode, openaiKey, openaiModel) {
    const key = sanitizeApiKey(openaiKey);
    const messages = convertToOpenAIMessages(systemPrompt, contents);
    const body = {
        model: openaiModel || DEFAULT_OPENAI_MODEL,
        messages,
        max_tokens: 8192,
    };
    if (jsonMode) body.response_format = { type: "json_object" };
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
    });
    const data = await resp.json();
    const text = resp.ok ? (data.choices?.[0]?.message?.content ?? null) : null;
    const usage = data.usage;
    const inputTokens = usage?.prompt_tokens != null ? Number(usage.prompt_tokens) : null;
    const outputTokens = usage?.completion_tokens != null ? Number(usage.completion_tokens) : null;
    return {
        text,
        provider: "openai",
        response: resp,
        data,
        usage:
            inputTokens != null || outputTokens != null ? { inputTokens, outputTokens } : undefined,
    };
}

async function tryGemini(systemPrompt, contents, jsonMode, geminiKey, geminiModel) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;
    const geminiBody = { contents };
    if (systemPrompt) geminiBody.systemInstruction = { parts: [{ text: systemPrompt }] };
    if (jsonMode) geminiBody.generationConfig = { responseMimeType: "application/json" };
    const resp = await fetch(`${url}?key=${geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody),
    });
    const data = await resp.json();
    const text = resp.ok ? data.candidates?.[0]?.content?.parts?.[0]?.text ?? null : null;
    const um = data.usageMetadata || data.usage_metadata;
    const inputTokens =
        um?.promptTokenCount != null
            ? Number(um.promptTokenCount)
            : um?.prompt_token_count != null
              ? Number(um.prompt_token_count)
              : null;
    const outputTokens =
        um?.candidatesTokenCount != null
            ? Number(um.candidatesTokenCount)
            : um?.candidates_token_count != null
              ? Number(um.candidates_token_count)
              : null;
    return {
        text,
        provider: "gemini",
        response: resp,
        data,
        usage:
            inputTokens != null || outputTokens != null ? { inputTokens, outputTokens } : undefined,
    };
}

async function tryOpenRouter(systemPrompt, contents, jsonMode, openRouterKey, openRouterModel) {
    const messages = convertToOpenAIMessages(systemPrompt, contents);
    const body = {
        model: openRouterModel,
        messages,
        max_tokens: 8192,
    };
    if (jsonMode) body.response_format = { type: "json_object" };
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openRouterKey}`,
        },
        body: JSON.stringify(body),
    });
    const data = await resp.json();
    const text = resp.ok ? (data.choices?.[0]?.message?.content ?? null) : null;
    const usage = data.usage;
    const inputTokens = usage?.prompt_tokens != null ? Number(usage.prompt_tokens) : null;
    const outputTokens = usage?.completion_tokens != null ? Number(usage.completion_tokens) : null;
    return {
        text,
        provider: "openrouter",
        response: resp,
        data,
        usage:
            inputTokens != null || outputTokens != null ? { inputTokens, outputTokens } : undefined,
    };
}

export async function callLLM({ systemPrompt, contents, jsonMode = false, apiKeys = {} }) {
    const usePiAi = String(process.env.USE_PI_AI ?? "")
        .trim()
        .toLowerCase();
    if (["1", "true", "yes", "on"].includes(usePiAi)) {
        const { callLLMPiAI } = await import("./pi-ai.js");
        return callLLMPiAI({ systemPrompt, contents, jsonMode, apiKeys });
    }

    const geminiKey = apiKeys.geminiKey ?? "";
    const openRouterKey = apiKeys.openRouterKey ?? "";
    const openaiKey = apiKeys.openaiKey ?? "";
    const geminiModel = apiKeys.geminiModel || DEFAULT_GEMINI_MODEL;
    const openRouterModel = apiKeys.openRouterModel || DEFAULT_OPENROUTER_MODEL;
    const openaiModel = apiKeys.openaiModel || DEFAULT_OPENAI_MODEL;
    const preferred = (apiKeys.preferredProvider || "openai").toLowerCase();

    const keys = { geminiKey, openRouterKey, openaiKey };
    const order = getProviderOrder(preferred, keys);

    if (!order.length) {
        return {
            text: null,
            provider: "openai",
            response: { ok: false, status: 401 },
            data: {
                error: {
                    message:
                        "No API key configured. Set OPENAI_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY.",
                },
            },
        };
    }

    let lastResult = null;
    for (const provider of order) {
        try {
            if (provider === "openai") {
                lastResult = await tryOpenAI(
                    systemPrompt,
                    contents,
                    jsonMode,
                    openaiKey,
                    openaiModel
                );
            } else if (provider === "gemini") {
                lastResult = await tryGemini(
                    systemPrompt,
                    contents,
                    jsonMode,
                    geminiKey,
                    geminiModel
                );
            } else {
                lastResult = await tryOpenRouter(
                    systemPrompt,
                    contents,
                    jsonMode,
                    openRouterKey,
                    openRouterModel
                );
            }
            if (lastResult && lastResult.text != null) return lastResult;
            if (order.indexOf(provider) < order.length - 1) {
                console.info(`${provider} failed or no text, trying next provider`);
            }
        } catch (e) {
            console.warn(`${provider} error:`, e?.message || e);
        }
    }

    return (
        lastResult || {
            text: null,
            provider: order[0] || "openai",
            response: { ok: false, status: 503 },
            data: { error: { message: "All providers failed or returned no text." } },
        }
    );
}
