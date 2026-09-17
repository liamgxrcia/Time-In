# Frontend architecture

Native SwiftUI multiplatform app, minimum macOS 14 and iOS/iPadOS 17. XcodeGen project.yml is the reproducible project source; the generated Xcode project is committed alongside it. Only the installed Xcode 27 beta is available for validation.

App owns authentication, persistent production repository, and injected platform services. Each window owns its navigation router; @SceneStorage restores destination and person selection. macOS/iPad use a native split view. iPhone uses Today, Clients, Tasks, Search and More tabs with navigation stacks. A command palette and focused scene commands share the same routing actions.

CRMCore remains the domain authority. CRMPlatform ApplicationModel owns loaded snapshots, search, queue and mutation errors. Local view state owns forms. All durable writes go through CRMService's atomic repository commands; lifecycle/approval rules are never copied into views. Preview data is opt-in, deterministic and in-memory. Production never seeds fictional records.

DesignSystem contains semantic palette, spacing, type, initials avatars, status, next action, empty and error components. Selected serif headings contrast with native system text. Native sidebar, toolbar, sheet and menu materials are preserved. No custom glass is necessary. Motion is limited to native navigation; no looping or spring animations.

Features are focused view files for Today, people/workspace, pipeline, onboarding, tasks, referrals, scripts, import, reports, operations and settings. Snapshot-derived report calculations belong to cached presentation state, not row body rendering.

The current backend is local-only. The UI must not claim pending cloud upload, successful synchronization, remote session revocation or provider connection. Those remain R2/backend contracts. LocalAuthentication provides the local privacy gate, not a server identity or MFA system.
