import XCTest
@testable import CRMCore

@MainActor final class ImportTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    func testQuotedCSVAndBOMAndUTF16() throws {
        let csv = "\u{feff}Name,Email\r\n\"Avery, \"\"Example\"\"\",avery@example.com\r\n\"Two\nLines\",two@example.com\r\n"
        let table = try CSVParser.parse(Data(csv.utf8))
        XCTAssertEqual(table.rows.count, 2); XCTAssertEqual(table.rows[0][0], "Avery, \"Example\"")
        XCTAssertEqual(table.rows[1][0], "Two\nLines")
        XCTAssertEqual(try CSVParser.parse("Name\nAvery".data(using: .utf16)!).rows.count, 1)
    }
    func testMalformedCSV() {
        for csv in ["", "Name,Name\nA,B", "Name,Email\nA", "Name\n\"unterminated", "Name\n\"closed\"junk"] { XCTAssertThrowsError(try CSVParser.parse(Data(csv.utf8)), csv) }
        XCTAssertThrowsError(try CSVParser.parse(Data([0xff, 0xff, 0xff])))
    }
    func testPreviewNormalizesAndFindsDuplicatesWithoutMutation() throws {
        var person = Person(name: "Original", at: now); person.emails = ["EXAMPLE@example.com"]
        var db = Database(); db.people[person.id] = person
        let preview = try ImportEngine().preview(Data("Name,Email,Phone\nNew, example@EXAMPLE.com ,+1 (202) 555-0100\n,invalid,3".utf8), mapping: ColumnMapping(name: "Name", email: "Email", phone: "Phone"), in: db, at: now)
        XCTAssertEqual(preview.rows[0].duplicates.first?.personID, person.id)
        XCTAssertEqual(preview.rows[0].person.phones, ["+12025550100"])
        XCTAssertEqual(preview.rows[1].errors.count, 3)
        XCTAssertEqual(db.people.count, 1)
    }
    func testRollbackRefusesMateriallyChangedRecords() throws {
        let service = CRMService(repository: InMemoryRepository(), installationID: UUID())
        let preview = try ImportEngine().preview(Data("Name\nExample".utf8), mapping: ColumnMapping(name: "Name"), in: Database(), at: now)
        try service.commitImport(preview, choices: [2: .create], at: now, operationID: UUID())
        let person = preview.rows[0].person
        try service.logActivity(person.id, kind: .note, summary: "New work", at: now, operationID: UUID())
        XCTAssertThrowsError(try service.rollbackImport(preview.id, at: now, operationID: UUID())) { XCTAssertEqual($0 as? CRMError, .rollbackConflict) }
        XCTAssertNotNil(try service.snapshot().people[person.id])
    }
    func testInvalidCommitDoesNotPartiallyWrite() throws {
        let service = CRMService(repository: InMemoryRepository(), installationID: UUID())
        let preview = try ImportEngine().preview(Data("Name,Email\nGood,good@example.com\nBad,invalid".utf8), mapping: ColumnMapping(name: "Name", email: "Email"), in: Database(), at: now)
        XCTAssertThrowsError(try service.commitImport(preview, choices: [2: .create, 3: .create], at: now, operationID: UUID()))
        XCTAssertTrue(try service.snapshot().people.isEmpty)
    }
    func testReportHalfOpenIntervalAndTimeZone() throws {
        var db = Database(); let person = Person(name: "Example", at: now); db.people[person.id] = person
        for date in [now, now.addingTimeInterval(86400)] {
            let a = Activity(personID: person.id, at: date, kind: .call, summary: "Call", operationID: UUID()); db.activities[a.id] = a
        }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "America/New_York")!
        let report = try ReportingEngine().report(in: db, start: now, end: now.addingTimeInterval(86400), at: now, calendar: calendar)
        XCTAssertEqual(report.calls, 1); XCTAssertEqual(report.activityByDay[calendar.startOfDay(for: now)], 1)
    }
    func testFixtureIsDeterministicAndHasDataQualityException() {
        let db = Fixtures.database()
        XCTAssertEqual(db, Fixtures.database())
        XCTAssertTrue(ReportingEngine().issues(in: db, at: Fixtures.referenceDate).contains { $0.explanation == "Missing required next action" })
    }
}
