import Foundation
import LocalAuthentication
import UserNotifications
import CloudKit
import CryptoKit
import Observation
import CRMCore

@MainActor @Observable public final class AppLock {
    public private(set) var isUnlocked = false
    public private(set) var failure: CRMError?
    public init() {}
    public func unlock() async {
        let context = LAContext(); var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { failure = .authentication; return }
        do {
            isUnlocked = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Open your private client command center")
            failure = isUnlocked ? nil : .authentication
        } catch { isUnlocked = false; failure = .authentication }
    }
    public func lock() { isUnlocked = false }
}
@MainActor public final class LocalNotifications: NotificationService {
    private let center: UNUserNotificationCenter
    public init(center: UNUserNotificationCenter = .current()) { self.center = center }
    public func requestPermission() async throws -> Bool {
        do { return try await center.requestAuthorization(options: [.alert, .sound, .badge]) }
        catch { throw CRMError.notification }
    }
    public func reconcile(_ tasks: [CRMTask], at: Date) async throws {
        let prefix = "timein.task."
        let pending = await center.pendingNotificationRequests()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
            center.removePendingNotificationRequests(withIdentifiers: pending.filter { $0.identifier.hasPrefix(prefix) }.map(\.identifier))
            throw CRMError.permissionDenied
        }
        let due = tasks.filter { $0.status == .open && ($0.reminderAt ?? .distantPast) > at }.sorted { $0.reminderAt! < $1.reminderAt! }
        // Leave headroom under the platform's pending-request limit.
        let selected = Array(due.prefix(60))
        let desired = Set(selected.map { prefix + $0.id.uuidString })
        center.removePendingNotificationRequests(withIdentifiers: pending.filter { $0.identifier.hasPrefix(prefix) && !desired.contains($0.identifier) }.map(\.identifier))
        for task in selected {
            let content = UNMutableNotificationContent()
            content.title = "Time In reminder"; content.body = "A commitment is ready for review. Unlock Time In to see the details."; content.sound = .default
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, task.reminderAt!.timeIntervalSince(at)), repeats: false)
            do { try await center.add(UNNotificationRequest(identifier: prefix + task.id.uuidString, content: content, trigger: trigger)) }
            catch { throw CRMError.notification }
        }
    }
}
@MainActor public struct LocalSyncStatus: SyncStatusService {
    public init() {}
    public func status() async -> SyncStatus { SyncStatus(state: .local, explanation: "Saved locally. Cloud synchronization is not enabled in this build.") }
}
@MainActor public final class CloudAccountStatus: SyncStatusService {
    private let container: CKContainer
    public init(containerIdentifier: String) { container = CKContainer(identifier: containerIdentifier) }
    public func status() async -> SyncStatus {
        do {
            switch try await container.accountStatus() {
            case .available: return SyncStatus(state: .local, explanation: "iCloud is available. This does not confirm that CRM changes have synchronized.")
            case .noAccount: return SyncStatus(state: .recoverableError, explanation: "Sign in to iCloud in device settings. Local capture remains available.")
            case .restricted: return SyncStatus(state: .recoverableError, explanation: "iCloud access is restricted on this device.")
            case .couldNotDetermine, .temporarilyUnavailable: return SyncStatus(state: .recoverableError, explanation: "iCloud is temporarily unavailable. Retry later.")
            @unknown default: return SyncStatus(state: .recoverableError, explanation: "Cloud account status needs review.")
            }
        } catch { return SyncStatus(state: .recoverableError, explanation: "Cloud account status could not be checked. Local data is preserved.") }
    }
}
public enum SecureFiles {
    /// Only copy a user-selected document into an app-owned directory; never persist external absolute paths.
    public static func copySelected(_ source: URL, into directory: URL, personID: UUID, at: Date) throws -> FileAgreement {
        let accessing = source.startAccessingSecurityScopedResource()
        defer { if accessing { source.stopAccessingSecurityScopedResource() } }
        do {
            let properties = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard properties.isRegularFile == true, properties.isSymbolicLink != true, (properties.fileSize ?? Int.max) <= 20 * 1024 * 1024 else { throw CRMError.fileAccess }
            let data = try Data(contentsOf: source)
            guard data.count <= 20 * 1024 * 1024 else { throw CRMError.fileAccess }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let filename = UUID().uuidString
            let destination = directory.appendingPathComponent(filename)
            #if os(iOS)
            try data.write(to: destination, options: [.atomic, .completeFileProtection])
            #else
            try data.write(to: destination, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
            #endif
            return FileAgreement(personID: personID, displayName: source.lastPathComponent, storageReference: filename, checksum: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), at: at)
        } catch { throw CRMError.fileAccess }
    }
    public static func export(_ database: Database) throws -> Data {
        do { let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601; encoder.outputFormatting = [.prettyPrinted, .sortedKeys]; return try encoder.encode(database) }
        catch { throw CRMError.fileAccess }
    }
}
