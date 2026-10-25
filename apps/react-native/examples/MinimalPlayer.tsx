import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Player, PlayerView, Source, SourceType } from "bitmovin-player-react-native";

interface MountedPlayer {
  player: Player;
  load: () => void;
  fail: () => void;
  playing: () => void;
}

export default function MinimalPlayer() {
  const [mounted, setMounted] = useState<MountedPlayer | null>(null);
  const [status, setStatus] = useState("Preparing player");

  useEffect(() => {
    let active = true;
    let sourceInitialization: Promise<void> | undefined;
    const player = new Player({
      licenseKey: "YOUR_PLAYER_KEY",
      playbackConfig: { isAutoplayEnabled: true, isMuted: true },
    });
    const source = new Source({
      url: "https://example.com/video/master.m3u8",
      type: SourceType.HLS,
    });
    const fail = () => { if (active) setStatus("Playback failed"); };
    const initialization = player.initialize();
    setMounted(null);
    void initialization.then(() => {
      if (!active) return;
      setMounted({ player, fail, playing: () => { if (active) setStatus("Playing"); }, load: () => {
        if (!active || sourceInitialization) return;
        sourceInitialization = source.initialize();
        void sourceInitialization.then(() => {
          if (active) player.loadSource(source);
        }, fail);
      } });
    }, fail);

    return () => {
      active = false;
      void (async () => {
        await initialization.catch(() => {});
        await sourceInitialization?.catch(() => {});
        player.destroy();
        source.destroy();
      })().catch(() => console.error("Player cleanup failed."));
    };
  }, []);

  return <View style={styles.screen}>
    {mounted && <PlayerView player={mounted.player} style={styles.video}
      onPlayerViewReady={mounted.load}
      onPlayerError={mounted.fail} onSourceError={mounted.fail}
      onPlaying={mounted.playing} />}
    <Text>{status}</Text>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  video: { width: "100%", height: 240 },
});
