import SwiftUI
#if os(iOS)
import UIKit
#endif

/// A native editor on both Apple platforms; tvOS uses the focus engine and system text keyboard.
struct ConfigurationEditor: View {
    @ObservedObject var model: PlayerModel
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ConfigurationDraft
    @State private var applyError: String?
    @State private var showCode = false
    @State private var copiedCode: String?

    init(model: PlayerModel) {
        self.model = model
        _draft = State(initialValue: model.configurationDraft)
    }

    private var pendingEffect: ConfigurationEffect? {
        guard let configuration = try? draft.validated() else { return nil }
        return model.effect(for: configuration)
    }

    private var validationMessage: String? {
        do { _ = try draft.validated(); return applyError }
        catch { return error.localizedDescription }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Configuration").font(.title2).bold()
                Spacer()
                Button("Cancel") { dismiss() }
                    .accessibilityIdentifier("configuration.cancel")
            }
            Text("Edit a draft, then apply it. Applying restarts the source at its configured start position.")
                .font(.caption).foregroundStyle(.secondary)

            Form {
                Section(header: Text("Source · reloads source")) {
                    field("Source URL", placeholder: "https://example.com/stream.m3u8",
                          text: $draft.sourceURL, id: "configuration.sourceURL")
                    Picker("Source type", selection: $draft.sourceType) {
                        ForEach(SourceFormat.allCases) { Text($0.rawValue).tag($0) }
                    }
                    #if os(tvOS)
                    .pickerStyle(.inline)
                    #endif
                    .accessibilityIdentifier("configuration.sourceType")
                    field("Title (optional)", placeholder: "Video title",
                          text: $draft.title, id: "configuration.title")
                    field("Poster URL (optional)", placeholder: "https://example.com/poster.jpg",
                          text: $draft.posterURL, id: "configuration.posterURL")
                }
                Section(header: Text("Start position · reloads source"), footer:
                    Text("Blank offset uses the SDK default. Automatic uses the start for VOD and the live edge for live. End accepts a negative offset to start behind the edge. The SDK corrects offsets to the stream boundaries; live offsets apply when playback starts.")) {
                    field("Start offset (seconds, optional)", placeholder: "Default",
                          text: $draft.startOffset, id: "configuration.startOffset")
                    Picker("Offset reference", selection: $draft.timelineReference) {
                        ForEach(OffsetReference.allCases) { Text($0.rawValue).tag($0) }
                    }
                    #if os(tvOS)
                    .pickerStyle(.inline)
                    #endif
                    .accessibilityIdentifier("configuration.timelineReference")
                }
                Section(header: Text("Playback · recreates player"), footer:
                    Text("Mute is a startup setting. SDK time shift enables live DVR in the player; the app's Allow DVR controls switch also governs its quick-seek buttons.")) {
                    Toggle("Autoplay after source load", isOn: $draft.autoplay)
                        .accessibilityIdentifier("configuration.autoplay")
                    Toggle("Start muted", isOn: $draft.startMuted)
                        .accessibilityIdentifier("configuration.startMuted")
                    Toggle("SDK time shift / DVR", isOn: $draft.sdkTimeShiftEnabled)
                        .accessibilityIdentifier("configuration.sdkTimeShift")
                }
                Section(header: Text("Initial tracks · reloads source"), footer:
                    Text("App preferences, applied once at initial Ready with the SDK track-selection APIs. Blank audio and Automatic subtitles keep the SDK/OS choice. A full language tag matches first, then its primary language. An unavailable language keeps the default. Later track-menu choices are left alone.")) {
                    field("Initial audio language (optional)", placeholder: "SDK / OS default, for example de",
                          text: $draft.audioLanguage, id: "configuration.audioLanguage")
                    Picker("Initial subtitles", selection: $draft.subtitleMode) {
                        ForEach(InitialSubtitleMode.allCases) { Text($0.rawValue).tag($0) }
                    }
                    #if os(tvOS)
                    .pickerStyle(.inline)
                    #endif
                    .accessibilityIdentifier("configuration.subtitleMode")
                    if draft.subtitleMode == .language {
                        field("Initial subtitle language", placeholder: "For example en or de",
                              text: $draft.subtitleLanguage, id: "configuration.subtitleLanguage")
                    }
                }
                Section(header: Text("Video scaling · recreates player"), footer:
                    Text("Fit preserves the aspect ratio inside the view. Fill preserves it and crops the edges. Stretch fills the view without preserving it. Equal video/view aspect ratios can look identical.")) {
                    Picker("Video scaling", selection: $draft.videoScaling) {
                        ForEach(VideoScaling.allCases) { Text($0.rawValue).tag($0) }
                    }
                    #if os(tvOS)
                    .pickerStyle(.inline)
                    #endif
                    .accessibilityIdentifier("configuration.videoScaling")
                }
                Section(header: Text("Adaptation and buffer · recreates player"), footer:
                    Text("Maximum bitrate: 0 means unlimited. Forward buffer: 0 lets the SDK choose. Both settings remain active when selecting another source.")) {
                    field("Maximum bitrate (bit/s)", placeholder: "0",
                          text: $draft.maximumBitrate, id: "configuration.maximumBitrate")
                    field("Forward buffer (seconds)", placeholder: "0",
                          text: $draft.forwardBuffer, id: "configuration.forwardBuffer")
                }
                Section(header: Text("Applied configuration code")) {
                    Button(showCode ? "Hide applied code" : "Show applied code") { showCode.toggle() }
                        .accessibilityIdentifier("configuration.code.toggle")
                    if showCode {
                        Text("Player, source and UI settings sent to the SDK. Draft edits are excluded and license keys use placeholders.")
                            .font(.caption)
                        #if os(iOS)
                        Button(copiedCode == appliedCode ? "Copied" : "Copy code") {
                            let code = appliedCode
                            UIPasteboard.general.string = code
                            copiedCode = code
                        }
                        .accessibilityIdentifier("configuration.code.copy")
                        #else
                        Text("This TV host has no clipboard integration.").font(.caption)
                        #endif
                        #if os(tvOS)
                        // Separate focus targets let the remote read every line without horizontal panning.
                        ScrollView(.vertical) {
                            VStack(alignment: .leading, spacing: 0) {
                                ForEach(Array(appliedCode.components(separatedBy: "\n").enumerated()), id: \.offset) { line in
                                    Text(line.element.isEmpty ? " " : line.element)
                                        .font(.system(.caption, design: .monospaced))
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .focusable()
                                        .accessibilityIdentifier("configuration.code.line.\(line.offset)")
                                }
                            }
                            .padding(.horizontal, 24)
                        }
                        .frame(height: 260)
                        .accessibilityIdentifier("configuration.code.scroll")
                        #else
                        ScrollView([.horizontal, .vertical]) {
                            Text(appliedCode).font(.system(.caption, design: .monospaced))
                                .fixedSize(horizontal: true, vertical: false)
                                .textSelection(.enabled)
                                .accessibilityIdentifier("configuration.code.text")
                        }
                        .frame(height: 260)
                        #endif
                    }
                }
            }
            .accessibilityIdentifier("configuration.form")

