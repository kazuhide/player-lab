import { describe, expect, it, vi } from "vitest";
vi.mock("bitmovin-player-react-native", () => ({
  CustomUi: class {}, Source: class {},
  CustomMessageHandler: class {
    constructor(private readonly options: { onReceivedSynchronousMessage: (message: string, data: string | undefined) => string | undefined }) {}
    receivedSynchronousMessage(message: string, data: string | undefined) { return this.options.onReceivedSynchronousMessage(message, data); }
    receivedAsynchronousMessage() {}
    sendMessage() {}
  },
}));
import { NativeScriptOwner, validateNativeScripts } from "../src/nativeScripts";

describe("approved native JavaScript callbacks", () => {
  const id = "PlayerConfig.networkConfig.preprocessHttpRequest";
  it("does not run body text while validating, requires approval and accepts async syntax", () => {
    const body = "throw new Error('must not run during validation');";
    expect(() => validateNativeScripts({ allowed: false, bodies: { [id]: body } })).toThrow("Enable execution");
    expect(() => validateNativeScripts({ allowed: true, bodies: { [id]: body } })).not.toThrow();
    expect(() => validateNativeScripts({ allowed: true, bodies: { [id]: "await Promise.resolve(); return request;" } })).not.toThrow();
    expect(() => validateNativeScripts({ allowed: true, bodies: { [id]: "return {" } })).toThrow(SyntaxError);
  });
  it("checks returns and suppresses a pending result after the exact Player owner retires", async () => {
    const owner = new NativeScriptOwner(vi.fn(), vi.fn());
    const callback = owner.asynchronous(id, "await Promise.resolve(); return 7;", (value): value is number => typeof value === "number");
    const pending = callback(); owner.retire();
    await expect(pending).rejects.toThrow("retired");
    const second = new NativeScriptOwner(vi.fn(), vi.fn());
    const wrong = second.validated("SourceConfig.drmConfig.widevine.prepareMessage", "return 7;", (value): value is string => typeof value === "string");
    expect(() => wrong("message")).toThrow("SDK contract");
  });
  it("keeps fullscreen effects on the current owner and bounds callback invocation logs", () => {
    const record = vi.fn(); const change = vi.fn(); const owner = new NativeScriptOwner(record, change);
    const handler = owner.defaultFullscreen(); handler.enterFullscreen();
    expect(handler.isFullscreenActive).toBe(true); expect(change).toHaveBeenLastCalledWith(true);
    const callback = owner.validated("SourceConfig.drmConfig.widevine.prepareMessage", "return message;", (value): value is string => typeof value === "string");
    for (let i = 0; i < 250; i++) callback("not logged");
    expect(record).toHaveBeenCalledTimes(22);
    expect(JSON.stringify(record.mock.calls)).not.toContain("not logged");
    owner.retire(); expect(() => handler.exitFullscreen()).toThrow("retired");
    expect(() => callback("old")).toThrow("retired");
  });
});
