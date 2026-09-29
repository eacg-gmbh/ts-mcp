# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-09-29

### Added

- **`new-release` playbook** (ts-agent-svc ADR-004/§5.2, ts-mcp ADR-013) — entry point when a release cycle opens: reconciles this cycle's objectives against the previous release's state (via the `ledger` argument and `releases`/`risks` evidence), then proposes the cycle's objective set. The counterpart to `release-readiness`, which gates the cycle's exit rather than opening its entry
- **Trigger-context arguments** — every trigger-eligible playbook (`new-analysis`, `legal-decisions`, `follow-up`, `compliance-status`, `triage-vulnerabilities`, `release-readiness`, `new-release`) now accepts a shared argument set matching `ts-agent-svc`'s own webhook payload field names exactly: `projectId`, `releaseId`, `moduleId`, `analysisId`, `cveIds`, `approvalId`, `taskId`. Previously each playbook declared its own ad-hoc name (`project`, `scan_id`, `approval_id`, `release`), so the calling runtime had to remap its payload per playbook instead of passing the trigger straight through. The four playbooks invoked mid-workflow rather than by a runtime trigger (`resolve-components`, `notice-file`, `document-findings`, `stakeholder-digest`) are unchanged — they still take a plain `project` argument
- **`ledger` argument and snapshot rendering** (`src/roles/compliance-manager/ledger.ts`) — a JSON-string argument carrying the calling runtime's own ledger state (open objectives, open todos, waiting-for items, a one-line last-activation summary). `renderLedgerSnapshot()` turns it into a markdown section every trigger-context playbook interpolates near the top of its text; a missing or empty argument renders nothing, and malformed JSON is reported in the output rather than thrown. ts-mcp defines its own `LedgerSnapshot` shape for this rather than importing `ts-agent-svc`'s schemas, so the two repos stay independently versioned
- **`LEDGER_UPDATES_SECTION`** — every trigger-context playbook now closes with a fixed instruction to report objective/todo changes in a structured shape, so the runtime's `ledger_update` tool gets a clear input instead of having to parse one out of free-form prose

## [0.4.0] - 2026-09-29

### Added

- **`TS_ROLE` role selection** (ts-agent-svc ADR-004: templates map 1:1 to ts-mcp roles) — `compliance-manager` (default, unchanged behaviour), `security-manager`, `component-manager`; unknown values fail fast at startup like `TS_ACCESS_MODE`/`TS_TRANSPORT` already do
- Role pack structure: `src/roles/<role>/{charter.ts, prompts.ts, index.ts}`, dispatched by `src/resources.ts`/`src/prompts.ts` via `src/roles/index.ts`'s `ROLE_PACKS` registry. `src/roles/shared-authority.ts` holds the read/readwrite/full authority language every role's charter shares, so it doesn't drift across role packs
  - `compliance-manager` — the existing full pack (charter + 10 playbooks), moved verbatim; its `trustsource://role/compliance-manager` resource URI and charter content are unchanged
  - `security-manager` / `component-manager` — stub packs (charter only, no `registerPlaybooks`) reflecting each role's mission from ts-agent-svc's `ARCHITECTURE.md` (vulnerability posture / component hygiene respectively); their real playbooks are E4 and E5
- `TS_ROLE_TITLE`'s default is now derived from the active role pack (`ROLE_PACKS[role].defaultTitle`) instead of being hardcoded to the compliance-manager title; explicit `TS_ROLE_TITLE` still overrides it for any role
- `trustsource://role/<role>` resource URI is now parameterised by `config.role` (was hardcoded to `.../compliance-manager`) — the compliance-manager URI is unchanged since it's still the default role
- 10 new tests: `config.test.ts` (TS_ROLE defaulting, per-role title, TS_ROLE_TITLE override, fail-fast on an unknown role) and `roles/index.test.ts` (registry shape, which packs have playbooks, every charter builds without throwing)

## [0.3.0] - 2026-09-29

### Added

- **Compliance Manager role** — the server now ships an assignment, not just tools. The role is an organising one: its measure of success is items closed, not findings produced
  - Ten playbooks as MCP prompts. Legal compliance first — `new-analysis`, `resolve-components`, `notice-file`, `legal-decisions`, `follow-up` — then `compliance-status`, `triage-vulnerabilities`, `release-readiness`, `document-findings`, `stakeholder-digest`
  - Three MCP resources: role charter (`trustsource://role/compliance-manager`), compliance policy (`trustsource://policy/foss`), mandate scope (`trustsource://scope`)
  - Playbooks and charter adapt to the configured access mode — under `read` the agent produces the payloads it would have written instead of attempting writes
  - The agent drafts reminders and escalations but never sends them, and never approves, rejects or mutes on its own initiative
