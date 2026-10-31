import BitmovinPlayer
import SwiftUI

/// Separate test-only bundle. No PlayerModel, Player, Source or normal app entry point is initialized.
@main
struct NativeProfilesUITestHost: App {
    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if let request = NativeProfileUITestRequest(arguments: ProcessInfo.processInfo.arguments,
                                                       temporaryRoot: FileManager.default.temporaryDirectory) {
                NativeProfilesUITestView(request: request)
            } else {
                Text(verbatim: "A validated temporary Profiles UI-test store is required.")
                    .accessibilityIdentifier("profiles.test.invalidRequest")
            }
            #else
            Text(verbatim: "Profiles UI testing requires a Debug build.")
            #endif
        }
    }
}

// Unused normal-app sources refer to these helpers. This host never constructs their PlayerModel.
func bitmovinLicenseKey() -> String { "" }
func bitmovinAnalyticsLicenseKey() -> String { "" }

#if DEBUG
private struct NativeProfilesUITestView: View {
    @StateObject private var session: NativeWorkspaceDraft
    private let original: ConfigurationDraft
    private let store: NativeProfileStore
    private let sdkVersion: String

    init(request: NativeProfileUITestRequest) {
        var draft = ConfigurationDraft()
        let fixture = request.savedDraft ? "saved" : "current"
        draft.sourceURL = "https://fixture.invalid/\(fixture).mp4"
        draft.sourceType = .progressive
        draft.title = "\(fixture) title"
        draft.posterURL = "https://fixture.invalid/\(fixture).png"
        draft.advancedValues["SourceConfig.sourceDescription"] = "\(fixture) excluded metadata"
        draft.autoplay = request.savedDraft
        draft.startOffset = request.savedDraft ? "25" : ""
        if !request.savedDraft { draft.advancedValues["SourceConfig.isPosterPersistent"] = "true" }
        original = draft
        _session = StateObject(wrappedValue: NativeWorkspaceDraft(draft))
        store = NativeProfileStore(fileURL: request.fileURL)
        sdkVersion = request.olderSDK ? "3.127.0" : PlayerFactory.sdkVersion
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Profiles").font(.title2).padding(.horizontal, 12)
            NativeConfigurationProfilesPanel(session: session, sdkVersion: sdkVersion, store: store)
            // Read the actual session after every published change. The label never writes state.
            NativeProfilesSessionObservation(session: session, original: original)
                .frame(height: 20).padding(.horizontal, 12)
        }
        .padding(12)
        .background(Color.workspaceBackground.ignoresSafeArea())
    }
}

private struct NativeProfilesSessionObservation: UIViewRepresentable {
    @ObservedObject var session: NativeWorkspaceDraft
    let original: ConfigurationDraft

    func makeUIView(context: Context) -> UILabel {
        let label = UILabel()
        label.text = "Draft/session observation; no Player"
        label.font = .systemFont(ofSize: 11)
        label.isAccessibilityElement = true
        label.accessibilityIdentifier = "profiles.test.session"
        return label
    }

    func updateUIView(_ label: UILabel, context: Context) {
        let draft = session.value
        let values: [String: Any] = [
            "autoplay": draft.autoplay, "startOffset": draft.startOffset,
            "draftUnchanged": draft == original,
            "appliedUnchanged": session.applied == original,
            "sourceFieldsUnchanged": draft.sourceURL == original.sourceURL && draft.sourceType == original.sourceType
                && draft.title == original.title && draft.posterURL == original.posterURL,
            "excludedOverrideUnchanged": draft.advancedValues["SourceConfig.sourceDescription"]
                == original.advancedValues["SourceConfig.sourceDescription"],
            "safeOverrideAbsent": draft.advancedValues["SourceConfig.isPosterPersistent"] == nil,
            "sourceURL": draft.sourceURL, "sdkVersion": PlayerFactory.sdkVersion
        ]
        if let data = try? JSONSerialization.data(withJSONObject: values, options: [.sortedKeys]) {
            label.accessibilityValue = String(decoding: data, as: UTF8.self)
        }
    }
}
#endif
