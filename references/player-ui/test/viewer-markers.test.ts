import assert from "node:assert/strict";
import test from "node:test";
import type { TimelineMarker, TimelineMarkersApi } from "bitmovin-player-ui";
import { createViewerMarkers } from "../src/viewer-markers.ts";

function markerApi() {
  const stock: TimelineMarker = { time: 3, title: "Source chapter" };
  let markers = [stock];
  let changes = 0;
  const api: TimelineMarkersApi = {
    add(marker) { markers.push(marker); changes++; },
    remove(marker) { const exists = markers.includes(marker); markers = markers.filter(value => value !== marker); changes++; return exists; },
    list() { return markers.slice(); },
  };
  return { api, stock, get changes() { return changes; }, clearSource() { markers = []; } };
}

test("viewer markers use official seconds and preserve source-owned markers", () => {
  const source = markerApi();
  const viewer = createViewerMarkers(source.api);
  viewer.set([{ id: "forest", startMs: 12_000, endMs: 20_000, title: "Forest" }]);
  assert.equal(source.api.list()[0], source.stock);
  assert.equal(source.api.list()[1].time, 12);
  assert.equal(source.api.list()[1].duration, 8);
  viewer.set([]);
  assert.deepEqual(source.api.list(), [source.stock]);
});

test("equal marker updates do not churn UI events and source reload restores cleared markers", () => {
  const source = markerApi();
  const viewer = createViewerMarkers(source.api);
  const markers = [{ id: "forest", startMs: 12_000, endMs: 20_000, title: "Forest" }];
  viewer.set(markers);
  const before = source.changes;
  viewer.set(structuredClone(markers));
  assert.equal(source.changes, before);
  source.clearSource();
  viewer.set(markers);
  assert.equal(source.api.list().length, 1);
  assert.equal(source.api.list()[0].time, 12);
});

test("marker validation is atomic and rejects duplicate IDs or invalid ranges", () => {
  const source = markerApi();
  const viewer = createViewerMarkers(source.api);
  const marker = { id: "forest", startMs: 12_000, endMs: 20_000, title: "Forest" };
  viewer.set([marker]);
  const before = source.api.list();
  for (const invalid of [[marker, marker], [{ ...marker, endMs: 0 }], [{ ...marker, startMs: NaN }], [{ ...marker, id: "bad id" }]]) {
    assert.throws(() => viewer.set(invalid));
    assert.deepEqual(source.api.list(), before);
  }
});

test("marker titles remain plain text when the official label interprets HTML", () => {
  const source = markerApi();
  const viewer = createViewerMarkers(source.api);
  viewer.set([{ id: "text", startMs: 0, endMs: 1_000, title: '<img src=x onerror="alert(1)"> & text' }]);
  assert.equal(source.api.list()[1].title, "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; text");
});
