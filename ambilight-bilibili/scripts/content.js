(function () {
  'use strict';

  
  let console;
  
  (function () {
    const preMessage = 'Bilibili 氛围灯 |';
  
    const enrich = (...args) => {
      if (args.length <= 0) return args;
  
      if (typeof args[0] === 'string') {
        const [firstArg, ...postArgs] = args;
        return [`${preMessage} ${firstArg}`, ...postArgs];
      }
  
      return [preMessage, ...args];
    };
  
    console = {
      log: (...args) => globalThis.console.log(...enrich(...args)),
      debug: (...args) => globalThis.console.debug(...enrich(...args)),
      warn: (...args) => globalThis.console.warn(...enrich(...args)),
      error: (...args) => globalThis.console.error(...enrich(...args)),
      dir: (...args) => globalThis.console.dir(...args),
    };
  })();


  let errorHandler = ex => {
    console.error(ex);
  };
  const wrapErrorHandlerHandleError = (stack, ex, reportOnce, reported) => {
    if (reportOnce) {
      if (reported.includes(ex.message)) return;
      reported.push(ex.message);
    }
    appendErrorStack(stack, ex);
    if (errorHandler) errorHandler(ex);
  };
  const withErrorHandler = (callback, reportOnce, stack, reported) => {
    const callbackName = callback.name || 'anonymous';
    const container = {
      [callbackName]: (...args) => {
        try {
          return callback(...args);
        } catch (ex) {
          wrapErrorHandlerHandleError(stack, ex, reportOnce, reported);
        }
      }
    };
    return container[callbackName];
  };
  const withAsyncErrorHandler = (callback, reportOnce, stack, reported) => {
    const callbackName = callback.name || 'anonymous';
    const container = {
      [callbackName]: async (...args) => {
        try {
          return await callback(...args);
        } catch (ex) {
          wrapErrorHandlerHandleError(stack, ex, reportOnce, reported);
        }
      }
    };
    return container[callbackName];
  };
  const wrapErrorHandler = (callback, reportOnce = false) => (callback.constructor.name === 'AsyncFunction' ? withAsyncErrorHandler : withErrorHandler)(callback, reportOnce, new Error().stack, []);
  const eventListenerCallbacks = [];
  function on(elem, eventNames, callback, options, reportOnce = false) {
    try {
      const stack = new Error().stack;
      const callbacksName = `on_${eventNames.split(' ').join('_')}`;
      let reported = [];
      const namedCallbacks = {
        [callbacksName]: async (...args) => {
          try {
            await callback(...args);
          } catch (ex) {
            if (reportOnce) {
              if (reported.includes(ex.message)) return;
              reported.push(ex.message);
            }
            const e = args.length ? args[0] : {};
            const type = e.type === 'keydown' ? `${e.type} keyCode: ${e.keyCode}` : e.type;
            ex.message = `${ex.message} \nOn event: ${type}`;
            try {
              if (elem) {
                ex.message = `${ex.message} \nElem: ${elem.toString()} ${elem.nodeName || ''}#${elem.id || ''}.${elem.className || ''}`;
              }
            } catch (elemEx) {
              ex.details = {
                ...(ex.details || {}),
                elemEx
              };
            }
            try {
              if (e !== null && e !== void 0 && e.target) {
                ex.message = `${ex.message} \nTarget: ${e.target.toString()} ${e.target.nodeName || ''}#${e.target.id || ''}.${e.target.className || ''}`;
              }
            } catch (targetEx) {
              ex.details = {
                ...(ex.details || {}),
                targetEx
              };
            }
            try {
              if (e !== null && e !== void 0 && e.currentTarget) {
                ex.message = `${ex.message} \nCurrentTarget: ${e.currentTarget.toString()} ${e.currentTarget.nodeName || ''}#${e.currentTarget.id || ''}.${e.currentTarget.className || ''}`;
              }
            } catch (currentTargetEx) {
              ex.details = {
                ...(ex.details || {}),
                currentTargetEx
              };
            }
            ex.details = {
              ...(ex.details || {}),
              eventNames,
              options,
              reportOnce
            };
            appendErrorStack(stack, ex);
            if (errorHandler) errorHandler(ex);
          }
        }
      };
      const eventListenerCallback = namedCallbacks[callbacksName];
      const eventNamesList = eventNames.split(' ');
      const existingEventListenerCallback = eventListenerCallbacks.find(e => e.args.elem === elem && e.args.callback === callback && JSON.stringify(e.args.options) === JSON.stringify(options));
      for (const eventName of eventNamesList) {
        if (existingEventListenerCallback) {
          if (existingEventListenerCallback.args.eventNamesList.includes(eventName)) {
            continue;
          } else {
            existingEventListenerCallback.args.eventNamesList.push(eventName);
          }
        }
        elem.addEventListener(eventName, eventListenerCallback, options);
      }
      if (!existingEventListenerCallback) {
        eventListenerCallbacks.push({
          args: {
            elem,
            eventNamesList,
            callback,
            options
          },
          callback: eventListenerCallback
        });
      }
    } catch (ex) {
      ex.details = {
        eventNames,
        options,
        reportOnce
      };
      try {
        if (elem) {
          ex.message = `${ex.message} \nFor element: ${elem.toString()} ${elem.nodeName || ''}#${elem.id || ''}.${elem.className || ''}`;
        }
      } catch (elemEx) {
        ex.details = {
          ...(ex.details || {}),
          elemEx
        };
      }
      console.log('catched', ex);
      throw ex;
    }
  }
  globalThis.matchMedia('(color-gamut: p3)').matches ? 'display-p3' : 'srgb';
  globalThis.matchMedia('(color-gamut: rec2020)').matches ? 'rec2020' : globalThis.matchMedia('(color-gamut: p3)').matches ? 'display-p3' : 'srgb';
  const appendErrorStack = (stack, ex) => {
    try {
      var _ref;
      const stackToAppend = stack === null || stack === void 0 ? void 0 : stack.substring((stack === null || stack === void 0 ? void 0 : stack.indexOf('\n')) + 1);
      const stackToSearch = stackToAppend === null || stackToAppend === void 0 ? void 0 : stackToAppend.substring((stackToAppend === null || stackToAppend === void 0 ? void 0 : stackToAppend.indexOf('\n')) + 1);
      const alreadyContainsStack = ((_ref = (ex === null || ex === void 0 ? void 0 : ex.stack) || (ex === null || ex === void 0 ? void 0 : ex.message) || (ex === null || ex === void 0 ? void 0 : ex.toString())) === null || _ref === void 0 ? void 0 : _ref.indexOf(stackToSearch)) !== -1;
      if (!alreadyContainsStack) {
        ex.stack = `${ex.stack || ex.message || ex.toString()}\n${stackToAppend}`;
      }
    } catch (ex) {
      console.warn(ex);
    }
  };
  let warningElem;
  let warningElemText;
  const setWarning = text => {
    if (!warningElem) {
      const elem = document.createElement('div');
      elem.style.position = 'fixed';
      elem.style.zIndex = 999999;
      elem.style.left = 0;
      elem.style.bottom = 0;
      elem.style.padding = '5px 8px';
      elem.style.background = 'rgba(0,0,0,.99)';
      elem.style.color = '#fff';
      elem.style.border = '1px solid #f80';
      elem.style.borderTopRightRadius = '3px';
      elem.style.whiteSpace = 'pre-wrap';
      elem.style.fontSize = '15px';
      elem.style.lineHeight = '18px';
      elem.style.fontFamily = 'sans-serif';
      elem.style.overflowWrap = 'anywhere';
      elem.style.overflow = 'hidden';
      warningElem = elem;
      const closeButton = document.createElement('button');
      closeButton.style.position = 'absolute';
      closeButton.style.zIndex = 2;
      closeButton.style.right = 0;
      closeButton.style.top = 0;
      closeButton.style.border = 'none';
      closeButton.style.borderBottomLeftRadius = '3px';
      closeButton.style.padding = '0px 8px';
      closeButton.style.background = '#f80';
      closeButton.style.fontWeight = 'bold';
      closeButton.style.fontFamily = 'inherit';
      closeButton.style.lineHeight = '20px';
      closeButton.style.fontSize = '22px';
      closeButton.style.color = '#000';
      closeButton.style.cursor = 'pointer';
      closeButton.textContent = 'x';
      on(closeButton, 'click', () => setWarning(''));
      elem.appendChild(closeButton);
      const titleElem = document.createElement('div');
      titleElem.style.fontWeight = 'bold';
      titleElem.style.color = '#008cff';
      titleElem.style.fontSize = '22px';
      titleElem.style.lineHeight = '28px';
      titleElem.textContent = 'Bilibili 氛围灯\n';
      elem.appendChild(titleElem);
      const textElem = document.createElement('div');
      warningElemText = textElem;
      elem.appendChild(textElem);
    }
    const elem = warningElem;
    if (text) {
      warningElemText.textContent = text;
      document.documentElement.appendChild(elem);
    } else {
      warningElemText.textContent = '';
      elem.remove();
    }
  };

  var _globalThis$window3, _globalThis$window4, _globalThis$window4$p;
  const globalKey = '__bilibiliAmbientlightDiagnostics';
  const maxEntries = 400;
  const startedAt = performance.now();
  const state = globalThis[globalKey] || (globalThis[globalKey] = {
    entries: [],
    startedAt
  });
  const serialize = value => {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
        details: value.details
      };
    }
    if (typeof Element !== 'undefined' && value instanceof Element) {
      const rect = value.getBoundingClientRect();
      return {
        tag: value.tagName,
        id: value.id,
        className: typeof value.className === 'string' ? value.className : undefined,
        connected: value.isConnected,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  };
  const report = (step, details = undefined, level = 'info') => {
    var _globalThis$console, _globalThis$console2, _globalThis$window, _globalThis$window$po;
    const entry = {
      time: new Date().toISOString(),
      elapsed: Math.round((performance.now() - state.startedAt) * 10) / 10,
      step,
      details: serialize(details)
    };
    state.entries.push(entry);
    if (state.entries.length > maxEntries) state.entries.splice(0, 1);
    const logger = ((_globalThis$console = globalThis.console) === null || _globalThis$console === void 0 ? void 0 : _globalThis$console[level]) || ((_globalThis$console2 = globalThis.console) === null || _globalThis$console2 === void 0 ? void 0 : _globalThis$console2.log);
    logger === null || logger === void 0 ? void 0 : logger('Bilibili 氛围灯诊断', entry);
    (_globalThis$window = globalThis.window) === null || _globalThis$window === void 0 ? void 0 : (_globalThis$window$po = _globalThis$window.postMessage) === null || _globalThis$window$po === void 0 ? void 0 : _globalThis$window$po.call(_globalThis$window, {
      source: 'bilibili-ambientlight-diagnostics',
      payload: dump()
    }, '*');
    return entry;
  };
  const getEnvironment = () => {
    var _chrome, _chrome$runtime, _chrome2, _chrome2$runtime, _chrome2$runtime$getM;
    const player = document.querySelector('#bilibili-player');
    const container = player === null || player === void 0 ? void 0 : player.querySelector('.bpx-player-container');
    const video = player === null || player === void 0 ? void 0 : player.querySelector('.bpx-player-video-wrap video');
    const controlRight = player === null || player === void 0 ? void 0 : player.querySelector('.bpx-player-control-bottom-right');
    const nativeSettings = controlRight === null || controlRight === void 0 ? void 0 : controlRight.querySelector('.bpx-player-ctrl-setting');
    return {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio
      },
      player: !!player,
      playerContainer: !!container,
      dataScreen: (container === null || container === void 0 ? void 0 : container.getAttribute('data-screen')) ?? null,
      videoArea: !!(player !== null && player !== void 0 && player.querySelector('.bpx-player-video-area')),
      video: video ? {
        connected: video.isConnected,
        paused: video.paused,
        ended: video.ended,
        readyState: video.readyState,
        networkState: video.networkState,
        currentTime: video.currentTime,
        duration: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        crossOrigin: video.crossOrigin,
        sourceProtocol: (video.currentSrc || video.src).split(':')[0] || '',
        requestVideoFrameCallback: typeof video.requestVideoFrameCallback === 'function',
        getVideoPlaybackQuality: typeof video.getVideoPlaybackQuality === 'function'
      } : null,
      controlRight: !!controlRight,
      nativeSettingsButton: !!nativeSettings,
      extensionId: ((_chrome = chrome) === null || _chrome === void 0 ? void 0 : (_chrome$runtime = _chrome.runtime) === null || _chrome$runtime === void 0 ? void 0 : _chrome$runtime.id) ?? null,
      extensionVersion: ((_chrome2 = chrome) === null || _chrome2 === void 0 ? void 0 : (_chrome2$runtime = _chrome2.runtime) === null || _chrome2$runtime === void 0 ? void 0 : (_chrome2$runtime$getM = _chrome2$runtime.getManifest) === null || _chrome2$runtime$getM === void 0 ? void 0 : _chrome2$runtime$getM.call(_chrome2$runtime).version) ?? null
    };
  };
  const getElementInfo = elem => {
    if (!elem) return null;
    const style = getComputedStyle(elem);
    const rect = elem.getBoundingClientRect();
    return {
      tag: elem.tagName,
      id: elem.id,
      className: typeof elem.className === 'string' ? elem.className : undefined,
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      position: style.position,
      zIndex: style.zIndex,
      overflow: style.overflow,
      pointerEvents: style.pointerEvents,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  };
  const getPointHit = (x, y) => {
    const elem = document.elementFromPoint(x, y);
    return elem ? {
      tag: elem.tagName,
      id: elem.id,
      className: typeof elem.className === 'string' ? elem.className : undefined
    } : null;
  };
  const probeCanvasPixels = canvas => {
    if (!canvas) return null;
    const width = canvas.width;
    const height = canvas.height;
    const points = [[0, Math.max(0, Math.floor(height / 2))], [Math.max(0, width - 1), Math.max(0, Math.floor(height / 2))], [Math.max(0, Math.floor(width / 2)), 0], [Math.max(0, Math.floor(width / 2)), Math.max(0, height - 1)], [Math.max(0, Math.floor(width / 2)), Math.max(0, Math.floor(height / 2))]];
    try {
      const ctx = canvas.getContext('2d');
      return {
        size: {
          width,
          height
        },
        points: points.map(([x, y]) => {
          const data = ctx.getImageData(x, y, 1, 1).data;
          return {
            x,
            y,
            rgba: Array.from(data)
          };
        })
      };
    } catch (ex) {
      return {
        size: {
          width,
          height
        },
        error: {
          name: ex === null || ex === void 0 ? void 0 : ex.name,
          message: ex === null || ex === void 0 ? void 0 : ex.message
        }
      };
    }
  };
  const probe = () => {
    var _globalThis$window2, _projector$projectors, _projector$projectors2, _ambientlight$videoPl, _ambientlight$setting;
    const ambientlight = (_globalThis$window2 = globalThis.window) === null || _globalThis$window2 === void 0 ? void 0 : _globalThis$window2.ambientlight;
    const projector = ambientlight === null || ambientlight === void 0 ? void 0 : ambientlight.projector;
    const visibleCanvas = (projector === null || projector === void 0 ? void 0 : projector.blurCanvas) || (projector === null || projector === void 0 ? void 0 : projector.elem) || (projector === null || projector === void 0 ? void 0 : (_projector$projectors = projector.projectors) === null || _projector$projectors === void 0 ? void 0 : (_projector$projectors2 = _projector$projectors[0]) === null || _projector$projectors2 === void 0 ? void 0 : _projector$projectors2.elem);
    const container = ambientlight === null || ambientlight === void 0 ? void 0 : ambientlight.containerElem;
    const projectors = ambientlight === null || ambientlight === void 0 ? void 0 : ambientlight.projectorsElem;
    const containerRect = container === null || container === void 0 ? void 0 : container.getBoundingClientRect();
    const points = containerRect && containerRect.width && containerRect.height ? [[containerRect.left + 2, containerRect.top + containerRect.height / 2], [containerRect.right - 2, containerRect.top + containerRect.height / 2], [containerRect.left + containerRect.width / 2, containerRect.top + 2], [containerRect.left + containerRect.width / 2, containerRect.bottom - 2]].map(([x, y]) => ({
      x: Math.round(x),
      y: Math.round(y),
      hit: getPointHit(x, y)
    })) : [];
    return {
      ambientlight: !!ambientlight,
      view: ambientlight === null || ambientlight === void 0 ? void 0 : ambientlight.view,
      screen: ambientlight === null || ambientlight === void 0 ? void 0 : (_ambientlight$videoPl = ambientlight.videoPlayerElem) === null || _ambientlight$videoPl === void 0 ? void 0 : _ambientlight$videoPl.getAttribute('data-screen'),
      isHidden: ambientlight === null || ambientlight === void 0 ? void 0 : ambientlight.isHidden,
      settingsEnabled: ambientlight === null || ambientlight === void 0 ? void 0 : (_ambientlight$setting = ambientlight.settings) === null || _ambientlight$setting === void 0 ? void 0 : _ambientlight$setting.enabled,
      webGL: !!projector,
      getImageDataAllowed: ambientlight === null || ambientlight === void 0 ? void 0 : ambientlight.getImageDataAllowed,
      videoOffset: ambientlight === null || ambientlight === void 0 ? void 0 : ambientlight.videoOffset,
      projectorSize: ambientlight === null || ambientlight === void 0 ? void 0 : ambientlight.p,
      container: getElementInfo(container),
      projectors: getElementInfo(projectors),
      visibleCanvas: getElementInfo(visibleCanvas),
      canvasPixels: probeCanvasPixels(visibleCanvas),
      topHitsAtEdges: points
    };
  };
  const dump = () => ({
    environment: getEnvironment(),
    probe: probe(),
    entries: state.entries
  });
  const copy = async () => {
    const text = JSON.stringify(dump(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      report('diagnostics-copied', {
        length: text.length
      });
      return {
        ok: true,
        text
      };
    } catch (ex) {
      var _globalThis$console3, _globalThis$console3$;
      report('diagnostics-copy-failed', ex, 'error');
      (_globalThis$console3 = globalThis.console) === null || _globalThis$console3 === void 0 ? void 0 : (_globalThis$console3$ = _globalThis$console3.info) === null || _globalThis$console3$ === void 0 ? void 0 : _globalThis$console3$.call(_globalThis$console3, text);
      return {
        ok: false,
        text,
        error: ex
      };
    }
  };
  globalThis[globalKey].report = report;
  globalThis[globalKey].dump = dump;
  globalThis[globalKey].copy = copy;
  globalThis[globalKey].getEnvironment = getEnvironment;
  globalThis[globalKey].probe = probe;
  (_globalThis$window3 = globalThis.window) === null || _globalThis$window3 === void 0 ? void 0 : _globalThis$window3.addEventListener('message', event => {
    var _event$data;
    if (event.source !== globalThis.window) return;
    if (((_event$data = event.data) === null || _event$data === void 0 ? void 0 : _event$data.source) !== 'bilibili-ambientlight-diagnostics-request') return;
    globalThis.window.postMessage({
      source: 'bilibili-ambientlight-diagnostics-response',
      requestId: event.data.requestId,
      payload: dump()
    }, '*');
  });
  (_globalThis$window4 = globalThis.window) === null || _globalThis$window4 === void 0 ? void 0 : (_globalThis$window4$p = _globalThis$window4.postMessage) === null || _globalThis$window4$p === void 0 ? void 0 : _globalThis$window4$p.call(_globalThis$window4, {
    source: 'bilibili-ambientlight-diagnostics',
    payload: dump()
  }, '*');

  report('content-script-loaded', getEnvironment());
  const setResourceWarning = (detail = '') => {
    report('resource-warning', {
      detail
    }, 'error');
    setWarning(`Bilibili 氛围灯资源加载失败。\n请刷新网页后重试。${detail ? `\n\n${detail}` : ''}`);
  };
  const waitForElement = (selector, timeout = 15000) => new Promise((resolve, reject) => {
    if (!document.documentElement) {
      const rootObserver = new MutationObserver(() => {
        if (!document.documentElement) return;
        rootObserver.disconnect();
        waitForElement(selector, timeout).then(resolve, reject);
      });
      rootObserver.observe(document, {
        childList: true
      });
      return;
    }
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const elem = document.querySelector(selector);
      if (!elem) return;
      observer.disconnect();
      clearTimeout(timeoutId);
      resolve(elem);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    const timeoutId = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`等待元素超时：${selector}`));
    }, timeout);
  });
  wrapErrorHandler(async function loadBilibiliAmbientlight() {
    var _chrome, _chrome$runtime;
    report('load-start', getEnvironment());
    if (!((_chrome = chrome) !== null && _chrome !== void 0 && (_chrome$runtime = _chrome.runtime) !== null && _chrome$runtime !== void 0 && _chrome$runtime.id)) {
      setResourceWarning('扩展上下文已失效。');
      return;
    }
    const styleUrl = chrome.runtime.getURL('styles/content.css');
    const scriptUrl = chrome.runtime.getURL('scripts/content-main.js');
    report('runtime-urls-resolved', {
      styleUrl,
      scriptUrl
    });
    await waitForElement('head');
    report('head-ready');
    if (!document.head.querySelector(`link[href="${styleUrl}"]`)) {
      await new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = styleUrl;
        link.addEventListener('load', resolve, {
          once: true
        });
        link.addEventListener('error', () => reject(new Error('样式加载失败')), {
          once: true
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
  })().catch(ex => {
    report('load-failed', ex, 'error');
    console.error(ex);
    setResourceWarning(ex === null || ex === void 0 ? void 0 : ex.message);
  });

})();
