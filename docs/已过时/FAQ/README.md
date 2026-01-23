## 核心指南 (GUIDEs)
*   **[核心适配指南](docs/FAQ/GUIDE-核心适配指南.md)**
    *   简介：最核心的开发文档。涵盖了整体适配架构、Provider 接入流程、Model 注册规范以及 UI 与 Schema 规范。
*   **[参数同步清单](docs/FAQ/GUIDE-参数同步清单.md)**
    *   简介：添加新模型参数时的“防漏手册”。详细列出了从 State 定义到价格估算等必须同步更新的 6 个关键点。

## 常见问题 (FAQs)
*   **[配置驱动架构常见问题](docs/FAQ/FAQ-配置驱动架构.md)**
    *   简介：深入讲解 `autoSwitch`、`paramMapping`、`transform` 及 `watchKeys` 的工作机制与调试技巧。
*   **[视频与状态管理最佳实践](docs/FAQ/FAQ-视频与状态管理.md)**
    *   简介：解决 Tauri 环境下视频路径处理、状态同步及缩略图显示问题的技术总结。

## 适配案例 (CASEs)
*   **[Fal 系列适配案例总结](docs/FAQ/CASE-Fal适配案例.md)**
    *   简介：针对 Fal 提供商的模型（如 Hailuo, Kling）遇到的特定坑位（如价格计算、模式切换）的实战总结。
*   **[Z-Image-Turbo 分辨率系统集成](docs/FAQ/CASE-ZImageTurbo适配案例.md)**
    *   简介：以 Z-Image-Turbo 为例，详细拆解分辨率选择器、自定义尺寸输入与 API 格式转换的集成流程。
*   **[魔搭 (ModelScope) 异步模式实现](docs/FAQ/CASE-魔搭适配案例.md)**
    *   简介：由 CORS 限制引发的技术难题及通过 Tauri 后端代理实现异步轮询的底层方案总结。

## 运维构建 (OPS)
*   **[GitHub Actions 自动构建指南](docs/FAQ/OPS-自动构建指南.md)**
    *   简介：介绍如何为 Windows 和 macOS 平台配置 CI/CD 自动化构建与发布流程。
