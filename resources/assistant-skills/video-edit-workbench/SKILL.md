---
name: video-edit-workbench
description: 在痕迹AI剪辑工作台做粗剪、整理时间线、节奏、字幕、配乐与音量、响度、调色、转场、多机位、竖版改画幅、导出，或把生成、画布、图片文档、口播产物放进剪辑及把剪辑帧送到其他工作区时使用。写代码画面用 video-edit-code-creation；单独写代码素材不触发本技能。
---

# 剪辑工作台：围绕素材与意图完成成片

## 总原则

- 本技能给起点与判断依据，不规定风格。用户简报、偏好和素材本身优先；数值与配方可为创意突破。没有明确偏好时给差异明显的方向，已有授权就自主选择并说明，不把选方向变成每次操作的审批。
- 先把内容与结构剪通，再精修切点、声音、字幕和质感。快剪、长镜头、纪录、广告、综艺都有成立的理由，例子只示范方法。
- 人说目标，助手先做繁琐的分析、整理与候选，人校正判断；缺素材可在剪辑原地生成，已有产物直接跨工作区复用。

## 铁律：只约束真实契约

1. 先从宿主上下文或 `list_documents` 确定文档，再用 `describe_application_entities`、`list_application_entities`、`read_application_entity` 读目标序列、轨道、片段与关联。引用来自返回值，不猜 ID，不靠同名定位，不随前台切换换目标。
2. 普通读改增删用 `change_application_entities` 的 `set_properties`、`create_items`、`remove_items`；算法操作用正式能力。属性、必填项、枚举和单位按发现结果，缺工具时内置 Pi 用 `load_application_tools` 加载 video_edit；外部 MCP 从 `describe_application_contract` 发现。
3. 序列时间用整数帧，源入点用微秒，标为 Seconds 的字段用秒；有理帧率精确换算，范围通常半开。不要把改 duration 的修剪当成保持内容的变速。
4. 同目的独立修改合并事务，依赖新返回引用才分调用；删除先读目标与父集合，外部 MCP 写入带 operationId，删除带相关 baselineIds。结果未知用 `get_application_operation` 查原操作，不能换标识重放。
5. 尊重锁轨、链接、编组、用户手调和来源身份。失败先读动态可用性与恢复提示；不要为绕过拒绝自动解锁、删关联内容或手算整个波纹链。`undo_video_edit` / `redo_video_edit` 仅作用于明确剪辑的一步历史。
6. 识别、翻译、模型生成可能计费，遵守正式审批与授权；准备不等于付费提交，不能代替用户批准。已有生成或已完成导出只复用，不重新付费。
7. 修改后回读结构；画面用 `observe_video_edit_frame` 离屏出帧并用 `read_application_media` 真读图。静帧不能证明节奏、听感或编码成片质量；没看到或没听到就说明证据边界。

## 拒绝与保存恢复

- 外层 `executionState=not_executed` 或失败事实 `details.execution.notExecuted=true` 表示未提交业务修改；读原因，修正前置条件后用新 operationId 执行。无原视频的图文序列不能自动重构，应先放入视频。失败不等于 unknown。
- `partial` 且回执说明修改已保留、保存未确认时，用 `retry_application_operation_save`：新 operationId 标识这次恢复，originalOperationId 必须是原修改调用的 operationId。它只保存并核对原产物，不重复放入或生成；不要另调被写入保护挡住的 `save_video_edit`。
- 原操作查询到 completed 且 verificationState=verified 才解除本次恢复；媒体或落位不符仍保留保护。unknown 先查询原操作，不能换连接、换标识或重新生成绕过。
- `prepare_generation_task.preparation.prepared=true` 只表示参数准备成功；同时检查 providerConfigured/canSubmit。供应商未配置时不能提交；可提交仍不代替付费授权。

## 路由表

用 `load_assistant_skill`，name 为 video-edit-workbench，省略 path 读入口；按当前步骤读一两篇参考。

| 任务 | 何时读 |
| --- | --- |
| 序列、轨道、命名、嵌套、链接、标记、拆分修剪与变速 | [时间线](references/timeline.md) |
| 粗剪到精剪、镜头切点、场景批量拆分、按文本剪、多机位 | [节奏与结构](references/rhythm.md) |
| 配乐、人声回避、响度测量与标准化、静音与语气词 | [声音](references/sound.md) |
| 识别生成、分段、翻译、字幕样式、花字分流 | [字幕](references/captions.md) |
| 全能调色、自动校色、参考匹配、LUT、HSL、内置及框架转场 | [调色与转场](references/color-transitions.md) |
| 导出预设、范围、队列、竖版改画幅、收录与交付自检 | [交付](references/deliver.md) |
| 生成／画布／图片／口播进剪辑、节目帧出去、原地生成 | [跨工作区](references/cross-workspace.md) |

## 标准流程

1. **接简报、读现状**：确认观众、用途、时长、情绪、画幅与交付物；已有信息直接复用。局部修改跳到对应步骤，不重做全片提案。
2. **整理和分析**：查素材与已有版本，建立必要轨道分工和命名；用场景、文本、多机位分析辅助，不把检测结果当审美判断。
3. **粗排完整结构**：先排叙事／信息／情绪关系，标记关键段；可在对话中给快节奏与沉浸式等不同方向，不自动创建说明文档或无关工程。
4. **精剪和修声音**：围绕动作、语义、视线和声画交接调切点；再做字幕、调色和转场。缺镜头先复用，需生成时按正式付费边界执行。
5. **审查与局部返修**：整体看内容和起伏，关键停留帧看可读性，切点附近看连续帧；有声音的任务另核实听感。用户已明确直接做完时不额外停下求确认。
6. **交付**：回读范围、队列和结果，按要求导出与收录；给出结果位置、取舍、可继续修改的内容及未验项。仅用户要求查看时导航到实际主序列，不为后台操作切页。
