# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
