---
trigger: always_on
---

## 项目概述

Henji-AI（痕迹AI）是一款基于Tauri框架的桌面应用程序，它整合了多个AI提供商（PPIO、Fal、ModelScope、KIE），通过统一的接口生成图片、视频和音频。该应用程序采用适配器模式来抽象出各提供商特定的API。

## 开发命令

### 前端开发
```bash
npm install              # 安装依赖项
npm run dev              # 仅启动Vite开发服务器
npm run build            # 编译TypeScript代码并构建应用程序
npm run preview          # 预览生产版本
npm run lint             # 运行ESLint代码检查
npm run lint:fix         # 自动修复ESLint发现的错误
```

### Tauri开发
```bash
# Windows系统（需要安装Visual Studio Build Tools）
npm run tauri:dev        # 开发模式（支持热重载）
npm run tauri:build      # 构建生产版本（生成MSI文件）
npm run tauri:build:ci   # 无需安装Visual Studio环境的持续集成构建

# macOS系统（需要安装Xcode Command Line Tools）
npm run tauri:dev:mac    # 开发模式
npm run tauri:build:mac  # 构建生产版本（生成DMG文件）
```

构建生成的文件存放在`src-tauri/target/release/bundle/`目录下。

## 架构

### 适配器模式实现

核心架构采用了**工厂模式 + 策略模式**来集成多个AI提供商：
```plaintext
MediaGenerator (UI)
    ↓
ApiService (单例)
    ↓
AdapterFactory.createAdapter(config)
    ↓
BaseAdapter (抽象类)
    ↓
├── PPIOAdapter
├── FalAdapter
├── KIEAdapter
└── ModelScopeAdapter
```

**关键文件：**
- `src/adapters/base/BaseAdapter.ts` - 定义适配器接口的抽象基类
- `src/adapters/index.ts` - 包含`createAdapter()`方法的`AdapterFactory`
- `src/services/api.ts` - 管理适配器生命周期的`ApiService`单例

### 模型路由系统

每个适配器都实现了一个**基于路由的模型系统**，将模型ID映射到相应的请求构建函数：
```typescript
interface ModelRoute {
  matches: (modelId: string) => boolean
  buildImageRequest?: (params) => { endpoint,requestData }
  buildVideoRequest?: (params) => { endpoint, requestData }
  buildAudioRequest?: (params) => { endpoint,requestedData }
}
```

**路由注册：**
- `src/adapters/ppio/models/index.ts` - PPIO模型路由
- `src/adapters/fal/models/index.ts` - Fal模型路由
- `src/adapters/kie/models/index.ts` - KIE模型路由
- `src/adapters/modelscope/models/index.ts` - ModelScope模型路由

**流程：** `adapter.generateImage()` → `findRoute(modelId)` → `route.buildImageRequest()` → 调用API

### 提供商特定实现

**PPIO适配器** (`src/adapters/ppio/PPIOAdapter.ts`)
- 使用Axios进行HTTP请求
- 通过`PPIOStatusHandler`类进行轮询
- 配置信息：`src/adapters/ppio/config.ts`（基础URL、轮询间隔：3000毫秒、最大尝试次数：120次）

