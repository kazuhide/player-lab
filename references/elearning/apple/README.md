# Learning on iPhone, iPad and Apple TV

[English](README.md) · [日本語](README.ja.md)

Both targets use this reference’s HLS media publisher and catalog. Install Xcode and XcodeGen. Start the publisher with the commands in the [reference guide](../README.md).

Copy `Local.xcconfig.example` to `Local.xcconfig` in this directory. XcodeGen also creates the local file when missing. Use a dedicated Bitmovin Player license allowing `com.playerlab.elearning.ios` and `com.playerlab.elearning.tvos`. The optional Analytics license enables the integrated collector and the publisher’s video IDs. Both licenses become part of the built app.

```xcconfig
BITMOVIN_PLAYER_LICENSE_KEY = your-player-license
BITMOVIN_ANALYTICS_LICENSE_KEY =
```

Simulators use `http://127.0.0.1:8621/`. On a device, point `MEDIA_BASE_URL` to a reachable HTTPS publisher with a trailing slash. For example, write `MEDIA_BASE_URL = https:/$()/media.example/` in `Local.xcconfig`. Xcode expands the empty build setting to form the URL.

From this directory, generate the project, run the domain tests and build both targets.

```sh
xcodegen generate
swift test
xcodebuild -project Learning.xcodeproj -scheme Learning-iOS -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project Learning.xcodeproj -scheme Learning-tvOS -destination 'generic/platform=tvOS Simulator' CODE_SIGNING_ALLOWED=NO build
open Learning.xcodeproj
```

Choose the iOS or tvOS scheme and a simulator in Xcode, then press Run. For device installation, select your signing team and allowlist the final bundle ID. Choose Product → Test with the fixture publisher running to exercise the simulator UI.

Choose learner A or B, select the caption delivery mode, and decide whether to play subsequent lessons automatically before opening a lesson. **Learning controls** includes playback and 10-second skips. Search the English or Japanese transcript and select a result to seek to its cue. Resume position, speed, UI mode and caption selection are stored on the device for the current learner and lesson.

The standard iOS presentation uses the SDK Web UI. Apple TV uses system controls and the Siri Remote. Each target can switch to its app controls during playback. Side-loaded captions in app controls and the tvOS system presentation use SDK cue events. iOS exposes the system AirPlay route picker. The Apple targets use HLS.
