import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import type { ServerConfig } from "../../config.js";
import { registerPlaybooks } from "./prompts.js";

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

/** Captures every `server.registerPrompt()` call instead of running a real
 * MCP server — mirrors E1's `roles/index.test.ts` pattern of a minimal
 * `ServerConfig` fixture, applied to prompt registration. */
type PromptRegistration = {
  name: string;
  meta: { argsSchema?: Record<string, unknown> };
  handler: (args: Record<string, string | undefined>) => { messages: Array<{ content: { text: string } }> };
};

function fakeServer() {
  const registrations = new Map<string, PromptRegistration>();
  const server = {
    registerPrompt: (
      name: string,
      meta: PromptRegistration["meta"],
      handler: PromptRegistration["handler"],
    ) => {
      registrations.set(name, { name, meta, handler });
    },
  } as unknown as McpServer;
  return { server, registrations };
}

function renderedText(reg: PromptRegistration, args: Record<string, string | undefined>): string {
  return reg.handler(args).messages[0].content.text;
}

describe("registerPlaybooks — new-release (E2)", () => {
  it("registers new-release with the shared trigger-context argument set", () => {
    const { server, registrations } = fakeServer();
    registerPlaybooks(server, baseConfig());

    const reg = registrations.get("new-release");
    expect(reg).toBeDefined();
    expect(Object.keys(reg?.meta.argsSchema ?? {}).sort()).toEqual(
      [
        "analysisId",
        "approvalId",
        "cveIds",
        "ledger",
        "moduleId",
        "projectId",
        "releaseId",
        "taskId",
      ].sort(),
    );
  });

  it("renders without a ledger argument — no ledger snapshot section, no crash", () => {
    const { server, registrations } = fakeServer();
    registerPlaybooks(server, baseConfig());
    const reg = registrations.get("new-release");
    expect(reg).toBeDefined();

    const rendered = renderedText(reg as PromptRegistration, { projectId: "proj-1", releaseId: "rel-9" });

    expect(rendered).toContain("release `rel-9`");
    expect(rendered).toContain("## Reconcile against the previous release");
    expect(rendered).toContain("## Ledger updates");
    expect(rendered).not.toContain("## Ledger snapshot");
  });

  it("renders with a valid ledger argument — the snapshot section is included", () => {
    const { server, registrations } = fakeServer();
    registerPlaybooks(server, baseConfig());
    const reg = registrations.get("new-release");
    expect(reg).toBeDefined();

    const ledger = JSON.stringify({
      objectives: [{ id: "obj-1", kind: "release", status: "open", releaseId: "rel-8" }],
      lastActivationSummary: "Closed the notice-file gap from the last cycle.",
    });
    const rendered = renderedText(reg as PromptRegistration, {
      projectId: "proj-1",
      releaseId: "rel-9",
      ledger,
    });

    expect(rendered).toContain("## Ledger snapshot");
    expect(rendered).toContain("Closed the notice-file gap from the last cycle.");
    expect(rendered).toContain("`obj-1` (release) — open [release `rel-8`]");
    expect(rendered).toContain("## Ledger updates");
  });

  it("renders with a malformed ledger argument — reports it instead of throwing", () => {
    const { server, registrations } = fakeServer();
    registerPlaybooks(server, baseConfig());
    const reg = registrations.get("new-release");
    expect(reg).toBeDefined();

    const rendered = renderedText(reg as PromptRegistration, { ledger: "{not json" });
    expect(rendered).toContain("not valid JSON");
  });

  it("still registers exactly 11 playbooks with the trigger-context set applied consistently", () => {
    const { server, registrations } = fakeServer();
    registerPlaybooks(server, baseConfig());
    expect(registrations.size).toBe(11);

    for (const name of [
      "new-analysis",
      "legal-decisions",
      "follow-up",
      "compliance-status",
      "triage-vulnerabilities",
      "release-readiness",
      "new-release",
    ]) {
      const reg = registrations.get(name);
      expect(reg, `${name} should be registered`).toBeDefined();
      expect(Object.keys(reg?.meta.argsSchema ?? {})).toEqual(
        expect.arrayContaining(["projectId", "releaseId", "ledger"]),
      );
    }
  });
});
