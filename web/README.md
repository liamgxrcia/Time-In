# BonusHub web application

BonusHub is a responsive, CEO-only client relationship command centre built with Next.js 16, React 19, strict TypeScript, Tailwind CSS 4, TanStack Query, React Hook Form, Zod, Radix primitives, Recharts, Lucide, Vitest, and Playwright.

## Local development

Production data requires the configured Supabase backend and an explicitly provisioned CEO account. For a deterministic non-production review:

```bash
npm install
NEXT_PUBLIC_DEMO_MODE=true NEXT_PUBLIC_APP_ENV=local npm run dev
```

Demo mode is rejected unless `NEXT_PUBLIC_APP_ENV` is `local`, `preview`, or `test`. It is never used as a fallback for backend, session, or network failures.

## Verification

```bash
npm run typecheck
npm run lint
npm test
NEXT_PUBLIC_DEMO_MODE=true NEXT_PUBLIC_APP_ENV=test npm run build
npx playwright install chromium webkit firefox
npm run test:e2e
```

Set `TEST_DATABASE_URL` to run the PostgreSQL RLS and transactional integration tests; otherwise they skip explicitly. Vercel should use this directory as its project root. Configure the environment values documented in `.env.example` and `../docs/backend-handoff.md`.

The API contract is `src/contracts/crm.ts`; browser code never writes database tables directly. Read `../docs/frontend-contract.md` for authentication, error, retry, and mutation semantics.
