import Foundation

public enum CRMError: Error, Equatable, Sendable, LocalizedError {
    case validation(String), missingNextAction, invalidTransition, onboardingIncomplete, notFound, conflict
    case duplicate, malformedCSV, unsupportedEncoding, persistence, permissionDenied, fileAccess, notification, authentication, sync, rollbackConflict
    public var title: String {
        switch self {
        case .conflict, .rollbackConflict: "Changes need review"
        case .permissionDenied, .authentication: "Access required"
        default: "Unable to complete action"
        }
    }
    public var errorDescription: String? {
        switch self {
        case .validation(let message): message
        case .missingNextAction: "Choose a next-action type and date before saving."
        case .invalidTransition: "This lifecycle change is not valid from the current stage."
        case .onboardingIncomplete: "Complete or explicitly waive required items and blockers before approval."
        case .notFound: "The record is no longer available."
        case .conflict: "The record changed since it was loaded. Your change was not saved."
        case .duplicate: "A matching record already exists. Review it before continuing."
        case .malformedCSV: "The CSV has missing headers, inconsistent columns, or invalid quoting."
        case .unsupportedEncoding: "Save the file as UTF-8 or UTF-16 CSV and try again."
        case .persistence: "The local change could not be saved. Existing data has been preserved."
        case .permissionDenied: "Permission has not been granted for this operation."
        case .fileAccess: "The selected file could not be read or written safely."
        case .notification: "The reminder could not be scheduled. The task remains saved."
        case .authentication: "Device authentication did not complete."
        case .sync: "Cloud access is unavailable. Local data remains on this device."
        case .rollbackConflict: "Some imported records have changed or gained related work. Review them before rollback."
        }
    }
    public var recovery: String {
        switch self {
        case .conflict, .rollbackConflict, .duplicate: "Reload the record and review the latest information."
        case .authentication, .permissionDenied: "Check device permissions and try again."
        default: "Review the information and retry. If this continues, keep your original source data."
        }
    }
}

/// Atomic compare-and-swap boundary. Implementations must leave the old state intact on failure.
@MainActor public protocol CRMRepository: AnyObject {
    func read() throws -> Database
    func commit(_ updated: Database, replacing expected: Database) throws
}
@MainActor public final class InMemoryRepository: CRMRepository {
    private var database: Database
    public init(_ database: Database = Database()) { self.database = database }
    public func read() -> Database { database }
    public func commit(_ updated: Database, replacing expected: Database) throws {
        guard database == expected else { throw CRMError.conflict }
        try Integrity.validate(updated, replacing: expected)
        database = updated
    }
}
public enum Integrity {
    public static func validate(_ updated: Database, replacing old: Database) throws {
        for (id, item) in old.audit where updated.audit[id] != item { throw CRMError.validation("Audit history cannot be changed.") }
        for (id, item) in old.activities where updated.activities[id] != item { throw CRMError.validation("Timeline history cannot be changed.") }
        for (id, item) in old.scripts where updated.scripts[id] != item { throw CRMError.validation("Publish a new script version instead of changing history.") }
        for person in updated.people.values {
            guard !person.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw CRMError.validation("A name is required.") }
            // Existing imported exceptions remain readable; every changed record must be valid.
            if old.people[person.id] != person, person.mergedInto == nil, person.metadata.archivedAt == nil {
                if person.stage == .followUp && person.nextAction == nil { throw CRMError.missingNextAction }
                if person.stage == .active && (person.onboarding?.decision != .approved || person.client == nil) { throw CRMError.onboardingIncomplete }
            }
            if let org = person.organizationID, updated.organizations[org] == nil { throw CRMError.notFound }
            if let target = person.mergedInto, updated.people[target] == nil || target == person.id { throw CRMError.conflict }
        }
        for task in updated.tasks.values {
            guard updated.people[task.personID] != nil else { throw CRMError.notFound }
            if let recurrence = task.recurrence, recurrence.interval < 1 || recurrence.interval > 365 { throw CRMError.validation("Invalid recurrence interval.") }
        }
        for referral in updated.referrals.values {
            guard updated.people[referral.personID] != nil, updated.people[referral.referrerID] != nil else { throw CRMError.notFound }
        }
        for file in updated.files.values { guard updated.people[file.personID] != nil else { throw CRMError.notFound } }
    }
}
@MainActor public protocol LifecycleService {
    func transition(_ id: UUID, to: Stage, nextAction: NextAction?, reason: String?, at: Date, operationID: UUID) throws
}
public protocol TodayQueueService: Sendable { func queue(in database: Database, at: Date, calendar: Calendar) -> [QueueItem] }
public protocol RelationshipHealthService: Sendable { func evaluate(_ person: Person, in database: Database, at: Date) -> HealthResult }
public protocol SearchService: Sendable { func search(_ query: String, in database: Database) async throws -> [SearchResult] }
@MainActor public protocol NotificationService {
    func requestPermission() async throws -> Bool
    func reconcile(_ tasks: [CRMTask], at: Date) async throws
}
public enum SyncState: String, Codable, Sendable { case local, syncing, synchronized, recoverableError }
public struct SyncStatus: Equatable, Sendable {
    public let state: SyncState
    public let explanation: String
    public var label: String { state == .local ? "On this device" : state == .recoverableError ? "Cloud needs attention" : state.rawValue.capitalized }
    public init(state: SyncState, explanation: String) { self.state = state; self.explanation = explanation }
}
@MainActor public protocol SyncStatusService { func status() async -> SyncStatus }
