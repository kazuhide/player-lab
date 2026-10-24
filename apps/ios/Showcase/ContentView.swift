import SwiftUI
import BitmovinPlayer
import PlaybackCore
import UIKit

struct ContentView: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var keyboardVisible = false
    @State private var choicePresented = false
    @State private var editorNeedsRoom = false
    #if !os(tvOS)
    @State private var windowSize = CGSize.zero
    #endif
    @StateObject private var model = PlayerModel(
        licenseKey: bitmovinLicenseKey(),
        analyticsLicenseKey: bitmovinAnalyticsLicenseKey()
    )

    var body: some View {
        GeometryReader { geometry in
            #if os(tvOS)
            let sideBySide = geometry.size.width > 650 && geometry.size.width > geometry.size.height
            #else
            // The keyboard reduces the available height without rotating the window.
            let layoutSize = windowSize == .zero ? geometry.size : windowSize
            let sideBySide = geometry.size.width > 650 && layoutSize.width > layoutSize.height
            #endif
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
            .background(Color.workspaceBackground.ignoresSafeArea())
            #else
            let layout = sideBySide
                ? AnyLayout(HStackLayout(alignment: .top, spacing: 16))
                : AnyLayout(VStackLayout(spacing: 6))
            // AnyLayout retains child identity across rotation: drafts, API inputs and SDK hosts survive.
            layout {
                PlayerPreview(model: model, width: previewWidth, maximumHeight: max(1, sideBySide ? geometry.size.height * 0.58 : min(compactPreview ? (keyboardVisible ? 112 : 90) : 220, geometry.size.height * 0.25)), compact: compactPreview)
                    .frame(width: previewWidth)
                ControlPanel(model: model)
                    .frame(width: sideBySide ? max(1, geometry.size.width - 40 - previewWidth) : contentWidth)
            }
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.workspaceBackground.ignoresSafeArea())
            #endif
        }
        #if !os(tvOS)
        .background(WorkspaceWindowSizeReader(size: $windowSize).accessibilityHidden(true))
        .tint(.workspaceTint)
        #endif
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
                Button { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) } label: {
                    Image(systemName: "checkmark").font(.system(size: 18, weight: .semibold))
                        .frame(width: 44, height: 44)
                }
                    .buttonStyle(.plain).controlSize(.regular)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
                    .accessibilityLabel("Done")
                    .accessibilityIdentifier("workspace.keyboard.done")
            }
        }
        #endif
        #if os(tvOS)
        .onPlayPauseCommand { model.togglePlayback() }
        #endif
    }
}

#if !os(tvOS)
/// Reads this view's window so keyboard avoidance does not change the workspace axis.
private struct WorkspaceWindowSizeReader: UIViewRepresentable {
    @Binding var size: CGSize

    func makeUIView(context: Context) -> WindowSizeView {
        let view = WindowSizeView()
        view.isUserInteractionEnabled = false
        view.onSizeChange = { size = $0 }
        return view
    }

    func updateUIView(_ view: WindowSizeView, context: Context) {
        view.onSizeChange = { size = $0 }
        view.publishWindowSize()
    }

    final class WindowSizeView: UIView {
        var onSizeChange: (CGSize) -> Void = { _ in }
        private var previousSize = CGSize.zero

        override func didMoveToWindow() {
            super.didMoveToWindow()
            previousSize = .zero
            publishWindowSize()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            publishWindowSize()
        }

        func publishWindowSize() {
            guard let window else { return }
            let size = window.bounds.size
            guard size.width > 0, size.height > 0, size != previousSize else { return }
            previousSize = size
            DispatchQueue.main.async { [weak self, weak window] in
                guard let self, let window, self.window === window, window.bounds.size == size else { return }
                self.onSizeChange(size)
            }
        }
    }
}
#endif

private struct PlayerPreview: View {
    @Environment(\.workspaceKeyboardVisible) private var keyboardVisible
    @ObservedObject var model: PlayerModel
    var width: CGFloat
    var maximumHeight: CGFloat
    var compact: Bool
    @State private var expanded = false
    @State private var expandsAfterKeyboard = false

