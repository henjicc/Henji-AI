# 场景 B：现有供应商新增模型

仅在供应商已接入 runtime 时走本流程。

## 1) 选参考模型（先复用再改）

优先选择“同供应商 + 同模态 + 同家族版本”文件做起点。

推荐参考：

- PPIO 图片：`src/models/ppio/seedream-4.5.model.ts`
- PPIO 视频：`src/models/ppio/kling-o1.model.ts`、`src/models/ppio/wan-2.6.model.ts`
- PPIO 音频：`src/models/ppio/minimax-speech-2.6.model.ts`
- FAL 图片：`src/models/fal/z-image-turbo.model.ts`
- FAL 视频：`src/models/fal/kling-video-o1.model.ts`
- KIE 图片：`src/models/kie/z-image.model.ts`
- KIE 视频：`src/models/kie/sora2.model.ts`
- ModelScope 图片：`src/models/modelscope/qwen-image.model.ts`

## 2) 新建模型定义

- 新建 `src/models/{provider}/{model-name}.model.ts`
- 使用 `defineModel()`，补齐：
  - `meta.id/provider/type/i18nScope/name/description/tags`
  - `params/linkages/endpoints/request/pricing`
- 文件名必须以 `.model.ts` 结尾。

### 2.1) 先判断要不要“一个模型多端点”

- 同一模型名称/版本命中多个 API 端点时，先不要急着拆文件。
- 按下面顺序判断：
  1. 若只是输入素材不同导致端点不同，且本质上仍是同一个模型版本，优先合并到一个模型。
  2. 若能用上传素材数量/类型唯一推断路由，优先自动切换，不新增 `mode`。
  3. 若虽然可以自动推断，但需要把“当前处于哪个模式”明确展示给用户，可以保留 `mode` 并通过 autoSwitch 自动改值。
  4. 若存在多个复杂子能力，无法仅靠素材数量唯一判定，或分支间参数/价格/轮询契约差异明显，新增 `mode`。
  5. 只有在一个模型文件内会导致 schema 难以维护、builder 难以收敛、用户心智明显混乱时，才拆成多个模型。
- 典型判定：
  - 图片：`无图=文生图，有图=图像编辑` -> 一个模型，自动切换。
  - 视频：`0张图=文生视频，1张图=首帧，2张图=首尾帧` -> 一个模型；可纯自动切换，也可保留 `mode` 并在 2 张图时自动切到 `首尾帧`。
  - 视频：再加 `多参考图` / `视频编辑` / `视频参考` -> 一个模型，但应显式 `mode`。

## 3) 参数设计

- 顺序规则见 `param-order-patterns.md`。
- 先通过 schema 表达模式差异，不在 UI 里写 `if (modelId===...)`。
- 需要媒体输入约束时优先用：
  - `inputLimits`
  - `requirements`
- 处理隐藏/固定参数时，遵循 `hidden-default-params.md`。
- 涉及比例/分辨率时，默认接入“智能比例”面板：
  - 默认 `smart`
  - 有图按首图匹配最近支持比例
  - 无图回退 `1:1`
  - 发送请求前转成具体比例值，不直传 `auto/smart`
- 设计 `mode` 时补充约束：
  - `mode` 只在确有必要时出现，不把“可由素材数量自动判定”的简单分支硬做成下拉。
  - `mode` 一旦出现，必须同步补 `inputLimits`、`requirements`、参数 `visible`/linkage。
  - 自动切换与显式 `mode` 可以混用，但要保证规则稳定且用户可理解，例如：
    - 默认 `text-image-to-video`
    - 上传 2 张图自动切到 `start-end-frame`
    - 复杂分支如 `video-edit` 仍由用户手动选
  - 若采用“显式展示 + 自动切换”：
    - `mode` 的首要作用是状态可见，不要求用户每次手动改；
    - 素材变化后要自动同步 `mode` 值，避免界面显示和真实请求路由不一致；
    - 自动切换规则必须可逆，例如删除第 2 张图后从 `start-end-frame` 回退到 `text-image-to-video`。

## 4) 请求构建

- 在 `request.builder` 内只处理模型请求映射。
- 以 API 文档为准，不盲拷旧模型字段。
- 不要把全局 prompt 再定义为模型 params（项目已有统一 prompt 输入）。
- PPIO 多媒体优先复用 `src/models/ppio/mediaSources.ts`。
- builder 必须“自包含”：只使用函数体内可访问的变量/函数。不要依赖文件顶层 helper（Rust JS 沙箱执行时会 `ReferenceError`）。
- 比例字段必须发送最终具体值（如 `16:9`），不发送 `smart/auto`。
- UI 层的复合参数/特殊组合，必须在 builder 转成 API 要求字段后再发送。
- 禁止把 UI 值未经转换直接透传给 API。
- 多端点模型必须同时检查：
  - `endpoints.selector` 是否完整覆盖所有路由分支；
  - builder 是否按分支输出不同字段；
  - pricing 是否能反映不同 mode/素材组合；
  - 若 provider runtime 对返回结构/轮询状态有差异，是否需要同步改 Rust provider。
- 若该模型在 `scripts/generate-model-manifest.cjs` 有 `CUSTOM_BUILDER_OVERRIDES`，需要同步更新 override。

## 5) i18n 与文案

- 在 `src/i18n/locales/zh-CN/models-{provider}.json` 新增 `defs.{modelId}`。
- 在 `src/i18n/locales/en-US/models-{provider}.json` 同步新增。
- 若用了 shared helper，确保 key 存在并能通过 i18n 检查。

## 6) 价格（必须确认）

- `pricing` 不能拍脑袋填写。
- 若用户没给价格，先追问后再编码。
- 追问至少包含：
  - 固定价还是计算价
  - 与分辨率/时长/数量是否有关
  - 价格文案如何展示
- 拿不到价格时，不提交最终模型定义。

## 7) 何时需要改 Rust provider

默认不改。仅当出现以下情况才改：

- 该模型返回结构与当前 provider 提取逻辑不兼容
- 轮询状态字段/状态值不同
- 鉴权、路由、method 有 provider 级新规则

## 8) 验证

- `npm run build`
- 推荐 `npm run tauri:dev` 验证真实提交与回包
- 若本地已有运行中的 Tauri 进程，改完后需重启或触发 manifest reload，确认 runtime 使用最新 `model-manifest.json`。
