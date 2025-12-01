# Fal Adapter 迁移方案

## 📋 迁移概述

将当前基于 axios 的 FalAdapter 实现迁移到官方 `@fal-ai/client` npm 包，以简化代码、提升维护性并获得官方支持。

---

## 🎯 迁移目标

1. **代码简化**：减少 70-80% 的自定义队列管理代码
2. **功能增强**：获得自动文件上传、实时日志流、Webhook 支持
3. **官方支持**：跟随 fal API 更新，获得官方维护
4. **接口兼容**：保持对外接口不变，确保现有调用代码无需修改

---

## 📊 当前实现分析

### 当前文件结构
```
src/adapters/fal/
├── FalAdapter.ts              # 主适配器（204行）
├── queueHandler.ts            # 队列处理器（271行）
├── statusHandler.ts           # 状态处理器（63行）
├── config.ts                  # 配置文件（32行）
├── models/                    # 模型路由配置
│   ├── index.ts               # 路由注册
│   ├── fal-ai-nano-banana.ts  # Nano Banana 路由
│   ├── fal-ai-nano-banana-pro.ts
│   ├── fal-ai-veo-3.1.ts      # Veo 3.1 路由
│   ├── fal-ai-z-image-turbo.ts
│   └── bytedance-seedream-v4.ts
└── parsers/                   # 响应解析器
    ├── index.ts
    ├── imageParser.ts         # 图片响应解析
    └── videoParser.ts         # 视频响应解析
```

### 核心功能模块

#### 1. FalAdapter.ts
- 继承 BaseAdapter
- 管理两个 axios 客户端（队列模式 + 同步模式）
- 协调 queueHandler 和 statusHandler
- 实现 generateImage/generateVideo/checkStatus 方法

#### 2. queueHandler.ts
- 提交任务到队列（submitImageTask/submitVideoTask）
- 轮询任务状态（pollImageStatus/pollVideoStatus）
- 计算进度和状态消息
- 处理超时恢复

#### 3. statusHandler.ts
- 检查任务状态（checkStatus）
- 解析 taskId 格式（modelId:requestId）
- 状态转换（fal 状态 → 统一状态）

#### 4. models/ 路由系统
- 根据 modelId 匹配对应路由
- 构建特定模型的请求参数
- 处理不同模型的特殊逻辑（如 veo3.1 的宽高比计算）

#### 5. parsers/ 解析器
- 解析 fal API 响应
- 调用 BaseAdapter.saveMediaLocally 保存文件
- 返回统一的 ImageResult/VideoResult

---

## 🔄 迁移策略

### 核心原则
1. **保留架构**：继续使用 BaseAdapter 抽象层
2. **保留路由**：models/ 目录的路由配置保持不变
3. **保留解析器**：parsers/ 目录的响应解析逻辑保持不变
4. **替换核心**：用官方 SDK 替换 queueHandler 和 statusHandler

### 迁移范围

#### ✅ 需要修改的文件
1. `package.json` - 添加 @fal-ai/client 依赖
2. `FalAdapter.ts` - 重写核心逻辑，使用官方 SDK
3. `config.ts` - 简化配置（移除轮询相关配置）

#### ✅ 保留不变的文件
1. `models/` - 所有路由配置文件
2. `parsers/` - 所有解析器文件
3. `BaseAdapter.ts` - 基类接口

#### ❌ 可以删除的文件
1. `queueHandler.ts` - 由官方 SDK 的 fal.subscribe 替代
2. `statusHandler.ts` - 由官方 SDK 的 fal.queue.status 替代

---

## 📝 详细实施步骤

### 阶段 1：准备工作（预计 5 分钟）

#### 步骤 1.1：安装依赖
```bash
npm install @fal-ai/client
```

#### 步骤 1.2：备份当前实现
- 创建 git 分支或提交当前代码
- 确保可以回滚

### 阶段 2：重写 FalAdapter（预计 20 分钟）

#### 步骤 2.1：更新 config.ts
```typescript
// 简化配置，移除轮询相关配置
export const FAL_CONFIG = {
  // 保留模型预估时间（用于进度计算）
  modelEstimatedTime: {
    'nano-banana-pro': 30,
    'nano-banana': 10,
    'flux': 60,
    'veo3.1': 60
  }
} as const
```

#### 步骤 2.2：重写 FalAdapter.ts
核心改动：
1. 移除 axios 客户端，使用 `fal` 对象
2. 移除 queueHandler 和 statusHandler
3. 使用 `fal.subscribe()` 替代手动轮询
4. 使用 `fal.queue.status()` 实现 checkStatus
5. 保留路由系统和解析器调用

