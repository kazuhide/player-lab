import { expect, type Locator, type Page } from "@playwright/test";

interface PlaybackObservation {
  video: HTMLVideoElement;
  log: Element;
  sourceGeneration: number;
  sequence: number;
  sourceLoaded: number;
  events: { name: string; sequence: number }[];
  observer: MutationObserver;
  seeked: () => void;
}

declare global {
  interface Window { __playbackObservation?: PlaybackObservation }
}

// Observe the application's existing public SDK event log and native media events.
// No player method is intercepted, replaced or exposed by the production app.
export async function observePlayback(page: Page): Promise<void> {
  await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>("#player video")!;
    const log = document.querySelector(".panel-log")!;
    if (!video || !log) throw new Error("The normal player and SDK event log must exist.");
    const previous = window.__playbackObservation;
    previous?.observer.disconnect();
    if (previous) previous.video.removeEventListener("seeked", previous.seeked);
    const observation: PlaybackObservation = {
      video, log, sourceGeneration: 0, sequence: 0, sourceLoaded: 0, events: [],
      observer: new MutationObserver(records => {
        for (const record of records) {
          // textContent prepends a new log entry, retaining up to 80 older lines.
          // Only the added text node's first line is a fresh SDK event.
          for (const node of Array.from(record.addedNodes)) {
            const name = (node.textContent ?? "").split("\n")[0]!.replace(/^\[[^\]]+\]\s*/, "").toLowerCase();
            if (name === "sourceloaded" || name === "sourceunloaded") observation.sourceGeneration++;
            if (name === "sourceloaded") observation.sourceLoaded++;
            observation.events.push({ name, sequence: ++observation.sequence });
          }
        }
      }),
      seeked: () => observation.events.push({ name: "native-seeked", sequence: ++observation.sequence }),
    };
    observation.observer.observe(log, { childList: true });
    video.addEventListener("seeked", observation.seeked);
    window.__playbackObservation = observation;
  });
}

export async function hasVisiblePixels(locator: Locator): Promise<boolean> {
  return locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || box.bottom <= 0 || box.right <= 0
      || box.top >= innerHeight || box.left >= innerWidth) return false;
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return false;
    }
    return true;
  });
}

export async function expectVisiblePixels(locator: Locator): Promise<void> {
  await expect.poll(() => hasVisiblePixels(locator)).toBe(true);
}

export async function expectMovingVideo(page: Page): Promise<void> {
  const video = page.locator("#player video");
  await video.scrollIntoViewIfNeeded();
  await expectVisiblePixels(video);
  const initial = await video.evaluate((element: HTMLVideoElement) => ({
    time: element.currentTime, frames: element.getVideoPlaybackQuality().totalVideoFrames,
  }));
  await expect.poll(() => video.evaluate((element: HTMLVideoElement, start) =>
    !element.paused && element.readyState >= 3 && element.videoWidth > 0
      && element.currentTime > start.time + 0.3
      && element.getVideoPlaybackQuality().totalVideoFrames > start.frames, initial)).toBe(true);
}

export async function armSeek(page: Page) {
  return page.evaluate(() => {
    const observation = window.__playbackObservation!;
    return { sequence: observation.sequence, generation: observation.sourceGeneration };
  });
}

export async function seekObservation(page: Page, arm: Awaited<ReturnType<typeof armSeek>>, target: number) {
  return page.evaluate(({ arm, target }) => {
    const observation = window.__playbackObservation!;
    const fresh = observation.events.filter(event => event.sequence > arm.sequence);
    const started = fresh.find(event => event.name === "timeshift");
    const completed = fresh.find(event => event.name === "timeshifted" && event.sequence > (started?.sequence ?? Infinity));
    const readout = document.querySelector(".panel-readout")?.textContent ?? "";
    const offset = Number(readout.match(/\btimeShift:\s*([+-]?\d+(?:\.\d+)?)/)?.[1] ?? NaN);
    const atEdge = readout.match(/\batLiveEdge:\s*(true|false)/)?.[1];
    const label = document.querySelector(".bmpui-ui-label-behindlive")?.textContent?.trim() ?? "";
    return {
      sameOwner: observation.video === document.querySelector("#player video") && observation.video.isConnected
        && observation.log === document.querySelector(".panel-log") && observation.log.isConnected,
      sameSource: observation.sourceGeneration === arm.generation,
      sdkCompleted: Boolean(started && completed),
      nativeCompleted: fresh.some(event => event.name === "native-seeked" && event.sequence > (started?.sequence ?? Infinity)),
      offsetMatches: Number.isFinite(offset) && Math.abs(offset - target) <= (target === 0 ? 1 : 2),
      edgeMatches: atEdge === String(target === 0),
      labelMatches: target === 0 ? label === "LIVE" : /^-\d+(?:\.\d+)?s behind$/.test(label),
    };
  }, { arm, target });
}

export async function expectCompletedSeek(page: Page, arm: Awaited<ReturnType<typeof armSeek>>, target: number): Promise<void> {
  await expect.poll(() => seekObservation(page, arm, target)).toEqual({
    sameOwner: true, sameSource: true, sdkCompleted: true, nativeCompleted: true,
    offsetMatches: true, edgeMatches: true, labelMatches: true,
  });
  await expectVisiblePixels(page.locator(".bmpui-ui-label-behindlive"));
  await expectMovingVideo(page);
}
