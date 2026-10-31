import SwiftUI
import BitmovinPlayer

/// Receives only editable drafts. Saving, selecting and restoring cannot invoke PlayerModel.
struct NativeConfigurationProfilesPanel: View {
    @ObservedObject var session: NativeWorkspaceDraft
    let sdkVersion: String
    @State private var store: NativeProfileStore?
    @State private var profiles: [NativeConfigurationProfile] = []
    @State private var selected: UUID?
    @State private var name = ""
    @State private var ready = false
    @State private var busy = false
    @State private var message = ""
    @State private var showsFields = false
    @State private var pending: Confirmation?

    private enum Confirmation {
        case replace(NativeConfigurationProfile, UUID), sdk(NativeConfigurationProfile), delete(UUID), clear
    }
    private var selectedProfile: NativeConfigurationProfile? { profiles.first { $0.id == selected } }

    init(session: NativeWorkspaceDraft, sdkVersion: String = PlayerFactory.sdkVersion,
         store: NativeProfileStore? = try? NativeProfileStore.applicationStore()) {
        self.session = session
        self.sdkVersion = sdkVersion
        _store = State(initialValue: store)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Profiles save a limited settings subset on this device. Restore only edits the draft; use Apply separately.")
                    .font(.caption).foregroundStyle(Color.workspaceSecondary)
                TextField("Profile name", text: $name)
                    .disableAutocorrection(true)
                    #if !os(tvOS)
                    .textFieldStyle(.roundedBorder)
                    #endif
                    .accessibilityIdentifier("configuration.profiles.name")
                WorkspaceChoice(title: "Saved profiles", selection: $selected,
                    options: [nil] + profiles.map { Optional($0.id) },
                    localizesOptions: false, label: { id in
                        profiles.first(where: { $0.id == id })?.name ?? "Choose a profile".nativeLocalized
                    })
                    .disabled(!ready || busy)
                    .accessibilityIdentifier("configuration.profiles.selection")
                if let profile = selectedProfile {
                    Text(NativeLocalization.format("Saved SDK: %@ · Current SDK: %@", profile.sdkVersion, sdkVersion))
                        .font(.caption).foregroundStyle(Color.workspaceSecondary)
                }
                HStack {
                    Button("Save", action: save).disabled(!ready || busy).accessibilityLabel("Save profile")
                        .accessibilityIdentifier("configuration.profiles.save")
                    Button("Restore draft", action: restore).disabled(selectedProfile == nil || !ready || busy)
                        .accessibilityIdentifier("configuration.profiles.restore")
                    Button("Delete", role: .destructive) {
                        if let selected { pending = .delete(selected) }
                    }.disabled(selected == nil || !ready || busy)
                        .accessibilityLabel("Delete profile")
                        .accessibilityIdentifier("configuration.profiles.delete")
                }
                .buttonStyle(.bordered).font(.caption)
                if !message.isEmpty {
                    Text(LocalizedStringKey(message)).font(.caption)
                        .accessibilityIdentifier("configuration.profiles.status")
                        .accessibilityAddTraits(.updatesFrequently)
                }
                if !ready && !busy {
                    Button("Clear saved profiles", role: .destructive) { pending = .clear }
                        .disabled(store == nil).accessibilityIdentifier("configuration.profiles.clear")
                }
                Button { showsFields.toggle() } label: {
                    HStack {
                        Text("Saved fields")
                        Image(systemName: showsFields ? "chevron.up" : "chevron.down")
                    }
                }.accessibilityIdentifier("configuration.profiles.fields")
                if showsFields {
                    Text("Saves playback flags, start position, track language preferences, bitrate, buffer, scaling and 19 supported primitive SDK overrides. A built-in public source is saved only when its exact URL and type match. Other URLs, titles, posters, metadata, credentials, headers and scripts stay in the current draft.")
                        .font(.caption).foregroundStyle(Color.workspaceSecondary)
                    ForEach(NativeProfileSchema.overrides.keys.sorted(), id: \.self) { id in
                        Text(verbatim: id).font(.caption2)
                    }
                }
                Text("Up to 20 profiles; 1–48 Unicode code points per name, 8 KiB per profile and 128 KiB in total. iOS and tvOS profiles are separate and excluded from backup.")
                    .font(.caption).foregroundStyle(Color.workspaceSecondary)
            }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
        }
        .task { await load() }
        .alert("Saved profiles", isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } })) {
            switch pending {
            case .replace(let profile, let id):
                Button("Replace profile", role: .destructive) { persist(profile, replacing: id) }
            case .sdk(let profile):
                Button("Revalidate and restore") { restore(profile, confirmed: true) }
                    .accessibilityIdentifier("configuration.profiles.confirmSDK")
            case .delete(let id):
                Button("Delete profile", role: .destructive) { update { try await $0.delete(id) } }
                    .accessibilityIdentifier("configuration.profiles.confirmDelete")
            case .clear:
                Button("Clear saved profiles", role: .destructive) { update { try await $0.clear() } }
            case nil: EmptyView()
            }
            Button("Cancel", role: .cancel) { pending = nil }
                .accessibilityIdentifier("configuration.profiles.cancel")
        } message: {
            switch pending {
            case .replace: Text("Replace the saved profile with this name?")
            case .sdk: Text("This profile uses a different SDK version. Revalidate the supported fields and restore them to the draft? Playback will not change.")
            case .delete: Text("Delete the selected saved profile? The draft and playback will not change.")
            case .clear: Text("Clear all saved profiles on this device? The draft and playback will not change.")
            case nil: Text("")
            }
        }
    }

    @MainActor private func load() async {
        guard let store else { message = NativeProfileError.read.rawValue; return }
        busy = true
        defer { busy = false }
        do {
            let saved = try await store.load()
            for profile in saved { try profile.validateCurrentFields() }
            profiles = saved; ready = true
        } catch { profiles = []; ready = false; report(error) }
    }

    private func save() {
        do {
            let profile = try NativeConfigurationProfile.capture(name: name, draft: session.value, sdkVersion: sdkVersion)
            if let duplicate = profiles.first(where: { NativeProfileSchema.nameKey($0.name) == NativeProfileSchema.nameKey(profile.name) }) {
                pending = .replace(profile, duplicate.id)
            } else { persist(profile) }
        } catch {
            switch error as? NativeProfileError {
            case .name, .limit, .duplicate: report(error)
            default: message = NativeProfileError.draft.rawValue
            }
        }
    }

    private func persist(_ profile: NativeConfigurationProfile, replacing id: UUID? = nil) {
        update { try await $0.save(profile, replacing: id) }
    }

    private func restore() {
        guard let profile = selectedProfile else { return }
        if profile.sdkVersion != sdkVersion { pending = .sdk(profile) }
        else { restore(profile, confirmed: false) }
    }

    private func restore(_ profile: NativeConfigurationProfile, confirmed: Bool) {
        do {
            try session.restoreProfile(profile, sdkVersion: sdkVersion, confirmDifferentSDK: confirmed)
            message = "Profile restored to draft. Review the settings, then use Apply."
        } catch { report(error) }
    }

    private func update(_ operation: @escaping (NativeProfileStore) async throws -> [NativeConfigurationProfile]) {
        guard let store, !busy else { return }
        busy = true
        Task { @MainActor in
            defer { busy = false }
            do {
                profiles = try await operation(store); selected = nil; ready = true
                message = "Saved profiles updated. The draft and playback are unchanged."
            } catch { report(error) }
        }
    }

    private func report(_ error: Error) {
        message = (error as? NativeProfileError)?.rawValue ?? NativeProfileError.invalid.rawValue
    }
}