            if let validationMessage {
                Text(validationMessage).font(.caption).foregroundStyle(.red)
                    .accessibilityIdentifier("configuration.error")
            } else {
                Text(pendingEffect?.description ?? "No configuration changes")
                    .font(.caption).foregroundStyle(.secondary)
                    .accessibilityIdentifier("configuration.effect")
            }
            HStack {
                Button("Reset to applied") {
                    draft = model.configurationDraft
                    applyError = nil
                }
                .accessibilityIdentifier("configuration.reset")
                .accessibilityHint("Restores the draft without changing playback")
                Spacer()
                Button("Apply") {
                    do {
                        try model.apply(draft)
                        dismiss()
                    } catch {
                        applyError = error.localizedDescription
                    }
                }
                .disabled(pendingEffect == nil || pendingEffect == ConfigurationEffect.none)
                .accessibilityIdentifier("configuration.apply")
            }
        }
        .padding()
        #if os(tvOS)
        .frame(maxWidth: 1400, maxHeight: .infinity)
        .padding(40)
        .frame(maxWidth: .infinity)
        .background(.background)
        #endif
        .onChange(of: draft) { _ in applyError = nil }
    }

    private var appliedCode: String {
        configurationCode(source: model.sourceSettings, player: model.playerSettings, uiMode: model.uiMode)
    }

    private func field(_ title: String, placeholder: String,
                       text: Binding<String>, id: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            TextField(placeholder, text: text)
                .disableAutocorrection(true)
                #if !os(tvOS)
                .textInputAutocapitalization(.never)
                #endif
                .accessibilityLabel(title)
                .accessibilityIdentifier(id)
        }
    }
}
