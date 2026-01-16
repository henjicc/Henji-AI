# 新模型集成检查清单

## 完整检查清单

### 第一阶段：Schema 与状态定义

| # | 文件 | 检查内容 |
|---|------|----------|
| 1 | `src/models/{provider}/{model}.ts` | 参数 ID 必须包含供应商前缀（如 `ppioSeedance15ProResolution`） |
| 2 | `src/models/{provider}/{model}.ts` | 如需合并分辨率和比例面板，配置 `resolutionConfig.qualityKey` 和 `qualityOptions` |
| 3 | `src/models/index.ts` | 在 `modelSchemaMap` 中导出并注册参数定义 |
| 4 | `src/components/MediaGenerator/hooks/useMediaGeneratorState.ts` | 添加带前缀的 State 变量及初始值 |

### 第二阶段：类型定义

| # | 文件 | 检查内容 |
|---|------|----------|
| 5 | `src/components/MediaGenerator/builders/core/types.ts` | 在 `BuildOptionsParams` 接口中添加所有新参数类型 |
| 6 | `src/config/presetStateMapping.ts` | 在 `PresetSetters` 接口中添加所有 setter 类型 |
| 7 | `src/config/presetStateMapping.ts` | 在 `createPresetSetterMap` 函数中添加参数映射 |

### 第三阶段：UI 渲染（⚠️ 易遗漏）

| # | 文件 | 检查内容 |
|---|------|----------|
| 8 | `src/components/MediaGenerator/components/ParameterPanel.tsx` | 导入新的参数 Schema |
| 9 | `src/components/MediaGenerator/components/ParameterPanel.tsx` | **独立渲染分支**：如果模型从通用条件排除，必须在独立的 `if` 块中添加渲染 |
| 10 | `src/components/MediaGenerator/components/ParameterPanel.tsx` | **通用条件排除**：在顶部 `if (currentModel?.type === 'video' && ...)` 中添加模型排除 |
| 11 | `src/components/MediaGenerator/components/ParameterPanel.tsx` | **负面提示排除**：在负面提示的条件列表中添加模型 ID |
| 12 | `src/components/MediaGenerator/components/ParameterPanel.tsx` | **随机种子排除**：在随机种子的条件列表中添加模型 ID |

### 第四阶段：参数传递（⚠️ 最易遗漏）

| # | 文件 | 检查内容 |
|---|------|----------|
| 13 | `src/components/MediaGenerator/index.tsx` | **handleParamChange setterMap**：添加所有参数的 setter 映射（约第 1030-1170 行） |
| 14 | `src/components/MediaGenerator/index.tsx` | **createPresetSetterMap 调用**：添加所有 setter 传递（约第 340-470 行） |
| 15 | `src/components/MediaGenerator/index.tsx` | **buildGenerateOptions 调用**：添加所有参数传递（约第 1300-1520 行） |
| 16 | `src/components/MediaGenerator/index.tsx` | **PriceEstimate 组件**：添加所有参数传递（约第 1800-1950 行） |

### 第五阶段：OptionsBuilder 配置

| # | 文件 | 检查内容 |
|---|------|----------|
| 17 | `src/components/MediaGenerator/builders/configs/{provider}-models.ts` | `paramMapping.source` 正确指向带前缀的 State 变量 |
| 18 | `src/components/MediaGenerator/builders/configs/{provider}-models.ts` | PPIO 模型：`imageUpload.convertToBlob` 设为 `false` |
| 19 | `src/components/MediaGenerator/builders/configs/index.ts` | 使用 `registerConfig` 注册配置 |

### 第六阶段：API 路由

| # | 文件 | 检查内容 |
|---|------|----------|
| 20 | `src/adapters/{provider}/models/{model}.ts` | `matches` 函数包含模型 ID 及其别名 |
| 21 | `src/adapters/{provider}/models/{model}.ts` | 确保 `'smart'`、`'auto'` 等 UI 专用值**不会**传递给 API |
| 22 | `src/adapters/{provider}/models/{model}.ts` | Fal 模型：`modelId` 不包含子路径，`submitPath` 可以包含 |
| 23 | `src/adapters/{provider}/models/index.ts` | 路由已导入并注册到路由数组 |

### 第七阶段：配置与定价

| # | 文件 | 检查内容 |
|---|------|----------|
| 24 | `src/config/providers.json` | 模型元数据完整（id、name、type、description、functions） |
| 25 | `src/config/providers.json` | `progressConfig` 配置为 `"type": "polling"` 并设置 `expectedPolls` |
| 26 | `src/config/pricing.ts` | 价格计算器使用带前缀的参数名（如 `params.ppioSeedance15ProDuration`） |
| 27 | `src/config/pricing.ts` | 价格计算器包含回退逻辑（如 `|| params.duration || 5`） |

---

## 快速验证命令

```bash
# TypeScript 编译检查
npx tsc --noEmit

# 搜索所有需要更新的位置
grep -rn "ppioSeedanceV1" src/components/MediaGenerator/index.tsx | head -20
```

---

## 常见遗漏模式

1. **只添加了 Schema，没更新 index.tsx 的 4 处位置**
2. **ParameterPanel 渲染分支放在了被排除的条件块内**
3. **忘记从负面提示/随机种子排除列表中添加新模型**
4. **价格组件参数缺失导致价格不随参数变化**
