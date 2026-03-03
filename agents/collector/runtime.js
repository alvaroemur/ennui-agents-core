/**
 * Collector runtime: readiness and ROI payload handling.
 */

function isRoiConfig(config) {
    return config && (config.id === "roi-calculator" || config.payloadSchema === "roi");
}

/**
 * Build full system prompt from config prompt fragments.
 */
export function buildSystemPrompt(config) {
    const f = config?.promptFragments || {};
    if (isRoiConfig(config)) {
        const parts = [
            f.intro ?? "",
            f.rules ?? "",
            f.persistenceInstruction ?? "",
            f.persistenceExample ?? "",
        ].filter(Boolean);
        return parts.join("\n\n");
    }
    const parts = [
        f.intro ?? "",
        f.sectionMapping ? `REFERENCIAS A OTRAS SECCIONES: ${f.sectionMapping}` : "",
        f.agentNotChatbot ?? "",
        f.rules ?? "",
        f.stepBeforeQuestionnaire ?? "",
        f.questionnaire ?? "",
        f.redFlags ?? "",
        f.classificationInstructions ?? "",
        f.persistenceInstruction ?? "",
        f.persistenceExample ?? "",
        f.questionKeysLine ?? "",
    ].filter(Boolean);
    const main = parts.join("\n\n");
    const contact = f.contactContext ? String(f.contactContext).trim() : "";
    return contact ? main + "\n\n" + contact : main;
}

function findRoiJsonSpan(text) {
    if (!text || typeof text !== "string") return null;
    const end = text.lastIndexOf("}");
    if (end < 0) return null;
    let depth = 0;
    for (let i = end; i >= 0; i--) {
        if (text[i] === "}") depth++;
        else if (text[i] === "{") {
            depth--;
            if (depth === 0) {
                const slice = text.slice(i, end + 1);
                if (/"calculator"\s*:/.test(slice) || /"facturas"\s*:/.test(slice))
                    return { start: i, end: end + 1 };
                return null;
            }
        }
    }
    return null;
}

export function parsePayload(text, config) {
    if (!text || typeof text !== "string") return null;
    if (isRoiConfig(config)) return parseRoiPayload(text);
    return parseReadinessPayload(text);
}

function parseReadinessPayload(text) {
    let jsonStr = null;
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) jsonStr = codeBlock[1].trim();
    else {
        const idx = text.indexOf('{"contact"');
        if (idx >= 0) {
            let depth = 0;
            for (let i = idx; i < text.length; i++) {
                if (text[i] === "{") depth++;
                else if (text[i] === "}") {
                    depth--;
                    if (depth === 0) {
                        jsonStr = text.slice(idx, i + 1);
                        break;
                    }
                }
            }
        }
    }
    if (!jsonStr) return null;
    try {
        const data = JSON.parse(jsonStr);
        if (data && (data.contact || data.answers || data.classification)) {
            return {
                contact: data.contact || {},
                answers: data.answers || {},
                classification: data.classification ?? null,
            };
        }
    } catch (_) {}
    return null;
}

function parseRoiPayload(text) {
    let jsonStr = null;
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) jsonStr = codeBlock[1].trim();
    else {
        let idx = text.indexOf('{"calculator"');
        if (idx < 0) idx = text.indexOf('{ "calculator"');
        if (idx < 0) idx = text.indexOf('{"facturas"');
        if (idx < 0) idx = text.indexOf('{ "facturas"');
        if (idx >= 0) {
            let depth = 0;
            for (let i = idx; i < text.length; i++) {
                if (text[i] === "{") depth++;
                else if (text[i] === "}") {
                    depth--;
                    if (depth === 0) {
                        jsonStr = text.slice(idx, i + 1);
                        break;
                    }
                }
            }
        }
    }
    if (!jsonStr) {
        const span = findRoiJsonSpan(text);
        if (span) jsonStr = text.slice(span.start, span.end);
    }
    if (!jsonStr) return null;
    try {
        const data = JSON.parse(jsonStr);
        const hasValidNumbers = (c) =>
            Number.isFinite(Number(c.facturas)) &&
            Number.isFinite(Number(c.costoPerFactura)) &&
            Number.isFinite(Number(c.horasPerFactura));
        let calc = data && data.calculator;
        if (!calc || !hasValidNumbers(calc)) {
            if (data && hasValidNumbers(data)) calc = data;
            else return null;
        }
        const sliderMin = Number.isFinite(Number(calc.sliderMin))
            ? Math.max(0, Number(calc.sliderMin))
            : 0;
        const sliderMax =
            Number.isFinite(Number(calc.sliderMax)) && Number(calc.sliderMax) > sliderMin
                ? Number(calc.sliderMax)
                : null;
        const unit =
            typeof calc.unit === "string" && calc.unit.trim() ? calc.unit.trim() : null;
        const metadata =
            data.metadata && typeof data.metadata === "object"
                ? {
                      procedureName:
                          typeof data.metadata.procedureName === "string"
                              ? data.metadata.procedureName.trim() || null
                              : null,
                      workerProfile:
                          typeof data.metadata.workerProfile === "string"
                              ? data.metadata.workerProfile.trim() || null
                              : null,
                      jobValueUsdPerMonth:
                          typeof data.metadata.jobValueUsdPerMonth === "number"
                              ? data.metadata.jobValueUsdPerMonth
                              : null,
                      jobValueHourly:
                          typeof data.metadata.jobValueHourly === "number"
                              ? data.metadata.jobValueHourly
                              : null,
                      jobValueTotalMonthly:
                          typeof data.metadata.jobValueTotalMonthly === "number"
                              ? data.metadata.jobValueTotalMonthly
                              : null,
                  }
                : {};
        let freedHoursNote = null;
        if (typeof data.freedHoursNote === "string" && data.freedHoursNote.trim())
            freedHoursNote = data.freedHoursNote.trim();
        let benefits = null;
        if (Array.isArray(data.benefits) && data.benefits.length > 0) {
            benefits = data.benefits
                .filter((b) => b && typeof b.title === "string" && b.title.trim())
                .map((b) => ({
                    icon:
                        typeof b.icon === "string" && b.icon.trim()
                            ? b.icon.trim()
                            : "fa-solid fa-circle-check",
                    title: b.title.trim(),
                    detail: typeof b.detail === "string" ? b.detail.trim() : "",
                }));
            if (benefits.length === 0) benefits = null;
        }
        return {
            facturas: Math.max(0, Math.round(calc.facturas)),
            costoPerFactura: Math.max(0, Number(calc.costoPerFactura)),
            horasPerFactura: Math.max(0, Number(calc.horasPerFactura)),
            unit,
            sliderMin,
            sliderMax,
            metadata,
            freedHoursNote,
            benefits,
        };
    } catch (_) {}
    return null;
}

