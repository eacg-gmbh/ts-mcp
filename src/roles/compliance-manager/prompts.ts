import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { LEDGER_UPDATES_SECTION, renderLedgerSnapshot } from "./ledger.js";

/**
 * Compliance playbooks exposed as MCP prompts.
 *
 * The tools give an agent hands; these give it an assignment. The role is
 * primarily an *organising* one: legal compliance rarely fails for lack of
 * analysis, it fails because obligations stay unresolved, notice files stay
 * incomplete and decisions stay unmade. The playbooks are therefore built around
 * closing items, not around producing findings.
 */

function preamble(config: ServerConfig): string {
  return `Before you begin, read the resources \`trustsource://role/${config.role}\`
(your mandate and limits) and \`trustsource://policy/foss\` (the governing policy).
Decide strictly against that policy, not against general best practice.`;
}

/**
 * Both sources disagree in practice — the licence report aggregates differently
 * from the parts list — so every legal playbook reconciles them explicitly.
 */
const RECONCILE = `**Reconcile your sources.** The licence report
(\`reports\` → \`list_licenses\`) and the parts list (\`projects\` → \`list_partsList\`)
count differently: the report aggregates by licence, the parts list is per
component and version. Where they disagree about how many components lack licence
information, the parts list is the addressable truth — you can only act on named
components. State the discrepancy rather than picking the more dramatic number.`;

function projectLine(project: string | undefined, config: ServerConfig): string {
  if (project && project.length > 0) {
    return `Act on TrustSource project \`${project}\`.`;
  }
  if (config.projectScope.length === 1) {
    return `Act on TrustSource project \`${config.projectScope[0]}\` (the single project in your mandate).`;
  }
  if (config.projectScope.length > 1) {
    return `No project was given. Your mandate covers ${config.projectScope
      .map((id) => `\`${id}\``)
      .join(", ")} — ask which one before proceeding.`;
  }
  return `No project was given. Call \`projects\` with action \`list_projects\`, show the candidates and ask which project to act on before doing anything else.`;
}

function text(content: string) {
  return {
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text: content },
      },
    ],
  };
}

/**
 * Shared trigger-context arguments (E2, ts-agent-svc §5.2/§9.1): the runtime
 * dispatches an activation into a playbook carrying the triggering event's
 * own fields plus a ledger snapshot. Every trigger-context playbook accepts
 * the full set uniformly — a playbook that doesn't use a given field (e.g.
 * `follow-up` never reads `cveIds`) simply ignores it — so the runtime never
 * has to know which subset a particular playbook cares about.
 */
const TRIGGER_CONTEXT_ARGS = {
  projectId: z.string().optional().describe("TrustSource project ID"),
  releaseId: z
    .string()
    .optional()
    .describe("Release ID, when this run is release-scoped"),
  moduleId: z.string().optional().describe("Module ID from the triggering event"),
  analysisId: z
    .string()
    .optional()
    .describe("Analysis/scan ID from the triggering event"),
  cveIds: z
    .string()
    .optional()
    .describe("Comma-separated CVE IDs from the triggering event"),
  approvalId: z
    .string()
    .optional()
    .describe("Approval ID from the triggering event"),
  taskId: z.string().optional().describe("Task ID from the triggering event"),
  ledger: z
    .string()
    .optional()
    .describe(
      "JSON ledger snapshot from the runtime: open objectives, todos, waiting-for, last activation summary",
    ),
};

