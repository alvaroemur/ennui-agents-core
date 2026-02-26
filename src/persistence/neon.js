/**
 * Neon persistence: chat_sessions, chat_messages, personas, collector_evaluations.
 */

import { neon } from "@neondatabase/serverless";

/**
 * @param {string} connectionString
 * @returns {import('@neondatabase/serverless').NeonQueryFunction}
 */
export function createClient(connectionString) {
    if (!connectionString || typeof connectionString !== "string" || !connectionString.trim()) {
        throw new Error("Persistence requires a non-empty connectionString");
    }
    return neon(connectionString);
}

/**
 * Save or update chat session and replace messages.
 * Payload: { id, agent, startedAt, messages, pageMode?, pageUrl?, port?, personaId? }
 */
export async function saveChatSession(sql, payload) {
    const {
        id,
        agent,
        type,
        startedAt,
        messages,
        pageMode,
        pageUrl,
        port,
        personaId,
    } = payload;
    const agentVal = agent ?? type;
    if (!id || !agentVal || !Array.isArray(messages)) {
        throw new Error("Missing required fields: id, agent (or type), messages[]");
    }
    const hasUserMessage = messages.some((m) => m && m.role === "user");
    const personaIdVal =
        personaId && typeof personaId === "string" && personaId.trim()
            ? personaId.trim()
            : null;
    let pageModeVal =
        pageMode != null && String(pageMode).trim() !== ""
            ? String(pageMode).trim()
            : null;
    const TEST_TRIGGERS = ["/berserk", "/borrador", "/test"];
    const messagesContainTestTrigger =
        Array.isArray(messages) &&
        messages.some((m) => {
            if (!m || m.role !== "user") return false;
            const text = ((m.content && String(m.content)) || "").trim().toLowerCase();
            return TEST_TRIGGERS.some((t) => text === t || text.includes(t));
        });
    if (messagesContainTestTrigger && pageModeVal && !pageModeVal.endsWith(":test")) {
        pageModeVal = pageModeVal + ":test";
    } else if (messagesContainTestTrigger && !pageModeVal) {
        pageModeVal = "showcase:test";
    }
    const portVal =
        port != null && String(port).trim() !== "" ? String(port).trim() : null;
    const startedAtVal = startedAt || new Date().toISOString();
    const pageUrlVal = pageUrl ?? null;
    const proposalIdVal =
        pageModeVal && pageModeVal.startsWith("proposal:")
            ? pageModeVal.slice("proposal:".length)
            : null;

    const tryInsertSession = async (usePersonaId) => {
        try {
            await sql`
                INSERT INTO chat_sessions (id, agent, started_at, page_mode, page_url, port, persona_id)
                VALUES (${id}::uuid, ${agentVal}, ${startedAtVal}::timestamptz,
                        ${pageModeVal}, ${pageUrlVal}, ${portVal}, ${usePersonaId})
                ON CONFLICT (id) DO UPDATE SET
                    page_mode  = COALESCE(EXCLUDED.page_mode, chat_sessions.page_mode),
                    page_url   = COALESCE(EXCLUDED.page_url, chat_sessions.page_url),
                    port       = COALESCE(EXCLUDED.port, chat_sessions.port),
                    persona_id = COALESCE(EXCLUDED.persona_id, chat_sessions.persona_id)
            `;
            return "new";
        } catch (e) {
            if (e.code === "42703" || (e.message && e.message.includes("column"))) {
                await sql`
                    INSERT INTO chat_sessions (id, type, started_at, proposal_id, page_url)
                    VALUES (${id}::uuid, ${agentVal}, ${startedAtVal}::timestamptz,
                            ${proposalIdVal}, ${pageUrlVal})
                    ON CONFLICT (id) DO UPDATE SET
                        proposal_id = COALESCE(EXCLUDED.proposal_id, chat_sessions.proposal_id),
                        page_url    = COALESCE(EXCLUDED.page_url, chat_sessions.page_url)
                `;
                return "old";
            }
            throw e;
        }
    };

    try {
        await tryInsertSession(personaIdVal);
    } catch (sessionErr) {
        if (sessionErr.code === "23503" && personaIdVal) {
            await tryInsertSession(null);
        } else {
            throw sessionErr;
        }
    }

    await sql`DELETE FROM chat_messages WHERE session_id = ${id}::uuid`;

    if (hasUserMessage) {
        for (const m of messages) {
            const role = m && m.role ? String(m.role) : "user";
            const content = m && m.content != null ? String(m.content) : "";
            const ts = m && m.timestamp ? m.timestamp : new Date().toISOString();
            await sql`
                INSERT INTO chat_messages (session_id, role, content, timestamp)
                VALUES (${id}::uuid, ${role}, ${content}, ${ts}::timestamptz)
            `;
        }
    }
}

