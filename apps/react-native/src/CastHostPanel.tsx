import React, { useEffect, useRef, useState } from "react";
import { NativeModules, View } from "react-native";
import { Button, Text } from "./localization";
import type { SettingValues } from "./nativeSettings";
import { panelStyles as styles } from "./panelStyles";

interface CastHost {
  readOptions(): Promise<unknown>;
  saveOptions(applicationId: string, namespace: string): Promise<unknown>;
}

function host(): CastHost | undefined {
  const module: unknown = NativeModules.PlayerLabCastHost;
  if (!module || typeof module !== "object") return;
  const read: unknown = Reflect.get(module, "readOptions");
  const save: unknown = Reflect.get(module, "saveOptions");
  if (typeof read !== "function" || typeof save !== "function") return;
  return {
    readOptions: () => Promise.resolve(Reflect.apply(read, module, [])),
    saveOptions: (id, namespace) => Promise.resolve(Reflect.apply(save, module, [id, namespace])),
  };
}

function summary(value: unknown): string {
  if (!value || typeof value !== "object") throw new Error("The native Cast host returned an invalid state.");
  if (typeof Reflect.get(value, "nativeInitialized") !== "boolean" || typeof Reflect.get(value, "pendingRestart") !== "boolean") {
    throw new Error("The native Cast host returned an invalid startup state.");
  }
  const fields = ["savedOptions", "startupOptions", "nativeInitialized", "pendingRestart", "startupEvidence"];
  return JSON.stringify(Object.fromEntries(fields.map(name => [name, Reflect.get(value, name)])), null, 2);
}

/** Startup configuration persists independently from recreation of a Player instance. */
export function CastHostPanel({ values }: { values: SettingValues }): React.JSX.Element {
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const current = useRef(true);
  const pending = useRef(false);
  const native = host();
  useEffect(() => {
    current.current = true;
    const native = host();
    if (native) void native.readOptions().then(value => { if (current.current) setResult(summary(value)); })
      .catch(() => { if (current.current) setError("The native Cast startup settings could not be read."); });
    return () => { current.current = false; };
  }, []);
  const run = async (save: boolean) => {
    const native = host();
    if (!native || pending.current) return;
    pending.current = true;
    setBusy(true); setError("");
    try {
      const value = save ? await native.saveOptions(values["BitmovinCastManagerOptions.applicationId"] ?? "",
        values["BitmovinCastManagerOptions.messageNamespace"] ?? "") : await native.readOptions();
      if (current.current) setResult(summary(value));
    } catch (error) { if (current.current) setError(error instanceof Error ? error.message : "The Cast startup settings could not be saved."); }
    finally { pending.current = false; if (current.current) setBusy(false); }
  };
  return <View style={styles.content}>
    <Text style={styles.badge}>Next launch</Text>
    <Text style={styles.help}>Edit receiver options in SDK overrides. Save Cast options for next launch, then fully close and reopen the app.</Text>
    {!native && <Text style={styles.help}>This host does not include the Cast startup adapter. Regenerate the Expo project and build the native app.</Text>}
    <Button title="Save Cast options for next launch" disabled={!native || busy} onPress={() => { void run(true); }} />
    <Button title="Read native Cast startup state" disabled={!native || busy} onPress={() => { void run(false); }} />
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Text style={styles.label}>Native startup state</Text>
    <Text verbatim selectable accessibilityLabel="Native Cast startup state" accessibilityValue={{ text: result }} style={styles.mono}>{result}</Text>
  </View>;
}
