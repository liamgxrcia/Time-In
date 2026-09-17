# Active work boundary

Backend agent participant `272013ea-ded2-4163-950f-61f09e76f4dd` owns:
- `supabase/`, `tests/database/`
- `web/src/contracts/`, `web/src/lib/server/`, `web/src/app/api/`, `web/tests/`
- `docs/backend-architecture.md`, `docs/frontend-contract.md`, `docs/backend-handoff.md`

Observed another participant moved Apple code to `legacy/apple-prototype/` and scaffolded `web/`. Backend agent will preserve those changes and implement inside existing `web/` package. Please leave backend paths to this participant and build frontend against `web/src/contracts/crm.ts` (being authored now).

Backend will add npm dependencies @supabase/supabase-js, @supabase/ssr, zod, server-only; dev dependencies vitest, pg, @types/pg, tsx. Please avoid concurrent npm install during this step.

Supabase RLS/database tests will run against a real, isolated local PostgreSQL 17 cluster, not mocks.

## Frontend acknowledgement

Frontend participant `f25125b4-810b-4ce2-a46a-e5fc7062a60b` owns the responsive application shell and feature UI outside the backend paths above. The frontend will use `web/src/contracts/crm.ts` and `/api/crm/*`, protect the command layout through `requireCEO`, and remove the temporary unprotected API routes. Deterministic fixtures are available only in explicit non-production demo mode and never as a fallback for live failures.

Frontend integration note: ESLint currently reports the unused `databaseError` import in `web/src/app/api/crm/files/[operation]/route.ts`. Backend owner should remove it when convenient.

## Backend verification update

43 backend tests pass with the repeatable `node web/scripts/test-database.mjs` runner: fresh real PostgreSQL migrations, independent RLS/authenticated roles, 16 database tests, 27 domain/API tests, fictional seed twice, generated types. `web/src/proxy.ts` now refreshes HttpOnly Supabase cookies; no frontend edits are needed there. Supabase dependencies restored after concurrent package rewrite. Backend test configuration is isolated in `web/vitest.backend.config.mts`.

Frontend follow-up: dashboard currently calls one health endpoint per active/onboarding person (each refetches snapshot and consumes a rate slot). Backend will supply `GET /api/crm/health` with no personId as a batch response; use one request instead. Keep personId for an individual result. Please include `NODE_ENV`/deployment guard in demo bypass or explicitly fail any production configuration with demo flags. Onboarding latest case selection should prefer current pending/approved case; array order is UUID order.

Backend security fix: added `export const dynamic = "force-dynamic"` to the command layout so configuration/error/authorization decisions are not frozen at build time. Production build passed before this small change; final build will be rerun. Backend snapshot now uses one transactional RPC (`crm_snapshot`) for consistent cross-table reads.

Backend MFA hardening in progress: added MFA_REQUIRED (401) and RLS assurance enforcement for verified factors. Login will return `{ requiresMfa: true, factorId, challengeId }` after a valid password when TOTP is configured; frontend should then collect the six-digit code and POST `/api/auth/mfa` with `{ factorId, challengeId, code }`. Success returns `{ authenticated: true }`. Please handle MFA_REQUIRED in command layout by redirecting to /login. This prevents a configured MFA factor being bypassed through a direct Supabase call.

Backend final verification (20:06 EDT): all 6 SQL migrations apply cleanly; 52 backend tests pass (18 real DB + 34 unit/API/auth/file), seed applies twice, generated types match schema; TypeScript, ESLint, main test suite and production build pass. Main `npm test` intentionally skips the DB suite without TEST_DATABASE_URL; the disposable PostgreSQL runner ran it separately. Connected Supabase list_projects and Vercel list_teams both returned empty, so no hosted deployment was attempted. Added .github/workflows/verify.yml and backend operations/rules docs. Please finish frontend MFA challenge handling/batched health and use actual backend source provenance field; no backend secrets may be public.

Backend handoff is now at docs/backend-handoff.md. Current result: 53 backend tests = 18 real PostgreSQL integration tests + 35 unit/API/auth/file tests. No hosted deployment is claimed. Remaining frontend MFA integration was handed off as board item 545344af-7871-4f4f-90e1-249db963c1c3; hosted environment setup is reported as sourceEvent web-hosted-environments. The temporary initial PostgreSQL server has been stopped; test runner clusters always clean up themselves.

## Release durability requirement

The website must be handed off as an operable system, not a one-time demo that depends on Liam returning for routine maintenance. Before production release, both lanes must provide:

- CI verification on every change: strict TypeScript, lint, unit/API tests, real PostgreSQL/RLS tests, production build, and browser smoke coverage.
- Safe operational recovery: repeatable migrations, seed/test isolation, rollback or conflict handling for every mutation, idempotency, backups, and a documented restore path.
- Runtime resilience: structured error handling, health/configuration checks, observable logs with secrets redacted, actionable alerts, and graceful empty/offline/unauthorized states.
- Dependency and deployment hygiene: lockfile-based installs, reproducible Vercel builds, environment-variable validation, security updates, and a release checklist that blocks demo mode or missing backend configuration in production.
- Ownership handoff: concise runbooks for deploy, rollback, database recovery, auth/MFA incidents, storage access, and dependency updates; no fake controls or fixture fallback in live mode.

“No maintenance” means routine operation is automated and documented; it does not mean security patches, provider changes, or incident response can be ignored.
