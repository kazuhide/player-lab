import SwiftUI
import BitmovinPlayer
#if !os(tvOS)
import UIKit
#endif

private enum ApiInspectorPane: String, CaseIterable, Identifiable {
    case operations = "Operations", state = "State", events = "Events", host = "Host"
    var id: String { rawValue }
}

struct ApiInspector: View {
    @Environment(\.workspaceActive) private var workspaceActive
    @Environment(\.workspaceChoicePresented) private var choicePresented
    @Environment(\.workspaceKeyboardVisible) private var keyboardVisible
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @ObservedObject var model: PlayerModel
    var embedded = false
    @Environment(\.dismiss) private var dismiss
    @State private var operation = ApiOperation.play
    @State private var arguments: [String: String] = [:]
    @State private var selectedArgument = ""
    @State private var error: String?
    @State private var eventFilter = ""
    @State private var operationFilter = ""
    @State private var stateFilter = ""
    @State private var pane = ApiInspectorPane.operations
    @State private var hostSetting = NativeHostSetting.factory
    @State private var group = NativeApiGroup.all
    @State private var showsCode = false
    @State private var showsOperations = false
    @State private var observationTime: Date?
    @State private var observationOwner: UUID?
    @State private var invocationResult: String?
    @State private var invocationOwner: UUID?
    @State private var showsResultDetails = false

    private var matchingOperations: [ApiOperation] {
        ApiOperation.allCases.filter {
            group.contains($0) && (operationFilter.isEmpty || $0.rawValue.localizedCaseInsensitiveContains(operationFilter) || $0.displayName.nativeLocalized.localizedCaseInsensitiveContains(operationFilter))
        }
    }
    private var selectionMatches: Bool { matchingOperations.contains(operation) }
    private var currentArgument: ApiArgument? {
        operation.arguments.first(where: { $0.id == selectedArgument }) ?? operation.arguments.first
    }

