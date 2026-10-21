import SwiftUI

struct AdvancedConfigurationFields: View {
    @Binding var values: [String: String]
    var owners: Set<ConfigurationOwner> = Set(ConfigurationOwner.allCases)
    @State private var filter = ""
    private var filteredFields: [AdvancedConfigurationField] {
        AdvancedConfiguration.fields.filter { owners.contains($0.owner) && (filter.isEmpty || $0.id.localizedCaseInsensitiveContains(filter)) }
    }

    var body: some View {
        TextField("Filter configuration API name", text: $filter)
            .disableAutocorrection(true)
            .accessibilityIdentifier("advanced.filter")
        ForEach(ConfigurationOwner.allCases.filter { owner in filteredFields.contains { $0.owner == owner } }, id: \.self) { owner in
            Text(owner.rawValue).font(.headline)
            ForEach(filteredFields.filter { $0.owner == owner }) { field in
                AdvancedConfigurationFieldView(field: field, values: $values)
            }
        }
    }
}

private struct AdvancedConfigurationFieldView: View {
    let field: AdvancedConfigurationField
    @Binding var values: [String: String]

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
            Toggle("Override \(field.id)", isOn: enabled)
                .accessibilityIdentifier("advanced.\(field.id).enabled")
            if values[field.id] != nil {
                input.accessibilityIdentifier("advanced.\(field.id).value")
                if !field.note.isEmpty { Text(field.note).font(.caption).foregroundStyle(.secondary) }
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder private var input: some View {
        switch field.input {
        case .boolean:
            Toggle("Value", isOn: Binding(get: { value.wrappedValue == "true" }, set: { value.wrappedValue = String($0) }))
        case .choice(let choices):
            Picker("Value", selection: value) {
                ForEach(choices, id: \.self) { Text($0).tag($0) }
            }
            #if os(tvOS)
            .pickerStyle(.inline)
            #endif
        case .text, .url, .number:
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
            Text("JavaScript function body; input contains the callback arguments.")
                .font(.caption).foregroundStyle(.secondary)
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
