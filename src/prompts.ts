import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "./config.js";
import { logger } from "./logger.js";
import { ROLE_PACKS } from "./roles/index.js";

/**
 * Registers the active role's playbooks as MCP prompts (E1: role selection).
 * A stub role pack (no dedicated playbooks yet — security-manager until E4,
 * component-manager until E5) simply registers none; the agent still gets
 * its role charter via `resources.ts` and works through the generic tools.
 */
export function registerPrompts(server: McpServer, config: ServerConfig): void {
  const pack = ROLE_PACKS[config.role];
  if (!pack.registerPlaybooks) {
    logger.info(`No dedicated playbooks yet for role "${config.role}"`);
    return;
  }
  pack.registerPlaybooks(server, config);
}
