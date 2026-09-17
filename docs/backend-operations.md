# Supabase / Vercel operations

## Environment separation

Use separate Supabase projects for staging and production. Use separate CEO accounts, auth URL allowlists, private storage and Vercel environment values. Never copy production data into local fixtures. Vercel project root is `web`; build command is `npm run build`. Preview deployments must use the staging project and an explicitly approved APP_ORIGIN. Never set production secrets in NEXT_PUBLIC variables.

Required environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: browser-safe project identification.
- `SUPABASE_SERVICE_ROLE_KEY`: encrypted server-only Vercel environment variable. Used after authorization for private signed file operations and login rate limiting. Never imported by a Client Component.
- `APP_ORIGIN`: exact HTTPS origin in staging/production; http://localhost:3000 locally.
- `APP_ENV`: local, staging or production.
- `RATE_LIMIT_SECRET`: independent random secret, at least 32 characters, used for HMAC login buckets. Rotate in server environment only.
- `BONUSHUB_ADMIN_USERNAME`: the public login identifier for the single provisioned CEO; never store the password in source or `NEXT_PUBLIC_*` variables.
- `BONUSHUB_ADMIN_EMAIL`: the private Supabase Auth email mapped from the public username.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Google OAuth web-client credentials; keep the secret server-only.
- `GOOGLE_REDIRECT_URI`: exact deployed callback URL, `/api/integrations/google/callback`, registered in Google Cloud OAuth settings.
- `INTEGRATION_ENCRYPTION_KEY`: random 32-byte key encoded as 64 hex or standard base64 characters; used to encrypt Google access and refresh tokens at rest.

Apply SQL through Supabase CLI `supabase db push` after reviewing `supabase migration list`. CI must run fresh-database tests first. Production provisioning is a separate operator action: create/invite exactly one user via Supabase Auth, disable public signup, then insert that Auth UUID into `private.ceo_access(user_id)`. The singleton constraint rejects a second CEO. The browser cannot enroll itself. Use Supabase MFA settings as the next auth hardening step; no custom password store exists.

Storage bucket `agreements` is private. There are no browser object policies; backend signed endpoints authorize CEO and metadata ownership. Upload registration limits types and size, then a signed upload is issued. Finalization checks actual storage metadata in PostgreSQL. Downloads expire after 60 seconds. Supabase signed upload tokens use the provider's lifetime (currently two hours); only pending pre-authorized object paths are issued, with upsert disabled. Preview inline only after content safety review; downloads use attachment disposition.

## Authentication and sessions

Authentication is server-managed with Supabase SSR cookies configured HttpOnly, Secure in production, SameSite=Lax, path=/, plus same-origin validation for mutations. `getUser()` validates session status with Auth on each privileged request. Expired/invalid sessions return UNAUTHENTICATED. A public key or valid non-CEO account cannot read CRM records. Disable caching on all auth/CRM routes. The public BonusHub username maps server-side to the one private Supabase Auth email; login errors do not distinguish unknown identifiers from incorrect passwords or non-CEO membership. Google Calendar access is read-only, PKCE-protected, state-bound to the CEO session, time-limited, encrypted at rest, and refreshed only when the events endpoint needs it.

Auth uses Supabase rate limits plus a PostgreSQL HMAC email bucket of 10 attempts per 15 minutes. API limits are 120 mutations/minute, 30 file requests/minute and 300 reads/minute per CEO. These counters use a separate committed RPC at the HTTP boundary. PostgreSQL commands also cap successful direct RPC mutations. Edge/network abuse protection remains a deployment configuration (Supabase Auth and Vercel firewall), not an in-memory rate limiter.

## Backup and recovery

Before production: choose a Supabase plan with the agreed backup/PITR retention and enable PITR if required. Record RPO/RTO, retention and recovery owners; this implementation does not establish an SLA. Supabase database backups do not back up object bytes in Storage: maintain a separate versioned, encrypted copy of agreement objects and verify checksums/manifests. Keep environment configuration and migration history in version control, secrets in encrypted secret management.

Recovery drill: restore database into a new isolated project; restore object bytes into its private bucket; compare row counts, owner UUIDs, file metadata/object manifests, lifecycle histories, audit counts and latest idempotency operations. Provision the recovered CEO access only after Auth identity reconciliation. Test RLS with a non-CEO account, then exercise sign-in, timeline, file access and a reversible mutation before switching origins. Record actual recovery duration and data gap. Do not test destructive restore on the production project.

## Migration policy

Versioned SQL is additive by default. Review data backfills and locks on staging with a representative synthetic volume. Never edit a migration already deployed; issue a new migration. The current initial migrations may be revised before first deployment. No destructive fallback or automatic drop/reset exists in production code. Keep a pre-deploy restore point. Roll forward for schema defects unless a verified recovery procedure says otherwise.

## Test commands

From `web`: `node scripts/test-database.mjs` starts a disposable real PostgreSQL cluster, applies every migration, independently tests roles/RLS/concurrency, runs backend unit/API tests, seeds twice, generates database types, and shuts down/deletes only that temporary cluster. Set `PG_BIN` to the installed PostgreSQL bin directory (default Homebrew PostgreSQL 17). No Supabase secrets are needed for these tests.

`npx vitest run --config vitest.backend.config.mts tests/backend` runs the pure/service/API suite. `npx tsc --noEmit` and `npm run build` check TypeScript and production output. Real Supabase Auth refresh/cookie behavior, MFA, Storage delivery and signed URLs require staging credentials and an actual browser; mocked HTTP boundary tests are not a substitute.

## Known scope boundaries

Snapshot currently supports 2,000 rows per collection with explicit overflow errors. It uses owner indexes and one transactional snapshot RPC; the bootstrap endpoint is not a large-scale reporting warehouse. Replace broad bootstrap reads with paginated projections before exceeding the pilot cap. Person erasure governed by retention, provider OAuth, reminders, passkeys and offline conflict handling remain separate work. Notifications record consent preferences only and are not sent. Audit is application-immutable, not cryptographically tamper-evident against a database administrator.

Configured MFA is enforced at both server and RLS boundaries: a verified Supabase factor requires `aal2`. The login flow can challenge and verify TOTP. Set `private.ceo_access.require_mfa=true` to require aal2 before enrollment as a deployment policy (this intentionally locks out aal1 access until enrollment completes). Configure enrollment/recovery with the authorized CEO before requiring it. No recovery codes or TOTP secrets are stored in CRM tables. Actual MFA delivery must be verified on staging.

## R1 deployed configuration gate

Server client creation and mutation-origin checks now reject unsafe deployed configuration with a safe UNAVAILABLE response. In a production Node runtime (including Vercel previews), set APP_ENV to staging or production, APP_ORIGIN to a bare non-local HTTPS origin, an HTTPS Supabase URL, a publishable key (or legacy anon JWT) in the public-key variable, the encrypted server-only service credential, and RATE_LIMIT_SECRET of at least 32 characters. Demo flags must be off. Vercel preview requires APP_ENV=staging; Vercel production requires APP_ENV=production. A build without deployment secrets can succeed; runtime authorization fails closed until configured.

These checks cannot prove that staging and production URLs identify different hosted projects. Operators must verify separate project IDs and environment variable scopes in Vercel. Keep service/secret keys out of all NEXT_PUBLIC variables and never paste them into CRM records. Supabase documents that these keys bypass RLS and belong only on trusted servers: [API keys](https://supabase.com/docs/guides/getting-started/api-keys).
