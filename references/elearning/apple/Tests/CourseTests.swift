import XCTest
@testable import ReferenceDomain

final class CourseTests: XCTestCase {
    func testPublisherCatalogUsesCourseOrder() throws {
        let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../fixtures/catalog.json")
        let catalog = try JSONDecoder().decode(CourseCatalog.self, from: Data(contentsOf: fixture))
        let course = try XCTUnwrap(catalog.courses.first)
        XCTAssertEqual(catalog.orderedLessons(in: course).map(\.id), course.lessonIds)
        XCTAssertEqual(catalog.orderedLessons(in: course).last?.subtitleTracks.count, 0)
    }

    func testSearchPreservesOriginalCueTimeAndLanguage() throws {
        let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../fixtures/transcripts/EDU-FX-01.json")
        let transcript = try JSONDecoder().decode(Transcript.self, from: Data(contentsOf: fixture))
        let results = transcript.search("compare", in: "en")
        XCTAssertEqual(results.map(\.startMs), [10_000])
        XCTAssertTrue(transcript.search("compare", in: "ja").isEmpty)
    }

    func testResumeRejectsEndAndKeepsLearnersSeparate() {
        let saved = Progress(seconds: 12, speed: 1.5, language: "ja", standard: false)
        XCTAssertTrue(saved.canResume(duration: 12.1))
        XCTAssertFalse(saved.canResume(duration: 12))
        XCTAssertFalse(saved.canResume(duration: .nan))
        XCTAssertNotEqual(Progress.key(learner: "A", lesson: "1"), Progress.key(learner: "B", lesson: "1"))
    }
}
