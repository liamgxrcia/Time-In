# Frontend contract — R1 persistence revision

Authoritative browser-safe types: `web/src/contracts/crm.ts`. The frontend must never write Supabase tables directly. Normal commands use the signed-in user session; the service role never reaches the browser.

## HTTP

All API responses are `{ data, error, requestId }`. Errors use stable codes from `ErrorCode`; no SQL errors, stack traces, token values or notes are returned in errors. Send `Content-Type: application/json`, same-origin credentials, and a random UUID `operationId` for each intended mutation. Keep the same operationId when retrying the same payload. Reusing it for a different payload returns CONFLICT.

- `GET /api/crm/snapshot`: Snapshot for the current CEO, including all defined entity collections. Current pilot cap: 2,000 records per collection; a cap overflow returns VALIDATION rather than silently truncating data.
- `POST /api/crm/command`: CommandRequest → CommandResult. Every supported command is enumerated in the union. `expectedRevision` is the last read revision. On CONFLICT reload and let the CEO review; never silently retry with a newer revision.
- `GET /api/crm/today?timeZone=America/New_York`: QueueItem[].
- `GET /api/crm/search?q=...`: SearchResult[]. Debounce and cancel stale frontend requests.
- `GET /api/crm/health?personId=UUID`: HealthResult.
- `GET /api/crm/recommendations?personId=UUID`: Recommendation.
- `GET /api/crm/reports?start=ISO&end=ISO&timeZone=...`: Report, half-open [start,end).
- `POST /api/crm/import-preview`: `{ csv, mapping: { name, email?, phone? } }` → ImportPreview. Preview performs no database writes. Commit requires explicit choice on each row.
- `POST /api/crm/files/access`: `{ id }` → `{ url, expiresIn: 60 }`. Authorizes metadata ownership and available status, audits access, then creates an expiring signed URL. Never persist signed URLs.
- `POST /api/crm/files/upload`: `{ id }` → signed upload details for a previously registered pending file. Use only the returned private path; finalize verifies stored size/type server-side.
- `GET /api/crm/system`: auth/config/integration status; no secrets or connection strings.

## Auth

The app is invite-only with exactly one explicitly provisioned CEO UUID. Supabase user existence alone does not grant access. Provisioning is an operator-only SQL step. Server-side auth validates sessions; business routes require membership in `private.ceo_access`. Auth redirects must be relative same-origin paths. No public registration UI. Production requires secure cookies, HTTPS, fixed APP_ORIGIN and Supabase auth URL allowlists.

## Semantics

Person includes joined LeadProfile fields; ClientAccount and OnboardingCase remain separate collections. `stage` values use snake_case. Timeline/history are append-oriented. Referral IDs preserve original attribution and merged Person records resolve through `mergedInto`. Scripts expose immutable published versions. Snapshot reads are authorized. Notification preferences record consent only; delivery is not implemented and preferences do not imply a working reminder system.

The initial backend is online. Do not label an unsaved browser form as synchronized, and do not queue lifecycle or approval writes offline. Show safe typed errors with retry guidance.

`GET /api/crm/health` without personId returns HealthResult[] for all visible records in one request. Use this for dashboards to avoid one API call per person. `GET /api/crm/notification-preferences` returns the saved preference flags (defaults false); it does not send notifications.

## Configured MFA

`POST /api/auth/login` returns either `{ authenticated: true }` or `{ requiresMfa: true, factorId, challengeId }`. For a configured verified TOTP factor, collect a six-digit code and POST `/api/auth/mfa` with `{ factorId, challengeId, code }`. The response uses the same API envelope. Protected boundaries return MFA_REQUIRED until verification completes. RLS also enforces aal2 for enrolled verified factors, so direct Data API requests cannot bypass the challenge. MFA enrollment is currently an operator/Supabase Auth setup task; the product does not implement enrollment/recovery UI yet.

## R1 integration revision (migration 007)

This section supersedes earlier DTO details. All commands below are implemented in `crm_command` and validated at the HTTP boundary. The published union in `web/src/contracts/crm.ts` is the source for request shapes. This is a backend contract, not a claim that every visible screen is wired.

