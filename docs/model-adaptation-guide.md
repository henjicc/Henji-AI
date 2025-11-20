# 模型与供应商适配指南

本文档旨在指导开发者（以及 AI 编程助手）如何为 Henji AI 添加新的模型供应商（Provider）或接入新的模型（Model）。

> **⚠️ 核心原则：以官方 API 文档为准**
>
> 本指南中提到的参数名称（如 `resolution`, `prompt`）仅作为通用示例。在实际适配过程中，**必须严格参照模型供应商的官方 API 文档**来定义参数和构造请求。不要盲目照搬本指南中的示例代码。
>
> **文档可能有误！** 遇到 422/400 等参数错误时，以实际 API 行为为准，不要完全相信文档。

## 核心架构概述

Henji AI 的模型适配分为前端和后端两个部分：

1.  **前端 (Frontend)**:
    *   **配置**: `src/config/providers.json` 定义供应商和模型列表。
    *   **Schema**: `src/schemas/modelParams.ts` 定义模型的参数表单结构（Schema-Driven UI）。
    *   **UI**: `MediaGenerator.tsx` 根据 Schema 渲染表单，收集用户输入。

2.  **后端/适配层 (Adapter Layer)**:
    *   **接口**: `src/adapters/base/BaseAdapter.ts` 定义统一的 `MediaGeneratorAdapter` 接口。
    *   **实现**: 具体适配器（如 `PPIOAdapter.ts`）实现接口，负责参数转换、API 调用和结果标准化。
    *   **工厂**: `src/adapters/index.ts` 负责实例化适配器。

---

## 接入流程

### 1. 添加新供应商 (Provider)

如果要接入一个新的 API 服务商

1.  **定义适配器**:
    *   在 `src/adapters/` 下创建新的适配器文件。
    *   实现 `MediaGeneratorAdapter` 接口。
    *   **⚠️ 注意**: 在适配器中做好**参数过滤**，API 文档中标注的某些值可能实际不被接受。

2.  **注册适配器**:
    *   修改 `src/adapters/index.ts`，在 `AdapterType` 中添加新类型。
    *   在工厂方法的 `switch` 语句中添加实例化逻辑。

3.  **配置供应商**:
    *   修改 `src/config/providers.json`，添加供应商和模型配置。

4.  **配置 API 密钥**:
    *   在 `src/components/SettingsModal.tsx` 中添加 API Key 输入框。
    *   使用 `localStorage` 保存，Key 格式：`{provider_id}_api_key`。

5.  **⚠️ 动态适配器初始化**:
    *   确保 `App.tsx` 的 `handleGenerate` 中有**动态适配器初始化逻辑**。
    *   不要硬编码只使用一个适配器。

6.  **Tauri 权限配置**（桌面应用）:
    *   在 `src-tauri/capabilities/default.json` 中添加新 CDN 域名到三个 HTTP 权限块。
    *   **必须重启应用**才能生效。

### 2. 添加新模型 (Model)

#### 通用原则：功能合并与智能路由

**重要原则**：不要因为同一个模型提供了不同的 API 端点（如 Text-to-Image 和 Image-to-Image）就在 UI 上拆分成两个模型选项。

*   **正确做法**：只列出一个模型选项。
    *   **前端**：Schema 中不区分模式，而是根据用户是否上传了图片来动态显示/隐藏相关参数。
    *   **后端 (Adapter)**：在 `generateImage` 或 `generateVideo` 方法中，检查 `params.images` 是否存在，从而智能路由到正确的 API 端点。

#### 各类型模型适配指南

请依据API文档自动判断模型类型

##### 🖼️ 图片模型 (Image Models)

*   **参数定义**: 根据 API 文档定义参数（如宽高比、采样器、步数等）。
*   **适配重点**:
    *   **图生图**: 检查 `params.images`。注意 API 对图片格式的要求（URL vs Base64）。
    *   **参数映射**: 将前端通用参数映射为 API 特定参数。
    *   **⚠️ 检查硬编码**: `MediaGenerator.tsx` 中有针对所有 `image` 类型的硬编码逻辑（如分辨率选择器），需要排除不适用的模型。

##### 🎥 视频模型 (Video Models)

