// Generate the ignored runtime configuration before bundling. Set the globals
// before loading App.tsx, which reads them when its module is evaluated.
const { playerKey, analyticsKey, runtimeChecks } = require("./runtime.local.json");
globalThis.BITMOVIN_PLAYER_LICENSE_KEY = playerKey;
globalThis.BITMOVIN_ANALYTICS_LICENSE_KEY = analyticsKey;

const { AppRegistry } = require("react-native");
// build-vega uses index.js. Only an explicitly generated test configuration adds the read-only footer.
const App = runtimeChecks ? require("./src/RuntimeCheckApp").RuntimeCheckApp : require("./src/App").App;
const { name } = require("./app.json");
AppRegistry.registerComponent(name, () => App);
