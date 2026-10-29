export class LatestRequest {
  #sequence = 0;
  #controller = null;
  cancel() { this.#sequence += 1; this.#controller?.abort(); this.#controller = null; }
  async run(task, accept, reject) {
    this.cancel();
    const sequence = this.#sequence;
    const controller = new AbortController();
    this.#controller = controller;
    try {
      const value = await task(AbortSignal.any([controller.signal, AbortSignal.timeout(55_000)]));
      if (sequence === this.#sequence) accept(value);
    } catch (error) {
      if (sequence === this.#sequence && !controller.signal.aborted) reject(error);
    }
  }
}

export function qualityStatus({ state, result, loading = false, cooldownUntil = 0, now }, translate, formatDate) {
  let message = now < cooldownUntil
    ? `${translate("retryLater")}: ${formatDate(new Date(cooldownUntil).toISOString())}`
    : translate(state);
  if (result?.stale || (loading && result?.fetchedAt)) message += ` ${translate("earlierResults")}`;
  return message;
}

export function modeFromHash(hash, currentMode = 'demo') {
  if (hash === '#measured') return 'measured';
  if (hash === '' || hash === '#' || hash === '#demo') return 'demo';
  return currentMode;
}

export function hourlySegments(rows) {
  const segments = [];
  let current = [];
  for (const row of rows) {
    if (row.value === null || (current.length && Date.parse(row.at) - Date.parse(current.at(-1).at) > 3_600_000)) {
      if (current.length) segments.push(current);
      current = [];
    }
    if (row.value !== null) current.push(row);
  }
  if (current.length) segments.push(current);
  return segments;
}
