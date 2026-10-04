# Bilibili Ambilight (Chrome MV3) - Project Handoff

Written 2026-10-03 for the next AI agent. Everything below was verified against
the files in this workspace at that time.

---

## 0. TL;DR

This workspace contains a Chinese-localised port of the YouTube extension
`WesselKroos/youtube-ambilight` to Bilibili, plus a purpose-built diagnostic
probe so the user never has to paste screenshots manually.

| Item | Path | Role |
| --- | --- | --- |
| Product output | `ambilight-bilibili/` | Local load-unpacked folder only. Not committed. |
| Product source | repository root | Rollup + Sass source. This is what GitHub `main` contains. |
| YouTube output | `ambilight/` | Earlier YouTube-version build, untouched |
| Upstream reference | `youtube-ambilight/` | Upstream `develop` @ `18d17188e5562e5ee913f005192d30c9a60be078`; `.git`, `node_modules`, `assets` removed |
| Dev probe | `_tools/bili-probe/` | Load-unpacked helper extension: scrolls the page, screenshots it, posts results to a local sink |
| Probe sink | `_tools/probe_server.py` | Loopback HTTP receiver, writes to `_tools/probe-captures/` |
| Probe self-test | `_tools/probe_selftest.py` | Playwright test that proves the probe pipeline works |
| Selector audit | `_tools/selector_audit.md` | Live-DOM findings for the Bilibili player |

Git is initialized on `main`. Do not commit `.env` (Sentry token), `node_modules/`, or `_tools/probe-captures/`.

The user-accepted restore point is tag `known-good-80` (`ab04943`, 2026-10-04). They judged that build at about 80% of the original YouTube extension. To put the loadable extension and its source back to that point without touching the rest of the workspace:

```powershell
git checkout known-good-80 -- bilibili-ambilight ambilight-bilibili
```

Then reload the unpacked extension and hard-refresh the video page. See section 7.

---

## 1. Build

### Do NOT use `npm run build`

It fails in this sandbox with `ERROR: spawn EPERM` because `npm-run-all`
spawns child processes. Call the binaries directly instead:

```powershell
cd C:\Users\hh121\Desktop\aipro\yt32

.\node_modules\.bin\rollup.cmd -c
.\node_modules\.bin\sass.cmd --no-source-map src/styles/content.scss dist/styles/content.css
node manifest-copy.js
.\node_modules\.bin\copyfiles.cmd -u 1 src/options.html dist
.\node_modules\.bin\copyfiles.cmd -u 2 src/images/* dist/images
.\node_modules\.bin\copyfiles.cmd -u 2 src/styles/options.css dist/styles
```

### Publish to the loadable folder

```powershell
Copy-Item -Path .\dist\* -Destination .\ambilight-bilibili\ -Recurse -Force
```

Always confirm the two trees are byte-identical afterwards (the user loads
`ambilight-bilibili`, not `dist`):

```powershell
$a = Get-ChildItem .\dist -Recurse -File | Sort-Object FullName | ForEach-Object { $_.FullName.Substring((Resolve-Path .\dist).Path.Length) + ' ' + (Get-FileHash $_.FullName -Algorithm MD5).Hash }
$b = Get-ChildItem .\ambilight-bilibili -Recurse -File | Sort-Object FullName | ForEach-Object { $_.FullName.Substring((Resolve-Path .\ambilight-bilibili).Path.Length) + ' ' + (Get-FileHash $_.FullName -Algorithm MD5).Hash }
Compare-Object $a $b
```

### Syntax gate

```powershell
Get-ChildItem .\ambilight-bilibili\scripts -Filter *.js | ForEach-Object { node --check $_.FullName }
```

Note: the project's own ESLint plugin runs inside Rollup, so a successful
`rollup.cmd -c` already covers lint for the four entry bundles.

---

## 2. How the port differs from upstream

Files that exist only in the Bilibili port:

- `src/scripts/diagnostics-page.js` - MAIN-world content script that exposes
  `window.__bilibiliAmbientlightDiagnostics` for the probe.
