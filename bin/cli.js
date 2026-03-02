#!/usr/bin/env node
/**
 * CLI core: validación, listar agentes, etc.
 */

import { listAgentIds } from "../src/index.js";

const [,, cmd] = process.argv;

async function main() {
    if (cmd === "agents" || cmd === "list") {
        const ids = await listAgentIds();
        console.log(ids.join("\n"));
        return;
    }
    if (cmd === "health") {
        const base = process.env.CORE_API || "http://localhost:3000";
        try {
            const r = await fetch(base + "/health");
            const data = await r.json().catch(() => ({}));
            console.log(r.ok ? "OK" : "FAIL", data);
        } catch (e) {
            console.error("Error:", e.message);
            process.exit(1);
        }
        return;
    }
    // default: help
    console.log(`core CLI
  core list     List agent IDs from agents/
  core health   GET /health from API (CORE_API)
  core          This help`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
