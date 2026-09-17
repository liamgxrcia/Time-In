# R1 backend persistence handoff

The backend R1 workflows now persist through authenticated PostgreSQL transactions. Seven migrations apply cleanly and local verification passes. The visible application still has frontend bindings to finish; no end-to-end hosted deployment or full UI completion is claimed. No UI/presentation files were changed in this pass.

## Delivered

- Person source/source-note and consent/restriction persistence, actor/time provenance and immutable before/after audit details. Historical unknown capture times remain null.
- Database-derived CEO ownership for every next action; Follow-Up owner/type/date constraint. Lifecycle reason/action snapshots and operation IDs remain available after reopening.
- Explicit current-onboarding selection, unique pending/approved case, revision-checked item/waiver/decision commands, and atomic approval/active/client/history/audit creation. Decisions reject records that have left pending_signup.
- Task completion/snooze/cancellation and exactly-once recurring successors, independent of lifecycle. Referral duplicate prevention and preserved attribution through conversion/merging.
- Client review revision checks; immutable script publishing with expected-version checks and fixed lineage identity.
- Import mapping/preview validation, normalized duplicate detection again at commit, explicit duplicate override, revision-checked merges, per-row reconciliation, atomic rollback and strictly increasing surviving revisions.
- Saved notification preferences with revision checks and auditable before/after consent; delivery remains unavailable.
- File registration, private signed upload with overwrite disabled, PostgreSQL size/type finalization, audited upload signing and download access. Privileged storage clients are created only after authorization/state checks and successful audit.
- Production configuration validation: HTTPS origins, server-only service credentials, browser-safe public key, no deployed demo mode, Vercel staging/production environment alignment.

Authoritative requests and responses are in `web/src/contracts/crm.ts`. The workflow matrix and exact revision/result semantics are in [frontend-contract.md](frontend-contract.md).

## Exact files changed in this pass

| Purpose | Files |
|---|---|
| Additive schema/transaction upgrade | `supabase/migrations/202609160007_r1_contract.sql` |
| Browser-safe and generated contracts | `web/src/contracts/crm.ts`, `web/src/contracts/database.types.ts` |
| Persistence projection and current-case selection | `web/src/lib/server/repository.ts` |
| Command validation and import preview | `web/src/lib/server/validation.ts`, `web/src/lib/server/import.ts` |
| Secure deployed configuration | `web/src/lib/server/supabase.ts` |
| API contracts/preferences and file capabilities | `web/src/app/api/crm/[operation]/route.ts`, `web/src/app/api/crm/files/[operation]/route.ts` |
| Real database tests | `web/tests/database.test.ts` |
| Focused API/domain/file/config tests | `web/tests/backend/api.test.ts`, `web/tests/backend/domain.test.ts`, `web/tests/backend/files.test.ts`, `web/tests/backend/config.test.ts` |
| Handoff/operational documentation | `docs/frontend-contract.md`, `docs/backend-handoff.md`, `docs/backend-operations.md` |

Migrations 001–006 remain unchanged. Generated database types were refreshed from the applied PostgreSQL catalog using the existing runner.

## Verification results

`node web/scripts/test-database.mjs`:

- Applied all **7 migrations** to a fresh disposable real PostgreSQL database.
- **93 tests passed: 31 database integration tests and 62 backend unit/API/config tests.**
- Independently exercised every public table's RLS as CEO and non-CEO, plus anonymous RPC denial, direct stage-write denial, cross-owner references, MFA assurance, concurrent revisions and idempotency.
- Exercised provenance, onboarding restart/approval/rejection/waiver and selection, tasks/recurrence, referral conversion/merge, client review, scripts, imports/rollback/reconciliation, file metadata finalization, immutable audit/lifecycle, and typed API responses.
- Ran the real database snapshot through the TypeScript repository projection, then checked the frontend selection contract.
- Applied fictional seed twice and regenerated types; disposable cluster cleaned up.

`cd web && npm run verify`:

- TypeScript: passed.
- ESLint: passed with zero warnings/errors.
- General suite: **64 passed; 31 database tests explicitly skipped** without TEST_DATABASE_URL. Those 31 tests passed separately above; skips are not counted as passes.
- Optimized Next.js production build: passed. No build blocker remains.
- Non-blocking tool notice: Vitest warns that its existing CommonJS-loaded `vitest.config.ts` uses ESM syntax unsupported by a future native config-loader default. No config/UI-owned file was changed to suppress it.

`git diff --check`: passed. Network-bound API tests mock Supabase transport. PostgreSQL tests use real roles and SQL with local Auth/Storage schema fixtures; they do not verify hosted Supabase Auth or object delivery.

## Frontend integration findings

Read-only audit of the current visible screens found these remaining bindings outside backend ownership:

- `web/src/lib/api/client.ts` omits source and consentNote from person.create, constructs local activity IDs/state, and selects onboarding using array order. Pass provenance and use currentOnboardingCaseId or the new onboarding read endpoint; refresh authoritative snapshots after mutations.
- `web/src/features/tasks/tasks-page.tsx` completes tasks only in the React Query cache. Use task.complete with real evidence and the Task revision; persist before displaying success.
- `web/src/features/onboarding/onboarding-page.tsx` displays cases but does not call item/decision commands. Preserve case revisions in the view model and wire explicit completion, waiver and decision actions.
- `web/src/features/import/import-page.tsx` displays fixed sample data and advances steps without backend preview/commit/rollback. Its 10 MiB/UTF-16 copy does not match the current 1 MiB decoded-JSON/1,000-row contract.
- Referrals, client review, script publishing, file uploads and preference saves have persisted contracts but still need frontend command controls.
- Settings contains hardcoded timeout/browser-location/MFA claims and unwired export/end-other-sessions buttons. These are not established capabilities; remove unsupported claims or implement approved separate work. Reminders remain deferred; Google Calendar is now implemented as a read-only, encrypted OAuth integration and still requires hosted Google Cloud configuration and live callback verification.

A durable frontend handoff was assigned to workspace owner **liamgxrcia**, board item `ad596122-cdb2-445d-9e41-167f63880db5`, with the contract changes and full binding brief. This assignment is not evidence that the frontend work has been completed.

## External setup still required

No hosted resource was created, modified or deployed in this pass. Only `web/.env.example` is present in the checkout; local tests need no live secrets.

1. Provision distinct staging/production Supabase projects and the sole CEO identity; disable public signup and provision `private.ceo_access`. Configure MFA enrollment/recovery and policy with the CEO through Supabase Auth; CRM stores no MFA secrets.
2. Set reviewed Auth URL allowlists and encrypted Vercel environment values: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN`, `APP_ENV`, `RATE_LIMIT_SECRET`. Scope preview deployments to staging and production deployments to production; Vercel root is `web`.
3. Apply reviewed migrations, verify private bucket configuration, and exercise real sign-in/refresh/expiration/sign-out, MFA, non-CEO denial, signed upload/finalization/download and URL expiry on staging.
4. Configure Auth/network abuse controls, backup/PITR retention and independent Storage object backups. Perform a recovery drill against a separate project before release.
5. Complete frontend bindings and run authenticated browser acceptance tests against staging. A successful build alone does not establish a live functional release.

See [backend-operations.md](backend-operations.md) for environment and recovery procedures. No wagering, fund movement, third-party credential storage or execution capability was added.