**Fal适配器** (`src/adapters/fal/FalAdapter.ts)`
- 使用官方的`@fal-ai/client` SDK
- 通过`fal.subscribe()`自动轮询
- 将图片/视频上传到Fal CDN
- 配置信息：`src/adapters/fal/config.ts`（针对特定模型的轮询次数）

**KIE适配器** (`src/adapters/kie/KIEAdapter.ts)`
- 使用Axios以及独立的上传客户端
- 在处理之前将图片上传到KIE CDN
- 状态映射：等待 → 排队中 → 处理中 → 完成
- 配置信息：`src/adapters/kie/config.ts`（轮询间隔：3000毫秒、最大尝试次数：200次）

**ModelScope适配器** (`src/adapters/modelscope/ModelscopeAdapter.ts)`
- 通过`invoke()`调用Tauri后端API
- 可选集成Fal CDN进行图片上传
- 目前仅支持图片生成

### 配置系统

**提供商注册表** (`src/config/providers.ts`)
- 从`providers.json`文件加载数据
- 定义提供商元数据和可用模型
- 结构：`Provider { id, name, type, models[] }`

**模型参数系统** (`src/models/index.ts`)
- 中心化的`modelSchemaMap`将模型ID映射到参数模式
- 主要函数：
  - `getModelSchema(modelId)` - 获取参数模式
  - `modelsDefaultValues(modelId)` - 提取默认值
  - `getAutoSwitchValues(modelId, currentValues)` - 条件性参数切换
  - `getSmartMatchValues(modelId, imageDataUrl, currentValues)` - 智能比例匹配

**模型参数文件：**
- `src/models/ppio/` - PPIO模型参数
- `src/models/fal/` - Fal模型参数
- `src/models/modelscope/` - ModelScope模型参数
- `src/models/kie/` - KIE模型参数

### 响应解析

每个适配器都有针对其提供商的解析器：
- `src/adapters/ppio/parsers/index.ts` - PPIO响应解析
- `src/adapters/fal/parsers/imageParser.ts` - Fal响应解析
- `src/adapters/kie/parsers/` - KIE响应解析

### 数据存储

- **API密钥：** 保存在localStorage中
- **历史记录：** 存储在`AppLocalData (`Henji-AI/history.json`)中
- **媒体文件：** 存储在`AppLocalData (`Henji-AI/Media/`)中
- **缓存：** 存储在`AppLocalData (`Henji-AI/Uploads/`, `Henji-AI/Waveforms/`)中

## 添加新的AI模型或提供商

有关详细说明，请参阅**[docs/model-adaptation-guide.md](docs/model-adaptation-guide.md)**：
1. 定义模型参数模式
2. 实现适配器路由
3. 在系统中注册模型

### 快速操作指南：

**向现有提供商添加新模型：**
1. 在`src/models/{provider}/{model-name}.ts`中创建参数模式
2. 在`src/adapters/{provider}/models/index.ts`中注册模型
3. 在`src/adapters/{provider}/models/index.ts`中添加路由
4. 更新`providers.json`文件中的提供商元数据

**添加新提供商：**
1. 在`src/adapters/{provider}/`目录下创建继承自`BaseAdapter`的适配器类
2. 实现`generateImage()`, `generateVideo()`, `generateAudio()`方法
3. 在`src/adapters/{provider}/models/`目录下创建模型路由
4. 在`onDeleteFactory.createAdapter()`方法中添加新的提供商配置
5. 在`src/models/{provider}/`目录下创建参数模式
6. 更新`providers.json`文件中的提供商元数据

## 故障排除与常见问题解答

遇到问题时，请查看**`docs/FAQ/`目录中的详细故障排除指南：
- **`fal-model-integration-issues.md`** - 集成Fal模型时常见的问题：
  - 价格计算不更新
  - 图片上传按钮显示问题
  - 参数自动切换失败
  - 自动恢复行为问题
  - 参数传递不完整

- **`history-json-base64-bloat.md`** - 解决history.json文件大小问题的方法：
  - Base64数据导致文件过大
  - 正确清理历史记录中的图片/视频数据
  - 新模型集成的最佳实践

- **`configuration-driven-architecture-常见问题.md`** - 与配置相关的问题：
  - 参数未出现在API请求中
  - 自动切换功能失效或过于敏感
  - 价格估算不更新
  - 图片上传按钮可见性问题

- **`new-model-parameter- synchronization-guide.md`** - 添加新模型参数的检查清单：
  - 需要在多个文件中进行的更新
  - TypeScript类型定义
  - 常见错误及遗漏的位置
  - 快速验证方法

这些FAQ包含了针对模型适配过程中常见问题的详细根本原因分析、逐步解决方案和调试技巧。

## 关键接口

```typescript
// 核心参数类型（src/adapters/base/BaseAdapter.ts）
interface GenerateImageParams {
  prompt: string
  model: string
  images?: string[]
  imageUrls?: string[]
  aspect_ratio?: string
  onProgress?: (status: ProgressStatus) => void
  [key: string]: any
}

interface GenerateVideoParams {
  prompt: string
  model: string
  mode?: 'text-image-to-video' | 'start-end-frame' | 'reference-to-video'
  images?: string[]
  videos?: string[]
  aspectRatio?: string
  onProgress?: (status: ProgressStatus) => void
  [key: string]: any
}

// 结果类型
interface ImageResult {
  url: string
  taskId?: string
  filePath?: string
  status?: 'completed' | 'timeout'
}

interface VideoResult {
  taskId?: string
  url?: string
  filePath?: string
  status?: string
}

// 进度回调
interface ProgressStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED'
  queue_position?: number
  message?: string
  progress?: number
}
```

## 平台特定说明

### Windows
- 需要安装Visual Studio Build Tools（MSVC）
- 使用自定义构建脚本来设置VS环境
- 窗口控件使用Windows特定的样式

### macOS
- 需要安装Xcode Command Line Tools
- 使用不同的构建脚本（`tauri:dev:mac`, `tauri:build:mac`)
- 窗口控件使用macOS特定的样式

### 跨平台兼容性
- 文件路径使用Tauri API（`@tauri-apps/plugin-fs`）
- HTTP请求使用Tauri插件（`@tauri-apps/plugin-http`）
- 避免使用平台特定的路径分隔符

## 常见模式

### 轮询模式
所有适配器都实现了异步操作的轮询：
- PPIO：`PPIOStatusHandler.pollTaskStatus()`
- Fal：通过`fal.subscribe()`自动轮询
- KIE：直接轮询并映射状态
- ModelScope：通过Tauri后台管理轮询

### 进度回调
使用`onProgress`回调进行实时状态更新：
```typescript
await adapter.generateImage({
  prompt: "...",
  onProgress: (status) => {
    console.log(status.status, status.progress)
  }
})
```

### 错误处理
所有适配器都使用`BaseAdapter.formatError()`来统一错误格式。

## 测试

目前尚未配置测试套件。添加测试时，请遵循以下步骤：
- 使用现有的ESLint配置
- 遵循TypeScript的严格模式约定
- 独立测试每个适配器的实现