export function registerPlaybooks(server: McpServer, config: ServerConfig): void {
  const canWrite = config.accessMode !== "read";

  const writeNote = canWrite
    ? `You may record findings in TrustSource (\`risks\` → \`create_risks\`, \`create_tasks\`) and open approval requests (\`approvals\` → \`create_approvals\`). Never approve or reject anything yourself.`
    : `This server runs read-only. Do not attempt any write action — instead, output the exact payload you would have written, so a human can apply it.`;

  const draftingRule = `You draft outgoing messages; you never send them. Present
each message in full — recipient, subject, body — and hand it over. In a hosted
deployment a configured channel sends them after a human has released them.`;

  // =========================================================================
  // 1 — Trigger playbook: a new scan has been analysed
  // =========================================================================
  server.registerPrompt(
    "new-analysis",
    {
      title: "New analysis arrived — what now",
      description:
        "Entry point after a scan upload has been analysed: what changed, what legal work " +
        "it creates, and what to do first. Start here when a scan-uploaded event fires.",
      argsSchema: { ...TRIGGER_CONTEXT_ARGS },
    },
    ({ projectId, analysisId, ledger }) =>
      text(`${preamble(config)}

${projectLine(projectId, config)}
${renderLedgerSnapshot(ledger)}
A new scan has been analysed${analysisId ? ` (scan \`${analysisId}\`)` : ""}. Work out what
it changed and what it now requires of you. This is a working session, not a report:
finish it with things closed or moving, not with a list.

## Establish what changed

1. \`scans\` → \`get_scans\` for the scan${analysisId ? ` \`${analysisId}\`` : ""} — what was
   scanned, which module, when.
2. \`reports\` → \`list_licenses\` and \`projects\` → \`list_partsList\` — the current
   legal picture. ${RECONCILE}
3. \`risks\` → \`list_risks\` — what was already decided. **Anything with an existing
   decision is not new**, however loudly a report presents it.
4. \`reports\` → \`list_vulnerabilities\` — the security picture, secondary to the legal one.

Compare against the previously decided state. New components, new licences and newly
unresolved components are your work. Everything else is noise you have already handled.

## Sort the new work — in this order

1. **Components without licence information** — these block clearance and take the
   longest to resolve because they depend on other people. Start them first, even
   though they look smaller than a CVE. Continue with the \`resolve-components\` playbook.
2. **New licences entering the project** — check each against the policy's allowed,
   requires-approval and forbidden lists. A newly introduced forbidden or
   approval-required licence needs a decision opened today, not at release time.
3. **New obligations** — a licence family that was not present before may add
   obligations the notice file does not yet satisfy.
4. **New vulnerabilities** — triage by exposure class; most will not be urgent.

## Deliverable

1. **What changed** — three lines at most: components added/removed, licences added, findings added.
2. **What this creates for me** — the concrete items, each with the next action and who has to act.
3. **What I am starting now** — and which playbook continues it.
4. **What needs someone else** — named person or role, what you need from them, by when.

${writeNote}

${LEDGER_UPDATES_SECTION}`),
  );

  // =========================================================================
  // 2 — Resolve components with missing information
  // =========================================================================
  server.registerPrompt(
    "resolve-components",
    {
      title: "Resolve components with missing licence information",
      description:
        "Close the gaps: classify each component with missing data, find its repository, " +
        "run a deep scan where that is the right instrument, and escalate genuine violations " +
        "with a complete dossier.",
      argsSchema: {
        project: z.string().optional().describe("TrustSource project ID"),
        component: z
          .string()
          .optional()
          .describe("Resolve only this component (name or key)"),
      },
    },
    ({ project, component }) =>
      text(`${preamble(config)}

${projectLine(project, config)}

${component ? `Resolve the component \`${component}\`.` : "Resolve every component in this project whose licence information is missing or unusable."}

A component whose licence is unknown cannot be cleared for release. Your job is to
make it known — and where it cannot be made known, to get a decision made about it.

## Step 1 — Build the real list

${RECONCILE}

From the parts list, take every component where the licence entry is absent, empty,
or not resolvable to a licence. Name them. Work from that list, not from a count.

## Step 2 — Classify before acting

A component flagged \`private\` is **not automatically internal**. Public packages are
regularly misclassified, and treating one as internal wastes a deep scan and leaves
the metadata wrong. For each component decide which branch applies, using the policy's
\`component_resolution\` rules:

- **Misclassified public package** — the name matches a public registry package or a
  known project namespace (\`@jest/\`, \`@types/\`, \`@angular/\` and similar). The licence
  is public information. Resolve it from the registry and **correct the metadata**;
  do not deep-scan. Say explicitly that this was a classification error, because the
  same error will recur on the next scan if nobody fixes the source.
- **Genuinely internal component** — developed in-house. Find the source repository
  and deep-scan it.
- **Third party without metadata** — external, publishes nothing. Deep-scan the
  upstream repository. If no licence can be established, it is "all rights reserved",
  **not** permissive. Escalate it.

State your classification and the evidence for it. If you cannot classify a component,
that itself is the question to put to a human — ask it precisely.

## Step 3 — Find the repository

Try, in order: the component's \`homepageUrl\` from the parts list; the public registry
entry for its name; the project's own source-control conventions for internal
components. Expect \`homepageUrl\` to be empty exactly for the components that need it
most — internal components often carry no metadata at all. When the repository cannot
be determined, do not guess a URL: ask the engineering lead named in the policy
contacts, with the component name and where it appears in the dependency tree.

## Step 4 — Deep scan

For components in the internal or third-party branch:
\`deepscan\` → \`create_scan\` with \`{ "url": "<repository URL>", "type": "repository",
"includeCopyright": true }\`. Copyright analysis matters here — the notice file needs
the copyright holders, not just the licence.

Then poll \`deepscan\` → \`list_status\` with the returned \`uid\` until it completes,
and fetch \`deepscan\` → \`list_results\` for the results URL.

Two limits to respect: only scan repositories the organisation owns or is authorised
to analyse (the policy states this), and do not wait indefinitely — if the scan has
not completed within the policy's \`max_wait_minutes\`, record it as in progress and
move on rather than stalling the whole run.

## Step 5 — Assess and route

For each resolved licence, check it against the policy's allowed, requires-approval
and forbidden lists:

- **Allowed** → record the licence, note any obligations it adds, done.
- **Requires approval** → prepare the decision and continue with the \`legal-decisions\` playbook.
- **Forbidden / violation** → this needs a real compliance manager. Before you contact
  them, **complete the dossier**: which component, which version, which licence, where
  it sits in the dependency tree, whether it is distributed, what the licence would
  require, what the options are (replace, isolate, seek exemption, obtain a commercial
  licence) and what each option costs. A violation reported without this dossier just
  sends the work back to you.

## Deliverable

A table — component · classification · evidence · licence found · source (registry /
deep scan / unresolved) · routing — followed by the completed dossier for anything
routed to a human.

Close with the components you could not resolve and the single specific question that
would unblock each one.

${writeNote}`),
  );

  // =========================================================================
  // 3 — Notice file
  // =========================================================================
  server.registerPrompt(
    "notice-file",
    {
      title: "Complete the notice file",
      description:
        "Establish which obligations apply, what the notice file must contain, what is " +
        "missing from it, and who has to supply the missing pieces.",
      argsSchema: {
        project: z.string().optional().describe("TrustSource project ID"),
        release_key: z
          .string()
          .optional()
          .describe("Release key, to check the notice file actually published"),
      },
    },
    ({ project, release_key }) =>
      text(`${preamble(config)}

${projectLine(project, config)}

Bring the notice file to a state where it satisfies the project's obligations.

## Evidence

1. \`reports\` → \`list_licenses\` — licences in use and the obligations they trigger.
2. \`projects\` → \`list_partsList\` — the components behind them, with versions. ${RECONCILE}
3. \`projects\` → \`get_projects\` — how the software is distributed. Obligations differ
   sharply between SaaS and distributed software; if the project does not record it,
   use the policy default and say that you did.
${release_key ? `4. \`releases\` → \`list_notice\` with release key \`${release_key}\` — the notice file actually published.` : `4. \`releases\` → \`list_notice\` — if a release key is available, compare against the notice file actually published.`}
5. \`approvals\` → \`get_approvals\` for any approval whose \`noticeFile\` is already attached.

## How to assess

- **Group by obligation, not by component.** "Retain the copyright notice" and
  "provide the licence text" across hundreds of MIT, Apache and ISC components are two
  obligations, satisfied by one correctly generated file. Report the obligations; use
  the component count only as evidence.
- **Separate the obligations that need engineering work** — indicating modifications
  (Apache-2.0), providing a written source offer (LGPL, MPL) — from those satisfied by
  document generation. These are the ones that get missed, because generating a file
  feels like completion.
- **Every component with an unresolved licence is a hole in the notice file.** You
  cannot state a copyright notice you do not have. List these as blockers and point at
  the \`resolve-components\` playbook.
- **Check the copyright notices, not just the licences.** A notice file listing
  licences without the corresponding copyright holders satisfies almost none of the
  obligations it appears to satisfy. Where holders are missing, a deep scan with
  copyright analysis is the instrument that supplies them.
- **Verify, do not assume.** If a notice file exists, compare its contents against the
  obligation register. If you cannot retrieve it, say the verdict is unverified —
  never infer that it is fine because one was generated.

## Deliverable

1. **Obligation register** — each distinct obligation: what it requires, which licences
   and how many components trigger it, satisfied or not, and the evidence.
2. **Gaps** — what is missing from the notice file, per obligation, with the specific
   component or copyright holder that is absent.
3. **Who supplies what** — each gap assigned to a role from the policy contacts, with
   a due date derived from the release schedule or the policy SLA.
4. **Verdict** — sufficient / insufficient / not verifiable, with the reason.

${writeNote}`),
  );

  // =========================================================================
  // 4 — Legal decisions and approvals
  // =========================================================================
  server.registerPrompt(
    "legal-decisions",
    {
      title: "Bring legal decisions to a conclusion",
      description:
        "Prepare the open legal questions as decision-ready dossiers, open approval " +
        "requests for them, and track the ones already running.",
      argsSchema: { ...TRIGGER_CONTEXT_ARGS },
    },
    ({ projectId, approvalId, ledger }) =>
      text(`${preamble(config)}

${projectLine(projectId, config)}
${renderLedgerSnapshot(ledger)}
${approvalId ? `Work on approval request \`${approvalId}\`.` : "Bring the project's open legal questions to a decision."}

Your measure of success is decisions made, not questions raised. A question that has
been open for three weeks is your failure, not the decision-maker's.

## Find the open questions

1. \`reports\` → \`list_licenses\` and \`projects\` → \`list_partsList\` — licences under
   the policy's requires-approval or forbidden lists. ${RECONCILE}
2. \`compliance-check\` → \`create_license\` — where licence compatibility is genuinely
   in question, check it rather than asserting it.
3. \`risks\` → \`list_risks\` and \`list_tasks\` — decisions already pending, and their owners.
4. \`approvals\` → \`get_approvals\` for each approval you know of, to read its current
   state, who initiated it, and whether a notice file is attached.

Note on tracking: retrieving approvals by ID is what the API offers today; there is no
filtered queue. Maintain the queue yourself — in the risk register, where it survives
the conversation — rather than relying on being handed the list.

## Prepare each decision

An approval request is only worth a decision-maker's time if it arrives complete. The
policy lists what the dossier must contain; assemble all of it before opening anything:

- the affected components with versions and dependency paths
- the licence in question and the obligation it triggers
- how the component is used, and whether it is distributed
- **the options, each with its consequence** — replace, isolate, seek an exemption,
  obtain a commercial licence, accept the obligation
- your recommendation, stated plainly

Write for someone who has thirty seconds and legal authority, not for someone who
wants to learn about the licence. If you cannot recommend an option, say which fact
is missing and who has it.

## Open the request

${
  canWrite
    ? `\`approvals\` → \`create_approvals\` with the scan ID and a name that identifies the
decision (not "compliance check" — "MPL-2.0 in shipped client library"). Show the user
the complete request before you create it, and report the returned ID afterwards.`
    : `This server runs read-only. Produce the exact \`create_approvals\` payload instead,
ready for a human to submit.`
}

