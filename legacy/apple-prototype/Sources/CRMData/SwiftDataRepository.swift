import Foundation
import SwiftData
import CRMCore

/// Each domain record is its own CloudKit-compatible row; payloads never contain whole databases.
public enum CRMSchemaV1: VersionedSchema {
    public static var versionIdentifier: Schema.Version { .init(1, 0, 0) }
    public static var models: [any PersistentModel.Type] { [StoredRecord.self] }
    @Model public final class StoredRecord {
        public var key: String = ""
        public var kind: String = ""
        public var payload: Data = Data()
        public var revision: Int = 0
        public init(key: String, kind: String, payload: Data, revision: Int = 0) { self.key = key; self.kind = kind; self.payload = payload; self.revision = revision }
    }
}
public enum CRMMigrationPlan: SchemaMigrationPlan {
    public static var schemas: [any VersionedSchema.Type] { [CRMSchemaV1.self] }
    public static var stages: [MigrationStage] { [] }
}
@MainActor public final class SwiftDataRepository: CRMRepository {
    public let container: ModelContainer
    private let context: ModelContext
    public init(url: URL? = nil, inMemory: Bool = false) throws {
        do {
            let schema = Schema(versionedSchema: CRMSchemaV1.self)
            let configuration: ModelConfiguration
            if let url {
                configuration = ModelConfiguration("TimeIn", schema: schema, url: url, cloudKitDatabase: .none)
            } else {
                configuration = ModelConfiguration("TimeIn", schema: schema, isStoredInMemoryOnly: inMemory, cloudKitDatabase: .none)
            }
            container = try ModelContainer(for: schema, migrationPlan: CRMMigrationPlan.self, configurations: [configuration])
            context = ModelContext(container); context.autosaveEnabled = false
        } catch { throw CRMError.persistence }
    }
    private func rows() throws -> [CRMSchemaV1.StoredRecord] {
        do { return try context.fetch(FetchDescriptor<CRMSchemaV1.StoredRecord>()) }
        catch { throw CRMError.persistence }
    }
    public func read() throws -> Database {
        do {
            var db = Database(); let decoder = JSONDecoder(); var keys: Set<String> = []
            for row in try rows() {
                guard keys.insert(row.key).inserted else { throw CRMError.conflict }
                switch row.kind {
                case "person": let v = try decoder.decode(Person.self, from: row.payload); db.people[v.id] = v
                case "organization": let v = try decoder.decode(Organization.self, from: row.payload); db.organizations[v.id] = v
                case "activity": let v = try decoder.decode(Activity.self, from: row.payload); db.activities[v.id] = v
                case "task": let v = try decoder.decode(CRMTask.self, from: row.payload); db.tasks[v.id] = v
                case "script": let v = try decoder.decode(Script.self, from: row.payload); db.scripts[v.id] = v
                case "referral": let v = try decoder.decode(Referral.self, from: row.payload); db.referrals[v.id] = v
                case "file": let v = try decoder.decode(FileAgreement.self, from: row.payload); db.files[v.id] = v
                case "edge": let v = try decoder.decode(RelationshipEdge.self, from: row.payload); db.edges[v.id] = v
                case "integration": let v = try decoder.decode(IntegrationConnection.self, from: row.payload); db.integrations[v.id] = v
                case "audit": let v = try decoder.decode(AuditEvent.self, from: row.payload); db.audit[v.id] = v
                case "import": let v = try decoder.decode(ImportBatch.self, from: row.payload); db.imports[v.id] = v
                default: throw CRMError.persistence
                }
            }
            return db
        } catch let error as CRMError { throw error } catch { throw CRMError.persistence }
    }
    private func encoded(_ database: Database) throws -> [String: (String, Data)] {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        var records: [String: (String, Data)] = [:]
        func add<T: Encodable>(_ values: [UUID: T], kind: String) throws {
            for (id, value) in values { records["\(kind):\(id.uuidString)"] = (kind, try encoder.encode(value)) }
        }
        try add(database.people, kind: "person"); try add(database.organizations, kind: "organization")
        try add(database.activities, kind: "activity"); try add(database.tasks, kind: "task")
        try add(database.scripts, kind: "script"); try add(database.referrals, kind: "referral")
        try add(database.files, kind: "file"); try add(database.edges, kind: "edge")
        try add(database.integrations, kind: "integration"); try add(database.audit, kind: "audit")
        try add(database.imports, kind: "import")
        return records
    }
    public func commit(_ updated: Database, replacing expected: Database) throws {
        guard try read() == expected else { throw CRMError.conflict }
        try Integrity.validate(updated, replacing: expected)
        do {
            let records = try encoded(updated)
            let oldRows = try rows()
            let existing = Dictionary(uniqueKeysWithValues: oldRows.map { ($0.key, $0) })
            try context.transaction {
                for (key, (kind, payload)) in records {
                    if let row = existing[key] {
                        if row.payload != payload { row.payload = payload; row.revision += 1 }
                    } else { context.insert(CRMSchemaV1.StoredRecord(key: key, kind: kind, payload: payload)) }
                }
                for row in oldRows where records[row.key] == nil { context.delete(row) }
                try context.save()
            }
        } catch { context.rollback(); throw CRMError.persistence }
    }
}
