import type { EngagementPoint, EngagementSnapshot, MetricMode } from "./types.ts";

export interface TimelinePosition {
  x: number;
  y: number;
  value: number;
  rawValue: number;
}

export interface TimelineSegment {
  startX: number;
  endX: number;
  points: TimelinePosition[];
  linePath: string;
  fillPath: string;
}

export interface TimelineGeometry {
  segments: TimelineSegment[];
  peaks: TimelinePosition[];
  baselineY: number;
  maximum: number;
  hasValues: boolean;
  hasPositiveValues: boolean;
}

interface ObservedPoint {
  source: EngagementPoint;
  rawValue: number;
  value: number;
}

/** Shared tangents make a smooth silhouette; bounded controls cannot invent extrema. */
function smoothPath(points: { x: number; y: number }[]): string {
  const slopes = points.slice(1).map((point, index) => (point.y - points[index].y) / (point.x - points[index].x));
  const tangents = points.map(() => 0);
  for (let index = 1; index < points.length - 1; index++) {
    const left = slopes[index - 1];
    const right = slopes[index];
    if (left * right <= 0) continue;
    const before = points[index].x - points[index - 1].x;
    const after = points[index + 1].x - points[index].x;
    const firstWeight = 2 * after + before;
    const secondWeight = after + 2 * before;
    const tangent = (firstWeight + secondWeight) / (firstWeight / left + secondWeight / right);
    tangents[index] = Math.sign(tangent) * Math.min(Math.abs(tangent), 3 * Math.min(Math.abs(left), Math.abs(right)));
  }
  const coordinate = (value: number) => Number(value.toFixed(3));
  const pair = (x: number, y: number) => `${coordinate(x)} ${coordinate(y)}`;
  return `M${pair(points[0].x, points[0].y)} ${points.slice(1).map((point, index) => {
    const previous = points[index];
    const third = (point.x - previous.x) / 3;
    return `C${pair(previous.x + third, previous.y + tangents[index] * third)} ${pair(point.x - third, point.y - tangents[index + 1] * third)} ${pair(point.x, point.y)}`;
  }).join(" ")}`;
}

/** Creates display geometry only. The snapshot's measurements and support are never changed. */
export function createTimelineGeometry(
  snapshot: EngagementSnapshot | null,
  mode: MetricMode,
  width: number,
  height: number,
  normalization: "within-video" | "coverage" = "within-video",
): TimelineGeometry {
  const empty: TimelineGeometry = {
    segments: [], peaks: [], baselineY: Math.max(0, height - 1),
    maximum: 0, hasValues: false, hasPositiveValues: false,
  };
  const duration = snapshot?.content.durationMs ?? 0;
  if (!snapshot || !Number.isFinite(duration) || duration <= 0 ||
      !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 2) return empty;

  const runs: ObservedPoint[][] = [];
  let run: ObservedPoint[] = [];
  for (const point of snapshot.points) {
    const value = point[mode];
    const valid = value !== null && Number.isFinite(value) && value >= 0 && value <= 1 &&
      Number.isFinite(point.startMs) && Number.isFinite(point.endMs) &&
      point.startMs >= 0 && point.endMs <= duration && point.endMs > point.startMs;
    if (!valid) {
      if (run.length) runs.push(run);
      run = [];
      continue;
    }
    if (run.length && Math.abs(run[run.length - 1].source.endMs - point.startMs) > 0.001) {
      runs.push(run);
      run = [];
    }
    run.push({ source: point, rawValue: value, value });
  }
  if (run.length) runs.push(run);
  if (!runs.length) return empty;

  // A convex local average cannot overshoot or create observations across a missing interval.
  const strength = 1 / (1 + Math.sqrt(Math.max(1, snapshot.sessionCount)));
  let maximum = 0;
  let displayMaximum = 0;
  for (const points of runs) {
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const neighbors = points.slice(Math.max(0, index - 1), index + 2);
      const average = (point.rawValue + neighbors.reduce((total, neighbor) => total + neighbor.rawValue, 0)) /
        (neighbors.length + 1);
      point.value = point.rawValue * (1 - strength) + average * strength;
      maximum = Math.max(maximum, point.rawValue);
      displayMaximum = Math.max(displayMaximum, point.value);
    }
  }

  const baselineY = empty.baselineY;
  const x = (time: number) => time / duration * width;
  const scaleMaximum = normalization === "coverage" ? 1 : displayMaximum;
  const y = (value: number) => scaleMaximum > 0 ? baselineY - value / scaleMaximum * (height - 3) : baselineY;
  const coordinate = (value: number) => Number(value.toFixed(3));
  const peaks: TimelinePosition[] = [];
  const segments = runs.map((points): TimelineSegment => {
    const projected = points.map(point => ({
      x: x((point.source.startMs + point.source.endMs) / 2),
      y: y(point.value), value: point.value, rawValue: point.rawValue,
    }));
    const startX = x(points[0].source.startMs);
    const endX = x(points[points.length - 1].source.endMs);
    const first = { x: startX, y: projected[0].y };
    const last = { x: endX, y: projected[projected.length - 1].y };
    const linePath = smoothPath([first, ...projected, last]);

    // Mark only maxima present in the original data; flat distributions have no invented peak.
    for (let index = 0; index < points.length;) {
      let end = index;
      while (end + 1 < points.length && points[end + 1].rawValue === points[index].rawValue) end += 1;
      const value = points[index].rawValue;
      const left = index > 0 ? points[index - 1].rawValue : null;
      const right = end + 1 < points.length ? points[end + 1].rawValue : null;
      if (value > 0 && (left === null || value > left) && (right === null || value > right) &&
          (left !== null || right !== null)) {
        const middle = Math.floor((index + end) / 2);
        peaks.push(projected[middle]);
      }
      index = end + 1;
    }
    return {
      startX, endX, points: projected, linePath,
      fillPath: `${linePath} L${coordinate(endX)} ${coordinate(baselineY)} L${coordinate(startX)} ${coordinate(baselineY)} Z`,
    };
  });
  return { segments, peaks, baselineY, maximum, hasValues: true, hasPositiveValues: maximum > 0 };
}
