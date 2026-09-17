import Foundation

public struct CSVTable: Equatable, Sendable {
    public let headers: [String]
    public let rows: [[String]]
}
public enum CSVParser {
    public static func parse(_ data: Data) throws -> CSVTable {
        guard data.count <= 10 * 1024 * 1024 else { throw CRMError.validation("Import files must be 10 MB or smaller.") }
        let text: String
        if data.starts(with: [0xff, 0xfe]) || data.starts(with: [0xfe, 0xff]) {
            guard let value = String(data: data, encoding: .utf16) else { throw CRMError.unsupportedEncoding }; text = value
        } else {
            guard let value = String(data: data, encoding: .utf8) else { throw CRMError.unsupportedEncoding }; text = value
        }
        let chars = Array(text.trimmingCharacters(in: CharacterSet(charactersIn: "\u{feff}")))
        var rows: [[String]] = []; var row: [String] = []; var field = ""
        var quoted = false; var quoteClosed = false; var i = 0
        while i < chars.count {
            let c = chars[i]
            if quoted {
                if c == "\"" {
                    if i + 1 < chars.count && chars[i + 1] == "\"" { field.append("\""); i += 1 }
                    else { quoted = false; quoteClosed = true }
                } else { field.append(c) }
            } else if c == "," { row.append(field); field = ""; quoteClosed = false }
            else if c == "\n" || c == "\r" || c == "\r\n" {
                row.append(field); rows.append(row); row = []; field = ""; quoteClosed = false
                if c == "\r", i + 1 < chars.count, chars[i + 1] == "\n" { i += 1 }
            } else if c == "\"" {
                guard field.isEmpty && !quoteClosed else { throw CRMError.malformedCSV }; quoted = true
            } else {
                guard !quoteClosed else { throw CRMError.malformedCSV }; field.append(c)
            }
            i += 1
        }
        guard !quoted else { throw CRMError.malformedCSV }
        if !row.isEmpty || !field.isEmpty || quoteClosed { row.append(field); rows.append(row) }
        guard let first = rows.first else { throw CRMError.malformedCSV }
        let headers = first.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard !headers.isEmpty, headers.allSatisfy({ !$0.isEmpty }), Set(headers.map { $0.lowercased() }).count == headers.count else { throw CRMError.malformedCSV }
        let body = Array(rows.dropFirst()).filter { !$0.allSatisfy(\.isEmpty) }
        guard body.allSatisfy({ $0.count == headers.count }) else { throw CRMError.malformedCSV }
        return CSVTable(headers: headers, rows: body)
    }
}
public struct ColumnMapping: Sendable {
    public var name: String
    public var email: String?
    public var phone: String?
    public init(name: String, email: String? = nil, phone: String? = nil) { self.name = name; self.email = email; self.phone = phone }
}
public struct DuplicateMatch: Equatable, Sendable {
    public let personID: UUID
    public let confidence: Double
    public let reasons: [String]
}
public struct ImportRow: Identifiable, Sendable {
    public let id: Int
    public let person: Person
    public let errors: [String]
    public let duplicates: [DuplicateMatch]
}
public enum ImportChoice: Equatable, Sendable { case skip, create, merge(UUID) }
public struct ImportPreview: Sendable {
    public let id: UUID
    public let rows: [ImportRow]
    public let at: Date
    public var validCount: Int { rows.filter { $0.errors.isEmpty }.count }
}
public enum ContactNormalization {
    public static func email(_ value: String) -> String { value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
    public static func phone(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let permitted = CharacterSet(charactersIn: "+0123456789 ()-.")
        guard trimmed.unicodeScalars.allSatisfy({ permitted.contains($0) }) else { return trimmed }
        let digits = trimmed.filter(\.isNumber)
        return (trimmed.hasPrefix("+") ? "+" : "") + digits
    }
}
public struct ImportEngine: Sendable {
    public init() {}
    public func preview(_ data: Data, mapping: ColumnMapping, in db: Database, at: Date) throws -> ImportPreview {
        let table = try CSVParser.parse(data)
        guard let nameIndex = table.headers.firstIndex(of: mapping.name) else { throw CRMError.validation("Map the name column.") }
        for column in [mapping.email, mapping.phone].compactMap({ $0 }) where !table.headers.contains(column) { throw CRMError.validation("A mapped column does not exist.") }
        let emailIndex = mapping.email.flatMap { table.headers.firstIndex(of: $0) }; let phoneIndex = mapping.phone.flatMap { table.headers.firstIndex(of: $0) }
        var candidates = db.visiblePeople
        var rows: [ImportRow] = []
        for (index, values) in table.rows.enumerated() {
            var person = Person(name: values[nameIndex].trimmingCharacters(in: .whitespacesAndNewlines), at: at, source: .imported)
            let email = emailIndex.map { ContactNormalization.email(values[$0]) } ?? ""
            let phone = phoneIndex.map { ContactNormalization.phone(values[$0]) } ?? ""
            person.emails = email.isEmpty ? [] : [email]; person.phones = phone.isEmpty ? [] : [phone]
            var errors: [String] = []
            if person.name.isEmpty { errors.append("Name is required") }
            if !email.isEmpty && (email.split(separator: "@").count != 2 || email.contains(" ")) { errors.append("Email format needs review") }
            if !phone.isEmpty && phone.filter(\.isNumber).count < 7 { errors.append("Phone number needs review") }
            let matches = candidates.compactMap { candidate -> DuplicateMatch? in
                var reasons: [String] = []
                if !email.isEmpty && candidate.emails.map(ContactNormalization.email).contains(email) { reasons.append("Exact normalized email") }
                if !phone.isEmpty && candidate.phones.map(ContactNormalization.phone).contains(phone) { reasons.append("Exact normalized phone") }
                if candidate.name.compare(person.name, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame { reasons.append("Matching name") }
                guard !reasons.isEmpty else { return nil }
                return DuplicateMatch(personID: candidate.id, confidence: reasons.contains(where: { $0.hasPrefix("Exact") }) ? 0.98 : 0.65, reasons: reasons)
            }.sorted { $0.confidence == $1.confidence ? $0.personID.uuidString < $1.personID.uuidString : $0.confidence > $1.confidence }
            rows.append(ImportRow(id: index + 2, person: person, errors: errors, duplicates: matches))
            if errors.isEmpty { candidates.append(person) }
        }
        return ImportPreview(id: UUID(), rows: rows, at: at)
    }
}
public extension CRMService {
    func commitImport(_ preview: ImportPreview, choices: [Int: ImportChoice], at: Date, operationID: UUID) throws {
        try transact(target: preview.id, action: "import.committed", at: at, operationID: operationID) { db in
            guard db.imports[preview.id] == nil else { throw CRMError.duplicate }
            var created: [UUID: Person] = [:]
            for row in preview.rows {
                guard let choice = choices[row.id] else { throw CRMError.validation("Choose create, skip, or merge for each row.") }
                if choice == .skip { continue }
                guard row.errors.isEmpty else { throw CRMError.validation("Fix or skip invalid import rows.") }
                switch choice {
                case .skip: break
                case .create:
                    guard db.people[row.person.id] == nil else { throw CRMError.duplicate }
                    db.people[row.person.id] = row.person; created[row.person.id] = row.person
                case .merge(let targetID):
                    // Explicit merge only fills contact methods; no controlled field is replaced.
                    var target = try Self.person(targetID, in: db)
                    target.emails = Array(Set(target.emails + row.person.emails)).sorted()
                    target.phones = Array(Set(target.phones + row.person.phones)).sorted()
                    db.people[targetID] = target
                    Self.append(&db, id: targetID, at: at, kind: .note, summary: "Imported contact methods merged", operation: operationID)
                }
            }
            // Imported values acquire revision 0 on commit. Rollback validates exact material state.
            for id in created.keys { created[id]?.metadata.updatedAt = at }
            db.imports[preview.id] = ImportBatch(id: preview.id, at: at, created: created)
        }
    }
    func rollbackImport(_ batchID: UUID, at: Date, operationID: UUID) throws {
        try transact(target: batchID, action: "import.rolledBack", at: at, operationID: operationID) { db in
            guard var batch = db.imports[batchID], batch.rolledBackAt == nil else { throw CRMError.notFound }
            for (id, original) in batch.created {
                guard db.people[id] == original,
                      !db.activities.values.contains(where: { $0.personID == id }),
                      !db.tasks.values.contains(where: { $0.personID == id }),
                      !db.referrals.values.contains(where: { $0.personID == id || $0.referrerID == id }),
                      !db.files.values.contains(where: { $0.personID == id }),
                      !db.edges.values.contains(where: { $0.fromID == id || $0.toID == id }) else { throw CRMError.rollbackConflict }
            }
            for id in batch.created.keys { db.people.removeValue(forKey: id) }
            batch.rolledBackAt = at; db.imports[batchID] = batch
        }
    }
}
