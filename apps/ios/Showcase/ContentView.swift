import SwiftUI
import BitmovinPlayer
import PlaybackCore

struct ContentView: View {
    @StateObject private var model = PlayerModel(
        licenseKey: bitmovinLicenseKey(),
        analyticsLicenseKey: bitmovinAnalyticsLicenseKey()
    )

    var body: some View {
        VStack(spacing: 12) {
            NativePresentationSurface(model: model)
                .aspectRatio(16.0 / 9.0, contentMode: .fit)
            ControlPanel(model: model)
        }
        .padding()
        .onAppear {
            model.loadInitialSource()
        }
        #if os(tvOS)
        .onPlayPauseCommand { model.togglePlayback() }
        #endif
    }
}

struct ControlPanel: View {
    @ObservedObject var model: PlayerModel
    @State private var showsConfiguration = false
    @State private var showsApiInspector = false
    @State private var showsPlaylist = false
    #if !os(tvOS)
    @State private var showsOffline = false
    @State private var showsCast = false
    #endif
    private let quickOffsets: [TimeInterval] = [-10, -30, -60, -120]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                labeled("Source") {
                    HStack {
                        ForEach(Sources.all) { source in
                            Button(source.label) { model.load(source) }
                        }
                    }
                    if let source = model.sourceSettings {
                        Text("Current: \(source.title.isEmpty ? "Custom source" : source.title)")
                            .font(.caption).foregroundStyle(.secondary)
                            .accessibilityIdentifier("source.current")
                    }
                }

                labeled("Configuration") {
                    Button("Configure source and playback") { showsConfiguration = true }
                        .accessibilityIdentifier("configuration.open")
                    Text(model.configurationStatus).font(.caption).foregroundStyle(.secondary)
                        .accessibilityIdentifier("configuration.status")
                    #if os(tvOS)
                    Text("Use Play/Pause on the remote to start or pause this source.")
                        .font(.caption).foregroundStyle(.secondary)
                    #endif
                }

                labeled("Public SDK APIs") {
                    Button("Open API inspector") { showsApiInspector = true }
                        .accessibilityIdentifier("api.open")
                    Button("Open playlist inspector") { showsPlaylist = true }
                        .accessibilityIdentifier("playlist.open")
                    #if !os(tvOS)
                    Button("Open offline HLS inspector") { showsOffline = true }
                        .accessibilityIdentifier("offline.open")
                    Button("Open Google Cast inspector") { showsCast = true }
                        .accessibilityIdentifier("cast.open")
                    #endif
                }

                #if !os(tvOS)
                // Player UI: the SDK default vs. our shared @showcase/ui-shared custom factories (§12).
                // tvOS uses the native System UI, so this picker is iOS-only.
                labeled("Player UI") {
                    HStack {
                        ForEach(UiMode.allCases) { mode in
                            Button(mode.rawValue) { model.setUiMode(mode) }
                                .disabled(model.uiMode == mode)
                        }
                    }
                }
                #endif

                labeled("Seek") {
                    HStack {
                        Button("Go to live edge") { model.goToLiveEdge() }
                            .disabled(!model.dvr.isLive)
                        ForEach(quickOffsets, id: \.self) { offset in
                            Button("\(Int(offset))s") { model.seek(toOffsetFromEdge: offset) }
                                .disabled(!model.dvr.dvrAvailable)
                        }
                    }
                }

                labeled("Playback tracks") {
                    Text("Audio: \(model.trackStatus.audio)")
                        .accessibilityIdentifier("playback.audio")
                    Text("Subtitles: \(model.trackStatus.subtitles)")
                        .accessibilityIdentifier("playback.subtitles")
                    Text(String(format: "Position: %.1fs", model.trackStatus.position))
                        .accessibilityIdentifier("playback.position")
                }

                labeled("DVR controls") {
                    Toggle("Allow DVR controls (app)", isOn: $model.timeShiftEnabled)
                        .accessibilityIdentifier("dvr.allowControls")
                }

                labeled("DVR state") {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("mode:           \(model.dvr.mode.rawValue)")
                        Text("dvrAvailable:   \(String(model.dvr.dvrAvailable))")
                        Text("behindLive:     \(String(format: "%.1f", model.dvr.behindLive))s")
                        Text("atLiveEdge:     \(String(model.dvr.atLiveEdge))")
                        Text("windowDuration: \(String(format: "%.0f", model.dvr.windowDuration))s")
                    }
                    .font(.system(.caption, design: .monospaced))
                }

                labeled("Event log (§10)") {
                    VStack(alignment: .leading, spacing: 1) {
                        ForEach(Array(model.log.prefix(12).enumerated()), id: \.offset) { _, line in
                            Text(line).font(.system(.caption2, design: .monospaced))
                        }
                    }
                }
            }
        }
        .accessibilityIdentifier("controls.scroll")
        #if os(tvOS)
        // A compact tvOS sheet collapses Form to its minimal height, hiding its focusable rows.
        .fullScreenCover(isPresented: $showsConfiguration) { ConfigurationEditor(model: model) }
        .fullScreenCover(isPresented: $showsApiInspector) { ApiInspector(model: model) }
        .fullScreenCover(isPresented: $showsPlaylist) { NativePlaylistInspector(model: model, workbench: model.playlistWorkbench) }
        #else
        .sheet(isPresented: $showsConfiguration) { ConfigurationEditor(model: model) }
        .sheet(isPresented: $showsApiInspector) { ApiInspector(model: model) }
        .sheet(isPresented: $showsPlaylist) { NativePlaylistInspector(model: model, workbench: model.playlistWorkbench) }
        .sheet(isPresented: $showsOffline) { OfflineInspector(player: model, workbench: model.offlineWorkbench) }
        .sheet(isPresented: $showsCast) { NativeCastInspector(workbench: model.castWorkbench) }
        #endif
    }

    private func labeled<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            content()
        }
    }
}
