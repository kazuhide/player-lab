// Use the same local JSON format as the Android and Apple applications.
// Records and matching candidates exist only for the current page lifetime.
export class HandoffLedger {
  constructor() {
    this.entries = [];
    this.sequence = 0;
  }
  begin(eventId, videoId, positionMs, playWhenReady, now = Date.now()) {
    const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(id);
    if (!validId(eventId) || !validId(videoId) || !Number.isSafeInteger(positionMs) || positionMs < 0)
      return null;
    const row = {
      requestId: 'request-' + now + '-' + ++this.sequence,
      requestedAt: new Date(now).toISOString(),
      eventId,
      transition: 'live-to-archive',
      requested: { videoId, positionMs, playWhenReady },
      confirmed: null,
      failure: null,
      receiverQoe: null
    };
    if (this.entries.length === 200) this.entries.shift();
    this.entries.push(row);
    return { row, first: null };
  }
  observe(ticket, videoId, positionMs, playing, paused) {
    if (!ticket) return false;
    const { row } = ticket;
    if (row.confirmed || row.failure) return Boolean(row.confirmed);
    const requested = row.requested;
    if (videoId !== requested.videoId || !Number.isSafeInteger(positionMs) || positionMs < 0) return false;
    const matches = Math.abs(positionMs - requested.positionMs) <= 1000;
    if (!requested.playWhenReady) {
      if (!matches || !paused || playing) return false;
      row.confirmed = { videoId, positionMs, playWhenReady: false, positionAdvanced: false };
    } else {
      if (!playing || paused) return false;
      if (ticket.first === null && matches) ticket.first = positionMs;
      else if (ticket.first !== null && positionMs > ticket.first) {
        row.confirmed = { videoId, positionMs: ticket.first, playWhenReady: true, positionAdvanced: true };
      }
    }
    return Boolean(row.confirmed);
  }
  fail(ticket, reason) {
    if (ticket && !ticket.row.confirmed && !ticket.row.failure) ticket.row.failure = reason;
  }
  snapshot(now = Date.now()) {
    const end = new Date(
      Math.max(now, ...this.entries.map((r) => Date.parse(r.requestedAt)))
    ).toISOString();
    const start = this.entries.reduce((first, r) => (r.requestedAt < first ? r.requestedAt : first), end);
    return {
      schemaVersion: 1,
      source: 'local-device-records',
      period: { start, end },
      records: this.entries
    };
  }
}
