import { text, type Locale, type TextKey } from "./i18n.ts";
import { createTimelineGeometry } from "./timeline-geometry.ts";
import type { EngagementSnapshot, MetricMode } from "./types.ts";

const HINTS: Record<string, TextKey> = {
  sparse: "sampleSparse", single: "sampleSingle", broader: "sampleBroader",
  watched: "sampleWatched", empty: "sampleEmpty",
};
const SVG = "http://www.w3.org/2000/svg";

/** Compare both distributions without independently amplifying the smaller one. */
export function renderSamplePreviews(snapshot: EngagementSnapshot | null, profile: string, locale: Locale): void {
  const hint = document.querySelector<HTMLElement>("#profile-hint")!;
  const hintText = snapshot && HINTS[profile] ? text(locale, HINTS[profile]) : "";
  if (hint.textContent !== hintText) hint.textContent = hintText;
  for (const mode of ["reach", "replay"] as MetricMode[]) {
    const svg = document.querySelector<SVGSVGElement>(`#preview-${mode}`)!;
    const empty = document.querySelector<HTMLElement>(`#preview-${mode}-empty`)!;
    svg.replaceChildren();
    const geometry = createTimelineGeometry(snapshot, mode, 240, 36, "coverage");
    svg.dataset.scale = "0-1";
    svg.dataset.state = !snapshot ? "unknown" : !geometry.hasValues ? "empty" : !geometry.hasPositiveValues ? "zero" : "populated";
    for (const segment of geometry.segments) {
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("d", segment.fillPath);
      svg.append(path);
    }
    empty.hidden = geometry.hasPositiveValues;
    empty.textContent = !snapshot ? "—" : !geometry.hasValues ? text(locale, "noRecords") : text(locale, "noRewatch");
  }
}
