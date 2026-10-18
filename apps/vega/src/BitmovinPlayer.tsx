import type { PlayerAPI, PlayerConfig, SourceConfig } from "bitmovin-player";
import { KeplerVideoSurfaceView, VideoPlayer } from "@amazon-devices/react-native-w3cmedia";
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { DvrController, type DvrUpdate } from "./dvrController";
import { createVegaPlayer } from "./vegaPlayer";
import { installVegaPolyfills } from "./polyfills";

export interface BitmovinPlayerProps {
  config: PlayerConfig;
  source: SourceConfig;
  onDvr: DvrUpdate;
  controllerRef: React.MutableRefObject<DvrController | null>;
}

export const BitmovinPlayer: React.FC<BitmovinPlayerProps> = ({ config, source, onDvr, controllerRef }) => {
  const video = useRef<VideoPlayer | null>(null);
  const player = useRef<PlayerAPI | null>(null);
  const [surfaceHandle, setSurfaceHandle] = useState<string | null>(null);

  useEffect(() => {
    if (!surfaceHandle) return;

    async function setup(handle: string): Promise<void> {
      // A fresh "video element" is required per source on Vega.
      const v = new VideoPlayer();
      await v.initialize();
      v.setSurfaceHandle(handle);
      video.current = v;
      installVegaPolyfills(v);

      const p = createVegaPlayer(config);
      player.current = p;
      controllerRef.current = new DvrController(p, onDvr);
      await p.load(source);
    }

    setup(surfaceHandle).catch((e) => console.warn("Vega player setup failed", e));

    return () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
      player.current?.destroy();
      player.current = null;
      video.current?.deinitialize();
      video.current?.clearSurfaceHandle("");
      video.current = null;
    };
  }, [surfaceHandle, source, config, onDvr, controllerRef]);

  return (
    <View>
      <KeplerVideoSurfaceView onSurfaceViewCreated={(handle: string) => setSurfaceHandle(handle)} />
    </View>
  );
};
