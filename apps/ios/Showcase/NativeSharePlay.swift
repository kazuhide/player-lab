import Foundation
import Combine
import GroupActivities
import SwiftUI
import BitmovinPlayer

struct PlayerLabGroupActivity: GroupActivity, Sendable {
    static let activityIdentifier = "com.playerlab.watchtogether"
    let sourceURL: URL
    let title: String
    let sourceIdentifier: String?
    var metadata: GroupActivityMetadata {
        var metadata = GroupActivityMetadata()
        metadata.type = .watchTogether
        metadata.title = title
        metadata.fallbackURL = sourceURL
        metadata.supportsContinuationOnTV = true
        return metadata
    }
}

struct NativeGroupSessionRow: Identifiable {
    let id: UUID
    let state: String
    let participants: Int
    let title: String
}

/// Only OS-created GroupSession handles can be selected for SDK coordination.
final class NativeSharePlayWorkbench: ObservableObject {
    @Published private(set) var rows: [NativeGroupSessionRow] = []
    @Published private(set) var observing = false
    @Published private(set) var eligible = false
    @Published private(set) var activating = false
    @Published private(set) var status = "Start observation to receive actual GroupActivities sessions."
    @Published var selected: UUID?
    private let observer = GroupStateObserver()
    private var sessions: [GroupSession<PlayerLabGroupActivity>] = []
    private var subscriptions: [UUID: AnyCancellable] = [:]
    private var eligibilitySubscription: AnyCancellable?
    private var sessionTask: Task<Void, Never>?
    private var activationTask: Task<Void, Never>?
    private var generation = UUID()
    private var activationIdentifier: UUID?

    deinit { sessionTask?.cancel(); activationTask?.cancel() }

    @MainActor
    func start() {
        guard !observing else { return }
        observing = true; eligible = observer.isEligibleForGroupSession
        let token = UUID(); generation = token
        eligibilitySubscription = observer.$isEligibleForGroupSession.receive(on: DispatchQueue.main).sink { [weak self] value in self?.eligible = value }
        sessionTask = Task { @MainActor [weak self] in
            for await session in PlayerLabGroupActivity.sessions() {
                guard !Task.isCancelled else { break }
                self?.receive(session, generation: token)
            }
        }
        status = "Listening for OS-created Player Lab GroupSession objects. No session is joined automatically."
    }

    @MainActor
    func stop() {
        observing = false; generation = UUID(); sessionTask?.cancel(); sessionTask = nil
        activationTask?.cancel(); activationTask = nil
        activating = false; activationIdentifier = nil
        eligibilitySubscription = nil; subscriptions.removeAll()
        status = "Observation stopped. Existing sessions have not been ended or left."
        refresh()
    }

    @MainActor
    func activate(source: SourceConfig, title: String) {
        guard !activating else { return }
        start()
        let activity = PlayerLabGroupActivity(sourceURL: source.url, title: title.isEmpty ? source.title ?? "Player Lab" : title, sourceIdentifier: source.options.sharePlayIdentifier)
        let token = generation
        let activation = UUID(); activationIdentifier = activation; activating = true
        activationTask = Task { @MainActor [weak self] in
            defer { if self?.activationIdentifier == activation { self?.activating = false; self?.activationIdentifier = nil; self?.activationTask = nil } }
            do {
                let activated = try await activity.activate()
                guard !Task.isCancelled, self?.generation == token else { return }
                self?.status = activated ? "The OS activated the activity. Select its actual session and coordinate the player." : "The OS did not activate a group activity. Check SharePlay eligibility and system setup."
            } catch {
                guard !Task.isCancelled, self?.generation == token else { return }
                self?.status = "The OS rejected activity activation. Check Group Activities signing capability and SharePlay setup."
            }
        }
    }

    @MainActor
    func coordinate(player: Player, join: Bool) throws {
        let session = try selectedSession()
        guard !player.isDestroyed else { throw failure("Create a player before coordinating it.") }
        player.sharePlay.coordinate(with: session)
        if join { session.join() }
        status = join ? "The current SDK player was coordinated with the selected OS session; join was requested." : "The current SDK player was coordinated with the selected OS session."
        refresh()
    }

    @MainActor
    func leave() throws {
        try selectedSession().leave()
        status = "Requested leaving this app's selected session. Other participants' sessions are not ended."
        refresh()
    }

    @MainActor
    func refresh() {
        eligible = observer.isEligibleForGroupSession
        rows = sessions.enumerated().map { index, session in
            .init(id: session.id, state: Self.state(session.state), participants: session.activeParticipants.count, title: "Session \(index + 1): \(Self.state(session.state))")
        }
        if selected == nil || !sessions.contains(where: { $0.id == selected }) { selected = sessions.last?.id }
    }

