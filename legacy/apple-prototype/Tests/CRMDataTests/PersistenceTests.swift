import XCTest
import SwiftData
import CRMCore
@testable import CRMData

@MainActor final class PersistenceTests: XCTestCase {
    func testDiskReopenPreservesOfflineWriteAndAudit() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("crm.store"); let person = Person(name: "Local Example", at: Date())
        do {
            let repo = try SwiftDataRepository(url: url)
            let service = CRMService(repository: repo, installationID: UUID())
            try service.create(person, operationID: UUID())
        }
        let reopened = try SwiftDataRepository(url: url)
        XCTAssertEqual(try reopened.read().people[person.id]?.name, person.name)
        XCTAssertEqual(try reopened.read().audit.count, 1)
    }
    func testStaleSnapshotAndImmutableHistory() throws {
        let repo = try SwiftDataRepository(inMemory: true); let old = try repo.read()
        let service = CRMService(repository: repo, installationID: UUID())
        try service.create(Person(name: "Example", at: Date()), operationID: UUID())
        XCTAssertThrowsError(try repo.commit(old, replacing: old)) { XCTAssertEqual($0 as? CRMError, .conflict) }
        let before = try repo.read(); var changed = before; changed.audit = [:]
        XCTAssertThrowsError(try repo.commit(changed, replacing: before))
        XCTAssertEqual(try repo.read(), before)
    }
    func testVersionedSchemaHasNoDestructiveFallback() throws {
        XCTAssertEqual(CRMMigrationPlan.schemas.count, 1)
        XCTAssertEqual(CRMSchemaV1.versionIdentifier, Schema.Version(1, 0, 0))
        let repo = try SwiftDataRepository(inMemory: true)
        XCTAssertTrue(try repo.read().people.isEmpty)
    }
    func testSwiftDataImportRollback() throws {
        let repo = try SwiftDataRepository(inMemory: true); let service = CRMService(repository: repo, installationID: UUID()); let now = Date()
        let preview = try ImportEngine().preview(Data("Name,Email\nAvery,avery@example.com\n".utf8), mapping: ColumnMapping(name: "Name", email: "Email"), in: service.snapshot(), at: now)
        XCTAssertTrue(try service.snapshot().people.isEmpty)
        try service.commitImport(preview, choices: [2: .create], at: now, operationID: UUID())
        XCTAssertEqual(try service.snapshot().people.count, 1)
        try service.rollbackImport(preview.id, at: now, operationID: UUID())
        XCTAssertTrue(try service.snapshot().people.isEmpty)
        XCTAssertEqual(try service.snapshot().audit.count, 2)
    }
}
