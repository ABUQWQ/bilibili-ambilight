/* Bilibili ambient-light diagnostics probe.
 *
 * Click the floating button at the bottom-left of the watch page to copy a
 * JSON report of the page chrome (search bar, right rail, toolbar row, video
 * description, comment web component) plus the ambient-light layer state.
 * The same JSON is printed to the console as "[BILI-PROBE] {...}".
 */
(() => {
  if (window.__biliAmbientProbeInstalled) return;
  window.__biliAmbientProbeInstalled = true;

  const MAX_LEN = 200;
  const short = (value) =>
    typeof value === 'string' && value.length > MAX_LEN
      ? `${value.slice(0, MAX_LEN)}...`
      : value;

  const rectOf = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      inViewport:
        r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
    };
  };

  const cssOf = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      display: cs.display,
      position: cs.position,
      zIndex: cs.zIndex,
      bgColor: cs.backgroundColor,
      bgImage: short(cs.backgroundImage),
      color: cs.color,
      opacity: cs.opacity,
      overflow: cs.overflow,
      pointerEvents: cs.pointerEvents,
      backdropFilter: cs.backdropFilter,
      boxShadow: short(cs.boxShadow),
      borderRadius: cs.borderRadius,
    };
  };

  const pathOf = (el) => {
    const parts = [];
    let cur = el;
    let guard = 0;
    while (cur && cur.nodeType === 1 && guard < 7) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        part += `#${cur.id}`;
      } else if (typeof cur.className === 'string' && cur.className.trim()) {
        part += `.${cur.className.trim().split(/\s+/).slice(0, 3).join('.')}`;
      }
      parts.unshift(part);
      cur =
        cur.parentElement ||
        (cur.getRootNode() instanceof ShadowRoot ? cur.getRootNode().host : null);
      guard += 1;
    }
    return parts.join(' > ');
  };

  const entryOf = (el) => {
    if (!el) return null;
    return {
      path: pathOf(el),
      rect: rectOf(el),
      css: cssOf(el),
    };
  };

  const TARGETS = [
    ['header', '#biliMainHeader'],
    ['header-bar', '.bili-header'],
    ['header-inner', '.bili-header__bar'],
    ['search-wrap', '.center-search-container'],
    ['search-bar', '.center-search__bar'],
    ['search-form', '#nav-searchform'],
    ['search-input', '.nav-search-input'],
    ['player', '.bpx-player-container'],
    ['player-video-area', '.bpx-player-video-area'],
    ['player-video-perch', '.bpx-player-video-perch'],
    ['player-video-wrap', '.bpx-player-video-wrap'],
    ['player-control-wrap', '.bpx-player-control-wrap'],
    ['player-control-bottom', '.bpx-player-control-bottom'],
    ['player-danmaku-layer', '.bpx-player-render-dm-wrap'],
    ['player-row-danmaku', '.bpx-player-row-dm-wrap'],
    ['player-danmaku-collapse', '.bpx-player-collapse'],
    ['player-danmaku-header', '.bui-collapse-header'],
    ['player-sending-area', '.bpx-player-sending-area'],
    ['player-sending-bar', '.bpx-player-sending-bar'],
    ['player-video-inputbar', '.bpx-player-video-inputbar'],
    ['player-control-bottom', '.bpx-player-control-bottom'],
    ['main-wrap', '#mirror-vdcon'],
    ['left-container', '.left-container'],
    ['video-info', '.video-info-container'],
    ['video-toolbar', '.video-toolbar-container'],
    ['video-toolbar-left', '.video-toolbar-left'],
    ['video-toolbar-right', '.video-toolbar-right'],
    ['video-desc', '.video-desc-container'],
    ['video-tag', '.video-tag-container'],
    ['right-container', '.right-container'],
    ['right-rcmd-tab', '.rcmd-tab'],
    ['right-video-pod', '.video-pod'],
    ['right-card', '.video-page-card-small'],
    ['comment-app', '#commentapp'],
    ['comment-host', 'bili-comments'],
  ];

  const walkShadow = (host, depth) => {
    if (!host || !host.shadowRoot || depth > 3) return null;
    const children = [...host.shadowRoot.children].slice(0, 8);
    return {
      host: pathOf(host),
      children: children.map((child) => ({
        tag: child.tagName.toLowerCase(),
        id: child.id || undefined,
        cls:
          typeof child.className === 'string' && child.className.trim()
            ? child.className.trim().slice(0, 120)
            : undefined,
        rect: rectOf(child),
        css: cssOf(child),
      })),
      nested: children
        .filter((child) => child.shadowRoot)
        .map((child) => walkShadow(child, depth + 1))
        .filter(Boolean),
    };
  };

  const stackAt = (el, label) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
    const y = Math.min(Math.max(r.top + Math.min(r.height / 2, 120), 1), innerHeight - 1);
    return {
      label,
      x: Math.round(x),
      y: Math.round(y),
      stack: document.elementsFromPoint(x, y).slice(0, 8).map((node) => {
        const cs = getComputedStyle(node);
        return {
          path: pathOf(node),
          position: cs.position,
          zIndex: cs.zIndex,
          bgColor: cs.backgroundColor,
          bgImage: short(cs.backgroundImage),
          opacity: cs.opacity,
        };
      }),
    };
  };

  const collect = () => {
    const html = document.documentElement;
    const rootStyle = getComputedStyle(html);
    const report = {
      meta: {
        url: location.href,
        title: document.title,
        capturedAt: new Date().toISOString(),
        innerWidth,
        innerHeight,
        devicePixelRatio,
        scrollX: Math.round(scrollX),
        scrollY: Math.round(scrollY),
        htmlScrollWidth: html.scrollWidth,
        htmlClientWidth: html.clientWidth,
        bodyScrollWidth: document.body ? document.body.scrollWidth : null,
        htmlClass: html.className,
        bodyClass: document.body ? document.body.className : '',
        prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
        nightMode: html.classList.contains('night-mode'),
      },
      ambient: {
        enabledAttr: html.getAttribute('data-ambientlight-enabled'),
        rgb: rootStyle.getPropertyValue('--bili-ambient-rgb').trim(),
        tint: rootStyle.getPropertyValue('--bili-ambient-tint').trim(),
        tintSoft: rootStyle.getPropertyValue('--bili-ambient-tint-soft').trim(),
        darkTintAttr: html.getAttribute('data-bili-ambient-dark-tint'),
        themeAttr: html.getAttribute('data-bili-ambient-theme'),
        rootCount: document.querySelectorAll('div.ambientlight').length,
        buttonCount: document.querySelectorAll('.bpx-ambientlight-settings-button').length,
        container: entryOf(document.querySelector('.ambientlight__container')),
        pageGlow: entryOf(document.querySelector('.bili-ambientlight-page-glow')),
        pageGlowCanvas: entryOf(document.querySelector('.bili-ambientlight-page-glow__canvas')),
        projectors: entryOf(document.querySelector('.ambientlight__projectors')),
        player: entryOf(document.querySelector('.bpx-player-container')),
        video: entryOf(document.querySelector('.bpx-player-video-wrap video')),
        playerScreen:
          document.querySelector('.bpx-player-container')?.dataset?.screen || null,
        settingsMenu: entryOf(document.querySelector('.ytpa-ambientlight-settings-menu')),
      },
      targets: {},
      stacks: [],
      shadow: null,
    };

    for (const [name, selector] of TARGETS) {
      let nodes = [];
      try {
        nodes = [...document.querySelectorAll(selector)].slice(0, 2);
      } catch (error) {
        nodes = [];
      }
      report.targets[name] = {
        selector,
        count: (() => {
          try {
            return document.querySelectorAll(selector).length;
          } catch (error) {
            return 0;
          }
        })(),
        items: nodes.map((node) => ({
          rect: rectOf(node),
          css: cssOf(node),
          parents: (() => {
            const parents = [];
            let cur = node.parentElement;
            let guard = 0;
            while (cur && guard < 3) {
              parents.push({ path: pathOf(cur), css: cssOf(cur) });
              cur = cur.parentElement;
              guard += 1;
            }
            return parents;
          })(),
        })),
      };
    }

    for (const [label, selector] of [
      ['right-rail', '.right-container'],
      ['toolbar-row', '.video-toolbar-container'],
      ['description', '.video-desc-container'],
      ['comment-area', '#commentapp'],
      ['search-bar', '#nav-searchform'],
      ['danmaku-sending-bar', '.bpx-player-sending-bar'],
    ]) {
      const el = document.querySelector(selector);
      if (el) report.stacks.push(stackAt(el, label));
    }

    const commentHost = document.querySelector('bili-comments');
    report.shadow = walkShadow(commentHost, 0);

    const player = document.querySelector('.bpx-player-container');
    report.playerState = player
      ? {
          className: player.className,
          dataCtrlHidden: player.getAttribute('data-ctrl-hidden'),
          dataScreen: player.getAttribute('data-screen'),
          videoPerch: entryOf(document.querySelector('.bpx-player-video-perch')),
          videoWrap: entryOf(document.querySelector('.bpx-player-video-wrap')),
          controlWrap: entryOf(document.querySelector('.bpx-player-control-wrap')),
          controlBottom: entryOf(document.querySelector('.bpx-player-control-bottom')),
          danmakuLayer: entryOf(document.querySelector('.bpx-player-render-dm-wrap')),
          rowDanmaku: entryOf(document.querySelector('.bpx-player-row-dm-wrap')),
        }
      : null;
    return report;
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
      } catch (fallbackError) {
        return false;
      }
    }
  };

  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;left:16px;bottom:16px;z-index:2147483000;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .wrap { display:flex; align-items:center; gap:8px; font:13px/1.4 system-ui, sans-serif; }
      button {
        pointer-events:auto; cursor:pointer; border:0; border-radius:8px;
        padding:8px 12px; color:#fff; background:#fb7299;
        box-shadow:0 4px 14px rgba(0,0,0,.35); font:inherit;
      }
      button:hover { background:#fc8bab; }
      button[data-kind="attach"] { background:#3d7eff; }
      button[data-kind="attach"]:hover { background:#6094ff; }
      button:disabled { opacity:.55; cursor:progress; }
      .status {
        pointer-events:none; padding:6px 10px; border-radius:8px;
        background:rgba(20,20,24,.86); color:#fff; opacity:0;
        transition:opacity .2s ease; white-space:nowrap;
      }
      .status.show { opacity:1; }
    </style>
    <div class="wrap">
      <button type="button" data-kind="attach">截图并存盘（拖动整页）</button>
      <button type="button" data-kind="copy">只复制诊断 JSON</button>
      <span class="status"></span>
    </div>
  `;
  const attachButton = shadow.querySelector('button[data-kind="attach"]');
  const copyButton = shadow.querySelector('button[data-kind="copy"]');
  const status = shadow.querySelector('.status');

  const showStatus = (text, keep) => {
    status.textContent = text;
    status.classList.add('show');
    if (!keep) setTimeout(() => status.classList.remove('show'), 2600);
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const nextPaint = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

  const sendMessage = (message) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              ok: false,
              error: chrome.runtime.lastError.message,
            });
            return;
          }
          resolve(response || { ok: false, error: 'no response' });
        });
      } catch (error) {
        resolve({ ok: false, error: String(error && error.message) });
      }
    });

  /* Walk the page in viewport-sized steps and ask the service worker to grab
   * each frame. captureVisibleTab is rate limited to ~2/s, so the delay between
   * shots is deliberate. */
  const captureScroll = async () => {
    const root = document.documentElement;
    const total = Math.max(
      root.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
    const step = Math.round(innerHeight * 0.8) || 1;
    const startX = window.scrollX;
    const startY = window.scrollY;
    const positions = [];
    for (let y = 0; y < total - innerHeight * 0.5 && positions.length < 10; y += step) {
      positions.push(Math.round(y));
    }
    if (!positions.length) positions.push(0);

    const saved = [];
    for (let index = 0; index < positions.length; index += 1) {
      window.scrollTo(startX, positions[index]);
      await nextPaint();
      await sleep(650);
      showStatus(`截图中 ${index + 1}/${positions.length}...`, true);
      const response = await sendMessage({ type: 'capture', index });
      if (response.ok) saved.push({ file: response.file, via: response.via });
      else saved.push({ error: response.error });
    }

    window.scrollTo(startX, startY);
    await nextPaint();
    return saved;
  };

  let running = false;

  const run = async (work) => {
    if (running) return;
    running = true;
    attachButton.disabled = true;
    copyButton.disabled = true;
    try {
      await work();
    } catch (error) {
      console.error('[BILI-PROBE] failed', error);
      showStatus(`出错：${error.message}`);
    } finally {
      running = false;
      attachButton.disabled = false;
      copyButton.disabled = false;
    }
  };

  copyButton.addEventListener('click', () =>
    run(async () => {
      const report = collect();
      const json = JSON.stringify(report, null, 2);
      console.log('[BILI-PROBE]', json);
      const ok = await copyText(json);
      showStatus(ok ? '已复制，粘贴给 Codex 即可' : '复制失败，请从控制台复制');
    })
  );

  attachButton.addEventListener('click', () =>
    run(async () => {
      showStatus('正在采集诊断信息...', true);
      const report = collect();
      const jsonResponse = await sendMessage({
        type: 'save-json',
        name: 'report',
        json: JSON.stringify(report, null, 2),
      });

      const saved = await captureScroll();
      const failures = saved.filter((item) => item.error);
      const okCount = saved.length - failures.length;
      const transports = new Set(
        saved.filter((item) => item.via).map((item) => item.via)
      );
      const where = transports.has('loopback')
        ? '已存到项目 _tools/probe-captures'
        : transports.has('downloads')
          ? '已存到 下载/bili-probe'
          : '未能存盘';
      const jsonState = jsonResponse.ok
        ? jsonResponse.file
        : `失败 ${jsonResponse.error}`;

      showStatus(
        `诊断 ${jsonState}；截图 ${okCount}/${saved.length} 张；${where}`,
        true
      );
      if (failures.length) {
        console.warn('[BILI-PROBE] capture failures', failures);
      }
      console.log('[BILI-PROBE] saved', { json: jsonResponse, shots: saved });
    })
  );

  const mount = () => {
    if (!document.body) return;
    document.body.appendChild(host);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
