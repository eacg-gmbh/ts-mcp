#!/usr/bin/env node
/**
 * Writes the built-in compliance policy pack to a file so it can be adapted and
 * mounted via TS_POLICY_FILE. The pack lives in src/policy.ts as the single
 * source of truth — this script only exports a copy to start from.
 */
import { writeFileSync } from "node:fs";
import { DEFAULT_POLICY } from "../src/policy.js";

const target = process.argv[2] ?? "compliance-policy.yaml";
writeFileSync(target, DEFAULT_POLICY, "utf8");
console.log(`Wrote policy pack to ${target} — adapt it, then start the server with TS_POLICY_FILE=${target}`);