- `src/scripts/libs/diagnostics.js` - ring buffer + `report(step, details)` used
  across the port, plus clipboard export.
- `src/styles/_bilibili-parity.scss` - **the main integration stylesheet.**
  Imported at the bottom of `content.scss`. Almost every Bilibili-specific CSS
  decision lives here; read it first.

Files heavily modified from upstream:

| File | Change |
| --- | --- |
| `src/manifest.json` | Bilibili match patterns, no Sentry, only `storage` permission |
| `src/scripts/content.js` | Waits for `#bilibili-player .bpx-player-container` and `.bpx-player-control-bottom-right` before importing the main bundle |
| `src/scripts/content-main.js` | Site adapter: finds player parts, injects the settings button into the native control bar, drives SPA re-init via MutationObserver |
| `src/scripts/libs/ambientlight.js` | Bilibili page-glow layer, `getView()` mapping from `data-screen`, Bilibili geometry publishing, glow tint sampling |
| `src/scripts/libs/settings.js` | Presets, collapsible advanced section, close button, right-click-to-reset |
| `src/scripts/libs/settings-config.js` | Chinese labels, `advanced: true` grouping (59 entries) |
| `src/scripts/libs/errors/sentry-reporter.js` | Stubbed out (16 lines vs 487 upstream) |
| `src/options.html` | Reduced to the Bilibili popup shell |

### Bilibili DOM contract

The port depends on these selectors. They were all confirmed to resolve on a
live page (see `_tools/selector_audit.md`):

```
#bilibili-player
.bpx-player-container            data-screen = normal|wide|web|full|mini|pip
.bpx-player-video-area
.bpx-player-video-wrap video
.bpx-player-render-dm-wrap       danmaku layer (later sibling of video-perch)
.bpx-player-control-bottom-right
.bpx-player-ctrl-setting         native settings button
.bpx-player-sending-bar
.bpx-player-video-inputbar
.bui-collapse-header             "弹幕列表" header
#nav-searchform
.right-container  .rcmd-tab  .video-pod
.video-info-container  .video-toolbar-container  .video-desc-container
#commentapp > bili-comments      shadow DOM (Lit)
```

`getView()` maps `normal -> VIEW_SMALL`, `wide -> VIEW_THEATER`,
`web|full -> VIEW_FULLSCREEN`.

---

## 3. Pitfalls (read this section twice)

### 3.1 Do not touch the player's internal stacking order

This was the single most damaging change and cost several rounds of debugging.
An earlier version of `_bilibili-parity.scss` contained:

```scss
.bpx-player-video-wrap { position: relative; z-index: 2; }
.bpx-player-control-wrap { position: relative; z-index: 4; }
```

Consequences, both reported by the user as separate bugs:

- **Danmaku disappeared.** Bilibili paints `.bpx-player-render-dm-wrap` as a
  *later sibling* of `.bpx-player-video-perch` and relies on plain document
  order (`z-index: auto`). Giving the video wrap a positive z-index paints the
  video over the danmaku.
- **The control bar vanished / moved below the player.** Native CSS is
  `.bpx-player-control-wrap { position: absolute; bottom: 0; z-index: 75 }`.
  Forcing `position: relative` drags the bar out of the video area; measured
  rect moved from y 740-765 to y 785-820, i.e. under the danmaku input row.

The ambient canvas sits behind `#app` (`.ambientlight__container` is
`z-index: -1`), so no z-index hack is needed at all. Those rules were deleted.

### 3.2 Per-element gradients create hard-edged rectangles

A gradient whose stops are expressed in `vh` is wrong for short blocks. The
old rule applied the same `0 -> 40vh -> 96vh` gradient to
`.video-info-container` (108 px tall) and `.video-toolbar-container` (67 px
tall); each block could only ever display the first stop, so it rendered as a
solid rectangle with four visible edges. The user circled exactly those edges.

The counterpart mistake is percentage-based fading on a very tall block:
`#commentapp` measured up to 10 725 px, so `55%` meant "tint the whole page".