*   **参数定义**: 常见参数有 `duration`, `aspect_ratio`, `camera_motion` 等。
*   **适配重点**:
    *   **智能路由**: 根据输入图片数量（0=文生视频, 1=图生视频, 2=首尾帧）选择接口。
    *   **结果查询**:
        *   **异步轮询**: 大多数视频 API 需要轮询。返回 `taskId` 并实现 `checkStatus`。
        *   **同步/其他**: 如果 API 是同步返回或使用 WebSocket，请根据实际情况实现，不强制要求轮询。

##### 🔊 音频模型 (Audio Models)

*   **参数定义**: `text`, `voice_id`, `speed` 等。
*   **适配重点**:
    *   **音色处理**: 如果音色列表过长，考虑特殊的 UI 处理。
    *   **结果处理**: 处理同步返回的二进制流或 URL，或者异步任务 ID。

---

## UI 组件与 Schema 规范

### 推荐：使用通用组件 (Schema-Driven)

我们强烈建议使用 `src/schemas/modelParams.ts` 定义参数，由 `SchemaForm` 自动渲染 UI。

### 慎用：特殊面板 (Custom Panels)

虽然系统支持自定义面板，但应**尽量避免使用**，除非遇到 Schema 无法解决的极端复杂交互。

**现有参考示例**（可在代码中搜索参考）：
*   **即梦分辨率选择器**: 复杂的自定义分辨率 UI。
*   **Minimax Speech 音色**: 带有分类和搜索的大型音色选择器。
*   **Minimax Speech 高级选项**: 复杂的参数组合面板。

### Schema 高级特性

1.  **动态可见性 (`hidden`)**:
    ```typescript
    hidden: (values) => values.sequential_image_generation !== 'auto'
    ```

2.  **动态选项 (`options`)** 🌟 重要：
    ```typescript
    // 根据上传图片数量动态调整选项
    options: (values) => {
      const baseOptions = [
        { value: '1:1', label: '1:1' },
        { value: '16:9', label: '16:9' },
        // ...
      ]
      
      // 图生图时添加 auto 选项
      if (values.uploadedImages && values.uploadedImages.length > 0) {
        return [{ value: 'auto', label: '自动' }, ...baseOptions]
      }
      
      return baseOptions
    }
    ```
    
    **配合 useEffect 切换默认值**:
    ```typescript
    // 在 MediaGenerator.tsx 中
    useEffect(() => {
      if (selectedModel === 'your-model') {
        if (uploadedImages.length > 0) {
          setAspectRatio('auto')  // 图生图模式
        } else if (aspectRatio === 'auto') {
          setAspectRatio('1:1')   // 文生图模式
        }
      }
    }, [uploadedImages.length, selectedModel])
    ```

3.  **值转换 (`toValue` / `fromValue`)**:
    用于 `toggle` 类型，当 UI 状态 (boolean) 与实际参数值 (string/number) 不一致时使用。

4.  **工具提示 (`tooltip`)**:
    *   **默认策略**: **不要主动添加 Tooltip**，除非参数含义非常晦涩难懂且对用户至关重要。保持界面简洁。

---

## ⚠️ 常见陷阱与注意事项

### 1. UI 硬编码逻辑冲突

**问题**: `MediaGenerator.tsx` 中存在针对 `image`/`video`/`audio` **类型**的硬编码逻辑，新模型可能被错误应用。

**关键位置**（行号仅供参考，请搜索关键字）:
- 分辨率选择器: 搜索 `{/* 分辨率设置按钮`
- 智能分辨率计算: 搜索 `if (currentModel?.type === 'image')`
- Size 参数设置: 搜索 `options.size =`

**解决方案**: 添加模型排除逻辑
```typescript
// 不是所有图片模型都需要分辨率选择器
{currentModel?.type === 'image' && selectedModel !== 'your-model' && (
  <PanelTrigger label="分辨率" ... />
)}

// 不是所有图片模型都使用 size 参数
if (currentModel?.type === 'image' && selectedModel !== 'your-model') {
  // 处理分辨率...
}
```

### 2. 参数处理完整性

**问题**: 如果为某个模型单独实现参数处理逻辑，容易遗漏**图片上传**等基础功能。

