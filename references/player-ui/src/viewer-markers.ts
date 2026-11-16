import type { TimelineMarker, TimelineMarkersApi } from "bitmovin-player-ui";

export interface ViewerMarkerDefinition {
  id: string;
  startMs: number;
  endMs: number;
  title: string;
}

/** Replace only reference-owned markers through the official UI API. */
export function createViewerMarkers(api: TimelineMarkersApi) {
  let owned: TimelineMarker[] = [];
  let signature = "";
  return {
    set(definitions: readonly ViewerMarkerDefinition[]): void {
      if (!Array.isArray(definitions) || definitions.length > 64) throw new Error("Invalid viewer markers");
      const ids = new Set<string>();
      for (const item of definitions) {
        if (typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id) ||
          !Number.isSafeInteger(item.startMs) || !Number.isSafeInteger(item.endMs) || item.startMs < 0 || item.endMs <= item.startMs ||
          typeof item.title !== "string" || !item.title.trim() || item.title.length > 160) throw new Error("Invalid viewer marker");
        ids.add(item.id);
      }
      const next = JSON.stringify(definitions.map(item => [item.id, item.startMs, item.endMs, item.title]));
      const current = api.list();
      if (next === signature && owned.every(marker => current.includes(marker))) return;
      for (const marker of owned) api.remove(marker);
      // Official Label text accepts HTML, so CMS titles are escaped as plain text.
      const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
      owned = definitions.map(item => ({
        time: item.startMs / 1000,
        duration: (item.endMs - item.startMs) / 1000,
        title: escape(item.title),
        cssClasses: ["pl-viewer-marker", `pl-viewer-marker-${item.id}`],
      }));
      for (const marker of owned) api.add(marker);
      signature = next;
    },
  };
}
