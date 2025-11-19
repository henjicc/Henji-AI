# 痕迹AI（Henji AI）

Henji AI 是一个使用 Tauri + React 构建的跨平台桌面应用，通过集成派欧云（PPIO）等模型生成图片、视频和音频。

## 功能特性

- 图片、视频、音频多媒体生成与下载保存（桌面端本地持久化）
- 多模型支持：Seedream 4.0（图像）、Vidu Q1、Kling 2.5、MiniMax Hailuo、PixVerse、Wan 2.5、Seedance（视频）、MiniMax Speech 2.6（音频）
- 统一适配器接口与工厂，参数自动归一与智能分辨率计算
- 任务轮询与历史记录管理，错误提示与重试引导
- 无边框桌面窗口与原生文件/对话框/HTTP 能力（Tauri 插件）

## 技术栈

- 桌面端：Tauri（Rust）
- 前端：React 18 + TypeScript
- 构建：Vite
- 样式：Tailwind CSS
- HTTP：Axios

## 快速开始

1. 安装依赖：
```
npm install
```
2. 仅前端开发预览：
```
npm run dev
```
3. 桌面端开发（含 Tauri 后端，Windows 推荐）：
```
npm run tauri:dev
```
4. 构建桌面安装包：
```
npm run tauri:build
```
5. 构建与预览前端：
```
npm run build
npm run preview
```

### Windows 环境注意

- `tauri:dev` 与 `tauri:build` 会调用 VS BuildTools 的 `VsDevCmd.bat` 并设置 `CC/CXX=cl.exe`，确保已安装 MSVC 工具链。

## 使用指南

1. 打开应用后，点击右上角“设置”，填入派欧云 API Key（保存在本机 `localStorage`）
2. 在主界面选择“图片/视频/音频”与具体模型，配置参数
3. 图片/视频可上传、粘贴或拖拽图片；音频填写文本并选择音色与规格
4. 点击“生成”开始任务；视频会自动轮询直至完成
5. 成功生成的媒体会下载至本地并展示，可在历史记录中查看与删除

## 目录结构

```
src/
├── adapters/            # 统一接口与派欧云适配器
├── components/          # UI 组件（生成器、设置、播放器、窗控等）
├── config/              # 供应商与模型配置
├── services/            # API 服务层（适配器工厂与任务接口）
├── utils/               # 文件保存/下载、波形缓存、图片压缩等
├── types/               # 类型定义
├── App.tsx              # 主应用组件与任务调度
├── main.tsx             # 前端入口
└── index.css            # 全局样式

src-tauri/
├── src/main.rs          # Tauri 后端入口与插件注册
├── Cargo.toml           # Rust 依赖声明
└── tauri.conf.json      # Tauri 配置（窗口、安全、构建）
```

## 适配器与生成流程

- 统一接口：`MediaGeneratorAdapter`（图片/视频/音频生成与任务查询）
- 工厂：`AdapterFactory` 当前支持 `piaoyun`，返回 `PPIOAdapter`
- 生成流程：
  - 前端 `MediaGenerator` 收集参数 → `apiService` 调用适配器
  - 图片/音频多为同步返回 URL；视频返回 `task_id` 并轮询任务结果
  - 桌面端使用 Tauri 插件下载媒体到本地并展示（含 `blob`/`convertFileSrc`）

## 媒体保存与历史

- 本地保存路径：应用数据目录 `Henji-AI/Media`
- 历史记录：持久化到 `Henji-AI/history.json`（桌面端）；浏览器模式使用 `localStorage` 兜底
- 删除历史会同步清理对应文件与缓存

## 配置与安全

- API Key 存储在本地 `localStorage`，仅用于请求头 `Authorization: Bearer ...`
- 未使用 `.env`；如需更安全存储，可后续迁移至 Tauri 安全存储插件
- 资源访问通过 Tauri 的 `assetProtocol` 与 CSP 限制完成

## 常见问题

- 视频任务长时间无结果：请检查网络与模型可用性，或重试更换分辨率/时长
- Windows 构建失败：确认 VS BuildTools 与 MSVC 工具链安装完整，并通过 `npm run tauri:dev` 测试
- API Key 失效：在“设置”中重新填写并保存

## 扩展开发

- **添加新模型/供应商**：请参考 [模型与供应商适配指南](docs/model-adaptation-guide.md)，了解如何定义参数 Schema 和实现后端适配器。

## 许可证

本项目代码以仓库根目录声明为准。
