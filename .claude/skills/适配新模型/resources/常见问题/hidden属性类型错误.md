# hidden 属性类型错误

本文档对以下问题有帮助：运行时报错 "param.hidden is not a function"，参数 hidden 属性配置错误，质量参数需要隐藏但不知道如何正确设置，条件隐藏参数的正确写法。

## 问题现象

运行时报错：

```
Uncaught TypeError: param.hidden is not a function
    at SchemaForm.tsx:68:27
```

## 根本原因

`hidden` 属性必须是**函数类型**，不能是布尔值。

SchemaForm 组件在过滤参数时会调用 `param.hidden(values)`，如果 `hidden` 是布尔值而不是函数，就会抛出 "is not a function" 错误。

## 错误示例

```typescript
// 错误：hidden 使用布尔值
{
  id: 'someParam',
  type: 'dropdown',
  hidden: true,  // 错误
  options: [...]
}
```

## 正确写法

### 方式 1：始终隐藏

```typescript
{
  id: 'someParam',
  type: 'dropdown',
  hidden: () => true,  // 正确：返回 true 的函数
  options: [...]
}
```

### 方式 2：始终显示

```typescript
{
  id: 'someParam',
  type: 'dropdown',
  hidden: () => false,  // 正确：返回 false 的函数
  options: [...]
}
```

### 方式 3：条件隐藏

```typescript
{
  id: 'someParam',
  type: 'dropdown',
  hidden: (values) => {
    // 根据其他参数的值决定是否隐藏
    return values.mode === 'advanced'
  },
  options: [...]
}
```

### 方式 4：省略 hidden 属性

```typescript
{
  id: 'someParam',
  type: 'dropdown',
  // 不设置 hidden 属性，默认显示
  options: [...]
}
```

## 常见场景

### 场景 1：质量参数通过 resolutionConfig 管理

当使用 `resolutionConfig` 的 `qualityOptions` 管理质量档位时，质量参数本身需要隐藏：

```typescript
// 比例参数（显示）
{
  id: 'aspectRatio',
  type: 'dropdown',
  label: '分辨率',
  resolutionConfig: {
    type: 'aspect_ratio',
    qualityOptions: [
      { value: '720P', label: '720P' },
      { value: '1080P', label: '1080P' }
    ],
    qualityKey: 'resolution'  // 指向质量参数
  },
  options: [...]
}

// 质量参数（隐藏）
{
  id: 'resolution',
  type: 'dropdown',
  label: '质量',
  defaultValue: '1080P',
  options: [
    { value: '720P', label: '720P' },
    { value: '1080P', label: '1080P' }
  ],
  hidden: () => true  // 必须是函数
}
```

### 场景 2：不同模式显示不同参数

```typescript
// 参数 A：仅在文生视频模式显示
{
  id: 'paramA',
  type: 'dropdown',
  hidden: (values) => values.mode !== 'text-to-video',
  options: [...]
}

// 参数 B：仅在图生视频模式显示
{
  id: 'paramB',
  type: 'dropdown',
  hidden: (values) => values.mode !== 'image-to-video',
  options: [...]
}
```

## 类型定义

根据 `src/types/schema.ts` 的定义：

```typescript
interface ParamDef {
  id: string
  type: string
  label?: string
  hidden?: (values: any) => boolean  // 必须是函数
  // ...其他属性
}
```

## 快速检查

如果遇到 "is not a function" 错误，检查以下位置：

1. 搜索 `hidden: true` 或 `hidden: false`
2. 将所有布尔值改为函数形式：
   - `hidden: true` → `hidden: () => true`
   - `hidden: false` → `hidden: () => false`
3. 或者直接删除 `hidden` 属性（默认显示）

## 相关文档

- 参数 Schema 类型定义：`src/types/schema.ts`
- SchemaForm 组件实现：`src/components/ui/SchemaForm.tsx`
- 分辨率面板设计规则：`.claude/skills/适配新模型/resources/分辨率面板设计规则.md`
