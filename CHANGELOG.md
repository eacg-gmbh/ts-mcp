# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
