import SwiftUI
#if os(iOS)
import CoreTransferable
import UniformTypeIdentifiers

private struct HandoffFile: Transferable {
    let data: Data
    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .json) { (item: Self) in item.data }
            .suggestedFileName("sports-handoffs.json")
    }
}
#endif

struct HandoffRecords: View {
    let data: Data
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Handoff records").font(.title)
                Button("Close") { dismiss() }
                #if os(iOS)
                ShareLink(item: HandoffFile(data: data), preview: SharePreview("Handoff records")) {
                    Label("Share JSON", systemImage: "square.and.arrow.up")
                }
                #endif
                Text(verbatim: String(decoding: data, as: UTF8.self))
                    .font(.system(.body, design: .monospaced))
                    #if os(tvOS)
                    .focusable()
                    #else
                    .textSelection(.enabled)
                    #endif
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding()
        }
    }
}
