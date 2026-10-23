import SwiftUI
#if !os(tvOS)
import UIKit
#endif

private struct WorkspaceKeyboardKey: EnvironmentKey {
    static let defaultValue = false
}

private struct WorkspaceChoiceKey: EnvironmentKey {
    static let defaultValue = false
}

private struct WorkspaceActiveKey: EnvironmentKey {
    static let defaultValue = true
}

struct WorkspaceChoicePresentationPreference: PreferenceKey {
    static var defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}

struct WorkspaceCompactPreviewPreference: PreferenceKey {
    static var defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}

extension EnvironmentValues {
    var workspaceActive: Bool {
        get { self[WorkspaceActiveKey.self] }
        set { self[WorkspaceActiveKey.self] = newValue }
    }
    var workspaceKeyboardVisible: Bool {
        get { self[WorkspaceKeyboardKey.self] }
        set { self[WorkspaceKeyboardKey.self] = newValue }
    }
    var workspaceChoicePresented: Bool {
        get { self[WorkspaceChoiceKey.self] }
        set { self[WorkspaceChoiceKey.self] = newValue }
    }
}

extension Color {
    static var workspaceTint: Color {
        #if os(tvOS)
        return .blue
        #else
        return Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(red: 0.52, green: 0.77, blue: 1, alpha: 1) : UIColor(red: 0, green: 0.34, blue: 0.68, alpha: 1)
        })
        #endif
    }
    static var workspaceSecondary: Color {
        #if os(tvOS)
        return .primary
        #else
        return Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(white: 0.76, alpha: 1) : UIColor(white: 0.36, alpha: 1)
        })
        #endif
    }
    static var workspaceBackground: Color {
        #if os(tvOS)
        return Color.black.opacity(0.04)
        #else
        return Color(uiColor: .systemGroupedBackground)
        #endif
    }
}

/// Compact navigation chrome leaves the selected editor room at larger text sizes.
/// The menu and accessibility value retain the full selected name.
struct WorkspaceChoice<Value: Hashable>: View {
    let title: String
    @Binding var selection: Value
    let options: [Value]
    let label: (Value) -> String
    @State private var choosing = false
    @State private var filter = ""

    var body: some View {
        Group {
        #if os(tvOS)
        Picker(title, selection: $selection) {
            ForEach(options, id: \.self) { Text(label($0)).tag($0) }
        }
        #else
        Button { filter = ""; choosing = true } label: { choiceLabel }
                .popover(isPresented: $choosing) {
                    if #available(iOS 16.4, *) { choiceList.presentationCompactAdaptation(.popover) }
                    else { choiceList }
                }
        .font(.caption.weight(.semibold))
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .controlSize(.regular)
        .accessibilityLabel(title)
        .accessibilityValue(label(selection))
        #endif
        }
        .preference(key: WorkspaceChoicePresentationPreference.self, value: choosing)
    }

    private var choiceLabel: some View {
        HStack(spacing: 6) {
            Text(label(selection)).lineLimit(1)
            Image(systemName: "chevron.up.chevron.down").font(.caption2)
        }
        .frame(minHeight: 32).contentShape(Rectangle())
    }

