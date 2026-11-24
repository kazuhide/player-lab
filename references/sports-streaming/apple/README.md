# Sports on iPhone, iPad and Apple TV

[English](README.md) · [日本語](README.ja.md)

Both targets use this reference’s HLS media publisher and catalog. Install Xcode and XcodeGen. Start the publisher with the commands in the [reference guide](../README.md).

Copy `Local.xcconfig.example` to `Local.xcconfig` in this directory. XcodeGen also creates the local file when missing. Use a dedicated Bitmovin Player license allowing `com.playerlab.sportsstreaming.ios` and `com.playerlab.sportsstreaming.tvos`. The optional Analytics license enables the integrated collector and the publisher’s video IDs. Both licenses become part of the built app.

```xcconfig
BITMOVIN_PLAYER_LICENSE_KEY = your-player-license
BITMOVIN_ANALYTICS_LICENSE_KEY =
```

Simulators use `http://127.0.0.1:8622/`. On a device, point `MEDIA_BASE_URL` to a reachable HTTPS publisher with a trailing slash. For example, write `MEDIA_BASE_URL = https:/$()/media.example/` in `Local.xcconfig`. Xcode expands the empty build setting to form the URL.

From this directory, generate the project, run the domain tests and build both targets.

```sh
xcodegen generate
swift test
xcodebuild -project Sports.xcodeproj -scheme Sports-iOS -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project Sports.xcodeproj -scheme Sports-tvOS -destination 'generic/platform=tvOS Simulator' CODE_SIGNING_ALLOWED=NO build
open Sports.xcodeproj
```

Choose the iOS or tvOS scheme and a simulator in Xcode, then press Run. For device installation, select your signing team and allowlist the final bundle ID. Choose Product → Test with the fixture publisher running to exercise the simulator UI.

Select an event and a clip, live stream or available archive. Use **Sports controls** for play, pause and 15-second skips, or **Live edge** to rejoin the live stream. A clip can return to its original DVR position while the position remains in range. Choose the full or edited replay under **Archive for continuation**. Both manual and automatic continuation use that replay. An edited-out position requires an explicit choice to start the archive from the beginning or keep watching. Choose **Continue at viewed position** when the source clock and archive mapping cover the viewed frame. An archive can also be started from the beginning. Automatic continuation requires an ended event, a ready archive, a valid mapping and viewer opt-in.

The standard iOS presentation uses the SDK Web UI. Apple TV uses system controls and the Siri Remote. Each target can switch to its app controls during playback. Side-loaded captions in app controls and the tvOS system presentation use SDK cue events. iOS exposes the system AirPlay route picker. The Apple targets use HLS.

**Handoff records** exports up to 200 mapped live-to-archive requests from the current app session. A confirmed row includes the observed source, position and playback intent. Playing requests require evidence that the position advanced. An unconfirmed request has a null confirmation. Receiver QoE is always null. On iOS, use **Share JSON** to save the file for local inspection. Apple TV displays the same JSON on screen.

The iOS system route picker supports AirPlay. Physical receiver handoff and picture-in-picture depend on the device and system presentation. The reference has no dedicated picture-in-picture command.
