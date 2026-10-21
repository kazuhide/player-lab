import React from "react";
import { registerRootComponent } from "expo";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { RuntimeCheckApp } from "./src/RuntimeCheckApp";

function PlayerLabRuntimeHost(): React.JSX.Element {
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1 }}><RuntimeCheckApp /></SafeAreaView></SafeAreaProvider>;
}

registerRootComponent(PlayerLabRuntimeHost);
