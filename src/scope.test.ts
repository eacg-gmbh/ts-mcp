import { describe, expect, it } from "vitest";
import type { ActionParam, ToolAction } from "./generated-tools.js";
import { enforceProjectScope, filterProjectList, isReleaseKeyAction } from "./scope.js";

function param(overrides: Partial<ActionParam> & Pick<ActionParam, "name">): ActionParam {
  return { in: "query", description: "", required: false, type: "string", ...overrides };
}

function action(overrides: Partial<ToolAction> & Pick<ToolAction, "name">): ToolAction {
  return {
    method: "GET",
    path: "/x",
    summary: "",
    description: "",
    minAccessMode: "read",
    hasBody: false,
    params: [],
    ...overrides,
  };
}

const PROJECT_ACTION = action({
  name: "list_modules",
  params: [param({ name: "projectId" })],
});

const RELEASE_ACTION = action({
  name: "list_sbom",
  params: [param({ name: "release_key", in: "path", required: true })],
});

const CSAF_ACTION = action({
  name: "list_documents",
  params: [param({ name: "csaf_key", in: "path", required: true })],
});

const UNRELATED_ACTION = action({
  name: "create_license",
  params: [],
});

describe("isReleaseKeyAction", () => {
  it("is true for a release_key-addressed action", () => {
    expect(isReleaseKeyAction(RELEASE_ACTION)).toBe(true);
  });

  it("is true for a csaf_key-addressed action", () => {
    expect(isReleaseKeyAction(CSAF_ACTION)).toBe(true);
  });

  it("is false for a project-addressed or parameterless action", () => {
    expect(isReleaseKeyAction(PROJECT_ACTION)).toBe(false);
    expect(isReleaseKeyAction(UNRELATED_ACTION)).toBe(false);
  });
});

describe("enforceProjectScope — no mandate configured", () => {
  it("is a no-op for every action shape when scope is empty", () => {
    for (const a of [PROJECT_ACTION, RELEASE_ACTION, CSAF_ACTION, UNRELATED_ACTION]) {
      expect(enforceProjectScope("tool", a, {}, [])).toBeNull();
    }
  });
});

describe("enforceProjectScope — account-wide actions", () => {
  it("withholds an account-wide action once a scope is configured", () => {
    const dashboardAction = action({ name: "list_dashboard" });
    const error = enforceProjectScope("reports", dashboardAction, {}, ["proj-1"]);
    expect(error).toContain("withheld");
  });
});

describe("enforceProjectScope — real project_id/projectId parameter", () => {
  it("auto-injects the single scoped project when the caller omits it", () => {
    const args: Record<string, unknown> = {};
    const error = enforceProjectScope("modules", PROJECT_ACTION, args, ["proj-1"]);
    expect(error).toBeNull();
    expect(args.projectId).toBe("proj-1");
  });

  it("requires an explicit project when the mandate covers more than one, and none was given", () => {
    const args: Record<string, unknown> = {};
    const error = enforceProjectScope("modules", PROJECT_ACTION, args, ["proj-1", "proj-2"]);
    expect(error).toContain("requires a project ID");
    expect(args.projectId).toBeUndefined();
  });

  it("rejects an explicit project outside the mandate", () => {
    const args = { projectId: "proj-99" };
    const error = enforceProjectScope("modules", PROJECT_ACTION, args, ["proj-1"]);
    expect(error).toContain("outside this server's mandate");
  });

  it("accepts an explicit project inside the mandate", () => {
    const args = { projectId: "proj-1" };
    const error = enforceProjectScope("modules", PROJECT_ACTION, args, ["proj-1", "proj-2"]);
    expect(error).toBeNull();
    expect(args.projectId).toBe("proj-1");
  });
});

describe("enforceProjectScope — release/CSAF-key actions (E3)", () => {
  it("auto-injects the single scoped project into the synthetic projectId argument", () => {
    const args: Record<string, unknown> = { release_key: "rel-abc" };
    const error = enforceProjectScope("releases", RELEASE_ACTION, args, ["proj-1"]);
    expect(error).toBeNull();
    expect(args.projectId).toBe("proj-1");
    // The real API parameter is untouched — only the synthetic one was set.
    expect(args.release_key).toBe("rel-abc");
  });

  it("requires an explicit projectId when the mandate covers more than one project", () => {
    const args: Record<string, unknown> = { release_key: "rel-abc" };
    const error = enforceProjectScope("releases", RELEASE_ACTION, args, ["proj-1", "proj-2"]);
    expect(error).toContain("requires a project ID");
  });

  it("rejects a caller-supplied projectId outside the mandate", () => {
    const args = { release_key: "rel-abc", projectId: "proj-99" };
    const error = enforceProjectScope("releases", RELEASE_ACTION, args, ["proj-1"]);
    expect(error).toContain("outside this server's mandate");
  });

  it("accepts a caller-supplied projectId inside the mandate", () => {
    const args = { release_key: "rel-abc", projectId: "proj-2" };
    const error = enforceProjectScope("releases", RELEASE_ACTION, args, ["proj-1", "proj-2"]);
    expect(error).toBeNull();
  });

  it("applies the same treatment to a csaf_key-addressed action", () => {
    const args: Record<string, unknown> = { csaf_key: "feed-abc" };
    const error = enforceProjectScope("releases", CSAF_ACTION, args, ["proj-1"]);
    expect(error).toBeNull();
    expect(args.projectId).toBe("proj-1");
  });
});

describe("enforceProjectScope — no addressable parameter at all", () => {
  it("is a no-op when the action has neither a project param nor a release/CSAF key", () => {
    const error = enforceProjectScope("compliance-check", UNRELATED_ACTION, {}, ["proj-1"]);
    expect(error).toBeNull();
  });
});

describe("filterProjectList", () => {
  it("returns the body unchanged when scope is empty", () => {
    const body = [{ _id: "proj-1" }, { _id: "proj-2" }];
    expect(filterProjectList(body, [])).toBe(body);
  });

  it("returns non-array bodies unchanged", () => {
    const body = { error: "not a list" };
    expect(filterProjectList(body, ["proj-1"])).toBe(body);
  });

  it("keeps only entries whose _id is in scope", () => {
    const body = [{ _id: "proj-1" }, { _id: "proj-2" }, { _id: "proj-3" }];
    expect(filterProjectList(body, ["proj-1", "proj-3"])).toEqual([
      { _id: "proj-1" },
      { _id: "proj-3" },
    ]);
  });
});
