/** Synthetic fixture fields follow the public Analytics impression-sample model. */
export interface AnalyticsSample {
  impressionId: string;
  sequenceNumber: number;
  time: number;
  videoId: string;
  videoDuration: number;
  videotimeStart: number;
  videotimeEnd: number;
  played: number;
  state: string;
  ad: number;
  videoBitrate?: number;
  videoPlaybackWidth?: number;
  videoPlaybackHeight?: number;
}

export interface DemoContent {
  id: string;
  revision: string;
  durationMs: number;
}

/** This wrapper is a Player Lab fixture, not an Analytics Export API response. */
export interface DemoExport {
  schemaVersion: 1;
  synthetic: true;
  content: DemoContent;
  period: { start: string; end: string };
  samples: AnalyticsSample[];
}

export type MetricMode = "replay" | "reach";

export interface EngagementPoint {
  startMs: number;
  endMs: number;
  replay: number | null;
  reach: number | null;
  support: number;
}

/** Only this compact, identity-free shape is fetched during playback. */
export interface EngagementSnapshot {
  schemaVersion: 1;
  metricVersion: "replay-coverage-v1";
  synthetic: true;
  content: DemoContent;
  period: { start: string; end: string };
  generatedAt: string;
  sessionCount: number;
  bucketWidthMs: number;
  suggestedMode: MetricMode | "empty";
  points: EngagementPoint[];
}

export interface QueryIncidencePoint extends EngagementPoint {
  replay: null;
}

/** Query overlap counts measure interval incidence; they contain no replay measurement. */
export interface QueryIncidenceSnapshot {
  schemaVersion: 1;
  metricVersion: "watched-impression-incidence-v1";
  synthetic: false;
  content: DemoContent;
  period: { start: string; end: string };
  generatedAt: string;
  sessionCount: number;
  bucketWidthMs: number;
  points: QueryIncidencePoint[];
}

export type TimelineSnapshot = EngagementSnapshot | QueryIncidenceSnapshot;

export interface DemoProfile {
  id: string;
  title: { en: string; ja: string };
  snapshot: string;
  samples: string;
}

export interface DemoManifest {
  schemaVersion: 1;
  synthetic: true;
  content: DemoContent;
  profiles: DemoProfile[];
}
