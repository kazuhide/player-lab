/**
 * Bitmovin Analytics query view (server-proxied). Unlike the live, client-side QoE panel (§15),
 * this queries AGGREGATED analytics for the configured Analytics license — but it does so through
 * the local `/api/analytics/query` proxy (see vite.config.ts + src/server/analyticsProxy.ts), so
 * the secret Analytics API key stays on the server and never reaches the browser.
 *
 * Presets run a single aggregate over the last 7 days. When the server has no key configured the
 * proxy returns `not_configured` and this view shows an honest "set it server-side" message — so
 * the demo is useful (and truthful) whether or not Analytics is wired up.
 */
import { pick, type L } from "./i18n";
import { LangBinder } from "./i18nDom";
import { infoChip } from "./infoChip";

interface Preset {
  id: string;
  label: L;
  aggregation: string;
  dimension: string;
}

// Well-known Bitmovin Analytics dimensions. A single aggregate (no interval) over the range.
const PRESETS: Preset[] = [
  { id: "impressions", label: { ja: "インプレッション数", en: "Impressions" }, aggregation: "count", dimension: "IMPRESSION_ID" },
  { id: "startup", label: { ja: "平均スタートアップ時間", en: "Avg startup time" }, aggregation: "avg", dimension: "STARTUPTIME" },
  { id: "videoStartup", label: { ja: "平均ビデオスタートアップ", en: "Avg video startup" }, aggregation: "avg", dimension: "VIDEO_STARTUPTIME" },
  { id: "buffered", label: { ja: "平均バッファ時間", en: "Avg buffered (rebuffer)" }, aggregation: "avg", dimension: "BUFFERED" },
];

const TITLE: L = { ja: "Bitmovin Analytics(サーバー経由クエリ)", en: "Bitmovin Analytics (server-proxied query)" };
const INTRO: L = {
  ja: "直近7日間の集計を、ローカルの /api/analytics/query プロキシ経由で取得します。秘密の API キーはサーバー側に留まり、ブラウザには出ません。",
  en: "Aggregates over the last 7 days, fetched via the local /api/analytics/query proxy. The secret API key stays on the server and never reaches the browser.",
};
const HINT: L = {
  ja: "QoE パネル(§15)がブラウザ側のリアルタイム値なのに対し、こちらは集計済みの Analytics データです。本番では同じ handleAnalyticsQuery をサーバーレス関数等に配置します。",
  en: "Where the QoE panel (§15) shows live client-side values, this is AGGREGATED Analytics data. In production, deploy the same handleAnalyticsQuery as a serverless function.",
};
const RUNNING: L = { ja: "問い合わせ中…", en: "Querying…" };
const NOT_CONFIGURED: L = {
  ja: "サーバーに API キー未設定です。リポジトリ直下の .env に BITMOVIN_API_KEY と BITMOVIN_ANALYTICS_LICENSE_KEY を設定すると有効になります(鍵はサーバー側のみ)。",
  en: "No API key on the server. Set BITMOVIN_API_KEY and BITMOVIN_ANALYTICS_LICENSE_KEY in the repo-root .env to enable it (the key stays server-side).",
};
const PROXY_UNAVAILABLE: L = {
  ja: "プロキシに到達できません(静的ビルドではミドルウェアが動きません — dev サーバー or バックエンドが必要)。",
  en: "The proxy isn’t reachable (the middleware doesn’t run in a static build — needs the dev server or a backend).",
};
const STATIC_HOST_UNAVAILABLE: L = {
  ja: "このページは静的ファイルのみを配信するため、集計済みの Analytics データは取得できません。現在の再生セッションの計測値はブラウザー内の QoE パネルで確認できます。",
  en: "Aggregated Analytics queries are unavailable on this static host because they require a server endpoint. The QoE panel still shows measurements from the current playback session.",
};
const COLLECTOR_NOTICE: L = {
  ja: "利用状況と再生品質の確認のため、再生情報や端末情報を Bitmovin Analytics へ送信します。",
  en: "Playback and device information is sent to Bitmovin Analytics to measure usage and playback quality.",
};

