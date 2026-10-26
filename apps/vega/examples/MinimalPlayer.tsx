import type { ErrorEvent } from "bitmovin-player";
import { PlayerEvent } from "bitmovin-player/modules/bitmovinplayer-core";
import { KeplerVideoSurfaceView, VideoPlayer } from "@amazon-devices/react-native-w3cmedia";
import React, { useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View, type AppStateStatus } from "react-native";
import { PlaybackController } from "../src/playbackController";
import { installVegaPolyfills, removeVegaPolyfills } from "../src/polyfills";
import { releaseVegaBackgroundMedia, startVegaSession } from "../src/playerSession";
import { createVegaPlayer } from "../src/vegaPlayer";

export default function MinimalPlayer() {
  const teardown = useRef<Promise<void>>(Promise.resolve());
  const ownedSession = useRef<{ dispose: (background?: boolean) => Promise<void> } | null>(null);
  const controllerRef = useRef<PlaybackController | null>(null);
  const lifecycleRef = useRef({ active: AppState.currentState !== "background", generation: 0 });
  const [lifecycle, setLifecycle] = useState(lifecycleRef.current);
  const [surfaceHandle, setSurfaceHandle] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const onAppStateChange = (state: AppStateStatus | null) => {
      const previous = lifecycleRef.current;
      if (state === "background" && previous.active) {
        lifecycleRef.current = { active: false, generation: previous.generation + 1 };
        const session = ownedSession.current;
        ownedSession.current = null;
        if (session) teardown.current = session.dispose(true);
        releaseVegaBackgroundMedia(teardown.current);
        setSurfaceHandle(null);
        setLifecycle(lifecycleRef.current);
      } else if (state === "active" && !previous.active) {
        lifecycleRef.current = { ...previous, active: true };
        setLifecycle(lifecycleRef.current);
      }
    };
    const subscription = AppState.addEventListener("change", onAppStateChange);
    onAppStateChange(AppState.currentState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!lifecycle.active || !lifecycleRef.current.active ||
        lifecycle.generation !== lifecycleRef.current.generation || !surfaceHandle) return;
    let active = true;
    const isCurrent = () => active && lifecycleRef.current.active &&
      lifecycleRef.current.generation === lifecycle.generation;
    setError("");
    const session = startVegaSession({
      handle: surfaceHandle,
      source: { hls: "https://example.com/video/master.m3u8" },
      after: teardown.current,
      createVideo: () => new VideoPlayer(),
      installPolyfills: installVegaPolyfills,
      removePolyfills: removeVegaPolyfills,
      createPlayer: () => createVegaPlayer({
        key: "YOUR_PLAYER_KEY", playback: { autoplay: true, muted: true },
        tweaks: { app_id: "com.playerlab.vega" },
      }),
      observePlayer: (player, isActive) => {
        const onError = (event: ErrorEvent) => {
          if (isCurrent() && isActive()) setError(`Player error ${event.code}`);
        };
        player.on(PlayerEvent.Error, onError);
        return () => player.off(PlayerEvent.Error, onError);
      },
      createController: (player, isActive) => new PlaybackController(player, (state) => {
        if (isCurrent() && isActive()) setPosition(state.currentTime);
      }),
      controllerRef,
      getTimeShiftEnabled: () => false,
      onError: (message) => { if (isCurrent()) setError(message); console.warn(message); },
    });
    ownedSession.current = session;
    return () => {
      active = false;
      teardown.current = session.dispose();
      if (ownedSession.current === session) ownedSession.current = null;
    };
  }, [lifecycle.active, lifecycle.generation, surfaceHandle]);

  return <View style={styles.screen}>
    {lifecycle.active && <KeplerVideoSurfaceView key={lifecycle.generation}
      style={styles.video} scalingmode="fit"
      onSurfaceViewCreated={(handle: string) => {
        const current = lifecycleRef.current;
        if (current.active && current.generation === lifecycle.generation) setSurfaceHandle(handle);
      }} />}
    <Text>{error || `${position.toFixed(1)} s`}</Text>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  video: { width: "100%", height: 360 },
});
