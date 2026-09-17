import SwiftUI
import UniformTypeIdentifiers
import CRMCore
import CRMPlatform

private let gold = Color(red: 0.73, green: 0.59, blue: 0.34)
private enum Workspace: String, CaseIterable, Identifiable {
    case today = "Today", outreach = "Outreach", clients = "Clients", operations = "Operations", executive = "Executive"
    var id: Self { self }
    var symbol: String { switch self { case .today: "sun.max"; case .outreach: "phone"; case .clients: "person.crop.rectangle"; case .operations: "checklist"; case .executive: "chart.bar" } }
}
struct CommandCenter: View {
    @Bindable var model: ApplicationModel
    @State private var workspace: Workspace? = .today
    @State private var selectedPerson: UUID?
    @State private var search = ""
    @State private var showingNewPerson = false
    @State private var showingImport = false
    @State private var showingExport = false
    @State private var exportDocument = JSONDocument()
    var body: some View {
        NavigationSplitView {
            List(selection: $workspace) {
                Section {
                    ForEach(Workspace.allCases) { item in Label(item.rawValue, systemImage: item.symbol).tag(item) }
                } header: { Text("JACOBSON / CARLOS").font(.caption).tracking(2) }
                Section {
                    Label(model.demo ? "Fictional demo · not saved" : model.syncStatus.label, systemImage: model.demo ? "sparkles" : "internaldrive")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }.navigationTitle("Time In")
        } content: {
            Group {
                if !search.isEmpty {
                    List(model.results) { result in
                        Button { selectedPerson = result.personID } label: { VStack(alignment: .leading) { Text(result.title); Text(result.kind).font(.caption).foregroundStyle(.secondary) } }
                    }
                } else if workspace == .operations { operations }
                else if workspace == .executive { executive }
                else if workspace == .today { today }
                else { people }
            }
            .navigationTitle(workspace?.rawValue ?? "Today")
            .searchable(text: $search, prompt: "People, notes, tasks, scripts")
            .onChange(of: search) { _, value in model.search(value) }
            .toolbar {
                ToolbarItemGroup {
                    Button { showingNewPerson = true } label: { Label("New person", systemImage: "plus") }
                    Menu {
                        Button("Import CSV") { showingImport = true }
                        Button("Export local data") {
                            do { exportDocument = JSONDocument(data: try SecureFiles.export(model.database)); showingExport = true }
                            catch { model.perform { _ in throw CRMError.fileAccess } }
                        }
                        Button("Enable task reminders") {
                            Task {
                                do {
                                    let notifications = LocalNotifications()
                                    guard try await notifications.requestPermission() else { throw CRMError.permissionDenied }
                                    try await notifications.reconcile(Array(model.database.tasks.values), at: Date())
                                } catch { model.perform { _ in throw error as? CRMError ?? .notification } }
                            }
                        }
                        Button("Refresh") { model.refresh() }
                    } label: { Label("More actions", systemImage: "ellipsis.circle") }
                }
            }
        } detail: {
            if let id = selectedPerson, let person = model.database.people[id] { PersonWorkspace(model: model, person: person) }
            else { ContentUnavailableView("A little context goes a long way", systemImage: "person.text.rectangle", description: Text("Select a person to see their history and next action.")) }
        }
        .tint(gold)
        .sheet(isPresented: $showingNewPerson) { NewPersonSheet(model: model) }
        .sheet(isPresented: $showingImport) { ImportSheet(model: model) }
        .fileExporter(isPresented: $showingExport, document: exportDocument, contentType: .json, defaultFilename: "TimeIn-export") { result in
            if case .failure = result { model.perform { _ in throw CRMError.fileAccess } }
        }
        .alert(model.error?.title ?? "", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.dismissError() } })) {
            Button("OK") { model.dismissError() }
        } message: { Text((model.error?.errorDescription ?? "") + "\n" + (model.error?.recovery ?? "")) }
    }
    private var today: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(Date(), format: .dateTime.weekday(.wide).month(.wide).day()).font(.subheadline).foregroundStyle(.secondary)
                    Text("The work that matters today.").font(.title2).fontWeight(.semibold)
                    Text("\(model.queue.count) items needing attention").foregroundStyle(gold)
                }.padding(.vertical, 10)
            }
            Section("Your next actions") {
                if model.queue.isEmpty { Text("You're up to date. Add a person to begin.").foregroundStyle(.secondary) }
                ForEach(model.queue) { item in
                    Button { selectedPerson = item.personID } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(model.database.people[item.personID]?.name ?? "Relationship").font(.headline)
                            Text(item.reason).foregroundStyle(.secondary)
                            Text(item.recommendedAction).font(.caption)
                        }.padding(.vertical, 6)
                    }.accessibilityLabel(item.accessibleLabel)
                }
            }
        }
    }
    private var people: some View {
        let people = model.database.visiblePeople.filter { workspace == .clients ? $0.stage == .active || $0.stage == .paused : ![.active, .closed, .notInterested].contains($0.stage) }.sorted { $0.name < $1.name }
        return List(people) { person in
            Button { selectedPerson = person.id } label: {
                VStack(alignment: .leading, spacing: 5) { Text(person.name).font(.headline); Text(person.stage.label).font(.caption).foregroundStyle(.secondary) }
            }
        }.overlay { if people.isEmpty { ContentUnavailableView("No records here yet", systemImage: "person.badge.plus", description: Text("Add a person or import a CSV.")) } }
    }
    private var operations: some View {
        List {
            Section("Data and service exceptions") {
                ForEach(ReportingEngine().issues(in: model.database, at: Date())) { issue in
                    Button { selectedPerson = issue.personID } label: {
                        VStack(alignment: .leading) { Label(issue.explanation, systemImage: "exclamationmark.circle"); Text(issue.remediation).font(.caption).foregroundStyle(.secondary) }
                    }
                }
            }
            Section("Audit history") {
                ForEach(model.database.audit.values.sorted { $0.at > $1.at }.prefix(30)) { event in
                    VStack(alignment: .leading) { Text(event.action).font(.callout); Text(event.at, format: .dateTime).font(.caption).foregroundStyle(.secondary) }
                }
            }
        }
    }
    private var executive: some View {
        let report = try? ReportingEngine().report(in: model.database, start: Date().addingTimeInterval(-30 * 86400), end: Date().addingTimeInterval(1), at: Date(), calendar: .current)
        return List {
            Section("Last 30 days") {
                LabeledContent("Current active clients", value: "\(report?.activeClients ?? 0)")
                LabeledContent("New approvals", value: "\(report?.newApprovals ?? 0)")
                LabeledContent("Calls logged", value: "\(report?.calls ?? 0)")
                LabeledContent("Referrals received", value: "\(report?.referrals ?? 0)")
                LabeledContent("Tasks completed on time", value: report?.followUpCompletionRate.map { $0.formatted(.percent.precision(.fractionLength(0))) } ?? "No tasks due")
            }
            Section("Current lifecycle") { ForEach(Stage.allCases, id: \.self) { stage in LabeledContent(stage.label, value: "\(report?.stages[stage.rawValue] ?? 0)") } }
        }
    }
}
private struct NewPersonSheet: View {
    let model: ApplicationModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var email = ""
    @State private var phone = ""
    var body: some View {
        NavigationStack {
            Form { TextField("Name", text: $name); TextField("Email", text: $email); TextField("Phone", text: $phone) }
                .navigationTitle("New person")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Create") {
                        var person = Person(name: name, at: Date())
                        person.emails = email.isEmpty ? [] : [ContactNormalization.email(email)]; person.phones = phone.isEmpty ? [] : [ContactNormalization.phone(phone)]
                        model.perform { try $0.create(person, operationID: UUID()) }
                        if model.error == nil { dismiss() }
                    }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty) }
                }
        }.frame(minWidth: 340, minHeight: 260)
    }
}
struct JSONDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data = Data()
    init(data: Data = Data()) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
