import { pick } from "../i18n";
import { DemoSession, type DemoSource, type DemoSample } from "./demo-session";
import { DEMO_ENGINES, ENGINE_NAMES, seekTarget, type DemoRecord } from "./demo-results";
import { makeTrialOrder } from "./model";
import type { EngineId } from "./contract";

/** Owns active players; charts never create or mutate playback sessions. */
export class DemoComparison {
  readonly records: DemoRecord[] = [];
  running = false;
  selected: EngineId = "web-x";
  parallel = false;
  source: DemoSource | null = null;
  measuredNetwork = false;
  private generation = 0;
  private controller: AbortController | null = null;
  private sessions = new Map<EngineId, DemoSession>();
  private available = new Set<EngineId>();
  private latest = new Map<EngineId, DemoSample>();
  private releasing: Promise<boolean> | null = null;

  constructor(private readonly ui: {
    stages: Map<EngineId, HTMLElement>;
    update: () => void;
    status: (message: string) => void;
    network: (message: string) => void;
  }) {}

  get hasPlayback(): boolean { return this.parallel ? this.available.size > 0 : this.available.has(this.selected); }

  private release(): Promise<boolean> {
    if (this.releasing) return this.releasing;
    const sessions = [...this.sessions.values()]; this.sessions.clear();
    this.available.clear();
    this.releasing = Promise.allSettled(sessions.map((session) => session.dispose())).then((outcomes) => {
      this.latest.clear();
      return outcomes.every((outcome) => outcome.status === "fulfilled");
    }).finally(() => { this.releasing = null; });
    return this.releasing;
  }

  private create(engine: EngineId, record?: DemoRecord): DemoSession {
    const session = new DemoSession({ engine, container: this.ui.stages.get(engine)!, onSample: (sample) => {
      this.latest.set(engine, sample);
      if (!record || !this.running || this.controller?.signal.aborted) return;
      if (record.samples.length >= 600) record.samples.shift();
      record.samples.push(sample);
    } });
    this.sessions.set(engine, session);
    return session;
  }

  async measure(source: DemoSource, network: boolean): Promise<void> {
    if (this.running) return;
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController(); this.controller = controller;
    this.running = true; this.source = source; this.measuredNetwork = network; this.records.length = 0;
    this.ui.network(""); this.ui.update();
    let failed = false;
    try {
      if (!await this.release()) throw new Error("cleanup-failed");
      const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
      const order = makeTrialOrder(1, seed)[0]!;
      for (const engine of order) {
        if (controller.signal.aborted) break;
        if (!await this.release()) throw new Error("cleanup-failed");
        this.selected = engine;
        const record: DemoRecord = { engine, startup: null, seek: null, samples: [], phase: "startup" };
        this.records.push(record); this.ui.update();
        this.ui.status(`${ENGINE_NAMES[engine]} · ${pick({ ja: "再生開始を計測中", en: "Measuring startup" })}`);
        let selectedAt = performance.timeOrigin + performance.now();
        const session = this.create(engine, record);
        if (network) {
          try { await session.setNetworkRate(250_000); }
          catch { this.ui.network(pick({ ja: "この環境では回線制御を開始できません。", en: "Delivery control is unavailable in this environment." })); }
          selectedAt = performance.timeOrigin + performance.now();
        }
        record.startup = await session.start({ source, signal: controller.signal, selectedAt, profile: "startup" });
        if (record.startup.status === "success") this.available.add(engine);
        this.ui.update();
        if (record.startup.status !== "success") continue;
        this.ui.status(`${ENGINE_NAMES[engine]} · ${pick({ ja: "再生中", en: "Playing" })}`);
        await delay(1800, controller.signal);
        const sample = record.samples[record.samples.length - 1];
        const target = sample ? seekTarget(sample) : null;
        if (!network && target !== null && !controller.signal.aborted) {
          record.phase = "seek";
          this.ui.status(`${ENGINE_NAMES[engine]} · ${pick({ ja: "シークを計測中", en: "Measuring seek" })}`);
          record.seek = await session.seek(target, controller.signal); this.ui.update();
        }
        if (network && !controller.signal.aborted) {
          record.phase = "network";
          record.networkPhases = [];
          for (const [rate, duration] of [[250_000, 3000], [12_500, 14000], [250_000, 6000]] as const) {
            if (controller.signal.aborted) break;
            const before = await session.setNetworkRate(rate).catch(() => null);
            this.ui.status(`${ENGINE_NAMES[engine]} · ${pick({ ja: "配信速度", en: "Delivery rate" })} ${rate * 8 / 1000} kbit/s`);
            await delay(duration, controller.signal);
            if (controller.signal.aborted) break;
            const after = await session.setNetworkRate(rate).catch(() => null);
            const deliveredBytes = before && after ? Math.max(0, after.deliveredBytes - before.deliveredBytes) : 0;
            const controlled = after?.support === "ready" && after.skippedResponses === 0 && deliveredBytes > 0;
            record.networkPhases.push({ rateBytesPerSecond: rate, deliveredBytes, controlled });
            this.ui.network(controlled
              ? pick({ ja: "この区間で配信速度の制御を確認しました。", en: "Media delivery control was observed in this interval." })
              : pick({ ja: "配信速度の制御を確認できません。この区間は回線比較の対象外です。", en: "Delivery control was not confirmed. This interval does not qualify for a network comparison." }));
            this.ui.update();
          }
          await session.setNetworkRate(null).catch(() => undefined);
        } else await delay(1200, controller.signal);
        record.phase = "complete";
      }
    } catch {
      failed = !controller.signal.aborted;
      const record = this.records[this.records.length - 1];
      if (record && !record.startup) record.startup = {
        status: controller.signal.aborted ? "cancelled" : "failure",
        failureCode: controller.signal.aborted ? "aborted" : "initialization-failed",
        sdkCode: null, marks: {}, metadata: null, frameCallbackAvailable: false,
      };
    } finally {
      if (generation === this.generation) {
        this.running = false;
        if (controller.signal.aborted || failed) await this.release();
        const successful = this.records.filter((record) => record.startup?.status === "success").pop();
        this.ui.status(controller.signal.aborted ? pick({ ja: "計測を中止しました。", en: "Measurement cancelled." })
          : failed ? pick({ ja: "計測を継続できませんでした。再計測してください。", en: "Measurement stopped. Select Measure again to retry." })
          : !successful ? pick({ ja: "再生できませんでした。URLと対応形式を確認してください。", en: "No player could play this source. Check the URL and supported formats." })
          : pick({ ja: "計測終了。映像はそのまま操作できます。", en: "Measurement complete. Playback controls remain available." }));
        this.ui.update();
        if (successful && !controller.signal.aborted && !failed && (this.parallel || !this.hasPlayback)) await this.preview(successful.engine);
      }
    }
  }