Rule of thumb for this project: **the only light source is the single blurred
canvas.** Page surfaces stay transparent; do not paint per-block tints.

### 3.3 Glow-layer geometry

The glow element is a box, so its own edges can be visible.

- A `100vh` box with a radial mask still had ~79% alpha where the element
  ended, producing a hard horizontal cut across the comment list.
- Current design: `height: var(--bili-glow-height)` (= `165vh`), radial
  gradient `125% 120% at 50% 18%` with alpha reaching 0 at 62%. Math: centre is
  at 29.7vh, the bottom edge is 135.3vh away, the vertical radius is 198vh, so
  the bottom edge sits at 68 % of the gradient - past the point where alpha is
  already 0.
- It is positioned `absolute` (not `fixed`) so it scrolls away with the first
  screen instead of following the viewport down the comment list.

### 3.3b The parent container clips the glow (this caused the "cut off" band)

Even with a correct mask, a **straight horizontal line** appeared across the
comments at exactly document `y = 100vh`. The mask was not at fault: the parent
`body > .ambientlight .ambientlight__container` is `height: 100vh` with
`overflow: clip !important`, so a 165vh glow was being sliced by its own
container.

Verification trick that found it: take the probe screenshot index, multiply by
`0.8 * innerHeight` to get its scroll offset, add the pixel row of the visible
edge, and compare with `100vh`. It matched within a few pixels, which pointed
at a container edge rather than a gradient stop.

Fix: both boxes read `--bili-glow-height` (declared once on
`html[data-ambientlight-enabled]`), and the container is stretched to match
**only** when not in `web`/`full` screen. Never hard-code one of the two
numbers again.

### 3.3c The probe sink can die silently

