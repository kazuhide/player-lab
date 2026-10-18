/**
 * A reusable "?" info chip with a single, shared, styled overlay (not the native `title`
 * tooltip). Every settings item across the app uses `infoChip(text)`; one `installInfoOverlay()`
 * wires a body-appended, fixed-position overlay via event delegation, so hovering or focusing
 * any chip shows the same styled popover with "when / how to set it" guidance.
 *
 * Bilingual: a chip can carry an `L` ({ ja, en }); the overlay (and the chip's aria-label)
 * resolve the current language at show time, and `installInfoOverlay` re-labels every chip when
 * the language toggles — so chips follow the language without their host panels re-mounting.
 *
 * Why a single body overlay (not per-chip CSS popups): the config panel scrolls and nests its
 * fields inside `<details>` accordions, so a CSS popup would be clipped by ancestor overflow.
 * A `position: fixed` overlay on `document.body` escapes all clipping and is clamped to the
 * viewport. One element + delegation also scales cleanly to the ~150 fields.
 */
import { getLang, onLangChange, pick, type L } from "./i18n";

let overlay: HTMLElement | undefined;
let activeChip: HTMLElement | undefined; // the chip whose overlay is currently shown

function ensureOverlay(): HTMLElement {
  if (overlay) return overlay;
  const el = document.createElement("div");
  el.className = "info-overlay";
  el.setAttribute("role", "tooltip");
  el.hidden = true;
  document.body.appendChild(el);
  overlay = el;
  return el;
}

/** The chip's guidance in the current language (data-info-ja / -en; falls back across them). */
function chipText(chip: HTMLElement): string {
  const ja = chip.dataset.infoJa;
  const en = chip.dataset.infoEn;
  return (getLang() === "ja" ? ja : en) ?? en ?? ja ?? "";
}

/** Position the overlay near `chip`, clamped inside the viewport (prefers below, flips above). */
function place(o: HTMLElement, chip: HTMLElement): void {
  const margin = 8;
  const r = chip.getBoundingClientRect();
  const ow = o.offsetWidth;
  const oh = o.offsetHeight;
  // Horizontal: align the overlay's left near the chip, clamp to [margin, vw - ow - margin].
  let left = r.left;
  left = Math.max(margin, Math.min(left, window.innerWidth - ow - margin));
  // Vertical: below the chip if it fits, else above.
  let top = r.bottom + 6;
  if (top + oh > window.innerHeight - margin) top = Math.max(margin, r.top - oh - 6);
  o.style.left = `${Math.round(left)}px`;
  o.style.top = `${Math.round(top)}px`;
}

function show(chip: HTMLElement): void {
  const text = chipText(chip);
  if (!text) return;
  const o = ensureOverlay();
  o.textContent = text;
  o.hidden = false;
  activeChip = chip;
  // Reveal first so the overlay has real dimensions, then position it.
  place(o, chip);
}

function hide(): void {
  if (overlay) overlay.hidden = true;
  activeChip = undefined;
}

function chipFrom(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? (target.closest(".info-chip") as HTMLElement | null) : null;
}

/** Install the global overlay + delegation. Call once at startup. */
export function installInfoOverlay(): void {
  document.addEventListener("mouseover", (e) => {
    const chip = chipFrom(e.target);
    if (chip) show(chip);
  });
  document.addEventListener("mouseout", (e) => {
    const chip = chipFrom(e.target);
    // Only hide when the pointer actually leaves the chip (not when moving between its own
    // nodes), so the overlay can't flicker if the chip ever gains child markup.
    if (chip && !chip.contains((e as MouseEvent).relatedTarget as Node | null)) hide();
  });
  document.addEventListener("focusin", (e) => {
    const chip = chipFrom(e.target);
    if (chip) show(chip);
  });
  document.addEventListener("focusout", (e) => {
    if (chipFrom(e.target)) hide();
  });
  // Dismiss on Escape so a focused-chip popover can be cleared from the keyboard.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  // On a language switch, re-label every chip (for AT) and refresh a visible overlay, so chips
  // follow the language even when their host panel (e.g. the control panel) doesn't re-mount.
  onLangChange(() => {
    for (const chip of document.querySelectorAll<HTMLElement>(".info-chip")) {
      chip.setAttribute("aria-label", chipText(chip));
    }
    if (activeChip && overlay && !overlay.hidden) {
      overlay.textContent = chipText(activeChip);
      place(overlay, activeChip);
    }
  });
}

/** A focusable "?" chip carrying its guidance (a plain string, or an `L` for JA/EN). The
 *  overlay + aria-label resolve the current language at show time. */
export function infoChip(info: string | L): HTMLElement {
  const ja = typeof info === "string" ? info : info.ja;
  const en = typeof info === "string" ? info : info.en;
  const chip = document.createElement("span");
  chip.className = "info-chip";
  chip.textContent = "?";
  chip.tabIndex = 0;
  chip.setAttribute("role", "note");
  chip.dataset.infoJa = ja;
  chip.dataset.infoEn = en;
  chip.setAttribute("aria-label", pick({ ja, en }));
  // The chip often sits inside a <label>; don't let clicking it toggle the control.
  chip.addEventListener("click", (e) => e.preventDefault());
  return chip;
}
