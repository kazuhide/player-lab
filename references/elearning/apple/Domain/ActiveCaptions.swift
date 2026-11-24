/// Cue exits can arrive out of order when subtitle cues overlap.
struct ActiveCaptions {
    private struct Cue: Equatable {
        let start: Double
        let end: Double
        let text: String
    }
    private var cues: [Cue] = []

    var text: String? {
        cues.isEmpty ? nil : cues.map(\.text).joined(separator: "\n")
    }

    mutating func enter(start: Double, end: Double, text: String?) {
        guard let text, !text.isEmpty else { return }
        let cue = Cue(start: start, end: end, text: text)
        if !cues.contains(cue) { cues.append(cue) }
    }

    mutating func exit(start: Double, end: Double, text: String?) {
        guard let text else { return }
        cues.removeAll { $0 == Cue(start: start, end: end, text: text) }
    }
}