    @MainActor
    private func receive(_ session: GroupSession<PlayerLabGroupActivity>, generation: UUID) {
        guard self.generation == generation, observing else { return }
        if !sessions.contains(where: { $0.id == session.id }) { sessions.append(session) }
        while sessions.count > 8 { let old = sessions.removeFirst(); subscriptions.removeValue(forKey: old.id) }
        selected = session.id
        subscriptions[session.id] = session.$state.receive(on: DispatchQueue.main).sink { [weak self] _ in self?.refresh() }
        status = "Received an actual OS GroupSession. Select it before coordinating or joining."
        refresh()
    }

    @MainActor
    private func selectedSession() throws -> GroupSession<PlayerLabGroupActivity> {
        guard let session = sessions.first(where: { $0.id == selected }) else { throw failure("Wait for and select an actual OS-created GroupSession. No session is fabricated by this app.") }
        if case .invalidated = session.state { throw failure("The selected OS group session has been invalidated.") }
        return session
    }
    private static func state(_ state: GroupSession<PlayerLabGroupActivity>.State) -> String {
        switch state { case .waiting: return "waiting"; case .joined: return "joined"; case .invalidated: return "invalidated" }
    }
    private func failure(_ message: String) -> ConfigurationValidationError { .init(message: message) }

    static var code: String { """
    import GroupActivities
    import BitmovinPlayer
    struct PlayerLabGroupActivity: GroupActivity {
        static let activityIdentifier = "com.playerlab.watchtogether"
        let sourceURL: URL
        let title: String
        let sourceIdentifier: String?
        var metadata: GroupActivityMetadata {
            var value = GroupActivityMetadata()
            value.type = .watchTogether; value.title = title; value.fallbackURL = sourceURL
            value.supportsContinuationOnTV = true
            return value
        }
    }
    // Retain real sessions from PlayerLabGroupActivity.sessions() in your UI.
    // GroupSession has no public constructor; do not fabricate a handle.
    func coordinateSelected(_ session: GroupSession<PlayerLabGroupActivity>, player: Player, join: Bool) {
        player.sharePlay.coordinate(with: session)
        if join { session.join() }
    }
    // Configure the Group Activities capability in your signing profile.
    // Participants must load matching SourceConfig.options.sharePlayIdentifier values.
    """ }
}

struct NativeSharePlayControls: View {
    @ObservedObject var model: PlayerModel
    @ObservedObject var workbench: NativeSharePlayWorkbench
    @State private var title = ""
    @State private var showsCode = false
    @State private var error: String?

    var body: some View {
        Section(header: Text("SharePlay GroupSession")) {
            Text("OS eligibility: \(workbench.eligible). Sessions are received from GroupActivities; an eligible SharePlay setup and the Group Activities signing capability are required.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Button("Listen for sessions") { workbench.start() }.disabled(workbench.observing)
                Button("Stop listening") { workbench.stop() }.disabled(!workbench.observing)
            }
            TextField("Activity title (empty uses source title)", text: $title)
            Button("Activate current source activity") {
                guard let source = model.player.source?.sourceConfig else { error = "Load a source first."; return }
                error = nil; workbench.activate(source: source, title: title)
            }
            .disabled(workbench.activating)
            Text("Activation shares the current source URL and title with the native SharePlay activity. No activation or session join happens automatically.")
                .font(.caption).foregroundStyle(.secondary)
            Picker("Actual OS session", selection: $workbench.selected) {
                Text("None").tag(Optional<UUID>.none)
                ForEach(workbench.rows) { Text("\($0.title); \($0.participants) participants").tag(Optional($0.id)) }
            }
            Button("Coordinate current player") { run { try workbench.coordinate(player: model.player, join: false) } }.disabled(workbench.selected == nil)
            Button("Coordinate and join") { run { try workbench.coordinate(player: model.player, join: true) } }.disabled(workbench.selected == nil)
            Button("Leave selected session") { run { try workbench.leave() } }.disabled(workbench.selected == nil)
            Button("Refresh group state") { workbench.refresh(); model.refreshApiState() }
            Text(workbench.status).font(.caption)
            if let error { Text(error).foregroundStyle(.red) }
            Toggle("Show SharePlay code", isOn: $showsCode)
            if showsCode { Text(NativeSharePlayWorkbench.code).font(.system(.caption, design: .monospaced)) }
        }
    }
    private func run(_ action: () throws -> Void) { do { try action(); error = nil } catch { self.error = error.localizedDescription } }
}
