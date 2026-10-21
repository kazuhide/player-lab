#if !os(tvOS)
import BitmovinPlayer
import XCTest

final class NativeCastTests: XCTestCase {
    func testAllCastOptionsReachActualSdkObject() throws {
        var value = NativeCastSettings()
        value.applicationId = "AB12CD34"
        value.messageNamespace = "urn:x-cast:com.example.playerlab"
        value.backgroundSessions = true
        value.discoveryMode = "castManagerInitialization"
        value.stopReceiver = false
        let options = try value.validated().makeOptions()
        XCTAssertEqual(options.applicationId, "AB12CD34")
        XCTAssertEqual(options.messageNamespace, "urn:x-cast:com.example.playerlab")
        XCTAssertTrue(options.enableBackgroundSessions)
        XCTAssertEqual(options.deviceDiscoveryMode, .castManagerInitialization)
        XCTAssertFalse(options.stopReceiverApplicationWhenEndingSession)
        let defaults = try NativeCastSettings().validated().makeOptions()
        XCTAssertNil(defaults.applicationId)
        XCTAssertNil(defaults.messageNamespace)
        XCTAssertEqual(defaults.deviceDiscoveryMode, .castButtonInteraction)
    }

    func testValidationIsLimitedToArgumentsConsumedByTheSelectedOverload() throws {
        var value = NativeCastSettings()
        value.applicationId = "invalid-draft"
        value.messageNamespace = "invalid-draft"
        XCTAssertThrowsError(try value.validated())
        XCTAssertNoThrow(try value.validated(for: .initialize))
        value.applicationId = "AB12CD34"
        XCTAssertNoThrow(try value.validated(for: .initializeApplication))
        XCTAssertThrowsError(try value.validated(for: .initializeNamespace))
        value.messageNamespace = "urn:x-cast:com.example.playerlab"
        value.applicationId = "invalid-unused-draft"
        XCTAssertNoThrow(try value.validated(for: .namespacedMessage))
        value.messageNamespace = "urn:x-cast:" + String(repeating: "界", count: 40)
        XCTAssertThrowsError(try value.validated(for: .namespacedMessage))
    }

    func testStartupSettingsRoundTripWithoutInitializingTheSdk() throws {
        let old = UserDefaults.standard.data(forKey: NativeCastStartup.key)
        defer {
            if let old { UserDefaults.standard.set(old, forKey: NativeCastStartup.key) }
            else { UserDefaults.standard.removeObject(forKey: NativeCastStartup.key) }
        }
        var value = NativeCastSettings()
        value.applicationId = "AB12CD34"
        value.messageNamespace = "urn:x-cast:com.example.playerlab"
        try NativeCastStartup.save(value)
        XCTAssertEqual(NativeCastStartup.saved, value)
        XCTAssertTrue(value.code.contains("options.applicationId = \"AB12CD34\""))
        XCTAssertTrue(value.code.contains("initializeCasting(options: options)"))
    }
}
#endif