    var body: some View {
        Group {
        if workspaceActive {
        VStack(alignment: .leading, spacing: 10) {
            if !embedded {
                HStack {
                    Text("APIs").font(.headline)
                    Spacer()
                    Button("Close") { dismiss() }.accessibilityIdentifier("api.close")
                }
            }
            paneSelector
                .fixedSize(horizontal: false, vertical: true)
                .frame(height: keyboardVisible && !choicePresented ? 0 : nil).clipped().accessibilityHidden(keyboardVisible && !choicePresented)
            Group {
                switch pane {
                case .operations:
                    if showsOperations { operationChooser }
                    else { operationEditor }
                case .state: statePane
                case .events: eventsPane
                case .host: NativeApiHostSettings(model: model, setting: $hostSetting)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(.vertical, 8)
        }
        }
        .onAppear { readRelatedState() }
        .onChange(of: operation) { _ in
            arguments.removeAll()
            selectedArgument = ""
            error = nil
            invocationResult = nil
            invocationOwner = nil
            showsOperations = false
            readRelatedState()
        }
        .onChange(of: pane) { _ in if pane == .state { model.refreshApiState() } }
        .onChange(of: model.apiObservationRevision) { revision in
            if invocationOwner != revision {
                invocationResult = nil
                invocationOwner = nil
                error = nil
            }
            readRelatedState()
        }
        .alert("API invocation", isPresented: $showsResultDetails) {
            Button("Close", role: .cancel) {}
        } message: { Text(NativeLocalization.format("Target: %@", operation.rawValue) + "\n\n" + NativeLocalization.operationResult(error ?? invocationResult ?? "No invocation for the selected operation and current player/source.")) }

    }

    @ViewBuilder private var paneSelector: some View {
        if typeSize.isAccessibilitySize {
            WorkspaceChoice(title: "Inspect", selection: $pane, options: ApiInspectorPane.allCases, label: { $0.rawValue })
            .accessibilityIdentifier("api.pane")
            .font(.caption)
        } else {
            Picker("Inspect", selection: $pane) {
                ForEach(ApiInspectorPane.allCases) { Text(LocalizedStringKey($0.rawValue)).tag($0).accessibilityIdentifier("api.pane.\($0.rawValue)") }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("api.pane")
        }
    }

    private var operationChooser: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Choose an operation").font(.headline)
                Spacer()
                Button("Back") { showsOperations = false }.accessibilityIdentifier("api.operation.back")
            }
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            TextField("Filter operation name", text: $operationFilter)
                .disableAutocorrection(true)
                .accessibilityIdentifier("api.operation.filter")
            WorkspaceChoice(title: "Feature", selection: $group, options: NativeApiGroup.allCases, label: { $0.rawValue })
            .accessibilityIdentifier("api.operation.group")
            Text("Search filters candidates. Select a row to change the execution target.")
                .font(.caption).foregroundStyle(Color.workspaceSecondary)
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            if matchingOperations.isEmpty {
                Text("No matching API. Clear the search or choose another feature.")
                    .font(.subheadline)
            }
            List(matchingOperations) { candidate in
                Button {
                    if candidate == operation { showsOperations = false }
                    else { operation = candidate }
                } label: {
                    HStack(alignment: .top) {
                        Text(LocalizedStringKey(candidate.displayName)).font(.subheadline)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer()
                        if candidate == operation { Image(systemName: "checkmark").accessibilityLabel("Selected") }
                    }
                }
                .accessibilityIdentifier("api.operation.select.\(candidate.id)")
                .accessibilityLabel(candidate.rawValue)
                .accessibilityAddTraits(candidate == operation ? .isSelected : [])
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            }
            .accessibilityIdentifier("api.operation.results")
        }
    }

    private var operationEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
              Button { showsOperations = true } label: {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(LocalizedStringKey(operation.displayName)).font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").font(.caption)
                }
            }
            .accessibilityIdentifier("api.operation")
            .accessibilityLabel("Choose operation. Current: \(operation.rawValue)")
            .frame(minHeight: 44)
              if !keyboardVisible {
                Button((showsCode ? "Arguments" : "Code").nativeLocalized) { showsCode.toggle() }
                    .font(.caption).frame(minHeight: 44)
                    .accessibilityIdentifier("api.code.enabled")
                    .accessibilityValue((showsCode ? "Code shown" : "Arguments shown").nativeLocalized)
              }
            }
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .fixedSize(horizontal: false, vertical: true)
            .frame(height: keyboardVisible && !choicePresented ? 0 : nil)
            .clipped()
            .accessibilityHidden(keyboardVisible && !choicePresented)
            if !operationFilter.isEmpty && !selectionMatches {
                HStack(alignment: .top) {
                    Text(selectionMatches ? NativeLocalization.format("Filter: %@", operationFilter) : NativeLocalization.format("Selected API does not match “%@”. Choose a result or clear the filter.", operationFilter))
                        .font(.caption).foregroundStyle(Color.workspaceSecondary)
                    Spacer()
                    Button("Clear") { operationFilter = ""; group = .all }.font(.caption)
                        .accessibilityIdentifier("api.operation.clear")
                }
            }
            if operation.arguments.count > 1 { HStack {
                if let argument = currentArgument {
                    WorkspaceChoice(title: "Argument", selection: Binding(get: { argument.id }, set: { selectedArgument = $0 }), options: operation.arguments.map(\.id), label: { id in operation.arguments.first(where: { $0.id == id })?.label ?? id })
                    .accessibilityIdentifier("api.argument.selector")
                    .font(.caption)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(height: keyboardVisible && !choicePresented ? 0 : nil)
            .clipped()
            .accessibilityHidden(keyboardVisible && !choicePresented)
            }
            if showsCode {
                WorkspaceCode(code: (try? operation.code(arguments: arguments, parsedCues: model.apiObjects.parsedCues)) ?? "// Correct the arguments to show valid code.", identifier: "api.code")
            } else {
                ScrollView {
                    WorkspaceCard {
                        if let argument = currentArgument { argumentField(argument) }
                        else { Text("This API has no arguments.").font(.caption).foregroundStyle(Color.workspaceSecondary) }
                        Text(operation.rawValue).font(.caption).foregroundStyle(Color.workspaceSecondary)
                        relatedState
                        NativeApiObjectPreview(objects: model.apiObjects)
                    }
                }
                .accessibilityIdentifier("api.form")
            }
            if workspaceActive { VStack(alignment: .leading, spacing: 6) {
                HStack {
                  Text(NativeLocalization.format("Run target: %@", operation.displayName.nativeLocalized))
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                    .accessibilityIdentifier("api.target")
                    .accessibilityLabel("Run target: \(operation.rawValue)")
                  if verticalSizeClass == .compact {
                    Spacer(minLength: 0)
                    Button { showsResultDetails = true } label: { Image(systemName: "info.circle").frame(width: 44, height: 44).contentShape(Rectangle()) }
                        .accessibilityLabel("API invocation details")
                        .buttonStyle(.plain)
                  }
                }
                HStack {
                    Button("Run API") {
                        #if !os(tvOS)
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                        #endif
                        do {
                            try model.executeApi(operation, arguments: arguments)
                            invocationResult = model.apiResult
                            invocationOwner = model.apiObservationRevision
                            error = nil
                            readRelatedState()
                        } catch {
                            invocationResult = nil
                            invocationOwner = nil
                            self.error = error.localizedDescription
                            showsCode = false
                            if let argument = operation.arguments.first(where: { error.localizedDescription.contains($0.label) }) {
                                selectedArgument = argument.id
                            }
                        }
                    }
                    #if os(tvOS)
                    .buttonStyle(.borderedProminent)
                    #else
                    .buttonStyle(WorkspacePrimaryButtonStyle())
                    #endif
                    .controlSize(.large)
                    .disabled(!selectionMatches)
                    .accessibilityIdentifier("api.run")
                    Spacer()
                    Button("Read state") { readRelatedState() }
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("api.related.refresh")
                    Button("Events") { pane = .events }
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("api.related.events")
                }
                .font(.caption)
                if let error {
                    Text("API request rejected. Open Details.")
                        .font(.caption).foregroundStyle(.red).accessibilityIdentifier("api.error")
                        .lineLimit(1)
                        .accessibilityLabel(error)
                }
                if !keyboardVisible && verticalSizeClass != .compact { HStack(alignment: .center) {
                    Text(LocalizedStringKey(invocationResult == nil ? "No invocation" : "Invocation recorded"))
                        .font(.caption)
                        .lineLimit(1)
                        .accessibilityIdentifier("api.result")
                        .accessibilityLabel(NativeLocalization.operationResult(invocationResult ?? "No invocation for this selection and current player/source."))
                    Spacer(minLength: 0)
                    Button("Details") { showsResultDetails = true }.font(.caption)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("api.result.details")
                } }
            }
            .padding(10)
            .background(.background, in: RoundedRectangle(cornerRadius: 12))
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            }
        }
    }

    private func readRelatedState() {
        model.refreshApiState()
        observationTime = Date()
        observationOwner = model.apiObservationRevision
    }

    private var relatedState: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Related SDK state").font(.subheadline.weight(.semibold))
            ForEach(operation.relatedStateIDs, id: \.self) { id in
                VStack(alignment: .leading, spacing: 2) {
                    Text(id).font(.caption).foregroundStyle(Color.workspaceSecondary)
                    Text(model.apiState.first(where: { $0.id == id })?.value ?? "Not available in this SDK snapshot")
                        .font(.system(.caption, design: .monospaced))
                        .accessibilityIdentifier("api.related.\(id)")
                }
            }
            if let observationTime {
                Text(NativeLocalization.format("Player/source: %@", observationOwner.map { String($0.uuidString.prefix(8)) } ?? "unknown"))
                    .font(.caption2).foregroundStyle(Color.workspaceSecondary)
                    .accessibilityIdentifier("api.observation.owner")
                Text(NativeLocalization.format("Read at %@. A snapshot does not prove asynchronous completion.", observationTime.formatted(date: .omitted, time: .standard)))
                    .font(.caption2).foregroundStyle(Color.workspaceSecondary)
            }
            if let event = model.apiEvents.first {
                Text(NativeLocalization.format("Latest retained event (history): %@ · SDK %@", event.api, String(describing: event.timestamp)))
                    .font(.caption).foregroundStyle(Color.workspaceSecondary)
            } else {
                Text(LocalizedStringKey(model.apiEventsEnabled ? "No SDK events recorded yet." : "SDK event recording is off."))
                    .font(.caption).foregroundStyle(Color.workspaceSecondary)
            }
        }
    }

    private var statePane: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("Filter state API name", text: $stateFilter)
                    .disableAutocorrection(true)
                    .accessibilityIdentifier("api.state.filter")
                Button("Refresh") { model.refreshApiState() }.accessibilityIdentifier("api.refresh")
            }
            Text("Snapshot from the current SDK player, source and view. Invocation and completion are separate observations.")
                .font(.caption).foregroundStyle(Color.workspaceSecondary)
            List(model.apiState.filter { stateFilter.isEmpty || $0.id.localizedCaseInsensitiveContains(stateFilter) }) { state in
                VStack(alignment: .leading, spacing: 4) {
                    Text(state.id).font(.caption).foregroundStyle(Color.workspaceSecondary)
                    Text(state.value.isEmpty ? "Empty" : state.value).font(.system(.caption, design: .monospaced))
                        .accessibilityIdentifier("api.state.\(state.id)")
                }
                #if os(tvOS)
                .focusable()
                #endif
            }
            .accessibilityIdentifier("api.form")
        }
    }

    private var eventsPane: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Toggle("Record callbacks", isOn: Binding(get: { model.apiEventsEnabled }, set: { model.setApiEventRecording($0) }))
                    .accessibilityIdentifier("api.events.enabled")
                Button("Clear") { model.clearApiEvents() }.accessibilityIdentifier("api.events.clear")
            }
            Picker("Subscription transport", selection: Binding(get: { model.apiEventTransport }, set: { model.setApiEventTransport($0) })) {
                ForEach(NativeEventTransport.allCases) { Text(LocalizedStringKey($0.rawValue)).tag($0) }
            }
            .accessibilityIdentifier("api.events.transport")
            TextField("Filter event name or owner", text: $eventFilter)
                .disableAutocorrection(true)
                .accessibilityIdentifier("api.events.filter")
            Text("Newest 120 records: API identity, owner and SDK timestamp. Registered callbacks do not prove occurrence; owners may report the same event.")
                .font(.caption).foregroundStyle(Color.workspaceSecondary)
            if model.apiEvents.isEmpty {
                Text(LocalizedStringKey(model.apiEventsEnabled ? "No SDK events recorded yet." : "Event recording is off."))
                    .font(.subheadline)
            }
            List {
                ForEach(model.apiEvents.filter { eventFilter.isEmpty || $0.api.localizedCaseInsensitiveContains(eventFilter) || $0.owner.localizedCaseInsensitiveContains(eventFilter) }) { event in
                    Text("\(event.owner) · \(event.api)\nSDK timestamp: \(event.timestamp)")
                        .font(.caption).monospacedDigit()
                        .accessibilityIdentifier("api.event.\(event.api)")
                        #if os(tvOS)
                        .focusable()
                        #endif
                }
            }
            .accessibilityIdentifier("api.form")
        }
    }

    @ViewBuilder
    private func argumentField(_ argument: ApiArgument) -> some View {
        let binding = Binding(get: { arguments[argument.id] ?? argument.initial }, set: { arguments[argument.id] = $0 })
        switch argument.input {
        case .boolean:
            Toggle(argument.label.nativeLocalized, isOn: Binding(get: { binding.wrappedValue == "true" }, set: { binding.wrappedValue = String($0) }))
                .accessibilityIdentifier("api.argument.\(argument.id)")
        case .choice(let values):
            Picker(argument.label.nativeLocalized, selection: binding) { ForEach(values, id: \.self) { Text($0).tag($0) } }
                #if os(tvOS)
                .pickerStyle(.inline)
                #endif
                .accessibilityIdentifier("api.argument.\(argument.id)")
        case .json, .script:
            VStack(alignment: .leading, spacing: 4) {
                Text(LocalizedStringKey(argument.label)).font(.caption).foregroundStyle(Color.workspaceSecondary)
                #if os(tvOS)
                TextField("JSON or function body", text: binding).disableAutocorrection(true)
                    .accessibilityIdentifier("api.argument.\(argument.id)")
                #else
                TextEditor(text: binding).font(.system(.caption, design: .monospaced)).frame(minHeight: 140)
                    .textInputAutocapitalization(.never).disableAutocorrection(true)
                    .accessibilityIdentifier("api.argument.\(argument.id)")
                #endif
                if case .script = argument.input {
                    Text("This function uses a JavaScript subset with CPU, elapsed-time and value-size limits. Use let or const; no network or native object access is exposed.").font(.caption).foregroundStyle(Color.workspaceSecondary)
                    Link("Supported syntax and limits", destination: URL(string: "https://github.com/kazuhide/player-lab/blob/main/apps/ios/Showcase/NativeScripts/README.md")!).font(.caption)
                }
                if !argument.note.isEmpty { Text(LocalizedStringKey(argument.note)).font(.caption).foregroundStyle(Color.workspaceSecondary) }
            }
        default:
            VStack(alignment: .leading, spacing: 4) {
                Text(LocalizedStringKey(argument.label)).font(.caption).foregroundStyle(Color.workspaceSecondary)
                TextField("Value", text: binding).disableAutocorrection(true)
                    #if !os(tvOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .accessibilityIdentifier("api.argument.\(argument.id)")
            }
        }
    }
}
