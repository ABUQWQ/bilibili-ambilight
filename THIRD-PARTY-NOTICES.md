# 第三方开源声明

本文件记录 Bilibili 氛围灯的上游来源、直接构建依赖和发布工具。
核对日期：2026-10-06。npm 版本以本仓库 `package-lock.json` 为准。
本文件不替代各组件的完整许可证，也不意味着第三方作者为本项目背书。

## 项目许可证

- 项目许可证：MIT License。
- SPDX 标识：`MIT`。
- 完整文本：[LICENSE](LICENSE)。
- 原作者版权声明：`Copyright (c) 2017 Wessel Kroos`。

保留上游版权声明和许可证原文，不以移植者署名替换原作者署名。
本项目自身代码按 MIT 授权；第三方代码的权利仍归各自权利人所有，
其授权条件以相应组件的许可证为准。

## 上游项目

| 项目 | 作者 | 移植基准 | 许可证 | 用途 |
| --- | --- | --- | --- | --- |
| [Ambient light for YouTube](https://github.com/WesselKroos/youtube-ambilight) | Wessel Kroos 及贡献者 | `develop` 分支提交 `18d17188e5562e5ee913f005192d30c9a60be078` | MIT | 光晕渲染、帧调度、设置配置及核心扩展机制 |

基准提交的许可证原文：
[upstream LICENSE](https://github.com/WesselKroos/youtube-ambilight/blob/18d17188e5562e5ee913f005192d30c9a60be078/LICENSE)。
本项目的 Bilibili 适配并非原作者或 Bilibili 官方发布。

## 直接构建依赖

这些包用于开发、编译或构建，不意味着整个 npm 包会随扩展分发。
其中 Babel 可能向生成脚本注入辅助代码；相应版权及许可证原文保留在本文件末尾。

| 包 | 锁定版本 | SPDX 许可证 | 来源 |
| --- | --- | --- | --- |
| `@babel/core` | 7.22.5 | MIT | [babel/babel](https://github.com/babel/babel) |
| `@babel/plugin-proposal-class-properties` | 7.18.6 | MIT | [babel/babel](https://github.com/babel/babel) |
| `@babel/plugin-proposal-optional-chaining` | 7.21.0 | MIT | [babel/babel](https://github.com/babel/babel) |
| `@dotenvx/dotenvx` | 1.45.1 | BSD-3-Clause | [dotenvx/dotenvx](https://github.com/dotenvx/dotenvx) |
| `@rollup/plugin-babel` | 6.0.4 | MIT | [rollup/plugins](https://github.com/rollup/plugins) |
| `@rollup/plugin-eslint` | 9.0.5 | MIT | [rollup/plugins](https://github.com/rollup/plugins) |
| `@rollup/plugin-node-resolve` | 16.0.1 | MIT | [rollup/plugins](https://github.com/rollup/plugins) |
| `babel-plugin-transform-replace-expressions` | 0.2.0 | MIT | [jviide/babel-plugin-transform-replace-expressions](https://github.com/jviide/babel-plugin-transform-replace-expressions) |
| `copyfiles` | 2.4.1 | MIT | [calvinmetcalf/copyfiles](https://github.com/calvinmetcalf/copyfiles) |
| `eslint` | 9.28.0 | MIT | [eslint/eslint](https://github.com/eslint/eslint) |
| `globals` | 16.2.0 | MIT | [sindresorhus/globals](https://github.com/sindresorhus/globals) |
| `npm-run-all` | 4.1.5 | MIT | [mysticatea/npm-run-all](https://github.com/mysticatea/npm-run-all) |
| `rollup` | 4.42.0 | MIT | [rollup/rollup](https://github.com/rollup/rollup) |
| `sass` | 1.62.1 | MIT | [sass/dart-sass](https://github.com/sass/dart-sass) |

本表仅列直接依赖，不是完整传递依赖清单。传递依赖的版本及许可证元数据见
`package-lock.json`；完整条款见安装后各包的 `LICENSE`、`COPYING` 或同等文件。
构建工具自身可能包含其他许可证组件，例如 Rollup 的发行包还包含 ISC 和 0BSD
授权代码，详见该包的 `LICENSE.md`。如另行分发这些工具或 `node_modules`，
需要随之保留其自身及所包含组件的完整授权文件，而不能只保留本表。

## GitHub Actions

这些工具只在 CI 或发布环境中运行，不打包进扩展。
工作流引用的是下列版本标签，标签可能移动，不代表固定提交版本。

| 工具 | 工作流引用 | SPDX 许可证 | 官方许可证 |
| --- | --- | --- | --- |
| `actions/checkout` | `v4` | MIT | [LICENSE](https://github.com/actions/checkout/blob/v4/LICENSE) |
| `actions/setup-node` | `v4` | MIT | [LICENSE](https://github.com/actions/setup-node/blob/v4/LICENSE) |
| `cardinalby/webext-buildtools-pack-extension-dir-action` | `v1` | MIT | [LICENSE](https://github.com/cardinalby/webext-buildtools-pack-extension-dir-action/blob/v1/LICENSE) |
| `cardinalby/webext-buildtools-chrome-crx-action` | `v2` | MIT | [LICENSE](https://github.com/cardinalby/webext-buildtools-chrome-crx-action/blob/v2/LICENSE) |
| `softprops/action-gh-release` | `v2` | MIT | [LICENSE](https://github.com/softprops/action-gh-release/blob/v2/LICENSE) |

## 测试工具

`tests/settings-ui.py` 使用 [Playwright for Python](https://github.com/microsoft/playwright-python)
进行隔离浏览器测试，许可证为 `Apache-2.0`，完整条款见其
[LICENSE](https://github.com/microsoft/playwright-python/blob/main/LICENSE)。
该工具未在本仓库锁定版本，不随扩展分发；其下载的浏览器还包含各自的第三方声明，
不能将浏览器整体视为仅采用 Apache-2.0 的组件。

## 分发与维护

- `npm run build` 会把根目录 `LICENSE` 和本文件复制到 `dist/`，随 ZIP/CRX 一起分发。
- 修改、复制或再分发上游代码时，保留版权声明、许可声明和免责条款。
- 新增或升级依赖时，同步核对其许可证、锁定版本和生成脚本中包含的第三方代码。
- Bilibili 的商标、网站内容、视频和用户数据不因本项目的 MIT 许可证而获得授权。
- CRX 签名仅用于签名验证及扩展身份稳定，不是 Chrome 商店审核、Bilibili 官方授权或安全认证。
- 签名私钥不是开源组件，禁止包含在源码、诊断信息或分发包中。

## Babel 辅助代码许可证

以下原文来自安装依赖的 `@babel/helpers/LICENSE`，适用于 Babel 辅助代码；
Facebook 版权声明的适用范围按原文限定，列出该声明并不表示当前构建包含 regenerator。

```text
MIT License

Copyright (c) 2014-present Sebastian McKenzie and other contributors
Copyright (c) 2014-present, Facebook, Inc. (ONLY ./src/helpers/regenerator* files)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
