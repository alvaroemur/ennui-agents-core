/**
 * Forward POST to chat endpoint URL.
 */

const FORWARD_TIMEOUT_MS = 60000;

/**
 * @param {string} chatEndpointUrl
 * @param {string} body - raw JSON body to forward
 * @param {object} headers - optional extra headers
 * @returns {{ statusCode: number, body: string, parsed?: object, provider?: string|null, usage?: object|null } | { error: string, detail?: string, statusCode: number, errorCode?: string, downstreamStatusCode?: number, provider?: string|null, usage?: object|null }}
 */
export async function forwardChat(chatEndpointUrl, body, headers = {}) {
    const rawUrl = typeof chatEndpointUrl === "string" ? chatEndpointUrl.trim() : "";
    if (!rawUrl) {
        return {
            statusCode: 502,
            errorCode: "INVALID_DEPLOYMENT_URL",
            error: "Deployment unreachable",
            detail: "Invalid chat endpoint URL",
        };
    }

    let url;
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error("Invalid protocol");
        }
        url = parsed.toString();
    } catch {
        return {
            statusCode: 502,
            errorCode: "INVALID_DEPLOYMENT_URL",
            error: "Deployment unreachable",
            detail: "Invalid chat endpoint URL",
        };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...headers,
            },
            body,
            signal: controller.signal,
        });
        clearTimeout(timeout);
        const text = await res.text();
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            parsed = { error: "Invalid JSON from downstream", detail: text.slice(0, 200) };
        }
        if (!res.ok) {
            return {
                statusCode: 502,
                downstreamStatusCode: res.status,
                errorCode: "DOWNSTREAM_ERROR",
                error: "Downstream error",
                detail: parsed?.error || parsed?.detail || text.slice(0, 200),
                provider: parsed?.provider ?? null,
                usage: parsed?.usage ?? null,
            };
        }
        return {
            statusCode: res.status,
            body: text,
            parsed,
            provider: parsed?.provider ?? null,
            usage: parsed?.usage ?? null,
        };
    } catch (e) {
        clearTimeout(timeout);
        const isTimeout = e?.name === "AbortError";
        return {
            statusCode: 502,
            errorCode: isTimeout ? "DOWNSTREAM_TIMEOUT" : "DEPLOYMENT_UNREACHABLE",
            error: "Deployment unreachable",
            detail: isTimeout ? "Timeout" : (e?.message || String(e)),
        };
    }
}
