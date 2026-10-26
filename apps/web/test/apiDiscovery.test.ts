import { expect, it } from "vitest";
import catalog from "../src/api/schema.json";
import { apiFeature, findApiEntries } from "../../../shared/apiDiscovery";

it("ranks full identities, short methods and translated action names ahead of namespace matches", () => {
  const commands = catalog.rows.filter(entry => entry.category === "command");
  for (const query of ["PlayerAPI.play", "play", "ＰｌａｙｅｒＡＰＩ．ｐｌａｙ", "再生"]) {
    expect(findApiEntries(commands, query)[0]?.id).toBe("PlayerAPI.play");
  }
  expect(findApiEntries(commands, "seek")[0]?.id).toBe("PlayerAPI.seek");
  expect(findApiEntries(commands, "音量").some(entry => entry.id === "PlayerAPI.setVolume")).toBe(true);
});

it("matches bilingual feature words, preserves the unfiltered order and returns a true empty result", () => {
  expect(findApiEntries(catalog.rows, "source poster").some(entry => entry.id === "SourceConfig.poster")).toBe(true);
  expect(findApiEntries(catalog.rows, "ライセンス").some(entry => entry.id === "PlayerConfig.key")).toBe(true);
  expect(findApiEntries(catalog.rows, "").map(entry => entry.id)).toEqual(catalog.rows.map(entry => entry.id));
  expect(findApiEntries(catalog.rows, "no-such-operation")).toEqual([]);
  expect(apiFeature("PlayerConfig.analytics.key").en).toBe("Analytics");
});
