import { chapterProgress, deriveViewerHistory, selectHighlights, type ViewerHistory } from "./viewer-data.ts";
import { VIEWER_CATALOG, VIEWER_HISTORY_EXAMPLES } from "./viewer-fixtures.ts";
import { text, timeLabel, type Locale, type TextKey } from "./i18n.ts";
import type { Playback } from "./playback.ts";
import type { DemoContent, TimelineSnapshot } from "./types.ts";

type Tab = "highlights" | "history" | "preferences";
interface Context { playback?: Playback; snapshot: TimelineSnapshot | null; content?: DemoContent; demoSource: boolean; locale: Locale }
const tabs: Tab[] = ["highlights", "history", "preferences"];
const element = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;
const sameContent = (a: DemoContent | undefined, b: DemoContent): boolean => !!a && a.id === b.id && a.revision === b.revision && a.durationMs === b.durationMs;

export function createViewerExperienceView() {
  const root = element("viewer-experiences");
  const budget = element<HTMLSelectElement>("viewer-highlight-budget");
  const example = element<HTMLSelectElement>("viewer-history-example");
  const consent = element<HTMLInputElement>("viewer-use-history");
  const details = element<HTMLDetailsElement>("viewer-data-details");
  let context: Context = { snapshot: null, demoSource: false, locale: "en" };
  let selectedTab: Tab = "highlights";
  let exampleId = "saved";
  let cleared = false;
  let available = false;
  let history: ViewerHistory | null = null;
  let queue = selectHighlights(null, VIEWER_CATALOG);
  let unsubscribe: (() => void) | undefined;

  const label = (key: TextKey): string => text(context.locale, key);
  const selectedExample = () => VIEWER_HISTORY_EXAMPLES.find(item => item.id === exampleId)!;
  const hasHistory = () => available && consent.checked && !cleared;
  const canResume = () => hasHistory() && history?.resumeMs !== null && history?.status !== "completed" && !!history;
  const nextUnwatched = () => hasHistory() ? history?.unwatchedRanges?.[0]?.[0] : undefined;

  function selectTab(next: Tab, focus = false): void {
    selectedTab = next;
    for (const tab of tabs) {
      const button = element<HTMLButtonElement>(`viewer-tab-${tab}`);
      button.setAttribute("aria-selected", String(tab === next));
      button.tabIndex = tab === next ? 0 : -1;
      element(`viewer-panel-${tab}`).hidden = tab !== next;
    }
    if (focus) element(`viewer-tab-${next}`).focus();
    renderMarkers();
    renderActions();
  }

  function renderMarkers(): void {
    const sections = !available ? [] : selectedTab === "highlights" ? queue.items : selectedTab === "history" ? VIEWER_CATALOG.chapters : [];
    context.playback?.ui.setViewerMarkers(sections.map(section => ({ ...section, title: section.title[context.locale] })));
  }

  function renderActions(): void {
    const state = context.playback?.viewer.state;
    root.dataset.mode = state?.mode ?? "full";
    const seeking = state?.status === "seeking";
    element<HTMLButtonElement>("viewer-highlight-start").disabled = !available || !state?.available || queue.status !== "ready" || seeking;
    element<HTMLButtonElement>("viewer-highlight-return").disabled = state?.mode !== "highlights";
    for (const row of root.querySelectorAll<HTMLElement>("#viewer-highlight-list li")) row.dataset.active = String(row.dataset.clipId === state?.activeClipId);
    const resume = element<HTMLButtonElement>("viewer-history-resume");
    resume.disabled = !canResume() || !state?.available || seeking;
    resume.dataset.timeMs = history?.resumeMs === null || !hasHistory() ? "" : String(history?.resumeMs ?? "");
    resume.textContent = `${label("viewerResume")}${!resume.disabled ? ` · ${timeLabel(history!.resumeMs!)}` : ""}`;
    const unwatched = element<HTMLButtonElement>("viewer-history-unwatched");
    unwatched.disabled = nextUnwatched() === undefined || !state?.available || seeking;
    unwatched.dataset.timeMs = String(nextUnwatched() ?? "");
    for (const button of root.querySelectorAll<HTMLButtonElement>("#viewer-chapters button")) button.disabled = !hasHistory() || !state?.available;
    const availability = state?.preferences;
    for (const [field, key] of [["subtitles", "viewerSubtitles"], ["audio", "viewerAudio"]] as const) {
      const row = element(`viewer-preference-${field}`);
      const fieldState = hasHistory() ? availability?.[field] ?? "unknown" : "unknown";
      row.dataset.availability = fieldState;
      row.querySelector("dt")!.textContent = label(key);
      const preferences = history?.preferences;
      const language = field === "audio" ? preferences?.audioLanguage : preferences?.subtitleLanguage;
      const value = !hasHistory() || !preferences || (field === "subtitles" && preferences.subtitleEnabled === null) || (field === "audio" && !language)
        ? label("viewerNotRecorded") : field === "subtitles" && preferences.subtitleEnabled === false ? label("viewerOff") : languageName(language);
      const dd = row.querySelector("dd")!;
      dd.textContent = value;
      if (fieldState === "unavailable") {
        const note = document.createElement("span");
        note.textContent = ` · ${label("viewerTrackUnavailable")}`;
        dd.append(note);
      }
    }
    element<HTMLButtonElement>("viewer-preferences-apply").disabled = !hasHistory() || !state?.available || ![availability?.audio, availability?.subtitles].includes("available");
    element<HTMLButtonElement>("viewer-preferences-undo").disabled = !hasHistory() || !state?.canUndoPreferences;
    const messages: Partial<Record<NonNullable<typeof state>["status"], TextKey>> = {
      seeking: "viewerSeeking", playing: "viewerHighlightPlaying", complete: "viewerHighlightComplete", cancelled: "viewerCancelled",
      error: "viewerActionError", "preferences-restored": "viewerPreferencesRestored", "preferences-undone": "viewerPreferencesUndone",
    };
    let message = state && messages[state.status];
    if (state?.status === "playing") message = context.playback?.player.isPaused() ? "paused" : state.mode === "highlights" ? "viewerHighlightPlaying" : "playing";
    const preferenceNotice = state?.status === "preferences-restored" || state?.status === "preferences-undone";
    const recapNotice = state?.status === "complete" || state?.status === "cancelled";
    if ((preferenceNotice && selectedTab !== "preferences") || (recapNotice && selectedTab !== "highlights")) message = undefined;
    element("viewer-action-status").textContent = message ? label(message) : "";
  }

  function languageName(language: string | null | undefined): string {
    if (!language) return label("viewerNotRecorded");
    try { return new Intl.DisplayNames([context.locale], { type: "language" }).of(language) ?? language; }
    catch { return language; }
  }

  function renderDetails(): void {
    if (!details.open) return;
    element("viewer-data-json").textContent = JSON.stringify({
      synthetic: true,
      catalog: available ? VIEWER_CATALOG : null,
      savedHistory: hasHistory() ? selectedExample().input : null,
      derivedHistory: history,
      chapterProgress: history ? chapterProgress(history, VIEWER_CATALOG) : null,
      highlights: available ? { budgetMs: Number(budget.value), viewingData: context.snapshot, ...queue } : null,
    }, null, 2);
  }

  function renderContent(): void {
    const { locale } = context;
    root.setAttribute("aria-label", label("viewerTools"));
    root.querySelector('[role="tablist"]')!.setAttribute("aria-label", label("viewerTools"));
    root.dataset.available = String(available);
    const availability = element("viewer-availability");
    availability.hidden = available;
    availability.textContent = label("viewerUnavailable");
    budget.disabled = !available;
    for (const option of budget.options) option.textContent = `${Number(option.value) / 1000}${label("viewerSeconds")}`;
    const list = element("viewer-highlight-list");
    list.replaceChildren();
    for (const section of queue.items) {
      const row = document.createElement("li");
      row.dataset.clipId = section.id;
      row.dataset.startMs = String(section.startMs);
      row.dataset.endMs = String(section.endMs);
      const title = document.createElement("span");
      title.className = "viewer-section-title";
      title.textContent = section.title[locale];
      const range = document.createElement("span");
      range.className = "viewer-section-time";
      range.textContent = `${timeLabel(section.startMs)}–${timeLabel(section.endMs)}`;
      row.append(title, range);
      list.append(row);
    }
    element("viewer-highlight-total").textContent = queue.items.length ? `${label("viewerTotal")} ${queue.totalMs / 1000}${label("viewerSeconds")}` : "";
    element("viewer-highlight-empty").hidden = queue.items.length > 0 || !available;
    element("viewer-highlight-empty").textContent = queue.status === "empty" ? label("viewerNoHighlights") : label("unobserved");
    example.replaceChildren(new Option(label("viewerChooseExample"), ""));
    example.options[0].disabled = true;
    for (const item of VIEWER_HISTORY_EXAMPLES) example.add(new Option(item.title[locale], item.id));
    example.value = cleared ? "" : exampleId;
    example.disabled = !available;
    consent.disabled = !available;
    element<HTMLButtonElement>("viewer-history-clear").disabled = !available || cleared;
    const historyKey: TextKey = !available ? "viewerHistoryUnavailable" : !consent.checked ? "viewerHistoryDisabled" : cleared ? "viewerHistoryCleared" :
      history?.status === "partial" ? "viewerHistoryPartial" : history?.status === "completed" ? "viewerHistoryCompleted" : history?.status === "empty" ? "viewerHistoryEmpty" :
      history?.status === "unavailable" ? "viewerHistoryUnavailable" : "viewerHistorySaved";
    element("viewer-history-state").textContent = label(historyKey);
    const chapters = element("viewer-chapters");
    const focusedChapterId = chapters.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.chapterId : undefined;
    chapters.replaceChildren();
    const progress = !available ? [] : history ? chapterProgress(history, VIEWER_CATALOG) : VIEWER_CATALOG.chapters.map(section => ({ section, status: "unknown" as const }));
    const statusKeys = { watched: "viewerChapterWatched", partial: "viewerChapterPartial", unwatched: "viewerChapterUnwatched", unknown: "viewerChapterUnknown" } as const;
    for (const item of progress) {
      const row = document.createElement("li");
      row.dataset.status = item.status;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.chapterId = item.section.id;
      button.disabled = !hasHistory();
      const title = document.createElement("span");
      title.className = "viewer-section-title";
      title.textContent = item.section.title[locale];
      const range = document.createElement("span");
      range.className = "viewer-section-time";
      range.textContent = timeLabel(item.section.startMs);
      button.append(title, range);
      button.addEventListener("click", () => { if (hasHistory()) void context.playback?.viewer.playFrom(item.section.startMs); });
      const status = document.createElement("span");
      status.className = "viewer-chapter-status";
      status.textContent = label(statusKeys[item.status]);
      row.append(button, status);
      chapters.append(row);
    }
    renderActions();
    if (focusedChapterId) {
      const target = [...chapters.querySelectorAll<HTMLButtonElement>("button")].find(button => button.dataset.chapterId === focusedChapterId);
      if (target && !target.disabled) target.focus({ preventScroll: true });
    }
    renderMarkers();
    renderDetails();
  }

  function render(next: Context): void {
    const previous = context;
    context = next;
    if (previous.playback !== next.playback) {
      unsubscribe?.();
      unsubscribe = next.playback?.viewer.subscribe(renderActions);
    }
    available = next.demoSource && sameContent(next.content, VIEWER_CATALOG.content) && !!next.playback?.canSeek && (!next.snapshot || sameContent(next.snapshot.content, VIEWER_CATALOG.content));
    next.playback?.viewer.setEnabled(available);
    if (previous.snapshot !== next.snapshot && next.playback?.viewer.state.mode === "highlights") next.playback.viewer.stopHighlights();
    queue = selectHighlights(available ? next.snapshot : null, VIEWER_CATALOG, Number(budget.value));
    history = hasHistory() ? deriveViewerHistory(selectedExample().input) : null;
    next.playback?.viewer.offerPreferences(history?.preferences ?? null);
    renderContent();
  }

  function historyChanged(): void {
    context.playback?.viewer.reset();
    render(context);
  }

  for (const tab of tabs) {
    const button = element(`viewer-tab-${tab}`);
    button.addEventListener("click", () => selectTab(tab));
    button.addEventListener("keydown", event => {
      const current = tabs.indexOf(selectedTab);
      const next = event.key === "ArrowRight" ? tabs[(current + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(current + tabs.length - 1) % tabs.length] : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : undefined;
      if (next) { event.preventDefault(); selectTab(next, true); }
    });
  }
  budget.addEventListener("change", () => { context.playback?.viewer.stopHighlights(); render(context); });
  example.addEventListener("change", () => { if (VIEWER_HISTORY_EXAMPLES.some(item => item.id === example.value)) { exampleId = example.value; cleared = false; historyChanged(); } });
  consent.addEventListener("change", historyChanged);
  element("viewer-history-clear").addEventListener("click", () => { cleared = true; historyChanged(); });
  element("viewer-highlight-start").addEventListener("click", () => { if (available && queue.status === "ready") void context.playback?.viewer.startHighlights(queue.items); });
  element("viewer-highlight-return").addEventListener("click", () => context.playback?.viewer.stopHighlights());
  element("viewer-history-resume").addEventListener("click", () => { if (canResume()) void context.playback?.viewer.playFrom(history!.resumeMs!); });
  element("viewer-history-unwatched").addEventListener("click", () => { const target = nextUnwatched(); if (target !== undefined) void context.playback?.viewer.playFrom(target); });
  element("viewer-preferences-apply").addEventListener("click", () => { if (hasHistory() && history) context.playback?.viewer.restorePreferences(history.preferences); });
  element("viewer-preferences-undo").addEventListener("click", () => { if (hasHistory()) context.playback?.viewer.undoPreferences(); });
  details.addEventListener("toggle", renderDetails);
  return { render };
}
