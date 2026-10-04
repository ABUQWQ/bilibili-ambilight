import { on, setErrorHandler, setWarning, wrapErrorHandler } from './libs/generic';
import Ambientlight from './libs/ambientlight';
import ErrorReporter from './libs/errors/error-reporter';
import {
  getEnvironment,
  installDiagnostics,
  probe,
  report,
} from './libs/diagnostics';

installDiagnostics();
report('main-script-loaded', getEnvironment());

setErrorHandler((ex) => ErrorReporter.captureException(ex));

const isBilibiliVideoPage = () => {
  if (location.hostname !== 'www.bilibili.com') return false;
  return /^\/video\/(?:BV[0-9A-Za-z]+|av\d+)/i.test(location.pathname);
};

const getPlayerParts = () => {
  const playerElem = document.querySelector('#bilibili-player');
  const videoPlayerElem = playerElem?.querySelector('.bpx-player-container');
  const videoAreaElem = videoPlayerElem?.querySelector('.bpx-player-video-area');
  const videoElem = videoAreaElem?.querySelector('.bpx-player-video-wrap video');
  const controlRightElem = videoPlayerElem?.querySelector(
    '.bpx-player-control-bottom-right'
  );
  return { playerElem, videoPlayerElem, videoAreaElem, videoElem, controlRightElem };
};

const waitForPlayer = (timeout = 20000) =>
  new Promise((resolve, reject) => {
    const check = () => {
      const parts = getPlayerParts();
      if (
        parts.videoPlayerElem &&
        parts.videoAreaElem &&
        parts.videoElem &&
        parts.controlRightElem
      ) {
        return parts;
      }
      return null;
    };

    const existing = check();
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const parts = check();
      if (!parts) return;
      observer.disconnect();
      clearTimeout(timeoutId);
      resolve(parts);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const timeoutId = setTimeout(() => {
      observer.disconnect();
      reject(new Error('等待 Bilibili 播放器超时'));
    }, timeout);
  });

let lastUrl = location.href;
let lastVideoElem;
let lastVideoSrc = '';
let routeObserver;

const updateVideoPageState = wrapErrorHandler(async () => {
  const ambientlight = window.ambientlight;
  if (!ambientlight || ambientlight === false) return;

  const parts = getPlayerParts();
  report('route-state-check', {
    ambientlight: !!ambientlight,
    isOnVideoPage: ambientlight.isOnVideoPage,
    parts: {
      playerElem: !!parts.playerElem,
      videoPlayerElem: !!parts.videoPlayerElem,
      videoAreaElem: !!parts.videoAreaElem,
      videoElem: !!parts.videoElem,
      controlRightElem: !!parts.controlRightElem,
    },
  });
  if (!parts.videoElem || !isBilibiliVideoPage()) {
    if (ambientlight.isOnVideoPage) {
      report('leaving-video-page');
      ambientlight.isOnVideoPage = false;
      await ambientlight.hide();
    }
    return;
  }

  if (parts.videoElem !== ambientlight.videoElem) {
    report('rebinding-video-element', parts.videoElem);
    ambientlight.initVideoElem(parts.videoElem);
    lastVideoElem = parts.videoElem;
    lastVideoSrc = parts.videoElem.currentSrc || parts.videoElem.src || '';
  } else if (
    lastVideoSrc !== (parts.videoElem.currentSrc || parts.videoElem.src || '')
  ) {
    lastVideoSrc = parts.videoElem.currentSrc || parts.videoElem.src || '';
    ambientlight.sizesChanged = true;
    ambientlight.buffersCleared = true;
  }

  if (!ambientlight.isOnVideoPage) {
    report('entering-video-page');
    ambientlight.isOnVideoPage = true;
    if (ambientlight.settings?.enabled) await ambientlight.show();
  }

  if (ambientlight.settings?.enabled) await ambientlight.optionalFrame();
});

const setupRouteWatcher = () => {
  if (routeObserver) return;

  routeObserver = new MutationObserver(
    wrapErrorHandler(() => {
      const urlChanged = location.href !== lastUrl;
      const videoChanged = lastVideoElem !== document.querySelector('#bilibili-player .bpx-player-video-wrap video');
      if (!urlChanged && !videoChanged) return;
      lastUrl = location.href;
      updateVideoPageState();
    }, true)
  );
  routeObserver.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  on(window, 'popstate hashchange', () => {
    lastUrl = location.href;
    updateVideoPageState();
  });

  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      updateVideoPageState();
    }
  }, 1000);
};

wrapErrorHandler(async function initBilibiliAmbientlight() {
  report('init-start', getEnvironment());
  if (window.ambientlight !== undefined) return;
  if (!isBilibiliVideoPage()) {
    report('init-skipped-url', { href: location.href });
    return;
  }

  const parts = await waitForPlayer();
  report('player-parts-ready', parts);
  window.ambientlight = await new Ambientlight(
    parts.videoElem,
    parts.videoPlayerElem,
    parts.videoPlayerElem,
    null
  );
  lastVideoElem = parts.videoElem;
  lastVideoSrc = parts.videoElem.currentSrc || parts.videoElem.src || '';
  report('ambientlight-initialized', {
    view: window.ambientlight.view,
    isHidden: window.ambientlight.isHidden,
    settingsEnabled: window.ambientlight.settings?.enabled,
    projectorReady: !!window.ambientlight.projector,
    projectorBufferSize: window.ambientlight.projectorBuffer
      ? {
          width: window.ambientlight.projectorBuffer.elem.width,
          height: window.ambientlight.projectorBuffer.elem.height,
        }
      : null,
  });
  report('initial-probe', probe());
  setupRouteWatcher();
})().catch((ex) => {
  report('init-failed', ex, 'error');
  setWarning(`Bilibili 氛围灯初始化失败。\n${ex?.message || ex}`);
  throw ex;
});
