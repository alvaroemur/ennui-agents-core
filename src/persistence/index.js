/**
 * Persistence API: createPersistence(connectionString) -> { saveChatSession, saveCollectorEvaluation }
 * If connectionString is falsy, returns no-op implementations.
 */

import {
    saveChatSession as saveChatSessionNeon,
    saveCollectorEvaluation as saveCollectorEvaluationNeon,
} from "./neon.js";

const noopAsync = async () => {};

/**
 * @param {string|null|undefined} connectionString - If falsy, returns no-op implementations.
 * @returns {{ saveChatSession: (sql: any, payload: object) => Promise<void>, saveCollectorEvaluation: (sql: any, payload: object) => Promise<{ personaId: string|null }> }}
 */
export function createPersistence(connectionString) {
    if (
        !connectionString ||
        typeof connectionString !== "string" ||
        !connectionString.trim()
    ) {
        return {
            saveChatSession: noopAsync,
            saveCollectorEvaluation: async () => ({ personaId: null }),
        };
    }
    return {
        async saveChatSession(sql, payload) {
            await saveChatSessionNeon(sql, payload);
        },
        async saveCollectorEvaluation(sql, payload) {
            return saveCollectorEvaluationNeon(sql, payload);
        },
    };
}

export { saveChatSession, saveCollectorEvaluation } from "./neon.js";
