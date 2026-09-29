/**
 * The `ledger` prompt argument (E2/ts-agent-svc §5.2, §9.1): the calling
 * runtime's own view of this agent's standing work — open objectives, open
 * todos, what it's waiting on, and a one-line summary of what changed since
 * the last activation. Passed as a JSON string (MCP prompt arguments are
 * plain strings on the wire) because ts-mcp has no other channel to the
 * runtime's ledger — it never reads or writes it directly.
 *
 * This shape is ts-mcp's own contract for the argument, not a copy of any
 * particular caller's internal schema — a caller (e.g. ts-agent-svc's
 * mandate-mcp `mandate://summary` resource) is responsible for projecting
 * its own ledger state into this shape before calling `prompts/get`.
 */
export interface LedgerSnapshot {
  objectives?: Array<{
    id: string;
    kind: string;
    status: string;
    releaseId?: string;
  }>;
  todos?: Array<{
    id: string;
    title: string;
    status: string;
    owner?: string;
    dueDate?: string;
  }>;
  waitingFor?: Array<{
    description: string;
    owner?: string;
  }>;
  lastActivationSummary?: string;
}

/**
 * Renders the `ledger` argument as a markdown section, or "" when absent —
 * every playbook interpolates this unconditionally, so a missing/empty
 * argument must produce no visible section rather than an empty heading.
 * Malformed JSON is reported rather than thrown: a bad argument from the
 * caller shouldn't take down an otherwise-valid playbook invocation.
 */
export function renderLedgerSnapshot(ledgerJson: string | undefined): string {
  if (!ledgerJson || ledgerJson.trim().length === 0) return "";

  let snapshot: LedgerSnapshot;
  try {
    snapshot = JSON.parse(ledgerJson) as LedgerSnapshot;
  } catch {
    return `\n## Ledger snapshot\n\nThe \`ledger\` argument was not valid JSON — proceed without it, but say so in your deliverable rather than silently ignoring it.\n`;
  }

  const lines: string[] = [];
  if (snapshot.lastActivationSummary) {
    lines.push(`**Since your last activation:** ${snapshot.lastActivationSummary}`);
  }
  if (snapshot.objectives?.length) {
    lines.push("", "**Open objectives:**");
    for (const o of snapshot.objectives) {
      lines.push(
        `- \`${o.id}\` (${o.kind}) — ${o.status}${o.releaseId ? ` [release \`${o.releaseId}\`]` : ""}`,
      );
    }
  }
  if (snapshot.todos?.length) {
    lines.push("", "**Open todos:**");
    for (const t of snapshot.todos) {
      lines.push(
        `- \`${t.id}\` ${t.title} — ${t.status}${t.owner ? `, owner ${t.owner}` : ""}${t.dueDate ? `, due ${t.dueDate}` : ""}`,
      );
    }
  }
  if (snapshot.waitingFor?.length) {
    lines.push("", "**Waiting for:**");
    for (const w of snapshot.waitingFor) {
      lines.push(`- ${w.description}${w.owner ? ` (from ${w.owner})` : ""}`);
    }
  }

  if (lines.length === 0) return "";
  return `\n## Ledger snapshot\n\n${lines.join("\n")}\n`;
}

/**
 * The closing instruction every trigger-context playbook ends with, so the
 * runtime's `ledger_update` tool always gets a clearly structured input
 * instead of having to parse it out of free-form prose.
 */
export const LEDGER_UPDATES_SECTION = `## Ledger updates

Close with this section so the runtime's \`ledger_update\` tool has a clear,
structured input — never leave the ledger stale by omission:

- **Objectives** — each objective this run touched: its id, the new status
  (\`open\` / \`done\` / \`dropped\` / \`waived\`), and the evidence for the change.
- **Todos** — each todo to open or close: title, owner, due date (from the
  policy SLA or release schedule), and — for a closed todo — the evidence it
  is actually done.

An empty section is a valid, honest answer when nothing on the ledger changed
this run — never omit the section to imply that.`;
