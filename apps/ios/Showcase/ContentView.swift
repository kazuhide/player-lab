import SwiftUI
import BitmovinPlayer
import PlaybackCore
#if !os(tvOS)
import UIKit
#endif

struct ContentView: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var keyboardVisible = false
    @State private var choicePresented = false
    @State private var editorNeedsRoom = false
    @StateObject private var model = PlayerModel(
        licenseKey: bitmovinLicenseKey(),
        analyticsLicenseKey: bitmovinAnalyticsLicenseKey()
    )

    var body: some View {
        GeometryReader { geometry in
            let sideBySide = geometry.size.width > 650 && geometry.size.width > geometry.size.height
            let constrainedEditor = editorNeedsRoom && !sideBySide && geometry.size.height < 900
            let compactPreview = typeSize.isAccessibilitySize || keyboardVisible || geometry.size.height < 560 || constrainedEditor
            let contentWidth = max(1, geometry.size.width - 24)
            let previewWidth = sideBySide ? max(1, geometry.size.width - 40) * 0.43 : contentWidth
            #if os(tvOS)
            HStack(alignment: .top, spacing: 16) {
                PlayerPreview(model: model, width: previewWidth, maximumHeight: max(1, geometry.size.height * 0.58), compact: false)
                    .frame(width: previewWidth)
                ControlPanel(model: model)
                    .frame(width: max(1, geometry.size.width - 40 - previewWidth))
            }
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.workspaceBackground)
            #else
            let layout = sideBySide
                ? AnyLayout(HStackLayout(alignment: .top, spacing: 16))
                : AnyLayout(VStackLayout(spacing: 10))
            // AnyLayout retains child identity across rotation: drafts, API inputs and SDK hosts survive.
            layout {
                PlayerPreview(model: model, width: previewWidth, maximumHeight: max(1, sideBySide ? geometry.size.height * 0.58 : min(compactPreview ? (keyboardVisible ? 112 : 90) : 220, geometry.size.height * 0.25)), compact: compactPreview)
                    .frame(width: previewWidth)
                ControlPanel(model: model)
                    .frame(width: sideBySide ? max(1, geometry.size.width - 40 - previewWidth) : contentWidth)
            }
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.workspaceBackground)
            #endif
        }
        .tint(.workspaceTint)
        #if !os(tvOS)
        .buttonStyle(.bordered)
        .controlSize(.large)
        .pickerStyle(.menu)
        #endif
        .environment(\.workspaceKeyboardVisible, keyboardVisible)
        .environment(\.workspaceChoicePresented, choicePresented)
        .onPreferenceChange(WorkspaceChoicePresentationPreference.self) { choicePresented = $0 }
        .onPreferenceChange(WorkspaceCompactPreviewPreference.self) { editorNeedsRoom = $0 }
        .onAppear { model.loadInitialSource() }
        #if !os(tvOS)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardVisible = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardVisible = false }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
                    .font(.body).dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    .buttonStyle(.plain).controlSize(.regular)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
                    .accessibilityIdentifier("workspace.keyboard.done")
            }
        }
        #endif
        #if os(tvOS)
        .onPlayPauseCommand { model.togglePlayback() }
        #endif
    }
}

