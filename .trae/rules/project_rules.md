# 项目概述

Henji AI（痕迹AI） 是一个使用 Tauri 框架构建的跨平台桌面应用，通过调用各种API接口生成图片、视频和音频。

## 主要技术栈

- **桌面端框架**: [Tauri](https://tauri.app/) (使用 Rust 作为后端)
- **前端框架**: [React](https://react.dev/)
- **语言**: [TypeScript](https://www.typescriptlang.org/) 和 [Rust](https://www.rust-lang.org/)
- **构建工具**: [Vite](https://vitejs.dev/)
- **UI 样式**: [Tailwind CSS](https://tailwindcss.com/)
- **HTTP 客户端**: [Axios](https://axios-http.com/)

## 构建与开发
主要是作为桌面端开发，当前开发环境为 Windows，考虑兼容 macOS，其它平台以后再说。
- **开发模式**:
  - `npm run tauri:dev`: 启动完整的 Tauri 应用，包含 Rust 后端，用于桌面端功能的开发和调试。
- **构建**:
  - `npm run tauri:build`: 构建生产环境的 Tauri 应用，生成可分发的桌面安装包。

## 项目结构与核心逻辑

项目采用经典的前后端分离结构，并通过 Tauri 的 JS-Rust 互操作能力进行通信。

### 前端 (`src/`)

- **`App.tsx`**: 应用的主组件和核心逻辑层。负责管理应用级别的状态（如任务队列、API 密钥、设置等），调度 AI 生成任务，并通过长轮询处理异步任务的状态更新。
- **`components/MediaGenerator.tsx`**: 核心 UI 组件，提供用户交互界面，包括文本输入、模型选择、参数配置和图片上传。它会根据所选模型动态渲染不同的配置项。
- **`services/api.ts`**: API 服务层，封装了与 AI 服务适配器的交互逻辑。
- **`adapters/`**: AI 服务集成目录，采用适配器和工厂模式设计，具有良好的可扩展性。
  - **`base/BaseAdapter.ts`**: 定义了所有 AI 服务适配器必须遵守的统一接口 (`MediaGeneratorAdapter`)。
  - **`PPIOAdapter.ts`**: 派欧云（PPIO）服务的具体实现，负责将应用请求转换为该平台的 API 调用。
  - **`index.ts`**: 适配器工厂 (`AdapterFactory`)，用于根据配置动态创建和管理不同的 AI 服务适配器实例。

### 后端 (`src-tauri/`)

- **`main.rs`**: Tauri 后端的入口文件，使用 Rust 编写。
- **`Cargo.toml`**: Rust 的包管理文件，定义了后端的依赖项，如 `tauri-plugin-fs` (文件系统)、`tauri-plugin-dialog` (原生对话框) 和 `tauri-plugin-http` (HTTP 请求)。
- **`tauri.conf.json`**: Tauri 应用的配置文件，定义了应用标识、窗口属性（如无边框窗口）、构建命令等。