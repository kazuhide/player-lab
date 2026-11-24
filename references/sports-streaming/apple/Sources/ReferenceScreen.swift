import SwiftUI

struct ReferenceScreen: View {
    @StateObject private var session = SportsSession()
    private struct Export: Identifiable {
        let id = UUID()
        let data: Data
    }
    @State private var export: Export?
    @State private var refreshCount = 0
    @Environment(\.scenePhase) private var phase

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Sports streaming").font(.largeTitle.bold())
                Button("Handoff records") {
                    do { export = Export(data: try session.handoffs.export()) }
                    catch { session.problem = "Could not export handoff records." }
                }
                if let catalog = session.catalog {
                    Text("Events").font(.headline)
                    ForEach(catalog.events) { event in
                        Button(event.displayTitle) { session.chooseEvent(event) }
                            .disabled(event.id == session.event?.id)
                    }
                    if let event = session.event {
                        Text(event.displayTitle).font(.title)
                        HStack {
                            Text(LocalizedStringKey(session.status ?? event.status))
                            Text(LocalizedStringKey(session.update?.archiveStatus ?? event.archiveStatus))
                        }
                        if session.statusPollingFinished || session.statusError {
                            Button("Refresh event status") { refreshCount += 1 }
                        }
                        if session.statusError {
                            Text(session.readinessRetriesExhausted ? LocalizedStringKey("Event status unavailable.")
                                : LocalizedStringKey("Event status unavailable. Retrying…"))
                        }
                        if let asset = session.asset {
                            Text(asset.displayTitle).font(.headline)
                            PlaybackControls(session: session, modeName: "Sports controls", showsExternalCaptions: true)
                            if session.problem != nil {
                                Button("Retry") { session.retry() }
                                if asset.kind == "archive" {
                                    Button("Start archive from beginning") { session.open(asset) }
                                }
                            }
                            if let notice = session.notice { Text(LocalizedStringKey(notice)) }
                            if session.ready {
                                HStack {
                                    Button("Subtitles off") { setCaptions("") }
                                    ForEach(asset.subtitleTracks, id: \.language) { track in
                                        Button(track.label) { setCaptions(track.language) }
                                    }
                                }
                                HStack {
                                    ForEach([0.5, 1, 1.5, 2] as [Float], id: \.self) { speed in
                                        Button("\(speed.formatted())×") {
                                            guard let player = session.player, player.canPlay(atPlaybackSpeed: speed) else { return }
                                            session.speed = speed
                                            player.playbackSpeed = speed
                                        }
                                    }
                                }
                            }
                            if session.player?.isLive == true {
                                Button("Live edge") {
                                    session.player?.timeShift = 0
                                    session.player?.play()
                                }
                            }
                            if asset.kind == "clip", session.status == "live" {
                                Button("Return to live") { session.backToLive(restore: false) }
                                Button("Return to previous position") { session.backToLive(restore: true) }
                                    .disabled(!session.canReturn)
                            }
                        }
                        if let archive = session.targetArchive {
                            let archives = session.assets.filter { $0.kind == "archive" }
                            if archives.count > 1 {
                                Picker("Archive for continuation", selection: $session.archiveTargetID) {
                                    ForEach(archives) { choice in
                                        Text(choice.displayTitle).tag(Optional(choice.id))
                                    }
                                }
                            }
                            Toggle("Continue into the archive automatically", isOn: $session.autoContinue)
                            if session.asset?.kind == "live", session.archiveReady {
                                if session.mappedPosition(for: archive) != nil {
                                    Button("Continue at viewed position") { session.continueAtViewedPosition() }
                                } else {
                                    Text("The viewed position is unavailable in this archive.")
                                }
                                Button("Start archive from beginning") { session.open(archive) }
                            }
                        }
                        ForEach(session.assets) { asset in
                            Button(asset.displayTitle) { session.open(asset) }
                                .disabled(session.player == nil || !session.canOpen(asset))
                        }
                    }
                } else if let error = session.problem {
                    Text(LocalizedStringKey(error))
                    Button("Retry") { Task { await session.fetchCatalog() } }
                } else { ProgressView() }
            }
            .frame(maxWidth: 1000, alignment: .leading)
            .padding()
            .frame(maxWidth: .infinity)
        }
        .sheet(item: $export) { HandoffRecords(data: $0.data) }
        .task { if session.catalog == nil { await session.fetchCatalog() } }
        .task(id: "\(session.event?.id ?? "")/\(refreshCount)") { await session.poll() }
        .onChange(of: phase) { phase in
            if phase == .background { session.setBackgrounded(true) }
            else if phase == .active { session.setBackgrounded(false) }
        }
    }

    private func setCaptions(_ language: String) {
        guard let player = session.player else { return }
        session.captionLanguage = language
        session.applyPreferences(player)
    }
}
