import type { PlayerAPI } from "bitmovin-player";
import { Component, type ComponentConfig, type SeekBar, type UIInstanceManager } from "bitmovin-player-ui";
import { createTimelineGeometry } from "./timeline-geometry.ts";
import type { EngagementSnapshot, MetricMode } from "./types.ts";

export interface EngagementTimelineConfig extends ComponentConfig {
  /** The official seek component remains the only interactive timeline. */
  seekBar?: SeekBar;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** A noninteractive aggregate-data layer composed with the official Player UI. */
export class EngagementTimeline extends Component<EngagementTimelineConfig> {
  private snapshot: EngagementSnapshot | null = null;
  private mode: MetricMode = "replay";
  private graphEnabled = true;
  private svg: SVGSVGElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private instanceManager: UIInstanceManager | null = null;
  private pendingFrame: number | null = null;
  private released = false;

  constructor(config: EngagementTimelineConfig = {}) {
    super({ ...config, cssClass: config.cssClass ?? "ui-engagement-timeline" });
  }

  override configure(player: PlayerAPI, uiManager: UIInstanceManager): void {
    super.configure(player, uiManager);
    this.instanceManager = uiManager;
    uiManager.onConfigured.subscribe(this.scheduleRender);
    uiManager.onActive.subscribe(this.scheduleRender);
    const host = this.getDomElement().get(0) as HTMLElement;
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.scheduleRender);
      this.resizeObserver.observe(host);
      if (this.config.seekBar) this.resizeObserver.observe(this.config.seekBar.getDomElement().get(0));
      if (host.parentElement) this.resizeObserver.observe(host.parentElement);
    } else {
      window.addEventListener("resize", this.scheduleRender);
    }
    this.scheduleRender();
  }

  setData(snapshot: EngagementSnapshot | null, mode: MetricMode, locale: "en" | "ja"): void {
    this.snapshot = snapshot;
    this.mode = mode;
    const host = this.getDomElement().get(0) as HTMLElement;
    host.lang = locale;
    host.dataset.metric = mode;
    host.dataset.sessions = String(snapshot?.sessionCount ?? 0);
    this.render();
  }

  setEnabled(enabled: boolean): void {
    this.graphEnabled = enabled;
    this.render();
  }

  protected override toDomElement() {
    const element = super.toDomElement();
    const host = element.get(0) as HTMLElement;
    host.classList.add("pl-engagement-timeline");
    host.setAttribute("aria-hidden", "true");
    host.style.position = "absolute";
    host.style.height = "var(--engagement-height, 28px)";
    host.style.pointerEvents = "none";
    host.style.visibility = "hidden";
    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.classList.add("pl-engagement-svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.display = "block";
    host.append(svg);
    this.svg = svg;
    return element;
  }

  private scheduleRender = (): void => {
    if (this.released || this.pendingFrame !== null) return;
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = null;
      this.render();
    });
  };

  private render(): void {
    if (this.released) return;
    const host = this.getDomElement().get(0) as HTMLElement;
    if (!this.svg) return;
    if (!this.graphEnabled || !this.snapshot) {
      host.style.visibility = "hidden";
      this.svg.replaceChildren();
      return;
    }

    const seekElement = this.config.seekBar?.getDomElement().get(0) as HTMLElement | undefined;
    // The visible track is narrower than the official component's accessible hit area.
    const track = seekElement?.querySelector<HTMLElement>(".bmpui-seekbar") ?? seekElement;
    const targetRect = (track ?? host.parentElement)?.getBoundingClientRect();
    const parentRect = (host.offsetParent ?? host.parentElement)?.getBoundingClientRect();
    const height = host.getBoundingClientRect().height || 28;
    const width = targetRect?.width ?? 0;
    if (targetRect && parentRect) {
      host.style.left = `${targetRect.left - parentRect.left}px`;
      host.style.top = `${targetRect.top - parentRect.top - height + 1}px`;
      host.style.width = `${width}px`;
    }
    const geometry = createTimelineGeometry(this.snapshot, this.mode, width, height);
    host.style.visibility = geometry.hasValues ? "visible" : "hidden";
    host.dataset.empty = String(!geometry.hasPositiveValues);
    host.dataset.normalization = "within-video";
    this.svg.setAttribute("viewBox", `0 0 ${width || 1} ${height}`);
    const elements: SVGElement[] = [];
    for (const segment of geometry.segments) {
      const fill = document.createElementNS(SVG_NAMESPACE, "path");
      fill.classList.add("pl-engagement-fill");
      fill.setAttribute("d", segment.fillPath);
      elements.push(fill);
    }
    this.svg.replaceChildren(...elements);
  }

  override release(): void {
    this.released = true;
    if (this.pendingFrame !== null) cancelAnimationFrame(this.pendingFrame);
    this.pendingFrame = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener("resize", this.scheduleRender);
    this.instanceManager?.onConfigured.unsubscribe(this.scheduleRender);
    this.instanceManager?.onActive.unsubscribe(this.scheduleRender);
    this.instanceManager = null;
    this.snapshot = null;
    this.svg?.replaceChildren();
    super.release();
  }
}
