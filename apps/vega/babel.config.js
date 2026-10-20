// Amazon's W3C Media setup requires the automatic JSX runtime.
// https://developer.amazon.com/docs/vega/0.24/media-player-setup#configure-babel
module.exports = {
  presets: [["module:metro-react-native-babel-preset", { useTransformReactJSXExperimental: true }]],
  plugins: [["@babel/plugin-transform-react-jsx", { runtime: "automatic" }]],
};
