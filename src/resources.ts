import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "./config.js";
import { logger } from "./logger.js";
import { loadPolicy } from "./policy.js";
import { ROLE_PACKS } from "./roles/index.js";

/**
 * Registers the three `trustsource://...` resources (ts-agent-svc
 * ARCHITECTURE.md §5.1 step 5). Only the role charter varies by `TS_ROLE`
 * (E1) — the governing policy and the mandate scope are the same shape for
 * every role, so they stay here rather than being duplicated into each role
 * pack.
 */
export function registerResources(server: McpServer, config: ServerConfig): void {
  const policy = loadPolicy(config.policyFile);
  const pack = ROLE_PACKS[config.role];

  server.registerResource(
    "role-charter",
    `trustsource://role/${config.role}`,
    {
      title: `Role charter — ${config.roleTitle}`,
      description:
        "The agent's mandate, authority, working principles and hard limits. " +
        "Read this before acting on any playbook for this role.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: pack.buildCharter(config, policy.source),
        },
      ],
    }),
  );

  server.registerResource(
    "compliance-policy",
    "trustsource://policy/foss",
    {
      title: "Open source compliance policy",
      description:
        "The governing FOSS policy: licence classification, obligations, " +
        "vulnerability exposure classes and SLAs, VEX vocabulary, escalation paths. " +
        "This is the only source of compliance truth for the agent.",
      mimeType: "text/yaml",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/yaml",
          text: policy.content,
        },
      ],
    }),
  );

  server.registerResource(
    "mandate-scope",
    "trustsource://scope",
    {
      title: "Mandate scope",
      description:
        "Which TrustSource projects this server may act on, and with what authority.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              role: config.roleTitle,
              accessMode: config.accessMode,
              projectScope:
                config.projectScope.length > 0 ? config.projectScope : "unrestricted",
              policySource: policy.source,
              writeOperationsAllowed: config.accessMode !== "read",
              approvalAuthority: config.accessMode === "full",
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  logger.info(`Registered 3 resources for role "${config.role}"`, {
    policySource: policy.source,
    scopedProjects: config.projectScope.length,
  });
}
