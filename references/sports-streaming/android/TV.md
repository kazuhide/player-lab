# Android TV

[English](TV.md) · [日本語](TV.ja.md)

Install the same APK on Android phones and televisions. On TV, open the app from the launcher and use the directional pad to select Live, Clips or Archives, then a video. Press the centre button to activate the focused control.

Standard UI uses the Bitmovin TV controls. Press Back in these controls to return focus to the app. Back also leaves fullscreen. Switch to the sports UI to use the app's native controls. Switching keeps the current Player and Source.

Play, Pause and Play/Pause remote keys control the active session. Rewind and Fast Forward move 15 seconds within the available live or VOD seek range. The TV plays the stream locally. Cast sender controls are available on mobile.

Configure the license and media origin as described in the [reference setup](../README.md), then run from this directory:

```sh
./gradlew :app:testDebugUnitTest :app:assembleDebug
adb -s TV_SERIAL install -r app/build/outputs/apk/debug/app-debug.apk
adb -s TV_SERIAL shell am start -a android.intent.action.MAIN \
  -c android.intent.category.LEANBACK_LAUNCHER -n com.playerlab.sportsstreaming/.MainActivity
```
