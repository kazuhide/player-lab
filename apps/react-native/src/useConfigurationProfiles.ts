import { useEffect, useMemo, useRef, useState } from "react";
import type { ConfigurationDraft } from "./configuration";
import { CURRENT_SDK_VERSION, ConfigurationProfileError, ProfileRepository, captureProfile, profileErrorMessage, restoreProfile,
  type ConfigurationProfile, type ProfilePlatform } from "./configurationProfiles";
import { createProfileIO } from "./profileStorage";

type Confirmation = { action: "replace" | "delete" | "restore"; profile: ConfigurationProfile } | { action: "recover" };
const repositories = new Map<ProfilePlatform, ProfileRepository>();
function repository(platform: ProfilePlatform): ProfileRepository {
  let value = repositories.get(platform);
  if (!value) { value = new ProfileRepository(createProfileIO(platform), platform); repositories.set(platform, value); }
  return value;
}

/** All restoration effects stop at onChange. Applying is owned by the existing parent configuration panel. */
export function useConfigurationProfiles(draft: ConfigurationDraft, onChange: (draft: ConfigurationDraft) => void, platform: ProfilePlatform) {
  const store = useMemo(() => repository(platform), [platform]);
  const [profiles, setProfiles] = useState<ConfigurationProfile[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canRecover, setCanRecover] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const owner = useRef<symbol | null>(null);
  const selected = profiles.find(profile => profile.name === selectedName);
  const failure = (cause: unknown) => {
    setError(profileErrorMessage(cause));
    setCanRecover(cause instanceof ConfigurationProfileError && cause.code === "recovery");
  };
  useEffect(() => {
    const token = Symbol("configuration-profiles");
    owner.current = token;
    let active = true;
    setProfiles([]); setSelectedName("");
    setBusy(true); setError(null); setCanRecover(false); setConfirmation(null); setNotice(null);
    store.list().then(values => {
      if (active) { setProfiles(values); setSelectedName(values[0]?.name ?? ""); }
    }).catch(cause => { if (active) failure(cause); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; owner.current = null; };
  }, [store]);
  const run = async (operation: () => Promise<ConfigurationProfile[]>, notice: string, selected?: string) => {
    if (busy) return;
    const token = owner.current;
    setBusy(true); setError(null); setCanRecover(false); setNotice(null);
    try {
      const values = await operation();
      if (owner.current !== token) return;
      setProfiles(values); setSelectedName(values.some(value => value.name === selected) ? selected! : values[0]?.name ?? "");
      setNotice(notice);
    } catch (cause) { if (owner.current === token) { setProfiles([]); setSelectedName(""); failure(cause); } }
    finally { if (owner.current === token) setBusy(false); }
  };
  const save = () => {
    if (busy || canRecover) return;
    setError(null); setNotice(null);
    try {
      const profile = captureProfile(name, draft, platform);
      if (profiles.some(value => value.name === profile.name)) setConfirmation({ action: "replace", profile });
      else void run(() => store.save(profile), "Configuration saved.", profile.name);
    } catch (cause) { failure(cause); }
  };
  const loadDraft = (profile: ConfigurationProfile, confirmSdk = false) => {
    try {
      const restored = restoreProfile(profile, draft, platform, confirmSdk);
      onChange(restored); setError(null); setNotice("Loaded into draft.");
    } catch (cause) { failure(cause); }
  };
  const restore = () => {
    if (!selected || busy || canRecover) return;
    if (selected.sdkVersion !== CURRENT_SDK_VERSION) setConfirmation({ action: "restore", profile: selected });
    else loadDraft(selected);
  };
  const confirm = () => {
    const pending = confirmation; setConfirmation(null);
    if (!pending || busy) return;
    if (pending.action === "replace") void run(() => store.save(pending.profile, true), "Configuration saved.", pending.profile.name);
    else if (pending.action === "delete") void run(() => store.remove(pending.profile.name), "Saved configuration deleted.");
    else if (pending.action === "recover") void run(() => store.recover(), "Backup recovered. Select a configuration to load its draft.");
    else loadDraft(pending.profile, true);
  };
  const select = (id: string) => { setSelectedName(id); setName(id); setNotice(null); setError(null); };
  return { profiles, selectedName, selected, name, setName, busy, error, notice, canRecover, confirmation, save, restore, select, confirm,
    cancel: () => setConfirmation(null),
    remove: () => { if (selected && !busy) setConfirmation({ action: "delete", profile: selected }); },
    recover: () => setConfirmation({ action: "recover" }),
    retry: () => void run(() => store.list(), "Saved configurations reloaded.", selectedName),
  };
}
