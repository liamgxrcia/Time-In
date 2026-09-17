import Foundation

@MainActor public final class CRMService: LifecycleService {
    public let repository: any CRMRepository
    public let installationID: UUID
    public init(repository: any CRMRepository, installationID: UUID) { self.repository = repository; self.installationID = installationID }
    public func snapshot() throws -> Database { try repository.read() }
    func transact(target: UUID, action: String, at: Date, operationID: UUID, _ body: (inout Database) throws -> Void) throws {
        let old = try repository.read()
        if old.audit.values.contains(where: { $0.operationID == operationID }) { return }
        var new = old
        try body(&new)
        let event = AuditEvent(targetID: target, at: at, action: action, operationID: operationID, installationID: installationID)
        new.audit[event.id] = event
        for id in new.people.keys where new.people[id] != old.people[id] {
            new.people[id]?.metadata.updatedAt = at
            new.people[id]?.metadata.revision = (old.people[id]?.metadata.revision ?? -1) + 1
        }
        try repository.commit(new, replacing: old)
    }
    static func person(_ id: UUID, in db: Database) throws -> Person {
        guard let person = db.people[id], person.mergedInto == nil, person.metadata.archivedAt == nil else { throw CRMError.notFound }
        return person
    }
    static func append(_ db: inout Database, id: UUID, at: Date, kind: ActivityKind, summary: String, operation: UUID, outcome: CallOutcome? = nil, scriptID: UUID? = nil, from: Stage? = nil, to: Stage? = nil) {
        let activity = Activity(personID: id, at: at, kind: kind, summary: summary, outcome: outcome, scriptID: scriptID, from: from, to: to, operationID: operation)
        db.activities[activity.id] = activity
    }
    public func create(_ person: Person, operationID: UUID) throws {
        try transact(target: person.id, action: "person.created", at: person.metadata.createdAt, operationID: operationID) { db in
            guard db.people[person.id] == nil else { throw CRMError.duplicate }
            guard person.stage == .new else { throw CRMError.invalidTransition }
            db.people[person.id] = person
        }
    }
    public func updateContact(_ id: UUID, name: String, emails: [String], phones: [String], notes: String, expectedRevision: Int, at: Date, operationID: UUID) throws {
        try transact(target: id, action: "person.updated", at: at, operationID: operationID) { db in
            var person = try Self.person(id, in: db)
            guard person.metadata.revision == expectedRevision else { throw CRMError.conflict }
            person.name = name; person.emails = emails; person.phones = phones; person.notes = notes; db.people[id] = person
        }
    }
    static func change(_ id: UUID, to stage: Stage, next: NextAction?, reason: String?, at: Date, operation: UUID, db: inout Database) throws {
        var person = try person(id, in: db)
        let previous = person.stage
        guard previous != stage else { throw CRMError.invalidTransition }
        let allowed: [Stage: Set<Stage>] = [
            .new: [.followUp, .pendingSignup, .notInterested, .closed],
            .followUp: [.pendingSignup, .paused, .notInterested, .closed],
            .pendingSignup: [.active, .followUp, .paused, .notInterested, .closed],
            .active: [.paused, .closed], .paused: [.followUp, .pendingSignup, .active, .closed, .notInterested],
            .notInterested: [.new, .followUp], .closed: [.new, .followUp]
        ]
        guard allowed[previous]?.contains(stage) == true else { throw CRMError.invalidTransition }
        let cleanReason = reason?.trimmingCharacters(in: .whitespacesAndNewlines)
        if stage == .followUp && next == nil { throw CRMError.missingNextAction }
        if stage == .pendingSignup && person.outcome != .interested { throw CRMError.validation("Record an interested conversation outcome first.") }
        if stage == .active {
            guard let onboarding = person.onboarding, onboarding.decision == .approved, onboarding.canApprove, onboarding.decidedAt != nil else { throw CRMError.onboardingIncomplete }
            if person.client == nil { person.client = ClientAccount(approvedAt: at) }
        }
        if [.paused, .notInterested, .closed].contains(stage) && (cleanReason?.isEmpty ?? true) { throw CRMError.validation("A reason is required for this stage.") }
        person.stage = stage; person.stageEnteredAt = at; person.reason = cleanReason
        person.nextAction = stage.isTerminal ? nil : next
        if stage == .paused { person.pausedUntil = next?.dueAt }
        if stage.isTerminal {
            for taskID in db.tasks.keys where db.tasks[taskID]?.personID == id && db.tasks[taskID]?.status == .open { db.tasks[taskID]?.status = .cancelled }
        }
        db.people[id] = person
        append(&db, id: id, at: at, kind: .stageChange, summary: "\(previous.label) → \(stage.label)", operation: operation, from: previous, to: stage)
    }
    public func transition(_ id: UUID, to: Stage, nextAction: NextAction? = nil, reason: String? = nil, at: Date, operationID: UUID) throws {
        try transact(target: id, action: "lifecycle.\(to.rawValue)", at: at, operationID: operationID) { db in
            try Self.change(id, to: to, next: nextAction, reason: reason, at: at, operation: operationID, db: &db)
        }
    }
    public func schedule(_ id: UUID, nextAction: NextAction, at: Date, operationID: UUID) throws {
        try transact(target: id, action: "nextAction.scheduled", at: at, operationID: operationID) { db in
            var person = try Self.person(id, in: db)
            guard !person.stage.isTerminal else { throw CRMError.invalidTransition }
            person.nextAction = nextAction; db.people[id] = person
            Self.append(&db, id: id, at: at, kind: .note, summary: "Next action scheduled", operation: operationID)
        }
    }
    public func logActivity(_ id: UUID, kind: ActivityKind, summary: String, outcome: CallOutcome? = nil, nextAction: NextAction? = nil, scriptID: UUID? = nil, at: Date, operationID: UUID) throws {
        try transact(target: id, action: "activity.\(kind.rawValue)", at: at, operationID: operationID) { db in
            var person = try Self.person(id, in: db)
            guard !person.stage.isTerminal else { throw CRMError.invalidTransition }
            if let scriptID, db.scripts[scriptID] == nil { throw CRMError.notFound }
            if kind == .call {
                guard let outcome else { throw CRMError.validation("Choose a call outcome.") }
                if outcome != .notInterested && nextAction == nil { throw CRMError.missingNextAction }
                person.outcome = outcome
                if outcome != .noAnswer { person.lastContactAt = at }
            } else if [.meeting, .message, .email].contains(kind) { person.lastContactAt = at }
            if let nextAction { person.nextAction = nextAction }
            db.people[id] = person
            Self.append(&db, id: id, at: at, kind: kind, summary: summary, operation: operationID, outcome: outcome, scriptID: scriptID)
            if kind == .call, person.stage != .active, let outcome {
                let target: Stage = outcome == .interested ? .pendingSignup : outcome == .notInterested ? .notInterested : .followUp
                if person.stage != target { try Self.change(id, to: target, next: nextAction, reason: outcome == .notInterested ? "Declined outreach" : nil, at: at, operation: operationID, db: &db) }
            }
        }
    }
    public func startOnboarding(_ id: UUID, template: OnboardingCase, at: Date, operationID: UUID) throws {
        try transact(target: id, action: "onboarding.started", at: at, operationID: operationID) { db in
            var person = try Self.person(id, in: db)
            guard person.stage == .pendingSignup, person.onboarding == nil, template.decision == .pending else { throw CRMError.invalidTransition }
            person.onboarding = template; db.people[id] = person
            Self.append(&db, id: id, at: at, kind: .onboarding, summary: "Onboarding started", operation: operationID)
        }
    }
    public func completeChecklist(_ id: UUID, itemID: UUID, waiverReason: String? = nil, at: Date, operationID: UUID) throws {
        try transact(target: id, action: waiverReason == nil ? "onboarding.itemCompleted" : "onboarding.itemWaived", at: at, operationID: operationID) { db in
            var person = try Self.person(id, in: db)
            guard var onboarding = person.onboarding, onboarding.decision == .pending else { throw CRMError.invalidTransition }
            if let waiverReason, waiverReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { throw CRMError.validation("Explain the waiver.") }
            if let index = onboarding.items.firstIndex(where: { $0.id == itemID }) {
                onboarding.items[index].completed = waiverReason == nil; onboarding.items[index].waiverReason = waiverReason
            } else if let index = onboarding.blockers.firstIndex(where: { $0.id == itemID }) {
                onboarding.blockers[index].completed = waiverReason == nil; onboarding.blockers[index].waiverReason = waiverReason
            } else { throw CRMError.notFound }
            person.onboarding = onboarding; db.people[id] = person
            Self.append(&db, id: id, at: at, kind: .onboarding, summary: waiverReason == nil ? "Checklist item completed" : "Checklist item explicitly waived", operation: operationID)
        }
    }
    public func decideOnboarding(_ id: UUID, approve: Bool, rationale: String, at: Date, operationID: UUID) throws {
        try transact(target: id, action: approve ? "onboarding.approved" : "onboarding.rejected", at: at, operationID: operationID) { db in
            var person = try Self.person(id, in: db)
            guard person.stage == .pendingSignup, var onboarding = person.onboarding, onboarding.decision == .pending else { throw CRMError.invalidTransition }
            guard !rationale.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw CRMError.validation("Record the decision rationale.") }
            if approve && !onboarding.canApprove { throw CRMError.onboardingIncomplete }
            onboarding.decision = approve ? .approved : .rejected; onboarding.decidedAt = at; onboarding.rationale = rationale
            person.onboarding = onboarding; db.people[id] = person
            Self.append(&db, id: id, at: at, kind: .decision, summary: approve ? "Onboarding approved" : "Onboarding rejected", operation: operationID)
            if approve { try Self.change(id, to: .active, next: NextAction(.review, at: at.addingTimeInterval(30 * 86400)), reason: nil, at: at, operation: operationID, db: &db) }
        }
    }
    public func addTask(_ task: CRMTask, operationID: UUID) throws {
        try transact(target: task.personID, action: "task.created", at: task.metadata.createdAt, operationID: operationID) { db in
            let person = try Self.person(task.personID, in: db)
            guard !person.stage.isTerminal, !task.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw CRMError.validation("Choose an active record and task title.") }
            guard db.tasks[task.id] == nil else { throw CRMError.duplicate }
            db.tasks[task.id] = task
        }
    }
    public func completeTask(_ id: UUID, evidence: String, at: Date, calendar: Calendar, operationID: UUID) throws {
        try transact(target: id, action: "task.completed", at: at, operationID: operationID) { db in
            guard var task = db.tasks[id], task.status == .open else { throw CRMError.notFound }
            guard !evidence.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw CRMError.validation("Record completion evidence.") }
            task.status = .completed; task.completedAt = at; task.evidence = evidence; task.metadata.updatedAt = at; task.metadata.revision += 1; db.tasks[id] = task
            Self.append(&db, id: task.personID, at: at, kind: .taskCompletion, summary: "Task completed", operation: operationID)
            if let recurrence = task.recurrence {
                var next = task; next.id = UUID(); next.dueAt = try recurrence.next(after: task.dueAt, calendar: calendar)
                next.metadata = Metadata(at: at, source: .system); next.status = .open; next.completedAt = nil; next.evidence = nil
                next.reminderAt = task.reminderAt.map { next.dueAt.addingTimeInterval($0.timeIntervalSince(task.dueAt)) }
                db.tasks[next.id] = next
            }
        }
    }
    public func snoozeTask(_ id: UUID, until: Date, at: Date, operationID: UUID) throws {
        try transact(target: id, action: "task.snoozed", at: at, operationID: operationID) { db in
            guard var task = db.tasks[id], task.status == .open, until > at else { throw CRMError.validation("Choose a future date for an open task.") }
            task.dueAt = until; task.reminderAt = task.reminderAt == nil ? nil : until; task.metadata.updatedAt = at; task.metadata.revision += 1; db.tasks[id] = task
        }
    }
    public func addReferral(_ referral: Referral, operationID: UUID) throws {
        try transact(target: referral.personID, action: "referral.created", at: referral.at, operationID: operationID) { db in
            _ = try Self.person(referral.referrerID, in: db)
            var person = try Self.person(referral.personID, in: db)
            guard referral.personID != referral.referrerID, !referral.sourceNote.isEmpty else { throw CRMError.validation("Record a distinct referrer and source or consent note.") }
            guard db.referrals[referral.id] == nil else { throw CRMError.duplicate }
            if person.stage == .new && person.nextAction == nil { person.nextAction = NextAction(.call, at: referral.at) }
            db.people[person.id] = person; db.referrals[referral.id] = referral
            Self.append(&db, id: person.id, at: referral.at, kind: .referral, summary: "Referral recorded", operation: operationID)
        }
    }
    public func publishScript(_ script: Script, operationID: UUID) throws {
        try transact(target: script.id, action: "script.published", at: script.effectiveAt, operationID: operationID) { db in
            let latest = db.scripts.values.filter { $0.familyID == script.familyID }.map(\.version).max() ?? 0
            guard script.version == latest + 1, db.scripts[script.id] == nil, !script.content.isEmpty, !script.changeNote.isEmpty else { throw CRMError.validation("Publish the next script version with content and a change note.") }
            db.scripts[script.id] = script
        }
    }
    public func archive(_ id: UUID, at: Date, operationID: UUID) throws {
        try transact(target: id, action: "person.archived", at: at, operationID: operationID) { db in
            var person = try Self.person(id, in: db)
            guard person.stage.isTerminal else { throw CRMError.validation("Close the record before archiving it.") }
            person.metadata.archivedAt = at; db.people[id] = person
        }
    }
    public func merge(_ sourceID: UUID, into destinationID: UUID, at: Date, operationID: UUID) throws {
        try transact(target: destinationID, action: "person.merged", at: at, operationID: operationID) { db in
            var source = try Self.person(sourceID, in: db); var destination = try Self.person(destinationID, in: db)
            guard sourceID != destinationID else { throw CRMError.duplicate }
            // Material controlled values require an explicit resolution before merging.
            guard source.stage == destination.stage, source.onboarding == nil, source.client == nil,
                  source.nextAction == nil || source.nextAction == destination.nextAction else { throw CRMError.conflict }
            destination.emails = Array(Set(destination.emails + source.emails)).sorted(); destination.phones = Array(Set(destination.phones + source.phones)).sorted()
            destination.tags = Array(Set(destination.tags + source.tags)).sorted()
            if !source.notes.isEmpty { destination.notes += (destination.notes.isEmpty ? "" : "\n") + source.notes }
            source.mergedInto = destinationID; source.metadata.archivedAt = at
            db.people[sourceID] = source; db.people[destinationID] = destination
            for id in db.tasks.keys where db.tasks[id]?.personID == sourceID { db.tasks[id]?.personID = destinationID }
            for id in db.files.keys where db.files[id]?.personID == sourceID { db.files[id]?.personID = destinationID }
            // Historical referrals, edges, activities and audit keep original IDs, resolved via canonicalID.
            Self.append(&db, id: destinationID, at: at, kind: .note, summary: "Duplicate record merged; source retained as redirect", operation: operationID)
        }
    }
}
