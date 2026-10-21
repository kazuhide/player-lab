import SwiftUI
#if !os(tvOS)
import UIKit
#endif

private enum ApiInspectorPane: String, CaseIterable, Identifiable {
    case operations = "Operations", state = "State", events = "Events"
    var id: String { rawValue }
}

struct ApiInspector: View {
    @ObservedObject var model: PlayerModel
    @Environment(\.dismiss) private var dismiss
    @State private var operation = ApiOperation.play
    @State private var arguments: [String: String] = [:]
    @State private var error: String?
    @State private var eventFilter = ""
    @State private var operationFilter = ""
    @State private var stateFilter = ""
    @State private var pane = ApiInspectorPane.operations
    @State private var showsCode = false
    @State private var showsOperations = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("API inspector").font(.title2).bold()
                Spacer()
                Button("Close") { dismiss() }.accessibilityIdentifier("api.close")
            }
            Picker("Inspect", selection: $pane) {
                ForEach(ApiInspectorPane.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("api.pane")
            Form {
                Section(header: Text("Player view host")) {
                    Toggle("Use native PlayerView host", isOn: Binding(get: { model.usesNativeApiHost }, set: { model.setNativeApiHost($0) }))
                        .accessibilityIdentifier("api.nativeHost")
                    Text("Changing host recreates the player and reloads the applied source. Native PlayerView exposes fullscreen, Picture-in-Picture and view events. The original SDK SwiftUI host remains the default.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if pane == .operations {
                  Section(header: Text("SDK operation")) {
                    TextField("Filter operation name", text: $operationFilter)
                        .disableAutocorrection(true)
                        .accessibilityIdentifier("api.operation.filter")
                    #if os(tvOS)
                    Button("Operation: \(operation.rawValue)") { showsOperations = true }
                        .accessibilityIdentifier("api.operation")
                    #else
                    Picker("Operation", selection: $operation) {
                        ForEach(ApiOperation.allCases.filter { $0 == operation || operationFilter.isEmpty || $0.rawValue.localizedCaseInsensitiveContains(operationFilter) }) { Text($0.rawValue).tag($0) }
                    }
                    .accessibilityIdentifier("api.operation")
                    #endif
                    ForEach(operation.arguments) { argument in
                        argumentField(argument)
                    }
                    Button("Run API") {
                        do { try model.executeApi(operation, arguments: arguments); error = nil }
                        catch { self.error = error.localizedDescription }
                    }
                    .accessibilityIdentifier("api.run")
                    if let error { Text(error).foregroundStyle(.red).accessibilityIdentifier("api.error") }
                    Text(model.apiResult).font(.caption).accessibilityIdentifier("api.result")
                    NativeApiObjectPreview(objects: model.apiObjects)
                    Toggle("Show operation code", isOn: $showsCode).accessibilityIdentifier("api.code.enabled")
                    if showsCode {
                        Text((try? operation.code(arguments: arguments, parsedCues: model.apiObjects.parsedCues)) ?? "Correct the arguments to show valid code.")
                            .font(.system(.caption, design: .monospaced))
                            .accessibilityIdentifier("api.code")
                            #if os(tvOS)
                            .focusable()
                            #else
                            .textSelection(.enabled)
                            #endif
                    }
                  }
                }
                if pane == .state {
                  Section(header: Text("SDK state")) {
                    Button("Refresh SDK state") { model.refreshApiState() }.accessibilityIdentifier("api.refresh")
                    TextField("Filter state API name", text: $stateFilter)
                        .disableAutocorrection(true)
                        .accessibilityIdentifier("api.state.filter")
                    Text("Values are read on demand from the current SDK player, source and view. Invoking an API is distinct from its completion event or effective playback behavior. Empty lists and unavailable media are reported explicitly.")
                        .font(.caption).foregroundStyle(.secondary)
                    ForEach(model.apiState.filter { stateFilter.isEmpty || $0.id.localizedCaseInsensitiveContains(stateFilter) }) { state in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(state.id).font(.caption).foregroundStyle(.secondary)
                            Text(state.value.isEmpty ? "Empty" : state.value).font(.system(.caption, design: .monospaced))
                                .accessibilityIdentifier("api.state.\(state.id)")
                        }
                        #if os(tvOS)
                        .focusable()
                        #endif
                    }
                  }
                }
                if pane == .events {
                  Section(header: Text("SDK events")) {
                    Toggle("Record typed SDK callbacks", isOn: Binding(get: { model.apiEventsEnabled }, set: { model.setApiEventRecording($0) }))
                        .accessibilityIdentifier("api.events.enabled")
                    TextField("Filter event name or owner", text: $eventFilter)
                        .disableAutocorrection(true)
                        .accessibilityIdentifier("api.events.filter")
                    Button("Clear events") { model.clearApiEvents() }.accessibilityIdentifier("api.events.clear")
                    Text("The newest events are retained with a limit of 120 records. Only API identity, owner and SDK timestamp are shown. Registered callbacks do not prove that every event has occurred. Source and Player callbacks can report the same event through their respective owners.")
                        .font(.caption).foregroundStyle(.secondary)
                    ForEach(model.apiEvents.filter { eventFilter.isEmpty || $0.api.localizedCaseInsensitiveContains(eventFilter) || $0.owner.localizedCaseInsensitiveContains(eventFilter) }) { event in
                        Text("\(event.owner) · \(event.api)\nSDK timestamp: \(event.timestamp)")
                            .font(.system(.caption, design: .monospaced))
                            .accessibilityIdentifier("api.event.\(event.api)")
                            #if os(tvOS)
                            .focusable()
                            #endif
                    }
                  }
                }
            }
            .id(pane)
            .accessibilityIdentifier("api.form")
        }
        .padding()
        #if os(tvOS)
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
        #endif
        .onAppear { model.refreshApiState() }
        .onChange(of: operation) { _ in arguments.removeAll(); error = nil }
        .onChange(of: pane) { _ in if pane == .state { model.refreshApiState() } }
        #if os(tvOS)
        .fullScreenCover(isPresented: $showsOperations) {
            TvApiOperationSelector(selection: $operation)
        }
        #else
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
                    .accessibilityIdentifier("api.keyboard.done")
            }
        }
        #endif
    }

    @ViewBuilder
    private func argumentField(_ argument: ApiArgument) -> some View {
        let binding = Binding(get: { arguments[argument.id] ?? argument.initial }, set: { arguments[argument.id] = $0 })
        switch argument.input {
        case .boolean:
            Toggle(argument.label, isOn: Binding(get: { binding.wrappedValue == "true" }, set: { binding.wrappedValue = String($0) }))
                .accessibilityIdentifier("api.argument.\(argument.id)")
        case .choice(let values):
            Picker(argument.label, selection: binding) { ForEach(values, id: \.self) { Text($0).tag($0) } }
                #if os(tvOS)
                .pickerStyle(.inline)
                #endif
                .accessibilityIdentifier("api.argument.\(argument.id)")
        case .json, .script:
            VStack(alignment: .leading, spacing: 4) {
                Text(argument.label).font(.caption)
                #if os(tvOS)
                TextField("JSON or function body", text: binding).disableAutocorrection(true)
                    .accessibilityIdentifier("api.argument.\(argument.id)")
                #else
                TextEditor(text: binding).font(.system(.caption, design: .monospaced)).frame(minHeight: 140)
                    .textInputAutocapitalization(.never).disableAutocorrection(true)
                    .accessibilityIdentifier("api.argument.\(argument.id)")
                #endif
                if !argument.note.isEmpty { Text(argument.note).font(.caption).foregroundStyle(.secondary) }
            }
        default:
            VStack(alignment: .leading, spacing: 4) {
                Text(argument.label).font(.caption)
                TextField("Value", text: binding).disableAutocorrection(true)
                    #if !os(tvOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .accessibilityIdentifier("api.argument.\(argument.id)")
            }
        }
    }
}

#if os(tvOS)
private struct TvApiOperationSelector: View {
    @Binding var selection: ApiOperation
    @Environment(\.dismiss) private var dismiss
    @State private var filter = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Choose SDK operation").font(.title2)
                Spacer()
                Button("Cancel") { dismiss() }
            }
            TextField("Filter operation name", text: $filter)
                .disableAutocorrection(true)
                .accessibilityIdentifier("api.operation.selector.filter")
            List(ApiOperation.allCases.filter { filter.isEmpty || $0.rawValue.localizedCaseInsensitiveContains(filter) }) { operation in
                Button(operation.rawValue) { selection = operation; dismiss() }
                    .accessibilityIdentifier("api.operation.select.\(operation.id)")
            }
        }
        .padding(60)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
    }
}
#endif
