# Web backend architecture — platform override

The user's latest instruction supersedes the Apple build brief. Native code is retired under `legacy/apple-prototype/` and is not a runtime dependency. Preserve the lifecycle, deterministic Today scoring, explainable health, conservative CSV matching, idempotency and tests as business specifications; rewrite persistence, auth, files, notifications and repository contracts.

## Runtime

Next.js App Router (stable npm release), server-only TypeScript, Supabase Auth, Supabase-managed PostgreSQL, private Supabase Storage and Vercel. No Edge Function is needed for synchronous CRM use cases. Google Calendar uses a server-managed, read-only OAuth connection with encrypted token storage and a ten-second upstream timeout. Notifications and the offline draft queue remain deferred; no background sync guarantee is implied.

## Trust boundaries

- Browser may hold the public Supabase URL/publishable key only.
- Server creates a cookie-backed user client and validates the user with Supabase Auth; CEO membership is checked at each privileged boundary.
- All business tables have RLS. Only the one provisioned CEO can read their records. There is no user-accessible membership enrollment.
- Authenticated users receive SELECT only on business tables. SQL RPCs perform mutations after checking identity, CEO membership, ownership, revision, idempotency, rate limits and invariants. Direct stage writes are denied even using the public Supabase API.
- SECURITY DEFINER functions have an empty search_path, explicit schema references and restricted execute grants. Private helpers are not exposed.
- The service-role client is server-only and is used only for signed storage operations after explicit authorization, and pre-auth rate limiting. Ordinary business mutations run with the user JWT.
- Audit and lifecycle history are immutable and created in the same transaction as each successful mutation. Notes/contact contents are excluded from audit metadata and logs.

## Datastore

Separate relational Person, Organization, LeadProfile, ClientAccount, OnboardingCase, Activity, Task, Script, ScriptVersion, Referral, FileAgreement, RelationshipEdge, IntegrationConnection, AuditEvent, ImportBatch and LifecycleHistory tables. Owner-qualified foreign keys prevent cross-owner references. PostgreSQL is authoritative; transaction locks and expected revisions prevent lost writes.

## Environments

Local database tests use an isolated PostgreSQL cluster and minimal Supabase auth/storage schema harness. Staging and production use different Supabase projects, storage, CEO users and Vercel environment variables. Real GoTrue sessions and Storage delivery additionally require deployed Supabase integration verification.
