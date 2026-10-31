import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ values: new Map<string, string>(), get: vi.fn(), set: vi.fn(), fail: false }));
vi.mock("@amazon-devices/react-native-kepler", () => ({ AsyncStorage: {
  getItem: async (key: string) => { native.get(key); return native.values.get(key) ?? null; },
  setItem: async (key: string, value: string) => { native.set(key, value); if (native.fail) throw new Error("private storage failure"); native.values.set(key, value); },
} }));
import { createProfileIO, PROFILE_STORAGE_KEY } from "../src/profileStorage";
import { ProfileRepository } from "../src/configurationProfiles";
beforeEach(() => { native.values.clear(); native.get.mockClear(); native.set.mockClear(); native.fail = false; });
it("uses only the owned Kepler key, persists across adapters and acknowledges write failures", async () => {
  native.values.set("unrelated", "private-existing");
  const store = new ProfileRepository(createProfileIO(), "vega");
  expect(await store.list()).toEqual([]);
  const raw = '{"schemaVersion":1,"platform":"vega","profiles":[]}';
  await createProfileIO().write(raw);
  expect(await createProfileIO().read()).toBe(raw);
  native.fail = true;
  await expect(createProfileIO().write(raw)).rejects.toThrow();
  expect(native.values.get(PROFILE_STORAGE_KEY)).toBe(raw);
  expect(native.values.get("unrelated")).toBe("private-existing");
  expect(native.get.mock.calls.every(([key]) => key === PROFILE_STORAGE_KEY)).toBe(true);
  expect(native.set.mock.calls.every(([key]) => key === PROFILE_STORAGE_KEY)).toBe(true);
});
