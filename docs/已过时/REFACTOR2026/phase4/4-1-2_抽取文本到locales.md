# 4-1-2 抽取文本到locales

## 目标

将应用中的所有硬编码中文文本抽取到 i18n 翻译文件，并添加对应的英文翻译

## 背景

当前应用中存在大量硬编码的中文文本，分布在：
- UI 组件（按钮、标签、提示）
- 模型配置（模型名称、参数名称、选项标签）
- 错误提示
- 状态消息

需要系统性地抽取这些文本，并提供英文翻译。

## 前置依赖

- [x] 4-1-1：集成i18next

## 实施步骤

### 1. 分析现有文本分布

- [ ] 扫描所有组件文件
  - 搜索 `src/components/**/*.tsx`
  - 识别所有硬编码中文字符串
  - 记录文件路径和行号

- [ ] 扫描模型配置文件
  - 搜索 `src/models/**/*.ts`
  - 识别模型名称、描述
  - 识别参数标签和选项

- [ ] 扫描配置文件
  - `src/config/providers.json`
  - `src/config/pricing.ts`

### 2. 创建翻译文件结构

- [ ] 按模块组织翻译文件
  ```
  src/i18n/locales/
  ├── zh-CN/
  │   ├── common.json          # 通用文本
  │   ├── ui.json              # UI 组件文本
  │   ├── models.json          # 模型相关
  │   ├── params.json          # 参数相关
  │   ├── errors.json          # 错误提示
  │   ├── history.json         # 历史记录
  │   └── settings.json        # 设置页面
  └── en-US/
      ├── common.json
      ├── ui.json
      ├── models.json
      ├── params.json
      ├── errors.json
      ├── history.json
      └── settings.json
  ```

### 3. 抽取 UI 组件文本

- [ ] 抽取通用组件文本
  - `MediaGenerator/index.tsx`
  - `InputArea.tsx`
  - `ParameterPanel.tsx`
  - `HistoryPanel.tsx`

- [ ] 替换硬编码文本为 i18n key
  ```typescript
  // 修改前
  <button>生成</button>

  // 修改后
  import { useI18n } from '@/hooks/useI18n'
  const { t } = useI18n('ui')
  <button>{t('generate')}</button>
  ```

### 4. 抽取模型配置文本

- [ ] 更新模型定义使用 I18nText
  ```typescript
  // 修改前
  name: '可灵 2.6'

  // 修改后
  name: {
    zh: '可灵 2.6',
    en: 'Kling 2.6'
  }
  ```

- [ ] 或使用 i18n key
  ```typescript
  // 修改后（推荐）
  name: 'models.kling26.name'
  description: 'models.kling26.description'
  ```

### 5. 抽取参数相关文本

- [ ] 参数标签
  ```json
  // zh-CN/params.json
  {
    "resolution": "分辨率",
    "duration": "时长",
    "quality": "质量",
    "aspectRatio": "比例"
  }
  ```

- [ ] 参数选项
  ```json
  // zh-CN/params.json
  {
    "resolution.options": {
      "720p": "720P 标清",
      "1080p": "1080P 高清",
      "4k": "4K 超清"
    }
  }
  ```

### 6. 抽取错误提示

- [ ] 创建错误消息映射
  ```json
  // zh-CN/errors.json
  {
    "network": {
      "timeout": "网络请求超时",
      "offline": "网络连接已断开",
      "serverError": "服务器错误"
    },
    "validation": {
      "required": "此项为必填项",
      "invalidFormat": "格式不正确",
      "tooLarge": "文件过大"
    },
    "generation": {
      "failed": "生成失败",
      "quota": "配额不足",
      "invalidParams": "参数无效"
    }
  }
  ```

### 7. 抽取状态消息

- [ ] 生成状态
  ```json
  // zh-CN/common.json
  {
    "status": {
      "idle": "就绪",
      "queued": "排队中",
      "processing": "生成中",
      "completed": "已完成",
      "failed": "失败",
      "timeout": "超时"
    }
  }
  ```

### 8. 批量替换工具

- [ ] 创建自动化脚本
  - `scripts/extract-i18n.js` - 提取文本脚本
  - `scripts/validate-i18n.js` - 验证翻译完整性

```javascript
// scripts/extract-i18n.js
// 自动扫描代码中的中文字符串，生成翻译文件模板
```

### 9. 更新组件使用 i18n

优先级列表（按使用频率）：

