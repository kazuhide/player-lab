#if os(tvOS)
import BitmovinPlayer
import UIKit
import XCTest

final class NativeTVControlsTests: XCTestCase {
    func testMarkersAndNestedNativeMenuObjectsUseEditedTypedValues() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = [
            "SourceConfig.markers": "[{\"time\":4,\"duration\":8},{\"time\":20,\"duration\":0}]",
            "SystemUserInterfaceConfig.transportBarCustomMenuItems": "[{\"title\":\"Playback\",\"options\":[\"displayInline\"],\"children\":[{\"title\":\"Seek to example\",\"identifier\":\"example.seek\",\"systemImage\":\"forward.frame\",\"state\":\"on\",\"operation\":\"seek\",\"arguments\":{\"value\":\"12\"}}]}]",
        ]
        let applied = try draft.validated()
        let source = applied.source.makeSourceConfig()
        XCTAssertEqual(source.markers.map(\.time), [4, 20]); XCTAssertEqual(source.markers.map(\.duration), [8, 0])
        let player = PlayerConfig(); applied.player.apply(to: player); applied.player.advanced.applyUI(to: player)
        let ui = try XCTUnwrap(player.styleConfig.userInterfaceConfig as? SystemUserInterfaceConfig)
        let menu = try XCTUnwrap(ui.transportBarCustomMenuItems.first as? UIMenu)
        XCTAssertEqual(menu.title, "Playback"); XCTAssertTrue(menu.options.contains(.displayInline))
        let action = try XCTUnwrap(menu.children.first as? UIAction)
        XCTAssertEqual(action.title, "Seek to example"); XCTAssertEqual(action.identifier.rawValue, "example.seek"); XCTAssertEqual(action.state, .on)
        let code = configurationCode(source: applied.source, player: applied.player, uiMode: .default)
        XCTAssertTrue(code.contains("menuPlayerReference.player = player"))
        let attachment = XCTAttachment(data: Data(code.utf8), uniformTypeIdentifier: "public.swift-source"); attachment.name = "native-tv-menus-markers.swift"; attachment.lifetime = .keepAlways; add(attachment)
    }

    func testInvalidNativeInputsAreRejectedBeforeSdkMutation() throws {
        XCTAssertThrowsError(try AdvancedConfiguration(validating: ["SourceConfig.markers": "[{\"time\":true,\"duration\":2}]"]))
        XCTAssertThrowsError(try NativeTVControls.menu("[{\"title\":\"Bad\",\"operation\":\"seek\",\"arguments\":{\"value\":\"-1\"}}]"))
        XCTAssertThrowsError(try NativeTVControls.menu("[{\"title\":\"Bad\",\"operation\":\"unknown\"}]"))
        XCTAssertThrowsError(try ApiOperation.tvContextActions.code(arguments: ["json": "[{\"title\":\"Menu\",\"children\":[]}] "]))
        let controllers = try NativeTVControls.infoControllers("[{\"title\":\"Details\",\"text\":\"Example information\"}]")
        XCTAssertEqual(controllers.first?.title, "Details")
        XCTAssertEqual(controllers.first?.view.subviews.compactMap { $0 as? UILabel }.first?.text, "Example information")
    }
}
#endif
