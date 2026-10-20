import { describe, expect, it, vi } from "vitest";
import type { PlayerAPI } from "bitmovin-player";
import type { UIInstanceManager } from "bitmovin-player-ui";

// Exercise the real component lifecycle/event wiring. Rendering and the native
// bridge are covered separately by the opt-in Apple runtime fixture.
vi.mock("bitmovin-player-ui", () => {
  class Component {
    hidden = false;
    text = "";
    clicks: (() => void)[] = [];
    onClick = { subscribe: (callback: () => void) => { this.clicks.push(callback); } };
    configure() {}
    hide() { this.hidden = true; }
    show() { this.hidden = false; }
    setText(value: string) { this.text = value; }
    on() {}
    off() {}
  }
  return { ToggleButton: Component, Label: Component, ButtonStyle: { Text: "text" } };
});

import { BehindLiveLabel } from "../src/components/BehindLiveLabel";
import { LiveButton } from "../src/components/LiveButton";

function fixture() {
  const handlers = new Map<string, Set<() => void>>();
  const releases: (() => void)[] = [];
  const events = Object.fromEntries([
    "SourceLoaded", "SourceUnloaded", "TimeChanged", "TimeShift", "TimeShifted",
    "Playing", "Paused", "DurationChanged", "PlaybackFinished",
  ].map((name) => [name, name.toLowerCase()]));
  const timeShift = vi.fn();
  const player = {
    exports: { PlayerEvent: events }, isLive: () => true,
    getTimeShift: () => -10, getSource: () => ({ title: "Current event" }), timeShift,
    on(event: string, callback: () => void) {
      const callbacks = handlers.get(event) ?? new Set();
      callbacks.add(callback); handlers.set(event, callbacks);
    },
    off(event: string, callback: () => void) { handlers.get(event)?.delete(callback); },
  };
  return {
    player: player as unknown as PlayerAPI,
    manager: { onRelease: { subscribe: (callback: () => void) => { releases.push(callback); } } } as unknown as UIInstanceManager,
    emit(name: string) { [...(handlers.get(events[name]!) ?? [])].forEach((callback) => callback()); },
    release() { releases.forEach((callback) => callback()); },
    callbacks(name: string) { return [...(handlers.get(events[name]!) ?? [])]; },
    listenerCount() { return [...handlers.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); },
    timeShift,
  };
}

for (const [name, create] of [
  ["LIVE button", () => new LiveButton()],
  ["behind-live label", () => new BehindLiveLabel()],
] as const) {
  describe(`${name} after a native live event ends`, () => {
    it("stays hidden when isLive remains true after definitive completion", () => {
      const f = fixture();
      const component = create();
      component.configure(f.player, f.manager);
      const rendered = component as unknown as { hidden: boolean };
      expect(rendered.hidden).toBe(false);
      f.emit("PlaybackFinished");
      expect(rendered.hidden).toBe(true);
      for (const event of ["TimeChanged", "DurationChanged", "Paused", "TimeShifted"]) f.emit(event);
      expect(rendered.hidden).toBe(true);
      f.emit("Playing");
      expect(rendered.hidden).toBe(true);
      f.emit("PlaybackFinished");
      f.emit("SourceUnloaded");
      expect(rendered.hidden).toBe(true);
      f.emit("SourceLoaded");
      expect(rendered.hidden).toBe(false);
    });

    it("removes completion listeners and rejects already queued updates after release", () => {
      const f = fixture();
      const component = create();
      component.configure(f.player, f.manager);
      const queued = f.callbacks("PlaybackFinished");
      expect(queued.length).toBe(1);
      f.release();
      expect(f.listenerCount()).toBe(0);
      queued.forEach((callback) => callback());
      expect((component as unknown as { hidden: boolean }).hidden).toBe(false);
    });

    it("ignores a completion callback captured by the previous load generation", () => {
      const f = fixture();
      const component = create();
      component.configure(f.player, f.manager);
      const previousSourceCompletion = f.callbacks("PlaybackFinished");
      f.emit("SourceUnloaded");
      f.emit("SourceLoaded");
      previousSourceCompletion.forEach((callback) => callback());
      expect((component as unknown as { hidden: boolean }).hidden).toBe(false);
      f.emit("PlaybackFinished");
      expect((component as unknown as { hidden: boolean }).hidden).toBe(true);
    });
  });
}

it("does not issue a stale live seek after completion or release", () => {
  const f = fixture();
  const button = new LiveButton();
  button.configure(f.player, f.manager);
  const click = () => (button as unknown as { clicks: (() => void)[] }).clicks.forEach((callback) => callback());
  f.emit("PlaybackFinished"); click();
  expect(f.timeShift).not.toHaveBeenCalled();
  f.emit("Playing"); click();
  expect(f.timeShift).not.toHaveBeenCalled();
  f.emit("SourceLoaded"); click();
  expect(f.timeShift).toHaveBeenCalledTimes(1);
  f.release(); click();
  expect(f.timeShift).toHaveBeenCalledTimes(1);
});