    private var choiceList: some View {
        VStack(spacing: 0) {
            TextField("Find \(title.lowercased())", text: $filter)
                .disableAutocorrection(true)
                #if !os(tvOS)
                .submitLabel(.done)
                .onSubmit { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
                #endif
                .padding(12)
                .accessibilityIdentifier("workspace.choice.filter")
            ScrollView {
              LazyVStack(spacing: 0) {
              ForEach(options.filter { filter.isEmpty || label($0).localizedCaseInsensitiveContains(filter) }, id: \.self) { option in
                Button { selection = option; choosing = false } label: {
                    HStack {
                        Text(label(option)).lineLimit(2)
                        Spacer(minLength: 0)
                        if option == selection { Image(systemName: "checkmark") }
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .accessibilityLabel(label(option))
                .accessibilityAddTraits(option == selection ? .isSelected : [])
                .buttonStyle(.plain)
                .padding(.horizontal, 12)
                Divider()
              }
              }
            }
        }
        .font(.caption)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .frame(width: 320, height: min(440, CGFloat(options.count) * 45 + 64))
    }
}

struct WorkspacePrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    @Environment(\.colorScheme) private var colorScheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 18).padding(.vertical, 10)
            .frame(minHeight: 52)
            .foregroundStyle(enabled ? (colorScheme == .dark ? Color.black : Color.white) : Color.workspaceSecondary)
            .background(enabled ? Color.workspaceTint : Color.workspaceBackground, in: Capsule())
            .overlay(Capsule().strokeBorder(enabled ? Color.clear : Color.workspaceSecondary, lineWidth: 1))
            .contentShape(Capsule())
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// Keep the visible label separate from the actual switch's accessible tap target.
struct WorkspaceToggle: View {
    let title: String
    @Binding var isOn: Bool
    let identifier: String
    var accessibilityTitle: String? = nil

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Text(title).font(.subheadline).accessibilityHidden(true)
            Spacer(minLength: 0)
            Toggle(title, isOn: $isOn).labelsHidden()
                .frame(minHeight: 44)
                .accessibilityIdentifier(identifier)
                .accessibilityLabel(accessibilityTitle ?? title)
        }
    }
}

extension View {
    func workspaceVisibility(_ visible: Bool) -> some View {
        environment(\.workspaceActive, visible)
            .opacity(visible ? 1 : 0)
            .fixedSize(horizontal: false, vertical: !visible)
            .frame(height: visible ? nil : 0)
            .clipped()
            .allowsHitTesting(visible)
            .disabled(!visible)
            .accessibilityHidden(!visible)
    }
}

struct WorkspaceCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct WorkspaceCode: View {
    @Environment(\.workspaceActive) private var workspaceActive
    let code: String
    var identifier = "configuration.code"
    @State private var wraps = true
    @State private var copied: String?

    var body: some View {
        Group {
        if workspaceActive {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                #if !os(tvOS)
                Toggle("Wrap lines", isOn: $wraps)
                    .accessibilityIdentifier("\(identifier).wrap")
                #else
                Text("Lines wrap. Move focus to read the code.").font(.caption)
                #endif
                Spacer()
                #if !os(tvOS)
                Button(copied == code ? "Copied" : "Copy code") {
                    UIPasteboard.general.string = code
                    copied = code
                }
                .accessibilityIdentifier("\(identifier).copy")
                #endif
            }
            .font(.caption)
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            #if os(tvOS)
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(code.components(separatedBy: "\n").enumerated()), id: \.offset) { line in
                        Text(line.element.isEmpty ? " " : line.element)
                            .font(.system(.caption, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .focusable()
                            .accessibilityIdentifier("\(identifier).line.\(line.offset)")
                    }
                }
                .padding(12)
            }
            .accessibilityIdentifier("\(identifier).scroll")
            #else
            ScrollView(wraps ? [.vertical] : [.vertical, .horizontal]) {
                Text(code)
                    .font(.system(.caption, design: .monospaced))
                    .frame(maxWidth: wraps ? .infinity : nil, alignment: .leading)
                    .fixedSize(horizontal: !wraps, vertical: true)
                    .padding(12)
                    .textSelection(.enabled)
                    .accessibilityIdentifier("\(identifier).text")
            }
            #endif
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        }
    }
}

struct AppliedConfigurationWorkspace: View {
    @Environment(\.workspaceActive) private var workspaceActive
    @ObservedObject var model: PlayerModel
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if workspaceActive {
            Text("Applied configuration").font(.headline)
            Text("Player, source and UI values sent to the SDK. Draft edits are excluded; keys use placeholders.")
                .font(.caption).foregroundStyle(Color.workspaceSecondary)
            }
            WorkspaceCode(code: configurationCode(
                source: model.sourceSettings,
                player: model.playerSettings,
                uiMode: model.uiMode
            ))
        }
        .padding(.vertical, 8)
    }
}

private enum NativeMorePane: String, CaseIterable, Identifiable {
    case tools = "Tools", tracks = "Tracks", live = "Live controls", sharePlay = "SharePlay", diagnostics = "Diagnostics", analytics = "Analytics"
    var id: String { rawValue }
}

