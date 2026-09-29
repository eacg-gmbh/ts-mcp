import { describe, expect, it } from "vitest";
import { LEDGER_UPDATES_SECTION, renderLedgerSnapshot } from "./ledger.js";

describe("renderLedgerSnapshot", () => {
  it("renders nothing for an undefined argument", () => {
    expect(renderLedgerSnapshot(undefined)).toBe("");
  });

  it("renders nothing for an empty or whitespace-only string", () => {
    expect(renderLedgerSnapshot("")).toBe("");
    expect(renderLedgerSnapshot("   ")).toBe("");
  });

  it("reports malformed JSON instead of throwing", () => {
    const rendered = renderLedgerSnapshot("{not json");
    expect(rendered).toContain("not valid JSON");
    expect(rendered).toContain("## Ledger snapshot");
  });

  it("renders nothing for valid JSON with no recognised fields", () => {
    expect(renderLedgerSnapshot("{}")).toBe("");
    expect(renderLedgerSnapshot("[]")).toBe("");
  });

  it("renders the last-activation summary alone", () => {
    const rendered = renderLedgerSnapshot(
      JSON.stringify({ lastActivationSummary: "Closed 3 approvals." }),
    );
    expect(rendered).toContain("## Ledger snapshot");
    expect(rendered).toContain("Closed 3 approvals.");
  });

  it("renders objectives, todos and waiting-for items with their optional fields", () => {
    const snapshot = {
      objectives: [
        { id: "obj-1", kind: "release", status: "open", releaseId: "rel-9" },
        { id: "obj-2", kind: "compliance", status: "done" },
      ],
      todos: [
        { id: "todo-1", title: "Notify legal", status: "open", owner: "jan", dueDate: "2026-10-05" },
        { id: "todo-2", title: "Close CVE triage", status: "open" },
      ],
      waitingFor: [
        { description: "Legal sign-off on approval-42", owner: "legal team" },
        { description: "Deep scan result" },
      ],
    };
    const rendered = renderLedgerSnapshot(JSON.stringify(snapshot));

    expect(rendered).toContain("**Open objectives:**");
    expect(rendered).toContain("`obj-1` (release) — open [release `rel-9`]");
    expect(rendered).toContain("`obj-2` (compliance) — done");
    expect(rendered).not.toContain("`obj-2` (compliance) — done [release");

    expect(rendered).toContain("**Open todos:**");
    expect(rendered).toContain("`todo-1` Notify legal — open, owner jan, due 2026-10-05");
    expect(rendered).toContain("`todo-2` Close CVE triage — open");

    expect(rendered).toContain("**Waiting for:**");
    expect(rendered).toContain("Legal sign-off on approval-42 (from legal team)");
    expect(rendered).toContain("Deep scan result");
  });
});

describe("LEDGER_UPDATES_SECTION", () => {
  it("names both ledger fields the runtime's ledger_update tool expects", () => {
    expect(LEDGER_UPDATES_SECTION).toContain("Objectives");
    expect(LEDGER_UPDATES_SECTION).toContain("Todos");
    expect(LEDGER_UPDATES_SECTION).toContain("ledger_update");
  });
});
