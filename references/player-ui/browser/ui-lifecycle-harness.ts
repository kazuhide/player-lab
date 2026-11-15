import { i18n, UIFactory } from "bitmovin-player-ui";

const activeSubscribers = new Set<unknown>();
const layoutCalls = { main: 0, smallScreen: 0, tv: 0 };
const languageChanged = i18n.getConfig().events?.onLanguageChanged;
if (!languageChanged) throw new Error("The official UI localization event is unavailable");

const subscribe = languageChanged.subscribe.bind(languageChanged);
const unsubscribe = languageChanged.unsubscribe.bind(languageChanged);
languageChanged.subscribe = listener => {
  activeSubscribers.add(listener);
  return subscribe(listener);
};
languageChanged.unsubscribe = listener => {
  activeSubscribers.delete(listener);
  return unsubscribe(listener);
};

const main = UIFactory.defaultLayouts.main;
const smallScreen = UIFactory.defaultLayouts.smallScreen;
const tv = UIFactory.defaultLayouts.tv;
UIFactory.defaultLayouts.main = config => {
  layoutCalls.main += 1;
  return main(config);
};
UIFactory.defaultLayouts.smallScreen = () => {
  layoutCalls.smallScreen += 1;
  return smallScreen();
};
UIFactory.defaultLayouts.tv = () => {
  layoutCalls.tv += 1;
  return tv();
};

/** Test-only accounting through public methods, without inspecting SDK private fields. */
export function readUiLifecycle() {
  return {
    subscribers: activeSubscribers.size,
    layouts: { ...layoutCalls },
    roots: document.querySelectorAll(".bmpui-ui-uicontainer").length,
  };
}
