import SwiftUI
import CRMCore
import CRMPlatform

@main struct TimeInApp: App {
    @State private var lock = AppLock()
    @State private var model: ApplicationModel?
    @State private var startupError: String?
    @Environment(\.scenePhase) private var scenePhase
    private var demo: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--demo")
        #else
        false
        #endif
    }
    var body: some Scene {
        WindowGroup {
            Group {
                if let model, lock.isUnlocked || demo {
                    CommandCenter(model: model)
                } else {
                    VStack(spacing: 20) {
                        Image(systemName: "lock.shield").font(.system(size: 44)).foregroundStyle(.yellow)
                        Text("Your private command center").font(.title2)
                        Text(startupError ?? lock.failure?.errorDescription ?? "Unlock with your device authentication.").foregroundStyle(.secondary)
                        Button("Unlock Time In") { Task { await lock.unlock(); openStore() } }.buttonStyle(.borderedProminent)
                    }.padding(40)
                }
            }
            .frame(minWidth: 360, minHeight: 500)
            .overlay {
                if scenePhase != .active {
                    Color.black.ignoresSafeArea().overlay { Label("Time In · Private", systemImage: "lock.fill").foregroundStyle(.white) }
                }
            }
            .task { if demo { model = .preview() } }
            .onChange(of: scenePhase) { _, phase in
                if phase == .background { lock.lock(); if !demo { model = nil } }
            }
        }
    }
    private func openStore() {
        guard lock.isUnlocked else { return }
        do { model = try .production(); startupError = nil }
        catch { startupError = "The local store could not be opened. Existing data has been preserved." }
    }
}
