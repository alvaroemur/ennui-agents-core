/**
 * Helpers to mask sensitive data in telemetry/log payloads.
 * Important: these functions should never mutate original objects.
 */

const REDACTED_API_KEY = "[REDACTED_API_KEY]";
const REDACTED_EMAIL = "[EMAIL]";
const REDACTED_PHONE = "[PHONE]";
const REDACTED_NAME = "[NAME]";

const SENSITIVE_KEY_REGEX = /(api[_-]?key|authorization|token|secret|password)/i;
const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_REGEX = /(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/g;
const QUERY_TOKEN_REGEX = /([?&](?:api[_-]?key|key|token|access_token)=)[^&\s]+/gi;
const BEARER_REGEX = /(Bearer\s+)[A-Za-z0-9._-]+/gi;
const KEY_VALUE_REGEX = /((?:api[_-]?key|authorization|token|secret|password)\s*[:=]\s*)(["'`])?([^\s,;"'`]+)\2?/gi;
const NAME_CONTEXT_REGEX =
    /\b(?:my name is|name is|me llamo|soy|mi nombre es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})/gi;

function maskNamesByContext(input) {
    return input.replace(NAME_CONTEXT_REGEX, (match, name) => {
        if (!name) return match;
        return match.replace(name, REDACTED_NAME);
    });
}

function maskString(input) {
    if (!input) return input;
    return maskNamesByContext(
        input
            .replace(BEARER_REGEX, `$1${REDACTED_API_KEY}`)
            .replace(QUERY_TOKEN_REGEX, `$1${REDACTED_API_KEY}`)
            .replace(KEY_VALUE_REGEX, `$1${REDACTED_API_KEY}`)
            .replace(EMAIL_REGEX, REDACTED_EMAIL)
            .replace(PHONE_REGEX, REDACTED_PHONE),
    );
}

function maskArray(values) {
    return values.map((value) => maskSensitiveData(value));
}

function maskObject(obj) {
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
        if (SENSITIVE_KEY_REGEX.test(key)) {
            out[key] = REDACTED_API_KEY;
            continue;
        }
        out[key] = maskSensitiveData(value);
    }
    return out;
}

export function maskSensitiveData(value) {
    if (value == null) return value;
    if (typeof value === "string") return maskString(value);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return maskArray(value);
    if (typeof value === "object") return maskObject(value);
    return String(value);
}

export function maskForTelemetry(payload) {
    return maskSensitiveData(payload);
}
