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

Select an event and a clip, live stream or available archive. Use **Sports controls** for play, pause and 15-second skips, or **Live edge** to rejoin the live stream. A clip can return to its original DVR position while the event is live and the position remains in range. After the event ends, the retained live source can still be opened while its archive is processing. Retrying a failed archive handoff repeats the original position and play or pause intent and creates a separate handoff record. Choose the full or edited replay under **Archive for continuation**. Both manual and automatic continuation use that replay. An edited-out position requires an explicit choice to start the archive from the beginning or keep watching. Choose **Continue at viewed position** when the source clock and archive mapping cover the viewed frame. An archive can also be started from the beginning. Automatic continuation requires an ended event, a ready archive, a valid mapping and viewer opt-in. While the archive is processing, the app tracks the source clock and waits for the publisher to confirm its bounds. Automatic polling stops when the event is cancelled or the ended archive reaches ready or failed. Use **Refresh event status** to check again.

The standard iOS presentation uses the SDK Web UI. Apple TV uses system controls and the Siri Remote. Each target can switch to its app controls during playback. Side-loaded captions in app controls and the tvOS system presentation use SDK cue events. iOS exposes the system AirPlay route picker. The Apple targets use HLS.

**Handoff records** exports up to 200 mapped live-to-archive requests from the current app session. A confirmed row includes the observed source, position and playback intent. Confirmation requires the SDK to finish the requested seek on the same archive within five seconds, at a position within one second of the target. Playing requests also require observed advancement within that five-second window. An unconfirmed request has a null confirmation. Receiver QoE is always null. On iOS, use **Share JSON** to save the file for local inspection. Apple TV displays the same JSON on screen.

The iOS system route picker supports AirPlay. Physical receiver handoff and picture-in-picture depend on the device and system presentation. The reference has no dedicated picture-in-picture command.
