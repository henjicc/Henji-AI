# 模型与供应商适配

> 读取时机：新增供应商、新增模型、改模型参数 schema、改请求构建或轮询、模型没显示出来。
>
> 完整工作流（含确认清单与实施顺序）见 skill `henji-model-adaptation`；把模型接到画布节点见 [docs/rules/canvas.md](../../docs/rules/canvas.md) 与 skill `canvas-node-builder`。

## 配置驱动（最重要）

所有模型特定行为必须在配置中定义，而非代码：

- UI 渲染由 `src/models/{provider}/*.model.ts` 的参数 schema 驱动
- 用 `defineModel()` 定义，自动注册到 `ModelRegistry`
- **禁止**在 UI 组件中写 `if (modelId === 'specific-model')`
- **禁止**在通用组件中硬编码模型特定逻辑
- 需要模型特定行为时，**扩展 schema**，不要加分支

## 新增模型

在 `src/models/{provider}/{model-name}.model.ts`：

```typescript
import { defineModel } from '@/core'

export const myModel = defineModel({
  meta: {
    id: 'unique-model-id',
    canonicalModelId: 'common-model-id',
    provider: 'provider-name',
    type: 'video', // 'image' | 'video' | 'audio'
    name: { zh: '中文名', en: 'English Name' },
    tags: ['text-to-video'],
    polling: { interval: 3000, maxAttempts: 120 }
  },
  params: [
    {
      id: 'prompt',
      type: 'text',
      order: 1,
      name: { zh: '提示词', en: 'Prompt' },
      default: '',
      required: true
    }
  ],
  linkages: [],
  endpoints: {
    selector: (params) => '/api/endpoint'
  },
  request: {
    builder: (params) => ({ prompt: params.prompt })
  }
})
```

约定：

- 文件必须以 `.model.ts` 结尾且位于 `src/models/` 下，否则不会被注册
- 供应商模型文件**不填** `meta.description`；通用描述统一维护在 `src/core/modelCatalog/generationModelDescriptions.ts`
- 默认**不加随机种子（seed）参数**，归为"不显示且不请求"

验证：

```bash
npm run gen:model-manifest
npm run check:model-i18n
```

## 参数类型

以 `src/core/types/ComponentTypes.ts` 为准：

`text`（单行）、`textarea`（多行）、`number`、`dropdown`、`switch`、`radio`、`panel`（分组面板）、`composite`（自定义复合面板）、`image-upload`、`video-upload`、`file-upload`、`resolution`、`aspect-ratio`

## 产品入口聚合与旧 ID 兼容

- 同一供应商、同一模型家族、同一模态下，仅因端点、渠道或子能力不同而拆出的入口，默认先评估合并为一个产品模型，用顶层 `mode` / `channel` 切换；只有用户心智、输入输出模态或独立生命周期确实不同，才保留多个模型卡片。
- 只要模型存在产品级渠道切换，参数名称统一显示为“渠道”，选项统一为“普通 / 官方”；schema 使用 `sharedFieldText('apiChannel')` 与 `sharedOptionText('regular' | 'official')`。渠道参数的 `order` 必须严格小于所有其他参数，始终排在分辨率、比例、模式等参数之前。这条规则优先于“模式优先”。音频的“声道”不是产品渠道，不适用本条。
- 比例、分辨率、时长、数量、质量等跨模型通用参数继续使用同模态的标准名称、控件和顶层位置；渠道专属、模型特有或低频参数再放进特殊面板/高级设置。参数变多不能成为改变通用交互的理由。
- 合并或重命名时，旧 `meta.id` 必须进入 `meta.aliases`。若旧入口隐含了模式/渠道默认值，必须同时写 `meta.aliasParamDefaults`；若旧参数 ID 或值落点改变，写 `meta.aliasParamMappings`，禁止只做 ID 重定向后丢失旧工程语义。
- alias 兼容必须贯穿四个消费方：生成页初始参数、模型切换迁移、画布节点参数、主进程请求构建。完成后验证旧选择恢复、旧参数恢复、新模型列表去重和最终请求分支，而不是只验证注册表能找到新 ID。

## 媒体与文件 URL 参数（硬约束）

- 参数面板禁止出现让用户手动填写图片、视频、音频、PDF 等媒体/文件 URL 的文本输入框；API 字段名包含 `url` 不代表 UI 也应该是文本框。
- 必须按素材语义改用 `image-upload` / `video-upload` / `file-upload`，或复用现有 `FileUploader` 的上传按钮。角色图、风格图、深度图、遮罩图等语义不同的素材应各自保留清晰的上传入口，不能混成一个无法辨认用途的通用图片数组。
- 上传组件只保存本地受管路径或兼容旧数据中的远程 URL；真正的供应商网络上传统一在 Electron 主进程生成运行时完成。业务 UI 禁止直接请求供应商上传 API。
- 必须调用**当前生成供应商自己的官方文件上传服务**，拿到公网 URL 后再写入生成请求。供应商没有对应官方上传能力时，不得退化为“请用户自己找公网 URL”；应把该能力标为暂不可用并向用户确认处理方案。
- 对 `cref`、`sref`、`dref`、`mask_url`、`pdf_url` 这类无法靠通用字段名可靠识别的请求字段，在模型 `runtimeConstraints.mediaFields` 中声明字段与素材类型，由公共预处理层上传并替换；禁止把模型 ID 判断塞进上传运行时。
- builder 可以兼容读取旧工程保存的字符串 URL，但新 schema 默认值与新写入值必须使用上传类型约定的数组结构；兼容读取不等于继续暴露可编辑 URL 输入框。
- 改动后必须同时验证对话/工具面板的 `ParamRenderer` 与画布 `NodeParamControl`；标准节点仍自动读取同一 schema，不复制模型专属上传 UI。

## 联动系统

联动定义参数交互，执行优先级从高到低：

1. `reset` — 重置为默认值
2. `filterOptions` — 过滤选项
3. `filterRange` — 调整范围
4. `setValue` — 设置值
5. `autoSwitch` — 条件切换
6. `disable` — 禁用参数
7. `hide` — 隐藏参数
8. `custom` — 自定义逻辑

联动不生效时：验证 `trigger` / `target` 参数 ID，检查 `condition` 函数逻辑。

## Manifest / Seeds

`resources/model-manifest.json` 与 `resources/progress-seeds.json` 是**自动生成产物，不是手写主源**（Git 忽略；`resources/progress-seeds.base.json` 是基础 seeds，是手写源）。

- 它们在 `gen:model-manifest`、`dev`、`electron:dev`、`electron:build`、`electron:dist` 链路中刷新
- **单纯"退出并重新打开应用"不会重新生成 manifest**；修改模型定义、请求构建或运行时约束后，必须重跑上述脚本之一
- 主进程开发态读仓库内生成产物，打包态读随包 `resources/` 副本

## 调试

开发模式浏览器控制台：

```javascript
window.__MODEL_REGISTRY__   // 所有注册的模型
window.__listModels()       // 表格格式列出
window.__getModelStats()    // 注册表统计
window.__reloadModels()     // 重新加载
window.henjiNative          // Electron 安全桥（db/ai/image/media/updater 等白名单能力）
```

## 常见问题

**模型未显示**：检查文件名以 `.model.ts` 结尾、位置在 `src/models/` 下，然后跑 `npm run gen:model-manifest` 和 `npm run lint`。

**请求格式错误**：在 `request.builder()` 中加最小日志定位；对照 `resources/model-manifest.json` 检查 builder 输出；运行时错误看 `electron/main/services/ai-runtime/trace.ts` 相关 trace 与主进程日志。
