import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Button: "Button", Pressable: "Pressable", Switch: "Switch", Text: "Text", TextInput: "TextInput", View: "View",
  NativeModules: {},
  StyleSheet: { create: (styles: unknown) => styles },
}));

import { languageFromLocale, LocaleProvider, translateCopy, useLocale } from "../src/localization";
import { ConfigurationCodeView } from "../src/ConfigurationCodeView";
import { Action, InputEditor } from "../src/api/InputEditor";
import { catalog } from "../src/api/catalog";
import { ApiMaterializer, ResourcePool } from "../src/api/materialize";
import { configurationOverrides, overrideCode } from "../src/api/configInputs";

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : entry.name.endsWith(".tsx") && !entry.name.startsWith("RuntimeCheck")
      && entry.name !== "localization.tsx" ? [file] : [];
  });
}

describe("application language", () => {
  it("does not activate a disabled focused SDK action when native Select reaches its callback", () => {
    const onPress = vi.fn();
    const title = "PlayerConfig.network.preprocessHttpRequest";
    const render = (disabled: boolean) => React.createElement(LocaleProvider, { initialLanguage: "ja",
      children: React.createElement(Action, { title, verbatim: true, disabled, onPress }) });
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(render(true)); });
    const action = () => tree.root.find(node => typeof node.type === "string" && String(node.type) === "Pressable");
    act(() => action().props.onFocus());
    act(() => action().props.onPress());
    expect(onPress).not.toHaveBeenCalled();
    expect(action().props.accessibilityLabel).toBe(title);
    expect(action().props.accessibilityRole).toBe("button");
    act(() => tree.update(render(false)));
    act(() => action().props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("recognizes Japanese regional locales and falls back to English for other or invalid locales", () => {
    for (const locale of ["ja", "ja-JP", "ja_JP", "JA-jp"]) expect(languageFromLocale(locale)).toBe("ja");
    for (const locale of ["en", "en-US", "fr-FR", "java", null, undefined, 7]) expect(languageFromLocale(locale)).toBe("en");
  });

  it("translates application labels without changing SDK names, code, URLs or user values", () => {
    expect(translateCopy("Show configuration", "ja")).toBe("設定を表示");
    expect(translateCopy("Show configuration", "en")).toBe("Show configuration");
    for (const value of ["PlayerConfig.playbackConfig.isAutoplayEnabled", "Player.play", "return request;", "https://example.com/a.m3u8", "A user's title"])
      expect(translateCopy(value, "ja")).toBe(value);
  });

  it("does not use inherited prototype properties as translation strings", () => {
    for (const value of ["toString", "constructor", "prototype", "__proto__", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", " toString "])
      expect(translateCopy(value, "ja")).toBe(value);
  });

  it("keeps edited metadata keys identical in Japanese headings, actions, SDK input and exported code", () => {
    const schema = catalog.rows.find(entry => entry.id === "SourceConfig.metadata")!.schema!;
    const resources = new ResourcePool({});
    let current: unknown = {};
    let changeLanguage!: (language: "en" | "ja") => void;
    function Editor(): React.JSX.Element {
      const [value, setValue] = React.useState<unknown>({});
      current = value;
      changeLanguage = useLocale().setLanguage;
      return React.createElement(InputEditor, { catalog, schema, value, resources, onChange: setValue });
    }
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(React.createElement(LocaleProvider, { initialLanguage: "ja", children: React.createElement(Editor) })); });
    const host = (type: string, label: string) => tree.root.find(node =>
      typeof node.type === "string" && node.type === type && node.props.accessibilityLabel === label);
    const textValues = () => tree.root.findAll(node => typeof node.type === "string" && String(node.type) === "Text")
      .map(node => node.children.filter(child => typeof child === "string").join(""));
    const expected: Record<string, string> = {};
    for (const name of ["Language", "toString", "valueOf", "hasOwnProperty", "Set Language"]) {
      act(() => host("TextInput", translateCopy("New SDK map field", "ja")).props.onChangeText(name));
      act(() => host("Pressable", translateCopy("Add SDK map field", "ja")).props.onPress());
      expect(textValues()).toContain(name);
      expect(host("Pressable", name + "（設定済み）").props.accessibilityLabel).toBe(name + "（設定済み）");
      expected[name] = name + " value";
      act(() => host("TextInput", translateCopy("SDK text value", "ja")).props.onChangeText(expected[name]));
      expect(current).toEqual(expected);
    }
    act(() => changeLanguage("en"));
    expect(textValues()).toContain("Set Language");
    act(() => changeLanguage("ja"));
    expect(textValues()).toContain("Set Language");
    expect(current).toEqual(expected);
    const inputs = [{ id: "SourceConfig.metadata", indices: [], value: current }];
    const materializer = new ApiMaterializer(catalog, {}, resources, {}, () => {});
    const applied = configurationOverrides(inputs).apply("SourceConfig", { metadata: {} }, value => materializer.materialize(value));
    expect(applied.metadata).toEqual(expected);
    const code = overrideCode(inputs)[0]!;
    expect(JSON.parse(code.slice(code.indexOf(" = ") + 3, -1))).toEqual(expected);
    expect(code).not.toContain("表示言語");
    materializer.dispose();
    resources.clear();
    act(() => tree.unmount());
  });

  it("localizes applied-code accessibility labels while preserving the actual code", () => {
    const code = 'player.setVolume(17);\n\nconst title = "Language";';
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(React.createElement(LocaleProvider, { initialLanguage: "ja",
      children: React.createElement(ConfigurationCodeView, { code }) })); });
    act(() => { tree.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityLabel === "適用済み設定のコードを表示")[0]!.props.onPress(); });
    expect(tree.root.findAllByProps({ accessibilityLabel: "適用済み設定のコード" })).toHaveLength(1);
    expect(tree.root.findAllByProps({ accessibilityLabel: "コードの空行" })).toHaveLength(1);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'const title = "Language";' })).toHaveLength(1);
    act(() => tree.unmount());
  });

  it("provides Japanese copy for literal application labels and help in the actual UI components", () => {
    const files = [...sourceFiles("src"), ...[]];
    const omitted = new Set(["English", "日本語", "HLS", "DASH", "Progressive MP4", "SourceLoaded", "TimeShifted"]);
    const missing: string[] = [];
    const inspect = (file: string, value: string) => {
      const text = value.replace(/\s+/g, " ").trim();
      if (!/[A-Za-z]/.test(text) || omitted.has(text) || /^(?:[A-Z][A-Za-z]+)(?:\.[A-Za-z0-9_]+)+$/.test(text)) return;
      if (translateCopy(text, "ja") === text) missing.push(file + ": " + text);
    };
    for (const file of files) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node): void => {
        if (ts.isJsxText(node)) inspect(file, node.text);
        if (ts.isJsxAttribute(node) && ["title", "placeholder", "accessibilityLabel"].includes(node.name.getText(source))
          && node.initializer && ts.isStringLiteral(node.initializer)) inspect(file, node.initializer.text);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(missing).toEqual([]);
  });
});
