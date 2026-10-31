import { AsyncStorage } from "@amazon-devices/react-native-kepler";
import { decodeProfiles, type ProfileIO } from "./configurationProfiles";

export const PROFILE_STORAGE_KEY = "player-lab.configuration-profiles.vega.v1";

/** Own one key only; unrelated application and SDK storage is never cleared. */
export function createProfileIO(): ProfileIO {
  return {
    read: () => AsyncStorage.getItem(PROFILE_STORAGE_KEY),
    write: async value => {
      decodeProfiles(value, "vega");
      await AsyncStorage.setItem(PROFILE_STORAGE_KEY, value);
    },
  };
}
