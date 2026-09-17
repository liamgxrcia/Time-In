import SwiftUI
import CRMCore

/// Semantic palette. Gold text on ivory is 6.7:1; ivory on ink exceeds 15:1.
enum Brand {
    static let ink = Color(red: 0.075, green: 0.078, blue: 0.078)
    static let charcoal = Color(red: 0.14, green: 0.15, blue: 0.15)
    static let ivory = Color(red: 0.97, green: 0.96, blue: 0.93)
    static let goldAccent = Color(red: 0.76, green: 0.64, blue: 0.41)
    static let goldTextAccessible = Color(red: 0.43, green: 0.32, blue: 0.14)
    static let borderSubtle = Color.primary.opacity(0.16)
    static let textSecondary = Color.secondary
    static let success = Color.green
    static let warning = Color.orange
    static let danger = Color.red
    static let information = Color.blue
    static let gutter: CGFloat = 24
    static let sectionGap: CGFloat = 28
    static let rowGap: CGFloat = 12
    static let corner: CGFloat = 12
    static func surface(_ scheme: ColorScheme) -> Color { scheme == .dark ? ink : ivory }
    static func goldText(_ scheme: ColorScheme) -> Color { scheme == .dark ? goldAccent : goldTextAccessible }
}

extension Stage {
    var symbol: String {
        switch self {
        case .new: "person.crop.circle.badge.plus"
        case .followUp: "phone.arrow.up.right"
        case .pendingSignup: "checklist"
        case .active: "checkmark.seal"
        case .paused: "pause.circle"
        case .notInterested: "minus.circle"
        case .closed: "archivebox"
        }
    }
    var shortLabel: String {
        switch self {
        case .new: "New"; case .followUp: "Follow-Up"; case .pendingSignup: "Pending Signup"
        case .active: "Active"; case .paused: "Paused"; case .notInterested: "Not Interested"; case .closed: "Closed"
        }
    }
}
extension Priority {
    var label: String { self == .high ? "High priority" : self == .low ? "Low priority" : "Normal priority" }
    var symbol: String { self == .high ? "flag.fill" : self == .low ? "arrow.down" : "flag" }
}
extension CallOutcome {
    var label: String {
        switch self { case .noAnswer: "No answer"; case .followUp: "Follow up"; case .interested: "Interested"; case .notInterested: "Not interested"; case .completed: "Conversation completed" }
    }
}
extension QueueCategory {
    var symbol: String {
        switch self {
        case .risk: "exclamationmark.shield"; case .missingAction: "calendar.badge.exclamationmark"
        case .onboardingBlocker: "exclamationmark.triangle"; case .overdueCommitment: "checkmark.circle"
        case .referral: "arrow.triangle.branch"; case .relationship: "heart.text.clipboard"
        case .review: "calendar"; case .stalled: "hourglass"; default: "phone"
        }
    }
}

struct Eyebrow: View {
    let text: String
    var body: some View { Text(text.uppercased()).font(.caption.weight(.semibold)).tracking(1.8).foregroundStyle(.secondary) }
}
struct InitialsAvatar: View {
    let name: String
    var size: CGFloat = 38
    var body: some View {
        Text(name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined())
            .font(.system(size: size * 0.32, weight: .medium, design: .serif))
            .foregroundStyle(Brand.ivory).frame(width: size, height: size)
            .background(Brand.charcoal, in: RoundedRectangle(cornerRadius: size * 0.25))
            .accessibilityHidden(true)
    }
}
struct StageBadge: View {
    let stage: Stage
    var body: some View {
        Label(stage.shortLabel, systemImage: stage.symbol).font(.caption.weight(.medium))
            .padding(.horizontal, 8).padding(.vertical, 5)
            .background(.primary.opacity(0.06), in: Capsule()).accessibilityLabel("Lifecycle: \(stage.label)")
    }
}
struct NextActionLabel: View {
    let person: Person
    var body: some View {
        if let next = person.nextAction {
            Label { Text("\(next.type.rawValue.capitalized) · \(next.dueAt.formatted(date: .abbreviated, time: .shortened))") }
            icon: { Image(systemName: next.dueAt < Date() ? "clock.badge.exclamationmark" : "calendar") }
                .font(.caption).foregroundStyle(next.dueAt < Date() ? Brand.danger : .secondary)
        } else if [.followUp, .pendingSignup].contains(person.stage) {
            Label("Next action missing — schedule now", systemImage: "exclamationmark.triangle.fill")
                .font(.caption.weight(.semibold)).foregroundStyle(Brand.danger)
                .accessibilityIdentifier("missing-next-action")
        } else { Text("No next action scheduled").font(.caption).foregroundStyle(.secondary) }
    }
}
struct EmptyState: View {
    let title: String
    let symbol: String
    let message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: symbol).font(.system(size: 34, weight: .ultraLight)).foregroundStyle(Brand.goldAccent).accessibilityHidden(true)
            Text(title).font(.title2.weight(.medium)).fontDesign(.serif)
            Text(message).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 320)
            if let actionTitle, let action { Button(actionTitle, action: action).buttonStyle(.bordered) }
        }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
struct SectionHeading: View {
    let title: String
    var count: Int? = nil
    var body: some View {
        HStack { Text(title).font(.headline); Spacer(); if let count { Text(count.formatted()).font(.caption.monospacedDigit()).foregroundStyle(.secondary) } }
    }
}
struct InlineError: View {
    let error: CRMError
    var body: some View {
        Label { VStack(alignment: .leading, spacing: 4) { Text(error.errorDescription ?? "Unable to save").fontWeight(.medium); Text(error.recovery).font(.caption) } }
        icon: { Image(systemName: "exclamationmark.triangle") }.foregroundStyle(Brand.danger).accessibilityElement(children: .combine)
    }
}
struct SyncBanner: View {
    let status: SyncStatus
    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 3) { Text(status.label).font(.caption.weight(.semibold)); Text(status.explanation).font(.caption) }
        } icon: { Image(systemName: status.state == .recoverableError ? "exclamationmark.icloud" : status.state == .syncing ? "arrow.triangle.2.circlepath" : "internaldrive") }
        .foregroundStyle(.secondary).padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(.primary.opacity(0.04)).accessibilityElement(children: .combine)
    }
}
