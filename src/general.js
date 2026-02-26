/**
 * General (consultor) agent: build system prompt from config.
 * Config: { chatbot: { systemPrompt, contactContext? }, sectionsContext? }
 */

/**
 * Build full system prompt for the consultor agent.
 * @param {object} config - Must have config.chatbot.systemPrompt; optional chatbot.contactContext, sectionsContext (string to append).
 * @returns {string}
 */
export function buildSystemPrompt(config) {
    const base = config?.chatbot?.systemPrompt ?? "";
    const sections = config?.sectionsContext ?? "";
    const withSections = sections ? base + "\n\n" + sections : base;
    const contact = config?.chatbot?.contactContext
        ? String(config.chatbot.contactContext).trim()
        : "";
    if (!contact) return withSections;
    return (withSections || "") + "\n\n" + contact;
}
