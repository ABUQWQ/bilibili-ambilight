// Bilibili 首版不接管站点主题，仅保留核心代码使用的接口。
export default class Theming {
  constructor(ambientlight) {
    this.ambientlight = ambientlight;
  }

  initListeners() {}

  isDarkTheme() {
    return document.documentElement.getAttribute('dark') != null;
  }

  shouldBeDarkTheme(enabledAndVisible) {
    if (enabledAndVisible !== undefined) return !enabledAndVisible;
    return !this.ambientlight.settings?.enabled || this.ambientlight.isHidden;
  }

  updateTheme() {
    return false;
  }
}
