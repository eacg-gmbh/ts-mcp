import { readFileSync } from "node:fs";
import { logger } from "./logger.js";

/**
 * The compliance policy the agent reasons against.
 *
 * TrustSource's API exposes the FOSS liaison contact (`/compliance/company/foss`)
 * but not the governing policy itself, so the policy travels with the server as a
 * resource. Customers override it with their own document via `TS_POLICY_FILE`.
 */
export const DEFAULT_POLICY = `# Open Source Compliance Policy (default pack)
#
# This is a neutral starting point. Replace it with your own policy via
# TS_POLICY_FILE=/path/to/policy.yaml — the agent decides strictly against
# whichever document is loaded here, never against its own preferences.

policy_version: "1.0"
owner: "Open Source Compliance Board"
review_cycle: annual

# ---------------------------------------------------------------------------
# Distribution context — drives how strictly copyleft terms are applied.
# ---------------------------------------------------------------------------
distribution:
  mode: saas              # saas | on-premise | embedded | internal-only
  source_offered: false
  modifies_dependencies: false

# ---------------------------------------------------------------------------
# Licences
# ---------------------------------------------------------------------------
licenses:
  allowed:
    - MIT
    - Apache-2.0
    - BSD-2-Clause
    - BSD-3-Clause
    - 0BSD
    - ISC
    - Blue Oak Model License 1.0.0
    - CC0-1.0
    - Unlicense

  # Permitted, but each use needs a recorded decision.
  requires_approval:
    - MPL-2.0
    - EPL-2.0
    - LGPL-2.1
    - LGPL-3.0
    - CC-BY-4.0
    - CDDL-1.0

  # Not permitted in distributed artefacts without board exemption.
  forbidden:
    - AGPL-3.0
    - SSPL-1.0
    - BUSL-1.1
    - Commons Clause
    - JSON License
    - "GPL-2.0 (linked into proprietary code)"

  unknown_license:
    # Components TrustSource could not resolve to a licence.
    treatment: blocker_for_release
    grace_period_days: 30
    required_action: >
      Identify the licence from the package metadata or upstream repository and
      record it in TrustSource. If it cannot be established, replace or remove
      the component before the next release.

# ---------------------------------------------------------------------------
# Resolving components whose licence information is missing.
# ---------------------------------------------------------------------------
component_resolution:
  # Components marked "private" are not automatically internal — public packages
  # are regularly misclassified. Establish which it is before acting.
  classification_first: true

  branches:
    misclassified_public:
      signal: >
        The name matches a public package (registry namespace, known project
        prefix such as @jest/, @types/, @angular/).
      action: >
        Resolve the licence from the public registry and correct the component's
        metadata in TrustSource. Do not run a deep scan — the answer is public.
    internal_component:
      signal: Genuinely developed in-house or by a contractor.
      action: >
        Locate the source repository, run a deep scan with copyright analysis,
        and record the resulting licence and copyright holders.
      default_license: TrainCo-Standard
    third_party_no_metadata:
      signal: External component that publishes no licence metadata.
      action: >
        Deep-scan the upstream repository. If no licence can be established,
        treat it as "all rights reserved" — not as permissive — and escalate.

  deep_scan:
    include_copyright: true
    max_wait_minutes: 30
    # Never deep-scan a repository the organisation does not own or have the
    # right to analyse.
    requires_authorisation_for_external_repos: true

# ---------------------------------------------------------------------------
# Obligations — what must be satisfied before a release goes out.
# ---------------------------------------------------------------------------
obligations:
  notice_file:
    required: true
    must_contain: [copyright_notices, license_texts]
  modification_disclosure:
    required_for: [Apache-2.0, MPL-2.0, EPL-2.0]
  source_offer:
    required_for: [LGPL-2.1, LGPL-3.0, MPL-2.0]

# ---------------------------------------------------------------------------
# Vulnerabilities — severity alone never decides. Exposure decides.
# ---------------------------------------------------------------------------
vulnerabilities:
  exposure_classes:
    shipped_runtime:
      description: Component is part of the delivered artefact and reachable at runtime.
      sla_days: { critical: 7, high: 14, medium: 60, low: 180 }
      release_blocker_at: high
    shipped_not_reachable:
      description: Shipped, but the vulnerable code path is not invoked.
      sla_days: { critical: 30, high: 90, medium: 180, low: 365 }
      release_blocker_at: critical
      requires: vex_justification
    build_or_test_only:
      description: >
        Present only in build, test or tooling dependency paths (for example
        jest, nyc, istanbul, eslint). Not part of the delivered artefact.
      sla_days: { critical: 90, high: 180, medium: 365, low: 365 }
      release_blocker_at: never
      requires: vex_justification
      note: >
        Still relevant to build-system integrity — treat a compromised build
        dependency as a supply-chain matter, not as a product vulnerability.

  vex_vocabulary:
    # Use these exact statuses and justifications when documenting a decision.
    statuses: [not_affected, affected, fixed, under_investigation]
    justifications:
      - component_not_present
      - vulnerable_code_not_present
      - vulnerable_code_not_in_execute_path
      - vulnerable_code_cannot_be_controlled_by_adversary
      - inline_mitigations_already_exist

  muting:
    # A muted finding is a decision, not a dismissal — it needs an owner and a date.
    requires: [justification, owner, review_date]
    max_validity_days: 365

# ---------------------------------------------------------------------------
# Approvals — how legal decisions are brought to a conclusion.
# ---------------------------------------------------------------------------
approvals:
  # An approval request is only worth a decision-maker's time if it arrives
  # complete. Never open one before these are in place.
  dossier_required:
    - affected components with versions and dependency paths
    - the licence in question and the obligation it triggers
    - how the component is used and whether it is distributed
    - the options, with the consequence of each
    - a recommendation

  reminder_schedule_days: [3, 7, 14]
  escalate_after_days: 21

# ---------------------------------------------------------------------------
# Escalation — who decides what the agent may not decide alone.
# ---------------------------------------------------------------------------
escalation:
  license_exemption: Open Source Compliance Board
  release_override: Product Owner + Compliance Board
  critical_vulnerability: Security Officer
  response_time_hours: 48

# ---------------------------------------------------------------------------
# Contacts — who the agent addresses. Replace with real names and addresses.
# ---------------------------------------------------------------------------
contacts:
  compliance_manager:
    name: "<name>"
    email: "<email>"
    decides: [licence exemptions, release overrides, approval requests]
  engineering_lead:
    name: "<name>"
    email: "<email>"
    owns: [component replacement, dependency upgrades, metadata corrections]
  security_officer:
    name: "<name>"
    email: "<email>"
    decides: [vulnerability risk acceptance]
`;

export function loadPolicy(policyFile?: string): {
  content: string;
  source: string;
} {
  if (!policyFile) {
    return { content: DEFAULT_POLICY, source: "built-in default pack" };
  }

  try {
    const content = readFileSync(policyFile, "utf8");
    logger.info("Loaded compliance policy", { policyFile, bytes: content.length });
    return { content, source: policyFile };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      `Failed to read TS_POLICY_FILE "${policyFile}": ${message}. ` +
        "Refusing to start with an unknown policy — the agent would otherwise " +
        "decide against the built-in default while operators assume their own policy applies.",
    );
    process.exit(1);
  }
}
