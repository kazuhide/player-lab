import { describe, expect, it } from "vitest";
import { behindLiveSeconds, deriveLiveButtonState, isAtLiveEdge } from "../src/liveState";

describe("isAtLiveEdge", () => {
  it("is true at and within epsilon of the edge", () => {
    expect(isAtLiveEdge(0)).toBe(true);
    expect(isAtLiveEdge(-0.5)).toBe(true);
    expect(isAtLiveEdge(-1)).toBe(true);
  });
  it("is false beyond epsilon", () => {
    expect(isAtLiveEdge(-2)).toBe(false);
  });
  it("honors a custom epsilon", () => {
    expect(isAtLiveEdge(-2, 3)).toBe(true);
    expect(isAtLiveEdge(-5, 3)).toBe(false);
  });
  it("is false for non-finite input", () => {
    expect(isAtLiveEdge(Number.NaN)).toBe(false);
  });
});

describe("behindLiveSeconds", () => {
  it("returns the distance behind the edge", () => {
    expect(behindLiveSeconds(-60)).toBe(60);
  });
  it("clamps to 0 at/ahead of the edge and for non-finite input", () => {
    expect(behindLiveSeconds(0)).toBe(0);
    expect(behindLiveSeconds(5)).toBe(0);
    expect(behindLiveSeconds(Number.NaN)).toBe(0);
  });
});

describe("deriveLiveButtonState", () => {
  it("is hidden for VOD", () => {
    expect(deriveLiveButtonState(false, 0)).toBe("hidden");
    expect(deriveLiveButtonState(false, -100)).toBe("hidden");
  });
  it("is at-edge when live and within epsilon", () => {
    expect(deriveLiveButtonState(true, 0)).toBe("at-edge");
    expect(deriveLiveButtonState(true, -0.5)).toBe("at-edge");
  });
  it("is behind when live and outside epsilon", () => {
    expect(deriveLiveButtonState(true, -30)).toBe("behind");
  });
  it("honors a custom epsilon", () => {
    expect(deriveLiveButtonState(true, -2, 3)).toBe("at-edge");
    expect(deriveLiveButtonState(true, -5, 3)).toBe("behind");
  });
  it("treats a non-finite offset as behind (not at edge) when live", () => {
    expect(deriveLiveButtonState(true, Number.NaN)).toBe("behind");
  });
});
