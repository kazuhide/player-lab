import React from "react";
import { registerRootComponent } from "expo";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import App from "./App";

// Keep the showcase screen intact; the external host owns the device safe area.
function PlayerLabHost(): React.JSX.Element {
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1 }}><App /></SafeAreaView></SafeAreaProvider>;
}

registerRootComponent(PlayerLabHost);
