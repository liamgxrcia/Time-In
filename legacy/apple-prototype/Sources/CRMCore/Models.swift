import Foundation

public enum Stage: String, Codable, CaseIterable, Sendable {
    case new, followUp, pendingSignup, active, paused, notInterested, closed
    public var label: String {
        switch self {
        case .new: "New / Uncontacted"
        case .followUp: "Follow-Up"
        case .pendingSignup: "Pending Signup"
        case .active: "Approved / Active"
        case .paused: "Paused"
        case .notInterested: "Not Interested / Disqualified"
        case .closed: "Closed / Offboarded"
        }
    }
    public var isTerminal: Bool { self == .closed || self == .notInterested }
}
public enum ActionType: String, Codable, CaseIterable, Sendable { case call, message, meeting, review, onboarding }
public enum Priority: Int, Codable, Sendable { case low = 0, normal = 1, high = 2 }
public enum Source: String, Codable, Sendable { case manual, imported, referral, system }
public struct Metadata: Codable, Equatable, Sendable {
    public var createdAt: Date
    public var updatedAt: Date
    public var archivedAt: Date?
    public var revision: Int = 0
    public var schemaVersion: Int = 1
    public var source: Source
    public init(at: Date, source: Source = .manual) { createdAt = at; updatedAt = at; self.source = source }
}
public struct NextAction: Codable, Equatable, Sendable {
    public var type: ActionType
    public var dueAt: Date
    public init(_ type: ActionType, at: Date) { self.type = type; dueAt = at }
}
public enum Decision: String, Codable, Sendable { case pending, approved, rejected }
public struct ChecklistItem: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var title: String
    public var required: Bool
    public var completed: Bool = false
    public var waiverReason: String?
    public init(id: UUID = UUID(), title: String, required: Bool = true) { self.id = id; self.title = title; self.required = required }
    public var satisfied: Bool { completed || !(waiverReason?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) }
}
public struct OnboardingCase: Codable, Equatable, Sendable {
    public var templateID: UUID
    public var templateVersion: Int
    public var startedAt: Date
    public var dueAt: Date
    public var appointment: Date?
    public var items: [ChecklistItem]
    public var blockers: [ChecklistItem] = []
    public var decision: Decision = .pending
    public var decidedAt: Date?
    public var rationale: String?
    public init(templateID: UUID, version: Int, at: Date, dueAt: Date, items: [ChecklistItem]) {
        self.templateID = templateID; templateVersion = version; startedAt = at; self.dueAt = dueAt; self.items = items
    }
    public var canApprove: Bool { items.filter(\.required).allSatisfy(\.satisfied) && blockers.allSatisfy(\.satisfied) }
}
public struct HealthOverride: Codable, Equatable, Sendable {
    public var state: HealthState
    public var reason: String
    public var at: Date
    public init(state: HealthState, reason: String, at: Date) { self.state = state; self.reason = reason; self.at = at }
}
public struct ClientAccount: Codable, Equatable, Sendable {
    public var approvedAt: Date
    public var reviewAt: Date?
    public var risks: [String] = []
    public var serviceNotes: String = ""
    public var healthOverride: HealthOverride?
    public init(approvedAt: Date) { self.approvedAt = approvedAt }
}
public struct Person: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var metadata: Metadata
    public var name: String
    public var preferredName: String = ""
    public var emails: [String] = []
    public var phones: [String] = []
    public var organizationID: UUID?
    public var notes: String = ""
    public var tags: [String] = []
    public var consentNote: String = ""
    public var communicationRestricted: Bool = false
    public internal(set) var stage: Stage = .new
    public internal(set) var stageEnteredAt: Date
    public var priority: Priority = .normal
    public internal(set) var nextAction: NextAction?
    public internal(set) var lastContactAt: Date?
    public internal(set) var outcome: CallOutcome?
    public internal(set) var reason: String?
    public internal(set) var pausedUntil: Date?
    public internal(set) var onboarding: OnboardingCase?
    public internal(set) var client: ClientAccount?
    public internal(set) var mergedInto: UUID?
    public init(id: UUID = UUID(), name: String, at: Date, source: Source = .manual) {
        self.id = id; self.name = name; metadata = Metadata(at: at, source: source); stageEnteredAt = at
    }
}
public enum ActivityKind: String, Codable, Sendable { case call, message, email, meeting, note, stageChange, taskCompletion, referral, onboarding, file, decision }
public enum CallOutcome: String, Codable, CaseIterable, Sendable { case noAnswer, followUp, interested, notInterested, completed }
public struct Activity: Identifiable, Codable, Equatable, Sendable {
    public let id: UUID
    public var personID: UUID
    public let at: Date
    public let kind: ActivityKind
    public let summary: String
    public let outcome: CallOutcome?
    public let scriptID: UUID?
    public let fromStage: Stage?
    public let toStage: Stage?
    public let operationID: UUID
    public init(id: UUID = UUID(), personID: UUID, at: Date, kind: ActivityKind, summary: String, outcome: CallOutcome? = nil, scriptID: UUID? = nil, from: Stage? = nil, to: Stage? = nil, operationID: UUID) {
        self.id = id; self.personID = personID; self.at = at; self.kind = kind; self.summary = summary; self.outcome = outcome; self.scriptID = scriptID; fromStage = from; toStage = to; self.operationID = operationID
    }
}
public enum TaskStatus: String, Codable, Sendable { case open, completed, cancelled }
public enum RecurrenceUnit: String, Codable, Sendable { case day, week, month }
public struct Recurrence: Codable, Equatable, Sendable {
    public var unit: RecurrenceUnit
    public var interval: Int
    public init(unit: RecurrenceUnit, interval: Int = 1) { self.unit = unit; self.interval = interval }
    public func next(after date: Date, calendar: Calendar) throws -> Date {
        guard interval > 0, interval <= 365 else { throw CRMError.validation("Recurrence interval must be between 1 and 365.") }
        let component: Calendar.Component = unit == .day ? .day : unit == .week ? .weekOfYear : .month
        guard let next = calendar.date(byAdding: component, value: interval, to: date) else { throw CRMError.validation("Choose a valid recurrence date.") }
        return next
    }
}
public struct CRMTask: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var metadata: Metadata
    public var personID: UUID
    public var title: String
    public var dueAt: Date
    public var priority: Priority = .normal
    public var status: TaskStatus = .open
    public var recurrence: Recurrence?
    public var reminderAt: Date?
    public var completedAt: Date?
    public var evidence: String?
    public init(id: UUID = UUID(), personID: UUID, title: String, dueAt: Date, at: Date) { self.id = id; self.personID = personID; self.title = title; self.dueAt = dueAt; metadata = Metadata(at: at) }
}
public struct Organization: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var metadata: Metadata
    public var name: String
    public var notes: String
    public init(id: UUID = UUID(), name: String, notes: String = "", at: Date) { self.id = id; self.name = name; self.notes = notes; metadata = Metadata(at: at) }
}
public struct Script: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var familyID: UUID
    public var name: String
    public var stage: Stage
    public var campaign: String
    public var version: Int
    public var content: String
    public var disclosures: String
    public var effectiveAt: Date
    public var retirementAt: Date?
    public var changeNote: String
    public init(id: UUID = UUID(), familyID: UUID = UUID(), name: String, stage: Stage, campaign: String = "", version: Int = 1, content: String, disclosures: String = "", effectiveAt: Date, retirementAt: Date? = nil, changeNote: String) {
        self.id = id; self.familyID = familyID; self.name = name; self.stage = stage; self.campaign = campaign; self.version = version; self.content = content; self.disclosures = disclosures; self.effectiveAt = effectiveAt; self.retirementAt = retirementAt; self.changeNote = changeNote
    }
}
public struct Referral: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var referrerID: UUID
    public var personID: UUID
    public var at: Date
    public var sourceNote: String
    public init(id: UUID = UUID(), referrerID: UUID, personID: UUID, at: Date, sourceNote: String) { self.id = id; self.referrerID = referrerID; self.personID = personID; self.at = at; self.sourceNote = sourceNote }
}
public struct FileAgreement: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var personID: UUID
    public var displayName: String
    public var storageReference: String
    public var checksum: String
    public var version: Int = 1
    public var addedAt: Date
    public var expiresAt: Date?
    public var archivedAt: Date?
    public init(id: UUID = UUID(), personID: UUID, displayName: String, storageReference: String, checksum: String, at: Date, expiresAt: Date? = nil) { self.id = id; self.personID = personID; self.displayName = displayName; self.storageReference = storageReference; self.checksum = checksum; addedAt = at; self.expiresAt = expiresAt }
}
public struct RelationshipEdge: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var fromID: UUID
    public var toID: UUID
    public var explanation: String
    public var at: Date
    public init(id: UUID = UUID(), fromID: UUID, toID: UUID, explanation: String, at: Date) { self.id = id; self.fromID = fromID; self.toID = toID; self.explanation = explanation; self.at = at }
}
public enum ConnectionHealth: String, Codable, Sendable { case disconnected, healthy, warning }
public struct IntegrationConnection: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var provider: String
    public var health: ConnectionHealth
    public var lastSync: Date?
    public var errorCategory: String?
    public init(id: UUID = UUID(), provider: String, health: ConnectionHealth, lastSync: Date? = nil, errorCategory: String? = nil) { self.id = id; self.provider = provider; self.health = health; self.lastSync = lastSync; self.errorCategory = errorCategory }
}
public struct AuditEvent: Identifiable, Codable, Equatable, Sendable {
    public let id: UUID
    public let targetID: UUID
    public let at: Date
    public let action: String
    public let operationID: UUID
    public let installationID: UUID
    public let appVersion: String
    public init(id: UUID = UUID(), targetID: UUID, at: Date, action: String, operationID: UUID, installationID: UUID, appVersion: String = "1.0") { self.id = id; self.targetID = targetID; self.at = at; self.action = action; self.operationID = operationID; self.installationID = installationID; self.appVersion = appVersion }
}
public struct ImportBatch: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var at: Date
    public var created: [UUID: Person]
    public var rolledBackAt: Date?
    public init(id: UUID, at: Date, created: [UUID: Person]) { self.id = id; self.at = at; self.created = created }
}
public struct Database: Codable, Equatable, Sendable {
    public var people: [UUID: Person] = [:]
    public var organizations: [UUID: Organization] = [:]
    public var activities: [UUID: Activity] = [:]
    public var tasks: [UUID: CRMTask] = [:]
    public var scripts: [UUID: Script] = [:]
    public var referrals: [UUID: Referral] = [:]
    public var files: [UUID: FileAgreement] = [:]
    public var edges: [UUID: RelationshipEdge] = [:]
    public var integrations: [UUID: IntegrationConnection] = [:]
    public var audit: [UUID: AuditEvent] = [:]
    public var imports: [UUID: ImportBatch] = [:]
    public init() {}
    public var visiblePeople: [Person] { people.values.filter { $0.metadata.archivedAt == nil && $0.mergedInto == nil } }
    public func canonicalID(_ id: UUID) -> UUID {
        var cursor = id; var visited: Set<UUID> = []
        while let next = people[cursor]?.mergedInto, visited.insert(cursor).inserted { cursor = next }
        return cursor
    }
    public func timeline(for id: UUID) -> [Activity] {
        activities.values.filter { canonicalID($0.personID) == canonicalID(id) }.sorted { $0.at == $1.at ? $0.id.uuidString < $1.id.uuidString : $0.at > $1.at }
    }
}
