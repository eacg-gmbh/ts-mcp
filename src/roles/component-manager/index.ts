import type { RolePack } from "../types.js";
import { buildCharter, DEFAULT_TITLE } from "./charter.js";

/**
 * Stub pack — charter only (E1 scope). No `registerPlaybooks`: the real
 * playbooks (metadata resolution, EOL review, duplicate-module cleanup,
 * upgrade digest) are E5's job.
 */
export const componentPack: RolePack = {
  id: "component-manager",
  defaultTitle: DEFAULT_TITLE,
  buildCharter,
};
