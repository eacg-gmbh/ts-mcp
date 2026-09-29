import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";

/** loadConfig() reads directly from process.env and calls process.exit(1) on
 * a fatal misconfiguration — stub both so invalid-input cases are testable
 * without actually killing the test process. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("loadConfig — TS_ROLE (E1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to compliance-manager with no TS_ROLE set", () => {
    withEnv({ TS_API_KEY: "k", TS_ROLE: undefined }, () => {
      const config = loadConfig();
      expect(config.role).toBe("compliance-manager");
      expect(config.roleTitle).toBe("Open Source Compliance Manager");
    });
  });

  it("selects the role pack's own default title for security-manager", () => {
    withEnv({ TS_API_KEY: "k", TS_ROLE: "security-manager" }, () => {
      const config = loadConfig();
      expect(config.role).toBe("security-manager");
      expect(config.roleTitle).toBe("Security Manager");
    });
  });

  it("selects the role pack's own default title for component-manager", () => {
    withEnv({ TS_API_KEY: "k", TS_ROLE: "component-manager" }, () => {
      const config = loadConfig();
      expect(config.role).toBe("component-manager");
      expect(config.roleTitle).toBe("Component Manager");
    });
  });

  it("TS_ROLE_TITLE overrides the role pack's default for any role", () => {
    withEnv(
      { TS_API_KEY: "k", TS_ROLE: "security-manager", TS_ROLE_TITLE: "Custom Title" },
      () => {
        const config = loadConfig();
        expect(config.roleTitle).toBe("Custom Title");
      },
    );
  });

  it("fails fast on an unknown TS_ROLE", () => {
    // process.exit(1) is mocked to a no-op (it can't actually terminate a
    // test process) — loadConfig() then keeps running past its intended
    // exit point and throws later trying to look up the (nonexistent) role
    // pack. That's fine here: exitSpy/errorSpy are what prove the fail-fast
    // check itself fired correctly.
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    withEnv({ TS_API_KEY: "k", TS_ROLE: "bogus-role" }, () => {
      expect(() => loadConfig()).toThrow();
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('TS_ROLE must be one of: compliance-manager, security-manager, component-manager. Got: "bogus-role"'),
    );
  });
});
