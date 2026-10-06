import { setWarning, wrapErrorHandler } from './libs/generic';
import {
  getEnvironment,
  installDiagnostics,
  report,
} from './libs/diagnostics';

installDiagnostics();
report('content-script-loaded', getEnvironment());

const setResourceWarning = (detail = '') => {
  report('resource-warning', { detail }, 'error');
  setWarning(
    `Bilibili 氛围灯资源加载失败。\n请刷新网页后重试。${
      detail ? `\n\n${detail}` : ''
    }`
  );
};

const waitForElement = (selector, timeout = 15000) =>
  new Promise((resolve, reject) => {
    if (!document.documentElement) {
      const rootObserver = new MutationObserver(() => {
        if (!document.documentElement) return;
        rootObserver.disconnect();
        waitForElement(selector, timeout).then(resolve, reject);
      });
      rootObserver.observe(document, { childList: true });
      return;
    }

    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }
    if (selector.includes('bpx-') && document.querySelector('.bpx-legacy-browser-container')) {
      reject(new Error('Bilibili 正在使用旧版播放器，氛围灯暂不支持此播放器结构。请确认浏览器能正常播放视频。'));
      return;
    }

    const observer = new MutationObserver(() => {
      if (selector.includes('bpx-') && document.querySelector('.bpx-legacy-browser-container')) {
        observer.disconnect();
        clearTimeout(timeoutId);
        reject(new Error('Bilibili 正在使用旧版播放器，当前浏览器的视频解码支持不足，氛围灯无法绑定。请先确认浏览器能正常播放视频。'));
        return;
      }
      const elem = document.querySelector(selector);
      if (!elem) return;
      observer.disconnect();
      clearTimeout(timeoutId);
      resolve(elem);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const timeoutId = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`等待元素超时：${selector}`));
    }, timeout);
  });

wrapErrorHandler(async function loadBilibiliAmbientlight() {
  report('load-start', getEnvironment());
  if (!chrome?.runtime?.id) {
    setResourceWarning('扩展上下文已失效。');
    return;
  }

  const styleUrl = chrome.runtime.getURL('styles/content.css');
  const scriptUrl = chrome.runtime.getURL('scripts/content-main.js');

  report('runtime-urls-resolved', { styleUrl, scriptUrl });

  await waitForElement('head');
  report('head-ready');

  if (!document.head.querySelector(`link[href="${styleUrl}"]`)) {
    await new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = styleUrl;
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', () => reject(new Error('样式加载失败')), {
        once: true,
      });
      document.head.appendChild(link);
    });
    report('style-loaded', styleUrl);
  }

  const player = await waitForElement('#bilibili-player .bpx-player-container');
  report('player-container-ready', player);
  const controls = await waitForElement('.bpx-player-control-bottom-right');
  report('controls-ready', controls);
  report('before-main-import', getEnvironment());
  await import(scriptUrl);
  report('main-import-resolved', getEnvironment());
})().catch((ex) => {
  report('load-failed', ex, 'error');
  console.error(ex);
  setResourceWarning(ex?.message);
});
