# 供应商适配器模板使用指南

## 📖 概述

这是 Henji AI 的供应商适配器标准模板。使用此模板可以快速创建新的供应商适配器。

## 🚀 快速开始

### 1. 复制模板

```bash
# Windows PowerShell
Copy-Item -Recurse src\adapters\_template src\adapters\your-provider

# Linux/Mac
cp -r src/adapters/_template src/adapters/your-provider
```

### 2. 修改配置 (`config.ts`)

```typescript
export const CONFIG = {
    PROVIDER_ID: 'your-provider',          // 修改为实际供应商ID
    PROVIDER_NAME: 'Your Provider Name',   // 修改为实际名称
    BASE_URL: 'https://api.example.com',   // 修改为实际API地址
    AUTH_TYPE: 'bearer' as const,          // 'bearer' 或 'apikey'
    
    // 状态查询配置 (如果支持异步任务)
    STATUS_ENDPOINT: '/task/status',       // 状态查询端点
    POLL_INTERVAL: 3000,                   // 轮询间隔(毫秒)
    MAX_POLL_ATTEMPTS: 120                 // 最大轮询次数
}
```

### 3. 添加模型路由 (`models/yourModel.ts`)

```typescript
import { ModelRoute } from '../types'

export const yourModelRoute: ModelRoute = {
    // 判断是否匹配该模型
    matches: (modelId: string) => modelId === 'your-model-id',
    
    // 构建请求数据
    buildRequest: (params) => {
        return {
            endpoint: '/your-endpoint',
            requestData: {
                prompt: params.prompt,
                // ... 根据API文档映射其他参数
            }
        }
    }
}
```

### 4. 注册模型路由 (`models/index.ts`)

```typescript
import { yourModelRoute } from './yourModel'
import { anotherModelRoute } from './anotherModel'

// 导出所有路由
export const routes = [
    yourModelRoute,
    anotherModelRoute
]

// 查找路由的辅助函数
export const findRoute = (modelId: string) => {
    return routes.find(route => route.matches(modelId))
}
```

### 5. 实现响应解析器 (`parsers/`)

根据API的响应格式调整对应的解析器：
- `imageParser.ts` - 图片结果解析
- `videoParser.ts` - 视频结果解析  
- `audioParser.ts` - 音频结果解析

### 6. 实现状态管理器 (`statusManager.ts`)

如果供应商支持异步任务，实现状态查询和轮询逻辑。

### 7. 注册到适配器工厂 (`src/adapters/index.ts`)

```typescript
import { YourProviderAdapter } from './your-provider/ProviderAdapter'

export function createAdapter(type: AdapterType, apiKey: string): MediaGeneratorAdapter {
    switch (type) {
        // ... 其他 case
        case 'your-provider':
            return new YourProviderAdapter(apiKey)
        // ...
    }
}
```

### 8. 添加供应商配置 (`src/config/providers.json`)

```json
{
    "id": "your-provider",
    "name": "Your Provider Name",
    "type": "multi",
    "models": [
        {
            "id": "your-model-id",
            "name": "Your Model Name",
            "type": "image",
            "description": "模型描述",
            "functions": ["图片生成"]
        }
    ]
}
```

## 📁 文件结构

```
your-provider/
├── README.md                  ← 本文件
├── ProviderAdapter.ts         ← 主适配器
├── config.ts                  ← 配置文件
├── types.ts                   ← 类型定义
├── statusManager.ts           ← 状态管理器
├── models/                    ← 模型路由
│   ├── index.ts              ← 路由注册
│   └── exampleModel.ts       ← 示例模型
└── parsers/                   ← 响应解析器
    ├── index.ts              ← 解析器导出
    ├── imageParser.ts        ← 图片解析
    ├── videoParser.ts        ← 视频解析
    └── audioParser.ts        ← 音频解析
```

## ✅ 完成

配置完成后，新的供应商适配器即可使用！

## 📝 注意事项

1. **文件大小**: 每个文件尽量保持在 150 行以内
2. **职责单一**: 每个文件只负责一个功能
3. **类型安全**: 充分利用 TypeScript 类型检查
4. **错误处理**: 使用统一的错误处理机制
5. **日志记录**: 使用 `this.log()` 记录关键信息

## 🔗 相关文档

- [模型适配指南](../../../docs/model-adaptation-guide.md)
- [架构重构方案](../../../docs/architecture/)
