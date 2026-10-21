import SwiftUI
import UIKit

struct NativeApiObjectPreview: View {
    @ObservedObject var objects: NativeApiObjects
    var body: some View {
        if objects.showsThumbnailContainer {
            VStack(alignment: .leading, spacing: 4) {
                Text("SDK thumbnail rendering container").font(.caption)
                NativeThumbnailContainer(view: objects.thumbnailContainer)
                    .frame(height: 180).background(Color.black)
                    .accessibilityIdentifier("api.thumbnail.preview")
                Text("The SDK renders asynchronously into this UIView after a renderThumbnail operation. A blank container does not establish a rendered thumbnail.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

private struct NativeThumbnailContainer: UIViewRepresentable {
    let view: UIView
    func makeUIView(context: Context) -> UIView { view }
    func updateUIView(_ uiView: UIView, context: Context) {}
}
