import SwiftUI

struct AdvancedConfigurationFields: View {
    @Environment(\.workspaceActive) private var workspaceActive
    @Environment(\.workspaceChoicePresented) private var choicePresented
    @Environment(\.workspaceKeyboardVisible) private var keyboardVisible
    @Binding var values: [String: String]
    var owners: Set<ConfigurationOwner> = Set(ConfigurationOwner.allCases)
    @Binding var reveal: String?
    var appliedValues: [String: String]?
    @State private var filter = ""
    @State private var group = "All settings"
    @State private var selection = ""
    @FocusState private var searchFocused: Bool

    init(values: Binding<[String: String]>, owners: Set<ConfigurationOwner> = Set(ConfigurationOwner.allCases), reveal: Binding<String?> = .constant(nil), appliedValues: [String: String]? = nil) {
        _values = values
        self.owners = owners
        _reveal = reveal
        self.appliedValues = appliedValues
    }

    private var groups: [String] {
        ["All settings"] + Set(AdvancedConfiguration.fields.filter { owners.contains($0.owner) }.map { String($0.id.split(separator: ".")[0]) }).sorted()
    }
    private var filteredFields: [AdvancedConfigurationField] {
        AdvancedConfiguration.fields.filter {
            owners.contains($0.owner) && (filter.isEmpty ? group == "All settings" || $0.id.hasPrefix(group + ".") : $0.id.localizedCaseInsensitiveContains(filter) || $0.note.localizedCaseInsensitiveContains(filter))
        }
    }
    private var selectedField: AdvancedConfigurationField? {
        filteredFields.first(where: { $0.id == selection }) ?? filteredFields.first
    }

    var body: some View {
        Group {
        if workspaceActive {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("Search SDK settings", text: $filter)
                    .disableAutocorrection(true)
                    .focused($searchFocused)
                    .accessibilityIdentifier("advanced.filter")
                if !filter.isEmpty {
                    Button("Clear") { filter = "" }.font(.caption)
                }
            }
            .font(.caption)
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .fixedSize(horizontal: false, vertical: true)
            .frame(height: keyboardVisible && !searchFocused && !choicePresented ? 0 : nil).clipped().accessibilityHidden(keyboardVisible && !searchFocused && !choicePresented)
            if let field = selectedField {
                HStack {
                    WorkspaceChoice(title: "SDK group", selection: $group, options: groups, label: { $0 })
                        .accessibilityIdentifier("advanced.group")
                    WorkspaceChoice(title: "Setting", selection: Binding(get: { field.id }, set: { selection = $0 }), options: filteredFields.map(\.id), label: { id in
                        id.replacingOccurrences(of: "-swift.property", with: "").components(separatedBy: ".").last ?? id
                    })
                    .accessibilityIdentifier("advanced.setting")

                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(height: keyboardVisible && !choicePresented ? 0 : nil).clipped().accessibilityHidden(keyboardVisible && !choicePresented)
                ScrollView {
                    WorkspaceCard {
                        AdvancedConfigurationFieldView(field: field, values: $values, appliedValues: appliedValues)
                    }
                }
                .accessibilityIdentifier("advanced.editor")
            } else {
                Text("No matching setting. Clear the search or choose another SDK group.")
                    .font(.subheadline).foregroundStyle(Color.workspaceSecondary)
                Spacer()
            }
        }
        }
        }
        .onAppear { handleReveal(reveal) }
        .onChange(of: reveal) { handleReveal($0) }
    }

    private func handleReveal(_ id: String?) {
        guard let id else { return }
        filter = id
        group = "All settings"
        selection = id
        reveal = nil
    }
}

private struct AdvancedConfigurationFieldView: View {
    @Environment(\.workspaceKeyboardVisible) private var keyboardVisible
    let field: AdvancedConfigurationField
    @Binding var values: [String: String]
    var appliedValues: [String: String]?
    @State private var showsDetails = false

    private var enabled: Binding<Bool> {
        Binding(get: { values[field.id] != nil }, set: { value in
            if value { values[field.id] = field.input.initial }
            else { values.removeValue(forKey: field.id) }
        })
    }

