import SwiftUI
#if !os(tvOS)
import UIKit
#endif

enum NativeSettingsCategory: String, CaseIterable, Identifiable {
    case source = "Source", start = "Start position", playback = "Playback"
    case tracks = "Tracks", quality = "Quality and buffer", ui = "Player UI", advanced = "Advanced SDK"
    var id: String { rawValue }
}

enum NativeSetting: String, CaseIterable, Identifiable {
    case sourceURL = "Source URL", sourceType = "Source type", title = "Title", posterURL = "Poster URL"
    case startOffset = "Start offset", timelineReference = "Offset reference"
    case autoplay = "Autoplay", startMuted = "Start muted", sdkTimeShift = "Live time shift"
    case audioLanguage = "Initial audio language", subtitleMode = "Initial subtitles", subtitleLanguage = "Initial subtitle language"
    case maximumBitrate = "Maximum bitrate", forwardBuffer = "Forward buffer", videoScaling = "Video scaling"
    var id: String { rawValue }
    var category: NativeSettingsCategory {
        switch self {
        case .sourceURL, .sourceType, .title, .posterURL: return .source
        case .startOffset, .timelineReference: return .start
        case .autoplay, .startMuted, .sdkTimeShift: return .playback
        case .audioLanguage, .subtitleMode, .subtitleLanguage: return .tracks
        case .maximumBitrate, .forwardBuffer: return .quality
        case .videoScaling: return .ui
        }
    }
    var controlID: String {
        switch self {
        case .sourceURL: return "sourceURL"
        case .sourceType: return "sourceType"
        case .title: return "title"
        case .posterURL: return "posterURL"
        case .startOffset: return "startOffset"
        case .timelineReference: return "timelineReference"
        case .autoplay: return "autoplay"
        case .startMuted: return "startMuted"
        case .sdkTimeShift: return "sdkTimeShift"
        case .audioLanguage: return "audioLanguage"
        case .subtitleMode: return "subtitleMode"
        case .subtitleLanguage: return "subtitleLanguage"
        case .maximumBitrate: return "maximumBitrate"
        case .forwardBuffer: return "forwardBuffer"
        case .videoScaling: return "videoScaling"
        }
    }
    var help: String {
        switch self {
        case .sourceURL: return "Absolute HTTP or HTTPS URL. Apple platforms support HLS and progressive MP4."
        case .sourceType: return "Choose the format of the source URL. DASH is not supported by the Apple SDK."
        case .title: return "Optional title shown by the player. Empty clears the title."
        case .posterURL: return "Optional HTTP or HTTPS image URL displayed before playback. Empty clears the poster."
        case .startOffset: return "Seconds from the chosen reference. Empty uses the SDK default. A negative End offset starts behind the live edge; the SDK clamps to the stream window."
        case .timelineReference: return "Automatic uses the beginning for VOD and the live edge for live. Live offsets take effect when playback starts."
        case .autoplay: return "Starts playback after the source loads. Applying creation settings recreates the player and reloads the source."
        case .startMuted: return "Sets the initial mute state when creating the player. This does not toggle the currently playing instance."
        case .sdkTimeShift: return "Enables the SDK's live rewind support. More → Live controls separately enables the app's quick seek buttons."
        case .audioLanguage: return "Optional language tag, such as de-AT. Applied once after the source is loaded and ready; an unavailable language keeps the default."
        case .subtitleMode: return "Automatic keeps the SDK/OS choice. Preferred language uses Initial subtitle language. Off disables subtitles."
        case .subtitleLanguage: return "Language tag, such as en or de. Required only when Initial subtitles is Preferred language."
        case .maximumBitrate: return "Maximum selectable bitrate in whole bit/s. Zero means unlimited. This is a player creation setting."
        case .forwardBuffer: return "Forward buffer duration in seconds. Zero lets the SDK choose. This is a player creation setting."
        case .videoScaling: return "Fit preserves the complete video. Fill preserves aspect ratio and crops the edges. Stretch fills without preserving aspect ratio."
        }
    }
}