**解决方案**: 完整实现所有必要逻辑
```typescript
else if (currentModel?.type === 'image' && selectedModel === 'your-model') {
  // 1. 模型专用参数
  options.your_param = yourParam
  
  // 2. ⚠️ 不要忘记图片上传！
  if (uploadedImages.length > 0) {
    options.images = uploadedImages
    // 保存文件路径的逻辑...
  }
}
```

### 3. API 文档与实际不符

**现象**: API 文档说支持某个参数值，但实际返回 422 错误。

**示例**: fal API 文档说 `aspect_ratio` 支持 `"auto"`，但实际不接受。

**解决方案**: 在适配器中过滤
```typescript
// 过滤掉文档中提到但实际不支持的值
if (params.aspect_ratio !== undefined && params.aspect_ratio !== 'auto') {
  requestData.aspect_ratio = params.aspect_ratio
}
// 添加注释说明原因
```

### 4. 历史数据安全

**问题**: 渲染历史记录时，某些字段可能为 `undefined`，导致应用崩溃。

**解决方案**: 添加空值检查
```typescript
{task.result.type === 'image' && task.result.url && (
  task.result.url.includes('|||') ? /* 多图 */ : /* 单图 */
)}
```

---

## 📋 适配检查清单

**适配器层**:
- [ ] 创建适配器类，实现 `MediaGeneratorAdapter` 接口
- [ ] 在 `src/adapters/index.ts` 注册
- [ ] 实现智能路由（如需要）
- [ ] 处理图片格式（base64/URL）
- [ ] 参数过滤（API 可能不接受文档中的所有值）
- [ ] 完整的错误处理

**配置层**:
- [ ] `providers.json` 添加供应商和模型
- [ ] `modelParams.ts` 定义参数 Schema（注意动态选项）
- [ ] `SettingsModal.tsx` 添加 API Key 输入

**UI 集成**:
- [ ] `MediaGenerator.tsx` 导入 Schema、添加 state、实现 onChange
- [ ] **重要**: 添加图片上传处理（如果模型支持）
- [ ] 渲染 `SchemaForm`

**排查硬编码**:
- [ ] 搜索 `currentModel?.type === 'image'` 等判断
- [ ] 确认是否需要排除新模型
- [ ] 确保 `App.tsx` 有动态适配器初始化

**Tauri 配置**:
- [ ] `src-tauri/capabilities/default.json` 添加 CDN 域名
- [ ] **重启应用**验证

**测试**:
- [ ] 文生/图生/多图功能
- [ ] 参数变更是否生效
- [ ] 错误处理（无效 API Key）

---

## 🤖 给 AI 编程助手的提示

如果你是正在阅读本文档的 AI 助手，请遵循以下规则：

1.  **决策确认**: 当遇到 API 文档中有多种实现方式，或者需要对 UI 进行较大改动（如引入新依赖、创建复杂自定义组件）时，**必须先询问用户**，不要擅自决策。
2.  **信息补全**: 如果发现缺少必要的 API 参数说明或 Endpoint 信息，**请明确告知用户需要补充哪些信息**，而不是猜测或使用占位符。
3.  **代码风格**: 保持与现有代码一致的风格（TypeScript, Tailwind CSS, Schema 定义方式）。
4.  **参数校验**: 在 Adapter 中尽量做好参数的预处理和校验，避免将无效参数发送给 API。
5.  **全面检查**: 适配新模型时，**必须检查 `MediaGenerator.tsx` 中的硬编码逻辑**，确认是否需要排除。
6.  **防御性编程**: 对历史数据、API 响应进行空值检查。

---

## 最佳实践总结

1.  **以实际测试为准**: API 文档可能过时或有误，遇到参数错误时以实际 API 行为为准。
2.  **单一模型入口**: 智能路由文生/图生接口，不拆分模型选项。
3.  **优先 Schema**: 能用 Schema 解决的 UI 就不要写硬编码组件。
4.  **灵活适配**: 根据 API 特性（同步/异步/流式）灵活选择适配策略，不拘泥于固定模式。
5.  **防御性编程**: 对历史数据、API 响应、用户输入做好空值和错误处理。
6.  **全面检查硬编码**: 新模型适配时必须排查现有的类型判断逻辑。
7.  **完整性**: 单独实现模型逻辑时，不要遗漏图片上传等基础功能。
