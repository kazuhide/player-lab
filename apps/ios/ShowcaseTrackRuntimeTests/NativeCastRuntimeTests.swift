#if !os(tvOS)
import BitmovinPlayer
import XCTest
@testable import Showcase_iOS

@MainActor
final class NativeCastRuntimeTests: XCTestCase {
    func testRealCastSdkInitializationStateAndOwnedListenerWithoutFabricatingReceiver() throws {
        let previous = UserDefaults.standard.data(forKey: NativeCastStartup.key)
        defer {
            if let previous { UserDefaults.standard.set(previous, forKey: NativeCastStartup.key) }
            else { UserDefaults.standard.removeObject(forKey: NativeCastStartup.key) }
        }
        let workbench = NativeCastWorkbench()
        workbench.settings = NativeCastSettings()
        try workbench.run(.initializeOptions)
        XCTAssertTrue(BitmovinCastManager.isInitialized())
        let manager = BitmovinCastManager.sharedInstance()
        XCTAssertTrue(workbench.state.contains { $0.id == "BitmovinCastManager.isInitialized()" && $0.value == "true" })
        XCTAssertTrue(workbench.state.contains { $0.id == "BitmovinCastManager.sharedInstance()" })
        try workbench.run(.addListener)
        try workbench.run(.removeListener)
        workbench.refresh()
        XCTAssertEqual(workbench.state.first { $0.id == "BitmovinCastManager.isConnected" }?.value, String(manager.isConnected))
        if !manager.isConnected {
            XCTAssertThrowsError(try workbench.run(.play))
            try workbench.run(.message)
            XCTAssertTrue(workbench.result.contains("returned false"))
            workbench.settings.messageNamespace = "urn:x-cast:com.example.playerlab"
            try workbench.run(.namespacedMessage)
            XCTAssertTrue(workbench.result.contains("returned false"))
            try workbench.run(.metadata)
            XCTAssertTrue(workbench.result.contains("returned false"))
        }
        workbench.settings.backgroundSessions = true
        try workbench.run(.initializeOptions)
        XCTAssertTrue(workbench.result.contains("saved for the next app launch"))
        XCTAssertEqual(NativeCastStartup.saved?.backgroundSessions, true)
        print("Cast SDK qualification: actual initialization, getter state, listener attach/detach and no-receiver send results passed; receiver playback is a separate requirement")
    }
}
#endif
