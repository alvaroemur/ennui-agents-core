/**
 * Lightweight traffic monitor for LLM calls.
 * Emits structured events through an injectable sink.
 */

const DEFAULT_NAMESPACE = "llm-traffic";

function nowIso() {
    return new Date().toISOString();
}

function toErrorInfo(err) {
    if (!err) return null;
    return {
        message: err?.message || String(err),
        name: err?.name || "Error",
    };
}

function defaultSink(event) {
    try {
        console.info(`[${DEFAULT_NAMESPACE}] ${JSON.stringify(event)}`);
    } catch (_) {
        console.info(`[${DEFAULT_NAMESPACE}]`, event);
    }
}

export function createTrafficMonitor({ enabled = true, sink = defaultSink } = {}) {
    function emit(event) {
        if (!enabled) return;
        sink({
            timestamp: nowIso(),
            namespace: DEFAULT_NAMESPACE,
            ...event,
        });
    }

    function emitSuccess(event) {
        emit({
            type: "llm_call",
            status: "ok",
            ...event,
        });
    }

    function emitError(event, err) {
        emit({
            type: "llm_call",
            status: "error",
            error: toErrorInfo(err),
            ...event,
        });
    }

    return {
        emitSuccess,
        emitError,
    };
}
