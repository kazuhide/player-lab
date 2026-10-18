import type { PlayerConfig, SourceConfig } from "bitmovin-player";
import { KeplerVideoSurfaceView, VideoPlayer } from "@amazon-devices/react-native-w3cmedia";
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { DvrController, type DvrUpdate } from "./dvrController";
import { createVegaPlayer } from "./vegaPlayer";
import { installVegaPolyfills, removeVegaPolyfills } from "./polyfills";
import { startVegaSession } from "./playerSession";

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
  const enabled = useRef(timeShiftEnabled);
  const [surfaceHandle, setSurfaceHandle] = useState<string | null>(null);

  useEffect(() => {
    enabled.current = timeShiftEnabled;
    controllerRef.current?.setTimeShiftEnabled(timeShiftEnabled);
  }, [timeShiftEnabled, controllerRef]);

  useEffect(() => {
    if (!surfaceHandle) return;
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
    return () => { teardown.current = session.dispose(); };
  }, [surfaceHandle, source, config, onDvr, controllerRef]);

  return (
    <View>
      <KeplerVideoSurfaceView onSurfaceViewCreated={(handle: string) => setSurfaceHandle(handle)} />
    </View>
  );
};