新的实现结构：
```typescript
import * as fal from "@fal-ai/client"
import { BaseAdapter, GenerateImageParams, ... } from '../base/BaseAdapter'
import { findRoute } from './models'
import { parseImageResponse, parseVideoResponse } from './parsers'

export class FalAdapter extends BaseAdapter {
  constructor(apiKey: string) {
    super('fal')
    // 配置 fal 客户端
    fal.config({ credentials: apiKey })
  }

  async generateImage(params: GenerateImageParams): Promise<ImageResult> {
    // 1. 查找路由（保持不变）
    const route = findRoute(modelId)
    const { submitPath, modelId, requestData } = route.buildImageRequest(params)

    // 2. 使用官方 SDK 提交并等待结果
    if (requestData.sync_mode) {
      // 同步模式
      const result = await fal.run(submitPath, { input: requestData })
      return parseImageResponse(result)
    } else {
      // 队列模式
      const result = await fal.subscribe(submitPath, {
        input: requestData,
        logs: true,
        onQueueUpdate: (update) => {
          if (params.onProgress) {
            params.onProgress({
              status: update.status,
              queue_position: update.queue_position,
              message: this.getStatusMessage(update),
              progress: this.calculateProgress(update, modelId)
            })
          }
        }
      })
      return parseImageResponse(result)
    }
  }

  async generateVideo(params: GenerateVideoParams): Promise<VideoResult> {
    // 类似的实现...
  }

  async checkStatus(taskId: string): Promise<TaskStatus> {
    const [modelId, requestId] = taskId.split(':')
    const status = await fal.queue.status(modelId, { requestId, logs: true })

    if (status.status === 'COMPLETED') {
      const result = await fal.queue.result(modelId, { requestId })
      return {
        taskId,
        status: 'TASK_STATUS_SUCCEED',
        result: await parseVideoResponse(result, this)
      }
    }
    // 转换状态...
  }
}
```

### 阶段 3：测试验证（预计 15 分钟）

#### 步骤 3.1：图片生成测试
测试场景：
- ✅ Nano Banana 文生图（同步模式）
- ✅ Nano Banana 图生图（队列模式）
- ✅ Nano Banana Pro（队列模式）
- ✅ 进度回调是否正常
- ✅ 超时处理是否正常

#### 步骤 3.2：视频生成测试
测试场景：
- ✅ Veo 3.1 文生视频
- ✅ Veo 3.1 图生视频
- ✅ Veo 3.1 首尾帧模式
- ✅ Veo 3.1 参考生视频模式
- ✅ 智能宽高比计算
- ✅ 进度回调是否正常

#### 步骤 3.3：状态查询测试
- ✅ checkStatus 方法是否正常
- ✅ taskId 解析是否正确
- ✅ 状态转换是否正确

### 阶段 4：清理工作（预计 5 分钟）

#### 步骤 4.1：删除废弃文件
```bash
# 删除不再需要的文件
rm src/adapters/fal/queueHandler.ts
rm src/adapters/fal/statusHandler.ts
```

#### 步骤 4.2：更新导入
检查并更新所有导入这些文件的地方（应该只有 FalAdapter.ts）

#### 步骤 4.3：代码审查
- 检查是否有遗漏的引用
- 确认所有功能正常
- 验证错误处理是否完善

---

## 🔍 关键技术细节

### 1. 进度计算逻辑迁移

**当前实现**（queueHandler.ts:222-236）：
```typescript
private calculateProgress(status: string, attempts: number, modelId: string): number {
  if (status === 'IN_QUEUE') return 5
  else if (status === 'IN_PROGRESS') {
    const estimatedAttempts = getEstimatedPolls(modelId)
    return calculateProgress(attempts, estimatedAttempts)
  }
  else if (status === 'COMPLETED') return 100
  return 0
}
```

**迁移后**：
```typescript
private calculateProgress(update: QueueUpdate, modelId: string): number {
  if (update.status === 'IN_QUEUE') return 5
  else if (update.status === 'IN_PROGRESS') {
    // 官方 SDK 可能提供 progress 字段
    if (update.progress !== undefined) return update.progress
    // 否则使用时间估算
    const elapsed = Date.now() - startTime
    const estimated = FAL_CONFIG.modelEstimatedTime[modelId] * 1000
    return Math.min(95, (elapsed / estimated) * 100)
  }
  else if (update.status === 'COMPLETED') return 100
  return 0
}
```

### 2. 同步/队列模式切换

**当前实现**（FalAdapter.ts:75-99）：
- 使用两个不同的 axios 客户端
- 根据 `sync_mode` 参数选择端点

**迁移后**：
```typescript
if (requestData.sync_mode) {
  // 同步模式：使用 fal.run
  const result = await fal.run(submitPath, { input: cleanRequestData })
} else {
  // 队列模式：使用 fal.subscribe
  const result = await fal.subscribe(submitPath, { input: requestData, ... })
}
```

### 3. 状态消息生成

**当前实现**（queueHandler.ts:241-262）：
```typescript
private getStatusMessage(status: string, queuePosition?: number, logs?: any[]): string {
  if (status === 'IN_QUEUE') {
    return queuePosition !== undefined
      ? `排队中... 前面还有 ${queuePosition} 个请求`
      : '排队中...'
  }
  if (status === 'IN_PROGRESS') {
    if (logs && logs.length > 0) {
      const latestLog = logs[logs.length - 1]
      if (latestLog?.message) return latestLog.message
    }
    return '正在生成...'
  }
  return '完成'
}
```

