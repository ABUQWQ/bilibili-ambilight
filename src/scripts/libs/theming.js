// Bilibili 首版不接管站点主题，仅保留核心代码使用的接口。
export default class Theming {
  constructor(ambientlight) {
    this.ambientlight = ambientlight;
  }

  initListeners() {
    if (this.observer) return;
    this.updateTheme();
    this.observer = new MutationObserver(() => {
      if (!this.updateTheme()) return;
      this.ambientlight.lastPageAmbientTintUpdate = 0;
      this.ambientlight.updateStyles();
      if (this.ambientlight.settings?.enabled && !this.ambientlight.isHidden) {
        this.ambientlight.optionalFrame();
      }
    });
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'dark', 'data-theme'],
    });
  }

  isDarkTheme() {
    const html = document.documentElement;
    return (
      html.classList.contains('night-mode') ||
      html.getAttribute('dark') != null ||
      html.getAttribute('data-theme') === 'dark'
    );
  }

  shouldBeDarkTheme(enabledAndVisible) {
    if (enabledAndVisible !== undefined) return !enabledAndVisible;
    return !this.ambientlight.settings?.enabled || this.ambientlight.isHidden;
  }

  updateTheme() {
    const theme = this.isDarkTheme() ? 'dark' : 'light';
    if (this.theme === theme) return false;
    this.theme = theme;
    document.documentElement.setAttribute('data-bili-ambient-theme', theme);
    return true;
  }
}