/// One selected setting is edited at a time. Drafts belong to the surrounding workspace.
struct ConfigurationEditor: View {
    @Environment(\.workspaceActive) private var workspaceActive
    @Environment(\.workspaceChoicePresented) private var choicePresented
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.workspaceKeyboardVisible) private var keyboardVisible
    @ObservedObject var model: PlayerModel
    @ObservedObject var session: NativeWorkspaceDraft
    @State private var category = NativeSettingsCategory.source
    @State private var setting = NativeSetting.sourceURL
    @State private var applyError: String?
    @State private var appliedSummary = ""
    @State private var advancedReveal: String?
    @State private var showsDetails = false
    @FocusState private var focusedInput: String?

    private var draft: Binding<ConfigurationDraft> { $session.value }
    private var pendingEffect: ConfigurationEffect? {
        guard let configuration = try? session.value.validated() else { return nil }
        return model.effect(for: configuration)
    }
    private var validationMessage: String? {
        do { _ = try session.value.validated(); return applyError }
        catch { return error.localizedDescription }
    }
    private var changedSettings: [String] {
        let left = session.value
        let right = session.applied
        var result: [String] = []
        if left.sourceURL != right.sourceURL { result.append("URL") }
        if left.sourceType != right.sourceType { result.append("format") }
        if left.title != right.title { result.append("title") }
        if left.posterURL != right.posterURL { result.append("poster") }
        if left.startOffset != right.startOffset || left.timelineReference != right.timelineReference { result.append("start position") }
        if left.autoplay != right.autoplay { result.append("autoplay") }
        if left.startMuted != right.startMuted { result.append("mute") }
        if left.sdkTimeShiftEnabled != right.sdkTimeShiftEnabled { result.append("time shift") }
        if left.audioLanguage != right.audioLanguage || left.subtitleMode != right.subtitleMode || left.subtitleLanguage != right.subtitleLanguage { result.append("tracks") }
        if left.maximumBitrate != right.maximumBitrate { result.append("bitrate") }
        if left.forwardBuffer != right.forwardBuffer { result.append("buffer") }
        if left.videoScaling != right.videoScaling { result.append("scaling") }
        if left.advancedValues != right.advancedValues { result.append("SDK overrides") }
        return result
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if workspaceActive {
            HStack {
                WorkspaceChoice(title: "Category", selection: $category, options: NativeSettingsCategory.allCases, label: { $0.rawValue })
                .accessibilityIdentifier("configuration.category")
                .frame(minHeight: 44)
                Spacer()
                if category != .advanced {
                    WorkspaceChoice(title: "Setting", selection: $setting, options: NativeSetting.allCases.filter { $0.category == category }, label: { $0.rawValue })
                    .accessibilityIdentifier("configuration.setting")
                    .frame(minHeight: 44)
                }
            }
            .font(.caption.weight(.semibold))
            .fixedSize(horizontal: false, vertical: true)
            .frame(height: keyboardVisible && !choicePresented ? 0 : nil).clipped().accessibilityHidden(keyboardVisible && !choicePresented)
            }
            if category == .advanced {
                AdvancedConfigurationFields(values: draft.advancedValues, reveal: $advancedReveal, appliedValues: session.applied.advancedValues)
                    .frame(maxHeight: .infinity, alignment: .top)
            } else if workspaceActive {
                ScrollView {
                    WorkspaceCard {
                        selectedInput
                        Text(setting.help).font(.caption).foregroundStyle(Color.workspaceSecondary)
                    }
                }
                .accessibilityIdentifier("configuration.form")
            }
            if workspaceActive { actionBar }
        }
        .padding(.vertical, 8)
        .preference(key: WorkspaceCompactPreviewPreference.self, value: workspaceActive && category == .advanced)
        .onChange(of: category) { next in
            if setting.category != next, let first = NativeSetting.allCases.first(where: { $0.category == next }) { setting = first }
        }
        .onChange(of: setting) { _ in focusedInput = nil }
        .onChange(of: session.value) { _ in applyError = nil }
        .onChange(of: model.configurationDraft) { session.synchronize($0) }
        .onChange(of: model.sourcePresetRevision) { _ in
            let hadDraft = session.value != session.applied
            session.replaceSourcePreset(model.configurationDraft)
            appliedSummary = hadDraft ? "Source draft replaced; player draft retained" : ""
        }
        .alert("Configuration details", isPresented: $showsDetails) {
            Button("Close", role: .cancel) {}
        } message: {
            Text(validationMessage ?? "\(appliedSummary)\nAutoplay: \(model.playerSettings.autoplay). Start muted: \(model.playerSettings.startMuted). Start offset: \(model.configurationDraft.startOffset.isEmpty ? "SDK default" : model.configurationDraft.startOffset).\n\(model.configurationStatus)")
        }

    }

    private var actionBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let validationMessage, !keyboardVisible {
                HStack {
                    Text(typeSize.isAccessibilitySize || keyboardVisible ? "Invalid draft" : validationMessage)
                        .font(.caption).foregroundStyle(.red)
                        .accessibilityIdentifier("configuration.error")
                        .accessibilityLabel(validationMessage)
                    Spacer(minLength: 0)
                    Button("Show field") { revealInvalidField(validationMessage) }
                        .font(.caption).frame(minHeight: 44)
                        .accessibilityIdentifier("configuration.error.reveal")
                    detailsButton
                }
            } else if !keyboardVisible {
                HStack(alignment: .center) {
                    Text("✓").foregroundStyle(.primary)
                        .accessibilityIdentifier("configuration.status")
                        .accessibilityLabel(model.configurationStatus)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(changedSettings.isEmpty
                            ? (appliedSummary.isEmpty ? "Applied settings" : typeSize.isAccessibilitySize ? "Applied" : appliedSummary)
                            : typeSize.isAccessibilitySize ? "Unapplied settings: \(changedSettings.count)" : "Draft: " + changedSettings.joined(separator: ", "))
                            .font(.caption.weight(.medium))
                            .lineLimit(1)
                            .accessibilityIdentifier("configuration.summary")
                            .accessibilityLabel(changedSettings.isEmpty ? (appliedSummary.isEmpty ? "Applied settings" : appliedSummary) : "Draft: " + changedSettings.joined(separator: ", "))
                        if pendingEffect != nil && pendingEffect != ConfigurationEffect.none {
                            Text(typeSize.isAccessibilitySize ? compactEffect : pendingEffect?.description ?? "Correct the draft")
                                .font(.caption).foregroundStyle(Color.workspaceSecondary)
                                .accessibilityIdentifier("configuration.effect")
                                .accessibilityLabel(pendingEffect?.description ?? "Correct the draft")
                        }
                    }
                    Spacer(minLength: 0)
                    detailsButton
                }
            }
            HStack {
                Button(typeSize.isAccessibilitySize ? "Reset" : "Reset to applied") {
                    session.value = model.configurationDraft
                    session.applied = model.configurationDraft
                    applyError = nil
                }
                .accessibilityIdentifier("configuration.reset")
                .accessibilityLabel("Reset to applied")
                .buttonStyle(.bordered)
                .controlSize(.large)
                .accessibilityHint("Discards draft changes without changing playback")
                Spacer()
                Button("Apply") {
                    #if !os(tvOS)
                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    #endif
                    do {
                        let changes = changedSettings
                        try model.apply(session.value)
                        session.value = model.configurationDraft
                        session.applied = model.configurationDraft
                        appliedSummary = "Applied: " + changes.joined(separator: ", ")
                        applyError = nil
                    } catch {
                        applyError = error.localizedDescription
                        revealInvalidField(error.localizedDescription)
                    }
                }
                #if os(tvOS)
                .buttonStyle(.borderedProminent)
                #else
                .buttonStyle(WorkspacePrimaryButtonStyle())
                #endif
                .controlSize(.large)
                .disabled(pendingEffect == nil || pendingEffect == ConfigurationEffect.none)
                .accessibilityIdentifier("configuration.apply")
            }
        }
        .padding(10)
        .background(.background, in: RoundedRectangle(cornerRadius: 12))
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    private var detailsButton: some View {
        Button { showsDetails = true } label: {
            Image(systemName: "info.circle").frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .accessibilityLabel("Configuration details")
        .accessibilityIdentifier("configuration.details")
        .buttonStyle(.plain)
        .controlSize(.regular)
    }

    private var compactEffect: String {
        switch pendingEffect {
        case nil: return "Invalid draft"
        case .some(.none): return "No changes"
        case .reloadSource: return "Reload source"
        case .recreatePlayer: return "Recreate player"
        }
    }

    private func revealInvalidField(_ message: String) {
        if let field = AdvancedConfiguration.fields.first(where: { message.contains($0.id) }) {
            category = .advanced
            advancedReveal = field.id
        } else if let match = NativeSetting.allCases.first(where: { message.localizedCaseInsensitiveContains($0.rawValue) }) {
            category = match.category
            setting = match
        } else if message.contains("language") {
            category = .tracks
            setting = message.contains("subtitle") ? .subtitleLanguage : .audioLanguage
        } else {
            category = .advanced
            if message.contains("System UI") { advancedReveal = "StyleConfig.userInterfaceType" }
            else if message.contains("customMessageHandler") { advancedReveal = "BitmovinUserInterfaceConfig.customMessageHandler" }
        }
    }

    @ViewBuilder private var selectedInput: some View {
        switch setting {
        case .sourceURL: field("Source URL", placeholder: "https://example.com/stream.m3u8", text: draft.sourceURL, id: "sourceURL")
        case .sourceType:
            WorkspaceChoice(title: "Source type", selection: draft.sourceType, options: SourceFormat.allCases, label: { $0.rawValue })
                .accessibilityIdentifier("configuration.sourceType")
        case .title: field("Title (optional)", placeholder: "Video title", text: draft.title, id: "title")
        case .posterURL: field("Poster URL (optional)", placeholder: "https://example.com/poster.jpg", text: draft.posterURL, id: "posterURL")
        case .startOffset: field("Start offset (seconds, optional)", placeholder: "Default", text: draft.startOffset, id: "startOffset")
        case .timelineReference:
            WorkspaceChoice(title: "Offset reference", selection: draft.timelineReference, options: OffsetReference.allCases, label: { $0.rawValue })
                .accessibilityIdentifier("configuration.timelineReference")
        case .autoplay: WorkspaceToggle(title: "Autoplay after source load", isOn: draft.autoplay, identifier: "configuration.autoplay")
        case .startMuted: WorkspaceToggle(title: "Start muted", isOn: draft.startMuted, identifier: "configuration.startMuted")
        case .sdkTimeShift: WorkspaceToggle(title: "SDK time shift", isOn: draft.sdkTimeShiftEnabled, identifier: "configuration.sdkTimeShift")
        case .audioLanguage: field("Initial audio language", placeholder: "SDK default, for example de", text: draft.audioLanguage, id: "audioLanguage")
        case .subtitleMode:
            WorkspaceChoice(title: "Initial subtitles", selection: draft.subtitleMode, options: InitialSubtitleMode.allCases, label: { $0.rawValue })
                .accessibilityIdentifier("configuration.subtitleMode")
        case .subtitleLanguage: field("Initial subtitle language", placeholder: "For example en or de", text: draft.subtitleLanguage, id: "subtitleLanguage")
        case .maximumBitrate: field("Maximum bitrate (bit/s)", placeholder: "0", text: draft.maximumBitrate, id: "maximumBitrate")
        case .forwardBuffer: field("Forward buffer (seconds)", placeholder: "0", text: draft.forwardBuffer, id: "forwardBuffer")
        case .videoScaling:
            WorkspaceChoice(title: "Video scaling", selection: draft.videoScaling, options: VideoScaling.allCases, label: { $0.rawValue })
                .accessibilityIdentifier("configuration.videoScaling")
        }
    }

    private func field(_ label: String, placeholder: String, text: Binding<String>, id: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(typeSize.isAccessibilitySize ? .caption : .subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .frame(height: keyboardVisible ? 0 : nil).clipped().accessibilityHidden(keyboardVisible)
            #if os(tvOS)
            TextField(placeholder, text: text)
                .disableAutocorrection(true)
                .accessibilityIdentifier("configuration.\(id)")
                .accessibilityLabel(label)
            #else
            // Keep the native editor and give its surrounding row a full tap
            // target. A layout frame alone does not enlarge the native field.
            ZStack {
                TextField(placeholder, text: text)
                    .disableAutocorrection(true)
                    .textInputAutocapitalization(.never)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.done)
                    .focused($focusedInput, equals: id)
                    .accessibilityIdentifier("configuration.\(id)")
                    .accessibilityLabel(label)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
            .simultaneousGesture(TapGesture().onEnded { focusedInput = id })
            .accessibilityElement(children: .contain)
            .accessibilityRemoveTraits(.isButton)
            .accessibilityIdentifier("configuration.\(id).target")
            #endif
        }
    }
}
