import type { PlayerConfig } from "bitmovin-player";
import { NetworkRequestApi } from "bitmovin-player/modules/bitmovinplayer-core";
import { expect, it, vi } from "vitest";

vi.mock("bitmovin-player/modules/bitmovinplayer-core", () => ({
  NetworkRequestApi: { XHR: "xhr", Fetch: "fetch" },
}));

import { vegaPlayerConfig } from "../src/playerConfig";

it("uses Fetch for Vega while preserving caller configuration and request hooks", () => {
  const preprocessHttpRequest: NonNullable<NonNullable<PlayerConfig["network"]>["preprocessHttpRequest"]> = async (_type, request) => request;
  const config: PlayerConfig = {
    key: "SYNTHETIC_TEST_KEY",
    ui: false,
    playback: { autoplay: false, muted: true },
    network: { requestApi: NetworkRequestApi.XHR, preprocessHttpRequest },
  };
  const result = vegaPlayerConfig(config);
  expect(result.network).toEqual({ requestApi: "fetch", preprocessHttpRequest });
  expect(result.playback).toBe(config.playback);
  expect(result.key).toBe(config.key);
  expect(result.ui).toBe(false);
  expect(config.network?.requestApi).toBe("xhr");
});

it("selects Fetch when no network configuration was provided", () => {
  const config: PlayerConfig = { key: "SYNTHETIC_TEST_KEY", ui: false };
  expect(vegaPlayerConfig(config).network?.requestApi).toBe("fetch");
  expect(config).not.toHaveProperty("network");
});
