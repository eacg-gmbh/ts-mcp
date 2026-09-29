#!/usr/bin/env node

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { loadConfig, isAccessAllowed, type AccessMode } from "./config.js";
import { TrustSourceClient } from "./api-client.js";
import { logger, setLogLevel } from "./logger.js";
import { validateId, validateStringParam, validateJsonBody, validateSbomDocument } from "./validation.js";
import { DOMAIN_TOOLS, type ToolAction, type DomainTool } from "./generated-tools.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { enforceProjectScope, filterProjectList, isReleaseKeyAction } from "./scope.js";

// Single source of truth is package.json, so the reported version can never
// drift from the released one. Resolves to the package root from both
// dist/index.js (production) and src/index.ts (tsx dev).
function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

const VERSION = readVersion();

function buildInputSchema(tool: DomainTool) {
  const actionNames = tool.actions.map((a) => a.name);

  const allParamNames = new Set<string>();
  for (const action of tool.actions) {
    for (const param of action.params) {
      allParamNames.add(param.name);
    }
    if (action.hasBody) allParamNames.add("body");
    // See isReleaseKeyAction's doc comment: a release_key/csaf_key-addressed
    // action gains a synthetic projectId argument, never sent to the API,
    // purely so a scoped server has something to check.
    if (isReleaseKeyAction(action)) allParamNames.add("projectId");
  }

  const shape: Record<string, z.ZodTypeAny> = {
    action: z.enum(actionNames as [string, ...string[]]).describe(
      `Action to perform. Available: ${actionNames.join(", ")}`,
    ),
  };

  for (const paramName of allParamNames) {
    const descriptions: string[] = [];
    let isEverRequired = false;

    for (const action of tool.actions) {
      if (paramName === "body") {
        if (action.hasBody) {
          descriptions.push(`[${action.name}] Request body (JSON object)`);
        }
        continue;
      }
      if (paramName === "projectId" && isReleaseKeyAction(action)) {
        descriptions.push(
          `[${action.name}] TrustSource project this release/CSAF key belongs to — required when this server has a project mandate configured, so it can check the key is within scope. Not sent to the TrustSource API, which has no way to verify this itself.`,
        );
        continue;
      }
      const param = action.params.find((p) => p.name === paramName);
      if (param) {
        descriptions.push(`[${action.name}] ${param.description}`);
        if (param.required) isEverRequired = true;
      }
    }

    const desc = descriptions.join("; ");

    if (paramName === "body") {
      shape[paramName] = z.record(z.unknown()).optional().describe(desc);
    } else if (isEverRequired) {
      shape[paramName] = z.string().optional().describe(desc);
    } else {
      shape[paramName] = z.string().optional().describe(desc);
    }
  }

  return shape;
}

function resolveAction(
  tool: DomainTool,
  actionName: string,
  accessMode: AccessMode,
): ToolAction | { error: string } {
  const action = tool.actions.find((a) => a.name === actionName);
  if (!action) {
    return {
      error: `Unknown action "${actionName}". Available: ${tool.actions.map((a) => a.name).join(", ")}`,
    };
  }
  if (!isAccessAllowed(action.minAccessMode, accessMode)) {
    return {
      error: `Action "${actionName}" requires access mode "${action.minAccessMode}" but server is configured with "${accessMode}"`,
    };
  }
  return action;
}

function validateParams(
  action: ToolAction,
  args: Record<string, unknown>,
): string | null {
  for (const param of action.params) {
    const value = args[param.name];
    if (param.required && (value === undefined || value === "")) {
      return `Missing required parameter: ${param.name}`;
    }
    if (value !== undefined && typeof value === "string") {
      if (param.in === "path") {
        const idError = validateId(value, param.name);
        if (idError) return idError;
      } else {
        const strError = validateStringParam(value, param.name);
        if (strError) return strError;
      }
    }
  }

  if (action.hasBody && args.body) {
    const bodyStr = JSON.stringify(args.body);

    const isCyclonedx = action.path.includes("cyclonedx");
    const isSpdx = action.path.includes("spdx");

    if (isCyclonedx) {
      const err = validateSbomDocument(bodyStr, "cyclonedx");
      if (err) return err;
    } else if (isSpdx) {
      const err = validateSbomDocument(bodyStr, "spdx");
      if (err) return err;
    } else {
      const err = validateJsonBody(bodyStr, "request body");
      if (err) return err;
    }
  }

  return null;
}

function buildApiPath(
  pathTemplate: string,
  args: Record<string, unknown>,
): string {
  return pathTemplate.replace(/\{([^}]+)\}/g, (_, paramName) => {
    const value = args[paramName];
    return encodeURIComponent(String(value));
  });
}

