# Android offline download

The Android app includes `OfflineManager.kt`, using the SDK's
`OfflineContentManager` to download media and return an offline source for
playback. This example needs your app-allowlisted Player license, supported
media, device storage, and an Android runtime.

The existing flow creates a manager for a source, requests available tracks,
selects video and audio tracks, processes the download, and exposes progress
and completion. It loads `offlineSourceConfig` for playback and uses
`deleteAll()` to remove the saved media.

```sh
cd apps/android
./gradlew :app:assembleDebug
```

Compilation checks the SDK calls. It does not verify a completed download,
playback without connectivity, background behavior, or deletion on a device.
Follow the [Android setup](../apps/android/README.md), including shared UI assets
and licenses, before running the app. A background download service also needs
the appropriate Android service and notification configuration.

The iOS and React Native apps do not include equivalent offline managers.
Protected-media offline licenses and provider integration require separate
configuration and are not demonstrated by this example.