**迁移后**：
```typescript
private getStatusMessage(update: QueueUpdate): string {
  if (update.status === 'IN_QUEUE') {
    return update.queue_position !== undefined
      ? `排队中... 前面还有 ${update.queue_position} 个请求`
      : '排队中...'
  }
  if (update.status === 'IN_PROGRESS') {
    // 官方 SDK 的 logs 格式
    if (update.logs && update.logs.length > 0) {
      const latestLog = update.logs[update.logs.length - 1]
      if (latestLog?.message) return latestLog.message
    }
    return '正在生成...'
  }
  return '完成'
}
```

### 4. 超时处理

**当前实现**（queueHandler.ts:108-117）：
- 轮询超时后返回 `status: 'timeout'`
- 保留 requestId 和 modelId 用于恢复

**迁移后**：
```typescript
// 官方 SDK 的 subscribe 会自动处理超时
// 如果需要自定义超时，可以使用 Promise.race
const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('timeout')), maxTimeout)
)

try {
  const result = await Promise.race([
    fal.subscribe(submitPath, { ... }),
    timeoutPromise
  ])
  return parseImageResponse(result)
} catch (error) {
  if (error.message === 'timeout') {
    // 返回超时状态，保留 requestId 用于恢复
    return {
      url: '',
      status: 'timeout',
      requestId: requestId,
      modelId: modelId,
      message: '等待超时，任务依然在处理中'
    }
  }
  throw error
}
```

### 5. 错误处理

**当前实现**（FalAdapter.ts:181-202）：
- 解析 axios 错误
- 处理 fal 特定的错误格式

**迁移后**：
```typescript
private handleError(error: any): Error {
  // 官方 SDK 已经封装了错误处理
  // 只需要添加额外的日志和格式化
  console.error(`[${this.name}] 错误:`, error)

  if (error.body?.detail) {
    // fal API 错误格式
    const firstError = error.body.detail[0]
    return new Error(`fal API Error: ${firstError.msg}`)
  }

  return new Error(`Unexpected error: ${error.message || 'Unknown error'}`)
}
```

---

## ⚠️ 风险评估与应对

### 风险 1：官方 SDK API 与预期不符
**概率**：低
**影响**：高
**应对**：
- 在开始前查阅官方文档确认 API
- 准备回滚方案（保留旧代码分支）

### 风险 2：进度回调格式不兼容
**概率**：中
**影响**：中
**应对**：
- 在 onQueueUpdate 中添加适配层
- 确保 ProgressStatus 接口兼容

### 风险 3：某些模型特性不支持
**概率**：低
**影响**：中
**应对**：
- 保留路由系统的灵活性
- 必要时混合使用官方 SDK 和直接 HTTP 调用

### 风险 4：性能下降
**概率**：极低
**影响**：低
**应对**：
- 官方 SDK 通常性能更优
- 如有问题，可以调整轮询间隔等参数

---

## ✅ 验收标准

### 功能验收
- [ ] 所有图片生成模型正常工作
- [ ] 所有视频生成模型正常工作
- [ ] 进度回调正常触发
- [ ] 状态查询正常工作
- [ ] 超时恢复机制正常
- [ ] 错误处理正确

### 代码质量验收
- [ ] 代码行数减少 60% 以上
- [ ] 无 TypeScript 类型错误
- [ ] 无 ESLint 警告
- [ ] 删除所有废弃文件

### 性能验收
- [ ] 图片生成速度不低于当前实现
- [ ] 视频生成速度不低于当前实现
- [ ] 内存占用无明显增加

---

## 📚 参考资料

1. **官方文档**：https://fal.ai/models/fal-ai/ltx-2/retake-video/api
2. **npm 包**：https://www.npmjs.com/package/@fal-ai/client
3. **迁移指南**：https://fal.ai/docs/migration-guide（如有）

---

## 🎉 预期收益

### 代码简化
- **删除代码**：~334 行（queueHandler + statusHandler）
- **简化代码**：FalAdapter 从 204 行减少到 ~150 行
- **总体减少**：~40% 代码量

### 功能增强
- ✅ 自动文件上传（File/Blob/Buffer）
- ✅ 实时日志流
- ✅ Webhook 支持
- ✅ 更好的错误处理
- ✅ 官方类型定义

### 维护性提升
- ✅ 跟随官方 API 更新
- ✅ 减少自定义逻辑
- ✅ 更易理解和调试
- ✅ 社区支持

---

## 📅 时间估算

| 阶段 | 预计时间 | 说明 |
|------|---------|------|
| 准备工作 | 5 分钟 | 安装依赖、备份代码 |
| 重写 FalAdapter | 20 分钟 | 核心逻辑改写 |
| 测试验证 | 15 分钟 | 全面功能测试 |
| 清理工作 | 5 分钟 | 删除废弃文件 |
| **总计** | **45 分钟** | 一次性完成 |

---

## 🚀 开始迁移

确认此方案后，我将按照以下顺序执行：

1. ✅ 安装 @fal-ai/client
2. ✅ 更新 config.ts
3. ✅ 重写 FalAdapter.ts
4. ✅ 运行测试验证
5. ✅ 删除废弃文件
6. ✅ 最终验收

**请确认是否开始执行迁移？**
