import Settings from '../src/scripts/libs/settings';
import SettingsConfig from '../src/scripts/libs/settings-config';
import { handleAmbientlightKeyDown } from '../src/scripts/libs/keyboard';
import Ambientlight from '../src/scripts/libs/ambientlight';
import Theming from '../src/scripts/libs/theming';
import { on, VIEW_SMALL } from '../src/scripts/libs/generic';

// Only the renderer is stubbed. Settings DOM, handlers and storage are real.
const noOp = () => {};
const light = new Proxy({
  videoPlayerElem: document.querySelector('.bpx-player-container'),
  videoElem: document.querySelector('video'),
  view: VIEW_SMALL,
  getImageDataAllowed: true,
  initializedTime: 1,
  isOnVideoPage: true,
  isHidden: false,
  barDetection: { reset: noOp, clear: noOp },
  stats: { update: noOp, hide: noOp },
  projector: { initCtx: async () => true },
  projectorBuffer: { ctx: { initCtx: async () => true } },
  toggleEnabled: async (enabled) => {
    if (enabled === undefined) enabled = !menu.enabled;
    menu.set('enabled', enabled, true);
    document.documentElement.toggleAttribute('data-ambientlight-enabled', enabled);
    if (!enabled) menu.closeMenuImmediately();
  },
  onKeyPressed: async (key) => {
    if (key === menu.getKeys().enabled) await light.toggleEnabled();
  },
}, {
  get(target, key) { return key in target ? target[key] : noOp; },
});
let menu;
window.fixtureReady = (async () => {
  menu = await new Settings(light,
    document.querySelector('.bpx-player-control-bottom-right'), light.videoPlayerElem);
  light.settings = menu;
  menu.onLoaded();
  light.theming = new Theming(light);
  light.theming.initListeners();
  on(document, 'keydown', handleAmbientlightKeyDown.bind(light));
  window.fixture = { menu, light, SettingsConfig, Theming, Ambientlight };
})();
