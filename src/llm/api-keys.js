const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.5-flash";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export function sanitizeApiKey(value) {
    if (typeof value !== "string") return "";
    return value.replace(/\r\n?|\n/g, "").trim();
}

function normalizeProvider(value) {
    if (typeof value !== "string" || !value.trim()) return "openai";
    return value.trim();
}

export function hasAnyLlmApiKey(apiKeys = {}) {
    return Boolean(apiKeys?.geminiKey || apiKeys?.openRouterKey || apiKeys?.openaiKey);
}

export function getDefaultLlmApiKeys(preferredProvider = null) {
    return {
        geminiKey: sanitizeApiKey(process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || ""),
        openRouterKey: sanitizeApiKey(process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || ""),
        openaiKey: sanitizeApiKey(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || ""),
        geminiModel: DEFAULT_GEMINI_MODEL,
        openRouterModel: DEFAULT_OPENROUTER_MODEL,
        openaiModel: DEFAULT_OPENAI_MODEL,
        preferredProvider: normalizeProvider(preferredProvider),
    };
}

export function normalizeCustomLlmApiKeys(rawApiKeys, preferredProvider = null) {
    if (!rawApiKeys || typeof rawApiKeys !== "object") return null;
    const openaiKey = sanitizeApiKey(rawApiKeys.openaiKey || rawApiKeys.apiKey || "");
    const geminiKey = sanitizeApiKey(rawApiKeys.geminiKey || "");
    const openRouterKey = sanitizeApiKey(rawApiKeys.openRouterKey || "");

    if (!openaiKey && !geminiKey && !openRouterKey) return null;

    return {
        geminiKey,
        openRouterKey,
        openaiKey,
        geminiModel:
            (typeof rawApiKeys.geminiModel === "string" && rawApiKeys.geminiModel.trim()) ||
            DEFAULT_GEMINI_MODEL,
        openRouterModel:
            (typeof rawApiKeys.openRouterModel === "string" && rawApiKeys.openRouterModel.trim()) ||
            DEFAULT_OPENROUTER_MODEL,
        openaiModel:
            (typeof rawApiKeys.openaiModel === "string" && rawApiKeys.openaiModel.trim()) ||
            DEFAULT_OPENAI_MODEL,
        preferredProvider: normalizeProvider(rawApiKeys.preferredProvider || preferredProvider),
    };
}