/**
 * Save or update collector evaluation and persona if needed.
 * Payload: { collectorId, sessionId, personaId?, contact?, sessionMetadata?, answers?, classification?, completionPercent?, elapsedSeconds? }
 * @returns {Promise<{ personaId: string|null }>}
 */
export async function saveCollectorEvaluation(sql, payload) {
    const {
        collectorId,
        sessionId,
        personaId,
        contact = {},
        sessionMetadata = {},
        answers = {},
        classification,
        completionPercent,
        elapsedSeconds,
    } = payload;

    if (!collectorId || typeof collectorId !== "string" || !collectorId.trim()) {
        throw new Error("Missing or invalid required field: collectorId");
    }
    if (!sessionId) {
        throw new Error("Missing required field: sessionId");
    }

    const name = contact.name != null ? String(contact.name).trim() || null : null;
    const email = contact.email != null ? String(contact.email).trim() || null : null;
    const company = contact.company != null ? String(contact.company).trim() || null : null;
    const phone = contact.phone != null ? String(contact.phone).trim() || null : null;
    const sessionMetaJson =
        typeof sessionMetadata === "object" && sessionMetadata !== null
            ? JSON.stringify(sessionMetadata)
            : "{}";
    const answersJson = typeof answers === "object" ? JSON.stringify(answers) : "{}";
    const classificationVal = classification ?? null;
    const completionVal =
        completionPercent != null && Number.isFinite(Number(completionPercent))
            ? Math.min(100, Math.max(0, Math.round(Number(completionPercent))))
            : 0;
    const elapsedVal =
        elapsedSeconds != null && Number.isFinite(Number(elapsedSeconds))
            ? Math.max(0, Math.round(Number(elapsedSeconds)))
            : 0;
    const now = new Date().toISOString();

    let resolvedPersonaId =
        personaId && typeof personaId === "string" ? personaId.trim() : null;

    if (resolvedPersonaId) {
        const hasContactUpdate =
            contact &&
            (Object.prototype.hasOwnProperty.call(contact, "name") ||
                Object.prototype.hasOwnProperty.call(contact, "email") ||
                Object.prototype.hasOwnProperty.call(contact, "company") ||
                Object.prototype.hasOwnProperty.call(contact, "phone"));
        if (hasContactUpdate) {
            await sql`
                UPDATE personas
                SET
                    name       = ${name},
                    email      = ${email},
                    company    = ${company},
                    phone      = ${phone},
                    updated_at = ${now}::timestamptz
                WHERE id = ${resolvedPersonaId}::uuid
            `;
        }
        if (sessionMetaJson !== "{}") {
            await sql`
                UPDATE personas
                SET session_metadata = session_metadata || ${sessionMetaJson}::jsonb,
                    updated_at       = ${now}::timestamptz
                WHERE id = ${resolvedPersonaId}::uuid
            `;
        }
    } else {
        const [row] = await sql`
            INSERT INTO personas (name, email, company, phone, session_metadata, created_at, updated_at)
            VALUES (${name}, ${email}, ${company}, ${phone}, ${sessionMetaJson}::jsonb, ${now}::timestamptz, ${now}::timestamptz)
            RETURNING id
        `;
        resolvedPersonaId = row?.id ?? null;
        if (!resolvedPersonaId) {
            throw new Error("Failed to create persona");
        }
    }

    await sql`
        INSERT INTO collector_evaluations (collector_id, session_id, persona_id, answers, classification, completion_percent, elapsed_seconds, created_at, updated_at)
        VALUES (${collectorId.trim()}, ${sessionId}::uuid, ${resolvedPersonaId}::uuid, ${answersJson}::jsonb, ${classificationVal}, ${completionVal}, ${elapsedVal}, ${now}::timestamptz, ${now}::timestamptz)
        ON CONFLICT (collector_id, session_id) DO UPDATE SET
            persona_id         = EXCLUDED.persona_id,
            answers            = EXCLUDED.answers,
            classification     = COALESCE(EXCLUDED.classification, collector_evaluations.classification),
            completion_percent = EXCLUDED.completion_percent,
            elapsed_seconds    = EXCLUDED.elapsed_seconds,
            updated_at         = EXCLUDED.updated_at
    `;

    return { personaId: resolvedPersonaId };
}
