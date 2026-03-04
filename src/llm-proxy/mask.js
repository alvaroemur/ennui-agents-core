/**
 * Telemetry payload normalization: ensure payload has predefined keys for logs/preview.
 * Does not redact sensitive data; only guarantees shape (e.g. store: true).
 */

const TELEMETRY_REQUIRED_KEYS = { store: true };

/**
 * Returns a copy of the payload with required telemetry keys guaranteed.
 * For now only ensures `store === true`.
 */
export function maskForTelemetry(payload) {
    if (payload == null) {
        return { ...TELEMETRY_REQUIRED_KEYS };
    }
    if (typeof payload === "object" && !Array.isArray(payload)) {
        return { ...payload, ...TELEMETRY_REQUIRED_KEYS };
    }
    return { ...TELEMETRY_REQUIRED_KEYS, value: payload };
}