Record the approval in the risk register with its ID, the decision-maker and the date
it was opened, so it can be followed up.

## Track what is running

For each open approval: how long it has been open, who owes the decision, and what
happens to the release date if it does not arrive. Anything past the policy's
\`escalate_after_days\` goes to the escalation contact — with the same dossier, not a
reminder that a thing exists.

Never approve or reject anything yourself. Your authority ends at a complete,
well-argued recommendation.

${writeNote}

${LEDGER_UPDATES_SECTION}`),
  );

  // =========================================================================
  // 5 — Follow up
  // =========================================================================
  server.registerPrompt(
    "follow-up",
    {
      title: "Chase open items",
      description:
        "Work out who owes what and by when, and draft the reminders — calibrated to how " +
        "overdue each item is and to who has to act.",
      argsSchema: {
        ...TRIGGER_CONTEXT_ARGS,
        as_of: z
          .string()
          .optional()
          .describe("Date to measure against (YYYY-MM-DD), defaults to today"),
      },
    },
    ({ projectId, ledger, as_of }) =>
      text(`${preamble(config)}

${projectLine(projectId, config)}
${renderLedgerSnapshot(ledger)}
Work out what is outstanding${as_of ? ` as of ${as_of}` : ""}, who owes it, and draft the
follow-ups.

## Establish the outstanding items

1. \`risks\` → \`list_risks\`, then \`list_tasks\` per risk — the open tasks, their owners
   and due dates.
2. \`approvals\` → \`get_approvals\` for the approvals you are tracking — what is still
   undecided.
3. \`company\` → \`list_foss\` and the policy's \`contacts\` section — who to address.

For each item: what was asked, of whom, when, what has happened since, and how many
days it is past due. An item with no owner is not an outstanding item — it is an
unassigned one, and assigning it is your job, not the recipient's.

## Calibrate the reminder

Use the policy's \`reminder_schedule_days\`, and let the tone follow the delay:

- **First reminder** — assume it was missed, not refused. Restate what you need and
  why it is on the critical path. One short paragraph.
- **Second reminder** — name the consequence with a date: which release, which
  obligation, what happens if the date passes. Copy nobody new.
- **Escalation** — address the escalation contact from the policy, include the full
  history (what was asked, when, what response), and make the ask specific: a decision,
  a reassignment, or an accepted delay. Escalating without a requested outcome is just
  complaining upward.

Make every reminder answerable in one step. "Please review the compliance findings"
is not answerable; "Can we replace X with Y, or do you want to seek an exemption?" is.

## Deliverable

1. **Outstanding items** — item · owner · asked on · days overdue · consequence.
2. **Drafted messages** — one per recipient, not one per item. Somebody who owes three
   things gets one message listing three things.
3. **Escalations** — what you propose to escalate, to whom, and why now.
4. **Unassigned** — items with no owner, each with your proposed owner.

${draftingRule}

${writeNote}

${LEDGER_UPDATES_SECTION}`),
  );

  // =========================================================================
  // 6 — Overall status
  // =========================================================================
  server.registerPrompt(
    "compliance-status",
    {
      title: "Compliance status review",
      description:
        "Full assessment of a project — legal position first, then security — condensed " +
        "into blockers, actions with deadlines, and what could not be assessed.",
      argsSchema: {
        ...TRIGGER_CONTEXT_ARGS,
        since: z
          .string()
          .optional()
          .describe("Only highlight what changed since this date (YYYY-MM-DD)"),
      },
    },
    ({ projectId, ledger, since }) =>
      text(`${preamble(config)}

${projectLine(projectId, config)}
${renderLedgerSnapshot(ledger)}
Produce the compliance status review for this project. Lead with the legal position —
that is where clearance is won or lost — and treat security as the second section.

## Evidence to gather

1. \`projects\` → \`get_projects\` — settings, and how the software is distributed.
2. \`reports\` → \`list_licenses\` — licences, obligations, unresolved licences.
3. \`projects\` → \`list_partsList\` — the components behind those numbers. ${RECONCILE}
4. \`risks\` → \`list_risks\` and \`list_tasks\` — what has already been decided, and what
   is outstanding. A finding with an existing decision is a status update, not a new problem.
5. \`reports\` → \`list_vulnerabilities\` — CVEs with their dependency paths.
6. \`reports\` → \`list_endoflife\`, \`list_versioning\`, \`list_viability\` — maintenance risk.
${since ? `7. Changes since ${since} get their own section at the top: what is new, what was resolved, what moved.` : ""}

## How to assess

- **Collapse noise into decisions.** Hundreds of component warnings usually represent a
  handful of distinct obligations. Report the obligations, with the component count as
  evidence — never the raw warning count as if it were a to-do list.
- **Unresolved components are the sharpest item.** They block clearance and they take
  the longest to fix, because they depend on other people.
- **Classify each vulnerability by exposure before severity.** Read the dependency
  path: paths running exclusively through test, build or tooling packages are
  \`build_or_test_only\` under the policy. Paths reaching application code are
  \`shipped_runtime\` until proven otherwise. State which class you assigned and why.
- **Separate the two clocks.** Legal obligations follow the release calendar;
  vulnerabilities follow the SLA clock. Do not merge them into one score.

## Deliverable

1. **Verdict** — one sentence: can this project ship as it stands, and if not, why not.
2. **Legal position** — obligations satisfied and unsatisfied, unresolved components,
   licences needing a decision, notice-file state.
3. **Security position** — findings by exposure class, with SLA dates.
4. **Blockers** — what stops a release, what closing it requires, residual risk if not closed.
5. **Action required** — with owner-role and absolute due date.
6. **Not assessable** — what you could not determine, and what evidence would settle it.

Use absolute dates, never "in two weeks". ${writeNote}

${LEDGER_UPDATES_SECTION}`),
  );

  // =========================================================================
  // 7 — Vulnerability triage
  // =========================================================================
  server.registerPrompt(
    "triage-vulnerabilities",
    {
      title: "Vulnerability triage",
      description:
        "Triage every CVE by exposure and reachability, assign policy SLAs, and draft the " +
        "VEX statement for findings that do not apply.",
      argsSchema: {
        ...TRIGGER_CONTEXT_ARGS,
        cve: z.string().optional().describe("Triage only this CVE (e.g. CVE-2026-26996)"),
      },
    },
    ({ projectId, cveIds, ledger, cve }) =>
      text(`${preamble(config)}

${projectLine(projectId, config)}
${renderLedgerSnapshot(ledger)}
${
  cve
    ? `Triage **${cve}** only.`
    : cveIds
      ? `Triage the CVEs from the triggering event: ${cveIds
          .split(",")
          .map((id) => `**${id.trim()}**`)
          .join(", ")}.`
      : "Triage every open vulnerability in this project."
}

## Evidence

1. \`reports\` → \`list_vulnerabilities\` — findings with their dependency paths.
2. Per CVE: \`vulnerabilities\` → \`create_cveDetails\` — the weakness, the affected code
   path, and whether a fixed version exists.
3. \`projects\` → \`list_partsList\` or \`list_sbom\` — how the component enters the build.
4. \`psirt\` → \`list_csaf\` — an existing upstream VEX statement outranks your own inference.
5. \`risks\` → \`list_risks\` — do not re-triage what is already decided.

## Decision procedure — per CVE

**Step 1 — Exposure class.** Read every dependency path:
- Only through test runners, coverage tools, linters or build helpers → \`build_or_test_only\`.
- Reaching application code → \`shipped_runtime\`.
- Mixed → \`shipped_runtime\`; a component that ships anywhere ships.
- Cannot tell → \`shipped_runtime\`, flagged as undetermined. Never downgrade on a guess.

**Step 2 — Reachability.** For shipped components, establish whether the vulnerable
function is actually called. "Reachability undetermined" is a valid, honest result and
keeps the finding in \`shipped_runtime\`.

**Step 3 — SLA.** Apply the policy SLA for the assigned class and severity. State the
due date as an absolute date.

**Step 4 — Remedy.** The fixed version if one exists; the upgrade path if the fix is
transitive (name the direct dependency that has to move); the mitigation if no fix exists.

**Step 5 — VEX statement.** For anything not \`affected\`, draft the statement using only
the policy's VEX vocabulary: status, justification, and one sentence of evidence naming
the dependency path. A justification without evidence is not a justification.

Produce the statement as a complete, fileable CSAF/VEX entry — product reference,
vulnerability ID, status, justification, impact statement — not as prose. TrustSource's
API currently exposes VEX documents for reading only, so hand the drafted document over
for a human to file, and say that this is why.

## Deliverable

A table — CVE · component@version · CVSS · exposure class · reachability · SLA due date ·
remedy — sorted by urgency under the policy, not by CVSS. Below it, one short paragraph
per finding needing a human decision, each ending with a clear recommendation. Then the
drafted VEX statements.

Close with a note on build integrity: vulnerabilities downgraded as build-time remain
relevant to supply-chain integrity even though they do not block the release.

${writeNote}

${LEDGER_UPDATES_SECTION}`),
  );

  // =========================================================================
  // 8 — Release gate
  // =========================================================================
  server.registerPrompt(
    "release-readiness",
    {
      title: "Release readiness gate",
      description:
        "Go / no-go decision proposal: what blocks the release, what ships with accepted " +
        "residual risk, and what must be documented first.",
      argsSchema: { ...TRIGGER_CONTEXT_ARGS },
    },
    ({ projectId, releaseId, ledger }) =>
      text(`${preamble(config)}

${projectLine(projectId, config)}
${renderLedgerSnapshot(ledger)}
Assess release readiness${releaseId ? ` for release **${releaseId}**` : ""} and produce a
go / no-go recommendation. You are preparing a decision, not making it — your job is to
make a human's signature well-informed and quick.

## Evidence

\`reports\` → \`list_licenses\`, \`list_vulnerabilities\`, \`list_endoflife\`, plus:
- \`projects\` → \`list_partsList\` — unresolved components. ${RECONCILE}
- \`risks\` → \`list_risks\` and \`list_tasks\` — open tasks due before the release date
  are gate items.
- \`releases\` → \`list_notice\` and \`list_sbom\` — are the release artefacts present and current?
- \`approvals\` → \`get_approvals\` for any approval this release depends on. An
  undecided approval is a blocker, not a pending detail.

## Gate rules

Apply the policy's \`release_blocker_at\` threshold **per exposure class** — that is the
whole point of the gate. A high-severity finding in a test-only dependency does not
block a release; a medium one in shipped runtime code may. Never apply a single
severity threshold across the board.

A release is **blocked** when any of these hold:
- A component whose licence is unresolved past its grace period.
- A component under a forbidden licence in the delivered artefact.
- A required obligation not satisfied by the release artefacts — notice file incomplete,
  copyright holders missing, source offer absent.
- An approval this release depends on is still undecided.
- A vulnerability at or above the blocker threshold for its exposure class, without an
  accepted, documented residual-risk decision.

Everything else ships — but everything that ships with known findings needs a named
residual-risk statement, not silence.

## Deliverable

1. **Recommendation** — GO / GO WITH CONDITIONS / NO-GO, in the first line.
2. **Blockers** — each with what must happen to clear it and a realistic effort estimate.
3. **Conditions** — what must be documented or communicated before shipping.
4. **Residual risk** — one paragraph a non-specialist decision-maker can act on.
5. **Sign-off record** — the exact statement a human can countersign, naming the policy
   version, the date, and what was assessed.

${writeNote}

${LEDGER_UPDATES_SECTION}`),
  );

  // =========================================================================
  // 9 — Document findings
  // =========================================================================
  server.registerPrompt(
    "document-findings",
    {
      title: "Document findings in TrustSource",
      description:
        "Turn an assessment into durable records: risks with treatment tasks, so the next " +
        "review starts from decisions instead of from scratch.",
      argsSchema: {
        project: z.string().optional().describe("TrustSource project ID"),
        findings: z
          .string()
          .optional()
          .describe("The findings to record; defaults to those from this conversation"),
      },
    },
    ({ project, findings }) =>
      text(`${preamble(config)}

${projectLine(project, config)}

Record ${findings ? "the following findings" : "the findings established in this conversation"} as durable risk records in TrustSource.

${findings ? `Findings:\n${findings}\n` : ""}
The risk register is also your own memory: it is how the next run knows what was already
decided, and how a reviewer sees that a decision was made rather than forgotten.

${
  canWrite
    ? `You have write access. Before creating anything:

1. Call \`risks\` → \`list_risks\` for this project and check whether a record already
   exists. **Update it** (\`update_risks\`) rather than creating a duplicate — duplicated
   records are how a register becomes unusable.
2. Show the user the complete set of records you intend to create or update, and wait
   for confirmation before writing.
3. After writing, report back what was created, with the returned IDs.`
    : `This server runs read-only, so you cannot write. Produce the exact request payloads
instead, ready to apply, and state which tool and action each belongs to.`
}

## What makes a good risk record

A risk record is read months later by someone who was not in this conversation.

- **Title** — the risk, not the finding. "Unresolved licences block release clearance",
  not "17 warnings in licence report".
- **Description** — the situation, the affected components with versions, the policy
  rule that applies, and the consequence if nothing happens. Include the evidence:
  component keys, dependency paths, CVE IDs, deep-scan results.
- **Assessment** — likelihood and impact, each with a one-line reason. State the
  exposure class you assigned and why.
- **Treatment** — one task per concrete next step (\`risks\` → \`create_tasks\`), each with
  a verifiable action, a named owner and a due date from the policy SLA. "Monitor the
  situation" is not a task.

Group related findings into one risk with several tasks rather than one risk per
component — a register with one entry per CVE is a report, not a register.

Set the risk's \`origin\` tag to the closest value the schema offers (\`CVE\` for
vulnerability-derived risks, \`SSC\` for supply-chain and licence-derived ones) and state
in the description that the record was prepared by the compliance agent and on which
date, so agent-prepared records stay identifiable in an audit.

Never record internal infrastructure details, credentials or customer data.`),
  );

  // =========================================================================
  // 10 — Stakeholder digest
  // =========================================================================
  server.registerPrompt(
    "stakeholder-digest",
    {
      title: "Stakeholder digest",
      description:
        "Short digest for Slack, email or a status meeting — written for the audience, " +
        "not for the compliance team.",
      argsSchema: {
        project: z.string().optional().describe("TrustSource project ID"),
        audience: z
          .string()
          .optional()
          .describe("engineering | management | customer | auditor"),
      },
    },
    ({ project, audience }) =>
      text(`${preamble(config)}

${projectLine(project, config)}

Write a short digest of the current compliance situation${audience ? ` for **${audience}**` : ""}.

Gather the current state first — \`reports\` → \`list_licenses\` and \`list_vulnerabilities\`,
plus \`risks\` → \`list_risks\` for what is already decided. Never write a digest from
memory or from an earlier message in this conversation without re-checking; a digest
that reports stale numbers destroys trust in the role.

## Length and tone

Maximum 200 words. No tables, no bullet lists longer than four items. It has to be
readable on a phone.

Lead with whether anything needs a decision. If nothing does, say so in the first line
and keep the rest to two sentences — a digest that manufactures urgency to justify
itself is worse than no digest.

## Audience calibration

- **engineering** — components, versions, upgrade paths. What to change, where.
- **management** — can we ship, what does it cost, what is the exposure if we do
  nothing. No CVE IDs unless one genuinely matters.
- **customer** — what we did, what we found, what we are doing about it. Never
  speculate about exploitability of shipped software in a customer-facing text.
- **auditor** — what was checked, against which policy version, on which date, and what
  the evidence was. Completeness over brevity here.

End with one line naming the next scheduled review and who owns the open items.

${draftingRule}`),
  );

  // =========================================================================
  // 11 — Trigger playbook: a new release cycle opens
  // =========================================================================
  server.registerPrompt(
    "new-release",
    {
      title: "New release cycle - plan and reconcile",
      description:
        "Entry point when a release cycle opens: reconcile against the previous release's " +
        "state, open the objective set for this cycle, and hand back a ledger update. Start " +
        "here when a release-opened event fires.",
      argsSchema: { ...TRIGGER_CONTEXT_ARGS },
    },
    ({ projectId, releaseId, ledger }) =>
      text(`${preamble(config)}

${projectLine(projectId, config)}
${renderLedgerSnapshot(ledger)}
A new release cycle is opening${releaseId ? ` (release \`${releaseId}\`)` : ""}. Your job is
to plan the cycle, not to assess it yet - that is what \`release-readiness\` is for once
the work is done. Finish this session with a concrete objective set, not a summary of
the previous release.

## Reconcile against the previous release

1. Use the ledger snapshot above to find the previous release's objectives and their
   final status. An objective marked \`done\` or \`waived\` does not carry forward; one
   still \`open\` does, unless this cycle's scope has made it obsolete - say so if it has.
2. \`releases\` → \`list_notice\` and \`list_sbom\` for the previous published release -
   confirm what actually shipped last time matches what the ledger says was decided. A
   mismatch between "decided" and "shipped" is itself a finding, not a bookkeeping detail.
3. \`reports\` → \`list_licenses\`, \`list_vulnerabilities\` and \`projects\` → \`list_partsList\`
   - the current legal and security picture, compared against what the previous
   release's objectives assumed. ${RECONCILE}
4. \`risks\` → \`list_risks\` and \`list_tasks\` - open treatment tasks with a due date
   inside this cycle become this cycle's objectives; nothing here should be silently
   dropped just because the release moved on.

## Plan the cycle

1. **Carried-over objectives** - still open, still in scope: restate them, don't
   silently re-open a new copy.
2. **New objectives** - from the reconciliation above: newly unresolved components,
   newly introduced licences, newly due obligations, vulnerabilities whose SLA falls
   inside this cycle.
3. **Dropped objectives** - carried-over items that are now genuinely obsolete, with
   the reason. Silence is not the same as a decision.
4. **Key dates** - the release date if known, and any objective's own deadline that
   falls before it. Flag anything that cannot realistically close in time now, while
   there is still room to act, not at the readiness gate.

## Deliverable

1. **Reconciliation** - what carried over, what's new, what's dropped, in three
   short lists.
2. **This cycle's objective set** - every objective from above, each with an owner
   and a target date.
3. **Risks to the cycle** - anything already visible that could block
   \`release-readiness\` later, named now so it isn't a surprise then.

${writeNote}

${LEDGER_UPDATES_SECTION}`),
  );

  logger.info(`Registered 11 playbooks for role "${config.role}"`, {
    accessMode: config.accessMode,
    writeEnabled: canWrite,
  });
}
