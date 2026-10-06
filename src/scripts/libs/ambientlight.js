import {
  on,
  off,
  raf,
  ctxOptions,
  Canvas,
  SafeOffscreenCanvas,
  setTimeout,
  wrapErrorHandler,
  readyStateToString,
  networkStateToString,
  mediaErrorToString,
  requestIdleCallback,
  isWatchPageUrl,
  isEmbedPageUrl,
  VIEW_DISABLED,
  VIEW_DETACHED,
  VIEW_SMALL,
  VIEW_THEATER,
  VIEW_FULLSCREEN,
  VIEW_POPUP,
  setStyleProperty,
  setWarning,
} from './generic';
import ErrorReporter from './errors/error-reporter';
import BarDetection from './bar-detection';
import Settings, {
  DEBANDING_BLEND_MODE_LCD,
  DEBANDING_BLEND_MODE_OLED,
  FRAMESYNC_DECODEDFRAMES,
  FRAMESYNC_DISPLAYFRAMES,
  FRAMESYNC_VIDEOFRAMES,
} from './settings';
import Projector2d from './projector-2d';
import ProjectorWebGL from './projector-webgl';
import { WebGLOffscreenCanvas } from './canvas-webgl';
import {
  cancelGetAverageVideoFramesDifference,
} from './static-image-detection';
import Theming from './theming';
import Stats from './stats';
import { getNodeTreeString, getPageElems } from './errors/dom';
import { installDiagnostics, report } from './diagnostics';
import { handleAmbientlightKeyDown } from './keyboard';

installDiagnostics();

const baseUrl = chrome.runtime.getURL('') || ''; // document.currentScript?.getAttribute('data-base-url') || ''

export default class Ambientlight {
  innerStrength = 2;
  lastUpdateSizesChanged = 0;
  averageVideoFramesDifference = 1;

  videoOffset = {};
  srcVideoOffset = {};
  videoScale = 100;

  isHidden = true;
  isOnVideoPage = true;
  showedCompareWarning = false;
  getImageDataAllowed = true;
  catchedErrors = [];

  atTop = true;
  p = null;
  view = undefined;
  immersiveTheater = false;
  isFullscreen = false;
  isFillingFullscreen = false;
  isVideoHiddenOnWatchPage = false;
  isVrVideo = false;
  isHdr = false;
  isControlledByAnotherExtension = false;

  lastUpdateStatsTime = 0;
  updateStatsInterval = 1000;
  frameCountHistory = 4000;
  videoFrameCount = 0;
  displayFrameRate = 0;
  videoFrameRate = 0;
  ambientlightFrameCount = 0;
  ambientlightFrameRate = 0;
  ambientlightVideoDroppedFrameCount = 0;
  previousFrameTime = 0;
  previousDrawTime = 0;
  clearTime = 0;

  constructor(videoElem, ytdAppElem, ytdWatchElem, mastheadElem) {
    return async function AmbientlightConstructor() {
      report('ambientlight-constructor-start', {
        videoElem,
        ytdAppElem,
        ytdWatchElem,
        mastheadElem,
      });
      if (ytdAppElem) ytdAppElem.dataset.ytalElem = 'app';
      this.ytdAppElem = ytdAppElem; // Not available in embeds
      if (ytdWatchElem) ytdWatchElem.dataset.ytalElem = 'watch';
      this.ytdWatchElem = ytdWatchElem; // Not available in embeds
      if (mastheadElem) mastheadElem.dataset.ytalElem = 'masthead';
      this.mastheadElem = mastheadElem; // Not available in embeds

      this.detectChromiumBug1142112Workaround();
      this.detectChromiumBugDirectVideoOverlayWorkaround();
      this.detectMozillaBug1606251Workaround();
      this.detectMozillaBugSlowCanvas2DReadPixelsWorkaround();
      this.detectChromiumBug1092080Workaround();

      this.initElems(videoElem);
      await this.initSettings();
      // The YouTube overlay/workaround pipeline is not needed on Bilibili and
      // can cover the native player with a stale black canvas after upgrades.
      this.settings.videoOverlayEnabled = false;
      this.settings.chromiumDirectVideoOverlayWorkaround = false;
      this.settings.chromiumBugVideoJitterWorkaround = false;
      report('ambientlight-settings-ready', {
        enabled: this.settings.enabled,
        webGL: this.settings.webGL,
      });
      this.applyChromiumBugDirectVideoOverlayWorkaround();
      await this.waitForPageload();

      this.theming = new Theming(this);
      this.stats = new Stats(this);
      this.barDetection = new BarDetection(this);
      this.detectChromiumBug1123708Workaround();
      this.detectChromiumBugVideoJitterWorkaround();

      if (document.visibilityState === 'hidden') {
        await new Promise((resolve) => raf(resolve)); // Prevents lost WebGLContext on pageload in a background tab
      }
      await this.initAmbientlightElems();
      report('ambientlight-root-ready', {
        root: this.elem,
        parent: this.elem.parentElement,
        container: this.containerElem,
      });
      this.initBuffersWrapper();
      await this.initProjectorBuffers();
      this.recreateProjectors();
      report('ambientlight-projectors-ready', {
        webGL: !!this.projector,
        projectorBuffer: this.projectorBuffer
          ? {
              width: this.projectorBuffer.elem.width,
              height: this.projectorBuffer.elem.height,
            }
          : null,
      });
      this.stats.initElems();

      this.initStyles();
      this.updateStyles();

      this.checkGetImageDataAllowed();
      await this.initListeners();
      report('ambientlight-listeners-ready');

      new Promise((resolve) =>
        wrapErrorHandler(() => {
          this.initializedTime = performance.now();
          this.settings.onLoaded();
          resolve();
        })()
      );

      if (this.settings.enabled) {
        await wrapErrorHandler(async () => {
          await this.enable(true);
        })();
      }

      return this;
    }.bind(this)();
  }

  get playerSmallContainerElem() {
    return this.videoPlayerElem;
  }

  get playerTheaterContainerElem() {
    return this.videoPlayerElem;
  }

  get playerTheaterContainerElemFromVideo() {
    return this.videoPlayerElem;
  }

  get ytdWatchElemFromVideo() {
    return this.videoPlayerElem;
  }

  get thumbnailOverlayElem() {
    if (!this._thumbnailOverlayElem)
      this._thumbnailOverlayElem = document.querySelector(
        '.bpx-player-video-poster'
      );
    return this._thumbnailOverlayElem;
  }

  initElems(videoElem) {
    report('init-elems-start', videoElem);
    this.videoPlayerElem = videoElem.closest('.bpx-player-container');
    if (!this.videoPlayerElem) {
      const error = new Error(
        'Cannot find videoPlayerElem: .bpx-player-container'
      );
      error.details = getPageElems();
      error.details.videoIsInDocument = document.contains(videoElem);
      error.details.videoIsInBody = document.body.contains(videoElem);
      error.details.videoTree = getNodeTreeString(videoElem);
      setWarning(`加载失败。\n${error.message}`);
      throw error;
    }
    this.videoPlayerElem.dataset.ytalElem = 'video-player';

    // ytdPlayerElem is optional and only used on non-embed pages in small view to set the border radius
    this.ytdPlayerElem = videoElem.closest('.bpx-player-primary-area');

    // videoContainerElem is optional and only used in the videoOverlayEnabled setting
    this.videoContainerElem = videoElem.closest('.bpx-player-video-area');
    this.videoAreaElem = this.videoContainerElem;

    this.settingsMenuBtnParent = this.videoPlayerElem.querySelector(
      '.bpx-player-control-bottom-right'
    );
    if (!this.settingsMenuBtnParent) {
      const error = new Error(
        'Cannot find settingsMenuBtnParent: .bpx-player-control-bottom-right'
      );
      error.details = getPageElems();
      setWarning(`加载失败。\n${error.message}`);
      throw error;
    }

    this.initVideoElem(videoElem, false);
    report('init-elems-ready', {
      videoPlayerElem: this.videoPlayerElem,
      videoContainerElem: this.videoContainerElem,
      settingsMenuBtnParent: this.settingsMenuBtnParent,
    });
  }

  initVideoElem(videoElem, initListeners = true) {
    report('init-video-element', videoElem);
    this.cancelScheduledRequestVideoFrame();

    if (this.videoElem && this.videoElem !== videoElem) {
      this.resetVideoParentElemStyle();
      for (const name in this.videoListeners) {
        off(this.videoElem, name, this.videoListeners[name]);
      }
      clearTimeout(this.handleVideoErrorTimeout);
      this.handleVideoErrorTimeout = undefined;
      this.clear();
      this.videoObserver?.unobserve(this.videoElem);
      this.videoResizeObserver?.unobserve(this.videoElem);
    }

    videoElem.dataset.ytalElem = 'video';
    this.videoElem = videoElem;
    this.applyChromiumBugDirectVideoOverlayWorkaround();
    if (initListeners) this.initVideoListeners();
  }

  rebindPlayerParts(parts) {
    const previousPlayer = this.videoPlayerElem;
    const previousVideoArea = this.videoContainerElem;
    const previousControls = this.settingsMenuBtnParent;
    if (previousPlayer && this.ytdWatchElem === previousPlayer) {
      for (const name in this.playerListeners) off(previousPlayer, name, this.playerListeners[name]);
      this.ytdWatchElem = parts.videoPlayerElem;
    }
    if (this.ytdAppElem === previousPlayer) this.ytdAppElem = parts.videoPlayerElem;
    this.videoPlayerElem = parts.videoPlayerElem || this.videoElem?.closest('.bpx-player-container');
    this.videoContainerElem = parts.videoAreaElem || this.videoPlayerElem?.querySelector('.bpx-player-video-area');
    this.videoAreaElem = this.videoContainerElem;
    this.ytdPlayerElem = parts.videoElem?.closest('.bpx-player-primary-area');
    this.settingsMenuBtnParent =
      parts.controlRightElem ||
      this.videoPlayerElem?.querySelector('.bpx-player-control-bottom-right');

    if (parts.videoElem && parts.videoElem !== this.videoElem) {
      this.initVideoElem(parts.videoElem);
    }

    if (this.videoPlayerResizeObserver && previousPlayer !== this.videoPlayerElem) {
      if (previousPlayer) this.videoPlayerResizeObserver.unobserve(previousPlayer);
      if (this.videoPlayerElem) this.videoPlayerResizeObserver.observe(this.videoPlayerElem);
    }

    if (this.videoResizeObserver && this.videoElem) {
      this.videoResizeObserver.observe(this.videoElem);
    }

    if (previousPlayer !== this.videoPlayerElem) {
      this.settings?.closeMenuImmediately();
      previousPlayer?.classList.remove('ytp-ambientlight-settings-shown');
      this._thumbnailOverlayElem = undefined;
      this.videoPlayerObserver?.disconnect();
      this.videoPlayerObserver?.observe(this.videoPlayerElem, {
        attributes: true,
        attributeFilter: ['class', 'data-screen'],
      });
      this.playerContainersObserver?.disconnect();
      for (const elem of new Set([
        this.playerTheaterContainerElem,
        this.playerSmallContainerElem,
      ])) {
        if (elem) this.playerContainersObserver?.observe(elem, { childList: true });
      }
      this.videoOverlay?.elem?.remove();
      this.videoDebandingElem?.remove();
    }
    if (previousVideoArea !== this.videoContainerElem) {
      this.buffersCleared = true;
    }
    if (this.settings) {
      this.settings.rebindPlayerShell(
        this.settingsMenuBtnParent,
        this.videoPlayerElem,
        previousControls
      );
    }

    this.sizesChanged = true;
    this.sizesInvalidated = true;
    this.buffersCleared = true;
  }

  // FireFox workaround: WebGLParent::RecvReadPixels is slow when reading from a HtmlCanvasElement/OffscreenCanvas (performance scales linear with the amount of pixels to be read)
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1719154
  detectMozillaBugSlowCanvas2DReadPixelsWorkaround() {
    const match = navigator.userAgent.match(/Firefox\/((?:\.|[0-9])+)/);
    const version = match?.length > 1 ? parseFloat(match[1]) : null;
    if (version && (version < 123 || version > 124)) {
      this.enableMozillaBugReadPixelsWorkaround = true;
    }
  }
  shouldDrawDirectlyFromVideoElem = () =>
    this.enableMozillaBugReadPixelsWorkaround &&
    this.projector.webGLVersion === 2;

  // FireFox workaround: Force to rerender the outer blur of the canvasses
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1606251
  detectMozillaBug1606251Workaround() {
    const match = navigator.userAgent.match(/Firefox\/((?:\.|[0-9])+)/);
    const version = match?.length > 1 ? parseFloat(match[1]) : null;
    if (version && version < 74) {
      this.enableMozillaBug1606251Workaround = true;
    }
  }

  // Chromium workaround: YouTube drops the video quality because the video is dropping frames
  // for about ~2 seconds when requestVideoFrameCallback is used and the video
  // has been scrolled from onscreen to offscreen
  // https://bugs.chromium.org/p/chromium/issues/detail?id=1142112
  detectChromiumBug1142112Workaround() {
    const match = navigator.userAgent.match(/Chrome\/((?:\.|[0-9])+)/);
    const version = match?.length > 1 ? parseFloat(match[1]) : null;
    if (version && HTMLVideoElement.prototype.requestVideoFrameCallback) {
      this.enableChromiumBug1142112Workaround = true;
    }
  }

