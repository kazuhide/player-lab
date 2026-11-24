# Android TV

[English](TV.md) · [日本語](TV.ja.md)

Install the same APK on Android phones and televisions. On TV, open the app from the launcher and use the directional pad to select a learner, course settings and a lesson. Press the centre button to activate the focused control.

Standard UI uses the Bitmovin TV controls. Press Back in these controls to return focus to the app. Back also leaves fullscreen. Switch to the learning UI to use the app's native controls. Switching keeps the current Player and Source.

Play, Pause and Play/Pause remote keys control the active session. Rewind and Fast Forward move 10 seconds when the target lies inside the active lesson. Select Transcript to search and seek with the remote. Local resume positions remain separate for each learner.

Configure the license and media origin as described in the [reference setup](../README.md), then run from this directory:

```sh
./gradlew :app:testDebugUnitTest :app:assembleDebug
adb -s TV_SERIAL install -r app/build/outputs/apk/debug/app-debug.apk
adb -s TV_SERIAL shell am start -a android.intent.action.MAIN \
  -c android.intent.category.LEANBACK_LAUNCHER -n com.playerlab.elearning/.MainActivity
```