function registerTools(
  server: McpServer,
  accessMode: AccessMode,
  client: TrustSourceClient,
  projectScope: string[] = [],
): void {
  const availableTools = DOMAIN_TOOLS.filter((tool) =>
    tool.actions.some((a) => isAccessAllowed(a.minAccessMode, accessMode)),
  );

  for (const tool of availableTools) {
    const visibleActions = tool.actions.filter((a) =>
      isAccessAllowed(a.minAccessMode, accessMode),
    );

    const actionDescriptions = visibleActions
      .map((a) => `- ${a.name}: ${a.summary || a.description}`)
      .join("\n");

    const fullDescription = `${tool.description}\n\nAvailable actions:\n${actionDescriptions}`;

    const inputShape = buildInputSchema({
      ...tool,
      actions: visibleActions,
    });

    server.tool(tool.name, fullDescription, inputShape, async (args) => {
      const actionName = args.action as string;

      logger.info(`Tool call: ${tool.name}.${actionName}`, {
        params: Object.keys(args).filter((k) => k !== "action" && k !== "body"),
      });

      const resolved = resolveAction(tool, actionName, accessMode);
      if ("error" in resolved) {
        logger.warn(`Access denied: ${resolved.error}`);
        return { content: [{ type: "text", text: resolved.error }], isError: true };
      }

      const scopeError = enforceProjectScope(
        tool.name,
        resolved,
        args as Record<string, unknown>,
        projectScope,
      );
      if (scopeError) {
        logger.warn(`Out of scope: ${scopeError}`);
        return { content: [{ type: "text", text: scopeError }], isError: true };
      }

      const validationError = validateParams(resolved, args as Record<string, unknown>);
      if (validationError) {
        logger.warn(`Validation failed: ${validationError}`);
        return { content: [{ type: "text", text: validationError }], isError: true };
      }

      const apiPath = buildApiPath(resolved.path, args as Record<string, unknown>);

      const queryParams: Record<string, string> = {};
      for (const param of resolved.params) {
        if (param.in === "query") {
          const value = (args as Record<string, unknown>)[param.name];
          if (value !== undefined && value !== "") {
            queryParams[param.name] = String(value);
          }
        }
      }

      try {
        const response = await client.request(resolved.method, apiPath, {
          query: Object.keys(queryParams).length > 0 ? queryParams : undefined,
          body: resolved.hasBody ? (args as Record<string, unknown>).body : undefined,
        });

        if (response.status >= 400) {
          const errorText =
            typeof response.body === "string"
              ? response.body
              : JSON.stringify(response.body, null, 2);
          logger.warn(`API error ${response.status}`, { path: apiPath });
          return {
            content: [
              {
                type: "text",
                text: `TrustSource API returned ${response.status}:\n${errorText}`,
              },
            ],
            isError: true,
          };
        }

        const responseBody =
          tool.name === "projects" && resolved.name === "list_projects"
            ? filterProjectList(response.body, projectScope)
            : response.body;

        const resultText =
          typeof responseBody === "string"
            ? responseBody
            : JSON.stringify(responseBody, null, 2);

        return { content: [{ type: "text", text: resultText }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Request failed: ${message}`);
        return {
          content: [{ type: "text", text: `Request failed: ${message}` }],
          isError: true,
        };
      }
    });
  }

  logger.info(`Registered ${availableTools.length} domain tools`, {
    tools: availableTools.map((t) => t.name),
  });
}

async function main() {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  logger.info(`TrustSource MCP Server v${VERSION} starting`, {
    accessMode: config.accessMode,
    transport: config.transport,
    baseUrl: config.apiBaseUrl,
    role: config.roleTitle,
    projectScope:
      config.projectScope.length > 0 ? config.projectScope : "unrestricted",
  });

  const client = new TrustSourceClient(config.apiBaseUrl, config.apiKey);

  logger.info("Validating API key...");
  const keyValid = await client.validateApiKey();
  if (!keyValid) {
    logger.error(
      "API key validation failed — the key is invalid or TrustSource API is unreachable. " +
        "Check your TS_API_KEY and try again.",
    );
    process.exit(1);
  }
  logger.info("API key validated successfully");

  if (config.transport === "stdio") {
    const server = new McpServer({
      name: "trustsource",
      version: VERSION,
    });
    registerTools(server, config.accessMode, client, config.projectScope);
    registerResources(server, config);
    registerPrompts(server, config);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("MCP server connected via stdio");
  } else {
    // Streamable HTTP transport — multi-session capable
    const sessions = new Map<string, StreamableHTTPServerTransport>();

    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${config.httpPort}`);

      // Health check endpoint
      if (url.pathname === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", version: VERSION }));
        return;
      }

      // MCP endpoint
      if (url.pathname === "/mcp") {
        // Check for existing session
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        if (sessionId && sessions.has(sessionId)) {
          // Existing session
          const transport = sessions.get(sessionId)!;
          await transport.handleRequest(req, res);
          return;
        }

        if (sessionId && !sessions.has(sessionId)) {
          // Unknown session ID
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
          return;
        }

        // New session — create transport and connect a fresh server instance
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            sessions.delete(sid);
            logger.info(`Session closed: ${sid}`);
          }
        };

        const sessionServer = new McpServer({
          name: "trustsource",
          version: VERSION,
        });

        // Register tools, resources and playbooks on the session server
        registerTools(sessionServer, config.accessMode, client, config.projectScope);
        registerResources(sessionServer, config);
        registerPrompts(sessionServer, config);

        await sessionServer.connect(transport);
        await transport.handleRequest(req, res);

        if (transport.sessionId) {
          sessions.set(transport.sessionId, transport);
          logger.info(`New session: ${transport.sessionId}`);
        }
        return;
      }

      // 404 for everything else
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    httpServer.listen(config.httpPort, () => {
      logger.info(`MCP server listening on http://0.0.0.0:${config.httpPort}/mcp`, {
        transport: "streamable-http",
        port: config.httpPort,
      });
    });
  }
}

main().catch((err) => {
  logger.error("Fatal error", { error: String(err) });
  process.exit(1);
});
