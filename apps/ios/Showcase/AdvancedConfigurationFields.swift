import SwiftUI

struct AdvancedConfigurationFields: View {
    @Binding var values: [String: String]

    var body: some View {
        ForEach(ConfigurationOwner.allCases, id: \.self) { owner in
            Text(owner.rawValue).font(.headline)
            ForEach(AdvancedConfiguration.fields.filter { $0.owner == owner }) { field in
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
        }
    }
}
