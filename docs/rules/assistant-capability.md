# 智能助手应用能力覆盖

> 读取时机：新增或修改工作区、页面、浮层、工具箱工具、设置项、用户可查询数据、业务操作、稳定引用、权限、宿主上下文或能力搜索。
>
> **这些场景必须同时读 skill `henji-application-capability`**（含 schema 字段、注册模式、迁移步骤与示例代码）。本文件只是硬约束清单。

## 唯一元数据源

所有向助手开放的功能必须以 `ApplicationCapabilityDefinition` 作为 schema、权限、风险、数据等级、引用、可用条件、并发规则、成功证据和失败恢复的唯一元数据源。

AI 输入 schema 顶层必须设置 `additionalProperties: false`。禁止 `patch`、`storePatch`、`executeScript`、`script`、`code` 等任意 Store Patch 或脚本执行字段；需要新增参数时先扩展正式领域 schema/注册表。

## 覆盖判断不可跳过

每个用户可见的工作区、工具、设置项和数据模块，都必须：

- 注册对应能力，**或**
- 在覆盖清单中明确声明"不向助手开放"及原因

不得因为暂时没有助手需求就跳过覆盖判断。

## 禁止事项

- **禁止**新增旧式 `HostCommand`、`HostQuery`、`kind: 'command'`、`kind: 'query'`、固定前端命令/查询执行表，或依赖兼容描述生成器的 Agent 工具
- 能力处理器**必须调用正式业务服务**，不得复制业务逻辑
- 后台可完成的操作，不得为了复用页面组件而强制切换页面
- 跨模块传递实体必须用 `ApplicationRef` 或 artifact 引用，**不得**向模型暴露原始密钥、本地路径或不受控的大对象
- **不得**以"助手已判断"为理由绕过安全边界
- **禁止**从能力处理器直接调用 Store `setState` 做任意 Patch；仅允许正式领域服务内部对已声明字段执行确定性状态提交
- **禁止**在 Application API、能力定义或 Agent Runtime 增加 `eval`、`new Function` 或任意脚本执行入口

## 必须接入的现有机制

新能力必须接入：权限审批、revision、幂等、撤销、并发、脱敏、结构化日志、成功证据验证。

## 迁移纪律

迁移旧能力时，同一模块完成后**立即删除**对应旧实现，禁止长期双轨。

## 验证

```bash
npm run check:assistant-capabilities
```

`check:assistant-capabilities` 已接入 `build` 与 `electron:build` 链路，覆盖不全或残留旧通道会直接构建失败。

CI 必须显式运行该门禁；门禁同时验证双端技能同步、旧执行入口、Application API 跨层导入、Surface 观察策略以及任意 Patch/脚本禁令。

再按 [testing.md](testing.md) 运行本次能力登记、处理器或正式业务服务的精确/相关测试。`npm run test:assistant-production` 只用于同时影响 runner、状态机、调度、审批、持久化或模型适配等多个助手运行时模块的改动，以及生产验收/发布前检查；不要因普通能力登记或界面适配运行整套助手测试。

只有改动跨越“模型决策 → 工具调用 → 业务落地 → 成功证据”完整链路，且精确测试不足以证明行为时，才无窗口执行真实助手端到端验证：

```bash
npm run assistant:cli -- --goal "任务描述" --trace detailed --await-generation
```

复用正式助手与工具链，结束时输出 `runId`（可用 `npm run logs:query -- --chain <runId>` 查整条链路）。`--await-generation` 保持同一隐藏宿主并读取本次生成任务的最终状态。`--print-trace` 输出本机已脱敏的详细追踪。**涉及付费或写入操作时，必须由调用者显式确认 `--approval full_access`。**

## Surface 视觉观察

- 每个注册 Surface 都必须声明统一观察能力、领域提供者、捕获范围、数据等级、遮罩策略、支持模态、最大尺寸和失效条件，并通过覆盖清单门禁。
- 提供者、数据等级、遮罩策略和支持模态的唯一判断入口是 `resolveSurfaceObservationProfile`（`src/core/assistant/applicationSurfaces.ts`）；`surfaceCatalog.ts` 与覆盖清单都从它派生，**禁止**在任何一侧另写一份判断。
- 界面标注 `data-application-surface-id` 时必须从目录反查（设置用 `resolveSettingsSurfaceId`），**禁止**在组件里复制分区到 Surface 的映射表；新增设置分区只改 `SETTINGS_SECTION_IDS` 与 `surfaceCatalog.ts`。
- 观察顺序固定为：领域结构化状态 → 稳定原生媒体/预览 → 专用视口 → 注册 Surface 区域截图。生成结果、素材、视频和音频不得退化为页面缩略图。
- 通用截图只能由渲染层提交当前 Surface 可见边界和敏感矩形，主进程只调用当前 Henji-AI `webContents.capturePage` 并再次校验范围；禁止 OS 全屏、其他窗口和越界回退。
- API Key、本地路径、输入框和显式 `data-observation-sensitive` 区域必须在主进程输出媒体前完成覆盖遮罩，日志不得记录截图内容、密钥或原始路径。
- 默认遮罩覆盖 `input/textarea/select` 与 `contenteditable`（提示词编辑器是富文本，不是 `<input>`）。**非输入控件呈现的敏感内容不会被自动遮罩**：凡是把本地绝对路径、密钥、令牌渲染成普通文本的节点，必须自己标 `data-observation-sensitive`，否则会被原样截给模型。
- `observe_application_surface` 是否开放由运行时 primary/observer 的真实媒体模态与权限共同决定；实际媒体仍要经过 provider 协议、大小、时长、编码和取消门禁。
- 最终答复必须区分结构化验证、主模型视觉验证、观察模型视觉验证和未验证；稳定媒体引用本身不是视觉验证证据。