- **Component resolution workflow** — reconcile the licence report against the parts list, classify each component with missing data (misclassified public package vs. genuinely internal vs. third party without metadata), locate its repository, deep-scan with copyright analysis where that is the right instrument, and escalate violations only with a completed dossier
- **Policy pack** — a structured FOSS policy (licence classification, obligations, component-resolution rules, vulnerability exposure classes with per-class SLAs, VEX vocabulary, approval dossier requirements, reminder schedule, escalation paths and contacts) that the agent decides against. Built-in default, overridable via `TS_POLICY_FILE`; the server refuses to start if the configured policy file cannot be read
- **Project scoping** via `TS_PROJECT_SCOPE` — binds the server to named projects: out-of-scope project IDs are rejected, the project ID is injected when exactly one project is in scope, project listings are filtered, and account-wide operations (dashboard, CVE impact report, scan list, product list, user statistics) are withheld
- `TS_ROLE_TITLE` to name the role in the agent's charter
- `npm run policy:export` writes the default policy pack to a file for adaptation

### Security

- Closed a gap in project-scope enforcement found during pre-release review: an action whose project-identifying parameter is optional (for example `modules` → `list_modules`, which takes an optional `projectId` query filter) fell through scope enforcement when the caller left it unset and the scope named more than one project — no injection was possible (there is no single ID to fill in for a multi-project mandate) and no rejection occurred either, so the call went out unfiltered and returned every project in the account. Verified live before the fix: with a two-project scope configured, `list_modules` without an explicit project returned 100 modules spanning unrelated projects, including other accounts' infrastructure identifiers. Fixed by rejecting the call when the scope names more than one project and no explicit project ID is given, naming the projects the caller may choose from — matching the existing behaviour for an explicit out-of-scope value
- `ip-address` 10.5.0 → 10.7.2 — fixes GHSA-2vr4-cq9g-pvrc (NAT64 local-use range not recognised, SSRF/trust-boundary bypass) and GHSA-rpw4-54j3-4h4q (`Address6.isLinkLocal()` matches `fe80::/64` instead of `fe80::/10`, same bypass class); both patched upstream in 10.5.1. Reached via `@modelcontextprotocol/sdk` → `express-rate-limit`. Pinned as an `overrides` security floor, same as the other transitive floors below it

## [0.2.4] - 2026-09-28

### Fixed

- `TrustSourceClient.request()` resolved every call via `new URL(path, this.baseUrl)`. Per WHATWG URL join semantics a leading-slash `path` (every generated tool path starts with `/`) replaces the base URL's path instead of appending to it, so the client silently dropped the `/v2` segment from `this.baseUrl` on every request. Fixed with a plain string join (`this.baseUrl.replace(/\/$/, "") + path`), which does not have that behavior. Added a regression test (`src/api-client.test.ts`, via `vitest`) pinning the resolved URL for a real generated path against the real default base URL
- Checked empirically against the live TrustSource API before release: `/core/projects` and `/account/authorization` return identical `200` responses with or without the `/v2` segment (the API Gateway does not enforce the prefix, and versions via a fixed header on its side instead). So this was a latent correctness bug rather than an observed outage — worth fixing regardless, since relying on that gateway leniency was never guaranteed
- The Dockerfile installed and shipped `devDependencies` in the runtime image (`npm ci --ignore-scripts` installs them, and `COPY --from=build /app/node_modules/` copied everything; `ENV NODE_ENV=production` is set after that copy, so it had no effect on what got copied). Harmless while `devDependencies` was just `@types/node`, `tsx` and `typescript`, but this release adds `vitest`, whose transitive tree pulls in `nanoid@3.3.19` (CVE-2026-67214) — caught by the publish gate rather than by inspection. Fixed with `npm prune --omit=dev` in the build stage before the runtime `COPY`

## [0.2.3] - 2026-09-28

### Added

- The published Docker image is now a multi-platform manifest covering `linux/amd64` and `linux/arm64`. Previously only `linux/amd64` was pushed, so Apple Silicon workstations and ARM servers — including ECS/Fargate on Graviton — ran the server under emulation

### Changed

- `docker-publish` builds the release image for both platforms via QEMU/Buildx. The scan step still builds a single `linux/amd64` image, because `load: true` cannot load a manifest list into the docker daemon and ts-scan needs one concrete image; the npm dependency set is identical across platforms, so the vulnerability gate is unaffected
- Both build steps now share a GitHub Actions layer cache, so the published `amd64` image reuses the exact layers that passed the quality gate instead of being rebuilt independently

