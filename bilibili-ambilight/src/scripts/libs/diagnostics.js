const globalKey = '__bilibiliAmbientlightDiagnostics';
const maxEntries = 400;
const startedAt = performance.now();

const state =
  globalThis[globalKey] ||
  (globalThis[globalKey] = {
    entries: [],
    startedAt,
  });

const serialize = (value) => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      details: value.details,
    };
  }

  if (typeof Element !== 'undefined' && value instanceof Element) {
    const rect = value.getBoundingClientRect();
    return {
      tag: value.tagName,
      id: value.id,
      className:
        typeof value.className === 'string' ? value.className : undefined,
      connected: value.isConnected,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
};

export const report = (step, details = undefined, level = 'info') => {
  const entry = {
    time: new Date().toISOString(),
    elapsed: Math.round((performance.now() - state.startedAt) * 10) / 10,
    step,
    details: serialize(details),
  };

  state.entries.push(entry);
  if (state.entries.length > maxEntries) state.entries.splice(0, 1);

  const logger = globalThis.console?.[level] || globalThis.console?.log;
  logger?.('Bilibili 氛围灯诊断', entry);
  globalThis.window?.postMessage?.(
    {
      source: 'bilibili-ambientlight-diagnostics',
      payload: dump(),
    },
    '*'
  );
  return entry;
};

export const getEnvironment = () => {
  const player = document.querySelector('#bilibili-player');
  const container = player?.querySelector('.bpx-player-container');
  const video = player?.querySelector('.bpx-player-video-wrap video');
  const controlRight = player?.querySelector(
    '.bpx-player-control-bottom-right'
  );
  const nativeSettings = controlRight?.querySelector('.bpx-player-ctrl-setting');

  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    player: !!player,
    playerContainer: !!container,
    dataScreen: container?.getAttribute('data-screen') ?? null,
    videoArea: !!player?.querySelector('.bpx-player-video-area'),
    video: video
      ? {
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
          requestVideoFrameCallback:
            typeof video.requestVideoFrameCallback === 'function',
          getVideoPlaybackQuality:
            typeof video.getVideoPlaybackQuality === 'function',
        }
      : null,
    controlRight: !!controlRight,
    nativeSettingsButton: !!nativeSettings,
    extensionId: chrome?.runtime?.id ?? null,
    extensionVersion: chrome?.runtime?.getManifest?.().version ?? null,
  };
};

const getElementInfo = (elem) => {
  if (!elem) return null;
  const style = getComputedStyle(elem);
  const rect = elem.getBoundingClientRect();
  return {
    tag: elem.tagName,
    id: elem.id,
    className:
      typeof elem.className === 'string' ? elem.className : undefined,
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
      height: Math.round(rect.height),
    },
  };
};

const getPointHit = (x, y) => {
  const elem = document.elementFromPoint(x, y);
  return elem
    ? {
        tag: elem.tagName,
        id: elem.id,
        className:
          typeof elem.className === 'string' ? elem.className : undefined,
      }
    : null;
};

const probeCanvasPixels = (canvas) => {
  if (!canvas) return null;
  const width = canvas.width;
  const height = canvas.height;
  const points = [
    [0, Math.max(0, Math.floor(height / 2))],
    [Math.max(0, width - 1), Math.max(0, Math.floor(height / 2))],
    [Math.max(0, Math.floor(width / 2)), 0],
    [Math.max(0, Math.floor(width / 2)), Math.max(0, height - 1)],
    [Math.max(0, Math.floor(width / 2)), Math.max(0, Math.floor(height / 2))],
  ];

  try {
    const ctx = canvas.getContext('2d');
    return {
      size: { width, height },
      points: points.map(([x, y]) => {
        const data = ctx.getImageData(x, y, 1, 1).data;
        return { x, y, rgba: Array.from(data) };
      }),
    };
  } catch (ex) {
    return {
      size: { width, height },
      error: {
        name: ex?.name,
        message: ex?.message,
      },
    };
  }
};

export const probe = () => {
  const ambientlight = globalThis.window?.ambientlight;
  const projector = ambientlight?.projector;
  const visibleCanvas =
    projector?.blurCanvas || projector?.elem || projector?.projectors?.[0]?.elem;
  const container = ambientlight?.containerElem;
  const projectors = ambientlight?.projectorsElem;
  const containerRect = container?.getBoundingClientRect();
  const points =
    containerRect && containerRect.width && containerRect.height
      ? [
          [containerRect.left + 2, containerRect.top + containerRect.height / 2],
          [containerRect.right - 2, containerRect.top + containerRect.height / 2],
          [containerRect.left + containerRect.width / 2, containerRect.top + 2],
          [containerRect.left + containerRect.width / 2, containerRect.bottom - 2],
        ].map(([x, y]) => ({ x: Math.round(x), y: Math.round(y), hit: getPointHit(x, y) }))
      : [];

  return {
    ambientlight: !!ambientlight,
    view: ambientlight?.view,
    screen: ambientlight?.videoPlayerElem?.getAttribute('data-screen'),
    isHidden: ambientlight?.isHidden,
    settingsEnabled: ambientlight?.settings?.enabled,
    webGL: !!projector,
    getImageDataAllowed: ambientlight?.getImageDataAllowed,
    videoOffset: ambientlight?.videoOffset,
    projectorSize: ambientlight?.p,
    container: getElementInfo(container),
    projectors: getElementInfo(projectors),
    visibleCanvas: getElementInfo(visibleCanvas),
    canvasPixels: probeCanvasPixels(visibleCanvas),
    topHitsAtEdges: points,
  };
};

export const dump = () => ({
  environment: getEnvironment(),
  probe: probe(),
  entries: state.entries,
});

export const copy = async () => {
  const text = JSON.stringify(dump(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    report('diagnostics-copied', { length: text.length });
    return { ok: true, text };
  } catch (ex) {
    report('diagnostics-copy-failed', ex, 'error');
    globalThis.console?.info?.(text);
    return { ok: false, text, error: ex };
  }
};

globalThis[globalKey].report = report;
globalThis[globalKey].dump = dump;
globalThis[globalKey].copy = copy;
globalThis[globalKey].getEnvironment = getEnvironment;
globalThis[globalKey].probe = probe;

globalThis.window?.addEventListener('message', (event) => {
  if (event.source !== globalThis.window) return;
  if (event.data?.source !== 'bilibili-ambientlight-diagnostics-request') return;

  globalThis.window.postMessage(
    {
      source: 'bilibili-ambientlight-diagnostics-response',
      requestId: event.data.requestId,
      payload: dump(),
    },
    '*'
  );
});

globalThis.window?.postMessage?.(
  {
    source: 'bilibili-ambientlight-diagnostics',
    payload: dump(),
  },
  '*'
);

export const installDiagnostics = () => globalThis[globalKey];
