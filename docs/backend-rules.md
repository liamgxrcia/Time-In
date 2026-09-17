# Implemented business rules and metrics

## Lifecycle

The frontend submits `lifecycle.transition`; it cannot UPDATE the stage table. PostgreSQL obtains the CEO advisory transaction lock and checks `expectedRevision`. A successful transaction changes stage, next action, revision, stage-entry timestamp, lifecycle history, timeline and audit together. A failure commits none of these changes.

| Origin | Permitted destinations |
|---|---|
| New | Follow-Up, Pending Signup, Not Interested, Closed |
| Follow-Up | Pending Signup, Paused, Not Interested, Closed |
| Pending Signup | Active, Follow-Up, Paused, Not Interested, Closed |
| Active | Paused, Closed |
| Paused | Follow-Up, Pending Signup, Active, Not Interested, Closed |
| Not Interested / Closed | New, Follow-Up |

Follow-Up always requires typed next action plus date. Pending Signup requires a recorded conversation outcome. Active requires approved onboarding; a deferred database trigger checks this again. Paused/Not Interested/Closed require nonblank reasons. Terminal transitions cancel open tasks and clear next action. Reopening appends new history rather than overwriting it.

Onboarding snapshots its template ID/version and items. Required items and all blockers must be complete or explicitly waived before approval. Decisions require rationale/date. Final decisions are immutable. A rejected case may be followed by a new case; it never activates a person. Published script versions and audit/timeline/lifecycle events cannot be updated or deleted through the application.

## Today scoring

Base score: unresolved risk 110; missing required action 100; overdue commitment 95; overdue follow-up 90; onboarding blocker 85; relationship attention 75; due today 70; new referral 65; review within seven days 60; lifecycle stalled over fourteen days 50. Add explicit person priority (0/10/20), plus age in whole days capped at 30. Sort descending score, ascending due date, then stable item ID. Calendar-day classification uses the requested IANA timezone. Terminal, archived and merged-source people are excluded. Rescheduling changes underlying next-action/task dates; there is no disconnected UI-only snooze flag.

## Health and recommendations

Unresolved client risk, three overdue commitments, or more than 60 days without contact = At Risk. One/two overdue commitments, overdue review, onboarding blocker or more than 30 days without contact = Needs Attention. Otherwise no recorded contact = Unknown; contact within fourteen days = Strong; other recent contact = Stable. Explanations include factors and evaluation time. Manual override data is preserved separately; the current command surface does not edit overrides.

Recommendations respect communication restrictions, terminal stage and pending onboarding before ordinary follow-up preparation. They reference published script versions where available. They never send communications or make lifecycle/approval decisions.

## Reporting

Period filters are half-open `[start,end)`. Calls count Activity.kind=call in the period. New approvals count Pending Signup→Active lifecycle events; reactivation from Paused does not count as a new approval. Closure count uses transitions into Closed. Referral volume uses referral-created dates; converted referrals have a current ClientAccount after following merge redirects. Current active/stage/health distributions describe the current snapshot, not historical end-of-period state.

Task completion rate = tasks due within the period, completed at or before their due timestamp / all noncancelled tasks due within the period. Empty denominator returns null. This is labelled task completion, not misrepresented as the PRD's broader follow-up compliance metric (intentional rescheduling history requires a later metric). Daily activity is grouped in the requested IANA timezone. Stage movement counts transitions in the selected period. Average time in stage is the arithmetic mean of each recorded stage episode clipped to the selected interval and current time. Retention is people active immediately before the interval start who remain active immediately before its end / active-at-start people; empty cohorts return null. Equal-duration preceding periods provide stable comparison counts. Current overdue follow-ups, stalled records, pending/blocked onboarding, overdue reviews, missing-contact/next-action records and integration warnings are also returned.

## Import and merge

CSV is UTF-8 text supplied to the preview endpoint, maximum 1 MB / 1,000 rows per batch. Supports BOM, CRLF/LF, quoted newlines and escaped quotes. Rejects malformed quoting, duplicate/missing headers and row-width mismatches. Email normalizes whitespace/case; phone normalization strips ordinary presentation punctuation only and never guesses a country code.

Duplicate matching: exact normalized email/phone = 0.98; matching name = 0.65; expose reasons, including duplicates earlier in the same file. Preview performs no writes. Commit requires explicit skip/create/merge for each row and revalidates inside PostgreSQL; all rows in a batch commit atomically. Merge import only adds contact methods and records before/after state. Rollback runs manifest rows in reverse order, verifies unchanged state and rejects related-work conflicts. No partial rollback. Import history/audit remains.

Person merge conservatively refuses conflicting controlled data or a source with onboarding/client state. It unions contacts/tags, preserves notes, moves mutable tasks/files, retains immutable timelines/referrals/edges with a recoverable source redirect. Resolve controlled conflicts before merging. The source is archived, never silently erased.
