import type { PlayerConfig, SourceConfig } from "bitmovin-player";
import { KeplerVideoSurfaceView, VideoPlayer } from "@amazon-devices/react-native-w3cmedia";
import React, { useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, View, type AppStateStatus } from "react-native";
import { DvrController, type DvrUpdate } from "./dvrController";
import { createVegaPlayer } from "./vegaPlayer";
import { installVegaPolyfills, removeVegaPolyfills } from "./polyfills";
import { releaseVegaBackgroundMedia, startVegaSession } from "./playerSession";

export interface BitmovinPlayerProps {
  config: PlayerConfig;
  source: SourceConfig;
  onDvr: DvrUpdate;
  controllerRef: React.MutableRefObject<DvrController | null>;
  timeShiftEnabled: boolean;
}

export const BitmovinPlayer: React.FC<BitmovinPlayerProps> = ({
  config, source, onDvr, controllerRef, timeShiftEnabled,
}) => {
  const teardown = useRef<Promise<void>>(Promise.resolve());
  const ownedSession = useRef<{ dispose: (background?: boolean) => Promise<void> } | null>(null);
  const enabled = useRef(timeShiftEnabled);
  const [surfaceHandle, setSurfaceHandle] = useState<string | null>(null);
  const lifecycleRef = useRef({ active: AppState.currentState !== "background", generation: 0 });
  const [lifecycle, setLifecycle] = useState(lifecycleRef.current);

  useEffect(() => {
    const onAppStateChange = (state: AppStateStatus | null) => {
      const previous = lifecycleRef.current;
      if (state === "background" && previous.active) {
        lifecycleRef.current = { active: false, generation: previous.generation + 1 };
        // Retire callbacks and native media synchronously; the barrier owns remaining SDK cleanup.
        const session = ownedSession.current;
        ownedSession.current = null;
        if (session) teardown.current = session.dispose(true);
        // A current waiter reuses the retiring owner's barrier, so it is flushed too.
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
    enabled.current = timeShiftEnabled;
    controllerRef.current?.setTimeShiftEnabled(timeShiftEnabled);
  }, [timeShiftEnabled, controllerRef]);

  useEffect(() => {
    if (!lifecycle.active || !lifecycleRef.current.active ||
        lifecycleRef.current.generation !== lifecycle.generation || !surfaceHandle) return;
    const session = startVegaSession({
      handle: surfaceHandle,
      source,
      after: teardown.current,
      createVideo: () => new VideoPlayer(),
      installPolyfills: installVegaPolyfills,
      removePolyfills: removeVegaPolyfills,
      createPlayer: () => createVegaPlayer(config),
      createController: (player, isActive) =>
        new DvrController(player, (state, line) => {
          if (isActive()) onDvr(state, line);
        }),
      controllerRef,
      getTimeShiftEnabled: () => enabled.current,
      onError: (message) => console.warn(message),
    });
    ownedSession.current = session;
    return () => {
      teardown.current = session.dispose();
      if (ownedSession.current === session) ownedSession.current = null;
    };
  }, [lifecycle.active, lifecycle.generation, surfaceHandle, source, config, onDvr, controllerRef]);

  return (
    <View style={styles.video}>
      {lifecycle.active && <KeplerVideoSurfaceView key={lifecycle.generation}
        testID="vega-video-surface" style={styles.surface} scalingmode="fit"
        onSurfaceViewCreated={(handle: string) => {
          const current = lifecycleRef.current;
          if (current.active && current.generation === lifecycle.generation) setSurfaceHandle(handle);
        }} />}
    </View>
  );
};

const styles = StyleSheet.create({
  video: { height: "50%", backgroundColor: "#000000" },
  surface: { width: "100%", height: "100%" },
});
