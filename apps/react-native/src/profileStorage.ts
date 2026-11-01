import { File, Paths } from "expo-file-system";
import { ConfigurationProfileError, PROFILE_LIMITS, decodeProfiles, type ProfileIO, type ProfilePlatform } from "./configurationProfiles";

/** Expo 57 replacement is not atomic. Keep the previous acknowledged payload until the new file is verified. */
export function createProfileIO(platform: ProfilePlatform): ProfileIO {
  const filename = `player-lab-profiles-${platform}-v1.json`;
  const file = (suffix = "") => new File(Paths.document, filename + suffix);
  const readFile = async (source: File): Promise<string> => {
    if (source.size > PROFILE_LIMITS.totalBytes) throw new ConfigurationProfileError("capacity");
    const raw = await source.text();
    decodeProfiles(raw, platform);
    return raw;
  };
  const read = async (): Promise<string | null> => {
    const primary = file();
    if (primary.exists) return readFile(primary);
    const backup = file(".backup");
    if (backup.exists) {
      await readFile(backup);
      throw new ConfigurationProfileError("recovery");
    }
    return null;
  };
  const writeChecked = async (target: File, raw: string) => {
    target.create({ overwrite: true });
    target.write(raw);
    if (await readFile(target) !== raw) throw new ConfigurationProfileError("storage");
  };
  const cleanupTemp = () => {
    // move changes the File object's URI; always address the original temporary path again.
    try { const temporary = file(".tmp"); if (temporary.exists) temporary.delete(); } catch { /* The next write replaces this bounded temporary file. */ }
  };
  return {
    read,
    write: async raw => {
      decodeProfiles(raw, platform);
      const acknowledged = await read();
      let replacing = false;
      try {
        const temporary = file(".tmp");
        await writeChecked(temporary, raw);
        if (acknowledged !== null) await writeChecked(file(".backup"), acknowledged);
        replacing = true;
        await temporary.move(file(), { overwrite: true });
        if (await readFile(file()) !== raw) throw new ConfigurationProfileError("storage");
      } catch {
        if (replacing) {
          try {
            if (acknowledged === null) { if (file().exists) file().delete(); }
            else { await file(".backup").copy(file(), { overwrite: true }); if (await readFile(file()) !== acknowledged) throw new Error(); }
          } catch {
            // Keep the validated backup and require explicit recovery if replacement cannot be rolled back.
            try { if (file().exists) file().delete(); } catch { /* Leave the storage error visible. */ }
          }
        }
        throw new ConfigurationProfileError("storage");
      } finally { cleanupTemp(); }
    },
    recover: async () => {
      if (file().exists) throw new ConfigurationProfileError("storage");
      const raw = await readFile(file(".backup"));
      try {
        await writeChecked(file(".tmp"), raw);
        await file(".tmp").move(file());
        if (await readFile(file()) !== raw) throw new ConfigurationProfileError("storage");
      } catch {
        try { if (file().exists) file().delete(); } catch { /* Recovery remains available from the backup. */ }
        throw new ConfigurationProfileError("storage");
      } finally { cleanupTemp(); }
    },
  };
}
