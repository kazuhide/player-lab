import SwiftUI
import BitmovinPlayer
import DvrKit

struct ContentView: View {
    @StateObject private var model = PlayerModel(
        licenseKey: bitmovinLicenseKey(),
        analyticsLicenseKey: bitmovinAnalyticsLicenseKey()
    )

    var body: some View {
        VStack(spacing: 12) {
            VideoPlayerView(player: model.player, playerViewConfig: PlayerViewConfig())
                .id(model.uiMode) // rebuild the view when the UI factory (and thus player) changes
                .aspectRatio(16.0 / 9.0, contentMode: .fit)
            ControlPanel(model: model)
        }
        .padding()
        .onAppear {
            if let first = Sources.all.first { model.load(first) }
        }
    }
}

struct ControlPanel: View {
    @ObservedObject var model: PlayerModel
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
                        ForEach(quickOffsets, id: \.self) { offset in
                            Button("\(Int(offset))s") { model.seek(toOffsetFromEdge: offset) }
                                .disabled(!model.dvr.dvrAvailable)
                        }
                    }
                }

                labeled("Config") {
                    Toggle("Allow DVR (timeShift)", isOn: $model.timeShiftEnabled)
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
    }

    private func labeled<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            content()
        }
    }
}
