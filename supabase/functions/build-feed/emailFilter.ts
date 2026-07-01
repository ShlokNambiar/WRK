// Decides which unread emails are even *candidates* for becoming a reply-task,
// before the AI actionability pass. Pure + no I/O so it's unit-testable.
//
// Order of authority (most specific wins):
//   1. user MUTED this sender      -> drop, always
//   2. user ALLOWED this sender    -> keep, always (even if it looks like bulk)
//   3. obviously bulk/automated    -> drop (List-Unsubscribe header or no-reply)
//   4. everything else             -> "undecided" -> hand to the AI classifier
//
// PRIVACY: operates only on the From / List-Unsubscribe headers; no body.

export type Candidate = { threadId: string; subject?: string; from?: string; listUnsubscribe?: string }

// "Sarah Chen <Sarah@X.com>" | "bob@y.com" | "<a@b.com>" -> "sarah@x.com"
export function senderAddress(from?: string): string {
  if (!from) return ''
  const m = from.match(/<([^>]+)>/)
  const addr = m ? m[1] : from
  return addr.trim().toLowerCase()
}

// Senders that never expect a personal reply — automated/transactional mail.
const AUTOMATED_FROM = /(no-?reply|do-?not-?reply|donotreply|no_reply|notifications?@|mailer-daemon|postmaster@|bounce[sd]?@)/i

// Cheap, deterministic bulk check: a List-Unsubscribe header (newsletters,
// marketing, digests) or a no-reply / automated sender.
export function isBulkOrAutomated(c: Candidate): boolean {
  if (c.listUnsubscribe && c.listUnsubscribe.trim()) return true
  if (c.from && AUTOMATED_FROM.test(c.from)) return true
  return false
}

export function partitionCandidates(
  candidates: Candidate[],
  muteSet: Set<string>,
  allowSet: Set<string>,
): { allow: Candidate[]; undecided: Candidate[] } {
  const allow: Candidate[] = []
  const undecided: Candidate[] = []
  for (const c of candidates) {
    const addr = senderAddress(c.from)
    if (addr && muteSet.has(addr)) continue          // user muted -> drop
    if (addr && allowSet.has(addr)) { allow.push(c); continue } // user allowed -> keep
    if (isBulkOrAutomated(c)) continue               // obvious bulk -> drop
    undecided.push(c)                                // let the AI decide
  }
  return { allow, undecided }
}