    private var value: Binding<String> {
        Binding(get: { values[field.id] ?? field.input.initial }, set: { values[field.id] = $0 })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                WorkspaceToggle(title: "Override", isOn: enabled, identifier: "advanced.\(field.id).enabled", accessibilityTitle: "Override SDK default")
                    .accessibilityHint(appliedValues == nil ? "Stages a source draft override; Save source draft retains it" : "Off inherits the SDK default; changes remain in the draft until Apply")
                Button { showsDetails = true } label: {
                    Image(systemName: "info.circle")
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("SDK setting details")
                .accessibilityIdentifier("advanced.details")
                #if os(tvOS)
                .alert("SDK setting details", isPresented: $showsDetails) {
                    Button("Close", role: .cancel) {}
                } message: {
                    Text("\(field.id)\nOwner: \(field.owner.rawValue)\n\(field.note)\n\nTurning Override off restores SDK inheritance when applied. Edits remain in the draft until Apply. Script syntax and limits are documented in the app's NativeScripts guide.")
                }
                #else
                .sheet(isPresented: $showsDetails) {
                    NavigationStack {
                        ScrollView { AdvancedConfigurationHelp(field: field, sourceDraft: appliedValues == nil).padding() }
                            .navigationTitle("SDK setting details")
                            .toolbar { ToolbarItem(placement: .navigationBarTrailing) {
                                Button("Close") { showsDetails = false }.frame(minWidth: 44, minHeight: 44)
                            } }
                    }
                }
                #endif
            }
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .fixedSize(horizontal: false, vertical: true)
            .frame(height: keyboardVisible ? 0 : nil).clipped().accessibilityHidden(keyboardVisible)
            if values[field.id] != nil {
                Text(appliedValues == nil ? "Source draft override" : values[field.id] == appliedValues?[field.id] ? "Applied override" : "Unapplied override")
                    .font(.caption.weight(.medium)).foregroundStyle(Color.workspaceTint)
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge).lineLimit(1)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(height: keyboardVisible ? 0 : nil).clipped().accessibilityHidden(keyboardVisible)
                input.accessibilityIdentifier("advanced.\(field.id).value")
            } else {
                Text(appliedValues?[field.id] == nil ? "Inherits SDK default" : "Unapplied removal")
                    .font(.caption).foregroundStyle(Color.workspaceSecondary)
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge).lineLimit(1)
            }

        }
        .padding(.vertical, 4)
    }

    @ViewBuilder private var input: some View {
        switch field.input {
        case .boolean:
            WorkspaceToggle(title: "Enabled", isOn: Binding(get: { value.wrappedValue == "true" }, set: { value.wrappedValue = String($0) }), identifier: "advanced.\(field.id).value", accessibilityTitle: "Boolean value")
        case .choice(let choices):
            WorkspaceChoice(title: "Value", selection: value, options: choices, label: { $0 })
            #if os(tvOS)
            .pickerStyle(.inline)
            #endif
        case .text, .url, .number, .nonPositiveNumber:
            TextField("Value", text: value)
                .disableAutocorrection(true)
                #if !os(tvOS)
                .textInputAutocapitalization(.never)
                #endif
        case .secret:
            SecureField("Local value", text: value)
                .disableAutocorrection(true)
                #if !os(tvOS)
                .textInputAutocapitalization(.never)
                #endif
        case .json:
            #if os(tvOS)
            TextField("JSON value", text: value).disableAutocorrection(true)
            #else
            TextEditor(text: value).font(.system(.caption, design: .monospaced))
                .frame(minHeight: 112).textInputAutocapitalization(.never).disableAutocorrection(true)
            #endif
        case .script:
            #if os(tvOS)
            TextField("Function body", text: value).disableAutocorrection(true)
            #else
            TextEditor(text: value)
                .font(.system(.caption, design: .monospaced))
                .frame(minHeight: 112)
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
            #endif
        }
    }
}

#if !os(tvOS)
private struct AdvancedConfigurationHelp: View {
    let field: AdvancedConfigurationField
    var sourceDraft: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(field.id).font(.headline)
            Text("Owner: \(field.owner.rawValue)")
            Text(sourceDraft ? "Overrides belong to this source draft. Save source draft retains them; load the playlist to use them." : "An override sends the selected value instead of the SDK default. Edits and removals remain in the draft until Apply. Turning Override off restores inheritance when applied.")
            if !field.note.isEmpty { Text(field.note) }
            if case .script = field.input {
                Text("Function body for a JavaScript subset. input contains the arguments; storage is shared by this player, source or view. Use let or const. CPU, elapsed-time and value-size limits apply; failures use the documented fallback.")
                Link("Supported syntax and limits", destination: URL(string: "https://github.com/kazuhide/player-lab/blob/main/apps/ios/Showcase/NativeScripts/README.md")!)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
#endif
