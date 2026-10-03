# Bilibili player selector audit (2026-10-02)

## Verdict

Every selector the Bilibili port depends on resolves on a live video page in
normal, mini, and wide player states, and all of them still resolve after an
in-page (SPA) navigation to a second video. One structural gap remains:
route-change rebinding only refreshes the `<video>` element, not the player
shell references.

## Evidence

- Live in-app browser, logged-in session, viewport 1280x720, dpr 1.
- Normal playback: `https://www.bilibili.com/video/BV1Q7aq6MEpc/`, container
  732x458, `data-screen="normal"`, video playing (`readyState=4`).
- SPA click-through to `https://www.bilibili.com/video/BV1eWev6VE3e/`, then
  mini mode (scrollY 1440, `data-screen="mini"`, container 320x180) and wide
  mode (`data-screen="wide"`, container 987x598). All required selectors stayed
  at exactly one match in every state.
- Native control bar: `.bpx-player-control-bottom-right` is `display:flex`
  with nine `.bpx-player-ctrl-btn` children; `.bpx-player-ctrl-setting` is the
  fifth child and is visible. Clicking it opens
  `.bpx-player-ctrl-setting-menu` (132x140, plus left/right panes).
- Existing local artifacts `_tools/parity.json` and `_tools/harness.json`
  (2026-10-02) additionally show the extension's own
  `.bpx-ambientlight-settings-button` mounting and its settings menu opening.
- Headless Chrome without H.264/AAC codec support gets a different page:
  `#bilibili-player` contains only `.bpx-legacy-browser-container`, and none of
  the `bpx-player-*` selectors exist. `_tools/baseline.json` captured exactly
  this at 16:51. The headed and CDP verification scripts avoid it by shimming
  `MediaSource.isTypeSupported()` / `canPlayType()` to report H.264 support.
- `bilibili-ambilight/dist` and the loadable `ambilight-bilibili` copy are
  byte-identical for `scripts/content.js`, `scripts/content-main.js`,
  `styles/content.css`, and `manifest.json`, so this audit applies to the
  build the probes load.

## Selector inventory

| Selector | Source usage | Need | Live result |
| --- | --- | --- | --- |
| `#bilibili-player` | content-main.js:22, diagnostics.js:70, generic.js:465, errors/dom.js:101 | required root | 1 match |
| `#bilibili-player .bpx-player-container` | content.js:82 | init gate | 1 match (normal/mini/wide) |
| `.bpx-player-container` | content-main.js:23, ambientlight.js:205 | required shell | 1 match |
| `.bpx-player-primary-area` | ambientlight.js:220 | optional layout | 1 match |
| `.bpx-player-video-area` | content-main.js:24, ambientlight.js:223 | required | 1 match |
| `.bpx-player-video-wrap` | content-main.js:25, errors/dom.js:101 | required | 1 match |
| `.bpx-player-video-wrap video` | content-main.js:25 and :126 | required video | 1 match, playing |
| `.bpx-player-control-bottom-right` | content.js:84, ambientlight.js:226, settings.js:955 | required mount point | 1 match, flex |
| `.bpx-player-ctrl-setting` | settings.js:955, diagnostics.js:76 | optional insert anchor | 1 match, visible |
| `.bpx-player-video-poster` | ambientlight.js:198 | optional | 1 match, `display:none` during playback; code null-checks |
| `.bpx-player-ctrl-quality-menu-item.bpx-state-active .bpx-player-ctrl-quality-text` | ambientlight.js:3953 | optional HDR fallback | 1 match, hidden 0x0 during playback; text read is null-safe |

Observed nesting:

```
#bilibili-player
  > .bpx-docker-major
    > .bpx-player-container
      > .bpx-player-primary-area
        > .bpx-player-video-area
          > .bpx-player-video-perch
            > .bpx-player-video-wrap
              > video
```

Control bar nesting:

```
.bpx-player-video-area
  > .bpx-player-control-wrap
    > .bpx-player-control-entity
      > .bpx-player-control-bottom
        > .bpx-player-control-bottom-right
```

Observed fallback variant for unsupported-codec browsers:

```
#bilibili-player
  > .bpx-legacy-browser-container
    > .bpx-legacy-browser-image
    > .bpx-legacy-browser-text
```

## Findings

1. Medium: SPA route rebinding refreshes only the video element.
   `content-main.js` computes all four parts in `getPlayerParts()`, but when
   `parts.videoElem !== ambientlight.videoElem` it calls only
   `ambientlight.initVideoElem(parts.videoElem)`. `initVideoElem`
   (ambientlight.js:245) swaps `videoElem` and its observers, while
   `videoPlayerElem`, `videoContainerElem`, `settingsMenuBtnParent`, the
   container observers, and the injected settings button keep their old
   references. Bilibili appears to reuse the player shell across normal
   recommendation clicks, but a shell rebuild would leave the extension
   attached to a detached tree until reload.
   Suggested fix: when the video element changes, also compare
   `parts.videoPlayerElem`/`parts.controlRightElem` with the stored references
   and re-bind the shell (or tear down and re-create `Ambientlight`); at
   minimum, re-point the three shell fields and re-insert the menu button
   before the native settings button.

2. Low: no fallback selectors. Every hook is a single `bpx-` class. The prefix
   has been stable, but a rename fails closed with the 20s
   "wait for Bilibili player" timeout and a visible warning. Cheap fallbacks:
   container from `video.closest('.bpx-player-container, .bpx-player-primary-area')`;
   video from `container.querySelector('video')`; control bar from
   `.bpx-player-control-bottom-right, .bpx-player-control-bottom`; native
   anchor from `.bpx-player-ctrl-setting, [aria-label*="设置"]`.

3. Low: legacy-browser fallback is indistinguishable from a selector rename.
   When Bilibili decides the browser cannot play its codecs, it replaces the
   whole player with `.bpx-legacy-browser-container`. The port then waits the
   full 20s and reports "等待 Bilibili 播放器超时", which points at selectors
   even though the real cause is codec/feature support. Suggested fix: in
   `waitForPlayer` (or `content.js` before `waitForElement`), check for
   `.bpx-legacy-browser-container` and fail fast with a targeted warning.
   `_tools/selectors_probe.py` now injects the same codec shim as the headed
   verifier so the normal player is served in headless runs.

4. Info: URL gating. `manifest.json` matches only
   `https://www.bilibili.com/video/*`, and `isBilibiliVideoPage()` accepts only
   `/video/BV...` or `/video/av...`. Bangumi (`/bangumi/play/`), live,
   `m.bilibili.com`, and `b23.tv` redirects are out of scope by design. If
   bangumi support is ever wanted, the regex and manifest must widen together,
   and the `bpx-player` selectors are not guaranteed there.

5. Info: `.bpx-player-video-poster` exists but is `display:none` during
   playback; the port treats it as optional and null-checks it, so this is not
   a break.

## Reusable probe

`_tools/selectors_probe.py` runs the same audit headlessly, including the SPA
navigation identity check, and writes `_tools/selectors.json`. Playwright needs
to launch Chrome outside the sandbox, so run it with the same unsandboxed
wrapper used for `_tools/probe.py`.