  cancel(): void { this.controller?.abort(); }

  async preview(engine = this.selected): Promise<void> {
    if (this.running || !this.source) return;
    const generation = ++this.generation;
    this.controller?.abort(); this.controller = new AbortController();
    this.ui.status(pick({ ja: "プレビューを準備中", en: "Preparing preview" }));
    if (!await this.release()) {
      this.ui.status(pick({ ja: "前のプレイヤーを終了できませんでした。ページを再読み込みしてください。", en: "The previous player could not be released. Reload this page." }));
      return;
    }
    if (generation !== this.generation) return;
    this.selected = engine; this.ui.update();
    const signal = this.controller.signal;
    const engines = this.parallel ? DEMO_ENGINES : [engine];
    await Promise.all(engines.map(async (current) => {
      if (signal.aborted || generation !== this.generation) return;
      const session = this.create(current);
      try {
        const result = await session.start({ source: this.source!, signal, profile: "startup" });
        if (result.status === "success" && generation === this.generation && !signal.aborted) this.available.add(current);
      }
      catch { /* Each preview is independent; measurement results remain unchanged. */ }
    }));
    if (generation === this.generation && !signal.aborted) {
      this.ui.status(this.hasPlayback ? pick({ ja: "プレビューを再生中", en: "Preview playing" })
        : pick({ ja: "再生できませんでした。", en: "Playback failed." }));
      this.ui.update();
    }
  }

  async play(): Promise<void> {
    await Promise.allSettled([...this.sessions.values()].map((session) => session.play()));
  }
  pause(): void { for (const session of this.sessions.values()) session.pause(); }
  async seek(): Promise<void> {
    const signal = this.controller?.signal ?? new AbortController().signal;
    await Promise.allSettled([...this.sessions.entries()].map(([engine, session]) => {
      const sample = this.latest.get(engine); const target = sample ? seekTarget(sample) : null;
      return target === null ? Promise.resolve() : session.seek(target, signal);
    }));
  }
  async dispose(): Promise<void> { ++this.generation; this.cancel(); await this.release(); }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { window.clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = window.setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}
