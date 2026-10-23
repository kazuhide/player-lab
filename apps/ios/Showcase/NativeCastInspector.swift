#if !os(tvOS)
import SwiftUI
import UIKit

private enum NativeCastPane: String, CaseIterable, Identifiable {
    case settings = "Receiver settings"
    case operations = "Operations"
    case state = "State"
    case code = "Code"
    case events = "Events"
    var id: String { rawValue }
}

struct NativeCastInspector: View {
    @ObservedObject var workbench: NativeCastWorkbench
    @Environment(\.dismiss) private var dismiss
    @State private var operation = NativeCastOperation.initializeOptions
    @State private var error: String?
    @State private var pane = NativeCastPane.settings
    @State private var setting = "Receiver application ID"
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Text("Google Cast APIs").font(.title2).bold(); Spacer(); Button("Close") { dismiss() }.accessibilityIdentifier("cast.close") }
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            WorkspaceChoice(title: "Section", selection: $pane, options: NativeCastPane.allCases, label: { $0.rawValue })
            .accessibilityIdentifier("cast.section")
            if pane == .settings {
                WorkspaceChoice(title: "Setting", selection: $setting, options: ["Receiver application ID", "Message namespace", "Background sessions", "Device discovery", "Stop receiver"], label: { $0 })
                .accessibilityIdentifier("cast.setting")
            }
            Form {
                if pane == .settings {
                Section(header: Text("Initialization and receiver options")) {
                    if setting == "Receiver application ID" { input("Receiver application ID (empty uses SDK default)", value: $workbench.settings.applicationId, id: "cast.applicationId") }
                    if setting == "Message namespace" { input("Message namespace (optional urn:x-cast:…)", value: $workbench.settings.messageNamespace, id: "cast.namespace") }
                    if setting == "Background sessions" {
                    Toggle("Enable background sessions", isOn: $workbench.settings.backgroundSessions).accessibilityIdentifier("cast.background")
                    }
                    if setting == "Device discovery" {
                    Picker("Device discovery", selection: $workbench.settings.discoveryMode) { Text("At manager initialization").tag("castManagerInitialization"); Text("At Cast button interaction").tag("castButtonInteraction") }
                        .accessibilityIdentifier("cast.discovery")
                    }
                    if setting == "Stop receiver" {
                    Toggle("Stop receiver when ending session", isOn: $workbench.settings.stopReceiver).accessibilityIdentifier("cast.stopReceiver")
                    }
                    DisclosureGroup("Receiver requirements") {
                        Text("Google Cast 4.8.6 requires iOS 16 or later. Initialization is once per app process. Changing initialized options saves them for the next launch. A compatible receiver and local-network permission are required for receiver playback.").font(.caption)
                        Text("Custom receivers also need their _APPID._googlecast._tcp service in Info.plist and a rebuild. The default receiver service is included. Initialize casting before enabling the player's Cast setting.").font(.caption)
                    }
                }
                }
                if pane == .operations {
                Section(header: Text("Operation and arguments")) {
                    Picker("Operation", selection: $operation) { ForEach(NativeCastOperation.allCases) { Text($0.rawValue).tag($0) } }.accessibilityIdentifier("cast.operation")
                    if [.loadAutoplay, .loadPosition].contains(operation) { Toggle("Autoplay", isOn: $workbench.autoplay).accessibilityIdentifier("cast.autoplay") }
                    if [.loadPosition, .seek, .seekItem].contains(operation) { input("Position (seconds)", value: $workbench.time, id: "cast.time") }
                    if [.seekItem, .itemId].contains(operation) { input(operation == .itemId ? "Receiver queue index (zero-based)" : "Receiver item ID", value: $workbench.item, id: "cast.item") }
                    if [.message, .namespacedMessage].contains(operation) { input("Message", value: $workbench.message, id: "cast.message") }
                    if operation == .metadata { TextEditor(text: $workbench.metadata).font(.system(.caption, design: .monospaced)).frame(minHeight: 140).accessibilityIdentifier("cast.metadata") }
                }
                }
                if pane == .state {
                Section(header: Text("Current SDK state")) {
                    Button("Refresh Cast state") { workbench.refresh() }.accessibilityIdentifier("cast.refresh")
                    ForEach(workbench.state) { row in VStack(alignment: .leading) { Text(row.id).font(.caption).foregroundStyle(Color.workspaceSecondary); Text(row.value).font(.system(.caption, design: .monospaced)).accessibilityIdentifier("cast.state." + row.id) } }
                }
                }
                if pane == .code {
                Section(header: Text("Operation code")) { Text(workbench.code).font(.system(.caption, design: .monospaced)).textSelection(.enabled).accessibilityIdentifier("cast.code") }
                }
                if pane == .events {
                Section(header: Text("Listener notifications")) {
                    Text("Use add(listener:) to record callbacks; remove(listener:) stops them. The newest 80 event names are retained. Device names and message payloads are omitted.").font(.caption)
                    ForEach(Array(workbench.events.enumerated()), id: \.offset) { _, event in Text(event).font(.caption) }
                }
                }
            }.accessibilityIdentifier("cast.form")
            VStack(alignment: .leading, spacing: 6) {
                Text("Run target: \(operation.rawValue)").font(.caption.weight(.semibold)).lineLimit(1)
                    .accessibilityLabel("Run target: \(operation.rawValue)")
                Button("Run Cast API") { do { try workbench.run(operation); error = nil } catch { self.error = error.localizedDescription } }
                    .buttonStyle(.borderedProminent).accessibilityIdentifier("cast.run")
                if pane == .settings {
                    Button("Disable automatic initialization next launch") { workbench.stopAutomaticInitialization() }
                        .accessibilityIdentifier("cast.startup.disable")
                }
                if let error { Text(error).font(.caption).foregroundStyle(.red).lineLimit(2).accessibilityIdentifier("cast.error") }
                Text(workbench.result).font(.caption).lineLimit(2).accessibilityIdentifier("cast.result")
            }
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .padding(10)
            .background(.background, in: RoundedRectangle(cornerRadius: 12))
        }.padding().onAppear { workbench.refresh() }
        .toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }.accessibilityIdentifier("cast.keyboard.done") } }
    }
    private func input(_ label: String, value: Binding<String>, id: String) -> some View {
        VStack(alignment: .leading, spacing: 4) { Text(label).font(.caption); TextField("Value", text: value).textInputAutocapitalization(.never).disableAutocorrection(true).accessibilityIdentifier(id) }
    }
}
#endif
