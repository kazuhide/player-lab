import SwiftUI
import BitmovinPlayer

struct PlaybackControls: View {
    @ObservedObject var session: Playback
    let modeName: LocalizedStringKey
    let showsExternalCaptions: Bool
    @State private var diagnostics = false
    @State private var fullscreen = false

    private var renderExternalCaptions: Bool {
        #if os(iOS)
        return showsExternalCaptions && !session.standardControls
        #else
        return showsExternalCaptions
        #endif
    }

    var body: some View {
        if let player = session.player {
            if !fullscreen { surface(player) }
            HStack {
                Button(session.standardControls ? modeName : "Standard controls") {
                    session.standardControls.toggle()
                }
                Button("Fullscreen") { fullscreen = true }
                Button("Diagnostics") { diagnostics = true }
                #if os(iOS)
                AirPlayPicker().frame(width: 44, height: 44)
                #endif
            }
            if !session.standardControls { transport(player) }
        } else {
            Text("Set the Player license in Local.xcconfig and rebuild.")
        }
        if let problem = session.problem { Text(verbatim: NSLocalizedString(problem, comment: "")) }
        Color.clear.frame(height: 0).sheet(isPresented: $diagnostics) {
            ScrollView {
                VStack(alignment: .leading) {
                    Text("Diagnostics").font(.title)
                    ForEach(Array(session.diagnostics.enumerated()), id: \.offset) { _, item in Text(verbatim: item) }
                    Button("Clear") { session.diagnostics.removeAll() }
                    Button("Close") { diagnostics = false }
                }.padding()
            }
        }
        .fullScreenCover(isPresented: $fullscreen) {
            if let player = session.player {
                VStack {
                    surface(player)
                    if !session.standardControls { transport(player) }
                    Button("Exit fullscreen") { fullscreen = false }
                }.frame(maxWidth: .infinity, maxHeight: .infinity).background(.black).preferredColorScheme(.dark)
            }
        }
    }

    private func surface(_ player: Player) -> some View {
        ZStack(alignment: .bottom) {
            PlayerSurface(player: player, standardControls: session.standardControls,
                          isFullscreen: fullscreen, toggleFullscreen: { fullscreen.toggle() })
                .id(ObjectIdentifier(player))
            if renderExternalCaptions, let caption = session.captionText {
                Text(verbatim: caption).foregroundStyle(.white).padding(4)
                    .background(.black.opacity(0.8)).padding(.bottom, 12)
                    .allowsHitTesting(false)
            }
        }
        .aspectRatio(16/9, contentMode: .fit)
        .background(.black)
    }

    private func transport(_ player: Player) -> some View {
        HStack {
            Button("−10 s") { session.seek(by: -10) }
            Button(LocalizedStringKey(session.playing ? "Pause" : "Play")) {
                if session.playing { player.pause() } else { player.play() }
            }
            Button("+10 s") { session.seek(by: 10) }
            Text(verbatim: session.position.map(Media.clock) ?? "—").monospacedDigit()
        }.disabled(!session.ready)
    }
}