    private var canvasHeight: CGFloat { max(1, width * 9.0 / 16.0) }
    private var scale: CGFloat {
        let requested = expanded ? 1 : min(1, max(44, maximumHeight) / canvasHeight)
        // Reserve two accessible controls and one gap before fitting a miniature.
        return requested < 0.999 ? min(requested, max(1, width - 108) / width) : 1
    }
    private var displayedHeight: CGFloat { canvasHeight * scale }
    private var miniature: Bool { scale < 0.999 }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            sourceSelectors
            playerCanvas
            if !miniature {
                HStack(spacing: 8) {
                    Text(model.sourceSettings?.title.isEmpty == false ? model.sourceSettings!.title : "Custom source")
                        .font(.caption.weight(.semibold)).lineLimit(1)
                        .accessibilityIdentifier("source.current")
                    Spacer(minLength: 0)
                    Text(NativeLocalization.format("Position: %.1fs", model.trackStatus.position))
                        .font(.caption).monospacedDigit()
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("playback.position")
                }
                .fixedSize(horizontal: false, vertical: true)
                HStack(alignment: .top, spacing: 8) {
                    Text(NativeLocalization.format("Audio: %@", model.trackStatus.audio)).accessibilityIdentifier("playback.audio")
                    Spacer(minLength: 0)
                    Text(NativeLocalization.format("Subtitles: %@", model.trackStatus.subtitles)).accessibilityIdentifier("playback.subtitles")
                }
                .font(.caption2).foregroundStyle(Color.workspaceSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .onChange(of: compact) { value in if !value { expanded = false } }
        .onChange(of: keyboardVisible) { value in if value { expanded = false; expandsAfterKeyboard = false } }
        #if !os(tvOS)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidHideNotification)) { _ in
            if expandsAfterKeyboard { expanded = true; expandsAfterKeyboard = false }
        }
        #endif
    }

    private var sourceSelectors: some View {
        HStack(spacing: 12) {
            WorkspaceChoice(title: "Source", selection: Binding(
                get: { Sources.all.first(where: { $0.url == model.sourceSettings?.url })?.id ?? "custom" },
                set: { id in if let source = Sources.all.first(where: { $0.id == id }) { model.load(source) } }
            ), options: Sources.all.map(\.id) + (Sources.all.contains(where: { $0.url == model.sourceSettings?.url }) ? [] : ["custom"]), label: { id in Sources.all.first(where: { $0.id == id })?.label ?? "Custom source" })
            .accessibilityIdentifier("source.preset")
            .frame(minHeight: 44)
            .accessibilityHint("Current title: \(model.sourceSettings?.title ?? "Custom source"). Loads the preset and replaces Source draft settings. Player settings and Player draft edits remain active.")
            Spacer(minLength: 0)
            #if !os(tvOS)
            WorkspaceChoice(title: "Theme", selection: Binding(get: { model.uiMode }, set: { model.setUiMode($0) }), options: UiMode.allCases, label: { $0.rawValue })
            .accessibilityIdentifier("player.theme")
            .frame(minHeight: 44)
            .accessibilityHint("Changes the player UI and recreates the player")
            #else
            Button((model.player.isPlaying ? "Pause" : "Play").nativeLocalized) { model.togglePlayback() }
                .accessibilityIdentifier("playback.toggle")
            #endif
            if expanded && maximumHeight < canvasHeight {
                previewAction("Collapse player", symbol: "arrow.down.right.and.arrow.up.left", id: "playback.preview.collapse") {
                    expanded = false; expandsAfterKeyboard = false
                }
            }
        }
        .font(.caption.weight(.semibold))
    }

