import Foundation
import Observation
import CRMCore
import CRMData

@MainActor @Observable public final class ApplicationModel {
    public private(set) var database = Database()
    public private(set) var queue: [QueueItem] = []
    public private(set) var results: [SearchResult] = []
    public private(set) var error: CRMError?
    public private(set) var syncStatus = SyncStatus(state: .local, explanation: "Stored on this device")
    public private(set) var recentSearches: [String] = []
    public let service: CRMService
    public let demo: Bool
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    public init(repository: any CRMRepository, installationID: UUID, demo: Bool = false) {
        service = CRMService(repository: repository, installationID: installationID); self.demo = demo
        refresh()
    }
    public static func production() throws -> ApplicationModel {
        let defaults = UserDefaults.standard
        let installation = defaults.string(forKey: "installationID").flatMap(UUID.init(uuidString:)) ?? UUID()
        defaults.set(installation.uuidString, forKey: "installationID")
        return ApplicationModel(repository: try SwiftDataRepository(), installationID: installation)
    }
    public static func preview(at: Date = Date()) -> ApplicationModel {
        ApplicationModel(repository: InMemoryRepository(Fixtures.database(at: at)), installationID: Fixtures.id(999), demo: true)
    }
    public func refresh(at: Date = Date()) {
        do { database = try service.snapshot(); queue = TodayEngine().queue(in: database, at: at, calendar: .current) }
        catch { self.error = error as? CRMError ?? .persistence }
    }
    public func perform(_ body: (CRMService) throws -> Void) {
        do { try body(service); error = nil; refresh() }
        catch { self.error = error as? CRMError ?? .persistence }
    }
    public func dismissError() { error = nil }
    public func search(_ query: String) {
        searchTask?.cancel()
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { results = []; return }
        let snapshot = database
        searchTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .milliseconds(250))
                let results = try await LocalSearch().search(query, in: snapshot)
                try Task.checkCancellation()
                self?.results = results
                if let self { self.recentSearches = Array(([query] + self.recentSearches.filter { $0 != query }).prefix(8)) }
            } catch is CancellationError { } catch { self?.error = .persistence }
        }
    }
}
