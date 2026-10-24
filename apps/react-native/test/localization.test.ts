import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Button: "Button", Pressable: "Pressable", Switch: "Switch", Text: "Text", TextInput: "TextInput", View: "View",
  NativeModules: {},
}));

import { languageFromLocale, translateCopy } from "../src/localization";
import { finiteNumber } from "../src/apiValues";

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

  it("keeps prototype property names as literal strings rather than translation entries", () => {
    for (const value of ["toString", "constructor", "hasOwnProperty", "__proto__", "valueOf", "  toString  "]) {
      expect(translateCopy(value, "ja")).toBe(value);
      expect(typeof translateCopy(value, "ja")).toBe("string");
    }
  });

  it("translates application validation templates while preserving SDK identifiers and bounds", () => {
    const samples = [
      ["Maximum bitrate must be a finite decimal number.", "最大ビットレートには有限の数値を入力してください。"],
      ["Start offset must be a finite decimal number.", "開始位置には有限の数値を入力してください。"],
      ["PlayerConfig.tweaksConfig.timeChangedInterval requires a number.", "PlayerConfig.tweaksConfig.timeChangedIntervalには数値を入力してください。"],
      ["PlayerConfig.tweaksConfig.timeChangedInterval must be a finite number between -Infinity and Infinity.", "PlayerConfig.tweaksConfig.timeChangedIntervalには-InfinityからInfinityまでの有限の数値を入力してください。"],
      ["SourceConfig.drmConfig.fairplay.licenseUrl is required before applying DRM callbacks.", "DRMコールバックを適用する前にSourceConfig.drmConfig.fairplay.licenseUrlを設定してください。"],
      ["Unknown configuration API: SourceConfig.unknown", "不明な設定APIです: SourceConfig.unknown"],
      ["PlayerViewProps.fullscreenHandler returned a value outside its SDK contract.", "PlayerViewProps.fullscreenHandlerの戻り値がSDKの仕様に適合していません。"],
    ];
    for (const [message, japanese] of samples) {
      expect(translateCopy(message!, "ja")).toBe(japanese);
      expect(translateCopy(message!, "en")).toBe(message);
    }
  });

  it("provides Japanese copy for literal errors produced by the configuration validators", () => {
    const missing: string[] = [];
    const files = ["configuration.ts", "nativeScripts.ts", "nativeSettings.ts", "nativeArrays.ts", "metadataInput.tsx", "apiValues.ts"];
    for (const name of files) {
      const file = path.join("src", name);
      const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const inspect = (node: ts.Node): void => {
        if (ts.isStringLiteral(node) && translateCopy(node.text, "ja") === node.text) missing.push(name + ": " + node.text);
        else if (ts.isConditionalExpression(node)) { inspect(node.whenTrue); inspect(node.whenFalse); }
      };
      const visit = (node: ts.Node): void => {
        if (ts.isThrowStatement(node) && node.expression && ts.isNewExpression(node.expression)
          && node.expression.expression.getText(source) === "Error" && node.expression.arguments?.[0]) inspect(node.expression.arguments[0]);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(missing).toEqual([]);
  });

  it("localizes the field names supplied to configuration number validators", () => {
    const labels = new Set<string>();
    for (const name of ["nativeSettings.ts", "nativeArrays.ts", "metadataInput.tsx"]) {
      const file = path.join("src", name);
      const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.getText(source) === "finiteNumber"
          && node.arguments[1] && ts.isStringLiteral(node.arguments[1])) labels.add(node.arguments[1].text);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(labels.size).toBeGreaterThan(0);
    for (const label of labels) {
      const translatedLabel = translateCopy(label, "ja");
      if (!label.includes(".")) expect(translatedLabel, label).not.toBe(label);
      for (const value of ["", "Infinity"]) {
        let message = "";
        try { finiteNumber(value, label); } catch (cause) { if (cause instanceof Error) message = cause.message; }
        expect(message).not.toBe("");
        expect(translateCopy(message, "ja")).toBe(value === ""
          ? `${translatedLabel}には数値を入力してください。`
          : `${translatedLabel}には-InfinityからInfinityまでの有限の数値を入力してください。`);
        expect(translateCopy(message, "en")).toBe(message);
      }
    }
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
