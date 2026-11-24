import Foundation

struct Course: Decodable, Identifiable {
    let id: String
    let title: String
    let titleJa: String?
    var displayTitle: String { Locale.preferredLanguages.first?.hasPrefix("ja") == true ? titleJa ?? title : title }
    let lessonIds: [String]
}

struct CourseCatalog: Decodable {
    let courses: [Course]
    let lessons: [Lesson]

    func orderedLessons(in course: Course?) -> [Lesson] {
        (course?.lessonIds ?? []).compactMap { id in lessons.first { $0.id == id } }
    }
}

struct Lesson: Decodable, Identifiable {
    struct Delivery: Decodable {
        let hls: String
        let hlsWithSubtitles: String?
    }
    struct Track: Decodable {
        let url: String
        let language: String
        let label: String
    }
    let id: String
    let videoId: String
    let title: String
    let titleJa: String?
    var displayTitle: String { Locale.preferredLanguages.first?.hasPrefix("ja") == true ? titleJa ?? title : title }
    let streams: Delivery
    let subtitleTracks: [Track]
    let transcriptUrl: String?
}

struct Transcript: Decodable {
    struct Cue: Decodable {
        let startMs: Double
        let endMs: Double
        let text: String
        let language: String
    }
    let cues: [Cue]
    func search(_ query: String, in language: String) -> [Cue] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return cues.filter { $0.language == language && (query.isEmpty || $0.text.localizedCaseInsensitiveContains(query)) }
    }
}

struct Progress: Codable {
    let seconds: Double
    let speed: Float
    let language: String
    let standard: Bool?
    func canResume(duration: Double) -> Bool {
        seconds.isFinite && seconds > 0 && duration.isFinite && seconds < duration
    }
    static func key(learner: String, lesson: String) -> String {
        "learning.progress.\(learner).\(lesson)"
    }
}
