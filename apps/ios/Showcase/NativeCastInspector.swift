#if !os(tvOS)
import SwiftUI
import UIKit

struct NativeCastInspector: View {
    @ObservedObject var workbench: NativeCastWorkbench
    @Environment(\.dismiss) private var dismiss
    @State private var operation = NativeCastOperation.initializeOptions
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Text("Google Cast APIs").font(.title2).bold(); Spacer(); Button("Close") { dismiss() }.accessibilityIdentifier("cast.close") }
            Form {
                Section(header: Text("Initialization and receiver options")) {
                    Text("Google Cast 4.8.6 requires iOS 16 or later. Initialization is once per app process. Changing initialized options saves them for the next launch. A compatible receiver and local-network permission are required for receiver playback.").font(.caption)
                    input("Receiver application ID (empty uses SDK default)", value: $workbench.settings.applicationId, id: "cast.applicationId")
                    input("Message namespace (optional urn:x-cast:…)", value: $workbench.settings.messageNamespace, id: "cast.namespace")
                    Toggle("Enable background sessions", isOn: $workbench.settings.backgroundSessions).accessibilityIdentifier("cast.background")
                    Picker("Device discovery", selection: $workbench.settings.discoveryMode) { Text("At manager initialization").tag("castManagerInitialization"); Text("At Cast button interaction").tag("castButtonInteraction") }
                        .accessibilityIdentifier("cast.discovery")
                    Toggle("Stop receiver when ending session", isOn: $workbench.settings.stopReceiver).accessibilityIdentifier("cast.stopReceiver")
                    Text("Custom receivers also need their _APPID._googlecast._tcp service in Info.plist and a rebuild. The default receiver service is included. Initialize casting before enabling the player's Cast setting.").font(.caption)
                    Button("Disable automatic initialization next launch") { workbench.stopAutomaticInitialization() }
                        .accessibilityIdentifier("cast.startup.disable")
                }
                Section(header: Text("Operation and arguments")) {
                    Picker("Operation", selection: $operation) { ForEach(NativeCastOperation.allCases) { Text($0.rawValue).tag($0) } }.accessibilityIdentifier("cast.operation")
                    if [.loadAutoplay, .loadPosition].contains(operation) { Toggle("Autoplay", isOn: $workbench.autoplay).accessibilityIdentifier("cast.autoplay") }
                    if [.loadPosition, .seek, .seekItem].contains(operation) { input("Position (seconds)", value: $workbench.time, id: "cast.time") }
                    if [.seekItem, .itemId].contains(operation) { input(operation == .itemId ? "Receiver queue index (zero-based)" : "Receiver item ID", value: $workbench.item, id: "cast.item") }
                    if [.message, .namespacedMessage].contains(operation) { input("Message", value: $workbench.message, id: "cast.message") }
                    if operation == .metadata { TextEditor(text: $workbench.metadata).font(.system(.caption, design: .monospaced)).frame(minHeight: 140).accessibilityIdentifier("cast.metadata") }
                    Button("Run Cast API") { do { try workbench.run(operation); error = nil } catch { self.error = error.localizedDescription } }.accessibilityIdentifier("cast.run")
                    if let error { Text(error).foregroundStyle(.red).accessibilityIdentifier("cast.error") }
                    Text(workbench.result).font(.caption).accessibilityIdentifier("cast.result")
                }
                Section(header: Text("Current SDK state")) {
                    Button("Refresh Cast state") { workbench.refresh() }.accessibilityIdentifier("cast.refresh")
                    ForEach(workbench.state) { row in VStack(alignment: .leading) { Text(row.id).font(.caption).foregroundStyle(.secondary); Text(row.value).font(.system(.caption, design: .monospaced)).accessibilityIdentifier("cast.state." + row.id) } }
                }
                Section(header: Text("Operation code")) { Text(workbench.code).font(.system(.caption, design: .monospaced)).textSelection(.enabled).accessibilityIdentifier("cast.code") }
                Section(header: Text("Listener notifications")) {
                    Text("Use add(listener:) to record callbacks; remove(listener:) stops them. The newest 80 event names are retained. Device names and message payloads are omitted.").font(.caption)
                    ForEach(Array(workbench.events.enumerated()), id: \.offset) { _, event in Text(event).font(.caption) }
                }
            }.accessibilityIdentifier("cast.form")
        }.padding().onAppear { workbench.refresh() }
        .toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }.accessibilityIdentifier("cast.keyboard.done") } }
    }
    private func input(_ label: String, value: Binding<String>, id: String) -> some View {
        VStack(alignment: .leading, spacing: 4) { Text(label).font(.caption); TextField("Value", text: value).textInputAutocapitalization(.never).disableAutocorrection(true).accessibilityIdentifier(id) }
    }
}
#endif
