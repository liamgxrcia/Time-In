# Architecture decision record — 2026-09-16

The repository initially contained only a README and coordination files. There was no Xcode project, SwiftUI frontend, dependency manifest, data model, entitlement, or test to preserve.

The attached backend brief explicitly selects native Apple platforms, superseding the PRD's web delivery assumption. The PRD remains the authority for business scope and release sequencing. Minimum versions are iOS/iPadOS 17 and macOS 14. The installed Xcode is 27.0 (prerelease); use its bundled Swift compiler, with Swift 6 language checking.

## Boundaries

- CRMCore: Foundation-only Codable value models, rules, typed failures, repository/service contracts, commands and deterministic queries.
- CRMData: versioned SwiftData storage, transactional unit of work and isolated preview fixtures.
- CRMPlatform: LocalAuthentication, UserNotifications, private CloudKit account status and observable presentation coordinator.
- App: small SwiftUI integration host. A complete product frontend was not supplied.

One person aggregate holds lifecycle, next action, onboarding and client-service context. Independent tasks, immutable activities, audit events, referrals, scripts, organizations, files, edges and integration metadata use durable UUID references. No employee or financial/access-account model exists. The implicit actor is the sole device owner; biometrics/passcode gate local access and do not replace iCloud authorization.

Mutations execute against a value snapshot, validate first, then atomically commit only changed rows with optimistic revisions. Views cannot edit repository state in place. Activity/audit records and published scripts are append-only. Commands accept stable operation IDs; successful retries return without repeating side effects. Audit summaries contain operation names, identifiers and stage metadata, not note bodies/contact details.

CloudKit compatibility is necessary but does not prove conflict-safe cross-device synchronization. Local storage is the default until signed device verification and multi-device conflict handling pass. No UI may label data synchronized solely because a local save succeeded. No destructive migration fallback is permitted.

## Implementation sequence

1. Domain models, protocols, lifecycle/onboarding, tasks, audit and deterministic rules with unit tests.
2. Versioned SwiftData persistence, CSV preview/commit/rollback, merge, queries and fixtures with integration tests.
3. Native host, permission-aware adapters, macOS/iOS compilation and engineering handoff.

Fictional fixtures must be opt-in and isolated from real stores. Production starts empty. Cloud provisioning, security/retention policy and approved onboarding content remain deployment inputs, not reasons to block local implementation.
