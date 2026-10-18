/**
 * Sample data for the Sports overlay theme (a baseball broadcast look). This is CLEARLY
 * FICTIONAL placeholder data — there is no live feed here, and real team/player names carry
 * likeness/trademark concerns. It's deliberately isolated in this module with plain shapes so a
 * real integration just swaps the data source (an API/WebSocket feed) for the same interfaces;
 * the components below render whatever they're given.
 *
 * Stat abbreviations are the universal baseball ones (AVG / HR / ERA, and the B-S-O count), so
 * the overlays read the same in any language and this package stays i18n-free.
 */

/** One out-of-window game's line score, for the "other games" strip. */
export interface GameScore {
  away: string;
  awayScore: number;
  home: string;
  homeScore: number;
  /** Free-form status, e.g. "7th", "Final", "Top 3rd". */
  status: string;
}

/** The current at-bat shown in the player-info card. */
export interface AtBat {
  inning: string;
  batter: string;
  /** Batting average, pre-formatted (e.g. ".312"). */
  avg: string;
  hr: number;
  pitcher: string;
  /** Earned run average, pre-formatted (e.g. "2.45"). */
  era: string;
  balls: number;
  strikes: number;
  outs: number;
}

/** A lineup row for the mini batting order. */
export interface LineupEntry {
  order: number;
  name: string;
  /** Position abbreviation (e.g. "CF", "SS", "DH"). */
  pos: string;
  avg: string;
}

// ── Fictional sample data ───────────────────────────────────────────────────
export const OTHER_GAMES: GameScore[] = [
  { away: "North Hawks", awayScore: 4, home: "Central Lions", homeScore: 2, status: "8th" },
  { away: "Pacific Whales", awayScore: 1, home: "South Dragons", homeScore: 1, status: "Top 6th" },
  { away: "Sky Petrels", awayScore: 7, home: "River Carps", homeScore: 3, status: "Final" },
];

export const CURRENT_ATBAT: AtBat = {
  inning: "Bot 7th",
  batter: "Yamamoto",
  avg: ".312",
  hr: 18,
  pitcher: "Tanaka",
  era: "2.45",
  balls: 2,
  strikes: 1,
  outs: 1,
};

export const HOME_LINEUP: LineupEntry[] = [
  { order: 1, name: "Aoki", pos: "CF", avg: ".301" },
  { order: 2, name: "Sato", pos: "2B", avg: ".288" },
  { order: 3, name: "Yamamoto", pos: "RF", avg: ".312" },
  { order: 4, name: "Mori", pos: "1B", avg: ".276" },
  { order: 5, name: "Okada", pos: "DH", avg: ".265" },
];

// Demonstrates that the home side here is fictional; used as a header in the card.
export const FEATURED_MATCHUP = { home: "East Stars", away: "West Bears" } as const;

// ── Render helpers (pure: data → HTML string) ───────────────────────────────
// The data is static and developer-controlled (no user input), so building markup as a string
// is safe here; `esc` is belt-and-suspenders in case the data later comes from a feed. It escapes
// for element text / quoted-attribute contexts (all interpolations here are text content); it is
// NOT sufficient for unquoted attribute values, so keep interpolations in text content.
function esc(s: string | number): string {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The "other games" strip: one chip per game (away @ home, score, status). */
export function renderScoreboard(games: GameScore[]): string {
  const chips = games
    .map(
      (g) =>
        `<span class="sb-game">` +
        `<span class="sb-team">${esc(g.away)}</span><span class="sb-score">${esc(g.awayScore)}</span>` +
        `<span class="sb-at">@</span>` +
        `<span class="sb-team">${esc(g.home)}</span><span class="sb-score">${esc(g.homeScore)}</span>` +
        `<span class="sb-status">${esc(g.status)}</span>` +
        `</span>`,
    )
    .join("");
  return `<span class="sb-label">Around the league</span>${chips}`;
}

/** The player-info card: current matchup, at-bat + count, and a mini lineup. */
export function renderPlayerInfo(atbat: AtBat, lineup: LineupEntry[], homeName: string): string {
  const lineupRows = lineup
    .map(
      (e) =>
        `<li><span class="pi-ord">${esc(e.order)}</span>` +
        `<span class="pi-name">${esc(e.name)}</span>` +
        `<span class="pi-pos">${esc(e.pos)}</span>` +
        `<span class="pi-avg">${esc(e.avg)}</span></li>`,
    )
    .join("");
  return (
    `<div class="pi-head">${esc(homeName)} · ${esc(atbat.inning)}</div>` +
    `<div class="pi-matchup">` +
    `<div class="pi-row"><span class="pi-role">AB</span><span class="pi-name">${esc(atbat.batter)}</span>` +
    `<span class="pi-stat">${esc(atbat.avg)}</span><span class="pi-stat">${esc(atbat.hr)} HR</span></div>` +
    `<div class="pi-row"><span class="pi-role">P</span><span class="pi-name">${esc(atbat.pitcher)}</span>` +
    `<span class="pi-stat">${esc(atbat.era)} ERA</span></div>` +
    `</div>` +
    `<div class="pi-count"><span>B ${esc(atbat.balls)}</span><span>S ${esc(atbat.strikes)}</span><span>O ${esc(atbat.outs)}</span></div>` +
    `<ol class="pi-lineup">${lineupRows}</ol>`
  );
}
