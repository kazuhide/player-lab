import React, { createContext, forwardRef, useContext, useMemo, useState } from "react";
import { Button as NativeButton, NativeModules, Pressable as NativePressable, Switch as NativeSwitch,
  Text as NativeText, TextInput as NativeTextInput, View,
  type ButtonProps, type PressableProps, type SwitchProps, type TextProps, type TextInputProps } from "react-native";
import { japaneseCopy } from "./translations";

export type Language = "en" | "ja";

function copyEntry(key: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(japaneseCopy, key)) return undefined;
  const value = japaneseCopy[key];
  return typeof value === "string" ? value : undefined;
}

export function languageFromLocale(locale: unknown): Language {
  return typeof locale === "string" && /^ja(?:[-_]|$)/i.test(locale) ? "ja" : "en";
}

function deviceLanguage(): Language {
  const settings = NativeModules?.SettingsManager?.settings;
  const native = settings?.AppleLanguages?.[0] ?? settings?.AppleLocale ?? NativeModules?.I18nManager?.localeIdentifier;
  if (typeof native === "string") return languageFromLocale(native);
  try { return languageFromLocale(Intl.DateTimeFormat().resolvedOptions().locale); }
  catch { return "en"; }
}

/** Only application copy is translated. SDK identifiers, values and user input remain verbatim. */
export function translateCopy(value: string, language: Language): string {
  if (language === "en") return value;
  const direct = copyEntry(value) ?? copyEntry(value.replace(/\s+/g, " ").trim());
  if (direct !== undefined) return direct;
  const patterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^Find (.+)$/, (match) => `${translateCopy(match[1]!, language)}を検索`],
    [/^JavaScript body for (.+)$/, (match) => `${match[1]}のJavaScript本体`],
    [/^Value for (.+)$/, (match) => `${match[1]}の値`],
    [/^Item (\d+)$/, (match) => `項目 ${match[1]}`],
    [/^Remove role (\d+)$/, (match) => `役割 ${match[1]}を削除`],
    [/^Remove ad source (\d+)$/, (match) => `広告ソース ${match[1]}を削除`],
    [/^Ad source (\d+) tag$/, (match) => `広告ソース ${match[1]}のタグ`],
    [/^Role (\d+) (schemeIdUri|id|value)$/, (match) => `役割 ${match[1]}の${match[2]}`],
    [/^Track (isDefault|isForced)$/, (match) => `字幕の${match[1]}`],
    [/^Unset (isDefault|isForced)$/, (match) => `${match[1]}の指定を解除`],
    [/^Metadata (string|number|boolean|null|object|array)$/, (match) => `メタデータ: ${match[1]}`],
    [/^Edit metadata (.+)$/, (match) => `メタデータ ${match[1]}を編集`],
    [/^Remove metadata (.+)$/, (match) => `メタデータ ${match[1]}を削除`],
    [/^(Player|Source) error \((\d+)\)$/, (match) => `${match[1]}エラー (${match[2]})`],
    [/^(.+) must be a valid HTTP or HTTPS URL\.$/, (match) => `${translateCopy(match[1]!, language)}には有効なHTTPまたはHTTPSのURLを入力してください。`],
    [/^(.+) must be a finite decimal number\.$/, (match) => `${translateCopy(match[1]!, language)}には有限の数値を入力してください。`],
    [/^(.+) requires a number\.$/, (match) => `${translateCopy(match[1]!, language)}には数値を入力してください。`],
    [/^(.+) must be a finite number between ([+-]?(?:Infinity|\d+(?:\.\d+)?(?:e[+-]?\d+)?)) and ([+-]?(?:Infinity|\d+(?:\.\d+)?(?:e[+-]?\d+)?))\.$/i,
      (match) => `${translateCopy(match[1]!, language)}には${match[2]}から${match[3]}までの有限の数値を入力してください。`],
    [/^((?:SourceConfig|OfflineContentConfig\.sourceConfig)\.drmConfig\.(?:fairplay|widevine)\.licenseUrl) is required before applying DRM callbacks\.$/,
      (match) => `DRMコールバックを適用する前に${match[1]}を設定してください。`],
    [/^Unknown configuration API: (.+)$/, (match) => `不明な設定APIです: ${match[1]}`],
    [/^(.+) returned a value outside its SDK contract\.$/, (match) => `${match[1]}の戻り値がSDKの仕様に適合していません。`],
  ];
  for (const [pattern, render] of patterns) { const match = value.match(pattern); if (match) return render(match); }
  return value;
}

interface Locale { language: Language; setLanguage: (language: Language) => void; }
const LocaleContext = createContext<Locale>({ language: "en", setLanguage: () => {} });

export function LocaleProvider({ children, initialLanguage }: { children: React.ReactNode; initialLanguage?: Language }): React.JSX.Element {
  const [language, setLanguage] = useState<Language>(() => initialLanguage ?? deviceLanguage());
  const value = useMemo(() => ({ language, setLanguage }), [language]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);

function localizedProps<T extends { accessibilityLabel?: string | undefined; accessibilityHint?: string | undefined }>(props: T, language: Language): T {
  return { ...props,
    ...(props.accessibilityLabel ? { accessibilityLabel: translateCopy(props.accessibilityLabel, language) } : {}),
    ...(props.accessibilityHint ? { accessibilityHint: translateCopy(props.accessibilityHint, language) } : {}),
  };
}

function textChildren(children: React.ReactNode, language: Language): React.ReactNode {
  if (typeof children === "string") return translateCopy(children, language);
  return Array.isArray(children) ? children.map((child) => textChildren(child, language)) : children;
}

export function Text({ children, verbatim = false, ...props }: TextProps & { verbatim?: boolean }): React.JSX.Element {
  const { language } = useLocale();
  return <NativeText {...localizedProps(props, language)}>{verbatim ? children : textChildren(children, language)}</NativeText>;
}

export function Button(props: ButtonProps): React.JSX.Element {
  const { language } = useLocale();
  return <NativeButton {...localizedProps(props, language)} title={translateCopy(props.title, language)} />;
}

export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function LocalizedTextInput(props, ref) {
  const { language } = useLocale();
  return <NativeTextInput disableFullscreenUI {...localizedProps(props, language)} ref={ref}
    {...(props.placeholder ? { placeholder: translateCopy(props.placeholder, language) } : {})} />;
});

export function Switch(props: SwitchProps): React.JSX.Element {
  const { language } = useLocale();
  return <NativeSwitch {...localizedProps(props, language)} />;
}

export function Pressable({ verbatim = false, ...props }: PressableProps & { verbatim?: boolean }): React.JSX.Element {
  const { language } = useLocale();
  return <NativePressable {...(verbatim ? props : localizedProps(props, language))} />;
}

export function LanguageSelector({ dark = false }: { dark?: boolean }): React.JSX.Element {
  const { language, setLanguage } = useLocale();
  return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingVertical: 4 }}>
    <Text style={{ color: dark ? "#ffffff" : "#111111" }}>Language</Text>
    <NativeButton title="English" accessibilityLabel="English" disabled={language === "en"} onPress={() => setLanguage("en")} />
    <NativeButton title="日本語" accessibilityLabel="日本語" disabled={language === "ja"} onPress={() => setLanguage("ja")} />
  </View>;
}
