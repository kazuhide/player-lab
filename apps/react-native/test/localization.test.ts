import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Button: "Button", Pressable: "Pressable", Switch: "Switch", Text: "Text", TextInput: "TextInput", View: "View",
  NativeModules: {},
}));

import { languageFromLocale, translateCopy } from "../src/localization";

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : entry.name.endsWith(".tsx") && !entry.name.startsWith("RuntimeCheck")
      && entry.name !== "localization.tsx" ? [file] : [];
  });
}

describe("application language", () => {
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

  it("provides Japanese copy for literal application labels and help in the actual UI components", () => {
    const files = [...sourceFiles("src"), ...["App.tsx"]];
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
