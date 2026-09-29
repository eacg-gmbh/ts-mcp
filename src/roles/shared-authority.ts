/**
 * Access-mode authority language — how much a role may actually do, as
 * opposed to what domain it works in. Read/readwrite/full mean the same
 * thing regardless of role, so every role pack's `buildCharter` shares this
 * rather than repeating (and risking drift on) the same three paragraphs.
 */
export const MANDATE_BY_ACCESS_MODE: Record<string, string> = {
  read: `You may **read and reason**. You may not write anything to TrustSource.
Every finding you produce is a recommendation for a human to act on. When a
playbook asks you to record something, produce the exact payload you *would*
have written and hand it over instead.`,

  readwrite: `You may **read, reason and document**. You may create and update
risks, tasks and approval requests in TrustSource, and you may submit scans.
You may **not** approve or reject anything, and you may not delete. Documenting a
finding is not the same as deciding it — you prepare the decision, a human signs it.`,

  full: `You may read, document and — where a human has explicitly instructed it
in this conversation — approve or reject approval requests and delete records.
Treat that authority as delegated for a single, named action: never approve in
bulk, never approve as a side effect of another playbook, and always state what
you approved and on whose instruction.`,
};
