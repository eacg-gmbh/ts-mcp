# TrustSource MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that exposes the [TrustSource](https://www.trustsource.io/) REST API v2 as domain-grouped tools for LLM agents. It lets Claude and other MCP-capable assistants manage SBOMs, run compliance checks, track vulnerabilities, and handle risk management — all through natural language.

## Quick Start

```bash
docker run -i --rm \
  -e TS_API_KEY=your-api-key \
  trustsource/ts-mcp
```

That's it. The server speaks MCP over stdio and is ready to be used by any MCP client.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `TS_API_KEY` | **Yes** | — | TrustSource API key ([how to obtain one](#api-key)) |
| `TS_ACCESS_MODE` | No | `read` | Access tier: `read`, `readwrite`, or `full` |
| `TS_ROLE` | No | `compliance-manager` | Role pack: `compliance-manager`, `security-manager`, or `component-manager`. `security-manager` and `component-manager` currently ship a charter only (no dedicated playbooks yet) |
| `TS_TRANSPORT` | No | `stdio` | Transport mode: `stdio` or `http` |
| `TS_HTTP_PORT` | No | `3000` | HTTP listen port (only used with `http` transport) |
| `TS_API_BASE_URL` | No | `https://api.trustsource.io/v2` | TrustSource API base URL |
| `TS_LOG_LEVEL` | No | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `TS_PROJECT_SCOPE` | No | — | Comma-separated project IDs the server may act on. Unset means the whole account. |
| `TS_POLICY_FILE` | No | — | Path to your compliance policy pack (YAML). Falls back to the built-in default. |
| `TS_ROLE_TITLE` | No | the active role's own title (e.g. `Open Source Compliance Manager`) | Role name shown to the agent in its charter |

## Transport Modes

### stdio (default)

For local use with Claude Desktop, Claude Code, or other MCP clients that launch the server as a subprocess.

### Streamable HTTP

For server deployment where multiple clients connect over the network. Each client gets an isolated session via `Mcp-Session-Id` headers.

```bash
docker run -p 3000:3000 \
  -e TS_API_KEY=your-api-key \
  -e TS_TRANSPORT=http \
  trustsource/ts-mcp
```

The server exposes:
- `POST /mcp` — MCP Streamable HTTP endpoint
- `GET /health` — Health check (`{"status":"ok","version":"..."}`)

## MCP Client Setup

### Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "trustsource": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "TS_API_KEY", "trustsource/ts-mcp"],
      "env": {
        "TS_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Code

Add to your project or user `.claude/settings.json`:

```json
{
  "mcpServers": {
    "trustsource": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "TS_API_KEY",
        "-e", "TS_ACCESS_MODE=readwrite",
        "trustsource/ts-mcp"
      ],
      "env": {
        "TS_API_KEY": "your-api-key"
      }
    }
  }
}
```

To enable write operations, set `TS_ACCESS_MODE` to `readwrite` or `full` as shown above.

## Available Tools

The server exposes 16 domain-grouped tools. Each tool bundles related API operations as actions.

| Tool | Description |
|---|---|
| `account` | Check API key authorization status |
| `projects` | List, create, update, delete projects; retrieve parts lists and SBOMs |
| `modules` | List, create, update, delete modules; retrieve parts lists and SBOMs |
| `products` | Manage products, misuse reports, support contacts, solutions, photos, documents |
| `scans` | Submit dependency scans, view results, import SBOMs (CycloneDX, SPDX) |
| `tests` | Import SARIF test results for security analysis |
| `reports` | Retrieve compliance, vulnerability, license, CVE, dashboard, and EOL reports |
| `releases` | Access published SBOMs, notice files, and CSAF/VEX advisories |
| `compliance-check` | Check license compatibility and component compliance against FOSS policies |
| `approvals` | List, view, approve, and reject compliance approval requests |
| `company` | Retrieve company FOSS compliance settings and policies |
| `vulnerabilities` | Look up CVE/CWE details, search by keyword or component |
| `psirt` | Access Product Security Incident Response CSAF/VEX advisories |
| `deepscan` | Trigger and retrieve repository deep scans for license and security analysis |
| `risks` | List, create, update, delete risk assessments and tasks |
| `users` | View user activity and API usage statistics |

## The Compliance Manager role

Tools alone make an agent capable, not responsible. Alongside the tools the server
ships a **role**: playbooks, a charter and a policy — so the agent acts as a
compliance manager for a defined set of projects instead of improvising across an
API. All three are plain MCP features, so any MCP client picks them up.

The role is primarily an *organising* one. Legal compliance rarely fails for lack of
analysis; it fails because obligations stay unresolved, notice files stay incomplete
and decisions stay unmade because nobody chased them. The playbooks are built around
closing items, not around producing findings.

### Playbooks (MCP prompts)

In Claude Desktop and Claude Code these appear as slash commands.

| Playbook | What it produces |
|---|---|
| `new-analysis` | Entry point after a scan was analysed: what changed, what legal work it creates, what to start now |
| `resolve-components` | Components with missing licence data classified, repositories located, deep scans run, violations escalated with a complete dossier |
| `notice-file` | The obligation register, what is missing from the notice file, and who supplies each missing piece |
| `legal-decisions` | Open legal questions turned into decision-ready dossiers and approval requests, plus the state of those already running |
| `follow-up` | Who owes what and how overdue it is, with drafted reminders and escalations |
| `compliance-status` | Full assessment, legal position first: blockers, actions with deadlines, and what could not be assessed |
| `triage-vulnerabilities` | Every CVE classified by exposure and reachability, with policy SLA, remedy and a drafted VEX statement |
| `release-readiness` | GO / GO WITH CONDITIONS / NO-GO, with residual risk and a sign-off record for a human to countersign |
| `document-findings` | Findings turned into TrustSource risks with treatment tasks, so the next run starts from decisions |
| `stakeholder-digest` | A 200-word digest calibrated to engineering, management, customers or auditors |

The agent drafts outgoing messages; it never sends them. It never approves, rejects
or mutes anything on its own initiative.

### Resolving components with missing licence data

The workflow behind `resolve-components` is deliberately not "scan everything":

1. **Reconcile the sources.** The licence report and the parts list count differently
   and will disagree about how many components lack licence information. The parts
   list is the addressable truth — you can only act on named components.
2. **Classify before acting.** A component marked `private` is not automatically
   internal; public packages are regularly misclassified. A misclassified public
   package needs a metadata correction, not a deep scan.
3. **Locate the repository** — `homepageUrl`, the public registry, or the
   organisation's own source control. Expect `homepageUrl` to be empty precisely for
   the components that need it most.
4. **Deep-scan** genuinely internal or metadata-less components, with copyright
   analysis: the notice file needs the copyright holders, not just the licence.
5. **Route the result.** Allowed licences get recorded; approval-required licences
   get a decision opened; violations go to a human — with the dossier completed first.

### Charter and policy (MCP resources)

| Resource | Content |
|---|---|
| `trustsource://role/<TS_ROLE>` (e.g. `.../compliance-manager`) | Mandate, authority, working principles and hard limits — what the agent must never decide alone |
| `trustsource://policy/foss` | The governing policy: licence classification, obligations, component-resolution rules, vulnerability exposure classes and SLAs, VEX vocabulary, approval dossier requirements, reminder schedule, escalation paths and contacts |
| `trustsource://scope` | Which projects the server may act on, and with what authority |

The policy is the agent's only source of compliance truth. TrustSource's API exposes
the FOSS liaison contact but not the policy document, so the policy travels with the
server. Export the default, adapt it, and mount it:

```bash
npm run policy:export -- compliance-policy.yaml
# edit it, then:
docker run -i --rm \
  -e TS_API_KEY=your-key \
  -e TS_ACCESS_MODE=readwrite \
  -e TS_POLICY_FILE=/policy/compliance-policy.yaml \
  -v $(pwd)/compliance-policy.yaml:/policy/compliance-policy.yaml:ro \
  trustsource/ts-mcp
```

If `TS_POLICY_FILE` points at a file that cannot be read, the server refuses to
start — otherwise the agent would silently decide against the built-in default
while operators assume their own policy applies.

### Project scope

`TS_PROJECT_SCOPE` binds the server to named projects. This is the difference
between handing an agent your whole account and giving it one assignment:

- Project-addressed operations must target a scoped project; anything else is rejected.
- When exactly one project is in scope, its ID is filled in automatically — the
  agent cannot forget to scope a call.
- `projects` → `list_projects` returns only the scoped projects.
- Account-wide operations with no way to narrow them (dashboard report, CVE impact
  report, scan list, product list, user statistics) are withheld entirely.

Scope is enforced in the server, not requested of the agent. It complements — and
does not replace — a TrustSource API key with appropriately narrow scopes.

## Example Prompts

Once the MCP server is connected, you can ask Claude things like:

- **"List all my TrustSource projects"** — calls `projects` with the list action
- **"Show the SBOM for project abc-123"** — retrieves the full software bill of materials
- **"Check if the MIT license is compliant with our company policy"** — runs a compliance check
- **"Find CVEs related to log4j"** — searches the vulnerability database
- **"Get the compliance report for module xyz"** — pulls a formatted compliance report
- **"Show all pending approval requests and summarize them"** — lists open approval workflows
- **"Trigger a deep scan on repository github.com/org/repo"** — starts a license and security deep scan
- **"What risks are tracked for project abc-123?"** — retrieves risk assessments and tasks

## Access Modes

The `TS_ACCESS_MODE` environment variable controls which operations the server exposes. This lets you enforce least-privilege access.

### `read` (default)

Only GET operations. The agent can list and view resources but cannot modify anything.

*Examples:* list projects, view SBOMs, read reports, search vulnerabilities, check compliance

### `readwrite`

GET plus create and update operations. The agent can add new resources and modify existing ones.

*Examples:* everything in `read`, plus: create projects, submit scans, import SBOMs, create risk assessments, update products

### `full`

All operations including destructive and approval actions. Use with caution.

*Examples:* everything in `readwrite`, plus: delete projects/modules, retire products, approve/reject compliance requests

Actions that require a higher access mode than configured are not registered as tools — the agent cannot see or call them.

## Development

### Prerequisites

- Node.js >= 20
- npm

### Build and Run

```bash
# Install dependencies
npm install

# Generate tool definitions from the OpenAPI spec and domain mapping
npm run codegen

# Build TypeScript
npm run build

# Run in development mode (tsx, no build step)
npm run dev

# Run the built server
npm start
```

### Docker

```bash
# Build the Docker image locally
npm run docker:build

# Run it
docker run -i --rm -e TS_API_KEY=your-key trustsource/ts-mcp
```

## API Key

To obtain a TrustSource API key:

1. Log in to [TrustSource](https://app.trustsource.io/)
2. Navigate to **Company Admin** > **Scanners & API**
3. Create a new API key or copy an existing one

The API key is validated on server startup. If it is missing or invalid, the server exits with a clear error message.

## License

[Apache-2.0](LICENSE)
