import type { RolePack } from "../types.js";
import { buildCharter, DEFAULT_TITLE } from "./charter.js";

/**
 * Stub pack — charter only (E1 scope). No `registerPlaybooks`: the real
 * playbooks (triage-vulnerabilities, release-readiness, VEX drafting, PSIRT
 * advisories, threat-model follow-up) are E4's job.
 */
export const securityPack: RolePack = {
  id: "security-manager",
  defaultTitle: DEFAULT_TITLE,
  buildCharter,
};
