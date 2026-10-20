import type { PlayerAPI, PlayerConfig, PlayerEvent, SourceConfig } from "bitmovin-player";

export interface PlayerSnapshot {
  isLive: boolean;
  duration: number;
  maxTimeShift: number;
  timeShift: number;
  currentTime: number;
}

export interface Harness {
  load(
    source: SourceConfig,
    config?: Partial<PlayerConfig>,
    opts?: { spyNetwork?: boolean },
  ): Promise<{ loaded: boolean; error?: string }>;
  waitFor(event: keyof typeof PlayerEvent, timeoutMs?: number): Promise<boolean>;
  snapshot(): PlayerSnapshot;
  events(): string[];
  network(): string[];
}

declare global {
  interface Window {
    __testUiConfig?: import("@showcase/ui-shared").UIConfig;
    player?: PlayerAPI | undefined;
    harness: Harness;
    __events: string[];
    __network: string[];
  }
}
