import { compliancePack } from "./compliance-manager/index.js";
import { componentPack } from "./component-manager/index.js";
import { securityPack } from "./security-manager/index.js";
import type { Role, RolePack } from "./types.js";

export { ROLES, type Role, type RolePack } from "./types.js";

export const ROLE_PACKS: Record<Role, RolePack> = {
  "compliance-manager": compliancePack,
  "security-manager": securityPack,
  "component-manager": componentPack,
};
