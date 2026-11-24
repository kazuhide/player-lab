// The fixture uses one zero-based DASH period. A video segment's encoded time
// maps onto the publisher's UTC timeline only after the loaded MPD agrees.
export class DashClock {
  constructor(originMs) {
    this.originMs = originMs;
    this.representations = new Set();
    this.offset = null;
  }
  readManifest(body) {
    this.representations.clear();
    if (typeof body === 'string' && body.length < 2_000_000 && Number.isSafeInteger(this.originMs)) {
      const mpd = new DOMParser().parseFromString(body, 'application/xml').documentElement;
      const periods = mpd.getElementsByTagNameNS(mpd.namespaceURI, 'Period');
      if (
        mpd.localName === 'MPD' &&
        mpd.namespaceURI === 'urn:mpeg:dash:schema:mpd:2011' &&
        Date.parse(mpd.getAttribute('availabilityStartTime')) === this.originMs &&
        periods.length === 1 &&
        /^PT0(?:\.0+)?S$/.test(periods[0].getAttribute('start'))
      ) {
        for (const rep of periods[0].getElementsByTagNameNS(mpd.namespaceURI, 'Representation')) {
          const template = [...rep.children].find((c) => c.localName === 'SegmentTemplate');
          if (
            rep.getAttribute('mimeType')?.startsWith('video/') &&
            template &&
            Number(template.getAttribute('presentationTimeOffset') ?? 0) === 0 &&
            ![...rep.parentElement.children, ...periods[0].children].some(
              (c) => c.localName === 'SegmentTemplate'
            )
          )
            this.representations.add(rep.getAttribute('id'));
        }
      }
    }
    if (!this.representations.has(this.representationId)) this.offset = null;
  }
  observe(segment) {
    if (!segment.mimeType?.startsWith('video/')) return;
    this.representationId = segment.representationId;
    this.offset =
      this.representations.has(this.representationId) &&
      Number.isFinite(segment.playbackTime) &&
      Number.isFinite(segment.presentationTimestamp) &&
      segment.presentationTimestamp >= 0
        ? this.originMs / 1000 + segment.presentationTimestamp - segment.playbackTime
        : null;
  }
  utc(seconds) {
    return this.offset !== null && Number.isFinite(seconds) ? seconds + this.offset : null;
  }
}
