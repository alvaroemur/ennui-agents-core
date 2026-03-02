/**
 * Core signature composer for system prompts.
 * - Uses client signature when provided
 * - Reuses existing leading signature when present
 * - Falls back to core default signature otherwise
 * - Always appends execution metadata with fingerprint
 */

import { createHash, randomUUID } from "crypto";

const CORE_VERSION = "0.1";
const DEFAULT_ENV = "dev";
const DEFAULT_LLM = "openai/gpt-4o-mini";
const DEFAULT_FINGERPRINT_PREFIX = "fp-";

const SIGNATURE_MARKERS_REGEX = /(?:^|\n)\s*(?:↳|→|▪)\s+/;
const LEADING_CODE_BLOCK_REGEX = /^(\s*```(?:[^\n`]*)\n)([\s\S]*?)(\n```)([\s\S]*)$/;

function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeFingerprintPrefix(prefix) {
    const raw = normalizeText(prefix);
    if (!raw) return DEFAULT_FINGERPRINT_PREFIX;
    const sanitized = raw.replace(/[^a-zA-Z0-9_-]/g, "-");
    if (!sanitized) return DEFAULT_FINGERPRINT_PREFIX;
    return /[-_]$/.test(sanitized) ? sanitized : `${sanitized}-`;
}

function resolveLlmLabel(apiKeys = {}) {
    const preferred = normalizeText(apiKeys.preferredProvider || "openai").toLowerCase();
    if (preferred === "gemini") {
        return `gemini/${normalizeText(apiKeys.geminiModel) || "gemini-2.5-flash"}`;
    }
    if (preferred === "openrouter") {
        return `openrouter/${normalizeText(apiKeys.openRouterModel) || "google/gemini-2.5-flash"}`;
    }
    return `openai/${normalizeText(apiKeys.openaiModel) || "gpt-4o-mini"}`;
}

function parseLeadingCodeBlock(input) {
    const text = typeof input === "string" ? input : "";
    const match = text.match(LEADING_CODE_BLOCK_REGEX);
    if (!match) return null;
    return {
        openFence: match[1],
        body: match[2],
        closeFence: match[3],
        rest: match[4] || "",
    };
}

function toSignatureBody(customSignature) {
    const parsed = parseLeadingCodeBlock(customSignature);
    if (parsed) return parsed.body.trimEnd();
    return normalizeText(customSignature);
}

function looksLikeSignature(body) {
    const normalized = normalizeText(body);
    if (!normalized) return false;
    if (SIGNATURE_MARKERS_REGEX.test(normalized)) return true;
    return /\bfingerprint\s*:/i.test(normalized);
}

function ensureExecutionMetadata(signatureBody, { env, runId, fingerprint }) {
    const lines = signatureBody.split("\n");
    const metadataTokens = [];
    if (env) metadataTokens.push(`env:${env}`);
    if (runId) metadataTokens.push(`run:${runId}`);
    metadataTokens.push(`fingerprint:${fingerprint}`);

    const metadataIndex = lines.findIndex((line) => /^\s*▪\s*/.test(line));
    if (metadataIndex >= 0) {
        const raw = lines[metadataIndex].replace(/^\s*▪\s*/, "").trim();
        const existing = raw
            .split("·")
            .map((token) => token.trim())
            .filter(Boolean)
            .filter((token) => !/^(?:env|run|fingerprint)\s*:/i.test(token));
        lines[metadataIndex] = `  ▪ ${metadataTokens.concat(existing).join(" · ")}`;
        return lines.join("\n");
    }

    lines.push(`  ▪ ${metadataTokens.join(" · ")}`);
    return lines.join("\n");
}

function buildDefaultCoreSignatureBody({
    llm = DEFAULT_LLM,
    agentLine = "CORE GATEWAY BACKEND v0.1 · Firma por defecto/boilerplate para front-ends.",
    env = DEFAULT_ENV,
    runId,
    fingerprint,
}) {
    return [
        "+==========================================+",
        "| ########### ENNUI ###########            |",
        "| ............ core ............           |",
        "+==========================================+",
        "",
        "⚡ [ ia ] ennui · core gateway backend",
        agentLine,
        `  ↳ core-backend v${CORE_VERSION}`,
        `  → ${llm}`,
        `  ▪ env:${env} · run:${runId} · fingerprint:${fingerprint}`,
    ].join("\n");
}

function toFencedBlock(signatureBody) {
    return `\`\`\`\n${signatureBody}\n\`\`\``;
}

export function createExecutionFingerprint({
    agentId = "",
    preferredProvider = "",
    messageCount = 0,
    requestId = "",
    fingerprintPrefix = "",
} = {}) {
    const seed = JSON.stringify({
        timestamp: Date.now(),
        nonce: randomUUID(),
        agentId: normalizeText(agentId),
        preferredProvider: normalizeText(preferredProvider),
        requestId: normalizeText(requestId),
        messageCount: Number.isFinite(Number(messageCount)) ? Number(messageCount) : 0,
    });
    const hash = createHash("sha256").update(seed).digest("hex");
    const prefix = normalizeFingerprintPrefix(fingerprintPrefix);
    return `${prefix}${hash.slice(0, 16)}`;
}

export function composeSystemPromptWithSignature({
    basePrompt = "",
    customSignature = "",
    apiKeys = {},
    env = DEFAULT_ENV,
    runId = "",
    fingerprint = "",
    agentLine,
} = {}) {
    if (!normalizeText(fingerprint)) {
        throw new Error("composeSystemPromptWithSignature requires a fingerprint");
    }

    const parsedBaseBlock = parseLeadingCodeBlock(basePrompt);
    const normalizedCustomSignature = normalizeText(customSignature);
    const llm = resolveLlmLabel(apiKeys);

    let signatureBody = "";
    let remainderPrompt = typeof basePrompt === "string" ? basePrompt : "";
    let signatureSource = "core-default";

    if (normalizedCustomSignature) {
        signatureBody = toSignatureBody(customSignature);
        signatureSource = "client";
    } else if (parsedBaseBlock && looksLikeSignature(parsedBaseBlock.body)) {
        signatureBody = parsedBaseBlock.body.trimEnd();
        remainderPrompt = parsedBaseBlock.rest.trimStart();
        signatureSource = "existing";
    } else {
        signatureBody = buildDefaultCoreSignatureBody({
            llm,
            agentLine,
            env,
            runId,
            fingerprint,
        });
    }

    signatureBody = ensureExecutionMetadata(signatureBody, {
        env: normalizeText(env) || DEFAULT_ENV,
        runId: normalizeText(runId),
        fingerprint: normalizeText(fingerprint),
    });

    const signatureBlock = toFencedBlock(signatureBody);
    const normalizedRemainder = normalizeText(remainderPrompt);
    const systemPrompt = normalizedRemainder
        ? `${signatureBlock}\n\n${normalizedRemainder}`
        : signatureBlock;

    return {
        systemPrompt,
        signatureSource,
        usedDefaultSignature: signatureSource === "core-default",
    };
}
