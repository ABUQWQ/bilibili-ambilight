import { supportsColorMix, supportsWebGL } from './generic';
import { getBrowser } from './utils';

const SettingsConfig = [
  {
    type: 'section',
    label: '设置',
    name: 'sectionSettingsCollapsed',
    default: true,
  },
  {
    name: 'advancedSettings',
    label: '高级',
    type: 'checkbox',
    default: false,
  },
  {
    type: 'section',
    label: '统计',
    name: 'sectionStatsCollapsed',
    default: true,
    advanced: true,
  },
  {
    name: 'showFPS',
    label: '帧率',
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    name: 'showFrametimes',
    label: '帧时间图表',
    description: '占用：CPU',
    questionMark: {
      title:
        '测得的显示帧率并不能代表真实性能，因为测量本身会额外占用一部分 CPU。\n不过，这项统计有助于排查其他问题。',
    },
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    name: 'showResolutions',
    label: '分辨率与绘制时间',
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    name: 'showBarDetectionStats',
    label: '黑边检测',
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    type: 'section',
    label: '画质',
    name: 'sectionQualityPerformanceCollapsed',
    default: true,
  },
  {
    name: 'webGL',
    label: 'WebGL 渲染器（功耗更低）',
    description: '更改后将重新加载网页',
    type: 'checkbox',
    default: true,
  },
  {
    name: 'resolution',
    label: '分辨率',
    type: 'list',
    default: 100,
    unit: '%',
    valuePoints: (() => {
      const points = [6.25];
      while (points[points.length - 1] < 400) {
        points.push(points[points.length - 1] * 2);
      }
      return points;
    })(),
    manualinput: false,
  },
  {
    name: 'framerateLimit',
    label: '限制帧率（每秒）',
    type: 'list',
    default: 60,
    min: 0,
    max: 60,
    step: 1,
  },
  {
    name: 'frameSync',
    label: '同步方式',
    questionMark: {
      title:
        '控制同步氛围灯帧与视频帧时消耗的性能。\n\n解码帧率：CPU 和 GPU 占用最低，但可能出现丢帧和延迟。\n\n显示帧率：CPU 和 GPU 占用最高，在高刷新率显示器（120Hz 及以上）和高于 1080p 的视频中仍可能出现延迟。\n\n视频帧率：CPU 和 GPU 占用最低，使用最新浏览器技术让帧始终保持同步。',
    },
    type: 'list',
    default: 2,
    min: 0,
    max: 2,
    step: 1,
    snapPoints: [
      { value: 0, label: '解码' },
      { value: 1, label: '显示' },
      { value: 2, label: '视频' },
    ],
    manualinput: false,
    advanced: true,
    experimental: true,
  },
  {
    name: 'energySaver',
    label: '静态视频节能',
    questionMark: {
      title:
        '限制画面几乎静止的视频帧率\n\n静止画面：每 5 秒 1 帧\n轻微移动：每秒 1 帧',
    },
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    name: 'prioritizePageLoadSpeed',
    label: '优先网页加载速度',
    description: '网页加载完成后再启动氛围灯',
    type: 'checkbox',
    default: true,
  },
  {
    name: 'layoutPerformanceImprovements',
    label: 'YouTube 响应优化',
    description: '提升网页响应速度',
    questionMark: {
      title: `/watch 页面上的部分优化包括：
- 加快网页缩放和滚动响应（加载超过 100 条评论后尤其明显）
- 加快评论和/或相关视频的加载速度
- 更流畅的进度条拖动（加载超过 100 条评论或打开直播聊天窗口后尤其明显）
- 更流畅的直播聊天滚动，新消息会更快加入聊天
- 更流畅的播放列表滚动（超过 25 个视频时尤其明显）
- 更流畅地拖动或重新排序播放列表视频（超过 25 个视频时尤其明显）`,
    },
    type: 'checkbox',
    default: true,
    advanced: true,
  },
  {
    name: 'debandingBlendMode',
    label: '去色带优化目标',
    questionMark: {
      title:
        '普通混合模式适合修复 LCD 暗色区域的色带。\n但在 OLED 上，使用“叠加”混合模式可以保留纯黑。',
    },
    type: 'list',
    default: 0,
    min: 0,
    max: 1,
    step: 1,
    snapPoints: [
      { value: 0, label: 'LCD（普通）' },
      { value: 1, label: 'OLED（叠加）' },
    ],
    manualinput: false,
    advanced: true,
    new: true,
  },
  {
    type: 'section',
    label: '页面顶栏',
    name: 'sectionOtherPageHeaderCollapsed',
    default: true,
  },
  {
    name: 'headerShadowSize',
    label: '阴影大小',
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'headerShadowOpacity',
    label: '阴影不透明度',
    type: 'list',
    default: 30,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'headerImagesOpacity',
    label: '图片不透明度',
    type: 'list',
    default: 100,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'headerFillOpacity',
    label: '背景不透明度',
    description: '仅向下滚动时生效',
    type: 'list',
    default: 100,
    min: -100,
    max: 100,
    step: 0.1,
    advanced: true,
  },

  {
    type: 'section',
    label: '页面内容',
    name: 'sectionOtherPageContentCollapsed',
    default: true,
  },
  {
    name: 'surroundingContentShadowSize',
    label: '阴影大小',
    type: 'list',
    default: 15,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'surroundingContentShadowOpacity',
    label: '阴影不透明度',
    type: 'list',
    default: 30,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'surroundingContentTextAndBtnOnly',
    label: '仅对文字和按钮应用阴影',
    description: '减少滚动和视频卡顿',
    type: 'checkbox',
    advanced: true,
    default: true,
  },
  {
    name: 'surroundingContentImagesOpacity',
    label: '图片不透明度',
    type: 'list',
    default: 100,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'surroundingContentFillOpacity',
    label: '按钮和方框背景不透明度',
    type: 'list',
    default: 10,
    min: -100,
    max: 100,
    step: 0.1,
  },
  {
    name: 'pageBackgroundGreyness',
    label: '背景灰度',
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'immersiveTheaterView',
    label: '剧场模式隐藏所有内容',
    type: 'checkbox',
    default: false,
  },
  {
    name: 'relatedScrollbar',
    label: '相关视频设为可滚动列表',
    description: '也可改善评论滚动',
    type: 'checkbox',
    advanced: true,
    default: false,
  },
  {
    name: 'hideScrollbar',
    label: '隐藏滚动条',
    type: 'checkbox',
    advanced: true,
    default: false,
  },
  {
    type: 'section',
    label: '视频',
    name: 'sectionVideoResizingCollapsed',
    default: true,
  },
  {
    name: 'videoScale.SMALL',
    label: '小窗尺寸',
    type: 'list',
    default: 100,
    min: 25,
    max: 200,
    step: 0.1,
    new: true,
  },
  {
    name: 'videoScale.THEATER',
    label: '剧场模式尺寸',
    type: 'list',
    default: 100,
    min: 25,
    max: 200,
    step: 0.1,
    new: true,
  },
  {
    name: 'videoScale.FULLSCREEN',
    label: '全屏尺寸',
    type: 'list',
    default: 100,
    min: 25,
    max: 200,
    step: 0.1,
    new: true,
  },
  {
    name: 'videoShadowSize',
    label: '阴影大小',
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'videoShadowOpacity',
    label: '阴影不透明度',
    type: 'list',
    default: 50,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'videoDebandingStrength',
    label: '去色带（噪点）',
    questionMark: {
      title:
        '点击了解去色带（噪点/抖动）的更多信息。\n提示：将“画质 > 去色带优化目标”设为“OLED”，可在 OLED 显示器上保留纯黑。',
      href: 'https://www.lifewire.com/what-is-dithering-4686105',
    },
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 1,
    advanced: true,
  },
  {
    name: 'videoOverlayEnabled',
    label: '视频与氛围灯同步',
    questionMark: {
      title:
        '根据氛围灯帧时间延迟视频帧，确保氛围灯始终与视频同步，但可能造成卡顿和/或丢帧。',
    },
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    name: 'videoOverlaySyncThreshold',
    label: '同步禁用丢帧阈值',
    description: '丢帧达到该百分比时禁用',
    type: 'list',
    default: 5,
    min: 1,
    max: 100,
    step: 1,
    advanced: true,
  },
  {
    name: 'chromiumBugVideoJitterWorkaround',
    label: '视频抖动修复',
    description: '占用：CPU 和 GPU',
    questionMark: {
      title:
        '当显示器刷新率高于 60Hz 时，Chromium 的缺陷可能导致视频播放抖动。\n此修复会强制浏览器按显示器刷新率运行，从而避免抖动。\n点击问号可了解 Chromium 浏览器中该缺陷的更多信息。',
      href: 'https://github.com/WesselKroos/youtube-ambilight/issues/166',
    },
    type: 'checkbox',
    default: false, // Should not be enabled by default because it also adds CPU & GPU overhead on 60Hz displays. (60Hz+ detection keeps toggling between off/on when VRR is enabled in the OS.)
    advanced: true,
  },
  {
    name: 'chromiumDirectVideoOverlayWorkaround',
    label: '视频画面异常修复',
    description:
      '使用 NVIDIA RTX 虚拟超级分辨率（VSR）时必须关闭此修复',
    questionMark: {
      title: `当视频使用硬件加速覆盖层（MPO）时，此修复可解决多种画面异常，
例如随机黑白方块、闪烁或画面被挤压。

点击问号可了解这些问题的更多信息。`,
      href: 'https://github.com/WesselKroos/youtube-ambilight/blob/master/TROUBLESHOOT.md#3-nvidia-rtx-video-super-resolution-vsr--nvidia-rtx-video-hdr-does-not-work',
    },
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    type: 'section',
    label: '移除黑边与彩色边框',
    name: 'sectionHorizontalBarsCollapsed',
    default: true,
  },
  {
    name: 'detectHorizontalBarSizeEnabled',
    label: '移除上下黑边',
    description: '占用：CPU',
    type: 'checkbox',
    default: false,
    defaultKey: 'B',
  },
  {
    name: 'detectVerticalBarSizeEnabled',
    label: '移除左右黑边',
    description: '占用：CPU',
    type: 'checkbox',
    default: false,
    defaultKey: 'V',
  },
  {
    name: 'detectColoredHorizontalBarSizeEnabled',
    label: '检测：移除彩色边框',
    type: 'checkbox',
    default: false,
  },
  {
    name: 'detectHorizontalBarSizeOffsetPercentage',
    label: '检测：偏移',
    type: 'list',
    default: 0,
    min: -5,
    max: 5,
    step: 0.1,
    advanced: true,
  },
  {
    name: 'barSizeDetectionAverageHistorySize',
    label: '检测：帧数平均',
    questionMark: {
      title:
        '用于计算平均黑边大小的视频帧数。\n帧数越少检测越快，但误判也会增多。',
    },
    type: 'list',
    default: 4,
    min: 1,
    max: 30,
    step: 1,
    advanced: true,
  },
  {
    name: 'barSizeDetectionAllowedElementsPercentage',
    label: '检测：确定性阈值',
    questionMark: {
      title:
        '10% 时只移除明显的黑边。\n提高百分比后可移除包含部分元素的边框。\n继续提高可能裁剪到画面中央的方形区域。',
    },
    type: 'list',
    default: 20,
    min: 10,
    max: 90,
    step: 10,
    // advanced: true,
  },
  {
    name: 'barSizeDetectionAllowedUnevenBarsPercentage',
    label: '检测：不均匀阈值',
    questionMark: {
      title:
        '百分比越高，越容易检测到不均匀的黑边。\n例如上下黑边宽度不一致时。\n但百分比过高也会增加把直线或规则物体误判为黑边的风险。',
    },
    type: 'list',
    default: 10,
    min: 1,
    max: 50,
    step: 1,
    advanced: true,
    new: true,
  },
  {
    name: 'horizontalBarsClipPercentage',
    label: '黑边大小',
    type: 'list',
    default: 0,
    min: 0,
    max: 40,
    step: 0.1,
    snapPoints: [
      { value: 8.7, label: 8 },
      { value: 12.3, label: 12, flip: true },
      { value: 13.5, label: 13 },
    ],
    advanced: true,
  },
  {
    name: 'verticalBarsClipPercentage',
    label: '侧边黑边大小',
    type: 'list',
    default: 0,
    min: 0,
    max: 40,
    step: 0.1,
    advanced: true,
  },
  {
    name: 'horizontalBarsClipPercentageReset',
    label: '下个视频重置黑边',
    type: 'checkbox',
    default: true,
    advanced: true,
  },
  {
    name: 'detectVideoFillScaleEnabled',
    label: '用视频填充已移除黑边',
    type: 'checkbox',
    default: false,
    defaultKey: 'H',
  },
  {
    type: 'section',
    label: '滤镜',
    name: 'sectionImageAdjustmentCollapsed',
    default: true,
  },
  {
    name: 'brightness',
    label: '亮度',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1,
  },
  {
    name: 'contrast',
    label: '对比度',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1,
    advanced: true,
  },
  {
    name: 'vibrance',
    label: '色彩',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 0.1,
  },
  {
    name: 'saturation',
    label: '饱和度',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1,
  },
  {
    type: 'section',
    label: 'HDR 滤镜',
    name: 'sectionHdrImageAdjustmentCollapsed',
    default: false,
    hdr: true,
  },
  {
    name: 'hdrBrightness',
    label: '亮度',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1,
    hdr: true,
  },
  {
    name: 'hdrContrast',
    label: '对比度',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1,
    hdr: true,
  },
  {
    name: 'hdrSaturation',
    label: '饱和度',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1,
    hdr: true,
  },
  {
    type: 'section',
    label: '方向',
    name: 'sectionDirectionsCollapsed',
    default: true,
    advanced: true,
  },
  {
    name: 'directionTopEnabled',
    label: '顶部',
    type: 'checkbox',
    default: true,
    advanced: true,
  },
  {
    name: 'directionRightEnabled',
    label: '右侧',
    type: 'checkbox',
    default: true,
    advanced: true,
  },
  {
    name: 'directionBottomEnabled',
    label: '底部',
    type: 'checkbox',
    default: true,
    advanced: true,
  },
  {
    name: 'directionLeftEnabled',
    label: '左侧',
    type: 'checkbox',
    default: true,
    advanced: true,
  },
  {
    type: 'section',
    label: '氛围灯',
    name: 'sectionAmbientlightCollapsed',
    default: false,
  },
  {
    name: 'blur2',
    label: '模糊',
    description: '占用：GPU 显存',
    type: 'list',
    default: 30,
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    name: 'edge',
    label: '边缘大小',
    description: '将模糊设为 0% 可更清楚地查看变化',
    type: 'list',
    default: 12,
    min: 2,
    max: 50,
    step: 0.1,
    advanced: true,
  },
  {
    name: 'spread',
    label: '扩散',
    description: '占用：GPU',
    type: 'list',
    default: 17,
    min: 0,
    max: 400,
    step: 0.1,
  },
  {
    name: 'spreadFadeStart',
    label: '扩散衰减起点',
    type: 'list',
    default: 15,
    min: -50,
    max: 100,
    step: 0.1,
    advanced: true,
  },
  {
    name: 'spreadFadeCurve',
    label: '扩散衰减曲线',
    description: '将模糊设为 0% 可更清楚地查看变化',
    type: 'list',
    default: 35,
    min: 1,
    max: 100,
    step: 1,
    advanced: true,
  },
  {
    name: 'debandingStrength',
    label: '去色带（噪点）',
    questionMark: {
      title:
        '点击了解噪点/抖动的更多信息。\n提示：将“画质 > 去色带优化目标”设为“OLED”，可在 OLED 显示器上保留纯黑。',
      href: 'https://www.lifewire.com/what-is-dithering-4686105',
    },
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 1,
    advanced: true,
  },
  {
    name: 'frameFading',
    label: '淡入时长',
    description: '占用：GPU 显存',
    questionMark: {
      title: '在氛围灯变化之间平滑过渡',
    },
    type: 'list',
    default: 0,
    min: 0,
    max: 21.2, // 15 seconds
    step: 0.02,
    manualinput: false,
  },
  {
    name: 'flickerReduction',
    label: '闪烁抑制',
    questionMark: {
      title:
        '通过限制氛围灯亮度变化速度来减少闪烁',
    },
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 1,
    manualinput: false,
    advanced: true,
  },
  {
    name: 'frameBlending',
    label: '平滑运动（帧混合）',
    questionMark: {
      title: '点击了解帧混合的更多信息',
      href: 'https://www.youtube.com/watch?v=m_wfO4fvH8M&t=81s',
    },
    description: '占用：GPU。也可与“视频同步”配合使用',
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    name: 'frameBlendingSmoothness',
    label: '平滑强度',
    type: 'list',
    default: 80,
    min: 0,
    max: 100,
    step: 1,
    advanced: true,
  },
  {
    name: 'fixedPosition',
    label: '固定位置',
    description: '忽略页面滚动位置',
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    type: 'section',
    label: '视图模式',
    name: 'sectionViewsCollapsed',
    default: false,
  },
  {
    name: 'enableInViews',
    label: '启用的布局',
    type: 'list',
    manualinput: false,
    default: 0,
    min: 0,
    max: 5,
    step: 1,
    snapPoints: [
      { value: 0, label: '全部' },
      { value: 1, label: '小窗' },
      { value: 2, hiddenLabel: '小窗和剧场' },
      { value: 3, label: '剧场' },
      { value: 4, hiddenLabel: '剧场和全屏' },
      { value: 5, label: '全屏' },
    ],
  },
  {
    name: 'enableInPictureInPicture',
    label: '画中画',
    type: 'checkbox',
    default: false,
    advanced: true,
  },
  {
    name: 'enableInEmbed',
    label: '嵌入式视频',
    type: 'checkbox',
    default: true,
    advanced: true,
  },
  {
    name: 'enableInVRVideos',
    label: 'VR/360 视频',
    type: 'checkbox',
    default: true,
    advanced: true,
  },
  {
    type: 'section',
    label: '通用',
    name: 'sectionGeneralCollapsed',
    default: false,
  },
  {
    name: 'theme',
    label: '外观（主题）',
    type: 'list',
    manualinput: false,
    default: 1,
    min: -1,
    max: 1,
    step: 1,
    snapPoints: [
      { value: -1, label: '浅色' },
      { value: 0, label: '跟随默认' },
      { value: 1, label: '深色' },
    ],
  },
  {
    name: 'enabled',
    label: '启用',
    type: 'checkbox',
    default: true,
    defaultKey: 'G',
  },
];