- [ ] 高优先级
  - `MediaGenerator/index.tsx` - 主界面
  - `InputArea.tsx` - 输入区域
  - `ParameterPanel.tsx` - 参数面板
  - `HistoryPanel.tsx` - 历史面板
  - `ModelSelectorPanel.tsx` - 模型选择器

- [ ] 中优先级
  - `ResolutionPanel.tsx` - 分辨率面板
  - `ImageUploader.tsx` - 图片上传
  - `VideoUploader.tsx` - 视频上传
  - `TestModePanel.tsx` - 测试模式

- [ ] 低优先级
  - 其他辅助组件

### 10. 添加英文翻译

- [ ] 对照中文文件，创建对应的英文翻译
- [ ] 使用翻译工具辅助（如 Google Translate）
- [ ] 人工审校专业术语
- [ ] 确保术语一致性

### 11. 翻译质量控制

- [ ] 建立翻译术语表
  ```markdown
  | 中文 | 英文 | 说明 |
  |------|------|------|
  | 生成 | Generate | 动词 |
  | 分辨率 | Resolution | |
  | 比例 | Aspect Ratio | |
  | 提示词 | Prompt | |
  | 参考图片 | Reference Image | |
  ```

- [ ] 创建翻译审核清单

## 涉及文件

### 新建文件
- `src/i18n/locales/zh-CN/ui.json` - UI 文本（中文）
- `src/i18n/locales/zh-CN/models.json` - 模型文本（中文）
- `src/i18n/locales/zh-CN/params.json` - 参数文本（中文）
- `src/i18n/locales/zh-CN/errors.json` - 错误文本（中文）
- `src/i18n/locales/zh-CN/history.json` - 历史文本（中文）
- `src/i18n/locales/zh-CN/settings.json` - 设置文本（中文）
- `src/i18n/locales/en-US/ui.json` - UI 文本（英文）
- `src/i18n/locales/en-US/models.json` - 模型文本（英文）
- `src/i18n/locales/en-US/params.json` - 参数文本（英文）
- `src/i18n/locales/en-US/errors.json` - 错误文本（英文）
- `src/i18n/locales/en-US/history.json` - 历史文本（英文）
- `src/i18n/locales/en-US/settings.json` - 设置文本（英文）
- `scripts/extract-i18n.js` - 文本提取脚本
- `scripts/validate-i18n.js` - 翻译验证脚本
- `docs/translation-glossary.md` - 翻译术语表

### 修改文件
- `src/components/MediaGenerator/index.tsx`
- `src/components/MediaGenerator/components/InputArea.tsx`
- `src/components/MediaGenerator/components/ParameterPanel.tsx`
- `src/components/HistoryPanel/index.tsx`
- `src/components/ModelSelectorPanel.tsx`
- 所有模型配置文件 `src/models/**/*.ts`

## 验收标准

- [ ] 所有用户可见文本已抽取到翻译文件
- [ ] 无硬编码中文字符串残留（开发者注释除外）
- [ ] 所有中文文本都有对应的英文翻译
- [ ] 翻译 key 命名规范，层次清晰
- [ ] 应用可以正常切换中英文，无显示问题
- [ ] 翻译完整性验证脚本通过
- [ ] 所有组件在英文模式下布局正常
- [ ] 专业术语翻译准确一致

## 测试方法

### 1. 自动化测试

```typescript
// 测试所有翻译 key 都存在对应的值
describe('翻译完整性', () => {
  const zhKeys = getAllKeys('zh-CN')
  const enKeys = getAllKeys('en-US')

  test('英文翻译完整', () => {
    zhKeys.forEach(key => {
      expect(enKeys).toContain(key)
    })
  })

  test('无未使用的翻译', () => {
    const usedKeys = scanCodeForI18nKeys()
    const allKeys = [...zhKeys, ...enKeys]

    allKeys.forEach(key => {
      expect(usedKeys).toContain(key)
    })
  })
})
```

### 2. 视觉回归测试

```typescript
// 使用 Playwright 截图对比
test('中文界面截图', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.evaluate(() => localStorage.setItem('i18nextLng', 'zh-CN'))
  await page.reload()
  await page.screenshot({ path: 'screenshots/zh-CN.png' })
})

test('英文界面截图', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.evaluate(() => localStorage.setItem('i18nextLng', 'en-US'))
  await page.reload()
  await page.screenshot({ path: 'screenshots/en-US.png' })
})
```

