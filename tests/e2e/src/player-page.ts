import { Player, PlayerEvent } from "bitmovin-player";
import type { PlayerConfig, SourceConfig } from "bitmovin-player";
import type { Harness, PlayerSnapshot } from "./global";

const licenseKey = import.meta.env.VITE_E2E_PLAYER_LICENSE_KEY ?? "";

const harness: Harness = {
  async load(source: SourceConfig, config: Partial<PlayerConfig> = {}, opts: { spyNetwork?: boolean } = {}) {
    try {
      const existing = window.player;
      if (existing && typeof existing.destroy === "function") {
        await existing.destroy();
      }
      window.player = undefined;
      window.__events = [];
      window.__network = [];

      const el = document.getElementById("player") as HTMLElement;
      const base: PlayerConfig = {
        key: licenseKey,
        ui: false,
        playback: { autoplay: true, muted: true },
      };
      if (opts.spyNetwork) {
        // §16 Network API — observe every HTTP request the player makes.
        base.network = {
          preprocessHttpRequest: (_type, request) => {
            window.__network.push(request.url);
            return Promise.resolve(request);
          },
        };
      }
      const player = new Player(el, { ...base, ...config });
      window.player = player;

      // on() is per-event overloaded; widen it for a generic event-log subscription.
      const onAny = player.on.bind(player) as unknown as (event: string, cb: () => void) => void;
      for (const name of Object.keys(PlayerEvent) as (keyof typeof PlayerEvent)[]) {
        onAny(PlayerEvent[name], () => window.__events.push(name));
      }

      await player.load(source);
      return { loaded: true };
    } catch (e) {
      const err = e as Error;
      return { loaded: false, error: `${err?.name ?? "Error"}: ${err?.message ?? String(e)}` };
    }
  },

  waitFor(event: keyof typeof PlayerEvent, timeoutMs = 15000) {
    return new Promise<boolean>((resolve) => {
      const player = window.player;
      if (!player) return resolve(false);
      const timer = setTimeout(() => resolve(false), timeoutMs);
      const onAny = player.on.bind(player) as unknown as (event: string, cb: () => void) => void;
      onAny(PlayerEvent[event], () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  },

  snapshot(): PlayerSnapshot {
    const p = window.player;
    if (!p) throw new Error("no player loaded");
    return {
      isLive: p.isLive(),
      duration: p.getDuration(),
      maxTimeShift: p.getMaxTimeShift(),
      timeShift: p.getTimeShift(),
      currentTime: p.getCurrentTime(),
    };
  },

  events() {
    return window.__events.slice();
  },

  network() {
    return window.__network.slice();
  },
};

window.harness = harness;
