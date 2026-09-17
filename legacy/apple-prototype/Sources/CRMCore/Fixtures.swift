import Foundation

public enum Fixtures {
    public static let referenceDate = Date(timeIntervalSince1970: 1_789_574_400)
    public static func id(_ index: Int) -> UUID { UUID(uuidString: String(format: "00000000-0000-4000-8000-%012d", index))! }
    /// Pure fictional snapshot; never installed automatically in a production store.
    public static func database(at now: Date = referenceDate) -> Database {
        var db = Database()
        let names = ["Alex Rowan", "Jordan Ellis", "Taylor Morgan", "Casey Blake", "Riley Hart", "Drew Parker", "Sam Avery", "Morgan Reed", "Quinn Hayes", "Jamie Brook"]
        for (index, name) in names.enumerated() {
            var person = Person(id: id(index + 1), name: name, at: now.addingTimeInterval(-20 * 86400))
            person.emails = ["contact\(index + 1)@example.com"]
            db.people[person.id] = person
        }
        db.people[id(2)]?.stage = .followUp; db.people[id(2)]?.nextAction = NextAction(.call, at: now.addingTimeInterval(-2 * 86400))
        db.people[id(3)]?.stage = .followUp; db.people[id(3)]?.nextAction = NextAction(.call, at: now.addingTimeInterval(3600))
        var onboarding = OnboardingCase(templateID: id(100), version: 1, at: now.addingTimeInterval(-4 * 86400), dueAt: now.addingTimeInterval(86400), items: [ChecklistItem(id: id(101), title: "Record consent"), ChecklistItem(id: id(102), title: "Confirm service expectations")])
        onboarding.blockers = [ChecklistItem(id: id(103), title: "Awaiting agreement review")]
        db.people[id(4)]?.stage = .pendingSignup; db.people[id(4)]?.outcome = .interested; db.people[id(4)]?.onboarding = onboarding; db.people[id(4)]?.nextAction = NextAction(.onboarding, at: now)
        for index in [5, 8] {
            var approved = onboarding
            for item in approved.items.indices { approved.items[item].completed = true }
            approved.blockers = []; approved.decision = .approved; approved.decidedAt = now.addingTimeInterval(-10 * 86400); approved.rationale = "Fictional approved example"
            db.people[id(index)]?.stage = .active; db.people[id(index)]?.onboarding = approved
            db.people[id(index)]?.client = ClientAccount(approvedAt: approved.decidedAt!)
            db.people[id(index)]?.client?.reviewAt = now.addingTimeInterval(5 * 86400)
            db.people[id(index)]?.lastContactAt = now.addingTimeInterval(index == 5 ? -3 * 86400 : -75 * 86400)
        }
        db.people[id(8)]?.client?.risks = ["Service expectations require clarification"]
        db.people[id(6)]?.stage = .paused; db.people[id(6)]?.reason = "Requested a later review"; db.people[id(6)]?.pausedUntil = now.addingTimeInterval(30 * 86400)
        db.people[id(7)]?.stage = .notInterested; db.people[id(7)]?.reason = "Not a fit"
        db.people[id(10)]?.stage = .followUp // Deliberate imported data-quality exception.
        let referral = Referral(id: id(200), referrerID: id(5), personID: id(9), at: now.addingTimeInterval(-86400), sourceNote: "Fictional introduction with contact permission")
        db.referrals[referral.id] = referral; db.people[id(9)]?.nextAction = NextAction(.call, at: now)
        var task = CRMTask(id: id(300), personID: id(8), title: "Monthly service review", dueAt: now.addingTimeInterval(-86400), at: now)
        task.recurrence = Recurrence(unit: .month); task.reminderAt = task.dueAt; db.tasks[task.id] = task
        let file = FileAgreement(id: id(400), personID: id(5), displayName: "Example agreement (metadata only)", storageReference: "fixture-unavailable", checksum: "", at: now, expiresAt: now.addingTimeInterval(10 * 86400)); db.files[file.id] = file
        for version in 1...2 {
            let script = Script(id: id(500 + version), familyID: id(500), name: "Introduction", stage: .new, version: version, content: "Confirm this is a convenient time. Ask about service needs. Agree on a next step.", disclosures: "Confirm permission to keep relationship notes.", effectiveAt: now.addingTimeInterval(Double(version - 3) * 86400), retirementAt: version == 1 ? now.addingTimeInterval(-86400) : nil, changeNote: "Fictional version \(version)")
            db.scripts[script.id] = script
        }
        let connection = IntegrationConnection(id: id(600), provider: "Example calendar", health: .warning, errorCategory: "Simulated permission warning"); db.integrations[connection.id] = connection
        return db
    }
}
