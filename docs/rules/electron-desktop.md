# Electron 桌面容器

> 读取时机：改动 `electron/main/**` 或 `electron/preload/**`、加 IPC、动打包配置、验收桌面能力、处理自动更新。

## 验收必须看真实 Electron 窗口

裸浏览器 Vite 页面（`npm run dev`）不能作为桌面能力的最终依据。以下能力全部依赖 Electron 容器：

自定义标题栏、窗口控制、preload bridge、SQLite、safeStorage、`henji-media://` 媒体协议、自动更新、原生拖拽/剪贴板。

桌面端调试、测试、助手验证和 Agent 收尾启动一律优先使用
`npm run electron:dev -- --background`。该模式不是 headless：窗口会正常创建并加载，启动完成后直接最小化；
同时仅为该窗口设置 `backgroundThrottling: false`，让最小化状态下的动画、定时器继续运行，并持续绘制和交换帧。
用户从 Dock / 任务栏恢复痕迹AI后仍可正常取得焦点并交互。

只有必须验证“应用启动时主动取得焦点”、观察首屏，或用户明确要求前台弹出时，才使用普通
`npm run electron:dev`。项目正式 `test:reality` Electron 自动化仍走其统一启动器，不得用开发命令替代。

## 自动化脚本

Electron 自动化脚本通过 CDP/Playwright 启动构建产物。需要临时手动调试时，优先复用 `scripts/lib/electronLaunch.cjs` 中的启动方式。

## 打包配置

`electron-builder.yml` 当前配置：Windows NSIS/MSI、macOS DMG、GitHub Releases 发布通道、`better-sqlite3`/`sharp` 原生模块 unpack、manifest/seeds 资源分发。`resources/icons/` 是打包图标来源。

原生模块重建：`npm run electron:rebuild`。

## 已知发布限制（非功能阻塞）

- **无代码签名证书时安装包是未签名状态**，这是预期状态。等 Windows 证书、Apple Developer 账号/公证条件具备后，再在 `electron-builder.yml` 增加签名配置。
- macOS 真机上的 DMG、safeStorage、拖拽/剪贴板、透明窗口验收尚未做
- 真实 GitHub Release 发布凭据下的线上自动更新尚未验证
- 用真实用户旧数据/API key/历史项目包做的最终手动回归尚未做

## 历史基线

当前分支基线是 Electron。旧 Tauri/Rust 外壳、依赖、脚本与 PAL adapter 已从工作树移除，需回看只走 Git 历史或 `old-Henji-AI/` 备份对照。

图像水印/分镜文字与旧 Rust 输出的像素级基线对比尚未做（功能 smoke 已过，可后置）。
