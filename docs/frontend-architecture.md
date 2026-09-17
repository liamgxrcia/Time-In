# Web frontend architecture

The active product is a desktop-first Next.js App Router application under `web/`. The prior native prototype is isolated in `legacy/apple-prototype/` and is excluded from all active commands.

## Runtime and routing

- Next.js owns URL-addressable destinations and nested layouts.
- The command-center shell uses a collapsible sidebar on wide screens, a compact tablet rail/drawer, and five primary phone destinations.
- The browser command palette opens with Command+K or Control+K and routes to destinations, people, and common actions.
- Next.js route handlers provide a typed BFF boundary. The OpenAPI document is authoritative for the web contract; generated TypeScript is checked into `src/lib/api/schema.ts`.

## State ownership

- TanStack Query owns remote server state, retries, stale indicators, invalidation, and reversible optimistic updates.
- URL state owns the current destination, filters, selected record, and list/detail navigation.
- React Hook Form and Zod own local form state and client validation. The server revalidates lifecycle transitions.
- Presentation state stays local to focused components; domain rules do not live in React views.

## Design system and accessibility

Semantic CSS variables define ink, charcoal, ivory, restrained gold, status, borders, focus, type, and spacing. Radix primitives provide accessible overlays and menus; Lucide is the only icon system. Recharts output includes plain-language summaries and accessible tabular fallbacks.

All main regions use semantic HTML, a skip link, visible focus, complete keyboard control, 44px coarse-pointer targets, and layouts that tolerate browser zoom. Motion is minimal and disabled through `prefers-reduced-motion`. Status always combines icon and text.

## Data states and safety

Every query surface uses the shared data boundary for loading, empty, recoverable error, unauthorized, offline, refreshing, and stale states. Optimistic mutations retain a snapshot and roll back on server rejection.

The UI is CEO-only. The schema contains relationship, communication, onboarding, task, referral, document metadata, script, audit, and reporting records. It contains no employee account, credential, wagering, money movement, lending, credit, interest, or promotion-extraction concepts.

## Deployment

`npm run verify` runs type checking, linting, unit/component tests, the production build, and Playwright checks. Vercel uses the `web/` directory as the project root. The PWA manifest and service worker provide install metadata and static-shell caching without presenting offline writes as synchronized.
