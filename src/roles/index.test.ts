import { describe, expect, it } from "vitest";
import type { ServerConfig } from "../config.js";
import { ROLE_PACKS, ROLES } from "./index.js";

function baseConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    apiKey: "k",
    apiBaseUrl: "https://api.trustsource.io/v2",
    accessMode: "read",
    transport: "stdio",
    httpPort: 3000,
    logLevel: "info",
    projectScope: [],
    role: "compliance-manager",
    roleTitle: "Open Source Compliance Manager",
    ...overrides,
  };
}

describe("ROLE_PACKS", () => {
  it("has exactly the three roles ADR-004 maps ts-agent-svc templates to", () => {
    expect(Object.keys(ROLE_PACKS).sort()).toEqual([...ROLES].sort());
  });

  it("compliance-manager is the only pack with playbooks today", () => {
    expect(ROLE_PACKS["compliance-manager"].registerPlaybooks).toBeDefined();
    expect(ROLE_PACKS["security-manager"].registerPlaybooks).toBeUndefined();
    expect(ROLE_PACKS["component-manager"].registerPlaybooks).toBeUndefined();
  });

  for (const role of ROLES) {
    it(`${role}'s charter mentions its own default title and doesn't throw`, () => {
      const pack = ROLE_PACKS[role];
      const config = baseConfig({ role, roleTitle: pack.defaultTitle });
      const charter = pack.buildCharter(config, "built-in default pack");
      expect(charter).toContain(pack.defaultTitle);
      expect(charter.length).toBeGreaterThan(0);
    });
  }
});
