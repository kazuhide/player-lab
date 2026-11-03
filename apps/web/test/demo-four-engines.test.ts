import { describe, expect, it } from "vitest";
import { SDK_VERSIONS, DEMO_SDK_VERSIONS } from "../src/startup/contract";
import { DEMO_ENGINES, makeDemoTrialOrder } from "../src/startup/demo-results";

describe("four-player demo boundary", () => {
  it("adds the current v8 SDK without changing the historical benchmark inventory", () => {
    expect(Object.keys(SDK_VERSIONS)).toEqual(["web-x", "hls", "shaka"]);
    expect(DEMO_ENGINES).toEqual(["web-x", "bitmovin-8", "hls", "shaka"]);
    expect(DEMO_SDK_VERSIONS["bitmovin-8"]).toBe("8.283.0");
  });

  it("covers every four-player order and balances each execution position", () => {
    const orders = Array.from({ length: 24 }, (_, seed) => makeDemoTrialOrder(seed));
    expect(new Set(orders.map((order) => order.join(","))).size).toBe(24);
    for (const engine of DEMO_ENGINES) {
      for (let position = 0; position < 4; position += 1) {
        expect(orders.filter((order) => order[position] === engine)).toHaveLength(6);
      }
    }
    for (const order of orders) expect([...order].sort()).toEqual([...DEMO_ENGINES].sort());
  });

  it("does not expose a shared mutable schedule and rejects invalid seeds", () => {
    const order = makeDemoTrialOrder(0);
    order.reverse();
    expect(makeDemoTrialOrder(0)).toEqual(DEMO_ENGINES);
    for (const seed of [-1, 0.5, Number.NaN, 2 ** 32]) expect(() => makeDemoTrialOrder(seed)).toThrow();
  });
});
