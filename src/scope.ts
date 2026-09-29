import { logger } from "./logger.js";
import type { ToolAction } from "./generated-tools.js";

/**
 * Server-enforced `TS_PROJECT_SCOPE` (ADR-010): binds a deployment to named
 * projects so the agent cannot enumerate or act on the rest of the account.
 * Extracted from index.ts (E3) so this logic — and its extension to
 * release/CSAF-key-addressed actions — can be unit-tested directly.
 */

/** Parameter names through which an operation addresses a single project. */
const PROJECT_PARAM_NAMES = ["project_id", "projectId"];

/**
 * Operations that return account-wide data with no way to narrow them to a
 * project. They are withheld while a project scope is configured — otherwise a
 * scoped mandate would still expose the rest of the account.
 */
const ACCOUNT_WIDE_ACTIONS = new Set([
  "reports.list_dashboard",
  "reports.list_cve",
  "scans.list_scans",
  "products.list_products",
  "users.list_nologin",
  "users.list_usage",
]);

/**
 * `release_key`/`csaf_key`-addressed actions (the `releases` domain) have no
 * project-identifying parameter at all — and the TrustSource API gives no way
 * to look up which project a release/CSAF key belongs to (filed as
 * eacg-gmbh/ts-api#1; E3). Without this, a scoped server passes a release/CSAF
 * key straight through with no scope check whatsoever, regardless of
 * `TS_PROJECT_SCOPE`.
 *
 * These actions instead gain a synthetic `projectId` argument (added to their
 * input schema in index.ts's `buildInputSchema`) that a scoped server requires
 * and checks exactly like a real `project_id`/`projectId` parameter —
 * auto-injected when the mandate names exactly one project, required
 * otherwise — but it is never forwarded to the TrustSource API (query/path
 * building only ever uses `action.params`, which this argument isn't part
 * of). This is a caller assertion, not independent verification: the API
 * cannot confirm a given release/CSAF key actually belongs to the asserted
 * project. Until ts-api#1 lands, treat this as closing the "no check happened
 * at all" gap, not as equivalent to the verified checks elsewhere here.
 */
export function isReleaseKeyAction(action: ToolAction): boolean {
  return action.params.some((p) => p.name === "release_key" || p.name === "csaf_key");
}

/**
 * Enforces the configured project scope. Mutates `args` to inject the project ID
 * when the scope names exactly one project and the caller left it out.
 */
export function enforceProjectScope(
  toolName: string,
  action: ToolAction,
  args: Record<string, unknown>,
  scope: string[],
): string | null {
  if (scope.length === 0) return null;

  if (ACCOUNT_WIDE_ACTIONS.has(`${toolName}.${action.name}`)) {
    return `Action "${action.name}" returns account-wide data and is withheld: this server's mandate covers only ${scope.join(", ")}.`;
  }

  const param = action.params.find((p) => PROJECT_PARAM_NAMES.includes(p.name));
  const paramName = param ? param.name : isReleaseKeyAction(action) ? "projectId" : undefined;
  if (!paramName) return null;

  const value = args[paramName];

  if (value === undefined || value === "") {
    if (scope.length === 1) {
      args[paramName] = scope[0];
      logger.debug("Injected scoped project ID", { action: action.name, projectId: scope[0] });
      return null;
    }
    // With more than one project in scope there is no single ID to inject, and
    // the parameter is optional at the API level — leaving it unset would send
    // the call unfiltered and return every project in the account. Reject
    // rather than silently widen the mandate; the caller must name one of the
    // scoped projects explicitly.
    return `Action "${action.name}" requires a project ID and none was given. This server's mandate covers more than one project — specify one of: ${scope.join(", ")}.`;
  }

  if (!scope.includes(String(value))) {
    return `Project "${value}" is outside this server's mandate. Permitted: ${scope.join(", ")}.`;
  }

  return null;
}

/** Removes projects outside the mandate from a project listing response. */
export function filterProjectList(body: unknown, scope: string[]): unknown {
  if (scope.length === 0 || !Array.isArray(body)) return body;
  return body.filter(
    (entry) =>
      entry && typeof entry === "object" && scope.includes(String((entry as Record<string, unknown>)._id)),
  );
}
