---
name: 图片生成
description: 用户要生成、出图、画一张图、做海报/插画/头像/封面，或要求换个模型重新生成时使用。覆盖从选模型、读参数、提交任务到判断成败的完整流程。不涉及视频和音频生成。
---

# 图片生成

应用操作只有一个入口：先调用 `discover_application_capabilities` 取得本轮 `scriptApi`，再把模型选择、参数校验、提交、等待和正式验证写进**同一段** `henji-ts/v1`，只调用一次 `run_henji_script`。不要直接逐次调用生成工具，不要填写能力版本、revision、输出绑定或 Action Plan。

## 生成并放入画布：优先使用 Recipe

用户同时要求生成图片并放进画布时，优先使用发现结果中的 `generation.image_to_canvas`。它会使用同一解释器选择可执行模型、校验参数、提交任务，等待权威成功状态后继续创建画布并验证真实媒体节点。

```ts
const result = await app.recipe('generation.image_to_canvas', {
  projectName: '图片生成结果',
  prompt: '用户要求的完整提示词',
})
app.assert.exists(result.resultRefs)
```

只有本轮 `scriptApi.recipes` 真实包含该 Recipe 时才能调用；不要仿造未发现的 Recipe 或参数。

## 只生成图片

没有完全匹配的 Recipe 时，使用本轮 `scriptApi.actions` 披露的签名在一段 Henji Script 中完成：

1. `resolve_generation_model` 按媒体类型、用户点名模型和供应商偏好解析实际可执行模型。
2. `prepare_generation_task` 用真实模型 schema 校验并规范化参数。
3. `create_visible_generation_task` 提交一次用户可见任务。
4. `get_generation_task` 作为脚本内的权威等待点；宿主会保存 IR 断点并在外部任务完成后自动续接，不要让模型轮询或重新生成剩余步骤。
5. 只有权威状态成功、结果引用可用并通过正式验证，才能声称生成完成。

模型 ID、action 输入和输出字段一律以当前 `scriptApi` 为准，不从本 skill 猜测。零副作用的编译或参数预检失败可以修正同一脚本；任务已经提交后不得再次提交来“重试验证”。

## 模型选择

- 用户点名模型时把完整模型 ID 交给 `resolve_generation_model`；不存在或当前不可执行时停止，不擅自换模型。
- 用户只表达供应商偏好时传入偏好，由宿主在已配置且兼容的候选中解析。
- 用户未指定时让宿主依据当前草稿、媒体类型和已配置供应商选择，不要反复搜索模型目录。
- 内容、风格和题材属于 prompt，不是模型搜索条件。

## 选模型的优先级

安全与真实能力硬约束 > 用户当前明确要求 > 长期用户指令 > 通用模型描述与系统默认倾向。

- `tags`、输入约束、参数 schema 是硬约束；通用描述只用来在**已经兼容**的模型之间判断擅长方向，不能从描述里推断没声明的能力。
- 上述都满足、用户又没点名模型时，优先选描述里带"推荐使用"的兼容模型。
- 用户说省钱、低成本、随便测一下时，用目录给的价格估算，需要搜索就传 `sortBy=lowest_estimated_price`；最终以参数校验后返回的实际估算为准。

## 任务状态怎么答

| 状态 | 怎么说 | 下一步 |
|---|---|---|
| `pending` / `queued` / `generating` | 说明已提交、当前状态 | 由脚本 checkpoint 等待权威事件，不要轮询或另起脚本 |
| `completed` | 才可以说成功，结果可展示 | 用稳定引用交付，不要贴本地路径 |
| `error` | 先读 `errorMessage` 和 `recovery` | 见下 |

## 失败恢复

`recovery.strategy` 是 `correct_same_model_parameters` 时，**必须保留 `sourceModelId`**：

1. 重新发现当前 `scriptApi`，确认原模型仍可用。
2. 按发现到的真实参数约束修正 Henji Script 输入。
3. 让 `prepare_generation_task` 在任何新提交前完成校验。
4. 最多再提交一次同模型的修正任务。

不允许搜索、读取或创建替代模型。如果这个模型确实满足不了用户的明确要求，向用户说明约束并请他选择，而不是擅自换模型。

## 常见错误

- 没使用 `scriptApi` 的真实 schema，凭描述或旧 skill 猜参数
- 把"赛博朋克风格"这类词当成模型目录的搜索关键词
- 任务还在 generating 就说"已经生成好了"
- 参数错误时换一个模型重试（用户要的是那个模型）
- 外部等待后重新生成脚本或重复提交任务，而不是从宿主 checkpoint 续接
- 答复里出现本地绝对路径
