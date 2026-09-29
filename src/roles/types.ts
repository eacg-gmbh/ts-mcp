import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "../config.js";

/**
 * Role selection (ts-agent-svc ADR-004: templates map 1:1 to ts-mcp roles).
 * "unknown → fail fast" (loadConfig) is enforced against this list.
 */
export const ROLES = [
  "compliance-manager",
  "security-manager",
  "component-manager",
] as const;
export type Role = (typeof ROLES)[number];

/**
 * A role pack: everything that varies by `TS_ROLE`. `resources.ts` and
 * `prompts.ts` are thin dispatchers that look up the active pack by
 * `config.role` and delegate to it — they own only what's genuinely
 * role-independent (the `trustsource://policy/foss` and `trustsource://scope`
 * resources).
 *
 * `registerPlaybooks` is optional: a stub pack (charter only, no playbooks
 * yet) simply omits it. `TS_ROLE=security-manager` ships as exactly that
 * kind of stub until E4 builds out its real playbooks; `component-manager`
 * likewise until E5.
 */
export interface RolePack {
  readonly id: Role;
  /** Used as `config.roleTitle`'s default when `TS_ROLE_TITLE` isn't set. */
  readonly defaultTitle: string;
  buildCharter(config: ServerConfig, policySource: string): string;
  registerPlaybooks?(server: McpServer, config: ServerConfig): void;
}
