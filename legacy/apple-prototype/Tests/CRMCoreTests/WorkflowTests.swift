import XCTest
@testable import CRMCore

@MainActor final class WorkflowTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    func setupPerson() throws -> (CRMService, Person) {
        let service = CRMService(repository: InMemoryRepository(), installationID: UUID())
        let person = Person(name: "Avery Example", at: now)
        try service.create(person, operationID: UUID())
        return (service, person)
    }
    func testFollowUpRequiresActionAndFailureIsAtomic() throws {
        let (service, person) = try setupPerson()
        let before = try service.snapshot()
        XCTAssertThrowsError(try service.transition(person.id, to: .followUp, at: now, operationID: UUID())) { XCTAssertEqual($0 as? CRMError, .missingNextAction) }
        XCTAssertEqual(try service.snapshot(), before)
        try service.transition(person.id, to: .followUp, nextAction: NextAction(.call, at: now), at: now, operationID: UUID())
        XCTAssertEqual(try service.snapshot().people[person.id]?.stage, .followUp)
        XCTAssertEqual(try service.snapshot().timeline(for: person.id).count, 1)
    }
    func testCallIsAtomicAndIdempotent() throws {
        let (service, person) = try setupPerson(); let operation = UUID()
        for _ in 0..<2 { try service.logActivity(person.id, kind: .call, summary: "Fictional conversation", outcome: .interested, nextAction: NextAction(.onboarding, at: now), at: now, operationID: operation) }
        let db = try service.snapshot()
        XCTAssertEqual(db.people[person.id]?.stage, .pendingSignup)
        XCTAssertEqual(db.timeline(for: person.id).count, 2)
        XCTAssertEqual(db.audit.count, 2)
        XCTAssertFalse(db.audit.values.contains { $0.action.contains("Fictional") })
    }
    func pending() throws -> (CRMService, Person, UUID) {
        let (service, person) = try setupPerson()
        try service.logActivity(person.id, kind: .call, summary: "Interested", outcome: .interested, nextAction: NextAction(.onboarding, at: now), at: now, operationID: UUID())
        let item = ChecklistItem(title: "Record consent")
        let onboarding = OnboardingCase(templateID: UUID(), version: 1, at: now, dueAt: now, items: [item])
        try service.startOnboarding(person.id, template: onboarding, at: now, operationID: UUID())
        return (service, person, item.id)
    }
    func testApprovalRequiresChecklistAndRationale() throws {
        let (service, person, item) = try pending()
        XCTAssertThrowsError(try service.decideOnboarding(person.id, approve: true, rationale: "Reviewed", at: now, operationID: UUID()))
        try service.completeChecklist(person.id, itemID: item, at: now, operationID: UUID())
        XCTAssertThrowsError(try service.decideOnboarding(person.id, approve: true, rationale: "  ", at: now, operationID: UUID()))
        try service.decideOnboarding(person.id, approve: true, rationale: "Complete", at: now, operationID: UUID())
        XCTAssertEqual(try service.snapshot().people[person.id]?.stage, .active)
        XCTAssertNotNil(try service.snapshot().people[person.id]?.client)
    }
    func testRejectionNeverApprovesAndCannotBeRewritten() throws {
        let (service, person, _) = try pending()
        try service.decideOnboarding(person.id, approve: false, rationale: "Not suitable", at: now, operationID: UUID())
        XCTAssertEqual(try service.snapshot().people[person.id]?.stage, .pendingSignup)
        XCTAssertNil(try service.snapshot().people[person.id]?.client)
        XCTAssertThrowsError(try service.transition(person.id, to: .active, at: now, operationID: UUID()))
        XCTAssertThrowsError(try service.decideOnboarding(person.id, approve: true, rationale: "Changed", at: now, operationID: UUID()))
    }
    func testWaiverIsAudited() throws {
        let (service, person, item) = try pending()
        try service.completeChecklist(person.id, itemID: item, waiverReason: "Previously documented consent", at: now, operationID: UUID())
        XCTAssertTrue(try service.snapshot().people[person.id]?.onboarding?.canApprove == true)
        XCTAssertTrue(try service.snapshot().audit.values.contains { $0.action == "onboarding.itemWaived" })
    }
    func testClosedCancelsOpenWorkAndReopeningPreservesHistory() throws {
        let (service, person) = try setupPerson()
        let task = CRMTask(personID: person.id, title: "Review", dueAt: now, at: now)
        try service.addTask(task, operationID: UUID())
        try service.transition(person.id, to: .closed, reason: "Relationship ended", at: now, operationID: UUID())
        XCTAssertEqual(try service.snapshot().tasks[task.id]?.status, .cancelled)
        try service.transition(person.id, to: .new, at: now, operationID: UUID())
        XCTAssertEqual(try service.snapshot().timeline(for: person.id).count, 2)
    }
    func testRecurrencePreservesCompletionEvidenceAndRetries() throws {
        let (service, person) = try setupPerson()
        var task = CRMTask(personID: person.id, title: "Monthly review", dueAt: now, at: now); task.recurrence = Recurrence(unit: .month)
        try service.addTask(task, operationID: UUID()); let operation = UUID()
        for _ in 0..<2 { try service.completeTask(task.id, evidence: "Reviewed", at: now, calendar: Calendar(identifier: .gregorian), operationID: operation) }
        let db = try service.snapshot()
        XCTAssertEqual(db.tasks.count, 2)
        XCTAssertEqual(db.tasks[task.id]?.evidence, "Reviewed")
        XCTAssertEqual(db.tasks.values.filter { $0.status == .open }.count, 1)
    }
    func testStaleContactEditIsRejected() throws {
        let (service, person) = try setupPerson()
        try service.updateContact(person.id, name: "Avery Updated", emails: [], phones: [], notes: "", expectedRevision: 0, at: now, operationID: UUID())
        XCTAssertThrowsError(try service.updateContact(person.id, name: "Stale", emails: [], phones: [], notes: "", expectedRevision: 0, at: now, operationID: UUID())) { XCTAssertEqual($0 as? CRMError, .conflict) }
    }
    func testMergePreservesReferralAndTimelineRedirects() throws {
        let (service, destination) = try setupPerson()
        let source = Person(name: "Duplicate", at: now); let referrer = Person(name: "Referrer", at: now)
        try service.create(source, operationID: UUID()); try service.create(referrer, operationID: UUID())
        try service.logActivity(source.id, kind: .note, summary: "Earlier note", at: now, operationID: UUID())
        let referral = Referral(referrerID: source.id, personID: referrer.id, at: now, sourceNote: "Permission recorded")
        try service.addReferral(referral, operationID: UUID())
        try service.merge(source.id, into: destination.id, at: now, operationID: UUID())
        let db = try service.snapshot()
        XCTAssertEqual(db.canonicalID(db.referrals[referral.id]!.referrerID), destination.id)
        XCTAssertTrue(db.timeline(for: destination.id).contains { $0.summary == "Earlier note" })
        XCTAssertEqual(db.people[source.id]?.mergedInto, destination.id)
    }
    func testPublishedScriptsAreImmutable() throws {
        let (service, _) = try setupPerson()
        let script = Script(name: "Introduction", stage: .new, content: "Ask permission to continue.", effectiveAt: now, changeNote: "Initial")
        try service.publishScript(script, operationID: UUID())
        var changed = script; changed.content = "Changed"
        XCTAssertThrowsError(try service.publishScript(changed, operationID: UUID()))
        var next = script; next.id = UUID(); next.version = 2; next.content = "Updated introduction"; next.changeNote = "Clearer wording"
        try service.publishScript(next, operationID: UUID())
        XCTAssertEqual(try service.snapshot().scripts.count, 2)
    }
    func testTodayIsDeterministicAndHealthIsExplained() throws {
        let (service, person) = try setupPerson()
        try service.transition(person.id, to: .followUp, nextAction: NextAction(.call, at: now.addingTimeInterval(-86400)), at: now, operationID: UUID())
        let db = try service.snapshot(); let engine = TodayEngine(); let calendar = Calendar(identifier: .gregorian)
        XCTAssertEqual(engine.queue(in: db, at: now, calendar: calendar), engine.queue(in: db, at: now, calendar: calendar))
        XCTAssertEqual(engine.queue(in: db, at: now, calendar: calendar).first?.category, .overdueFollowUp)
        let health = HealthEngine().evaluate(person, in: db, at: now)
        XCTAssertEqual(health.calculated, .unknown); XCTAssertFalse(health.explanation.isEmpty); XCTAssertFalse(health.label.isEmpty)
    }
    func testSearchAndReportEmptyDenominator() async throws {
        let (service, _) = try setupPerson(); let db = try service.snapshot()
        let results = try await LocalSearch().search("AVERY", in: db)
        XCTAssertEqual(results.first?.score, 80)
        let report = try ReportingEngine().report(in: db, start: now, end: now.addingTimeInterval(86400), at: now, calendar: .current)
        XCTAssertNil(report.followUpCompletionRate)
    }
}
