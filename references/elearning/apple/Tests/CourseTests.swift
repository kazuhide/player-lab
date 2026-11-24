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
        let results = transcript.view(query: "compare", language: "en", seconds: 10, follow: true)
        XCTAssertEqual(results.rows.map { $0.cue.startMs }, [10_000])
        XCTAssertEqual(results.activeIDs, Set(results.rows.map(\.id)))
        XCTAssertNil(results.followID)
        let following = transcript.view(query: "", language: "en", seconds: 10, follow: true)
        XCTAssertEqual(following.followID, results.rows.first?.id)
        XCTAssertNil(transcript.view(query: "", language: "en", seconds: 10, follow: false).followID)
        XCTAssertTrue(transcript.view(query: "", language: "en", seconds: 15, follow: true).activeIDs.isEmpty)
        XCTAssertNil(transcript.view(query: "", language: "en", seconds: nil, follow: true).followID)
        XCTAssertTrue(transcript.view(query: "compare", language: "ja", seconds: 10, follow: true).rows.isEmpty)
    }

    func testResumeRejectsEndAndKeepsLearnersSeparate() {
        let saved = Progress(seconds: 12, speed: 1.5, language: "ja", standard: false)
        XCTAssertTrue(saved.canResume(duration: 12.1))
        XCTAssertFalse(saved.canResume(duration: 12))
        XCTAssertFalse(saved.canResume(duration: .nan))
        XCTAssertNotEqual(Progress.key(learner: "A", lesson: "1"), Progress.key(learner: "B", lesson: "1"))
    }
}
