# Bilibili 氛围灯

为哔哩哔哩投稿视频添加跟随画面的动态氛围光晕，让播放器和页面背景拥有更自然的沉浸感。

## 功能范围

- 支持 `https://www.bilibili.com/video/*` 投稿视频页面。
- 支持普通、宽屏、Web 全屏和原生全屏播放器模式。
- 光晕会延伸到播放器周围、右侧推荐区、工具栏、简介和评论区域。
- 设置保存在浏览器本地，不上传账号、视频或播放记录。

当前版本主要面向 Chromium 浏览器（Chrome、Edge、Opera、Vivaldi）。Bilibili 页面结构变化可能影响部分布局，遇到问题请附上浏览器版本、播放器模式和截图。

## 安装

本项目目前以开发者模式加载，未发布到浏览器商店。

1. 下载或克隆本仓库。
2. 安装 Node.js `22.5.1` 或兼容版本。
3. 在项目目录执行 `npm ci`。
4. 执行 `npm run build`。
5. 打开 `chrome://extensions/` 或 Edge 的扩展管理页。
6. 开启“开发者模式”，点击“加载已解压的扩展程序”。
7. 选择项目生成的 `dist` 目录。

源码修改后重新执行 `npm run build`，再在扩展管理页点击刷新。

## 调试诊断

生产构建默认不向页面注入诊断桥。如需排查播放器、路由或光晕布局问题，可启用调试构建：

PowerShell：

```powershell
$env:BILIBILI_AMBIENTLIGHT_DIAGNOSTICS = "1"
npm run build
```

macOS/Linux：

```bash
BILIBILI_AMBIENTLIGHT_DIAGNOSTICS=1 npm run build
```

刷新视频页后，可在开发者工具控制台使用 `__bilibiliAmbientlightDiagnostics.dump()` 查看诊断数据，使用 `.copy()` 复制 JSON。

## 开发

```bash
npm ci
npm run build
```

构建结果位于 `dist/`，仅用于本地加载，不提交到 Git。生产构建不会包含页面诊断桥；调试构建由 `BILIBILI_AMBIENTLIGHT_DIAGNOSTICS=1` 控制。

## 发布 CRX

发布工作流位于 `.github/workflows/release.yml`。提交版本标签（例如
`v2.38.18`）后，GitHub Actions 会校验 `package.json` 版本、构建生产扩展，
生成带版本号的 `.crx`、`.zip` 和 `update.xml`，并创建 GitHub Release。

发布前请更新根目录的 `UPDATE.md`，它会作为 Release 的更新说明显示并一并附加。
仓库管理员还需要配置 Actions Secret `CHROME_CRX_PRIVATE_KEY`。工作流会根据
私钥自动生成更新清单所需的扩展 ID，不需要额外配置 Repository Variable。

手动运行工作流时，填写的版本号必须与 `package.json` 一致。Chrome/Edge
通常不能直接双击安装第三方 CRX；开发测试请使用“加载已解压的扩展程序”，
企业或受管环境再使用 CRX 更新清单。

项目的主要入口位于：

- `src/scripts/content.js`：等待 Bilibili 页面资源并加载扩展。
- `src/scripts/content-main.js`：播放器绑定、SPA 路由和设置入口。
- `src/scripts/libs/ambientlight.js`：光晕渲染和播放器生命周期。
- `src/styles/_bilibili-parity.scss`：Bilibili 页面布局和背景适配。

## 已知限制

- 只匹配 `www.bilibili.com/video/*`，不覆盖番剧、直播、嵌入播放器和移动端页面。
- 页面结构或播放器 class 变化时，可能需要更新选择器和布局适配。
- WebGL/Canvas 性能取决于浏览器硬件加速和显卡驱动。
- 某些浏览器或显卡组合可能需要降低光晕质量来避免掉帧。

## 问题反馈与贡献

请在 [GitHub Issues](https://github.com/ABUQWQ/bilibili-ambilight/issues) 中提供：

- 浏览器和版本；
- 操作系统和显卡；
- Bilibili 播放器模式；
- 复现步骤和截图；
- 如有需要，附上调试构建导出的诊断 JSON。

仓库地址：[ABUQWQ/bilibili-ambilight](https://github.com/ABUQWQ/bilibili-ambilight)