### 3. 手动测试清单

- [ ] 切换到英文模式
- [ ] 检查主界面所有文本已翻译
- [ ] 检查模型选择器中的模型名称和描述
- [ ] 检查参数面板中的所有标签和选项
- [ ] 检查历史记录面板
- [ ] 检查设置页面
- [ ] 触发错误，检查错误提示
- [ ] 检查生成过程中的状态消息
- [ ] 检查所有按钮和菜单
- [ ] 检查工具提示（tooltip）

### 4. 翻译质量检查

```bash
# 运行验证脚本
node scripts/validate-i18n.js

# 输出示例：
# ✓ 所有 key 都有中文翻译
# ✓ 所有 key 都有英文翻译
# ✗ 发现 3 个未使用的翻译 key
# ✗ 发现 5 个代码中使用但未定义的 key
```

## 风险与注意事项

### 风险
- 大量文件修改，可能引入 Bug
- 翻译不准确影响用户体验
- 某些动态生成的文本难以抽取

### 注意事项
- 保持翻译 key 的语义化命名
- 避免在翻译中硬编码数字和变量，使用插值
- 注意单复数形式（英文）
- 注意日期、时间格式的国际化
- 长文本考虑使用 Markdown 或 HTML
- 专业术语保持一致性
- 定期审查翻译质量
- 建立翻译审核流程

### 常见问题

**Q: 如何处理带变量的文本？**
```typescript
// 使用插值
t('ui.generatingProgress', { current: 5, total: 10 })
// "生成中 {{current}}/{{total}}"
// "Generating {{current}}/{{total}}"
```

**Q: 如何处理复数形式？**
```typescript
// 使用 i18next 的复数功能
t('ui.imagesCount', { count: 3 })
// zh-CN: "{{count}} 张图片"
// en-US: "{{count}} image" / "{{count}} images"
```

**Q: 如何处理富文本？**
```typescript
// 使用 Trans 组件
import { Trans } from 'react-i18next'

<Trans i18nKey="ui.welcomeMessage">
  欢迎使用 <strong>Henji AI</strong>
</Trans>
```

## 实现参考

### 翻译文件示例

```json
// src/i18n/locales/zh-CN/ui.json
{
  "generate": "生成",
  "generating": "生成中...",
  "generatingProgress": "生成中 {{current}}/{{total}}",
  "cancel": "取消",
  "save": "保存",
  "download": "下载",
  "delete": "删除",

  "input": {
    "placeholder": "输入提示词...",
    "required": "提示词为必填项",
    "tooLong": "提示词过长（最多 {{max}} 字符）"
  },

  "upload": {
    "dragHint": "拖拽文件到此处或点击上传",
    "maxSize": "文件大小不能超过 {{size}}MB",
    "invalidFormat": "不支持的文件格式"
  }
}
```

```json
// src/i18n/locales/en-US/ui.json
{
  "generate": "Generate",
  "generating": "Generating...",
  "generatingProgress": "Generating {{current}}/{{total}}",
  "cancel": "Cancel",
  "save": "Save",
  "download": "Download",
  "delete": "Delete",

  "input": {
    "placeholder": "Enter prompt...",
    "required": "Prompt is required",
    "tooLong": "Prompt too long (max {{max}} characters)"
  },

  "upload": {
    "dragHint": "Drag files here or click to upload",
    "maxSize": "File size cannot exceed {{size}}MB",
    "invalidFormat": "Unsupported file format"
  }
}
```

### 组件使用示例

```typescript
// 修改前
export function InputArea() {
  return (
    <div>
      <label>提示词</label>
      <input placeholder="输入提示词..." />
      <button>生成</button>
    </div>
  )
}

// 修改后
import { useI18n } from '@/hooks/useI18n'

export function InputArea() {
  const { t } = useI18n('ui')

  return (
    <div>
      <label>{t('input.label')}</label>
      <input placeholder={t('input.placeholder')} />
      <button>{t('generate')}</button>
    </div>
  )
}
```

## 回滚方案

1. 回滚所有组件修改
```bash
git checkout HEAD -- src/components/
```

2. 删除翻译文件
```bash
rm -rf src/i18n/locales/zh-CN/ui.json
rm -rf src/i18n/locales/zh-CN/models.json
# ... 其他文件
```

3. 恢复模型配置
```bash
git checkout HEAD -- src/models/
```

4. 验证应用正常工作
```bash
npm run dev
```
