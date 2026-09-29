import type { RolePack } from "../types.js";
import { buildCharter, DEFAULT_TITLE } from "./charter.js";
import { registerPlaybooks } from "./prompts.js";

export const compliancePack: RolePack = {
  id: "compliance-manager",
  defaultTitle: DEFAULT_TITLE,
  buildCharter,
  registerPlaybooks,
};
