import { registerRootComponent } from "expo";
import App from "./App";

// Expo launch properties stay in the host; App owns its optional runtime-check dependency.
function Root() { return <App />; }

registerRootComponent(Root);
