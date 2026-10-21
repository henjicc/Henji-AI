# Electron 桌面容器

> 读取时机：改动 `electron/main/**` 或 `electron/preload/**`、加 IPC、动打包配置、验收桌面能力、处理自动更新。

## 验收必须看真实 Electron 窗口

裸浏览器 Vite 页面（`npm run dev`）不能作为桌面能力的最终依据。以下能力全部依赖 Electron 容器：

自定义标题栏、窗口控制、preload bridge、SQLite、safeStorage、`henji-media://` 媒体协议、自动更新、原生拖拽/剪贴板。

只有任务确实需要真实桌面容器、交付运行中应用，或构建/Reality 验收中断了既有实例时，桌面端调试、测试、助手验证和 Agent 收尾启动才使用
`npm run electron:dev -- --background`。该模式不是 headless：窗口会正常创建并加载，启动完成后直接最小化；
同时仅为该窗口设置 `backgroundThrottling: false`，让最小化状态下的动画、定时器继续运行，并持续绘制和交换帧。
用户从 Dock / 任务栏恢复痕迹AI后仍可正常取得焦点并交互。分析、规则/文档、测试文件、纯 SDK、纯脚本和无需真实窗口的局部逻辑任务不得仅为满足收尾格式启动 Electron。

只有必须验证“应用启动时主动取得焦点”、观察首屏，或用户明确要求前台弹出时，才使用普通
`npm run electron:dev`。项目正式 `test:reality` Electron 自动化仍走其统一启动器，不得用开发命令替代。

## 自动化脚本

Electron 自动化脚本通过 CDP/Playwright 启动构建产物。需要临时手动调试时，优先复用 `scripts/lib/electronLaunch.cjs` 中的启动方式。

## 打包配置

`electron-builder.yml` 当前配置：Windows NSIS/MSI、macOS DMG、GitHub Releases 发布通道、`better-sqlite3`/`sharp` 原生模块 unpack、manifest/seeds 资源分发。`resources/icons/` 是打包图标来源。

随包原生程序与 FFmpeg（安装目录 `resources/resources/` 下，主进程只按 `process.resourcesPath` 定位，安装包不读开发目录与 `HENJI_*` 诊断变量）：

- `henji-audio-worker.exe`：全平台，`build:audio-worker`（`scripts/build-audio-worker.cjs`）产出。
- Windows 上两个自有原生程序都静态链接 MSVC C 运行时（`scripts/lib/nativeCrt.cjs` 给 cargo 加 `+crt-static`），不依赖干净机器上没有的 `VCRUNTIME140.dll`；FFmpeg（mingw 构建）只依赖系统自带的 UCRT。
- `video-decoder/`（仅 Windows）：原生视频解码服务 `henji-video-decoder.exe`、7 个 FFmpeg DLL 与主进程 CLI 用的 `ffmpeg.exe`/`ffprobe.exe`，同一份 BtbN FFmpeg 9.0 GPL 共享构建（版本、地址、SHA256 唯一定义在 `scripts/video-decoder-ffmpeg.cjs`）。由 `build:video-decoder` 复制到 `native/video-decoder/target/release` 后经 `win.extraResources` 打包；Windows 不打包 `ffmpeg-ffprobe-static`（`win.files` 排除，macOS 维持现状）。
- `licenses/`：`npm run gen:licenses` 生成（`electron:build` 以 `--strict` 运行，来源缺失或 FFmpeg 构建含 `--enable-nonfree`/缺 `--enable-version3` 即失败）——`README.txt`（许可概要、对应源码获取方式、专利说明）、项目 `LICENSE.txt`、`THIRD-PARTY-NOTICES.txt`（与设置“关于”同源）；Windows 另有 `ffmpeg/COPYING.GPLv3.txt`、`ffmpeg/BUILD-INFO.txt`（configure 输出、包与随包文件 SHA256）、`henji-video-decoder/NOTICE.txt`（原生服务链接 GPL 库，整体按 GPL-3.0-or-later 分发）。`third-party-licenses.json` 进渲染产物，不随包。

`afterPack`（`scripts/electron-builder-after-pack.cjs`）在制作安装包前核对：`app.asar` 顶层只有 `out`/`package.json`/`node_modules`（平台级 `files` 只写排除项会让匹配规则退化成整个仓库，`win.files` 因此重复了顶层包含项）、自有原生程序不动态依赖 VC++ 运行库、`video-decoder/` 文件集合与构建来源逐字节一致（不混入 pdb）、许可文件齐全且 BUILD-INFO 与随包 FFmpeg 哈希一致、Windows 无 `ffmpeg-ffprobe-static` 与其他平台的可选二进制包（`@esbuild/*`、`@mariozechner/clipboard-*` 只留 win32-x64，`win.files` 用 `!(win32-x64)` 排除）、安装目录有 `LICENSES.chromium.html`；不符即中止打包。GPL 对应源码包用 `npm run package:source` 生成到 `release/source/<版本>/`（含 BtbN 构建启用的全部外部库源码，按各阶段自己的下载命令获取、不依赖 Docker；重要记录 016），作为 GitHub Release 附件发布（发布需用户确认，脚本不上传）。

原生模块重建：`npm run electron:rebuild`。

`release/` 只保留最新一次的打包产物（安装包、`latest.yml`、`win-unpacked/` 与当前版本的 `source/`）。生成新产物后直接删除所有旧产物，包括旧版本目录、本地测试包和旧的解包目录，不做任何备份。

## Electron 版本升级

安全公告本身不触发升级。满足下面任一条才升级大版本：

1. **重大更新**：新版本在性能或功能上有对本项目的实际突破。例如 Chromium 的 WebGPU、WebCodecs、硬件编解码、内存、启动速度有明显改进，或者 Electron 新增的接口能替代我们现有的变通实现。提出升级时写明具体收益，能实测的先实测。
2. **落后太久**：当前大版本已停止官方支持，大约是发布后 6 个月、落后最新稳定版 3 个大版本。落后越久，一次要跨过的不兼容改动和原生模块问题越多，升级成本就越高。

补丁版本不单独追，升级时直接取目标大版本的最新补丁。

选版本与执行：

- 不选 x.0。选发布至少约一个月、已修过几轮补丁的版本，可以一次跨多个大版本。
- 先逐节读官方 [Breaking Changes](https://www.electronjs.org/docs/latest/breaking-changes)，对照代码确认受影响的位置。
- 升级后执行 `npm run electron:rebuild`，确认每个原生模块都能加载。
- 在真实窗口验收受影响的能力：剪辑播放与导出，以及改动波及的剪贴板、对话框等。

## 已知发布限制（非功能阻塞）

- **无代码签名证书时安装包是未签名状态**，这是预期状态。等 Windows 证书、Apple Developer 账号/公证条件具备后，再在 `electron-builder.yml` 增加签名配置。
- macOS 真机上的 DMG、safeStorage、拖拽/剪贴板、透明窗口验收尚未做
- 真实 GitHub Release 发布凭据下的线上自动更新尚未验证
- 用真实用户旧数据/API key/历史项目包做的最终手动回归尚未做

## 历史基线

当前分支基线是 Electron。旧 Tauri/Rust 外壳、依赖、脚本与 PAL adapter 已从工作树移除，需回看只走 Git 历史或 `old-Henji-AI/` 备份对照。

图像水印/分镜文字与旧 Rust 输出的像素级基线对比尚未做（功能 smoke 已过，可后置）。