export const WebGLOnlySettings = [
  'resolution',
  'vibrance',
  'frameFading',
  'flickerReduction',
  'fixedPosition',
  'chromiumBugVideoJitterWorkaround',
];

let prepared = false;
export const prepareSettingsConfigOnce = () => {
  if (prepared) return;

  const settingsToRemove = [];
  for (const setting of SettingsConfig) {
    if (supportsWebGL()) {
      if (setting.name === 'resolution' && getBrowser() === 'Firefox') {
        setting.default = 50;
      }
    } else {
      if (WebGLOnlySettings.includes(setting.name)) {
        settingsToRemove.push(setting.name);
      }
      if (['webGL'].includes(setting.name)) {
        setting.default = false;
        setting.disabled = '你的浏览器已禁用 WebGL。';
      }
    }

    if (setting.name === 'frameSync') {
      if (!HTMLVideoElement.prototype.requestVideoFrameCallback) {
        setting.max = 1;
        setting.default = 0;
      } else if (getBrowser() === 'Firefox') {
        // FireFox workaround: requestVideoFrameCallback is limited to 24fps. Use decoded video frames by default instead
        // https://bugzilla.mozilla.org/show_bug.cgi?id=1935256
        setting.default = 0;
      }
    }
  }

  if (getBrowser() === 'Firefox') {
    settingsToRemove.push('enableInVRVideos');
  }

  if (!supportsColorMix()) {
    settingsToRemove.push('pageBackgroundGreyness');
  }

  for (const settingName of settingsToRemove) {
    const settingIndex = SettingsConfig.findIndex(
      (setting) => setting.name === settingName
    );
    SettingsConfig.splice(settingIndex, 1);
  }

  prepared = true;
};

export default SettingsConfig;
