使用中文回复，每次回复开头都添加"💡"

本仓库当前权威协作约定与开发基线见 `AGENTS.md`。

重要摘要：

- 当前开发主路径是 Electron；Tauri/Rust 旧壳仅作回退、对照和 4.3 最终清理前的兼容保留
- 新增桌面能力优先落在 `electron/main/services/**`、`electron/main/ipc/**`、`electron/preload/**` 与 `src/platform/adapters/electron/**`
- 渲染层禁止直接 import `@tauri-apps/*`、Electron `ipcRenderer` 或 Node 内置模块；统一经 `src/platform/*` / `src/commands/*`
- 模型生成主链路是 `GenerationService -> src/commands/aiRuntime.ts -> src/platform -> Electron preload -> electron/main/services/ai-runtime`
- 证书、公证、真实 GitHub Release、macOS 真机和真实旧数据/API key 回归是发布前验收项，不阻塞日常 Electron 开发

如本文件与 `AGENTS.md` 冲突，以 `AGENTS.md` 为准。