private struct PlayerPreview: View {
    @ObservedObject var model: PlayerModel
    var width: CGFloat
    var maximumHeight: CGFloat
    var compact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                WorkspaceChoice(title: "Source", selection: Binding(
                    get: { Sources.all.first(where: { $0.url == model.sourceSettings?.url })?.id ?? "custom" },
                    set: { id in if let source = Sources.all.first(where: { $0.id == id }) { model.load(source) } }
                ), options: Sources.all.map(\.id) + (Sources.all.contains(where: { $0.url == model.sourceSettings?.url }) ? [] : ["custom"]), label: { id in Sources.all.first(where: { $0.id == id })?.label ?? "Custom source" })
                .accessibilityIdentifier("source.preset")
                .frame(minHeight: 44)
                .accessibilityHint("Loads the preset and replaces Source draft settings. Player settings and Player draft edits remain active.")
                Spacer(minLength: 0)
                #if !os(tvOS)
                WorkspaceChoice(title: "Theme", selection: Binding(get: { model.uiMode }, set: { model.setUiMode($0) }), options: UiMode.allCases, label: { $0.rawValue })
                .accessibilityIdentifier("player.theme")
                .frame(minHeight: 44)
                .accessibilityHint("Changes the player UI and recreates the player")
                #else
                Button(model.player.isPlaying ? "Pause" : "Play") { model.togglePlayback() }
                    .accessibilityIdentifier("playback.toggle")
                #endif
            }
            .font(.caption.weight(.semibold))
            NativePresentationSurface(model: model)
                .frame(width: width, height: min(width * 9.0 / 16.0, maximumHeight))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .accessibilityIdentifier("playback.preview")
            if !compact {
              HStack(spacing: 8) {
                Text(model.sourceSettings?.title.isEmpty == false ? model.sourceSettings!.title : "Custom source")
                    .font(.caption.weight(.semibold))
                    .accessibilityIdentifier("source.current")
                Spacer()
                Text(String(format: "Position: %.1fs", model.trackStatus.position))
                    .font(.caption).monospacedDigit()
                    .accessibilityIdentifier("playback.position")
            }
            HStack(alignment: .top, spacing: 8) {
                Text("Audio: \(model.trackStatus.audio)")
                    .accessibilityIdentifier("playback.audio")
                Spacer(minLength: 0)
                Text("Subtitles: \(model.trackStatus.subtitles)")
                    .accessibilityIdentifier("playback.subtitles")
            }
            .font(.caption2).foregroundStyle(Color.workspaceSecondary)
            }
        }
    }
}

enum NativeWorkspaceTab: String, CaseIterable, Identifiable {
    case settings = "Settings", apis = "APIs", code = "Code", more = "More"
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .settings: return "slider.horizontal.3"
        case .apis: return "terminal"
        case .code: return "chevron.left.forwardslash.chevron.right"
        case .more: return "ellipsis.circle"
        }
    }
    var identifier: String {
        switch self {
        case .settings: return "configuration.open"
        case .apis: return "api.open"
        case .code: return "configuration.code.toggle"
        case .more: return "workspace.more"
        }
    }
}

struct ControlPanel: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.workspaceKeyboardVisible) private var keyboardVisible
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @ObservedObject var model: PlayerModel
    @State private var tab = NativeWorkspaceTab.settings
    @StateObject private var draft: NativeWorkspaceDraft

    init(model: PlayerModel) {
        self.model = model
        _draft = StateObject(wrappedValue: NativeWorkspaceDraft(model.configurationDraft))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Keep each workspace alive so changing tabs never discards an unapplied draft.
            ZStack {
                ConfigurationEditor(model: model, session: draft)
                    .workspaceVisibility(tab == .settings)
                ApiInspector(model: model, embedded: true)
                    .workspaceVisibility(tab == .apis)
                AppliedConfigurationWorkspace(model: model)
                    .workspaceVisibility(tab == .code)
                NativeMoreWorkspace(model: model)
                    .workspaceVisibility(tab == .more)
            }
            .clipped()
            Divider()
            HStack(spacing: 4) {
                ForEach(NativeWorkspaceTab.allCases) { item in
                    Button { tab = item } label: {
                        VStack(spacing: 3) {
                            Image(systemName: item.symbol).font(.system(size: 18, weight: .semibold))
                            Text(item.rawValue).font(.caption.weight(.semibold))
                                .frame(height: keyboardVisible || typeSize.isAccessibilitySize ? 0 : nil)
                                .clipped().opacity(keyboardVisible || typeSize.isAccessibilitySize ? 0 : 1)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(Rectangle())
                        .foregroundStyle(tab == item ? Color.workspaceTint : Color.workspaceSecondary)
                        .background(tab == item ? Color.blue.opacity(0.10) : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    #if os(tvOS)
                    .buttonStyle(.bordered)
                    #else
                    .buttonStyle(.plain)
                    #endif
                    .accessibilityIdentifier(item.identifier)
                    .accessibilityLabel(item.rawValue)
                    .accessibilityAddTraits(tab == item ? .isSelected : [])
                    .accessibilityValue(tab == item ? "Selected" : "")
                }
            }
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .padding(.top, 6)
            .frame(height: keyboardVisible && verticalSizeClass == .compact ? 0 : nil)
            .clipped()
            .accessibilityHidden(keyboardVisible && verticalSizeClass == .compact)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