struct NativeMoreWorkspace: View {
    @Environment(\.workspaceActive) private var workspaceActive
    @ObservedObject var model: PlayerModel
    @State private var pane = NativeMorePane.tools
    @State private var showsPlaylist = false
    #if !os(tvOS)
    @State private var showsOffline = false
    @State private var showsCast = false
    #endif

    var body: some View {
        Group {
        if workspaceActive {
        VStack(alignment: .leading, spacing: 10) {
            WorkspaceChoice(title: "More", selection: $pane, options: NativeMorePane.allCases, label: { $0.rawValue })
            .accessibilityIdentifier("workspace.more.section")
            ScrollView {
                WorkspaceCard {
                    switch pane {
                    case .tools:
                      Group {
                        Button("Playlist") { showsPlaylist = true }.accessibilityIdentifier("playlist.open")
                        Text("Build and inspect a playlist of SDK sources.").font(.caption).foregroundStyle(Color.workspaceSecondary)
                        #if !os(tvOS)
                        Button("Offline HLS") { showsOffline = true }.accessibilityIdentifier("offline.open")
                        Text("Discover tracks and manage local downloads.").font(.caption).foregroundStyle(Color.workspaceSecondary)
                        Button("Google Cast") { showsCast = true }.accessibilityIdentifier("cast.open")
                        #endif
                        Button("SharePlay") { pane = .sharePlay }
                      }
                      .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    case .sharePlay:
                        NativeSharePlayControls(model: model, workbench: model.sharePlayWorkbench)
                    case .tracks:
                        Text("Audio: \(model.trackStatus.audio)")
                        Text("Subtitles: \(model.trackStatus.subtitles)")
                        Text("Use the player track menu to change the current selection. Settings → Tracks sets preferences for the next source load.")
                            .font(.caption).foregroundStyle(Color.workspaceSecondary)
                    case .live:
                        WorkspaceToggle(title: "Allow live rewind controls", isOn: $model.timeShiftEnabled, identifier: "dvr.allowControls")
                        Text("App preference for live sources. It is retained when switching sources.")
                            .font(.caption).foregroundStyle(Color.workspaceSecondary)
                        if model.hasCurrentLiveSource {
                        Button("Live edge") { model.goToLiveEdge() }
                            .accessibilityIdentifier("playback.liveEdge")
                        ForEach([-10.0, -30, -60, -120], id: \.self) { offset in
                            Button("\(Int(offset)) seconds behind live") { model.seek(toOffsetFromEdge: offset) }
                                .disabled(!model.dvr.dvrAvailable)
                        }
                        }
                        if !model.dvr.dvrAvailable {
                            Text("Rewind requires a live source with a seekable window and enabled time shift settings.")
                                .font(.caption).foregroundStyle(Color.workspaceSecondary)
                        }
                    case .diagnostics:
                        if model.hasCurrentLiveSource {
                            Text("Live window: \(Int(model.dvr.windowDuration))s · Behind live: \(Int(model.dvr.behindLive))s")
                                .font(.caption).monospacedDigit()
                        }
                        Text("Recent app events").font(.headline)
                        ForEach(Array(model.log.prefix(12).enumerated()), id: \.offset) { _, line in
                            Text(line).font(.system(.caption, design: .monospaced))
                        }
                    case .analytics:
                        Text("Analytics and Observability").font(.headline)
                        Text("When an Analytics license is configured, the standard PlayerFactory attaches the collector. Inspect playback sessions, quality metrics and errors in the Bitmovin Dashboard. APIs → Host shows which factory is active.")
                            .font(.subheadline)
                        Link("Open Bitmovin Dashboard", destination: URL(string: "https://dashboard.bitmovin.com/analytics")!)
                    }
                }
            }
        }
        .padding(.vertical, 8)
        }
        }
        #if os(tvOS)
        .fullScreenCover(isPresented: $showsPlaylist) { NativePlaylistInspector(model: model, workbench: model.playlistWorkbench) }
        #else
        .sheet(isPresented: $showsPlaylist) { NativePlaylistInspector(model: model, workbench: model.playlistWorkbench) }
        .sheet(isPresented: $showsOffline) { OfflineInspector(player: model, workbench: model.offlineWorkbench) }
        .sheet(isPresented: $showsCast) { NativeCastInspector(workbench: model.castWorkbench) }
        #endif
    }
}