function isoDaysAgo(now: number, days: number): string {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

export interface AnalyticsView {
  el: HTMLElement;
  relocalize: () => void;
}

/** Build the Analytics query view. Returns its root element + a relocalize hook (main.ts calls
 *  it on language change so the view follows the language without losing a shown result). */
export function createAnalyticsView(): AnalyticsView {
  const staticHost = import.meta.env.MODE === "pages";
  const binder = new LangBinder();
  const root = document.createElement("section");
  root.className = "analytics-panel";

  const h2 = document.createElement("h2");
  h2.append(binder.span(TITLE));
  h2.append(infoChip(staticHost ? STATIC_HOST_UNAVAILABLE : HINT));

  const intro = document.createElement("p");
  intro.className = "analytics-intro";
  binder.text(intro, staticHost ? STATIC_HOST_UNAVAILABLE : INTRO);

  const controls = document.createElement("div");
  controls.className = "analytics-controls";
  for (const p of PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "analytics-preset";
    b.disabled = staticHost;
    binder.text(b, p.label);
    b.addEventListener("click", () => void runQuery(p));
    controls.appendChild(b);
  }

  // The status line follows the language: remember the current message as an `L` and re-pick it
  // on relocalize. The result table below is data (not localized), so it survives a toggle.
  const status = document.createElement("p");
  status.className = "analytics-status";
  let statusL: L | null = null;
  function setStatus(l: L | null): void {
    statusL = l;
    status.textContent = l ? pick(l) : "";
  }

  const result = document.createElement("pre");
  result.className = "analytics-result";
  result.hidden = true;

  async function runQuery(p: Preset): Promise<void> {
    if (staticHost) {
      setStatus(STATIC_HOST_UNAVAILABLE);
      return;
    }
    setStatus(RUNNING);
    result.hidden = true;
    const now = Date.now();
    let r: Response;
    try {
      r = await fetch("/api/analytics/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aggregation: p.aggregation,
          dimension: p.dimension,
          start: isoDaysAgo(now, 7),
          end: new Date(now).toISOString(),
        }),
      });
    } catch {
      setStatus(PROXY_UNAVAILABLE);
      return;
    }
    let data: { error?: string; message?: string; rows?: unknown[][]; rowCount?: number } = {};
    try {
      data = (await r.json()) as typeof data;
    } catch {
      /* leave data empty */
    }
    if (r.status === 503 && data.error === "not_configured") {
      setStatus(NOT_CONFIGURED);
      return;
    }
    if (!r.ok) {
      // Upstream/proxy error — show its message verbatim (already English from the API).
      setStatus({ ja: `エラー: ${data.message ?? r.status}`, en: `Error: ${data.message ?? r.status}` });
      return;
    }
    const rows = Array.isArray(data.rows) ? data.rows : [];
    setStatus({
      ja: `${pick(p.label)} — ${data.rowCount ?? rows.length} 行`,
      en: `${pick(p.label)} — ${data.rowCount ?? rows.length} row(s)`,
    });
    result.textContent = rows.length ? rows.map((row) => (Array.isArray(row) ? row.join("    ") : String(row))).join("\n") : "(no rows)";
    result.hidden = false;
  }

  root.append(h2, intro);
  if (staticHost && import.meta.env.VITE_BITMOVIN_ANALYTICS_LICENSE_KEY) {
    const notice = document.createElement("p");
    notice.className = "analytics-collector-notice";
    binder.text(notice, COLLECTOR_NOTICE);
    root.appendChild(notice);
  }
  root.append(controls, status, result);

  return {
    el: root,
    relocalize: () => {
      binder.relocalize();
      setStatus(statusL); // re-pick the current status in the new language
    },
  };
}