    private var playerCanvas: some View {
        HStack(spacing: 12) {
            // Keep one SDK host at a 16:9 logical size. A miniature is a uniform
            // presentation transform, not a new player or a squeezed SDK layout.
            NativePreviewSurface(model: model, interactive: !miniature)
                .frame(width: width, height: canvasHeight)
                .scaleEffect(scale, anchor: .topLeading)
                .frame(width: width * scale, height: displayedHeight, alignment: .topLeading)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .allowsHitTesting(!miniature)
                .disabled(miniature)
                .accessibilityElement(children: miniature ? .ignore : .contain)
                .accessibilityHidden(miniature)
                .accessibilityIdentifier("playback.sdk.surface")
                .overlay {
                    #if !os(tvOS)
                    if miniature {
                        Color.clear.contentShape(Rectangle()).onTapGesture { expandPreview() }
                            .accessibilityHidden(true)
                    }
                    #endif
                }
            if miniature {
                HStack(spacing: 8) {
                    previewAction(model.player.isPlaying ? "Pause" : "Play", symbol: model.player.isPlaying ? "pause.fill" : "play.fill", id: "playback.compact.toggle") {
                        model.togglePlayback()
                    }
                    .disabled(model.player.source == nil)
                    previewAction("Expand player", symbol: "arrow.up.left.and.arrow.down.right", id: "playback.preview.expand") { expandPreview() }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func expandPreview() {
        #if !os(tvOS)
        if keyboardVisible {
            expandsAfterKeyboard = true
            if UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) { return }
            expandsAfterKeyboard = false
        }
        #endif
        expanded = true
    }

    private func previewAction(_ title: String, symbol: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 18, weight: .semibold))
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        #if os(tvOS)
        .buttonStyle(.bordered)
        #else
        .buttonStyle(.plain)
        .background(Color.workspaceTint.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
        #endif
        .accessibilityLabel(title.nativeLocalized)
        .accessibilityIdentifier(id)
    }
}

/// A stable UIKit boundary excludes the miniature's embedded SDK Web UI from
/// accessibility and touch. The hosting root and SDK surface survive resizing.
private struct NativePreviewSurface: UIViewControllerRepresentable {
    @ObservedObject var model: PlayerModel
    var interactive: Bool

    func makeUIViewController(context: Context) -> NativePreviewController {
        let controller = NativePreviewController(model: model)
        controller.setInteractive(interactive)
        return controller
    }

    func updateUIViewController(_ controller: NativePreviewController, context: Context) {
        controller.setInteractive(interactive)
    }
}

/// Owns an ordinary UIKit container inside the SwiftUI representable boundary.
/// SwiftUI may manage its outer view's accessibility; the nested gate remains ours.
final class NativePreviewController: UIViewController {
    private let host: UIHostingController<NativePreviewRoot>
    private let accessibilityGate = UIView()

    init(model: PlayerModel) {
        host = UIHostingController(rootView: NativePreviewRoot(model: model))
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        accessibilityGate.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(accessibilityGate)
        NSLayoutConstraint.activate([
            accessibilityGate.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            accessibilityGate.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            accessibilityGate.topAnchor.constraint(equalTo: view.topAnchor),
            accessibilityGate.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        addChild(host)
        if #available(iOS 16.4, tvOS 16.4, *) { host.safeAreaRegions = [] }
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        accessibilityGate.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: accessibilityGate.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: accessibilityGate.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: accessibilityGate.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: accessibilityGate.bottomAnchor)
        ])
        host.didMove(toParent: self)
    }

    func setInteractive(_ interactive: Bool) {
        loadViewIfNeeded()
        if accessibilityGate.accessibilityElementsHidden == interactive {
            accessibilityGate.accessibilityElementsHidden = !interactive
            accessibilityGate.accessibilityElements = interactive ? nil : []
        }
        if accessibilityGate.isUserInteractionEnabled != interactive {
            accessibilityGate.isUserInteractionEnabled = interactive
        }
    }
}

private struct NativePreviewRoot: View {
    @ObservedObject var model: PlayerModel
    var body: some View {
        // The outer workspace handles the keyboard; this is a fixed video canvas.
        NativePresentationSurface(model: model).ignoresSafeArea()
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
    #if os(tvOS)
    @FocusState private var navigationFocus: NativeWorkspaceTab?
    #endif

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
            #if os(tvOS)
            .onExitCommand { navigationFocus = tab }
            #endif
            Divider()
            HStack(spacing: 4) {
                ForEach(NativeWorkspaceTab.allCases) { item in
                    Button { tab = item } label: {
                        VStack(spacing: 3) {
                            Image(systemName: item.symbol).font(.system(size: 18, weight: .semibold))
                            Text(LocalizedStringKey(item.rawValue)).font(.caption.weight(.semibold))
                                .frame(height: keyboardVisible || typeSize.isAccessibilitySize ? 0 : nil)
                                .clipped().opacity(keyboardVisible || typeSize.isAccessibilitySize ? 0 : 1)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(Rectangle())
                        #if !os(tvOS)
                        .foregroundStyle(tab == item ? Color.workspaceTint : Color.workspaceSecondary)
                        #endif
                        .background(tab == item ? Color.blue.opacity(0.10) : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    #if os(tvOS)
                    .buttonStyle(.bordered)
                    .focused($navigationFocus, equals: item)
                    #else
                    .buttonStyle(.plain)
                    #endif
                    .accessibilityIdentifier(item.identifier)
                    .accessibilityLabel(item.rawValue.nativeLocalized)
                    .accessibilityAddTraits(tab == item ? .isSelected : [])
                    .accessibilityValue(tab == item ? "Selected".nativeLocalized : "")
                }
            }
            #if os(tvOS)
            .focusSection()
            #endif
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .padding(.top, 6)
            .frame(height: keyboardVisible && verticalSizeClass == .compact ? 0 : nil)
            .clipped()
            .accessibilityHidden(keyboardVisible && verticalSizeClass == .compact)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
