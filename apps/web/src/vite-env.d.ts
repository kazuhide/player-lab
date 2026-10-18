/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BITMOVIN_PLAYER_LICENSE_KEY?: string;
  readonly VITE_BITMOVIN_ANALYTICS_LICENSE_KEY?: string;
  readonly VITE_LIVE_HLS_URL?: string;
  readonly VITE_LIVE_DASH_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "@showcase/ui-shared/css";