| Workflow | Persisted operation and frontend requirements |
|---|---|
| People / provenance | `person.create` accepts `source` (manual/referral/imported), `sourceNote`, `consentNote`, `communicationRestricted`, contacts and optional organization UUID. Pass the form's values: omitting source defaults to manual. `person.update` requires Person revision; source note and communication restriction may be changed. Creation source remains immutable through these commands. Consent changes record actor/time and before/after audit metadata; legacy capture times remain null rather than invented. Source selection alone does not create a referral edge. |
| Organizations | `organization.create` / `organization.update`; update uses Organization revision. Person creation can attach an owned organization. |
| Lifecycle / next action | `lifecycle.transition` / `next_action.schedule` use Person revision. NextAction responses always include ownerId. Input may omit ownerId: the transaction assigns the sole authenticated CEO. Another owner is forbidden. Follow-Up requires type, date and stored owner. Task status never doubles as stage. Lifecycle history preserves reason, next action and operationId even after reopening. |
| Activities / timeline | `activity.create` appends an activity and audits atomically. Call outcome and next action rules run in the same transaction; interested calls may advance to pending_signup. Result id/revision identify the affected Person. Reload the snapshot after recording; do not fabricate activity IDs, stage or revision locally. Historical activity/referral IDs resolve through mergedInto. |
| Onboarding | `GET /api/crm/onboarding?personId=UUID` returns `{ current, history }`. Current means pending or approved, never a rejected case. History sorts by createdAt descending then UUID. `Person.currentOnboardingCaseId` supplies the same current selection. Start requires pending_signup and no current case. `onboarding.item` completes an item/blocker, or explicitly waives it with nonempty waiverReason. `onboarding.decide` requires case revision and rationale; approval checks all required items/blockers and creates active lifecycle/client/history/audit atomically. Decisions/items reject a person who has left pending_signup. Final decisions are immutable. |
| Tasks / commitments | `task.create`, `task.complete`, `task.snooze`, `task.cancel`. Complete requires real evidence; snooze requires a future date; cancel requires a reason. Mutations use Task revision. Recurrence returns nextTaskId and creates exactly one successor even on retry. Stage remains independent. |
| Referrals | `referral.create` requires owned, distinct referrerId/personId plus sourceNote; repeated relationship attribution returns DUPLICATE. It schedules initial outreach when appropriate. Conversion and merging retain original attribution IDs. |
| Client review | `client.review` takes personId, reviewAt, risks and **ClientAccount.expectedRevision**, not Person revision. Result id is personId and revision is the new client revision. |
| Scripts | New `script.publish` omits scriptId/expectedVersion. Publishing another version requires both scriptId and latest expectedVersion. Result supplies version ID, scriptId and version. Existing lineage name/stage must match; changing them requires a new script. Published versions cannot be overwritten. |
| Imports | Preview uses explicitly mapped column headers and never writes business data. Commit reruns validation/deduplication under the CEO transaction lock. Each row needs a unique logical row number and create/skip/merge choice. Existing or within-batch matching name/email/phone returns DUPLICATE for create unless the CEO explicitly chose `allowDuplicate: true`. Merge needs targetId and its expectedRevision; repeated merges into that target use incrementing revisions in submitted order. Preview `row:N` matches are not UUID targets: skip/combine those rows before commit. |
| Import results / rollback | Commit returns importRows with original row, created/merged/skipped action and personId. Snapshot ImportBatch includes results/revision; legacy batches have no reconstructed results. rowCount counts created+merged rows, excluding skips. Commit is all-or-nothing. Rollback checks the entire stored manifest and related-record safety, then restores prior contacts or deletes untouched imported people. Surviving Person revisions strictly increase; stale pre-import forms cannot overwrite restored records. Batch rollback is a single-use state transition plus audit; repeat the same operationId for transport retries. |
| Preferences | GET notification-preferences returns emailEnabled, webPushEnabled, revision and deliveryAvailable:false. `notification.preferences` requires that revision (0 before the first save); save returns revision 1 or increments. Before/after consent is audited. Preferences do not enable delivery. |
| Files / agreements | `file.register` stores owned pending metadata and returns id/revision. POST files/upload with id returns a path, upload-scoped token and URL; send bytes via Supabase Storage's signed-upload API for that exact path, with upsert disabled. `file.finalize` needs id/expectedRevision and verifies stored byte count and MIME metadata in PostgreSQL. POST files/access only signs available owned files for 60 seconds and audits access before signing. Upload signing is also audited. File expiresAt is agreement metadata, not the signed URL TTL. Limits: PDF, PNG, JPEG or plain text, at most 20 MiB. |
| Search / Today / health / reports | Existing read endpoints operate on the owner-scoped transaction snapshot; no fixture fallback. Today and health explain their ordering/factors. See backend-rules.md for tested reporting definitions. |
| Audit / system | Snapshot supplies immutable AuditEvent actorId, operationId, targetId, action and metadata, plus LifecycleHistory operationId/reason/nextAction. GET system reports current backend capability; do not invent browser location, inactivity timeout, configured MFA policy, reminder delivery or external-provider health in the UI. |

For **every** intended mutation, create one operationId and retain it with the exact payload until success or explicit abandonment. Reuse it only for an identical retry. On CONFLICT, refetch, ask the CEO to review changed data, and submit a new operationId for the newly intended command. CommandResult now returns revision where applicable; onboarding additionally returns personId/personRevision. Refetch dependent collections after any mutation (approval affects multiple collections). Failed mutations leave no business rows, lifecycle history, audit or idempotency result behind.

CSV support is decoded text, a total JSON request capped at 1 MiB, and at most 1,000 records; UTF-8 BOM, CRLF, quoted multiline fields and escaped quotes are supported. Browser file decoding must happen before preview. Do not advertise a 10 MiB or automatic UTF-16 upload workflow against this endpoint.

Private Supabase credentials are server-only; browser storage upload uses only the narrowly scoped upload token. The provider documents a two-hour signed-upload lifetime; download URLs here are explicitly 60 seconds. [Supabase signed uploads](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl).