`_tools/probe_server.py` is a plain foreground process. If it stops, the probe
extension still scrolls and still calls `captureVisibleTab`, but both
transports end up empty: the loopback POST fails and `chrome.downloads` also
no-ops inside an automated profile. The button status now prints which
transport was used ("已存到项目 _tools/probe-captures" vs "已存到
下载/bili-probe") - read that line before assuming captures exist.

Always `Invoke-WebRequest http://127.0.0.1:8799/ping` immediately before asking
the user to click.

### 3.4 `#commentapp` is a shadow DOM

`bili-comments` is a Lit web component with `template shadowrootmode="open"`.
Plain CSS cannot reach inside it. The working lever is Bilibili's own design
tokens, which are inherited into the shadow tree - override them on the host:

```scss
#commentapp, bili-comments {
  --bg1: transparent;
  --bg2: transparent;
  --graph_bg_regular: transparent;
}
```

Individual comment surfaces inside the shadow root may still paint their own
background; if the user reports opaque comment cards, that is the place to look.

### 3.5 Horizontal scroll needs `overflow-x: clip`, not `hidden`

The projector canvases intentionally overflow so their blur can spread, which
created ~50 px of horizontally scrollable empty space on the right. Using
`overflow-x: hidden` would create a scroll container and break
`position: sticky` on `.left-container` / `.right-container`. `clip` does not.

### 3.6 Chrome 137+ ignores `--load-extension`

Installed Chrome 154 and Edge 154 silently ignore the flag, so the extension
never loads and `context.service_workers` only shows an unrelated built-in
extension. Use Playwright's bundled Chromium 131 instead:

```
C:\Users\hh121\AppData\Local\ms-playwright\chromium-1148\chrome-win\chrome.exe
```

With it, `--disable-extensions-except=<abs>\ambilight-bilibili --load-extension=<abs>\ambilight-bilibili`
works and the service worker appears as
`chrome-extension://onhljnacedmedmlecijbcgfgepafeial/scripts/background.js`.

### 3.7 Bilibili serves a "browser not supported" fallback page

Under automation the page can render
`.bpx-legacy-browser-container` ("您当前的浏览器不支持 HTML5 播放器") with no
`<video>` at all. Result: `.bpx-player-container` is absent, so the extension
legitimately does nothing. This wasted a lot of time because it looks exactly
like "the extension failed to inject".

Workaround, injected before navigation:

```python
page.add_init_script("""
(() => {
  const want = t => /av01|vp9|vp09|opus|vorbis/i.test(String(t||''));
  const deny = t => /avc1|avc3|h264|mp4a|aac|hev1|hvc1/i.test(String(t||''));
  try { const o = MediaSource.isTypeSupported.bind(MediaSource);
        MediaSource.isTypeSupported = t => want(t) ? true : (deny(t) ? false : o(t)); } catch (e) {}
  try { const o = HTMLMediaElement.prototype.canPlayType;
        HTMLMediaElement.prototype.canPlayType = function (t) {
          if (want(t)) return 'probably';
          if (deny(t)) return '';
          return o.call(this, t); }; } catch (e) {}
})();
""")
```

Also set `--disable-blink-features=AutomationControlled` and a desktop UA.

### 3.8 False-positive verification

Early "verified" JSON was produced by injecting `content.css` and
`content-main.js` into the page with `page.add_script_tag()` - a shim, not the
real extension. It reported green while real `--load-extension` was injecting
nothing. **Always require a `chrome-extension://<id>/...` service worker plus
extension-owned resource requests in `performance.getEntriesByType('resource')`
before trusting a pass.**

### 3.9 Screenshots can predate the fix

The user's screenshots are timestamped. Compare `image.LastWriteTime` against
the mtime of `dist/styles/content.css` before concluding a fix did not work -
several rounds were spent chasing bugs that had already been fixed in a build
the user had not reloaded yet.

### 3.10 Sandbox restrictions in this environment

These are denied and must not be relied on:

- `Get-CimInstance Win32_Process`, `Get-WmiObject`, `tasklist /FI`
- `Get-NetTCPConnection ... .OwningProcess`

Working substitutes:

```powershell
netstat -ano | Select-String ":8799\s"
Get-Process -Id <pid> | Select-Object Id,ProcessName,StartTime,Path
```

The Playwright/Python process also needs an escalated `exec_command` run
spawned through `pwsh.exe`, otherwise `CreateFile` fails with
`PermissionError: [WinError 5]`.

---

## 4. Verification probe (the workflow the user asked for)

The user should never have to paste screenshots. The probe extension does the
scrolling and uploading itself.

### Start the sink (must be listening before the user clicks)

```powershell
Start-Process -FilePath 'D:\E\rj\Python3.11.4\python.exe' `
  -ArgumentList '.\_tools\probe_server.py' `
  -WorkingDirectory 'C:\Users\hh121\Desktop\aipro\yt32' -WindowStyle Hidden
Invoke-WebRequest -Uri 'http://127.0.0.1:8799/ping' -UseBasicParsing
```

Files land in `_tools/probe-captures/` as `report.json` plus
`scroll-NN.png`. The agent can read them directly; the user only has to say
"done".

### User-side steps

1. `chrome://extensions` -> Load unpacked -> `_tools\bili-probe`
2. Open any `bilibili.com/video/BV...` page
3. Click the blue "截图并存盘（拖动整页）" button in the bottom-left

### Why a loopback sink instead of `chrome.downloads`

`chrome.downloads.download()` silently no-ops inside automated Chrome profiles
(the call resolves but no file appears anywhere), and the agent sandbox cannot
read `C:\Users\hh121\Downloads` anyway. The probe therefore POSTs to
`http://127.0.0.1:8799/upload` first and falls back to a real download if the
sink is down. Transport used is reported back in the button status.

`chrome.tabs.captureVisibleTab()` requires `"<all_urls>"` or `activeTab` in
`host_permissions`; a Bilibili-only host permission fails with
`Either the '<all_urls>' or 'activeTab' permission is required.` The probe
extension therefore requests `<all_urls>`. **This is a development tool and
must never be shipped to the store as-is.**

### Prove the pipeline still works

```powershell
pwsh.exe -Command "& 'D:\E\rj\Python3.11.4\python.exe' .\_tools\probe_selftest.py 2>&1 | Select-Object -Last 40"
```

Expected tail: `LOOPBACK_CAPTURES: [["report.json", ...], ["scroll-00.png", ...]]`
with 4/4 screenshots.

---

## 5. Current status and open items

Confirmed by the user on 2026-10-04 (`known-good-80`):

- The page wash is acceptable and roughly 80% of the original YouTube extension.
- Player, danmaku, and the control bar still render. Horizontal scroll stays gone.
- The hard horizon across the comments and the right rail is gone in that build.

Still open:

- Web-fullscreen / native-fullscreen behaviour since the z-index revert.
- Opaque surfaces inside the `bili-comments` shadow tree.
- The remaining 20% versus upstream was not itemized. Do not restyle from memory.

Section 3.3's 165vh radial mask is historical. The accepted build no longer uses it. See section 7.

---

## 6. Files deleted during cleanup (2026-10-03)

For the record, ~825 MB was removed and is regenerable:

- 12 `_pwprofile*` Chrome test profiles, `_verify-headed-cdp`,
  `_verify-headed-hv`, `.codex-verify`, `_probe_downloads`
- `youtube-ambilight/{node_modules,.git,assets,dist}`
- `bilibili-ambilight/{.npm-cache,assets}`
- Stale one-off scripts and screenshots in `_tools/` (`harness.py`,
  `parity_probe.py`, `probe.py`, `cdp_verify.py`, `ui_smoke.py`,
  `interaction_probe.py`, `real_verify.py`, `selectors_probe.py`,
  `fixprobe.py`, `headed_verify.py`, `patch.diff`, several `*.png`/`*.json`
  evidence dumps)
- Root `package.json` (an empty `npm init` stub)

Kept on purpose: `_tools/bili-probe/`, `_tools/probe_server.py`,
`_tools/probe_selftest.py`, `_tools/selector_audit.md`, `_tools/probe-captures/`
(empty, repopulated on demand), `.spec-workflow/` (user-owned, never touched).

`youtube-ambilight` remains as a read-only parity reference for the
YouTube behaviour; it is missing `assets` and git metadata now, so to restore a
full checkout use
`git clone -b develop https://github.com/WesselKroos/youtube-ambilight.git`
and expect commit `18d17188e5562e5ee913f005192d30c9a60be078`.

---

## 7. Accepted build (2026-10-04)

Tag `known-good-80`, commit `ab04943`, on top of the initial snapshot `b8b3312`. The user asked for this mark before further edits.

Two bugs were fixed after the initial snapshot. Both are included in the tag.

### The wash was only as tall as the video

`_bilibili-parity.scss` sized both the glow and its clipping container with `--bili-glow-height`. `ambientlight.js` wrote the video height in pixels into that same variable. On a 911px viewport the glow box measured 593px, so everything under the player was the bare page colour.

The page-wash size is now `--bili-page-glow-span` (230vh), shared by the glow and the container. The video height is published as `--bili-video-height` and must not be reused for the wash.

### The comment horizon was a mask contour

A radial mask drew a constant-alpha curve right where the comments start (about y=1047px in the 2026-10-04 capture). Below that curve a flat `html` tint (`rgb(var(--bili-ambient-rgb) / .17)`) was still visible, so the page looked coloured on both sides of a hard line.

The accepted build replaces that mask with a linear fade: solid through 100vh, transparent by 210vh, inside a 230vh box. The blurred canvas is pinned to the player (`top: 100vh; height: 280vh`) so it is not recentred in the tall box, and it extends past the transparent stop so its own edge cannot become the line. The flat page tint is removed (`background-image: none`).

Do not put a radial mask back, and do not paint a second flat tint under the glow.

### Wide mode was letterboxed

`max-width: 100%` on `#bilibili-player` and `.bpx-player-container` clamped the wide-mode 16:9 box to the left column. On a 2133x1012 viewport the player stayed 925px tall (the viewport-based height) but only 1108px wide, so the picture shrank inside black bars while the danmaku list had already moved down. Those two selectors are no longer clamped. `overflow-x: clip` on `html` still prevents the horizontal scrollbar. This fix is after `known-good-80`.

