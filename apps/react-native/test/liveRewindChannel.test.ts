import { describe, expect, it, vi } from "vitest";
import { CustomMessageHandler } from "bitmovin-player-react-native";
import { LiveRewindChannel } from "../src/liveRewindChannel";

vi.mock("bitmovin-player-react-native", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { createRequire } = await import("node:module");
  const vm = await import("node:vm");
  const { default: ts } = await import("typescript");
  const root = path.dirname(createRequire(import.meta.url).resolve("bitmovin-player-react-native/package.json"));
  if (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version !== "1.29.0") throw new Error("Rebind the pinned SDK channel test.");
  const file = path.join(root, "src/ui/custommessagehandler.ts");
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} as { CustomMessageHandler?: unknown } };
  vm.runInThisContext("(function(module,exports){" + compiled + "})", { filename: file })(module, module.exports);
  return module.exports;
});

describe("live rewind on the installed SDK's public message handler", () => {
  it("replays the current preference after the UI installs its listener and fences retired owners", () => {
    const channel = new LiveRewindChannel();
    const detach = channel.attach();
    channel.setEnabled(false); // The native bridge has not attached a sender yet.
    const sendMessage = vi.fn();
    channel.handler.customMessageSender = { sendMessage };
    channel.handler.receivedAsynchronousMessage("playerlab-live-rewind-ready", undefined);
    expect(sendMessage).toHaveBeenLastCalledWith("playerlab-live-rewind-enabled", "false");
    channel.setEnabled(true);
    expect(sendMessage).toHaveBeenLastCalledWith("playerlab-live-rewind-enabled", "true");
    detach(); sendMessage.mockClear();
    channel.setEnabled(false);
    channel.handler.receivedAsynchronousMessage("playerlab-live-rewind-ready", undefined);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("multiplexes existing synchronous, asynchronous and outgoing demonstration messages", () => {
    const synchronous = vi.fn((_name: string, data: string | undefined) => data);
    const asynchronous = vi.fn();
    const delegate = new CustomMessageHandler({ onReceivedSynchronousMessage: synchronous, onReceivedAsynchronousMessage: asynchronous });
    const previous = delegate.sendMessage;
    const channel = new LiveRewindChannel(delegate);
    const detach = channel.attach();
    const sendMessage = vi.fn();
    channel.handler.customMessageSender = { sendMessage };
    expect(channel.handler.receivedSynchronousMessage("example", "response")).toBe("response");
    channel.handler.receivedAsynchronousMessage("example", "event");
    delegate.sendMessage("example", "outgoing");
    expect(synchronous).toHaveBeenCalledWith("example", "response");
    expect(asynchronous).toHaveBeenCalledWith("example", "event");
    expect(sendMessage).toHaveBeenCalledWith("example", "outgoing");
    detach();
    expect(delegate.sendMessage).toBe(previous);
    expect(channel.handler.receivedSynchronousMessage("example", "retired")).toBeUndefined();
  });
});