## [0.2.2] - 2026-09-27

### Security

- Bumped transitive dependencies to clear the ts-scan quality gate that blocked the v0.2.1 image publish:
  - `fast-uri` 3.1.6 → 3.1.8 — fixes CVE-2026-84394 (host confusion via an unclosed bracket in the URI authority) and CVE-2026-84292 (authority injection via an unvalidated port in `serialize`); both patched upstream in 3.1.7. Reached via `@modelcontextprotocol/sdk` → `ajv`
  - `hono` 4.13.4 → 4.13.9 — fixes GHSA-gqvv-2mrq-wpjv (`toSSG()` writes outside the output directory; incomplete fix for CVE-2026-39408), GHSA-crvj-82cr-hjcx (query parser reads parameters after the URL fragment, causing cache-key/proxy interpretation differentials) and GHSA-g6gw-c38x-mqfc (unbounded dot-notation nesting in `parseBody()` causes memory exhaustion); all patched upstream in 4.13.5
  - `qs` 6.15.2 → 6.16.0 — fixes GHSA-4mjr-xmp4-gh2g (DoS via attacker-controlled `isBuffer`) and GHSA-x5fp-wj9c-mxmx (array-limit bypass via bracket-key comma parsing). Reached via `@modelcontextprotocol/sdk` → `express`/`body-parser`
  - `@hono/node-server` 1.19.17 → 2.1.1 — GHSA-frvp-7c67-39w9 (path traversal in `serve-static` on Windows via an encoded `%5C`) is patched upstream in both 1.19.15 and 2.0.5, so 1.19.17 is already unaffected, but the version is still reported by the scan. 2.1.1 sits outside every published affected range for this advisory, so the gate clears without a module-level exemption that would have to be re-applied after every base-image bump
- Added `overrides` in `package.json` pinning security floors for `fast-uri`, `hono`, `qs` and `@hono/node-server`. Each floor stays inside the major line its parent supports, so it enforces the patched version without risking an unintended breaking bump

### Changed

- Raised the `@modelcontextprotocol/sdk` floor to `^1.30.1` (from `^1.12.0`). 1.30.0 is the first release to widen its `@hono/node-server` range to `^1.19.9 || ^2.0.5`, which the override above depends on

### Fixed

- The server no longer reports a hardcoded version. `VERSION` is now read from `package.json` at startup, so the value in the startup log, the `GET /health` response and the MCP `serverInfo` handshake always matches the released version. It had been stuck at `0.2.0` since the 0.2.1 release

## [0.2.1] - 2026-08-24

### Changed

- Synced `ts-api/openapi.yaml` with the latest TrustSource API v2 spec - clearer endpoint descriptions, required-scope documentation, and new CSAF/Threat Modeling tags
- Regenerated `src/generated-tools.ts` from the updated spec

### Security

- Bumped transitive dependencies to fix known vulnerabilities: `hono` (path traversal, CORS, ReDoS, XSS advisories), `@hono/node-server` (path traversal), `fast-uri` (host confusion), `ip-address` (SSRF bypass), `body-parser` (DoS), `esbuild` (arbitrary file read)

## [0.2.0] - 2026-06-07

### Added

- Streamable HTTP transport (`TS_TRANSPORT=http`) for multi-session server deployment
- Health check endpoint (`GET /health`) for ECS/load balancer integration
- Configurable HTTP port via `TS_HTTP_PORT` (default: 3000)
- ECS Fargate deployment via CloudFormation (in EACG fork)
- Security group restricts MCP port to consumer group only

### Changed

- Removed npm/yarn/corepack from runtime Docker image — eliminates transitive vulnerabilities

## [0.1.0] - 2026-06-03

### Added

- Initial MCP server implementation with stdio transport
- 16 domain-based tools covering the full TrustSource API v2
- Three-tier access control via `TS_ACCESS_MODE` (read, readwrite, full)
- Input validation: ID format checks, string length limits, suspicious pattern detection, SBOM structure validation (CycloneDX, SPDX)
- API key validation on startup with early exit on failure
- Structured JSON logging to stderr
- Code generation pipeline: OpenAPI spec + domain-mapping.yaml → TypeScript tool definitions
- Dockerfile with multi-stage build
- Domain mapping file for codegen configuration
- CI workflow: build validation and codegen consistency check
- Docker publish workflow with ts-scan quality gate (scan + upload + wait-for-analysis)
- Weekly OpenAPI spec sync workflow with auto-PR creation
