import Foundation

public enum HealthState: String, Codable, CaseIterable, Sendable { case strong, stable, needsAttention, atRisk, unknown
    public var label: String { switch self { case .strong: "Strong"; case .stable: "Stable"; case .needsAttention: "Needs Attention"; case .atRisk: "At Risk"; case .unknown: "Unknown" } }
}
public struct HealthResult: Equatable, Sendable {
    public let calculated: HealthState
    public let override: HealthOverride?
    public let factors: [String]
    public let evaluatedAt: Date
    public var state: HealthState { override?.state ?? calculated }
    public var label: String { state.label }
    public var explanation: String { factors.joined(separator: "; ") + (override.map { "; CEO override: \($0.reason)" } ?? "") }
    public var symbol: String { state == .atRisk ? "exclamationmark.shield" : state == .needsAttention ? "clock.badge.exclamationmark" : "heart.text.clipboard" }
    public var suggestedAction: String { [.atRisk, .needsAttention, .unknown].contains(state) ? "Review the relationship and schedule contact" : "Maintain the next planned review" }
}
public struct HealthEngine: RelationshipHealthService {
    public init() {}
    public func evaluate(_ person: Person, in database: Database, at: Date) -> HealthResult {
        let days = person.lastContactAt.map { max(0, Int(at.timeIntervalSince($0) / 86400)) }
        let overdue = database.tasks.values.filter { database.canonicalID($0.personID) == person.id && $0.status == .open && $0.dueAt < at }.count
        var factors: [String] = []; var severity = 0
        if let days { factors.append("Last meaningful contact \(days) days ago"); if days > 60 { severity = 3 } else if days > 30 { severity = 2 } }
        else { factors.append("No meaningful contact recorded") }
        if overdue > 0 { factors.append("\(overdue) overdue commitments"); severity = max(severity, overdue >= 3 ? 3 : 2) }
        if let client = person.client {
            if !client.risks.isEmpty { factors.append("\(client.risks.count) unresolved risks"); severity = 3 }
            if let review = client.reviewAt, review < at { factors.append("Client review is overdue"); severity = max(severity, 2) }
        }
        if let onboarding = person.onboarding, onboarding.decision == .pending, onboarding.blockers.contains(where: { !$0.satisfied }) { factors.append("Onboarding has unresolved blockers"); severity = max(severity, 2) }
        let calculated: HealthState = severity == 3 ? .atRisk : severity == 2 ? .needsAttention : days == nil ? .unknown : days! <= 14 ? .strong : .stable
        return HealthResult(calculated: calculated, override: person.client?.healthOverride, factors: factors, evaluatedAt: at)
    }
}
public enum QueueCategory: String, Codable, Sendable { case overdueFollowUp, dueToday, onboardingBlocker, overdueCommitment, relationship, review, stalled, missingAction, risk, referral }
public struct QueueItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let category: QueueCategory
    public let score: Int
    public let reason: String
    public let date: Date
    public let personID: UUID
    public let taskID: UUID?
    public let recommendedAction: String
    public var destination: String { "timein://person/\(personID.uuidString)" }
    public var accessibleLabel: String { "\(reason). \(recommendedAction)" }
}
public struct TodayEngine: TodayQueueService {
    public init() {}
    public func queue(in database: Database, at: Date, calendar: Calendar) -> [QueueItem] {
        var result: [QueueItem] = []
        let people = database.visiblePeople.filter { !$0.stage.isTerminal }
        let tasksByPerson = Dictionary(grouping: database.tasks.values.filter { $0.status == .open }, by: { database.canonicalID($0.personID) })
        let referralsByPerson = Dictionary(grouping: database.referrals.values, by: { database.canonicalID($0.personID) })
        func item(_ person: Person, _ category: QueueCategory, _ base: Int, _ date: Date, _ reason: String, _ action: String, taskID: UUID? = nil) -> QueueItem {
            let age = min(30, max(0, Int(at.timeIntervalSince(date) / 86400)))
            return QueueItem(id: "\(person.id):\(category.rawValue):\(taskID?.uuidString ?? "person")", category: category, score: base + person.priority.rawValue * 10 + age, reason: reason, date: date, personID: person.id, taskID: taskID, recommendedAction: action)
        }
        for person in people {
            if let next = person.nextAction {
                if next.dueAt < calendar.startOfDay(for: at) { result.append(item(person, .overdueFollowUp, 90, next.dueAt, "Next action is overdue", "Complete or reschedule \(next.type.rawValue)")) }
                else if calendar.isDate(next.dueAt, inSameDayAs: at) { result.append(item(person, .dueToday, 70, next.dueAt, "\(next.type.rawValue.capitalized) due today", "Open relationship context")) }
            } else if [.followUp, .pendingSignup].contains(person.stage) { result.append(item(person, .missingAction, 100, person.stageEnteredAt, "Required next action is missing", "Schedule the next action")) }
            if let onboarding = person.onboarding, onboarding.decision == .pending {
                if onboarding.blockers.contains(where: { !$0.satisfied }) { result.append(item(person, .onboardingBlocker, 85, onboarding.dueAt, "Onboarding has unresolved blockers", "Review the onboarding checklist")) }
            }
            for task in tasksByPerson[person.id] ?? [] where task.dueAt < at { result.append(item(person, .overdueCommitment, 95 + task.priority.rawValue * 5, task.dueAt, "Commitment is overdue", "Complete or reschedule the commitment", taskID: task.id)) }
            if let client = person.client, person.stage == .active {
                if !client.risks.isEmpty { result.append(item(person, .risk, 110, person.stageEnteredAt, "Unresolved client risk", "Review the recorded risks")) }
                if let review = client.reviewAt, review <= at.addingTimeInterval(7 * 86400) { result.append(item(person, .review, 60, review, "Client review is upcoming or overdue", "Prepare a relationship review")) }
                if person.lastContactAt.map({ at.timeIntervalSince($0) > 30 * 86400 }) ?? true { result.append(item(person, .relationship, 75, person.lastContactAt ?? person.stageEnteredAt, "Client needs relationship attention", "Schedule meaningful contact")) }
            }
            if [.new, .followUp, .pendingSignup].contains(person.stage), at.timeIntervalSince(person.stageEnteredAt) > 14 * 86400 { result.append(item(person, .stalled, 50, person.stageEnteredAt, "No stage movement for more than 14 days", "Review status and next action")) }
            if person.stage == .new, let referral = referralsByPerson[person.id]?.min(by: { $0.at < $1.at }), person.nextAction?.dueAt ?? referral.at <= at { result.append(item(person, .referral, 65, referral.at, "Referral awaiting first contact", "Review source and contact preferences")) }
        }
        return result.sorted { $0.score != $1.score ? $0.score > $1.score : $0.date != $1.date ? $0.date < $1.date : $0.id < $1.id }
    }
}
public struct Recommendation: Equatable, Sendable {
    public let explanation: String
    public let action: String
    public let scriptID: UUID?
}
public struct RecommendationEngine: Sendable {
    public init() {}
    public func recommendation(for person: Person, in db: Database, at: Date) -> Recommendation {
        let script = db.scripts.values.filter { $0.stage == person.stage && $0.effectiveAt <= at && ($0.retirementAt == nil || $0.retirementAt! > at) }.sorted { $0.version == $1.version ? $0.id.uuidString < $1.id.uuidString : $0.version > $1.version }.first
        if person.communicationRestricted { return Recommendation(explanation: "Communication restrictions are recorded", action: "Review consent before any outreach", scriptID: nil) }
        if person.stage.isTerminal { return Recommendation(explanation: "This relationship is closed to active work", action: "Review history or explicitly reopen", scriptID: nil) }
        if person.stage == .pendingSignup { return Recommendation(explanation: "Onboarding approval remains a CEO decision", action: "Review required checklist items and blockers", scriptID: script?.id) }
        let health = HealthEngine().evaluate(person, in: db, at: at)
        return Recommendation(explanation: health.explanation, action: person.nextAction.map { "Prepare the scheduled \($0.type.rawValue)" } ?? health.suggestedAction, scriptID: script?.id)
    }
}
public struct SearchResult: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let kind: String
    public let score: Int
    public let personID: UUID?
}
public struct LocalSearch: SearchService {
    public init() {}
    public func search(_ query: String, in database: Database) async throws -> [SearchResult] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        guard !needle.isEmpty else { return [] }
        var result: [SearchResult] = []
        func append(id: UUID, title: String, text: String, kind: String, personID: UUID?) {
            let name = title.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            let body = text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            if name.contains(needle) || body.contains(needle) { result.append(SearchResult(id: "\(kind):\(id)", title: title, kind: kind, score: name == needle ? 100 : name.hasPrefix(needle) ? 80 : name.contains(needle) ? 60 : 30, personID: personID)) }
        }
        for person in database.visiblePeople {
            try Task.checkCancellation()
            append(id: person.id, title: person.name, text: ([person.notes, person.stage.label] + person.emails + person.phones + person.tags).joined(separator: " "), kind: "Person", personID: person.id)
        }
        for org in database.organizations.values where org.metadata.archivedAt == nil { append(id: org.id, title: org.name, text: org.notes, kind: "Organization", personID: nil) }
        for task in database.tasks.values { append(id: task.id, title: task.title, text: task.evidence ?? "", kind: "Task", personID: database.canonicalID(task.personID)) }
        for activity in database.activities.values { append(id: activity.id, title: activity.summary, text: activity.kind.rawValue, kind: "Activity", personID: database.canonicalID(activity.personID)) }
        for script in database.scripts.values { append(id: script.id, title: script.name, text: script.content + " " + script.campaign, kind: "Script", personID: nil) }
        for file in database.files.values where file.archivedAt == nil { append(id: file.id, title: file.displayName, text: "", kind: "File", personID: database.canonicalID(file.personID)) }
        for referral in database.referrals.values { append(id: referral.id, title: database.people[database.canonicalID(referral.personID)]?.name ?? "Referral", text: referral.sourceNote, kind: "Referral", personID: database.canonicalID(referral.personID)) }
        try Task.checkCancellation()
        return result.sorted { $0.score == $1.score ? $0.id < $1.id : $0.score > $1.score }
    }
}
public struct OperationalIssue: Identifiable, Equatable, Sendable {
    public let id: String
    public let personID: UUID?
    public let severity: String
    public let explanation: String
    public let remediation: String
    public let detectedAt: Date
}
public struct Report: Codable, Equatable, Sendable {
    public let start: Date
    public let end: Date
    public let activeClients: Int
    public let newApprovals: Int
    public let closures: Int
    public let referrals: Int
    public let convertedReferrals: Int
    public let calls: Int
    public let dueTasks: Int
    public let onTimeTasks: Int
    public let stages: [String: Int]
    public let health: [String: Int]
    public let activityByDay: [Date: Int]
    public var followUpCompletionRate: Double? { dueTasks == 0 ? nil : Double(onTimeTasks) / Double(dueTasks) }
}
public struct ReportingEngine: Sendable {
    public init() {}
    /// Interval is half-open [start, end); counts labelled current are evaluated at `at`.
    public func report(in db: Database, start: Date, end: Date, at: Date, calendar: Calendar) throws -> Report {
        guard start < end else { throw CRMError.validation("Choose an end date after the start date.") }
        func contains(_ date: Date) -> Bool { date >= start && date < end }
        let people = db.visiblePeople
        let activities = db.activities.values.filter { contains($0.at) }
        let dueTasks = db.tasks.values.filter { $0.status != .cancelled && contains($0.dueAt) }
        let referrals = db.referrals.values.filter { contains($0.at) }
        let stages = Dictionary(grouping: people, by: { $0.stage.rawValue }).mapValues(\.count)
        let health = Dictionary(grouping: people.filter { $0.stage == .active }, by: { HealthEngine().evaluate($0, in: db, at: at).state.rawValue }).mapValues(\.count)
        return Report(start: start, end: end, activeClients: people.filter { $0.stage == .active }.count, newApprovals: activities.filter { $0.toStage == .active && $0.fromStage == .pendingSignup }.count, closures: activities.filter { $0.toStage == .closed }.count, referrals: referrals.count, convertedReferrals: referrals.filter { db.people[db.canonicalID($0.personID)]?.client != nil }.count, calls: activities.filter { $0.kind == .call }.count, dueTasks: dueTasks.count, onTimeTasks: dueTasks.filter { $0.status == .completed && ($0.completedAt ?? .distantFuture) <= $0.dueAt }.count, stages: stages, health: health, activityByDay: Dictionary(grouping: activities, by: { calendar.startOfDay(for: $0.at) }).mapValues(\.count))
    }
    public func issues(in db: Database, at: Date) -> [OperationalIssue] {
        var result: [OperationalIssue] = []
        func add(_ id: String, _ person: UUID?, _ severity: String, _ explanation: String, _ remediation: String) { result.append(OperationalIssue(id: id, personID: person, severity: severity, explanation: explanation, remediation: remediation, detectedAt: at)) }
        for p in db.visiblePeople {
            if [.followUp, .pendingSignup].contains(p.stage), p.nextAction == nil { add("action:\(p.id)", p.id, "high", "Missing required next action", "Schedule an action") }
            if p.emails.isEmpty && p.phones.isEmpty { add("contact:\(p.id)", p.id, "normal", "No contact method", "Add a permitted contact method") }
            if let o = p.onboarding, o.decision == .pending {
                if o.dueAt < at { add("onboarding:\(p.id)", p.id, "high", "Onboarding is overdue", "Review due date and next action") }
                if !o.blockers.allSatisfy(\.satisfied) { add("blocker:\(p.id)", p.id, "high", "Onboarding is blocked", "Resolve or explicitly waive blockers") }
            }
            if p.stage == .active && p.onboarding?.decision != .approved { add("lifecycle:\(p.id)", p.id, "high", "Active record lacks approval", "Review lifecycle history") }
        }
        for file in db.files.values where file.archivedAt == nil {
            if let expiry = file.expiresAt, expiry <= at.addingTimeInterval(30 * 86400) { add("file:\(file.id)", db.canonicalID(file.personID), "normal", "Agreement expires within 30 days or has expired", "Review the agreement") }
        }
        for connection in db.integrations.values where connection.health == .warning { add("integration:\(connection.id)", nil, "high", "Integration needs attention", "Review connection permissions and status") }
        return result.sorted { $0.id < $1.id }
    }
}
