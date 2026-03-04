#!/usr/bin/env node
/**
 * One-off migration: remove workspace "platform" from DB and strip it from
 * auth_users.allowedAccounts. Run when using Neon/Postgres (SWITCHBOARD_DATABASE_URL).
 * Safe to run multiple times (idempotent).
 *
 * Usage: node scripts/switchboard/remove-platform-workspace.js
 * (from repo root; loads .env if dotenv is available)
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..", "..");

async function loadEnv() {
    try {
        const dotenv = await import("dotenv");
        dotenv.config({ path: join(projectRoot, ".env") });
    } catch (_) {
        // dotenv optional
    }
}

async function main() {
    await loadEnv();

    const reg = await import("../../src/switchboard/registry.js");
    const path = process.env.REGISTRY_PATH || join(projectRoot, "src", "switchboard", "data", "registry.json");
    reg.setRegistryPath(path);
    await reg.loadRegistry();

    const dbUrl = (process.env.SWITCHBOARD_DATABASE_URL || process.env.DATABASE_URL || "").trim();
    if (!dbUrl) {
        console.log("SWITCHBOARD_DATABASE_URL (or DATABASE_URL) not set; registry is file-based.");
        console.log("JSON already has platform removed. If you use Postgres, set the same URL as the app and run again.");
        process.exit(0);
        return;
    }

    const PLATFORM_ID = "platform";

    const deleted = await reg.deleteWorkspace(PLATFORM_ID);
    if (deleted) console.log("Deleted workspace:", PLATFORM_ID);

    const authUsers = await reg.listAuthUsers();
    for (const u of authUsers) {
        const accounts = Array.isArray(u.allowedAccounts) ? u.allowedAccounts : (Array.isArray(u.allowedWorkspaces) ? u.allowedWorkspaces : []);
        if (!accounts.includes(PLATFORM_ID)) continue;
        const next = accounts.filter((w) => w !== PLATFORM_ID);
        await reg.updateAuthUser(u.email, { allowedAccounts: next });
        console.log("Updated auth_user (removed platform from allowedAccounts):", u.email);
    }

    console.log("Done. Restart the app so it reloads the registry from DB.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
