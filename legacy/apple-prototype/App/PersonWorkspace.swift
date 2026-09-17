import SwiftUI
import CRMCore
import CRMPlatform

struct PersonWorkspace: View {
    @Bindable var model: ApplicationModel
    let person: Person
    @State private var note = ""
    @State private var outcome: CallOutcome = .followUp
    @State private var action: ActionType = .call
    @State private var due = Date().addingTimeInterval(86400)
    @State private var rationale = ""
    @State private var taskTitle = ""
    var body: some View {
        Form {
            Section {
                Text(person.name).font(.largeTitle).fontWeight(.semibold)
                Label(person.stage.label, systemImage: "person.crop.circle.badge.checkmark")
                ForEach(person.emails, id: \.self) { Text($0).textSelection(.enabled) }
                ForEach(person.phones, id: \.self) { Text($0).textSelection(.enabled) }
                let health = HealthEngine().evaluate(person, in: model.database, at: Date())
                Label(health.label, systemImage: health.symbol)
                Text(health.explanation).font(.caption).foregroundStyle(.secondary)
            }
            Section("Next action") {
                if let next = person.nextAction { LabeledContent(next.type.rawValue.capitalized) { Text(next.dueAt, format: .dateTime) } }
                Text(RecommendationEngine().recommendation(for: person, in: model.database, at: Date()).action).foregroundStyle(.secondary)
                Picker("Action", selection: $action) { ForEach(ActionType.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) } }
                DatePicker("Due", selection: $due)
                Button("Schedule next action") { model.perform { try $0.schedule(person.id, nextAction: NextAction(action, at: due), at: Date(), operationID: UUID()) } }.disabled(person.stage.isTerminal)
            }
            Section("Capture a conversation") {
                TextField("Notes", text: $note, axis: .vertical).lineLimit(3...8)
                Picker("Call outcome", selection: $outcome) { ForEach(CallOutcome.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
                Button("Log call and next action") {
                    model.perform { try $0.logActivity(person.id, kind: .call, summary: note, outcome: outcome, nextAction: NextAction(action, at: due), at: Date(), operationID: UUID()) }
                    if model.error == nil { note = "" }
                }.disabled(person.stage.isTerminal)
                Button("Save note") {
                    model.perform { try $0.logActivity(person.id, kind: .note, summary: note, at: Date(), operationID: UUID()) }
                    if model.error == nil { note = "" }
                }.disabled(note.isEmpty || person.stage.isTerminal)
            }
            if person.stage == .pendingSignup {
                Section("Onboarding") {
                    if let onboarding = person.onboarding {
                        Text("Template version \(onboarding.templateVersion) · \(onboarding.decision.rawValue)").font(.caption)
                        ForEach(onboarding.items + onboarding.blockers) { item in
                            Button { model.perform { try $0.completeChecklist(person.id, itemID: item.id, at: Date(), operationID: UUID()) } } label: {
                                Label(item.title, systemImage: item.satisfied ? "checkmark.circle.fill" : "circle")
                            }.disabled(item.satisfied || onboarding.decision != .pending)
                        }
                        TextField("Decision rationale", text: $rationale)
                        HStack {
                            Button("Approve client") { model.perform { try $0.decideOnboarding(person.id, approve: true, rationale: rationale, at: Date(), operationID: UUID()) } }.disabled(!onboarding.canApprove || rationale.isEmpty || onboarding.decision != .pending)
                            Button("Reject onboarding", role: .destructive) { model.perform { try $0.decideOnboarding(person.id, approve: false, rationale: rationale, at: Date(), operationID: UUID()) } }.disabled(rationale.isEmpty || onboarding.decision != .pending)
                        }
                    } else {
                        Button("Begin standard onboarding") {
                            let template = OnboardingCase(templateID: Fixtures.id(100), version: 1, at: Date(), dueAt: due, items: [ChecklistItem(title: "Record consent and contact preferences"), ChecklistItem(title: "Confirm service expectations"), ChecklistItem(title: "Review client agreement")])
                            model.perform { try $0.startOnboarding(person.id, template: template, at: Date(), operationID: UUID()) }
                        }
                    }
                }
            }
            Section("Commitments") {
                TextField("New commitment", text: $taskTitle)
                Button("Add commitment") {
                    model.perform { try $0.addTask(CRMTask(personID: person.id, title: taskTitle, dueAt: due, at: Date()), operationID: UUID()) }
                    if model.error == nil { taskTitle = "" }
                }.disabled(taskTitle.isEmpty || person.stage.isTerminal)
                ForEach(model.database.tasks.values.filter { $0.personID == person.id && $0.status == .open }.sorted { $0.dueAt < $1.dueAt }) { task in
                    VStack(alignment: .leading) {
                        Text(task.title); Text(task.dueAt, format: .dateTime).font(.caption)
                        Button("Complete with note as evidence") {
                            model.perform { try $0.completeTask(task.id, evidence: note, at: Date(), calendar: .current, operationID: UUID()) }
                        }.disabled(note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
            Section("Talking points") {
                ForEach(model.database.scripts.values.filter { $0.stage == person.stage && $0.retirementAt == nil }.sorted { $0.version > $1.version }) { script in
                    VStack(alignment: .leading) { Text("\(script.name) · v\(script.version)").font(.headline); Text(script.content); Text(script.disclosures).font(.caption).foregroundStyle(.secondary) }
                }
            }
            Section("Relationship history") {
                ForEach(model.database.timeline(for: person.id)) { activity in
                    VStack(alignment: .leading, spacing: 4) { Text(activity.summary); Text(activity.at, format: .dateTime).font(.caption).foregroundStyle(.secondary) }
                }
            }
        }.formStyle(.grouped).navigationTitle(person.name)
    }
}
