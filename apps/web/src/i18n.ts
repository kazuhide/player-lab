/**
 * Tiny i18n: a current language (default Japanese), a `{ ja, en }` string picker, and a
 * change subscription so the app can re-render its prose when the language toggles.
 *
 * Scope: this translates UI *prose* (taglines, intros, blurbs, explanations). Technical
 * labels that are API identifiers or section names (autoplay, max_buffer_level, "Source",
 * "Seek", code snippets) stay as-is in both languages — that's the conventional bilingual
 * pattern and keeps the field names matching the SDK.
 */
export type Lang = "ja" | "en";

/** A translatable string with both languages. */
export interface L {
  ja: string;
  en: string;
}

const STORAGE_KEY = "bpp-lang";

/** Read the persisted language (so the choice carries across pages), defaulting to ja. */
function initialLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "ja";
  } catch {
    return "ja";
  }
}

let lang: Lang = initialLang();
const subscribers = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage unavailable (private mode) — language just won't persist across pages */
  }
  for (const cb of subscribers) cb();
}

/** Register a callback fired whenever the language changes (for re-rendering prose). */
export function onLangChange(cb: () => void): void {
  subscribers.add(cb);
}

/** Pick the current language's text from a `{ ja, en }` pair. */
export function pick(s: L): string {
  return s[lang];
}

/** Global chrome strings shared across modules. Per-module prose lives inline as `L`
 *  literals in each module (theme notes, guide levers, config blurbs…). */
export const G = {
  tagline: { ja: "ソースを切り替え、UI を差し替え、再生をその場で調整。", en: "Switch sources, swap the UI, and tune playback on the fly." },
  themeBarLabel: { ja: "UI テーマ", en: "UI theme" },
  langLabel: { ja: "言語", en: "Language" },
  sideQoe: { ja: "QoE メトリクス (§15)", en: "QoE metrics (§15)" },
  // Landmark aria-labels (kept consistent with the visible language).
  ariaConstruction: { ja: "UI 構築の解説", en: "How this UI is built" },
  ariaControl: { ja: "操作パネル", en: "Control panel" },
  ariaConfig: { ja: "Player 設定", en: "Player Config" },
} satisfies Record<string, L>;
