import React, { useState } from "react";
import { panelStyles as styles } from "./panelStyles";
import { View } from "react-native";
import { Button, Switch, Text, TextInput } from "./localization";
import { AdSourceType, SubtitleFormat, type SideLoadedSubtitleTrack } from "bitmovin-player-react-native";
import type { NativeArrayDraft } from "./nativeArrays";

function optional<T extends object, K extends keyof T>(value: T, key: K, raw: string): T {
  const next = { ...value };
  if (raw) Object.assign(next, { [key]: raw });
  else delete next[key];
  return next;
}

type ListKind = keyof NativeArrayDraft;
const LISTS: Record<ListKind, string> = {
  subtitles: "SourceConfig.subtitleTracks", offlineSubtitles: "OfflineContentConfig.sourceConfig.subtitleTracks",
  ads: "PlayerConfig.advertisingConfig.schedule",
};

/** Keep a single list item mounted while preserving typed nested values in the draft. */
export function NativeArraysPanel({ values, onChange }: { values: NativeArrayDraft; onChange: (values: NativeArrayDraft) => void }): React.JSX.Element {
  const [kind, setKind] = useState<ListKind>("subtitles");
  const [index, setIndex] = useState(0);
  const list = values[kind];
  const tracks = kind === "ads" ? [] : values[kind] ?? [];
  const track = tracks[index];
  const ad = kind === "ads" ? values.ads?.[index] : undefined;
  const updateTrack = (next: SideLoadedSubtitleTrack) => {
    if (kind === "ads") return;
    onChange({ ...values, [kind]: tracks.map((item, i) => i === index ? next : item) });
  };
  const field = (label: string, value: string, change: (raw: string) => void) => <View key={label} style={styles.field}>
    <Text>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={change}
      autoCapitalize="none" autoCorrect={false} style={styles.input} />
  </View>;
  const removeItem = () => {
    const next = { ...values };
    if (kind === "ads") next.ads = (values.ads ?? []).filter((_, i) => i !== index);
    else next[kind] = tracks.filter((_, i) => i !== index);
    onChange(next); setIndex(Math.max(0, index - 1));
  };
  const add = () => {
    if (kind === "ads") {
      const ads = values.ads ?? [];
      onChange({ ...values, ads: [...ads, { position: "pre", preloadOffset: "", sources: [{ tag: "", type: AdSourceType.IMA }] }] });
      setIndex(ads.length);
    } else {
      onChange({ ...values, [kind]: [...tracks, { url: "", label: "", language: "en", format: SubtitleFormat.VTT }] });
      setIndex(tracks.length);
    }
  };
  return <View style={styles.panel}>
    <Text style={styles.heading}>Subtitle lists and advertising</Text>
    <Text style={styles.help}>Edit complete subtitle tracks, their roles, and ad items with fallback sources. Apply validates the list. An enabled empty list clears it. Source and offline subtitle lists are independent.</Text>
    <View style={styles.row}>{(Object.keys(LISTS) as ListKind[]).map((key) => <Button key={key} title={LISTS[key]} disabled={kind === key} onPress={() => { setKind(key); setIndex(0); }} />)}</View>
    <Text>{LISTS[kind]}</Text>
    {list === undefined ? <Button title="Edit this list" onPress={() => onChange({ ...values, [kind]: [] })} /> : <>
      <View style={styles.row}>
        <Button title="Add list item" onPress={add} />
        <Button title="Use basic form or SDK default" onPress={() => { const next = { ...values }; delete next[kind]; onChange(next); setIndex(0); }} />
      </View>
      <View style={styles.row}>{list.map((_, i) => <Button key={i} title={`Item ${i + 1}`} disabled={index === i} onPress={() => setIndex(i)} />)}</View>
      {!list.length && <Text style={styles.help}>No items. Apply will set an empty list.</Text>}
      {track && <>
        {field("Track URL", track.url, (url) => updateTrack({ ...track, url }))}
        {field("Track label", track.label, (label) => updateTrack({ ...track, label }))}
        {field("Track language", track.language, (language) => updateTrack({ ...track, language }))}
        {field("Track identifier (optional)", track.identifier ?? "", (identifier) => updateTrack(optional(track, "identifier", identifier)))}
        <Text>Track format</Text>
        <View style={styles.row}>{Object.values(SubtitleFormat).map((format) => <Button key={format} title={format} disabled={track.format === format} onPress={() => updateTrack({ ...track, format })} />)}</View>
        {(["isDefault", "isForced"] as const).map((flag) => <View key={flag} style={styles.row}>
          <Text>{flag}</Text><Switch accessibilityLabel={`Track ${flag}`} value={track[flag] ?? false} onValueChange={(value) => updateTrack({ ...track, [flag]: value })} />
          <Button title={`Unset ${flag}`} onPress={() => { const next = { ...track }; delete next[flag]; updateTrack(next); }} />
        </View>)}
        <Text>Track roles</Text>
        {(track.roles ?? []).map((role, roleIndex) => {
          const update = (next: typeof role) => updateTrack({ ...track, roles: (track.roles ?? []).map((item, i) => i === roleIndex ? next : item) });
          return <View key={roleIndex} style={styles.panel}>
            {field(`Role ${roleIndex + 1} schemeIdUri`, role.schemeIdUri, (schemeIdUri) => update({ ...role, schemeIdUri }))}
            {field(`Role ${roleIndex + 1} id`, role.id ?? "", (id) => update(optional(role, "id", id)))}
            {field(`Role ${roleIndex + 1} value`, role.value ?? "", (value) => update(optional(role, "value", value)))}
            <Button title={`Remove role ${roleIndex + 1}`} onPress={() => updateTrack({ ...track, roles: (track.roles ?? []).filter((_, i) => i !== roleIndex) })} />
          </View>;
        })}
        <View style={styles.row}>
          <Button title="Add track role" onPress={() => updateTrack({ ...track, roles: [...(track.roles ?? []), { schemeIdUri: "" }] })} />
          <Button title="Unset track roles" onPress={() => { const next = { ...track }; delete next.roles; updateTrack(next); }} />
        </View>
      </>}
      {ad && <>
        {field("Ad position (pre, post, time or percentage)", ad.position, (position) => onChange({ ...values, ads: (values.ads ?? []).map((item, i) => i === index ? { ...ad, position } : item) }))}
        {field("Ad preload offset (seconds, optional)", ad.preloadOffset, (preloadOffset) => onChange({ ...values, ads: (values.ads ?? []).map((item, i) => i === index ? { ...ad, preloadOffset } : item) }))}
        {ad.sources.map((source, sourceIndex) => {
          const update = (next: typeof source) => onChange({ ...values, ads: (values.ads ?? []).map((item, i) => i === index ? { ...ad, sources: ad.sources.map((entry, j) => j === sourceIndex ? next : entry) } : item) });
          return <View key={sourceIndex} style={styles.panel}>
            {field(`Ad source ${sourceIndex + 1} tag`, source.tag, (tag) => update({ ...source, tag }))}
            <View style={styles.row}>{Object.values(AdSourceType).map((type) => <Button key={type} title={type} disabled={source.type === type} onPress={() => update({ ...source, type })} />)}</View>
            <Button title={`Remove ad source ${sourceIndex + 1}`} onPress={() => onChange({ ...values, ads: (values.ads ?? []).map((item, i) => i === index ? { ...ad, sources: ad.sources.filter((_, j) => j !== sourceIndex) } : item) })} />
          </View>;
        })}
        <Button title="Add fallback ad source" onPress={() => onChange({ ...values, ads: (values.ads ?? []).map((item, i) => i === index ? { ...ad, sources: [...ad.sources, { tag: "", type: ad.sources[0]?.type ?? AdSourceType.IMA }] } : item) })} />
      </>}
      {(track || ad) && <Button title="Remove list item" onPress={removeItem} />}
    </>}
    <Text style={styles.help}>Subtitle language uses an IETF tag such as en-US. Ad sources in a fallback list must have the same type. Advertising also requires a supported native ad integration and a valid ad tag. Use Player.scheduleAd in API experiments to schedule an applied ad item.</Text>
  </View>;
}
