import React, { createContext, forwardRef, useContext, useMemo, useState } from "react";
import { NativeModules, Pressable as NativePressable, StyleSheet, Switch as NativeSwitch,
  Text as NativeText, TextInput as NativeTextInput, View,
  type ButtonProps, type PressableProps, type SwitchProps, type TextProps, type TextInputProps } from "react-native";
import { japaneseCopy } from "./translations";

export type Language = "en" | "ja";

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
  for (const key of [value, value.replace(/\s+/g, " ").trim()]) {
    if (Object.prototype.hasOwnProperty.call(japaneseCopy, key) && typeof japaneseCopy[key] === "string") return japaneseCopy[key]!;
  }
  const patterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^(.+) ●$/, (match) => `${translateCopy(match[1]!, language)} ●`],
    [/^Method signature (\d+)$/, (match) => `メソッドの引数形式 ${match[1]}`],
    [/^Callback signature (\d+)$/, (match) => `コールバックの引数形式 ${match[1]}`],
    [/^Selected item (\d+)$/, (match) => `選択中の項目 ${match[1]}`],
    [/^Vega API array index (\d+)$/, (match) => `Vega APIの配列添字 ${match[1]}`],
    [/^Set (.+)$/, (match) => `${match[1]}を設定`],
    [/^Omit (.+)$/, (match) => `${match[1]}を省略`],
    [/^(.+) \(set\)$/, (match) => `${match[1]}（設定済み）`],
    [/^(.+) must be a valid HTTP or HTTPS URL\.$/, (match) => `${translateCopy(match[1]!, language)}には有効なHTTPまたはHTTPSのURLを入力してください。`],
    [/^(.+) must be a finite decimal number\.$/, (match) => `${translateCopy(match[1]!, language)}には有限の数値を入力してください。`],
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

export function Button({ verbatim = false, ...props }: ButtonProps & { verbatim?: boolean }): React.JSX.Element {
  const { language } = useLocale();
  const [focused, setFocused] = useState(false);
  const { title, color, onPress, touchSoundDisabled, ...rest } = verbatim ? props : localizedProps(props, language);
  const disabled = props.disabled ?? props.accessibilityState?.disabled ?? false;
  const label = verbatim ? title : translateCopy(title, language);
  return <NativePressable {...rest} accessibilityRole="button" accessibilityLabel={rest.accessibilityLabel ?? label}
    accessibilityState={{ ...rest.accessibilityState, disabled: Boolean(disabled) }} disabled={disabled}
    focusable={!disabled} android_disableSound={touchSoundDisabled} onPress={disabled ? undefined : onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={[buttonStyles.button, color ? { backgroundColor: color, borderColor: color } : null,
      focused && !disabled && buttonStyles.focused, disabled && buttonStyles.disabled,
      focused && { borderColor: "#ffffff" }]}>
    <NativeText style={[buttonStyles.text, disabled && buttonStyles.disabledText]}>{label}</NativeText>
  </NativePressable>;
}

export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function LocalizedTextInput(props, ref) {
  const { language } = useLocale();
  const [focused, setFocused] = useState(false);
  return <NativeTextInput {...localizedProps(props, language)} ref={ref}
    onFocus={event => { setFocused(true); props.onFocus?.(event); }}
    onBlur={event => { setFocused(false); props.onBlur?.(event); }}
    style={[props.style, focused && { borderColor: "#ffffff", borderWidth: 2 }]}
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
  return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingHorizontal: 24, paddingVertical: 12 }}>
    <Text style={{ color: dark ? "#f4f7fb" : "#182c45", fontSize: 18 }}>Language</Text>
    <Button title="English" accessibilityLabel="English" disabled={language === "en"} onPress={() => setLanguage("en")} />
    <Button title="日本語" accessibilityLabel="日本語" disabled={language === "ja"} onPress={() => setLanguage("ja")} />
  </View>;
}

const buttonStyles = StyleSheet.create({
  button: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 10, justifyContent: "center", alignItems: "center", borderRadius: 8, borderWidth: 2, borderColor: "#005caf", backgroundColor: "#005caf" },
  focused: { borderColor: "#ffffff", backgroundColor: "#1a6bb5" },
  text: { color: "#ffffff", fontSize: 18, fontWeight: "600", textAlign: "center" },
  disabled: { backgroundColor: "#29374a", borderColor: "#4a5a70" },
  disabledText: { color: "#b8c6d9" },
});
