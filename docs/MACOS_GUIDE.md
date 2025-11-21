# macOS 适配与构建指南

本项目已经完成了针对 macOS 的代码适配。如果你需要在 macOS 上开发或打包应用，请按照以下步骤操作。

## 1. 环境准备

在 macOS 上，你需要安装以下依赖：

1.  **Rust & Cargo**:
    ```bash
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
    ```
2.  **Node.js & npm**: 建议使用 LTS 版本。
3.  **Xcode Command Line Tools**:
    ```bash
    xcode-select --install
    ```

## 2. 图标生成 (重要)

macOS 应用程序需要 `.icns` 格式的图标。目前的 `src-tauri/icons` 目录中缺少此文件。

如果你有原始的高清图标图片（例如 `app-icon.png`，建议 1024x1024），请在项目根目录下运行以下命令自动生成所有平台的图标：

```bash
npm run tauri icon /path/to/your/app-icon.png
```

这会自动生成 `icon.icns`、`icon.ico` 和各种尺寸的 png 图标到 `src-tauri/icons` 目录。

**注意**：如果没有生成 `icon.icns`，macOS 打包将会失败。

## 3. 开发与运行

在 macOS 上，请使用以下命令启动开发环境：

```bash
npm run tauri:dev:mac
```

> **注意**：不要使用 `npm run tauri:dev`，因为该命令包含 Windows 专用的环境设置脚本，在 macOS 上会报错。

## 4. 打包发布

要构建 macOS 的安装包（`.dmg` 或 `.app`），请运行：

```bash
npm run tauri:build:mac
```

构建完成后，安装包将位于 `src-tauri/target/release/bundle/macos/` 或 `dmg/` 目录下。

## 5. 代码适配说明

为了支持跨平台，我们已经做了以下修改：

-   **后端 (`main.rs`)**: 只有在 Windows 平台编译时才隐藏控制台窗口，避免了 macOS 编译错误。
-   **配置 (`tauri.conf.json`)**: 添加了 macOS 专属的 Bundle ID 和图标配置。
-   **界面 (`WindowControls.tsx`)**: 自动检测 macOS 系统。如果在 macOS 上运行，窗口控制按钮（关闭/最小化/最大化）将自动调整为左侧的“红绿灯”风格，以符合 macOS 的操作习惯。
-   **脚本 (`package.json`)**: 新增了 `tauri:dev:mac` 和 `tauri:build:mac` 命令。