export function stripPayloadForDisplay(text, config) {
    if (!text || typeof text !== "string") return text;
    if (isRoiConfig(config)) return stripRoiForDisplay(text);
    return stripReadinessForDisplay(text);
}

function stripReadinessForDisplay(text) {
    let out = text;
    out = out.replace(/```(?:json)?\s*[\s\S]*?```\s*$/g, "").trim();
    const idx = out.indexOf('{"contact"');
    if (idx >= 0) {
        let depth = 0;
        for (let i = idx; i < out.length; i++) {
            if (out[i] === "{") depth++;
            else if (out[i] === "}") {
                depth--;
                if (depth === 0) {
                    out = out.slice(0, idx).trim();
                    break;
                }
            }
        }
    }
    return out;
}

function stripRoiForDisplay(text) {
    let out = text;
    out = out.replace(
        /```(?:json)?\s*[\s\S]*?"(?:calculator|facturas)"\s*:[\s\S]*?```/g,
        ""
    ).trim();
    out = out.replace(/```(?:json)?\s*[\s\S]*?```\s*$/g, "").trim();
    let idx = out.indexOf('{"calculator"');
    if (idx < 0) idx = out.indexOf('{ "calculator"');
    if (idx < 0) idx = out.indexOf('{"facturas"');
    if (idx < 0) idx = out.indexOf('{ "facturas"');
    if (idx >= 0) {
        let depth = 0;
        for (let i = idx; i < out.length; i++) {
            if (out[i] === "{") depth++;
            else if (out[i] === "}") {
                depth--;
                if (depth === 0) {
                    out = out.slice(0, idx).trim();
                    break;
                }
            }
        }
    } else {
        const span = findRoiJsonSpan(out);
        if (span) out = (out.slice(0, span.start) + out.slice(span.end)).trim();
    }
    if (out === "" && text && text.trim().length > 0) {
        return "He prellenado la simulación con los datos de tu evaluación. Puedes ajustar el volumen y ver tu ahorro estimado.";
    }
    return out;
}

export function computeCompletion(config, payload) {
    if (isRoiConfig(config)) return null;
    if (!payload || !payload.contact || !payload.answers) return 0;
    const contact = payload.contact || {};
    const answers = payload.answers || {};
    const classification = payload.classification;
    const contactFields = config?.contactFields || [];
    const contactKeys = contactFields.map((f) => f.key);
    const contactFilled = contactKeys.filter(
        (k) => contact[k] != null && String(contact[k]).trim() !== ""
    ).length;
    const questions = config?.questions || [];
    const maxAnswerSlots =
        config?.completionWeights?.maxAnswerSlots != null
            ? config.completionWeights.maxAnswerSlots
            : Math.min(questions.length, 16);
    const answerCount = Math.min(maxAnswerSlots, Object.keys(answers).length);
    const classificationSlot =
        config?.completionWeights?.classificationSlot != null
            ? config.completionWeights.classificationSlot
            : 1;
    const hasClassification =
        classification != null && String(classification).trim() !== "";
    const contactSlots =
        config?.completionWeights?.contactSlots != null
            ? config.completionWeights.contactSlots
            : contactFields.length;
    const total =
        config?.completionWeights?.total != null
            ? config.completionWeights.total
            : contactSlots + maxAnswerSlots + classificationSlot;
    const completed =
        contactFilled + answerCount + (hasClassification ? classificationSlot : 0);
    return Math.round((completed / total) * 100);
}

export function validatePayload(payload, config) {
    if (isRoiConfig(config)) return payload != null && typeof payload === "object";
    if (!payload || typeof payload !== "object") return false;
    if (!payload.contact || typeof payload.contact !== "object") return false;
    if (!payload.answers || typeof payload.answers !== "object") return false;
    return true;
}
