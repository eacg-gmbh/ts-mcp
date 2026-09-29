import { ROLE_PACKS, ROLES, type Role } from "./roles/index.js";

export const ACCESS_MODES = ["read", "readwrite", "full"] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

const ACCESS_MODE_RANK: Record<AccessMode, number> = {
  read: 0,
  readwrite: 1,
  full: 2,
};

export function isAccessAllowed(
  required: AccessMode,
  current: AccessMode,
): boolean {
  return ACCESS_MODE_RANK[current] >= ACCESS_MODE_RANK[required];
}

export const TRANSPORTS = ["stdio", "http"] as const;
export type TransportMode = (typeof TRANSPORTS)[number];

export interface ServerConfig {
  apiKey: string;
  apiBaseUrl: string;
  accessMode: AccessMode;
  transport: TransportMode;
  httpPort: number;
  logLevel: "debug" | "info" | "warn" | "error";
  /**
   * Project IDs the server is allowed to act on. Empty means no restriction.
   * When set, project-addressed operations must target one of these IDs and
   * account-wide operations are withheld.
   */
  projectScope: string[];
  /** Path to a YAML policy pack overriding the built-in default. */
  policyFile?: string;
  /** Which role pack governs the charter and playbooks (ts-agent-svc ADR-004:
   * templates map 1:1 to ts-mcp roles). */
  role: Role;
  /** Free-text role assignment shown to the agent in the role charter.
   * Defaults to the active role pack's own title; `TS_ROLE_TITLE` overrides
   * it for either role. */
  roleTitle: string;
}

export function loadConfig(): ServerConfig {
  const apiKey = process.env.TS_API_KEY;
  if (!apiKey) {
    console.error(
      "[FATAL] TS_API_KEY environment variable is required. " +
        "Obtain an API key from your TrustSource company settings under Scanners & API.",
    );
    process.exit(1);
  }

  const rawMode = process.env.TS_ACCESS_MODE ?? "read";
  if (!ACCESS_MODES.includes(rawMode as AccessMode)) {
    console.error(
      `[FATAL] TS_ACCESS_MODE must be one of: ${ACCESS_MODES.join(", ")}. Got: "${rawMode}"`,
    );
    process.exit(1);
  }

  const rawRole = process.env.TS_ROLE ?? "compliance-manager";
  if (!ROLES.includes(rawRole as Role)) {
    console.error(
      `[FATAL] TS_ROLE must be one of: ${ROLES.join(", ")}. Got: "${rawRole}"`,
    );
    process.exit(1);
  }
  const role = rawRole as Role;

  const rawTransport = process.env.TS_TRANSPORT ?? "stdio";
  if (!TRANSPORTS.includes(rawTransport as TransportMode)) {
    console.error(
      `[FATAL] TS_TRANSPORT must be one of: ${TRANSPORTS.join(", ")}. Got: "${rawTransport}"`,
    );
    process.exit(1);
  }

  const httpPort = parseInt(process.env.TS_HTTP_PORT ?? "3000", 10);

  const projectScope = (process.env.TS_PROJECT_SCOPE ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  for (const id of projectScope) {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(id)) {
      console.error(
        `[FATAL] TS_PROJECT_SCOPE contains an invalid project ID: "${id}". ` +
          "Expected a comma-separated list of TrustSource project IDs.",
      );
      process.exit(1);
    }
  }

  return {
    apiKey,
    apiBaseUrl:
      process.env.TS_API_BASE_URL ?? "https://api.trustsource.io/v2",
    accessMode: rawMode as AccessMode,
    transport: rawTransport as TransportMode,
    httpPort,
    logLevel:
      (process.env.TS_LOG_LEVEL as ServerConfig["logLevel"]) ?? "info",
    projectScope,
    policyFile: process.env.TS_POLICY_FILE,
    role,
    roleTitle: process.env.TS_ROLE_TITLE ?? ROLE_PACKS[role].defaultTitle,
  };
}