  applyChromiumBug1142112Workaround() {
    if (!this.enableChromiumBug1142112Workaround || !this.videoElem) return;
    if (this.chromiumBug1142112Workaround?.elem === this.videoElem) return;

    const videoElem = this.videoElem;
    if (typeof videoElem.getVideoPlaybackQuality !== 'function') return;

    const originalGetVideoPlaybackQuality = videoElem.getVideoPlaybackQuality.bind(videoElem);
    let previousDroppedVideoFrames = 0;
    let droppedVideoFramesCorrection = 0;
    let videoIsHidden = false;
    let videoVisibilityChangeTime = 0;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target !== videoElem) continue;
          videoIsHidden = entry.intersectionRatio === 0;
          videoVisibilityChangeTime = performance.now();
        }
      },
      { threshold: 0.0001 }
    );
    observer.observe(videoElem);

    videoElem.getVideoPlaybackQuality = function getVideoPlaybackQuality() {
      const original = originalGetVideoPlaybackQuality();
      let droppedVideoFrames = original.droppedVideoFrames;
      if (droppedVideoFrames < previousDroppedVideoFrames) {
        previousDroppedVideoFrames = 0;
        droppedVideoFramesCorrection = 0;
      }
      if (videoIsHidden || videoVisibilityChangeTime > performance.now() - 2000) {
        droppedVideoFramesCorrection +=
          droppedVideoFrames - previousDroppedVideoFrames;
      }
      previousDroppedVideoFrames = droppedVideoFrames;
      droppedVideoFrames = Math.max(0, droppedVideoFrames - droppedVideoFramesCorrection);
      return { ...original, droppedVideoFrames };
    };

    this.chromiumBug1142112Workaround = { elem: videoElem, observer };
  }

  // Chromium workaround: Force to render the blur originating from the canvasses past the browser window
  // https://bugs.chromium.org/p/chromium/issues/detail?id=1123708
  detectChromiumBug1123708Workaround() {
    if (this.settings.webGL) return;

    const match = navigator.userAgent.match(/Chrome\/((?:\.|[0-9])+)/);
    const version = match?.length > 1 ? parseFloat(match[1]) : null;
    if (version && version >= 85) {
      this.enableChromiumBug1123708Workaround = true;
    }
  }

  // Chromium workaround: drawImage randomly disables antialiasing in the videoOverlay and/or projectors
  // Additional 0.05ms performance impact per clearRect()
  // https://bugs.chromium.org/p/chromium/issues/detail?id=1092080
  detectChromiumBug1092080Workaround() {
    const match = navigator.userAgent.match(/Chrome\/((?:\.|[0-9])+)/);
    const version = match?.length > 1 ? parseFloat(match[1]) : null;
    if (version && version >= 82 && version < 88) {
      this.enableChromiumBug1092080Workaround = true;
    }
  }

  // Fixes video stuttering when display framerate > ambient framerate
  detectChromiumBugVideoJitterWorkaround() {
    if (!this.settings.webGL) return; // This has to much impact on the performance of the Canvas2D renderer

    const match = navigator.userAgent.match(/Chrome\/((?:\.|[0-9])+)/);
    const version = match?.length > 1 ? parseFloat(match[1]) : null;
    if (version) {
      this.enableChromiumBugVideoJitterWorkaround = true;
      this.settings.updateVisibility();
    }
  }

  // Disable the direct composition video overlay that can cause artifacts on Windows
  // https://github.com/WesselKroos/youtube-ambilight/blob/master/TROUBLESHOOT.md#3-nvidia-rtx-video-super-resolution-vsr--nvidia-rtx-video-hdr-does-not-work
  detectChromiumBugDirectVideoOverlayWorkaround() {
    const match = navigator.userAgent.match(/Windows/);
    if (match?.length > 0) {
      this.enableChromiumBugDirectVideoOverlayWorkaround = true;
    }
  }

  applyChromiumBugDirectVideoOverlayWorkaround() {
    if (!this.videoElem || !this.settings) return;

    this.videoElem.classList.toggle(
      'ambientlight__chromium-bug-direct-video-overlay-workaround',
      this.enableChromiumBugDirectVideoOverlayWorkaround &&
        this.settings.chromiumDirectVideoOverlayWorkaround
    );
  }

  applyChromiumBugVideoJitterWorkaround() {
    try {
      if (!this.enableChromiumBugVideoJitterWorkaround) return;
      if (!this.settings.chromiumBugVideoJitterWorkaround) {
        if (this.chromiumBugVideoJitterWorkaround) {
          const { elem, observer } = this.chromiumBugVideoJitterWorkaround;
          observer.disconnect();
          if (elem.parentElement) elem.parentElement.removeChild(elem);
          this.chromiumBugVideoJitterWorkaround = undefined;
        }
        return;
      }
      if (this.chromiumBugVideoJitterWorkaround) return;

      const elem = document.createElement('div');
      elem.classList.add('ambientlight__chromium-bug-video-jitter-workaround');

      const update = wrapErrorHandler(
        function chromiumBugVideoJitterWorkaroundUpdate(isPlaying) {
          if (isPlaying === undefined) {
            isPlaying = this.videoPlayerElem.classList.contains('playing-mode');
          }

          const enable =
            this.averageVideoFramesDifference >=
              this.averageVideoFramesDifference1SecondThreshold &&
            isPlaying &&
            !this.isHidden &&
            !this.videoIsHidden &&
            !(this.settings.spread === 0 && this.settings.blur2 === 0);

          if (enable && elem.parentElement !== this.containerElem) {
            this.containerElem.appendChild(elem);
          } else if (!enable && elem.parentElement) {
            elem.parentElement.removeChild(elem);
          }
        }.bind(this),
        true
      );

      const observer = new MutationObserver(
        wrapErrorHandler(
          function chromiumBugVideoJitterWorkaroundMutation(mutations) {
            if (!this.chromiumBugVideoJitterWorkaround) return;

            for (const mutation of mutations) {
              const wasPlaying = mutation.oldValue
                .split(' ')
                .includes('playing-mode');
              const isPlaying =
                mutation.target.classList.contains('playing-mode');
              if (wasPlaying === isPlaying) continue;

              update(isPlaying);
            }
          }.bind(this),
          true
        )
      );
      observer.observe(this.videoPlayerElem, {
        attributes: true,
        attributeFilter: ['class'],
        attributeOldValue: true,
      });

      this.chromiumBugVideoJitterWorkaround = {
        elem,
        observer,
        update,
      };

      update(this.videoPlayerElem.classList.contains('playing-mode'));
    } catch (ex) {
      console.warn(
        'applyChromiumBugVideoJitterWorkaround error. Continuing ambientlight initialization...'
      );
      ErrorReporter.captureException(ex);
      this.enableChromiumBugVideoJitterWorkaround = false; // Prevent retries
    }
  }

  waitForPageload = async () => {
    if (
      (this.settings.enabled && !this.settings.prioritizePageLoadSpeed) ||
      !this.videoElem ||
      !isWatchPageUrl()
    )
      return;

    if (this.videoElem.readyState < 3) {
      await new Promise((resolve) => {
        if (!(this.videoElem.readyState < 3)) {
          resolve();
          return;
        }

        const handleCanPlay = () => {
          off(this.videoElem, 'canplay', handleCanPlay);
          resolve();
        };
        on(this.videoElem, 'canplay', handleCanPlay);
      });

      await new Promise((resolve) =>
        requestIdleCallback(resolve, { timeout: 1000 })
      ); // Buffering/rendering budget for low-end devices
    } else {
      await new Promise((resolve) =>
        requestIdleCallback(resolve, { timeout: 2000 })
      ); // Buffering/rendering budget for low-end devices
    }

    if (document.visibilityState === 'hidden') {
      await new Promise((resolve) => raf(resolve));
    }
  };

  initStyles() {
    this.styleElem = document.createElement('style');
    this.styleElem.appendChild(document.createTextNode(''));
    document.head.appendChild(this.styleElem);
  }

  lastVideoElemSrc = '';
  initVideoIfSrcChanged = async () => {
    if (this.lastVideoElemSrc === this.videoElem.src) {
      return false;
    }

    this.lastVideoElemSrc = this.videoElem.src;
    await this.start();

    return true;
  };

  initAverageVideoFramesDifferenceListeners() {
    if (!this.ytdWatchElem) return;

    try {
      on(
        this.ytdWatchElem,
        'yt-page-data-will-update',
        () => {
          if (this.averageVideoFramesDifference === 1) return;

          this.resetAverageVideoFramesDifference();
        },
        undefined,
        true
      );
      on(
        document,
        'yt-page-data-updated',
        () => {
          if (!this.settings.enabled || !this.isOnVideoPage) return;

          this.calculateAverageVideoFramesDifference();
        },
        undefined,
        true
      );
    } catch (ex) {
      ErrorReporter.captureException(ex);
    }
  }

  resetAverageVideoFramesDifference = () => {
    cancelGetAverageVideoFramesDifference();
    this.averageVideoFramesDifference = 1;
    this.settings.updateAverageVideoFramesDifferenceInfo();

    if (this.chromiumBugVideoJitterWorkaround?.update)
      this.chromiumBugVideoJitterWorkaround.update();
  };

  calculateAverageVideoFramesDifference = () => {};

  initVideoListeners() {
    ////// PLAYER FLOW
    //
    // LEGEND
    //
    // [  Start
    // ]  End
    // *  When drawImage is called
    //
    // FLOWS
    //
    // Start (paused):                                                                      [ *loadeddata -> canplay ]
    // Start (playing):                            [ play    ->                               *loadeddata -> canplay -> *playing ]
    // Start (from previous video):  [ emptied 2x -> play    ->                               *loadeddata -> canplay -> *playing ]
    // Video src change (paused):    [    emptied ->                               *seeked ->  loadeddata -> canplay ]
    // Video src change (playing):   [    emptied -> play                                     *loadeddata -> canplay -> *playing ]
    // Quality change (paused):      [    emptied ->            seeking ->         *seeked ->  loadeddata -> canplay ]
    // Quality change (playing):     [    emptied -> play    -> seeking ->         *seeked ->  loadeddata -> canplay -> *playing ]
    // Seek (paused):                                         [ seeking ->         *seeked ->                canplay ]
    // Seek (playing):                             [ pause   -> seeking -> play -> *seeked ->                canplay -> *playing ]
    // Play:                                                             [ play ->                                      *playing ]
    // Load more data (playing):                   [ waiting ->                                              canplay -> *playing ]
    // End video:  [ pause -> ended ]
    //
    //////

    this.videoListeners = this.videoListeners || {
      seeked: async () => {
        report('video-event-seeked', {
          readyState: this.videoElem.readyState,
          paused: this.videoElem.paused,
        });
        if (!this.settings.enabled || !this.isOnVideoPage) return;

        // Prevent WebGL flicker reduction from mixing old frames
        if (this.projectorBuffer?.ctx?.clearPreviousRect) {
          this.projectorBuffer.ctx.clearPreviousRect();
        }

        // When the video is paused this is the first event. Else [loadeddata] is first
        if (await this.initVideoIfSrcChanged()) return;

        this.previousPresentedFrames = 0;
        this.videoFrameCounts = [];
        this.videoPresentedFrames = 0;
        this.displayFrameCounts = [];
        this.ambientlightFrameCounts = [];
        this.lastUpdateStatsTime = performance.now();

        this.barDetection.cancel();

        // Prevent any old frames from being drawn
        this.buffersCleared = true;

        // Prevent WebGL frameFading/frameBlending from mixing old frames
        if (
          this.settings.webGL &&
          (this.settings.frameFading || this.settings.frameBlending)
        ) {
          this.projector.drawTextureSize = {
            width: 0,
            height: 0,
          };
        }

        await this.optionalFrame();
      },
      loadstart: () => {
        this.settings.setWarning(undefined, undefined, undefined, 'encrypted');
      },
      encrypted: () => {
        this.settings.setWarning(
          '此视频受 DRM 保护，无法显示氛围灯',
          true,
          true,
          'encrypted'
        );
      },
      loadeddata: async () => {
        report('video-event-loadeddata', {
          readyState: this.videoElem.readyState,
          paused: this.videoElem.paused,
          videoWidth: this.videoElem.videoWidth,
          videoHeight: this.videoElem.videoHeight,
        });
        if (!this.settings.enabled || !this.isOnVideoPage) return;

        this.sizesChanged = true;
        this.buffersCleared = true;

        // Prevent WebGL flicker reduction from mixing old frames
        if (this.projectorBuffer?.ctx?.clearPreviousRect) {
          this.projectorBuffer.ctx.clearPreviousRect();
        }

        // Whent the video is playing this is the first event. Else [seeked] is first
        this.checkGetImageDataAllowed(); // Re-check after crossOrigin attribute has been applied
        await this.updateHdr();
        await this.initVideoIfSrcChanged();
        await this.optionalFrame();
      },
      playing: async () => {
        report('video-event-playing', {
          readyState: this.videoElem.readyState,
          paused: this.videoElem.paused,
        });
        if (!this.settings.enabled || !this.isOnVideoPage) return;
        if (this.videoElem.paused) return; // When paused handled by [seeked]

        await this.optionalFrame();
      },
      ended: () => {
        report('video-event-ended');
        if (!this.settings.enabled || !this.isOnVideoPage) return;
        if (this.clearTime < performance.now() - 500) this.clear();
        this.stats.hide();
        this.scheduledNextFrame = false;
        this.resetVideoParentElemStyle(); // Prevent visible video element above player because of the modified style attribute
      },
      emptied: () => {
        report('video-event-emptied');
        if (!this.settings.enabled || !this.isOnVideoPage) return;
        if (this.clearTime < performance.now() - 500) this.clear();
        this.scheduledNextFrame = false;
      },
      error: (ex) => {
        const videoElem = ex?.target;
        const error = videoElem?.error;
        console.log(`Restoring the ambient light after a video error...
Video error: ${mediaErrorToString(error?.code)} ${
          error?.message ? `(${error?.message})` : ''
        }
Video network state: ${networkStateToString(videoElem?.networkState)}
Video ready state: ${readyStateToString(videoElem?.readyState)}`);
        if (this.clearTime < performance.now() - 500) this.clear();
        this.cancelScheduledRequestVideoFrame();
        if (this.handleVideoErrorTimeout) return;

        this.handleVideoErrorTimeout = setTimeout(this.handleVideoError, 1000);
      },
      click: this.settings.onCloseMenu,
      enterpictureinpicture: async () => {
        this.videoIsPictureInPicture = true;
        await this.optionalFrame();
      },
      leavepictureinpicture: async () => {
        this.videoIsPictureInPicture = false;
        await this.optionalFrame();
      },
    };
    for (const name in this.videoListeners) {
      off(this.videoElem, name, this.videoListeners[name]);
      on(this.videoElem, name, this.videoListeners[name]);
    }

    if (this.ytdWatchElem) {
      this.playerListeners = this.playerListeners || {
        'yt-autonav-pause-player-ended': this.videoListeners.ended,
      };
      for (const name in this.playerListeners) {
        off(this.ytdWatchElem, name, this.playerListeners[name]);
        on(this.ytdWatchElem, name, this.playerListeners[name]);
      }
    }

    if (this.videoObserver) {
      this.videoObserver.disconnect();
    }
    this.videoIsHidden = false; // IntersectionObserver is always executed at least once when the observation starts
    if (!this.videoObserver) {
      this.videoObserver = new IntersectionObserver(
        wrapErrorHandler((entries, observer) => {
          if (!window.ambientlight) return;
          if (window.ambientlight !== this) {
            observer.disconnect(); // Disconnect, because ambientlight crashed on initialization and created a new instance
            return;
          }

          for (const entry of entries) {
            if (this.videoElem !== entry.target) {
              this.videoObserver.unobserve(entry.target); // video is detached and a new one was created
              continue;
            }
            this.videoIsHidden = entry.intersectionRatio === 0;
            this.videoVisibilityChangeTime = performance.now();
            // this.videoElem.getVideoPlaybackQuality(); // Correct dropped frames
          }

          if (this.chromiumBugVideoJitterWorkaround?.update)
            this.chromiumBugVideoJitterWorkaround.update();
        }, true),
        {
          rootMargin: '-70px 0px 0px 0px', // masthead height (56px) + additional pixel to be safe
          threshold: 0.0001, // Because sometimes a pixel in not visible on screen but the intersectionRatio is already 0
        }
      );
    }
    this.videoObserver.observe(this.videoElem);

    this.applyChromiumBug1142112Workaround();
    this.applyChromiumBugVideoJitterWorkaround();
  }

  handleVideoError = () => {
    this.handleVideoErrorTimeout = undefined;
    this.initVideoListeners();
    if (!this.videoElem.paused) {
      this.videoListeners.playing();
    }
  };

  // Removes "yt:crop=16:9" & "yt-stretch=16:9" from the videoData.keywords array
  // to prevent the video element from being scaled by YouTube in theater view
  ytScalingBaseKeywords = ['yt:crop=', 'yt:stretch='];
  updateKeywordsToPreventTheaterScaling = () => {
    try {
      let keywords =
        document.head.querySelector('meta[name="keywords"]')?.content ?? '';
      if (
        !this.ytScalingBaseKeywords.some((baseKeyword) =>
          keywords.includes(baseKeyword)
        )
      )
        return;

      keywords = keywords.split(', ');
      if (this.settings.enabled) {
        keywords = keywords.filter(
          (keyword) =>
            !this.ytScalingBaseKeywords.some((baseKeyword) =>
              keyword.startsWith(baseKeyword)
            )
        );
      }
      return;
    } catch (ex) {
      ErrorReporter.captureException(ex);
    }
  };

  updateVideoPlayerSize = async () => {
    if (this.videoPlayerSetSizePromise) {
      await this.videoPlayerSetSizePromise;
      return;
    }

    this.sizesChanged = true;
  };

  async initListeners() {
    this.initVideoListeners();

    if (this.settings.webGL) {
      this.projector.handleRestored = async () => {
        this.buffersCleared = true;
        this.sizesChanged = true;

        this.cancelScheduledRequestVideoFrame();
        // eslint-disable-next-line no-self-assign
        this.videoElem.currentTime = this.videoElem.currentTime; // Triggers video draw call

        await this.optionalFrame();
      };
    }

    on(
      document,
      'visibilitychange',
      this.handleDocumentVisibilityChange,
      false
    );
    on(
      document,
      'fullscreenchange',
      async function fullscreenchange() {
        await this.updateSizes();
      }.bind(this),
      false
    );

    on(document, 'keydown', this.handleKeyDown);

    if (this.topElem) {
      this.topElemObserver = new IntersectionObserver(
        wrapErrorHandler(async (entries) => {
          let atTop = true;
          for (const entry of entries) {
            atTop = entry.intersectionRatio !== 0;
          }
          if (this.atTop === atTop) return;

          this.atTop = atTop;
          await this.updateAtTop();

          // When the video is filled and paused in fullscreen the ambientlight is out of sync with the video
          if (this.isFillingFullscreen && !this.atTop) {
            this.buffersCleared = true;
            await this.optionalFrame();
          }
        }, true),
        {
          threshold: 0.0001, // Because sometimes a pixel in not visible on screen but the intersectionRatio is already 0
        }
      );
      this.topElemObserver.observe(this.topElem);
      this.atTop = window.scrollY === 0;
      await this.updateAtTop();
    }

    if (this.settings.webGL)
      on(window, 'resize', this.projector.handleWindowResize, false);

    const resizeTooSmall = (pRect, rect) =>
      Math.abs(rect.x - (pRect?.x || 0)) <= 2 &&
      Math.abs(rect.y - (pRect?.y || 0)) <= 2 &&
      Math.abs(rect.width - (pRect?.width || 0)) <= 2 &&
      Math.abs(rect.height - (pRect?.height || 0)) <= 2;
    // Only triggers when the html width changes because the height is 0
    let previousHtmlRect;
    this.htmlResizeObserver = new ResizeObserver(
      wrapErrorHandler(
        function htmlResize(e) {
          if (!this.settings.enabled || !this.isOnVideoPage) return;

          const rect = e[0].contentRect;
          if (resizeTooSmall(previousHtmlRect, rect)) return;

          previousHtmlRect = rect;
          this.resize(); // Because the video position could be shifted
        }.bind(this),
        true
      )
    );
    this.htmlResizeObserver.observe(document.documentElement);

    // Makes sure the player size is recalculated after the scrollbar has been hidden
    // and the styles are recalculated.
    // YouTube does this incorrect by calculating it before the styles are recalculated.
    let previousVideoPlayerRect;
    this.videoPlayerResizeObserver = new ResizeObserver(
      wrapErrorHandler(
        function videoPlayerResize(e) {
          if (!this.settings.enabled || !this.isOnVideoPage) {
            previousVideoPlayerRect = undefined;
            return;
          }

          const rect = e[0].contentRect;
          if (resizeTooSmall(previousVideoPlayerRect, rect)) return;

          // if(!this.isFullscreen) {
          //   try {
          //     await new Promise(resolve => raf(resolve)) // Wait for all layout style recalculations
          //     this.videoPlayerElem.setSize()
          //     this.videoPlayerElem.setInternalSize()
          //     await new Promise(resolve => raf(resolve)) // Wait for all layout style recalculations
          //     this.sizesChanged = true
          //   } catch(ex) {
          //     console.warn('Failed to resize the video player')
          //   }
          // }
          if (!this.settings.enabled) return;

          previousVideoPlayerRect = rect;
          this.resize(
            this.videoPlayerResizeToFullscreen
              ? 0
              : this.videoPlayerResizeFromFullscreen
              ? 0
              : 0
          );
          this.videoPlayerResizeFromFullscreen = false;
          this.videoPlayerResizeToFullscreen = false;
        }.bind(this),
        true
      )
    );
    this.videoPlayerResizeObserver.observe(this.videoPlayerElem);

    // // Deprecated: Moved to videoPlayerResizeObserver
    // this.videoContainerResizeObserver = new ResizeObserver(wrapErrorHandler(function videoContainerResize() {
    //   this.resize()
    // }.bind(this), true))
    // this.videoContainerResizeObserver.observe(this.videoContainerElem)

    let previousVideoRect;
    this.videoResizeObserver = new ResizeObserver(
      wrapErrorHandler(
        function videoResize(e) {
          if (!this.settings.enabled || !this.isOnVideoPage) {
            previousVideoRect = undefined;
            return;
          }

          const rect = e[0].contentRect;
          if (resizeTooSmall(previousVideoRect, rect)) {
            return;
          }

          previousVideoRect = rect;
          this.resize();
        }.bind(this),
        true
      )
    );
    this.videoResizeObserver.observe(this.videoElem);

    this.theming.initListeners();

    this.initAverageVideoFramesDifferenceListeners();

    this.videoPlayerObserver = new MutationObserver(
      wrapErrorHandler(
        async function videoPlayerMutation() {
          const viewChanged = await this.updateView();
          const videoHiddenChanged = this.updateIsVideoHiddenOnWatchPage();
          if (!viewChanged && !videoHiddenChanged) return;

          if (videoHiddenChanged && this.isVideoHiddenOnWatchPage) {
            if (this.clearTime < performance.now() - 500) this.clear();
            this.resetVideoParentElemStyle();
            return;
          }

          if (
            viewChanged ||
            (videoHiddenChanged && !this.isVideoHiddenOnWatchPage)
          ) {
            await this.optionalFrame();
          }
        }.bind(this),
        true
      )
    );
    this.updateIsVideoHiddenOnWatchPage();

    this.videoPlayerObserver.observe(this.videoPlayerElem, {
      attributes: true,
      attributeFilter: ['class', 'data-screen'],
    });
    if (this.thumbnailOverlayElem) {
      this.videoPlayerObserver.observe(this.thumbnailOverlayElem, {
        attributes: true,
        attributeFilter: ['style'],
      });
    }

    // When the video moves between the small and theater views
    const playerContainersObserver = this.playerContainersObserver = new MutationObserver(
      wrapErrorHandler(
        async function playerContainerMutation() {
          await this.updateView();
          await this.optionalFrame();
        }.bind(this),
        true
      )
    );
    const playerContainersObserverOptions = {
      childList: true,
    };

    const playerTheaterContainerElem = this.playerTheaterContainerElem;
    if (playerTheaterContainerElem) {
      playerContainersObserver.observe(
        playerTheaterContainerElem,
        playerContainersObserverOptions
      );
    }
    const playerSmallContainerElem = this.playerSmallContainerElem;
    if (playerSmallContainerElem) {
      playerContainersObserver.observe(
        playerSmallContainerElem,
        playerContainersObserverOptions
      );
    }

    await this.updateView();
  }

  updateIsVideoHiddenOnWatchPage = () => {
    const classList = this.videoPlayerElem.classList;
    const hidden =
      classList.contains('ended-mode') ||
      (classList.contains('unstarted-mode') &&
        !(this.thumbnailOverlayElem?.style?.display !== '')); // Auto-play disabled and Thumbnail poster overlays the video
    if (this.isVideoHiddenOnWatchPage === hidden) return false;

    this.isVideoHiddenOnWatchPage = hidden;
    this.sizesInvalidated = true;
    return true;
  };

  delayResizes = true;
  resizeDurationThreshold = 300;
  resizeDurations = [
    this.resizeDurationThreshold,
    this.resizeDurationThreshold,
    this.resizeDurationThreshold,
    this.resizeDurationThreshold,
  ];

  resizeAfterFrames = 0;
  resize = wrapErrorHandler(async (afterFrames = 0) => {
    if (!this.settings.enabled || !this.isOnVideoPage || this.pendingStart) {
      this.resizeAfterFrames = 0;
      if (this.scheduledResize) cancelAnimationFrame(this.scheduledResize);
      this.scheduledResize = undefined;
      return;
    }

    this.delayResizes =
      this.delayResizes ||
      this.videoPlayerResizeFromFullscreen ||
      this.videoPlayerResizeToFullscreen;
    this.resizeAfterFrames = this.delayResizes
      ? Math.max(this.resizeAfterFrames, afterFrames)
      : 0;

    if (this.scheduledResize) return;

    if (this.resizeAfterFrames === 0) {
      this.sizesInvalidated = true;
      const start = performance.now();
      await this.optionalFrame();
      requestIdleCallback(() => this.measureResizeDuration(start), {
        timeout: 1000,
      });
    }

    // Do not resize untill the next animation frame
    this.scheduledResize = raf(() => {
      this.scheduledResize = undefined;
      if (this.resizeAfterFrames === 0) return;

      this.resizeAfterFrames--;
      this.resize();
    });
  });

  measureResizeDuration = (start) => {
    const duration = Math.min(1000, performance.now() - start);
    this.resizeDurations.push(duration);
    if (this.resizeDurations.length > 4) this.resizeDurations.splice(0, 1);
    const averageDuration =
      this.resizeDurations.reduce((a, b) => a + b) /
      this.resizeDurations.length;
    this.delayResizes = averageDuration >= this.resizeDurationThreshold;
  };

  handleDocumentVisibilityChange = async () => {
    if (this.handlePageVisibilityTimeout) {
      clearTimeout(this.handlePageVisibilityTimeout);
      this.handlePageVisibilityTimeout = undefined;
    }

    if (!this.settings.enabled || !this.isOnVideoPage) return;

    const isPageHidden = document.visibilityState === 'hidden';
    if (this.isPageHidden === isPageHidden) return;
    this.isPageHidden = isPageHidden;

    if (isPageHidden) {
      this.pageHiddenTime = performance.now();
      this.checkIfNeedToHideVideoOverlay();
      this.buffersCleared = true;
      this.sizesChanged = true;

      this.handlePageVisibilityTimeout = setTimeout(
        function handlePageVisibility() {
          this.handlePageVisibilityTimeout = undefined;
          this.pageHiddenClearTime = performance.now();

          // const lintExt = this.ctx.getExtension('GMAN_debug_helper');
          // if(lintExt) lintExt.disable() // weblg-lint throws incorrect errors after the WebGL context has been lost once

          // Set canvas sizes & textures to 1x1 to clear GPU memory
          this.clear();
        }.bind(this),
        3000
      );
    } else {
      this.pageShownTime = performance.now();
      await this.theming.updateTheme();
      await this.optionalFrame();
    }
  };

  handleKeyDown = handleAmbientlightKeyDown.bind(this);

  handleVideoFocus = () => {
    if (!this.settings.enabled || !this.isOnVideoPage || !this.ytdAppElem)
      return;

    const startTop =
      this.view === VIEW_FULLSCREEN
        ? this.ytdAppElem.scrollTop
        : window.scrollY;
    raf(
      function handleVideoFocusRaf() {
        const endTop = VIEW_FULLSCREEN
          ? this.ytdAppElem.scrollTop
          : window.scrollY;
        if (startTop === endTop) return;

        if (this.view === VIEW_FULLSCREEN) {
          this.ytdAppElem.scrollTop = startTop;
        } else {
          window.scrollTo(window.scrollX, startTop);
        }
      }.bind(this)
    );
  };

  onKeyPressed = async (key) => {
    if (key === ' ') return;

    const keys = this.settings.getKeys();
    if (key === keys.detectHorizontalBarSizeEnabled)
      this.settings.clickUI('detectHorizontalBarSizeEnabled');
    if (key === keys.detectVerticalBarSizeEnabled)
      this.settings.clickUI('detectVerticalBarSizeEnabled');
    if (key === keys.detectVideoFillScaleEnabled)
      this.settings.clickUI('detectVideoFillScaleEnabled');
    if (key === keys.enabled) await this.toggleEnabled();
  };

  async toggleEnabled(enabled) {
    if (this.pendingStart) return;
    enabled = enabled !== undefined ? enabled : !this.settings.enabled;
    if (enabled) {
      await this.enable();
    } else {
      await this.disable();
    }
    this.settings.displayBezelForSetting('enabled');
  }

  checkGetImageDataAllowed() {
    const isSameOriginVideo =
      !!this.videoElem.src &&
      this.videoElem.src.indexOf(location.origin) !== -1;
    const getImageDataAllowed =
      !window.chrome ||
      isSameOriginVideo ||
      (!isSameOriginVideo && this.videoElem.crossOrigin);

    // Try to apply the workaround once
    if (
      this.videoElem.src &&
      !getImageDataAllowed &&
      !this.crossOriginApplied
    ) {
      console.warn(
        `Detected a video that cannot be sampled: ${this.videoElem.src}`
      );
      this.crossOriginApplied = true;
    }

    if (this.getImageDataAllowed === getImageDataAllowed) return;

    this.getImageDataAllowed = getImageDataAllowed;
    this.settings.updateVisibility();
  }

  async initAmbientlightElems() {
    report('init-ambientlight-elements-start');
    this.elem = document.createElement('div');
    this.elem.classList.add('ambientlight');

    this.containerElem = document.createElement('div');
    this.containerElem.classList.add('ambientlight__container');
    this.containerElem.style.position = 'absolute';
    this.elem.prepend(this.containerElem);

    if (this.mastheadElem) {
      this.topElem = document.createElement('div');
      this.topElem.classList.add('ambientlight__top');
      this.elem.prepend(this.topElem);
    }

    this.clearfixElem = document.createElement('div');
    this.clearfixElem.classList.add('ambientlight__clearfix');
    this.elem.prepend(this.clearfixElem);

    this.videoShadowElem = document.createElement('div');
    this.videoShadowElem.classList.add('ambientlight__video-shadow');
    this.containerElem.prepend(this.videoShadowElem);

    this.filterElem = document.createElement('div');
    this.filterElem.classList.add('ambientlight__filter');
    this.containerElem.prepend(this.filterElem);

    if (this.enableChromiumBug1123708Workaround) {
      this.chromiumBug1123708WorkaroundElem = new Canvas(1, 1, true);
      this.chromiumBug1123708WorkaroundElem.classList.add(
        'ambientlight__chromium-bug-1123708-workaround'
      );
      this.filterElem.prepend(this.chromiumBug1123708WorkaroundElem);
    }

    this.clipElem = document.createElement('div');
    this.clipElem.classList.add('ambientlight__clip');
    this.filterElem.prepend(this.clipElem);

    this.projectorsElem = document.createElement('div');
    this.projectorsElem.classList.add('ambientlight__projectors');
    this.clipElem.prepend(this.projectorsElem);

    this.projectorListElem = document.createElement('div');
    this.projectorListElem.classList.add('ambientlight__projector-list');
    this.projectorsElem.prepend(this.projectorListElem);

    if (this.videoPlayerElem?.classList?.contains('bpx-player-container')) {
      this.pageGlowElem = document.createElement('div');
      this.pageGlowElem.classList.add('bili-ambientlight-page-glow');
      this.pageGlowCanvas = document.createElement('canvas');
      this.pageGlowCanvas.width = 96;
      this.pageGlowCanvas.height = 54;
      this.pageGlowCanvas.className = 'bili-ambientlight-page-glow__canvas';
      this.pageGlowElem.appendChild(this.pageGlowCanvas);
      this.pageGlowCtx = this.pageGlowCanvas.getContext('2d', {
        alpha: false,
      });
      this.containerElem.prepend(this.pageGlowElem);
    }

    this.appendElemToContentElem();

    await this.initProjector();
    report('init-ambientlight-elements-ready', {
      parent: this.elem.parentElement,
      parentClass: this.elem.parentElement?.className,
    });
  }

  // Keep the ambient-light canvas behind the whole Bilibili page so it can
  // colour the surrounding layout without sitting on top of the video.
  getContentElem = () => document.body || this.videoPlayerElem;

  getFullscreenContentElem() {
    let elem = this.getContentElem();
    if (document.fullscreenElement) {
      if (!document.fullscreenElement.contains(elem)) {
        elem = document.fullscreenElement;
      }
    }
    return elem;
  }

  appendElemToContentElem() {
    const contentElem = this.getContentElem();
    if (this.elem.parentElement === contentElem) return;

    contentElem.prepend(this.elem);
  }

  appendElemToFullscreenElem() {
    const fullscreenContentElem = this.getFullscreenContentElem();

    if (this.elem.parentElement === fullscreenContentElem) return;

    fullscreenContentElem.prepend(this.elem);
  }

  initProjector = async () => {
    report('init-projector-start', { webGL: this.settings.webGL });
    if (this.settings.webGL) {
      try {
        this.projector = await new ProjectorWebGL(
          this,
          this.projectorListElem,
          this.initProjectorListeners,
          this.settings
        );
      } catch (ex) {
        report('webgl-projector-failed', ex, 'error');
        this.projector = undefined;
        if (!this.settings.webGLCrashDate) {
          ErrorReporter.captureException(ex);
        } else {
          console.log(ex);
          if (ex?.details) console.log(ex.details);
        }
        this.settings.handleWebGLCrash();
      }
    }

    if (!this.projector) {
      report('using-2d-projector');
      this.projector = new Projector2d(
        this,
        this.projectorListElem,
        this.initProjectorListeners,
        this.settings
      );
    }
    this.initProjectorListeners();
  };

  initProjectorListeners = () => {
    // Dont draw ambientlight when its not in viewport
    this.isAmbientlightHiddenOnWatchPage = false;
    if (this.ambientlightObserver) {
      this.ambientlightObserver.disconnect();
    }
    if (!this.ambientlightObserver) {
      this.ambientlightObserver = new IntersectionObserver(
        wrapErrorHandler(async (entries) => {
          for (const entry of entries) {
            this.isAmbientlightHiddenOnWatchPage =
              entry.intersectionRatio === 0;
            if (this.isAmbientlightHiddenOnWatchPage) continue;

            await this.optionalFrame();
          }
        }, true),
        {
          threshold: 0.0001, // Because sometimes a pixel in not visible on screen but the intersectionRatio is already 0
        }
      );
    }
    this.ambientlightObserver.observe(this.projector.boundaryElem);
  };

  initBuffersWrapper() {
    this.buffersWrapperElem = document.createElement('div');
    this.buffersWrapperElem.classList.add('ambientlight__buffers-wrapper');
    this.containerElem.appendChild(this.buffersWrapperElem);
  }

  async initProjectorBuffers() {
    let projectorsBufferElem;
    let projectorsBufferCtx;
    if (this.settings.webGL) {
      try {
        projectorsBufferElem = new WebGLOffscreenCanvas(
          1,
          1,
          this,
          this.settings
        );
        projectorsBufferCtx = await projectorsBufferElem.getContext(
          '2d',
          ctxOptions
        );

        if (this.settings.webGLCrashDate) {
          this.settings.webGLCrashDate = undefined;
          this.settings.webGLCrashVersion = undefined;
          this.settings.saveStorageEntry('webGLCrash', undefined);
          this.settings.saveStorageEntry('webGLCrashVersion', undefined);
          this.settings.updateWebGLCrashDescription();
        }
      } catch (ex) {
        projectorsBufferCtx = undefined;
        if (!this.settings.webGLCrashDate) {
          ErrorReporter.captureException(ex);
        } else {
          console.log(ex);
          if (ex?.details) console.log(ex.details);
        }
        this.settings.handleWebGLCrash();
      }
    }
    if (!projectorsBufferCtx) {
      projectorsBufferElem = new SafeOffscreenCanvas(1, 1, true);
      projectorsBufferCtx = projectorsBufferElem.getContext('2d', ctxOptions);
    }

    if (projectorsBufferElem.tagName === 'CANVAS') {
      this.buffersWrapperElem.appendChild(projectorsBufferElem);
    }
    this.nonHdrProjectorBuffer = {
      elem: projectorsBufferElem,
      ctx: projectorsBufferCtx,
    };
    this.projectorBuffer = this.nonHdrProjectorBuffer;
  }

  initWebGLHdrProjectorBuffer() {
    if (this.hdrProjectorBuffer) return;

    const hdrProjectorsBufferElem = new SafeOffscreenCanvas(1, 1, true);
    const hdrProjectorsBufferCtx = hdrProjectorsBufferElem.getContext(
      '2d',
      ctxOptions
    );

    if (hdrProjectorsBufferElem.tagName === 'CANVAS') {
      this.buffersWrapperElem.appendChild(hdrProjectorsBufferElem);
    }
    this.hdrProjectorBuffer = {
      elem: hdrProjectorsBufferElem,
      ctx: hdrProjectorsBufferCtx,
    };
  }

  async initSettings() {
    this.settings = await new Settings(
      this,
      this.settingsMenuBtnParent,
      this.videoPlayerElem
    );
  }

  initVideoOverlay() {
    const videoOverlayElem = new Canvas(1, 1);
    videoOverlayElem.classList.add('ambientlight__video-overlay');
    this.videoOverlay = {
      elem: videoOverlayElem,
      ctx: videoOverlayElem.getContext('2d', {
        ...ctxOptions,
        alpha: true,
      }),
      isHiddenChangeTimestamp: 0,
    };
  }

  initFrameBlending() {
    const previousProjectorsBufferElem = new Canvas(
      this.projectorBuffer.elem.width,
      this.projectorBuffer.elem.height,
      true
    );
    if (previousProjectorsBufferElem.tagName === 'CANVAS') {
      this.buffersWrapperElem.appendChild(previousProjectorsBufferElem);
    }
    this.previousProjectorBuffer = {
      elem: previousProjectorsBufferElem,
      ctx: previousProjectorsBufferElem.getContext('2d', ctxOptions),
    };

    const blendedProjectorsBufferElem = new Canvas(
      this.projectorBuffer.elem.width,
      this.projectorBuffer.elem.height,
      true
    );
    if (blendedProjectorsBufferElem.tagName === 'CANVAS') {
      this.buffersWrapperElem.appendChild(blendedProjectorsBufferElem);
    }
    this.blendedProjectorBuffer = {
      elem: blendedProjectorsBufferElem,
      ctx: blendedProjectorsBufferElem.getContext('2d', ctxOptions),
    };
  }

  initVideoOverlayWithFrameBlending() {
    const videoOverlayBufferElem = new Canvas(
      this.srcVideoOffset.width,
      this.srcVideoOffset.height,
      true
    );
    if (videoOverlayBufferElem.tagName === 'CANVAS') {
      this.buffersWrapperElem.appendChild(videoOverlayBufferElem);
    }
    this.videoOverlayBuffer = {
      elem: videoOverlayBufferElem,
      ctx: videoOverlayBufferElem.getContext('2d', ctxOptions),
    };

    const previousVideoOverlayBufferElem = new Canvas(
      this.srcVideoOffset.width,
      this.srcVideoOffset.height,
      true
    );
    if (previousVideoOverlayBufferElem.tagName === 'CANVAS') {
      this.buffersWrapperElem.appendChild(previousVideoOverlayBufferElem);
    }
    this.previousVideoOverlayBuffer = {
      elem: previousVideoOverlayBufferElem,
      ctx: previousVideoOverlayBufferElem.getContext('2d', ctxOptions),
    };
  }

  async resetSettingsIfNeeded() {
    const videoPath = location.search;
    if (!this.prevVideoPath || videoPath !== this.prevVideoPath) {
      if (this.settings.horizontalBarsClipPercentageReset) {
        const horizontalBarChanged = this.setHorizontalBars(0);
        const verticalBarChanged = this.setVerticalBars(0);
        if (horizontalBarChanged || verticalBarChanged) {
          this.sizesChanged = true;
          await this.optionalFrame();
        }
      }
    }
    this.prevVideoPath = videoPath;
    await this.settings.updateHdr();
  }

  setHorizontalBars(percentage) {
    if (this.settings.horizontalBarsClipPercentage === percentage) return false;

    this.settings.set('horizontalBarsClipPercentage', percentage, true);
    return true;
  }

  setVerticalBars(percentage) {
    if (this.settings.verticalBarsClipPercentage === percentage) return false;

    this.settings.set('verticalBarsClipPercentage', percentage, true);
    return true;
  }

  recreateProjectors() {
    this.levels = Math.max(
      2,
      Math.round(this.settings.spread / this.settings.edge) +
        this.innerStrength +
        1
    );
    if (this.projector.recreate) {
      this.projector.recreate(this.levels);
    }
  }

  clear() {
    this.clearTime = performance.now();
    this.barDetection.clear();
    this.pageGlowCtx?.clearRect(0, 0, this.pageGlowCanvas.width, this.pageGlowCanvas.height);
    this.lastPageAmbientTintUpdate = 0;

    // Clear canvasses
    const canvasses = [];
    if (this.projector) {
      canvasses.push({ ctx: this.projector });
    }
    if (this.projectorBuffer) {
      canvasses.push(this.projectorBuffer);
    }
    if (this.previousProjectorBuffer) {
      canvasses.push(this.previousProjectorBuffer);
      canvasses.push(this.blendedProjectorBuffer);
    }
    if (this.videoOverlay) {
      canvasses.push(this.videoOverlay);
      if (this.videoOverlayBuffer) {
        canvasses.push(this.videoOverlayBuffer);
        canvasses.push(this.previousVideoOverlayBuffer);
      }
    }
    for (const canvas of canvasses) {
      if (canvas.ctx?.clearRect) {
        if (!canvas.ctx.isContextLost || !canvas.ctx.isContextLost()) {
          if (canvas.elem) {
            canvas.ctx.clearRect(0, 0, canvas.elem.width, canvas.elem.height);
          } else {
            canvas.ctx.clearRect();
          }
        }
      } else if (canvas.elem) {
        canvas.elem.width = 1;
      }
    }

    this.buffersCleared = true;
    this.sizesChanged = true;
    this.checkIfNeedToHideVideoOverlay();
    this.scheduleNextFrame();
  }

  updateVideoScale() {
    let videoScale = this.isVrVideo
      ? 100
      : this.settings[`videoScale.${this.view}`] ?? 100;

    if (
      this.settings.detectVideoFillScaleEnabled &&
      this.videoElem?.offsetWidth &&
      this.videoElem?.offsetHeight &&
      this.videoPlayerElem?.offsetWidth &&
      this.videoPlayerElem?.offsetHeight
    ) {
      const barScaleX = this.isVrVideo
        ? 1
        : (100 - this.settings.verticalBarsClipPercentage * 2) / 100;
      const barScaleY = this.isVrVideo
        ? 1
        : (100 - this.settings.horizontalBarsClipPercentage * 2) / 100;
      const barScaledVideoWidth = this.videoElem.offsetWidth * barScaleX;
      const barScaledVideoHeight = this.videoElem.offsetHeight * barScaleY;

      const containerWidth =
        this.videoPlayerElem.offsetWidth * (videoScale / 100);
      const containerHeight =
        this.videoPlayerElem.offsetHeight * (videoScale / 100);

      const filledVideoScaleX = containerWidth / barScaledVideoWidth;
      const filledVideoScaleY = containerHeight / barScaledVideoHeight;
      const filledVideoScale =
        Math.round(Math.min(filledVideoScaleX, filledVideoScaleY) * 10000) /
        100;

      if (
        !isNaN(filledVideoScale) &&
        !(filledVideoScale > 100 && filledVideoScale < 100.5)
      ) {
        videoScale = filledVideoScale;
      }
    }

    this.videoScale = videoScale;

    // Video scale
    setStyleProperty(
      document.body,
      '--ytal-html5-video-player-overflow',
      this.videoScale > 100 ? 'visible' : ''
    );
  }

  getView = () => {
    if (!this.settings.enabled) return VIEW_DISABLED;

    if (!document.contains(this.videoPlayerElem)) return VIEW_DETACHED;

    const screen = this.videoPlayerElem.getAttribute('data-screen');
    this.playerScreen = screen;

    if (
      document.fullscreenElement ||
      screen === 'web' ||
      screen === 'full'
    )
      return VIEW_FULLSCREEN;

    if (screen === 'wide') return VIEW_THEATER;
    if (screen === 'mini' || screen === 'pip') return VIEW_POPUP;

    return VIEW_SMALL;
  };

  initVR = () => {
    this.settings.setWarning('氛围灯不支持 VR 视频', false, false);
    this.settings.updateVisibility();
  };

  disposeVR = () => {
    this.vrVideoElem = undefined;
    this.settings.setWarning();
    this.settings.updateVisibility();
  };

  drawVR = () => {
    this.nextFrame();
  };

  updateView = async (skipUpdateImmersiveMode = false) => {
    const isVrVideo = this.videoPlayerElem?.classList?.contains(
      'ytp-webgl-spherical'
    );
    if (isVrVideo != this.isVrVideo) {
      this.isVrVideo = isVrVideo;
      this.sizesChanged = true;
    }
    if (!isVrVideo && this.vrVideoElem) this.disposeVR();

    const wasControlledByAnotherExtension = this.isControlledByAnotherExtension;
    this.isControlledByAnotherExtension =
      document.body.classList.contains('efyt-mini-player') ||
      this.videoElem?.classList.contains('stefanvdvideotop'); // Enhancer for YouTube
    if (
      wasControlledByAnotherExtension !== this.isControlledByAnotherExtension
    ) {
      this.sizesChanged = true;
    }

    const view = this.getView();
    const fullscreenElem = document.fullscreenElement;
    const fullscreenElemChanged = fullscreenElem !== this.fullscreenElem;
    const playerScreenChanged = this.playerScreen !== this.viewPlayerScreen;
    const contentElem =
      view === VIEW_FULLSCREEN
        ? this.getFullscreenContentElem()
        : this.getContentElem();
    const parentChanged = this.elem.parentElement !== contentElem;
    if (
      this.view === view &&
      !fullscreenElemChanged &&
      !playerScreenChanged &&
      !parentChanged
    )
      return false;

    this.view = view;
    this.viewPlayerScreen = this.playerScreen;
    this.fullscreenElem = fullscreenElem;
    this.sizesChanged = true;

    const isFullscreen = view == VIEW_FULLSCREEN;
    const fullscreenChanged = isFullscreen !== this.isFullscreen;
    this.isFullscreen = isFullscreen;

    this.updateFixedStyle();
    this.settings.updateVisibility();

    if (fullscreenChanged && this.settings.enabled && this.isOnVideoPage) {
      this.videoPlayerResizeFromFullscreen = !this.isFullscreen;
      this.videoPlayerResizeToFullscreen = this.isFullscreen;
    }

    if (fullscreenChanged || fullscreenElemChanged || parentChanged) {
      if (this.isFullscreen) {
        this.appendElemToFullscreenElem();
      } else {
        this.appendElemToContentElem();
      }
    }

    // Todo: Set the settings for the specific view
    // if(prevView !== this.view) {
    //   console.log('VIEW CHANGED: ', this.view)
    //   this.getAllSettings()
    // }

    // if (videoPlayerSizeUpdated) {
    //   console.log('videoPlayerSizeUpdated');
    if (!skipUpdateImmersiveMode) {
      await this.updateImmersiveMode();
      // Fullscreen can change while an asynchronous view update is pending.
      await this.updateView(true);
      raf(() => this.updateVideoPlayerSize()); // Always force youtube to recalculate the size because it caches the size per view without invalidation based on ambient light enabled/disabled
    }
    // }

    return true;
  };

  isInEnabledView = () => {
    const screen = this.videoPlayerElem?.getAttribute('data-screen');
    const enabledInView = {
      normal: this.settings.enableInNormal,
      wide: this.settings.enableInWide,
      web: this.settings.enableInWebFullscreen,
      full: this.settings.enableInFullscreen,
    }[screen];

    if (isEmbedPageUrl()) {
      return (
        this.settings.enableInEmbed &&
        (this.view !== VIEW_FULLSCREEN || enabledInView)
      );
    }

    const enabledInPictureInPicture =
      this.settings.enableInPictureInPicture || !this.videoIsPictureInPicture;

    return enabledInView && enabledInPictureInPicture;
  };

  async updateSizes() {
    await this.updateView();
    this.updateVideoScale();

    const noClipOrScale =
      this.isVrVideo ||
      (this.settings.horizontalBarsClipPercentage == 0 &&
        this.settings.verticalBarsClipPercentage == 0 &&
        this.videoScale == 100);

    const videoParentElem = this.videoElem.parentElement;

    const notVisible =
      !this.settings.enabled ||
      (this.isVrVideo && !this.settings.enableInVRVideos) ||
      !videoParentElem ||
      !this.videoPlayerElem ||
      !this.isInEnabledView();
    if (notVisible || noClipOrScale) {
      this.resetVideoParentElemStyle();
    }
    this.lastUpdateSizesChanged = performance.now();
    if (notVisible) {
      await this.hide();
      return false;
    }

    this.barsClip = [
      this.isVrVideo ? 0 : this.settings.verticalBarsClipPercentage,
      this.isVrVideo ? 0 : this.settings.horizontalBarsClipPercentage,
    ].map((percentage) => percentage / 100);
    this.clippedVideoScale = this.barsClip.map((clip) => 1 - clip * 2);
    this.shouldStyleVideoParentElem =
      this.isOnVideoPage &&
      !this.isVideoHiddenOnWatchPage &&
      !this.videoElem.ended &&
      !noClipOrScale &&
      !this.isControlledByAnotherExtension &&
      !this.videoPlayerElem?.classList?.contains('bpx-player-container');
    if (this.shouldStyleVideoParentElem) {
      const top = Math.max(0, parseInt(this.videoElem.style.top) || 0);
      const left = Math.max(0, parseInt(this.videoElem.style.left) || 0);
      const width = Math.max(0, parseInt(this.videoElem.style.width) || 0);
      videoParentElem.style.width = `${width}px`;
      videoParentElem.style.height = this.videoElem.style.height || '100%';
      videoParentElem.style.marginBottom = `${-this.videoElem.offsetHeight}px`;
      videoParentElem.style.overflow = 'hidden';
      videoParentElem.style.transform = `
        translate(${left}px, ${top}px)
        scale(${this.videoScale / 100}) 
        scale(${this.clippedVideoScale[0]}, ${this.clippedVideoScale[1]})
      `;
      const videoClipScale = this.clippedVideoScale.map(
        (scale) => Math.round(1000 * (1 / scale)) / 1000
      );
      setStyleProperty(
        videoParentElem,
        '--video-transform',
        `translate(${-left}px, ${-top}px) scale(${videoClipScale[0]}, ${
          videoClipScale[1]
        })`
      );
    } else {
      this.resetVideoParentElemStyle();
    }

    if (this.isVrVideo !== !!this.vrVideoElem) {
      if (this.isVrVideo) {
        this.initVR();
      } else {
        this.disposeVR();
      }
    }

    this.videoOffset = this.getElemRect(
      this.isVrVideo ? this.vrVideoElem : this.videoElem
    );
    this.isFillingFullscreen =
      this.isFullscreen &&
      Math.abs(this.videoOffset.width - window.innerWidth) < 10 &&
      Math.abs(this.videoOffset.height - window.innerHeight) < 10 &&
      noClipOrScale;

    if (
      this.videoOffset.top === undefined ||
      !this.videoOffset.width ||
      !this.videoOffset.height ||
      !this.videoElem.videoWidth ||
      !this.videoElem.videoHeight
    ) {
      this.scheduleSizeRetry();
      return false; //Not ready
    }

    const unscaledWidth = Math.round(
      this.videoOffset.width / (this.videoScale / 100)
    );
    const unscaledHeight = Math.round(
      this.videoOffset.height / (this.videoScale / 100)
    );
    const unscaledLeft = Math.round(
      this.videoOffset.left +
        window.scrollX -
        (unscaledWidth - this.videoOffset.width) / 2
    );
    const scrollYCorrection =
      this.ytdWatchElem?.tagName === 'YTD-WATCH-FIXIE' &&
      this.view === VIEW_SMALL
        ? window.scrollY
        : 0;
    const unscaledTop = Math.round(
      this.videoOffset.top -
        scrollYCorrection -
        (unscaledHeight - this.videoOffset.height) / 2
    );

    this.projectorsElem.style.left = `${unscaledLeft}px`;
    this.projectorsElem.style.top = `${unscaledTop - 1}px`;
    this.projectorsElem.style.width = `${unscaledWidth}px`;
    this.projectorsElem.style.height = `${unscaledHeight}px`;
    this.projectorsElem.style.transform = `
      scale(${this.videoScale / 100}) 
      scale(${this.clippedVideoScale[0]}, ${this.clippedVideoScale[1]})
    `;
    if (this.settings.webGL) this.projector.cropped = false;

    if (
      this.settings.videoShadowOpacity != 0 &&
      this.settings.videoShadowSize != 0
    ) {
      this.videoShadowElem.style.display = 'block';
      this.videoShadowElem.style.left = `${unscaledLeft}px`;
      this.videoShadowElem.style.top = `${unscaledTop}px`;
      this.videoShadowElem.style.width = `${
        unscaledWidth * this.clippedVideoScale[0]
      }px`;
      this.videoShadowElem.style.height = `${
        unscaledHeight * this.clippedVideoScale[1]
      }px`;
      this.videoShadowElem.style.transform = `
        translate3d(0,0,0)
        translate(${unscaledWidth * this.barsClip[0]}px, ${
        unscaledHeight * this.barsClip[1]
      }px)
        scale(${this.videoScale / 100})
      `;
      this.videoShadowElem.style.borderRadius = this.ytdPlayerElem
        ? getComputedStyle(this.ytdPlayerElem).borderRadius ?? ''
        : '';
    } else {
      this.videoShadowElem.style.display = '';
    }

    const contrast =
      this.settings.contrast +
      (this.isHdr ? this.settings.hdrContrast - 100 : 0);
    const brightness =
      this.settings.brightness +
      (this.isHdr ? this.settings.hdrBrightness - 100 : 0);
    const saturation =
      this.settings.saturation +
      (this.isHdr ? this.settings.hdrSaturation - 100 : 0);
    this.filterElem.style.filter = `
      ${
        !this.settings.webGL && blur != 0
          ? `blur(${Math.round(
              this.videoOffset.height * 0.0025 * this.settings.blur2
            )}px)`
          : ''
      }
      ${contrast != 100 ? `contrast(${contrast}%)` : ''}
      ${brightness != 100 ? `brightness(${brightness}%)` : ''}
      ${saturation != 100 ? `saturate(${saturation}%)` : ''}
    `.trim();

    this.srcVideoOffset = {
      top: this.videoOffset.top,
      width: this.vrVideoElem?.width ?? this.videoElem.videoWidth,
      height: this.vrVideoElem?.height ?? this.videoElem.videoHeight,
    };
    this.vrVideoSrcOffset = {
      width: this.videoElem.videoWidth,
      height: this.videoElem.videoHeight,
    };

    // Video box only. The page wash size lives in CSS as
    // --bili-page-glow-span. Do not write the video height into
    // that variable, or the wash collapses to the player.
    if (this.videoPlayerElem?.classList?.contains('bpx-player-container')) {
      const style = document.documentElement.style;
      style.setProperty('--bili-glow-left', `${Math.round(this.videoOffset.left)}px`);
      style.setProperty('--bili-glow-top', `${Math.round(this.videoOffset.top)}px`);
      style.setProperty('--bili-glow-width', `${Math.round(this.videoOffset.width)}px`);
      style.setProperty('--bili-video-height', `${Math.round(this.videoOffset.height)}px`);
      style.setProperty(
        '--bili-glow-center-x',
        `${Math.round(this.videoOffset.left + this.videoOffset.width / 2)}px`
      );
      style.setProperty(
        '--bili-glow-center-y',
        `${Math.round(this.videoOffset.top + this.videoOffset.height / 2)}px`
      );
    }

    let pScale;
    if (this.settings.webGL) {
      const relativeBlur =
        (this.settings.resolution / 100) *
        (this.isHdr ? 0 : this.settings.blur2);
      let pMinSize =
        (this.settings.resolution / 100) *
        (this.isHdr ? 2 : 1) *
        (this.settings.detectHorizontalBarSizeEnabled ||
        this.settings.detectVerticalBarSizeEnabled
          ? 256
          : relativeBlur >= 20
          ? 128
          : relativeBlur >= 10
          ? 192
          : 256);
      if (this.settings.spread > 200) pMinSize = pMinSize / 2;

      pScale = Math.min(
        0.5,
        Math.max(
          pMinSize / this.srcVideoOffset.width,
          pMinSize / this.srcVideoOffset.height
        ),
        Math.min(
          1024 / this.srcVideoOffset.width,
          1024 / this.srcVideoOffset.height
        )
      );
    } else {
      // A size of 512 videoWidth/videoHeight is required to prevent pixel flickering because CanvasContext2D uses no mipmaps
      // A CanvasContext2D size of > 256 is required to enable GPU acceleration in Chrome
      const pMinSize = Math.max(
        257,
        Math.min(512, this.srcVideoOffset.width, this.srcVideoOffset.height)
      );
      pScale = Math.max(
        pMinSize / this.srcVideoOffset.width,
        pMinSize / this.srcVideoOffset.height
      );
    }
    const p = {
      w: Math.ceil(this.srcVideoOffset.width * pScale),
      h: Math.ceil(this.srcVideoOffset.height * pScale),
    };
    if (this.p?.w !== p.w || this.p?.h !== p.h) {
      // console.log(`projector: ${this.srcVideoOffset.height} * ${pScale} = ${p.h}`)
      this.p = p;
    }
    this.projector.resize(this.p.w, this.p.h);

    if (this.projector.webGLVersion === 1) {
      const pbSize = Math.min(
        512,
        Math.max(this.srcVideoOffset.width, this.srcVideoOffset.height)
      );
      const pbSizePowerOf2 = Math.pow(
        2,
        1 + Math.ceil(Math.log(pbSize / 2) / Math.log(2))
      ); // projectorBuffer size must always be a power of 2 for WebGL1 mipmap generation in projector
      this.projectorBuffer.elem.width = pbSizePowerOf2;
      this.projectorBuffer.elem.height = pbSizePowerOf2;
    } else if (this.projector.webGLVersion === 2) {
      const projectorBufferWidth = this.p.w * 2;
      const projectorBufferHeight = this.p.h * 2;
      if (
        this.projectorBuffer.elem.width !== projectorBufferWidth ||
        this.projectorBuffer.elem.height !== projectorBufferHeight
      ) {
        // console.log(`projectorBuffer: ${this.p.h} * 2 = ${projectorBufferHeight}`)
        this.projectorBuffer.elem.width = projectorBufferWidth;
        this.projectorBuffer.elem.height = projectorBufferHeight;
      }
    } else {
      this.projectorBuffer.elem.width = this.p.w;
      this.projectorBuffer.elem.height = this.p.h;
    }

    const frameBlending = this.settings.frameBlending;
    if (frameBlending) {
      if (!this.previousProjectorBuffer || !this.blendedProjectorBuffer) {
        this.initFrameBlending();
      }
      this.previousProjectorBuffer.elem.width = this.projectorBuffer.elem.width;
      this.previousProjectorBuffer.elem.height =
        this.projectorBuffer.elem.height;
      this.blendedProjectorBuffer.elem.width = this.projectorBuffer.elem.width;
      this.blendedProjectorBuffer.elem.height =
        this.projectorBuffer.elem.height;
    }
    const videoOverlayEnabled = this.settings.videoOverlayEnabled;
    const videoOverlay = this.videoOverlay;
    if (videoOverlayEnabled && !videoOverlay) {
      this.initVideoOverlay();
    }
    if (
      videoOverlayEnabled &&
      frameBlending &&
      !this.previousVideoOverlayBuffer
    ) {
      this.initVideoOverlayWithFrameBlending();
    }
    if (videoOverlayEnabled) this.checkIfNeedToHideVideoOverlay();

    if (videoOverlayEnabled && videoOverlay && !videoOverlay.elem.parentNode) {
      if (this.videoElem) {
        this.videoElem.after(videoOverlay.elem);
      } else {
        if (!this.videoContainerElemMissingThrown) {
          ErrorReporter.captureException(
            new Error(
              'VideoOverlayEnabled but the .html5-video-container element does not exist'
            )
          );
          this.videoContainerElemMissingThrown = true;
        }
        this.videoContainerElemMissingWarning = true;
        this.settings.setWarning(
          '无法将视频与氛围灯同步：播放器视频容器不可用，请刷新页面后重试。'
        );
      }
    } else if (
      !videoOverlayEnabled &&
      videoOverlay &&
      videoOverlay.elem.parentNode
    ) {
      videoOverlay.elem.parentNode.removeChild(videoOverlay.elem);
    } else if (this.videoContainerElemMissingWarning) {
      this.settings.setWarning('');
      this.videoContainerElemMissingWarning = false;
    }

    const videoElemStyle = this.videoElem.getAttribute('style') || '';
    if (this.videoDebandingElem) {
      if (this.videoDebandingElem.getAttribute('style') !== videoElemStyle) {
        this.videoDebandingElem.setAttribute('style', videoElemStyle);
      }
      if (!this.videoDebandingElem.isConnected) {
        this.videoContainerElem.appendChild(this.videoDebandingElem);
      }
    }

    if (videoOverlayEnabled && videoOverlay) {
      if (videoOverlay.elem.getAttribute('style') !== videoElemStyle) {
        videoOverlay.elem.setAttribute('style', videoElemStyle);
      }
      let videoOverlayWidth = this.srcVideoOffset.width;
      let videoOverlayHeight = this.srcVideoOffset.height;
      if (this.videoElem.style.width && this.videoElem.style.height) {
        try {
          videoOverlayWidth = Math.min(
            this.srcVideoOffset.width,
            Math.round(
              parseInt(this.videoElem.style.width) * window.devicePixelRatio
            ) || this.videoElem.clientWidth
          );
          videoOverlayHeight = Math.min(
            this.srcVideoOffset.height,
            Math.round(
              parseInt(this.videoElem.style.height) * window.devicePixelRatio
            ) || this.videoElem.clientHeight
          );
        } catch {}

        this.videoOverlay.elem.width = videoOverlayWidth;
        this.videoOverlay.elem.height = videoOverlayHeight;
      }

      if (frameBlending) {
        this.videoOverlayBuffer.elem.width = videoOverlayWidth;
        this.videoOverlayBuffer.elem.height = videoOverlayHeight;

        this.previousVideoOverlayBuffer.elem.width = videoOverlayWidth;
        this.previousVideoOverlayBuffer.elem.height = videoOverlayHeight;
      }
    }

    this.resizeCanvasses();
    this.stats.initElems();

    this.sizesChanged = false;
    this.buffersCleared = true;
    this.sizeRetryCount = 0;
    return true;
  }

  resetVideoParentElemStyle() {
    this.shouldStyleVideoParentElem = false;
    const videoParentElem = this.videoElem.parentElement;
    if (videoParentElem) {
      videoParentElem.style.width = '';
      videoParentElem.style.transform = '';
      videoParentElem.style.overflow = '';
      videoParentElem.style.height = '';
      videoParentElem.style.marginBottom = '';
      setStyleProperty(videoParentElem, '--video-transform', '');
    }
  }

  updateFixedStyle() {
    const enable = this.settings.fixedPosition;
    document.body.toggleAttribute('data-ambientlight-fixed', enable);
  }

  updatePageAmbientTint() {
    if (this.isHidden || !this.settings.enabled || document.hidden) return;
    if (document.fullscreenElement || ['full', 'web'].includes(this.videoPlayerElem?.dataset.screen)) return;
    const source = this.projectorBuffer?.elem;
    if (!source || !source.width || !source.height) return;

    // Keep the large page canvas in step with the renderer. Expensive colour
    // extraction remains throttled below, so page glow motion is not capped at
    // the old 4 Hz tint-sampling interval.
    if (this.pageGlowCtx && source !== this.pageGlowCanvas) {
      try {
        this.pageGlowCtx.drawImage(
          source,
          0,
          0,
          this.pageGlowCanvas.width,
          this.pageGlowCanvas.height
        );
      } catch {
        // Source not ready yet; the next frame will retry.
      }
    }

    const now = performance.now();
    if (
      this.lastPageAmbientTintUpdate &&
      now - this.lastPageAmbientTintUpdate < 250
    )
      return;
    this.lastPageAmbientTintUpdate = now;

    try {
      if (!this.pageAmbientTintCanvas) {
        this.pageAmbientTintCanvas = document.createElement('canvas');
        this.pageAmbientTintCanvas.width = 8;
        this.pageAmbientTintCanvas.height = 8;
        this.pageAmbientTintContext = this.pageAmbientTintCanvas.getContext(
          '2d',
          { willReadFrequently: true }
        );
      }

      const ctx = this.pageAmbientTintContext;
      if (!ctx) return;
      ctx.clearRect(0, 0, 8, 8);
      // Draw the video as a 3x3 grid so the page glow keeps the video's own
      // colour structure instead of collapsing into one flat tint.
      ctx.drawImage(source, 0, 0, 3, 3);
      const data = ctx.getImageData(0, 0, 3, 3).data;

      const cells = [];
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let i = 0; i < 9; i++) {
        const o = i * 4;
        const cell = [data[o], data[o + 1], data[o + 2]];
        cells.push(cell);
        r += cell[0];
        g += cell[1];
        b += cell[2];
        count++;
      }
      if (!count) return;

      const avg = [r / count, g / count, b / count];
      const max = Math.max(...avg);
      const min = Math.min(...avg);
      const saturationBoost = min < max ? 1.18 : 1;
      let tint = avg.map((channel) =>
        Math.max(0, Math.min(255, Math.round(128 + (channel - 128) * saturationBoost)))
      );

      const isNightMode = this.theming.isDarkTheme();
      const luminance =
        avg[0] * 0.2126 + avg[1] * 0.7152 + avg[2] * 0.0722;
      const isDarkTint = luminance < 150;
      // On Bilibili's light theme a dark video would otherwise paint a dark
      // band across the header and rail; blend it into the light surface.
      if (!isNightMode && isDarkTint) {
        tint = tint.map((channel) => Math.round(channel * 0.42 + 236 * 0.58));
      }
      this.setPageAmbientProperty('--bili-ambient-rgb', tint.join(' '));

      // Project the 3x3 grid of sampled colours onto a rect that is scaled up
      // around the video, producing a giant blurred copy of the frame that
      // spreads across the whole page (the elegant YouTube look).
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const vw0 = Math.max(1, this.videoOffset.width);
      const vh0 = Math.max(1, this.videoOffset.height);
      const cx = this.videoOffset.left + vw0 / 2;
      const cy = this.videoOffset.top + vh0 / 2;
      const spread = Math.max((vw * 1.35) / vw0, (vh * 1.35) / vh0, 1.2);
      const gw = vw0 * spread;
      const gh = vh0 * spread;
      const radiusX = Math.round((gw / 3) * 1.75);
      const radiusY = Math.round((gh / 3) * 1.75);

      const boost = (v) => Math.max(0, Math.min(255, Math.round(v * 1.1)));
      for (let i = 0; i < 9; i++) {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = Math.round(cx + (col - 1) * (gw / 3));
        const y = Math.round(cy + (row - 1) * (gh / 3));
        const c = cells[i];
        this.setPageAmbientProperty(
          `--bili-glow-c${i}`,
          `${boost(c[0])} ${boost(c[1])} ${boost(c[2])}`
        );
        this.setPageAmbientProperty(`--bili-glow-x${i}`, `${x}px`);
        this.setPageAmbientProperty(`--bili-glow-y${i}`, `${y}px`);
      }
      this.setPageAmbientProperty('--bili-glow-rx', `${radiusX}px`);
      this.setPageAmbientProperty('--bili-glow-ry', `${radiusY}px`);

      if (this.pageGlowElem) {
        // Keep the wash well below full strength so the boundary where opaque
        // page chrome starts does not read as a hard-edged bright rectangle.
        this.pageGlowElem.style.opacity = isNightMode ? '0.72' : '0.6';
      }
      document.documentElement.toggleAttribute(
        'data-bili-ambient-dark-tint',
        isDarkTint
      );
      document.documentElement.setAttribute(
        'data-bili-ambient-theme',
        isNightMode ? 'dark' : 'light'
      );
    } catch {
      // Cross-origin canvas reads are already handled by getImageDataAllowed.
    }
  }

  setPageAmbientProperty(name, value) {
    const style = document.documentElement.style;
    this.pageAmbientProperties ||= new Map();
    let entry = this.pageAmbientProperties.get(name);
    // If another owner changed the value meanwhile, retain that new value
    // rather than restoring a stale snapshot when this extension closes.
    if (!entry || style.getPropertyValue(name) !== entry.written) {
      entry = { value: style.getPropertyValue(name), priority: style.getPropertyPriority(name) };
      this.pageAmbientProperties.set(name, entry);
    }
    if (style.getPropertyValue(name) !== value) style.setProperty(name, value);
    entry.written = value;
  }

  restorePageAmbientProperties() {
    const style = document.documentElement.style;
    for (const [name, entry] of this.pageAmbientProperties || []) {
      if (style.getPropertyValue(name) !== entry.written) continue;
      if (entry.value) style.setProperty(name, entry.value, entry.priority);
      else style.removeProperty(name);
    }
    this.pageAmbientProperties?.clear();
    document.documentElement.removeAttribute('data-bili-ambient-dark-tint');
  }

  updateStyles() {
    this.updateFixedStyle();

    // Page background
    let pageBackgroundGreyness = this.settings.pageBackgroundGreyness;
    pageBackgroundGreyness = pageBackgroundGreyness
      ? `${pageBackgroundGreyness}%`
      : '';
    setStyleProperty(
      document.body,
      '--ytal-page-background-greyness',
      pageBackgroundGreyness
    );

    // Fill transparency
    let fillOpacity = this.settings.surroundingContentFillOpacity;
    fillOpacity = fillOpacity !== 10 ? (fillOpacity + 100) / 200 : '';
    setStyleProperty(document.body, '--ytal-fill-opacity', fillOpacity);

    if (this.mastheadElem) {
      // Header transparency
      let headerFillOpacity = this.settings.headerFillOpacity;
      headerFillOpacity =
        headerFillOpacity !== 100 ? (headerFillOpacity + 100) / 200 : '';
      setStyleProperty(
        this.mastheadElem,
        '--ytal-fill-opacity',
        headerFillOpacity
      );
      this.mastheadElem.classList.toggle(
        'ytal-header-transparent',
        headerFillOpacity !== ''
      );
    }

    // Images transparency
    let imageOpacity = this.settings.surroundingContentImagesOpacity;
    imageOpacity = imageOpacity !== 100 ? imageOpacity / 100 : '';
    setStyleProperty(document.body, '--ytal-image-opacity', imageOpacity);

    if (this.mastheadElem) {
      // Header transparency
      let headerImageOpacity = this.settings.headerImagesOpacity;
      headerImageOpacity = imageOpacity !== 100 ? headerImageOpacity / 100 : '';
      setStyleProperty(
        this.mastheadElem,
        '--ytal-image-opacity',
        headerImageOpacity
      );
    }

    // Shadows
    const textAndBtnOnly = this.settings.surroundingContentTextAndBtnOnly;
    const getFilterShadow = (color, size, opacity) =>
      size && opacity
        ? opacity > 0.5
          ? `
          drop-shadow(0 0 ${size}px rgba(${color},${opacity})) 
          drop-shadow(0 0 ${size}px rgba(${color},${opacity}))
        `
          : `drop-shadow(0 0 ${size}px rgba(${color},${opacity * 2}))`
        : '';
    const getTextShadow = (color, size, opacity) =>
      size && opacity
        ? `
        rgba(${color},${opacity}) 0 0 ${size * 2}px,
        rgba(${color},${opacity}) 0 0 ${size * 2}px
      `
        : '';

    if (this.mastheadElem) {
      // Header shadow
      const headerShadowSize = this.settings.headerShadowSize / 5;
      const headerShadowOpacity = this.settings.headerShadowOpacity / 100;
      this.mastheadElem.classList.toggle(
        'ytal-header-shadow',
        headerShadowSize && headerShadowOpacity
      );

      const getHeaderFilterShadow = (color) =>
        getFilterShadow(color, headerShadowSize, headerShadowOpacity);
      const getHeaderTextShadow = (color) =>
        getTextShadow(color, headerShadowSize, headerShadowOpacity);

      // Header !textAndBtnOnly
      setStyleProperty(
        this.mastheadElem,
        `--ytal-filter-shadow`,
        !textAndBtnOnly ? getHeaderFilterShadow('0,0,0') : ''
      );
      setStyleProperty(
        this.mastheadElem,
        `--ytal-filter-shadow-inverted`,
        !textAndBtnOnly ? getHeaderFilterShadow('255,255,255') : ''
      );

      // Header textAndBtnOnly
      setStyleProperty(
        this.mastheadElem,
        `--ytal-button-shadow`,
        textAndBtnOnly ? getHeaderFilterShadow('0,0,0') : ''
      );
      setStyleProperty(
        this.mastheadElem,
        `--ytal-button-shadow-inverted`,
        textAndBtnOnly ? getHeaderFilterShadow('255,255,255') : ''
      );

      setStyleProperty(
        this.mastheadElem,
        '--ytal-text-shadow',
        textAndBtnOnly ? getHeaderTextShadow('0,0,0') : ''
      );
      setStyleProperty(
        this.mastheadElem,
        '--ytal-text-shadow-inverted',
        textAndBtnOnly ? getHeaderTextShadow('255,255,255') : ''
      );
      this.mastheadElem.toggleAttribute(
        'data-ambientlight-text-shadow',
        textAndBtnOnly
      );
    }

    // Content shadow
    const contentShadowSize = this.settings.surroundingContentShadowSize / 5;
    const contentShadowOpacity =
      this.settings.surroundingContentShadowOpacity / 100;
    const getContentFilterShadow = (color) =>
      getFilterShadow(color, contentShadowSize, contentShadowOpacity);
    const getContentTextShadow = (color) =>
      getTextShadow(color, contentShadowSize, contentShadowOpacity);

    // Content !textAndBtnOnly
    setStyleProperty(
      document.body,
      `--ytal-filter-shadow`,
      !textAndBtnOnly ? getContentFilterShadow('0,0,0') : ''
    );
    setStyleProperty(
      document.body,
      `--ytal-filter-shadow-inverted`,
      !textAndBtnOnly ? getContentFilterShadow('255,255,255') : ''
    );

    // Content textAndBtnOnly
    setStyleProperty(
      document.body,
      `--ytal-button-shadow`,
      textAndBtnOnly ? getContentFilterShadow('0,0,0') : ''
    );
    setStyleProperty(
      document.body,
      `--ytal-button-shadow-inverted`,
      textAndBtnOnly ? getContentFilterShadow('255,255,255') : ''
    );

    setStyleProperty(
      document.body,
      '--ytal-text-shadow',
      textAndBtnOnly ? getContentTextShadow('0,0,0') : ''
    );
    setStyleProperty(
      document.body,
      '--ytal-text-shadow-inverted',
      textAndBtnOnly ? getContentTextShadow('255,255,255') : ''
    );
    document.body.toggleAttribute(
      'data-ambientlight-text-shadow',
      textAndBtnOnly
    );

    // Video shadow
    const videoShadowSize =
      parseFloat(this.settings.videoShadowSize, 10) / 2 +
      Math.pow(this.settings.videoShadowSize / 5, 1.77); // Chrome limit: 250px | Firefox limit: 100px
    const videoShadowOpacity = this.settings.videoShadowOpacity / 100;

    setStyleProperty(
      document.body,
      '--ytal-video-shadow-background',
      videoShadowSize && videoShadowOpacity
        ? `rgba(0,0,0,${videoShadowOpacity})`
        : ''
    );
    setStyleProperty(
      document.body,
      '--ytal-video-shadow-box-shadow',
      videoShadowSize && videoShadowOpacity
        ? `
          rgba(0,0,0,${videoShadowOpacity}) 0 0 ${videoShadowSize}px,
          rgba(0,0,0,${videoShadowOpacity}) 0 0 ${videoShadowSize}px
        `
        : ''
    );

    // Video Debanding
    const videoDebandingStrength = parseFloat(
      this.settings.videoDebandingStrength
    );
    if (videoDebandingStrength) {
      if (!this.videoDebandingElem) {
        this.videoDebandingElem = document.createElement('div');
        this.videoDebandingElem.classList.add('ambientlight__video-debanding');
      }
      this.videoDebandingElem.setAttribute(
        'style',
        this.videoElem.getAttribute('style') || ''
      );
      if (!this.videoDebandingElem.isConnected) {
        this.videoContainerElem.appendChild(this.videoDebandingElem);
      }
    } else if (this.videoDebandingElem) {
      this.videoDebandingElem.remove();
      this.videoDebandingElem = undefined;
    }

    const videoNoiseImageIndex =
      videoDebandingStrength > 75 ? 3 : videoDebandingStrength > 50 ? 2 : 1;
    const videoNoiseOpacity =
      videoDebandingStrength /
      (videoDebandingStrength > 75
        ? 100
        : videoDebandingStrength > 50
        ? 75
        : 50);

    setStyleProperty(
      document.body,
      '--ytal-video-debanding-background',
      videoDebandingStrength
        ? `url('${baseUrl}images/noise-${videoNoiseImageIndex}.png')`
        : ''
    );
    setStyleProperty(
      document.body,
      '--ytal-video-debanding-opacity',
      videoDebandingStrength ? videoNoiseOpacity : ''
    );

    // Debanding
    const debandingStrength = parseFloat(this.settings.debandingStrength);
    const noiseImageIndex =
      debandingStrength > 75 ? 3 : debandingStrength > 50 ? 2 : 1;
    const noiseOpacity =
      debandingStrength /
      (debandingStrength > 75 ? 100 : debandingStrength > 50 ? 75 : 50);

    setStyleProperty(
      document.body,
      '--ytal-debanding-content',
      debandingStrength ? `''` : ''
    );
    setStyleProperty(
      document.body,
      '--ytal-debanding-background',
      debandingStrength
        ? `url('${baseUrl}images/noise-${noiseImageIndex}.png')`
        : ''
    );
    setStyleProperty(
      document.body,
      '--ytal-debanding-opacity',
      debandingStrength ? noiseOpacity : ''
    );
    setStyleProperty(
      document.body,
      '--ytal-debanding-blend-mode',
      {
        [DEBANDING_BLEND_MODE_LCD]: '',
        [DEBANDING_BLEND_MODE_OLED]: 'overlay',
      }[this.settings.debandingBlendMode]
    );
  }

  resizeCanvasses() {
    if (this.canvassesInvalidated) {
      this.recreateProjectors();
      this.canvassesInvalidated = false;
    }

    const projectorSize = {
      w: Math.round(this.p.w * this.clippedVideoScale[0]),
      h: Math.round(this.p.h * this.clippedVideoScale[1]),
    };
    const ratio =
      this.p.w > this.p.h
        ? {
            x: this.p.w / projectorSize.w,
            y:
              (this.p.w / projectorSize.w) *
              (projectorSize.w / projectorSize.h),
          }
        : {
            x:
              (this.p.h / projectorSize.h) *
              (projectorSize.h / projectorSize.w),
            y: this.p.h / projectorSize.h,
          };
    const lastScale = {
      x: 1,
      y: 1,
    };

    //To prevent 0x0 sized canvas elements causing a GPU memory leak
    const minScale = {
      x: 1 / projectorSize.w,
      y: 1 / projectorSize.h,
    };

    // Bilibili needs a noticeably wider halo than YouTube's default so the
    // glow reads as one soft gradient instead of a thin band at the edge.
    const isBilibiliLayout = !!this.videoPlayerElem?.classList?.contains(
      'bpx-player-container'
    );
    const scaleStep =
      (this.settings.edge / 100) * (isBilibiliLayout ? 2.6 : 1);
    const scales = [];
    for (let i = 0; i < this.levels; i++) {
      const pos = i - this.innerStrength;
      let scaleX = 1;
      let scaleY = 1;

      if (pos > 0) {
        scaleX = 1 + scaleStep * ratio.x * pos;
        scaleY = 1 + scaleStep * ratio.y * pos;
      }

      if (pos < 0) {
        scaleX = 1 - scaleStep * ratio.x * -pos;
        scaleY = 1 - scaleStep * ratio.y * -pos;
        if (scaleX < 0) scaleX = 0;
        if (scaleY < 0) scaleY = 0;
      }
      lastScale.x = scaleX;
      lastScale.y = scaleY;

      scales.push({
        x: Math.max(minScale.x, scaleX),
        y: Math.max(minScale.y, scaleY),
      });
    }

    this.projector.rescale(
      scales,
      lastScale,
      projectorSize,
      this.barsClip,
      this.settings
    );
  }

  updatedSizesChanged = false;
  updateSizesChanged(checkPosition) {
    if (this.updatedSizesChanged) {
      return;
    }

    this.sizesChanged =
      this.sizesChanged || this.getSizesChanged(checkPosition);
    this.lastUpdateSizesChanged = performance.now();
    this.sizesInvalidated = false;

    this.updatedSizesChanged = true;
    raf(() => {
      this.updatedSizesChanged = false;
    });
  }

  getSizesChanged(checkPosition = true) {
    //Resized
    if (this.previousEnabled !== this.settings.enabled) {
      this.previousEnabled = this.settings.enabled;
      return true;
    }

    //Auto quality moved up or down
    if (
      this.srcVideoOffset.width !==
        (this.vrVideoElem?.width ?? this.videoElem.videoWidth) ||
      this.srcVideoOffset.height !==
        (this.vrVideoElem?.height ?? this.videoElem.videoHeight)
    ) {
      return true;
    }
    if (
      this.isVrVideo &&
      (this.vrVideoSrcOffset?.width !== this.videoElem.videoWidth ||
        this.vrVideoSrcOffset?.height !== this.videoElem.videoHeight)
    ) {
      return true;
    }

    if (
      this.settings.videoOverlayEnabled &&
      this.videoOverlay &&
      this.videoElem.getAttribute('style') !==
        this.videoOverlay.elem.getAttribute('style')
    ) {
      return true;
    }

    const noClipOrScale =
      this.isVrVideo ||
      (this.settings.horizontalBarsClipPercentage == 0 &&
        this.settings.verticalBarsClipPercentage == 0 &&
        this.videoScale == 100);
    if (!noClipOrScale) {
      const videoParentElem = this.videoElem.parentElement;
      if (videoParentElem) {
        const videoTransform =
          videoParentElem.style.getPropertyValue('--video-transform');
        const left = Math.max(0, parseInt(this.videoElem.style.left) || 0);
        const top = Math.max(0, parseInt(this.videoElem.style.top) || 0);
        const scaleX =
          Math.round(1000 * (1 / this.clippedVideoScale[0])) / 1000;
        const scaleY =
          Math.round(1000 * (1 / this.clippedVideoScale[1])) / 1000;
        if (
          videoTransform.indexOf(`translate(${-left}px, ${-top}px)`) === -1 ||
          videoTransform.indexOf(`scale(${scaleX}, ${scaleY})`) === -1
        ) {
          return true;
        }
      }
    }

    if (checkPosition) {
      const projectorsElemRect = this.getElemRect(this.projectorsElem);
      const videoElemRect = this.getElemRect(
        this.vrVideoElem || this.videoElem
      );
      const topExtraOffset =
        !this.isVrVideo && this.settings.horizontalBarsClipPercentage
          ? videoElemRect.height *
            (this.settings.horizontalBarsClipPercentage / 100)
          : 0;
      const leftExtraOffset =
        !this.isVrVideo && this.settings.verticalBarsClipPercentage
          ? videoElemRect.width *
            (this.settings.verticalBarsClipPercentage / 100)
          : 0;
      const expectedProjectorsRect = {
        width: videoElemRect.width - leftExtraOffset * 2,
        height: videoElemRect.height - topExtraOffset * 2,
        top: videoElemRect.top + topExtraOffset,
        left: videoElemRect.left + leftExtraOffset,
      };
      if (
        Math.abs(projectorsElemRect.height - expectedProjectorsRect.height) >
          1 ||
        Math.abs(projectorsElemRect.width - expectedProjectorsRect.width) > 1 ||
        Math.abs(projectorsElemRect.top - expectedProjectorsRect.top) > 2 ||
        Math.abs(projectorsElemRect.left - expectedProjectorsRect.left) > 2
      ) {
        return true;
      }
    }

    return false;
  }

  getElemRect(elem) {
    const scrollableRect = (
      this.clearfixElem.offsetParent ||
      (this.isFullscreen
        ? document.fullscreenElement || document.body
        : document.body)
    ).getBoundingClientRect();
    let elemRect = elem.getBoundingClientRect();
    if (
      elem === this.videoElem &&
      (!elemRect.width || !elemRect.height)
    ) {
      const fallback = this.videoPlayerElem
        ?.querySelector('.bpx-player-video-area')
        ?.getBoundingClientRect();
      if (fallback) elemRect = fallback;
    }

    return {
      top: elemRect.top - scrollableRect.top,
      left: elemRect.left - scrollableRect.left,
      width: elemRect.width,
      height: elemRect.height,
    };
  }

  scheduleSizeRetry() {
    if (this.sizeRetryTimeout || this.sizeRetryCount >= 20) return;
    this.sizeRetryCount = (this.sizeRetryCount || 0) + 1;
    this.sizeRetryTimeout = setTimeout(
      wrapErrorHandler(async () => {
        this.sizeRetryTimeout = undefined;
        this.sizesChanged = true;
        await this.optionalFrame();
      }),
      100
    );
  }

  scheduleNextFrame() {
    if (this.scheduledNextFrame || !this.canScheduleNextFrame()) return;

    this.scheduleRequestVideoFrame();
    if (
      this.settings.frameSync == FRAMESYNC_VIDEOFRAMES &&
      this.requestVideoFrameCallbackId &&
      !this.videoIsHidden &&
      !this.settings.frameBlending &&
      !this.settings.frameFading &&
      !this.settings.showFrametimes
    )
      return;

    this.scheduledNextFrame = true;
    if (!this.videoIsHidden) {
      requestAnimationFrame(this.onNextFrameWrapped);
    } else {
      const realFramerateLimit = this.getRealFramerateLimit();
      const frameRate = Math.min(
        Math.max(this.videoFrameRate || 30),
        realFramerateLimit
      );
      setTimeout(this.scheduleNextFrameDelayed, frameRate);
    }
  }

  onNextFrame = async function onNextFrame(compose) {
    if (!this.scheduledNextFrame) return;

    this.scheduledNextFrame = false;
    if (this.videoElem.ended) return;

    this.displayFrameTime = compose;
    this.displayFrameCount++;

    if (
      this.settings.showFrametimes &&
      this.settings.frameSync !== FRAMESYNC_VIDEOFRAMES
    ) {
      const presentedFrames = this.getVideoFrameCount();
      if (
        this.settings.frameSync === FRAMESYNC_DISPLAYFRAMES ||
        this.settings.frameBlending ||
        this.previousPresentedFrames !== presentedFrames
      ) {
        this.stats.receiveAnimationFrametimes(compose, presentedFrames);
      }
      this.previousPresentedFrames = presentedFrames;
    }

    if (this.settings.framerateLimit || this.limitFramerateToSaveEnergy()) {
      await this.onNextLimitedFrame(compose);
    } else {
      await this.nextFrame(compose);
      this.nextFrameTime = undefined;
    }
  }.bind(this);
  onNextFrameWrapped = wrapErrorHandler(this.onNextFrame);
  scheduleNextFrameDelayed = () =>
    requestAnimationFrame(this.onNextFrameWrapped);

  onNextLimitedFrame = async (compose) => {
    const time = performance.now();
    if (
      this.nextFrameTime &&
      !this.buffersCleared &&
      !this.sizesChanged &&
      !this.sizesInvalidated
    ) {
      if (
        this.settings.frameSync === FRAMESYNC_VIDEOFRAMES &&
        !this.videoIsHidden
      ) {
        if (this.nextFrameTime > time && this.videoFrameCallbackReceived) {
          this.videoFrameCallbackReceived = false;
        }
        if (!this.videoFrameCallbackReceived) {
          this.scheduleNextFrame();
          return;
        }
      } else if (this.nextFrameTime > time) {
        this.scheduleNextFrame();
        return;
      }
    }

    const ambientlightFrameCount = this.ambientlightFrameCount;
    await this.nextFrame(compose);
    if (this.ambientlightFrameCount <= ambientlightFrameCount) {
      return;
    }

    const realFramerateLimit = this.getRealFramerateLimit();
    this.nextFrameTime = Math.max(
      (this.nextFrameTime || time) + 1000 / realFramerateLimit,
      time
    );
  };

  averageVideoFramesDifference5SecondsThreshold = 0.002;
  averageVideoFramesDifference1SecondThreshold = 0.0175;

  getRealFramerateLimit = () => {
    if (this.limitFramerateToSaveEnergy()) {
      if (
        this.averageVideoFramesDifference <
        this.averageVideoFramesDifference5SecondsThreshold
      )
        return 0.2; // 5 seconds
      if (
        this.averageVideoFramesDifference <
        this.averageVideoFramesDifference1SecondThreshold
      )
        return 1; // 1 seconds
    }

    const frameFading = this.settings.frameFading
      ? Math.round(Math.pow(this.settings.frameFading, 2))
      : 0;
    const frameFadingMax =
      15 * Math.pow(ProjectorWebGL.subProjectorDimensionMax, 2) - 1;
    const realFramerateLimit =
      this.settings.webGL && frameFading > frameFadingMax
        ? Math.max(
            1,
            (frameFadingMax / (frameFading || 1)) * this.settings.framerateLimit
          )
        : this.settings.framerateLimit;
    return realFramerateLimit;
  };

  limitFramerateToSaveEnergy = () =>
    this.averageVideoFramesDifference <
      this.averageVideoFramesDifference1SecondThreshold &&
    !this.sizesInvalidated &&
    !this.buffersCleared &&
    this.videoElem.currentTime > 5 &&
    this.videoElem.currentTime < this.videoElem.duration - 5;

  canScheduleNextFrame = () =>
    !(
      !this.settings.enabled ||
      !this.isOnVideoPage ||
      (this.isVrVideo && this.vrVideoElem) ||
      this.pendingStart ||
      this.videoElem.ended ||
      this.videoElem.paused ||
      this.videoElem.seeking ||
      this.isVideoHiddenOnWatchPage ||
      this.isAmbientlightHiddenOnWatchPage
    );

  optionalFrame = async (fromSettingChange = false) => {
    if (
      !this.initializedTime ||
      !this.settings.enabled ||
      !this.isOnVideoPage ||
      this.pendingStart ||
      this.resizeAfterFrames > 0 ||
      this.videoElem.ended ||
      (!this.videoElem.paused &&
        !this.videoElem.seeking &&
        this.scheduledNextFrame) ||
      (!fromSettingChange && this.isVrVideo && this.vrVideoElem)
    )
      return;

    await this.nextFrame();
  };

  nextFrame = async (compose) => {
    try {
      const frameTimes = this.settings.showFrametimes
        ? {
            frameStart: performance.now(),
          }
        : {};

      this.delayedUpdateSizesChanged = false;
      if (this.p && this.sizesInvalidated) {
        this.updateSizesChanged();
      }
      if (!this.p || this.sizesChanged) {
        //If was detected hidden by updateSizes, this.p won't be initialized yet
        if (!(await this.updateSizes())) return;
      } else {
        this.delayedUpdateSizesChanged = true;
      }

      let results = {};
      if (this.settings.showFrametimes) {
        this.stats.addVideoFrametimes(frameTimes, compose);
        frameTimes.drawStart = performance.now();
      }

      if (!this.settings.webGL || this.getImageDataAllowed) {
        results = (await this.drawAmbientlight(compose)) || {};
      }

      if (this.settings.showFrametimes) frameTimes.drawEnd = performance.now();

      this.scheduleNextFrame();

      if (results?.detectBarSize) {
        await this.scheduleBarSizeDetection();
      }

      if (
        this.settings.frameSync === FRAMESYNC_DISPLAYFRAMES ||
        results?.hasNewFrame ||
        this.settings.frameBlending
      ) {
        this.stats.addAmbientFrametimes(frameTimes);
      }

      if (
        this.afterNextFrameIdleCallback ||
        (!this.settings.videoOverlayEnabled &&
          !(
            this.delayedUpdateSizesChanged &&
            performance.now() - this.lastUpdateSizesChanged > 2000
          ) &&
          !(
            performance.now() - this.lastUpdateStatsTime >
            this.updateStatsInterval
          ))
      )
        return;

      this.afterNextFrameIdleCallback = requestIdleCallback(
        this.afterNextFrame,
        { timeout: 1000 / 30 }
      );
    } catch (ex) {
      this.setDrawWarning(ex);
      if (this.catchedErrors[ex.name]) {
        console.error(ex);
        return;
      }

      this.catchedErrors[ex.name] = true;
      if (
        [
          'SecurityError',
          'NS_ERROR_NOT_AVAILABLE',
          'NS_ERROR_OUT_OF_MEMORY',
        ].includes(ex.name)
      ) {
        console.warn('Failed to display the ambient light');
        console.error(ex);
        return;
      }

      throw ex;
    }
  };

  setDrawWarning = (ex) => {
    report('draw-warning', ex, 'error');
    const message =
      ex.name === 'SecurityError'
        ? '刷新页面可能会有所帮助，但更可能是浏览器不允许氛围灯读取此投稿视频的画面像素。其他视频通常不会出现此问题。'
        : `刷新页面可能会有所帮助。如果仍然失败，可能是此视频本身存在问题，也可以尝试搜索下方错误信息。\n\n错误：${ex.name}\n原因：${ex.message}`;

    this.settings.setWarning(
      `氛围灯显示失败\n\n${message}`
    );
  };

  afterNextFrame = async function afterNextFrame() {
    try {
      this.afterNextFrameIdleCallback = undefined;

      if (this.settings.videoOverlayEnabled) {
        this.detectFrameRates();
        this.checkIfNeedToHideVideoOverlay();
      }

      if (
        this.delayedUpdateSizesChanged &&
        performance.now() - this.lastUpdateSizesChanged > 2000
      ) {
        this.updateSizesChanged(true);
        if (this.sizesChanged) {
          await this.optionalFrame();
        }
      }
      if (
        performance.now() - this.lastUpdateStatsTime >
        this.updateStatsInterval
      ) {
        this.lastUpdateStatsTime = performance.now();
        requestIdleCallback(
          function afterNextFrameUpdateStats() {
            if (!this.settings.videoOverlayEnabled) {
              this.detectFrameRates();
            }
            this.stats.update();
          }.bind(this),
          { timeout: 100 }
        );
      }
    } catch (ex) {
      // Prevent recursive error reporting
      if (this.scheduledNextFrame) {
        cancelAnimationFrame(this.scheduledNextFrame);
        this.scheduledNextFrame = undefined;
      }

      throw ex;
    }
  }.bind(this);

  // Todo:
  // - Fix frame drops on 60hz monitors with a 50hz video playing?:
  //     Was caused by faulty NVidia 3050TI driver
  //     and chromium video callback being sometimes 1 frame delayed
  //     and requestVideoFrameCallback being executed at the end of the draw flow
  // - Do more complex logic at a later time
  detectFrameRate(list, count, currentFrameRate, currentFrameTime, update) {
    const time = currentFrameTime || performance.now();

    // Add new item
    let fps = 0;
    if (list.length) {
      if (count < list[0].count) {
        // Clear list with invalid values
        list.splice(0, list.length);
      } else {
        const previous = list[0];
        fps = Math.max(
          0,
          (count - previous.count) / ((time - previous.time) / 1000)
        );
      }
    }
    list.push({
      count,
      time,
      fps,
    });

    if (!update) return currentFrameRate;
    if (list.length < 2) return 0;

    // Remove old items
    const thresholdTime = time - this.frameCountHistory;
    const thresholdIndex = list.findIndex((i) => i.time >= thresholdTime);
    if (thresholdIndex > 0) list.splice(0, thresholdIndex - 1);

    // Calculate fps
    const aligableList = list.filter((i) => i.fps);
    if (!aligableList.length) return 0;

    aligableList.sort((a, b) => a.fps - b.fps);
    if (aligableList.length > 10) {
      const bound = Math.floor(aligableList.length / 16);
      aligableList.splice(0, bound);
      aligableList.splice(aligableList.length - bound, bound);
    }

    const difference = Math.min(
      5,
      aligableList[aligableList.length - 1].fps - aligableList[0].fps
    );
    const deleteCount = Math.min(
      aligableList.length - 2,
      Math.max(0, Math.floor(aligableList.length * (difference / 5) - 2))
    );
    if (deleteCount) {
      aligableList.sort((a, b) => a.time - b.time);
      aligableList.splice(0, deleteCount);
    }

    const average =
      aligableList.reduce((sum, i) => sum + i.fps, 0) / aligableList.length;

    return average;
  }

  detectFrameRates() {
    const update =
      performance.now() > (this.previousUpdate || 0) + this.updateStatsInterval;
    if (update) this.previousUpdate = performance.now();
    this.detectDisplayFrameRate(update);
    this.detectAmbientlightFrameRate(update);
    this.detectVideoFrameRate(update);

    if (this.chromiumBugVideoJitterWorkaround?.update)
      this.chromiumBugVideoJitterWorkaround.update();
  }

  videoFrameCounts = [];
  detectVideoFrameRate(update) {
    this.videoFrameRate = this.detectFrameRate(
      this.videoFrameCounts,
      this.getVideoFrameCount(),
      this.videoFrameRate,
      this.videoFrameTime,
      update
    );
    this.videoFrameTime = undefined;
  }

  displayFrameCounts = [];
  displayFrameCount = 0;
  detectDisplayFrameRate = (update) => {
    this.displayFrameRate = this.detectFrameRate(
      this.displayFrameCounts,
      this.displayFrameCount,
      this.displayFrameRate,
      this.displayFrameTime,
      update
    );
    this.displayFrameTime = undefined;
  };

  ambientlightFrameCounts = [];
  detectAmbientlightFrameRate(update) {
    this.ambientlightFrameRate = this.detectFrameRate(
      this.ambientlightFrameCounts,
      this.ambientlightFrameCount,
      this.ambientlightFrameRate,
      this.ambientlightFrameTime,
      update
    );
    this.ambientlightFrameTime = undefined;
  }

  getVideoDroppedFrameCount() {
    if (!this.videoElem) return 0;

    return this.videoElem.getVideoPlaybackQuality()?.droppedVideoFrames || 0;
  }

  getVideoFrameCount() {
    if (!this.videoElem) return 0;

    const videoPresentedFrames =
      this.settings.frameSync === FRAMESYNC_VIDEOFRAMES &&
      this.videoPresentedFrames
        ? this.videoPresentedFrames
        : 0;

    const totalVideoFrames =
      this.videoElem.getVideoPlaybackQuality()?.totalVideoFrames || 0;
    return Math.max(videoPresentedFrames, totalVideoFrames);
  }

  shouldShow = () =>
    this.settings.enabled &&
    this.isOnVideoPage &&
    !(this.isVrVideo && !this.settings.enableInVRVideos) &&
    this.isInEnabledView();

  async drawAmbientlight(compose) {
    const shouldShow = this.shouldShow();
    if (!shouldShow) {
      if (!this.isHidden) await this.hide();
      return;
    }

    const drawTime = performance.now();
    if (this.isHidden) this.show();

    if (
      (this.atTop &&
        this.isFillingFullscreen &&
        !this.settings.detectHorizontalBarSizeEnabled &&
        !this.settings.detectVerticalBarSizeEnabled &&
        !this.settings.frameBlending &&
        !this.settings.videoOverlayEnabled) ||
      this.isControlledByAnotherExtension ||
      this.isVideoHiddenOnWatchPage ||
      // this.isAmbientlightHiddenOnWatchPage || // Disabled because: When in fullscreen isFillingFullscreen goes to false the observer needs a frame to render the shown ambientlight element. So instead handle this in the canScheduleNextFrame check
      this.videoElem.ended ||
      this.videoElem.readyState === 0 || // HAVE_NOTHING
      this.videoElem.readyState === 1 // HAVE_METADATA
      // The video contains metadata about the resolution so videoWidth and videoHeight are set.
      // But the video could have no framedata yet. On Firefox this can result in a failed draw call
      // to WebGL into a texture with a 0x0 resolution.
      // And then the next videoframes will also fail because they are drawn into a 0x0 texture.
      // This can result in any of the following WebGL warnings:
      // - [.WebGL-0000772807FD7100] GL_INVALID_OPERATION: Texture format does not support mipmap generation.
      // - tex(Sub)Image[23]D: Resource has no data (yet?). Uploading zeros.
      // - texSubImage: source cannot be null.
      // - generateMipmap: The texture's base level must be complete.
      // - drawArraysInstanced: TEXTURE_2D at unit 1 is incomplete: The dimensions of level_base are not all positive.
    ) {
      if (!this.drawSkippedReported) {
        this.drawSkippedReported = true;
        report('draw-skipped', {
          readyState: this.videoElem.readyState,
          paused: this.videoElem.paused,
          seeking: this.videoElem.seeking,
          ended: this.videoElem.ended,
          atTop: this.atTop,
          isFillingFullscreen: this.isFillingFullscreen,
          isControlledByAnotherExtension: this.isControlledByAnotherExtension,
          isVideoHiddenOnWatchPage: this.isVideoHiddenOnWatchPage,
        });
      }
      return;
    }

    let newVideoFrameCount = this.getVideoFrameCount();

    let hasNewFrame = false;
    if (this.settings.frameSync == FRAMESYNC_VIDEOFRAMES) {
      if (this.videoIsHidden) {
        hasNewFrame =
          this.previousFrameTime <
          drawTime - 1000 / Math.max(24, this.videoFrameRate); // Force video.webkitDecodedFrameCount to update on Chromium by always executing drawImage
      } else {
        if (
          this.videoFrameCallbackReceived &&
          this.videoFrameCount == newVideoFrameCount
        ) {
          newVideoFrameCount++;
        }
        hasNewFrame = this.videoFrameCallbackReceived;
        this.videoFrameCallbackReceived = false;

        // Fallback for when requestVideoFrameCallback stopped working
        if (!hasNewFrame) {
          hasNewFrame = this.videoFrameCount < newVideoFrameCount;
        }
      }
    } else if (this.settings.frameSync == FRAMESYNC_DECODEDFRAMES) {
      hasNewFrame = this.videoFrameCount < newVideoFrameCount;
    } else if (this.settings.frameSync == FRAMESYNC_DISPLAYFRAMES) {
      hasNewFrame = true;
    }
    hasNewFrame = hasNewFrame || this.buffersCleared || this.isVrVideo;

    const droppedFrames =
      this.videoFrameCount > 120 &&
      this.videoFrameCount < newVideoFrameCount - 1;
    if (droppedFrames && !this.buffersCleared) {
      this.ambientlightVideoDroppedFrameCount +=
        newVideoFrameCount - (this.videoFrameCount + 1);
    }
    if (
      newVideoFrameCount > this.videoFrameCount ||
      newVideoFrameCount < this.videoFrameCount - 60
    ) {
      this.videoFrameCount = newVideoFrameCount;
    }

    const detectBarSize =
      hasNewFrame &&
      (this.settings.detectHorizontalBarSizeEnabled ||
        this.settings.detectVerticalBarSizeEnabled) &&
      !this.isVrVideo;

    const dontDrawAmbientlight =
      (this.atTop && this.isFillingFullscreen) ||
      (this.settings.spread === 0 && this.settings.blur2 === 0);

    const dontDrawBuffer = dontDrawAmbientlight && !detectBarSize;

    if (this.settings.frameBlending && this.settings.frameBlendingSmoothness) {
      if (!this.previousProjectorBuffer) {
        this.initFrameBlending();
      }
      if (
        this.settings.videoOverlayEnabled &&
        !this.previousVideoOverlayBuffer
      ) {
        this.initVideoOverlayWithFrameBlending();
      }

      // Prevents unnessecary frames from being drawn.
      // But when frameBlending is enabled also draw:
      // - when there is a new frame (hasNewFrame) or...
      // - when the current frame is not yet fully drawn (!previousDrawFullAlpha)
      if (hasNewFrame || this.buffersCleared || !this.previousDrawFullAlpha) {
        if (hasNewFrame || this.buffersCleared) {
          if (this.settings.videoOverlayEnabled) {
            this.previousVideoOverlayBuffer.ctx.drawImage(
              this.videoOverlayBuffer.elem,
              0,
              0
            );
            this.videoOverlayBuffer.ctx.drawImage(
              this.vrVideoElem ?? this.videoElem,
              0,
              0,
              this.videoOverlayBuffer.elem.width,
              this.videoOverlayBuffer.elem.height
            );
            if (this.buffersCleared) {
              this.previousVideoOverlayBuffer.ctx.drawImage(
                this.videoOverlayBuffer.elem,
                0,
                0
              );
            }
          }

          if (!dontDrawBuffer) {
            if (!this.buffersCleared) {
              this.previousProjectorBuffer.ctx.drawImage(
                this.projectorBuffer.elem,
                0,
                0
              );
            }
            // Prevent adjusted barsClipPx from leaking previous frame into the frame
            this.projectorBuffer.ctx.clearRect(
              0,
              0,
              this.projectorBuffer.elem.width,
              this.projectorBuffer.elem.height
            );

            this.projectorBuffer.ctx.drawImage(
              this.vrVideoElem ?? this.videoElem,
              0,
              0,
              this.projectorBuffer.elem.width,
              this.projectorBuffer.elem.height
            );
            if (this.buffersCleared) {
              this.previousProjectorBuffer.ctx.drawImage(
                this.projectorBuffer.elem,
                0,
                0
              );
            }
          }
        }

        let alpha = 1;
        const ambientlightFrameDuration = 1000 / this.ambientlightFrameRate;
        if (hasNewFrame) {
          this.frameBlendingFrameTimeStart =
            drawTime - ambientlightFrameDuration / 2;
        }
        if (this.displayFrameRate >= this.videoFrameRate * 1.33) {
          if (hasNewFrame && !this.previousDrawFullAlpha) {
            alpha = 0; // Show previous frame fully to prevent seams
          } else {
            const videoFrameDuration = 1000 / this.videoFrameRate;
            const frameToDrawDuration =
              drawTime - this.frameBlendingFrameTimeStart;
            const frameToDrawDurationThresshold =
              (frameToDrawDuration + ambientlightFrameDuration / 2) /
              (this.settings.frameBlendingSmoothness / 100);
            if (frameToDrawDurationThresshold < videoFrameDuration) {
              alpha = Math.min(
                1,
                frameToDrawDuration /
                  (1000 /
                    (this.videoFrameRate /
                      (this.settings.frameBlendingSmoothness / 100) || 1))
              );
            }
          }
        }
        if (alpha === 1) {
          this.previousDrawFullAlpha = true;
        } else {
          this.previousDrawFullAlpha = false;
        }

        if (
          this.settings.videoOverlayEnabled &&
          this.videoOverlay &&
          !this.videoOverlay.isHidden
        ) {
          if (alpha !== 1) {
            if (this.videoOverlay.ctx.globalAlpha !== 1) {
              this.videoOverlay.ctx.globalAlpha = 1;
            }
            this.videoOverlay.ctx.drawImage(
              this.previousVideoOverlayBuffer.elem,
              0,
              0
            );
          }
          if (alpha > 0.005) {
            this.videoOverlay.ctx.globalAlpha = alpha;
            this.videoOverlay.ctx.drawImage(this.videoOverlayBuffer.elem, 0, 0);
          }
          this.videoOverlay.ctx.globalAlpha = 1;
        }

        if (!dontDrawAmbientlight) {
          //this.blendedProjectorBuffer can contain an old frame and be impossible to drawImage onto
          //this.previousProjectorBuffer can also contain an old frame

          if (alpha !== 1) {
            if (this.blendedProjectorBuffer.ctx.globalAlpha !== 1)
              this.blendedProjectorBuffer.ctx.globalAlpha = 1;
            this.blendedProjectorBuffer.ctx.drawImage(
              this.previousProjectorBuffer.elem,
              0,
              0
            );
          }
          if (alpha > 0.005) {
            this.blendedProjectorBuffer.ctx.globalAlpha = alpha;
            this.blendedProjectorBuffer.ctx.drawImage(
              this.projectorBuffer.elem,
              0,
              0
            );
          }
          this.blendedProjectorBuffer.ctx.globalAlpha = 1;

          this.projector.draw(this.blendedProjectorBuffer.elem);
          if (!this.firstFrameDrawReported) {
            this.firstFrameDrawReported = true;
            report('first-frame-drawn', {
              renderer: 'webgl',
              projectorSize: this.p,
              sourceSize: {
                width: this.projectorBuffer.elem.width,
                height: this.projectorBuffer.elem.height,
              },
              targetSize: this.projector.elem
                ? {
                    width: this.projector.elem.width,
                    height: this.projector.elem.height,
                  }
                : null,
              rootParentClass: this.elem.parentElement?.className,
              rootRect: this.elem.getBoundingClientRect(),
              projectorRect: this.projectorsElem.getBoundingClientRect(),
            });
          }
        }
      }
    } else {
      if (!hasNewFrame && !this.settings.frameFading) return;

      if (
        this.settings.videoOverlayEnabled &&
        this.videoOverlay &&
        !this.videoOverlay.isHidden
      ) {
        if (this.enableChromiumBug1092080Workaround) {
          this.videoOverlay.ctx.clearRect(
            0,
            0,
            this.videoOverlay.elem.width,
            this.videoOverlay.elem.height
          );
        }
        this.videoOverlay.ctx.drawImage(
          this.vrVideoElem ?? this.videoElem,
          0,
          0,
          this.videoOverlay.elem.width,
          this.videoOverlay.elem.height
        );
      }

      const shouldDrawDirectlyFromVideoElem =
        this.shouldDrawDirectlyFromVideoElem();
      if (!dontDrawBuffer) {
        if (!shouldDrawDirectlyFromVideoElem) {
          // console.log('draw', hasNewFrame, dontDrawAmbientlight, this.projectorBuffer.elem.width, this.projectorBuffer.elem.height)
          this.projectorBuffer.ctx.drawImage(
            this.vrVideoElem ?? this.videoElem,
            0,
            0,
            this.projectorBuffer.elem.width,
            this.projectorBuffer.elem.height
          );
        }

        if (!dontDrawAmbientlight) {
          if (!shouldDrawDirectlyFromVideoElem) {
            this.projector.draw(this.projectorBuffer.elem);
          } else {
            this.projector.draw(this.vrVideoElem ?? this.videoElem);
          }
        }
      }

      if (!this.firstFrameDrawReported) {
        this.firstFrameDrawReported = true;
        report('first-frame-drawn', {
          renderer: this.settings.webGL ? 'webgl-direct' : 'canvas2d',
          projectorSize: this.p,
          sourceSize: this.projectorBuffer?.elem
            ? {
                width: this.projectorBuffer.elem.width,
                height: this.projectorBuffer.elem.height,
              }
            : null,
          targetSize: this.projector?.elem
            ? {
                width: this.projector.elem.width,
                height: this.projector.elem.height,
              }
            : null,
          rootParentClass: this.elem.parentElement?.className,
          rootRect: this.elem.getBoundingClientRect(),
          projectorRect: this.projectorsElem.getBoundingClientRect(),
        });
      }
    }

    this.buffersCleared = false;
    if (!dontDrawBuffer || this.settings.videoOverlayEnabled) {
      this.ambientlightFrameCount++;
      this.ambientlightFrameTime = compose;
    }
    this.previousDrawTime = drawTime;
    if (hasNewFrame) {
      this.previousFrameTime = drawTime;
    }

    if (this.enableMozillaBug1606251Workaround) {
      this.containerElem.style.transform = `translateZ(${
        this.ambientlightFrameCount % 10
      }px)`;
    }

    this.updatePageAmbientTint();

    return { hasNewFrame, detectBarSize };
  }

  scheduleBarSizeDetection = async () => {
    try {
      this.checkGetImageDataAllowed();
      if (!this.getImageDataAllowed) return;

      await this.barDetection.detect(
        this.shouldDrawDirectlyFromVideoElem() ||
          ((this.projectorBuffer.elem.height < 256 ||
            this.projectorBuffer.elem.width < 256) &&
            this.projectorBuffer.elem.height < this.videoElem.videoHeight)
          ? this.videoElem
          : this.projectorBuffer.elem,
        this.settings.detectColoredHorizontalBarSizeEnabled,
        this.settings.detectHorizontalBarSizeOffsetPercentage,
        this.settings.detectHorizontalBarSizeEnabled,
        this.settings.horizontalBarsClipPercentage,
        this.settings.detectVerticalBarSizeEnabled,
        this.settings.verticalBarsClipPercentage,
        this.p ? this.p.h / this.p.w : 1,
        !this.settings.frameBlending,
        this.settings.barSizeDetectionAverageHistorySize || 1,
        this.settings.barSizeDetectionAllowedElementsPercentage || 20,
        this.settings.barSizeDetectionAllowedUnevenBarsPercentage || 20,
        wrapErrorHandler(this.scheduleBarSizeDetectionCallback)
      );
    } catch (ex) {
      if (!this.showedDetectBarSizeWarning) {
        this.showedDetectBarSizeWarning = true;
        throw ex;
      }
    }
  };

  scheduleBarSizeDetectionCallback = async (
    horizontalPercentage,
    verticalPercentage
  ) => {
    const horizontalBarChanged =
      this.settings.detectHorizontalBarSizeEnabled &&
      horizontalPercentage !== undefined &&
      this.setHorizontalBars(horizontalPercentage);
    const verticalBarChanged =
      this.settings.detectVerticalBarSizeEnabled &&
      verticalPercentage !== undefined &&
      this.setVerticalBars(verticalPercentage);
    if (!horizontalBarChanged && !verticalBarChanged) return;

    this.sizesChanged = true;
    await this.optionalFrame();
  };

  checkIfNeedToHideVideoOverlay() {
    if (!this.videoOverlay) return;

    if (!this.hideVideoOverlayCache) {
      this.hideVideoOverlayCache = {
        prevAmbientlightVideoDroppedFrameCount:
          this.ambientlightVideoDroppedFrameCount,
        framesInfo: [],
        isHiddenChangeTimestamp: 0,
      };
    }

    let {
      prevAmbientlightVideoDroppedFrameCount,
      framesInfo,
      isHiddenChangeTimestamp,
    } = this.hideVideoOverlayCache;

    const newFramesDropped = Math.max(
      0,
      this.ambientlightVideoDroppedFrameCount -
        prevAmbientlightVideoDroppedFrameCount
    );
    this.hideVideoOverlayCache.prevAmbientlightVideoDroppedFrameCount =
      this.ambientlightVideoDroppedFrameCount;
    framesInfo.push({
      time: performance.now(),
      framesDropped: newFramesDropped,
    });
    const frameDropTimeLimit = performance.now() - 2000;
    framesInfo = framesInfo.filter((info) => info.time > frameDropTimeLimit);
    this.hideVideoOverlayCache.framesInfo = framesInfo;

    let hide =
      this.videoElem.paused ||
      this.videoElem.seeking ||
      this.videoIsHidden ||
      (this.isFillingFullscreen && this.atTop && !this.settings.frameBlending);
    const syncThreshold = this.settings.videoOverlaySyncThreshold;
    if (!hide && syncThreshold !== 100) {
      if (framesInfo.length < 5) {
        hide = true;
      } else {
        const droppedFramesCount = framesInfo.reduce(
          (sum, info) => sum + info.framesDropped,
          0
        );
        const droppedFramesThreshold =
          this.videoFrameRate * 2 * (syncThreshold / 100);
        hide = droppedFramesCount > droppedFramesThreshold;
      }
    }

    if (hide) {
      if (!this.videoOverlay.isHidden) {
        this.videoOverlay.elem.classList.add(
          'ambientlight__video-overlay--hide'
        );
        this.videoOverlay.isHidden = true;
        this.hideVideoOverlayCache.isHiddenChangeTimestamp = performance.now();
        this.stats.update();
      }
    } else if (
      syncThreshold == 100 ||
      isHiddenChangeTimestamp + 2000 < performance.now()
    ) {
      if (this.videoOverlay.isHidden) {
        this.videoOverlay.elem.classList.remove(
          'ambientlight__video-overlay--hide'
        );
        this.videoOverlay.isHidden = false;
        this.hideVideoOverlayCache.isHiddenChangeTimestamp = performance.now();
        this.stats.update();
      }
    }
  }

  async enable(initial = false) {
    if (!initial) {
      this.settings.set('enabled', true, true);
    }

    await this.start(initial);
  }

  // async disableYouTubeAmbientMode() {
  //   try {
  //     if(
  //       !ytcfg?.data_?.WEB_PLAYER_CONTEXT_CONFIGS.WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH?.cinematicSettingsAvailable ||
  //       !ytcfg?.data_?.EXPERIMENT_FLAGS?.kevlar_watch_cinematics
  //     ) return

  //     const ambientModeIcon = 'path[d="M21 7v10H3V7h18m1-1H2v12h20V6zM11.5 2v3h1V2h-1zm1 17h-1v3h1v-3zM3.79 3 6 5.21l.71-.71L4.5 2.29 3.79 3zm2.92 16.5L6 18.79 3.79 21l.71.71 2.21-2.21zM19.5 2.29 17.29 4.5l.71.71L20.21 3l-.71-.71zm0 19.42.71-.71L18 18.79l-.71.71 2.21 2.21z"]'
  //     let ambientModeCheckbox = document.querySelector(`.ytp-menuitem ${ambientModeIcon}`)?.closest('.ytp-menuitem')

  //     if(ambientModeCheckbox) {
  //       const enabled = ambientModeCheckbox.getAttribute('aria-checked') === 'true'
  //       if(enabled) {
  //         ambientModeCheckbox.click()
  //       }
  //       return
  //     }

  //     const settingsBtn = document.querySelector('.ytp-settings-button')
  //     const settingsPopupId = settingsBtn?.getAttribute('aria-controls')
  //     const settingsPopup = document.querySelector(`.ytp-popup[id="${settingsPopupId}"]`)
  //     settingsPopup.classList.add('disable-youtube-ambient-mode-workaround')
  //     await new Promise(resolve => raf(resolve)) // Await rendering
  //     const wasActiveElement = document.activeElement
  //     settingsBtn?.click() // Open settings

  //     try {
  //       await new Promise(resolve => raf(resolve)) // Await rendering
  //       await waitForDomElement(() => document.querySelector(`.ytp-menuitem ${ambientModeIcon}`), document.querySelector('.html5-video-player'), 1000)
  //       ambientModeCheckbox = document.querySelector(`.ytp-menuitem ${ambientModeIcon}`)?.closest('.ytp-menuitem')
  //       if(ambientModeCheckbox) {
  //         const enabled = ambientModeCheckbox.getAttribute('aria-checked') === 'true'
  //         if(enabled) {
  //           ambientModeCheckbox.click()
  //         }
  //       }
  //     } catch(ex) {
  //       console.log(`Skipped disabling YouTube\'s own Ambient Mode: ${ex?.message}`)
  //     }

  //     settingsBtn?.click() // Close settings
  //     await new Promise(resolve => raf(resolve)) // Await rendering

  //     if(document.activeElement == settingsBtn && wasActiveElement !== settingsBtn) {
  //       if(wasActiveElement) {
  //         wasActiveElement.focus()
  //       } else {
  //         settingsBtn.blur()
  //       }
  //     }

  //     await new Promise(resolve => setTimeout(resolve, 500)) // Await close animation
  //     await new Promise(resolve => raf(resolve)) // Await rendering
  //     settingsPopup.classList.remove('disable-youtube-ambient-mode-workaround')
  //   } catch(ex) {
  //     console.log(`Failed to automatically disable YouTube\'s own Ambient Mode: ${ex?.message}`)
  //   }
  // }

  async disable() {
    if (this.pendingStart) return;
    this.settings.closeMenuImmediately();
    this.settings.set('enabled', false, true);

    this.updateKeywordsToPreventTheaterScaling();

    await this.hide();
  }

  start = async (initial = false) => {
    report('start-requested', {
      initial,
      enabled: this.settings.enabled,
      isOnVideoPage: this.isOnVideoPage,
      initializedTime: this.initializedTime,
      pendingStart: this.pendingStart,
    });
    if (!this.isOnVideoPage || !this.settings.enabled || this.pendingStart)
      return;

    await this.updateHdr();
    this.showedCompareWarning = false;
    this.showedDetectBarSizeWarning = false;
    this.nextFrameTime = undefined;
    this.ambientlightVideoDroppedFrameCount = 0;
    this.buffersCleared = true; // Prevent old frame from preventing the new frame from being drawn
    this.barDetection.reset();

    this.checkGetImageDataAllowed();
    await this.resetSettingsIfNeeded();
    this.updateKeywordsToPreventTheaterScaling();
    await this.updateView(true);

    this.pendingStart = true;
    if (initial) {
      if (document.visibilityState === 'hidden') {
        await new Promise((resolve) => raf(resolve));
      }
    }
    this.pendingStart = undefined;

    if (this.shouldShow()) await this.show();

    // Continue only if still enabled after await
    if (!this.settings.enabled || !this.isOnVideoPage) return;

    this.calculateAverageVideoFramesDifference();

    // Prevent incorrect stats from showing
    this.lastUpdateStatsTime = performance.now() + this.updateStatsInterval;
    await this.nextFrame();
    // this.disableYouTubeAmbientMode()
  };

  updateHdr = wrapErrorHandler(
    function updateHdr() {
      if (!this.settings.webGL || !(this.videoElem?.readyState > 1)) return;

      try {
        let isHdr;
        if (typeof VideoFrame !== 'undefined') {
          // Not yet supported in Firefox (Stable): https://bugzilla.mozilla.org/show_bug.cgi?id=1749539
          const videoFrame = new VideoFrame(this.videoElem, { timestamp: 0 });
          isHdr = videoFrame?.colorSpace?.primaries === 'bt2020'; // https://w3c.github.io/webcodecs/#videocolorspace
          videoFrame.close();
        } else {
          const activeQuality = document.querySelector(
            '.bpx-player-ctrl-quality-menu-item.bpx-state-active .bpx-player-ctrl-quality-text'
          )?.textContent;
          isHdr = /HDR|杜比|Dolby/i.test(activeQuality || '');
        }

        if (this.isHdr === isHdr) return;

        this.isHdr = isHdr;
        if (isHdr) {
          this.initWebGLHdrProjectorBuffer();
          this.projectorBuffer = this.hdrProjectorBuffer;
        } else if (this.hdrProjectorBuffer) {
          this.projectorBuffer = this.nonHdrProjectorBuffer;
        }
        this.sizesChanged = true;
      } catch (ex) {
        if (ex?.name === 'InvalidStateError') return;

        console.warn(
          `Failed to detect video color space:\n${
            ex.message
          }\n${''}(ReadyState: ${readyStateToString(
            this.videoElem?.readyState
          )})`
        );
      }
    }.bind(this),
    true
  );

  cancelScheduledRequestVideoFrame = () => {
    if (!this.requestVideoFrameCallbackId) return;

    if (this.videoElem?.cancelVideoFrameCallback) {
      try {
        this.videoElem.cancelVideoFrameCallback(
          this.requestVideoFrameCallbackId
        );
      } catch {
        console.warn(
          `Failed to cancel current requested videoFrameCallback: ${this.requestVideoFrameCallbackId}`
        );
      }
    }
    this.requestVideoFrameCallbackId = undefined;
  };

  scheduleRequestVideoFrame = () => {
    if (
      // this.videoFrameCallbackReceived || // Doesn't matter because this can be true now but not when the new video frame is received
      this.requestVideoFrameCallbackId ||
      this.settings.frameSync != FRAMESYNC_VIDEOFRAMES ||
      this.videoIsHidden || // Partial solution for https://bugs.chromium.org/p/chromium/issues/detail?id=1142112#c9
      !this.canScheduleNextFrame()
    )
      return;

    this.requestVideoFrameCallbackId = this.videoElem.requestVideoFrameCallback(
      this.onVideoFrame
    );
  };

  onVideoFrame = wrapErrorHandler(
    async function onVideoFrame(compose, info) {
      if (!this.requestVideoFrameCallbackId) {
        console.warn(
          `Old rvfc fired. Ignoring a possible duplicate. ${this.requestVideoFrameCallbackId} | ${compose} | ${info}`
        );
        return;
      }
      this.videoElem.requestVideoFrameCallback(function prescheduledVFC() {}); // Requesting as soon as possible to prevent skipped video frames on displays with a matching framerate

      this.stats.receiveVideoFrametimes(compose, info);
      this.requestVideoFrameCallbackId = undefined;
      this.videoFrameCallbackReceived = true;
      this.videoPresentedFrames = info?.presentedFrames || 0;
      this.videoFrameTime = compose;

      if (this.scheduledNextFrame) return;
      this.scheduledNextFrame = true;

      await this.onNextFrame();
    }.bind(this),
    true
  );

  async hide() {
    report('hide-requested');
    this.settings?.closeMenuImmediately();
    this.cancelScheduledRequestVideoFrame();
    this.restorePageAmbientProperties();
    if (this.isHidden) return;
    this.isHidden = true;

    if (this.chromiumBugVideoJitterWorkaround?.update)
      this.chromiumBugVideoJitterWorkaround.update();

    document.documentElement.toggleAttribute('data-ambientlight-enabled', false);
    this.resetVideoParentElemStyle();

    if (this.isVrVideo) this.disposeVR();

    if (this.videoOverlay?.elem?.isConnected) {
      this.videoOverlay.elem.remove();
    }
    if (this.videoDebandingElem?.isConnected) {
      this.videoDebandingElem.remove();
    }

    this.clear();
    this.stats.hide();

    this.updateLayoutPerformanceImprovements();
    await this.updateSizes();
  }

  updateLayoutPerformanceImprovements = wrapErrorHandler(() => {
    const html = document.documentElement;
    const liveChatHtml =
      this.theming.liveChatIframe?.contentDocument?.documentElement;
    const enabled =
      this.settings.enabled &&
      !this.isHidden &&
      this.settings.layoutPerformanceImprovements;
    if (enabled) {
      html.setAttribute(
        'data-ambientlight-layout-performance-improvements',
        true
      );
      if (liveChatHtml)
        liveChatHtml.setAttribute(
          'data-ambientlight-layout-performance-improvements',
          true
        );
    } else {
      html.removeAttribute('data-ambientlight-layout-performance-improvements');
      if (liveChatHtml)
        liveChatHtml.removeAttribute(
          'data-ambientlight-layout-performance-improvements'
        );
    }
  }, true);

  async show() {
    report('show-requested', {
      isHidden: this.isHidden,
      isOnVideoPage: this.isOnVideoPage,
      enabled: this.settings.enabled,
    });
    if (!this.isHidden) return;
    this.isHidden = false;
    // await new Promise((resolve) => raf(resolve));

    // // Pre-style to prevent black/white flashes
    // if (this.ytdAppElem)
    //   setStyleProperty(this.ytdAppElem, 'background',
    //     this.theming.shouldBeDarkTheme(true) ? '#000' : '#fff',
    //     'important');
    // if (this.playerTheaterContainerElem) {
    //   setStyleProperty(this.playerTheaterContainerElem, 'background',
    //     'none',
    //     'important');
    // }

    // const html = document.documentElement;
    // if (this.settings.hideScrollbar)
    //   html.setAttribute('data-ambientlight-hide-scrollbar', true);
    // if (this.settings.relatedScrollbar)
    //   html.setAttribute('data-ambientlight-related-scrollbar', true);

    document.documentElement.toggleAttribute('data-ambientlight-enabled', true);
    this.sizesChanged = true;
    await this.updateSizes();
    report('first-layout-sizes', {
      view: this.view,
      screen: this.videoPlayerElem?.getAttribute('data-screen'),
      videoOffset: this.videoOffset,
      projectorSize: this.p,
      rootParent: this.elem.parentElement,
      rootConnected: this.elem.isConnected,
      containerRect: this.containerElem.getBoundingClientRect(),
      projectorElementRect: this.projectorsElem.getBoundingClientRect(),
      getImageDataAllowed: this.getImageDataAllowed,
    });

    // this.handleDocumentVisibilityChange(); // In case the visibility had changed while being disabled
    // await this.updateVideoPlayerSize(true);
    // await this.updateSizes();

    wrapErrorHandler(
      async function afterShow() {
        // await new Promise((resolve) => raf(resolve));
        // // // eslint-disable-next-line no-unused-vars
        // // const _1 = this.videoElem.clientWidth;

        // const html = document.documentElement;
        // html.setAttribute('data-ambientlight-enabled', true);

        if (this.settings.layoutPerformanceImprovements)
          this.updateLayoutPerformanceImprovements();

        // Todo: Prevent switching to the incorrect theme
        const updateDocument = this.handleDocumentVisibilityChange(); // In case the visibility had changed while being disabled
        // const updateVideoPlayer = this.updateVideoPlayerSize(true); // In case the theater player height changed
        await this.theming.updateTheme(); // Update livechat theme

        await updateDocument;
        // await updateVideoPlayer;

        // Reset
        // if (this.playerTheaterContainerElem)
        //   this.playerTheaterContainerElem.style.background = '';
        // if (this.ytdAppElem) this.ytdAppElem.style.background = '';

        // // eslint-disable-next-line no-unused-vars
        // const _2 = this.videoElem.clientWidth;
        // await new Promise((resolve) => raf(resolve));

        await new Promise((resolve) => raf(resolve));

        if (this.chromiumBugVideoJitterWorkaround?.update)
          this.chromiumBugVideoJitterWorkaround.update();
      }.bind(this)
    )();
  }

  updateAtTop = async () => {
    if (this.mastheadElem)
      this.mastheadElem.classList.toggle('at-top', this.atTop);

    if (this.settings.webGL) await this.projector.handleAtTopChange(this.atTop);
  };

  shouldEnableImmersiveMode = () =>
    this.settings.immersiveTheaterView && this.view === VIEW_THEATER;

  updateImmersiveMode() {
    document.documentElement.removeAttribute('data-ambientlight-immersive');
  }
}
