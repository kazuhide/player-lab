/**
 * A tiny binder for DOM text that should follow the language toggle WITHOUT re-mounting its
 * panel — so panels with live state (the control panel's event log + telemetry) can keep that
 * state while their labels switch language.
 *
 * The owner creates one `LangBinder` per mount, builds its labels through it (string = static,
 * `L` = bilingual + recorded), and calls `relocalize()` whenever the language changes. A fresh
 * binder per mount means stale nodes from a previous mount are simply dropped — no leak.
 */
import { pick, type L } from "./i18n";

export class LangBinder {
  // Single-use per mount: build all labels through one binder, then the owner discards it
  // (creates a fresh one) on the next mount. Don't keep calling text()/span() on a binder
  // after the owner has replaced it — those closures would target detached DOM.
  private readonly bound: (() => void)[] = [];

  private add(apply: () => void): void {
    apply();
    this.bound.push(apply);
  }

  /** Set an element's textContent. A plain string is static; an `L` follows the language. */
  text(el: HTMLElement, text: string | L): void {
    if (typeof text === "string") {
      el.textContent = text;
      return;
    }
    this.add(() => (el.textContent = pick(text)));
  }

  /** A `<span>` whose text follows the language (or is static for a plain string). */
  span(text: string | L, className?: string): HTMLSpanElement {
    const el = document.createElement("span");
    if (className) el.className = className;
    this.text(el, text);
    return el;
  }

  /** Re-apply the current language to every bound node. Call on language change. */
  relocalize(): void {
    for (const apply of this.bound) apply();
  }
}
