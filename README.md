<div align="center">
  <img src="./src-tauri/icons/128x128@2x.png" width="100" height="100" alt="痕迹AI" style="margin-bottom: -50px;">
  <h1 style="color: #00a0ea;">痕迹AI</h1>
  <h3>一个软件用上各种AI - 聚合多家供应商，一站式生成图片、视频和音频</h3>
  
  [![Bilibili](https://img.shields.io/badge/bilibili-痕继痕迹-00AEEC?logo=bilibili)](https://space.bilibili.com/39337803)
  
</div>


## 下载

<div align="center">

[![Download Latest Release](https://img.shields.io/github/v/release/henjicc/Henji-AI?style=for-the-badge&label=下载最新版本&color=blue)](https://github.com/henjicc/Henji-AI/releases/latest)

**支持 Windows 和 macOS**

</div>

## 功能特性

- 多家供应商可选，目前已适配：[派欧云](https://ppio.com/user/register?invited_by=MLBDS6)、[fal](https://fal.ai/)、[魔搭](https://modelscope.cn/)
- 还算是比较简洁美观的界面，基础功能也比较完善

## 适配列表

### 图片

| 供应商 | 模型 | 功能 |
|--------|------|------|
| 派欧云 | 即梦图片 4.0 | 图片生成、图片编辑 |
| fal | Nano Banana | 图片生成、图片编辑 |
| fal | Nano Banana Pro | 图片生成、图片编辑 |
| fal | 即梦图片 4.0 | 图片生成、图片编辑 |
| fal | 即梦图片 4.5 | 图片生成、图片编辑 |
| fal | Z-Image-Turbo | 图片生成 |
| fal | 可灵图片 O1 | 图片生成、图片编辑 |
| 魔搭 | Z-Image-Turbo | 图片生成 |
| 魔搭 | FLUX.1-Krea-dev | 图片生成 |
| 魔搭 | Qwen-Image | 图片生成 |
| 魔搭 | Qwen-Image-Edit-2509 | 图片编辑 |
| 魔搭 | 魔搭API自定义 | 图片生成、图片编辑 |

### 视频

| 供应商 | 模型 | 功能 |
|--------|------|------|
| 派欧云 | Vidu Q1 | 文生视频、图生视频、首尾帧、参考生视频 |
| 派欧云 | 可灵 2.5 Turbo | 文生视频、图生视频 |
| 派欧云 | 海螺 Hailuo 2.3 | 文生视频、图生视频 |
| 派欧云 | 海螺 Hailuo-02 | 文生视频、图生视频、首尾帧 |
| 派欧云 | PixVerse V4.5 | 文生视频、图生视频 |
| 派欧云 | 万相 2.5 Preview | 文生视频、图生视频 |
| 派欧云 | 即梦视频 3.0 | 文生视频、图生视频、首尾帧 |
| fal | Veo 3.1 | 文生视频、图生视频、首尾帧、参考生视频 |
| fal | Sora 2 | 文生视频、图生视频 |
| fal | 可灵 V2.6 Pro | 文生视频、图生视频 |
| fal | 可灵 O1 | 图生视频、参考生视频、视频编辑、视频参考 |
| fal | LTX-2 | 文生视频、图生视频、视频编辑 |
| fal | 即梦视频 3.0 | 文生视频、图生视频、首尾帧、参考生视频 |
| fal | Vidu Q2 | 文生视频、图生视频、参考生视频、视频延长 |
| fal | PixVerse V5.5 | 文生视频、图生视频、首尾帧 |
| fal | 万相 2.5 Preview | 文生视频、图生视频 |
| fal | 海螺 Hailuo 2.3 | 文生视频、图生视频 |
| fal | 海螺 Hailuo-02 | 文生视频、图生视频、首尾帧 |

### 音频

| 供应商 | 模型 | 功能 |
|--------|------|------|
| 派欧云 | MiniMax Speech-2.6 | 语音合成 |

## 技术栈

- **框架**: [Tauri 2.0](https://tauri.app/) - 基于 Rust 的跨平台桌面应用框架
- **前端**: React 18 + TypeScript
- **构建工具**: Vite 4
- **样式**: Tailwind CSS
- **HTTP 客户端**: Axios
- **图片处理**: Pica

## 项目结构

```
Henji-AI/
├── src/                      # 前端源码
│   ├── adapters/            # API 适配器（派欧云、fal、魔搭）
│   ├── components/          # React 组件
│   ├── config/              # 供应商和模型配置
│   ├── services/            # 业务逻辑层
│   ├── types/               # TypeScript 类型定义
│   └── utils/               # 工具函数
├── src-tauri/               # Tauri 后端
│   ├── src/                 # Rust 源码
│   ├── icons/               # 应用图标
│   └── Cargo.toml           # Rust 依赖
└── .github/workflows/       # GitHub Actions CI/CD
```

## 开发指南

### 环境要求

- **Node.js**: 18+ (推荐使用 LTS 版本)
- **Rust**: 1.70+
- **Windows**: Visual Studio Build Tools (MSVC)
- **macOS**: Xcode Command Line Tools

### 安装依赖

```bash
npm install
```

### 开发模式

**Windows**:
```bash
npm run tauri:dev
```

**macOS**:
```bash
npm run tauri:dev:mac
```

### 构建应用

**Windows** (生成 MSI 安装包):
```bash
npm run tauri:build
```

**macOS** (生成 DMG 安装包):
```bash
npm run tauri:build:mac
```

构建产物位于 `src-tauri/target/release/bundle/`

## 架构说明

### 适配器模式

项目采用适配器模式统一不同 AI 供应商的 API：

```
MediaGenerator → AdapterFactory → 具体适配器 (PPIOAdapter / FalAdapter / ModelscopeAdapter)
```

每个适配器实现统一的接口，支持图片、视频、音频生成。

### 数据存储

- **API Keys**: localStorage
- **历史记录**: AppLocalData (`Henji-AI/history.json`)
- **媒体文件**: AppLocalData (`Henji-AI/Media/`)
- **缓存**: AppLocalData (`Henji-AI/Uploads/`, `Henji-AI/Waveforms/`)

### 跨平台适配

- Windows 和 macOS 使用不同的构建脚本
- 窗口控制自动适配操作系统风格
- 文件路径使用 Tauri API 保证跨平台兼容

## 扩展开发

想要添加新的 AI 模型或供应商？请参考 **[模型与供应商适配指南](docs/model-adaptation-guide.md)**，了解如何：

- 定义新模型的参数 Schema
- 实现后端适配器
- 注册模型到系统中

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 开源许可证。
