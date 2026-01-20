# 魔搭 API 适配器实现总结

## 问题背景

在实现魔搭（ModelScope）API 适配器时，遇到了一个特殊的技术挑战：**浏览器环境下的 CORS 限制导致无法使用异步模式**。

### 问题描述

魔搭 API 提供两种调用模式：

1. **同步模式**：直接返回生成结果
   - 优点：简单快速
   - 缺点：某些模型（如 Qwen-image）**不支持同步模式**，会返回 400 错误

2. **异步模式**：返回 task_id，需要轮询查询结果
   - 优点：支持所有模型，可显示进度
   - 缺点：需要在请求头中添加 `X-ModelScope-Async-Mode: true`

### 核心问题

在浏览器环境（前端）中，添加自定义请求头会触发 CORS 预检请求（preflight），但魔搭 API 服务器不允许这些自定义请求头通过，导致请求失败：

```
Access to XMLHttpRequest at 'https://api-inference.modelscope.cn/v1/images/generations'
from origin 'http://localhost:3000' has been blocked by CORS policy:
Request header field x-modelscope-async-mode is not allowed by
Access-Control-Allow-Headers in preflight response.
```

### 尝试的方案

1. **方案 1：使用同步模式**
   - ❌ 失败：Qwen-image 等模型不支持，返回 400 错误
   - 错误信息：`"submit image generation task error"`

2. **方案 2：移除 seed 参数**
   - ❌ 失败：问题不在参数，而在请求模式
   - Qwen-image 必须使用异步模式

3. **方案 3：通过后端代理**
   - ✅ 成功：在 Tauri 后端处理 API 调用，避免 CORS 限制

---

## 解决方案：后端代理模式

### 架构设计

```
前端 (React/TypeScript)
    ↓ invoke('modelscope_submit_task')
后端 (Tauri/Rust)
    ↓ HTTP + 自定义请求头
魔搭 API 服务器
```

### 实现细节

#### 1. 后端实现（Rust）

**文件**：`src-tauri/src/modelscope.rs`

```rust
use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelscopeRequest {
    pub model: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub negative_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steps: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guidance: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed: Option<i32>,
}

/// 提交魔搭 API 图片生成任务（异步模式）
#[command]
pub async fn modelscope_submit_task(
    api_key: String,
    request: ModelscopeRequest,
) -> Result<ModelscopeTaskResponse, String> {
    let client = reqwest::Client::new();

    let response = client
        .post("https://api-inference.modelscope.cn/v1/images/generations")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("X-ModelScope-Async-Mode", "true")  // 关键：添加异步模式请求头
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    // 处理响应...
}

/// 查询魔搭 API 任务状态
#[command]
pub async fn modelscope_check_status(
    api_key: String,
    task_id: String,
) -> Result<ModelscopeTaskStatus, String> {
    let client = reqwest::Client::new();

    let response = client
        .get(format!("https://api-inference.modelscope.cn/v1/tasks/{}", task_id))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("X-ModelScope-Task-Type", "image_generation")  // 关键：添加任务类型请求头
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    // 处理响应...
}
```

**注册 Commands**：`src-tauri/src/main.rs`

```rust
mod modelscope;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      modelscope::modelscope_submit_task,
      modelscope::modelscope_check_status
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
```

**依赖配置**：`src-tauri/Cargo.toml`

```toml
[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
reqwest = { version = "0.11", features = ["json"] }
```

#### 2. 前端实现（TypeScript）

**文件**：`src/adapters/modelscope/ModelscopeAdapter.ts`

```typescript
import { invoke } from '@tauri-apps/api/core'
import { BaseAdapter, GenerateImageParams, ImageResult } from '../base/BaseAdapter'

export class ModelscopeAdapter extends BaseAdapter {
  private apiKey: string

  constructor(apiKey: string) {
    super('ModelScope')
    this.apiKey = apiKey
  }

  async generateImage(params: GenerateImageParams): Promise<ImageResult> {
    // 1. 构建请求参数
    const route = findRoute(params.model)
    const { requestData } = route.buildImageRequest(params)

    // 2. 通过 Tauri 后端发送异步请求
    const response = await invoke<ModelscopeTaskResponse>('modelscope_submit_task', {
      apiKey: this.apiKey,
      request: requestData
    })

    // 3. 开始轮询任务状态
    return await this.pollTaskStatus(response.task_id, params.onProgress)
  }

  async checkStatus(taskId: string): Promise<any> {
    // 通过 Tauri 后端查询任务状态
    return await invoke<ModelscopeTaskStatus>('modelscope_check_status', {
      apiKey: this.apiKey,
      taskId: taskId
    })
  }

  async pollTaskStatus(taskId: string, onProgress?: any): Promise<ImageResult> {
    const { pollUntilComplete } = await import('@/utils/polling')

    const result = await pollUntilComplete<ImageResult>({
      checkFn: async () => {
        const status = await this.checkStatus(taskId)

        if (status.task_status === 'SUCCEED' && status.output_images) {
          return {
            status: 'SUCCEED',
            result: {
              url: status.output_images.join('|||'),
              status: 'COMPLETED'
            }
          }
        }

        return { status: status.task_status, result: undefined }
      },
      isComplete: (status) => status === 'SUCCEED',
      isFailed: (status) => status === 'FAILED',
      onProgress: (progress, status) => {
        if (onProgress) {
          onProgress({
            status: status as any,
            progress,
            message: this.getStatusMessage(status)
          })
        }
      },
      interval: 3000,
      maxAttempts: 120,
      estimatedAttempts: 40
    })

    return result
  }
}
```

---

## 代码组织与设计理念

### 项目整体设计理念

本项目采用**模块化 + 适配器模式**的架构，核心设计原则：

1. **单一职责原则**：每个文件只负责一个明确的功能
2. **避免超大文件**：通过文件拆分，单个文件控制在 200 行以内
3. **代码复用优先**：通用逻辑提取到基类或工具函数
4. **模块独立性**：每个适配器独立维护，互不影响

### 魔搭适配器的代码组织

```
src/adapters/modelscope/
├── ModelscopeAdapter.ts    (~130 行) - 主适配器类
├── config.ts               (~16 行)  - 配置常量
├── models/
│   └── index.ts           (~62 行)  - 统一路由（匹配所有模型）
└── parsers/
    ├── index.ts           (~1 行)   - 导出
    └── imageParser.ts     (~33 行)  - 图片响应解析

总计：~242 行，分散在 5 个文件中
```

### 符合设计理念的地方 ✅

1. **继承 BaseAdapter**
   - 复用日志、错误处理、媒体保存等通用方法
   - 遵循统一的接口契约

2. **配置隔离**
   - 独立的 `config.ts` 存储 API 地址、轮询参数等
   - 便于修改和维护

3. **模型路由系统**
   - 使用统一路由 `modelscopeUnifiedRoute` 匹配所有魔搭模型
   - 动态构建请求参数（prompt, size, steps, guidance 等）

4. **响应解析器**
   - 独立的 `imageParser.ts` 处理响应解析
   - 支持同步和异步两种响应格式

5. **文件拆分合理**
   - 没有超大文件（最大 130 行）
   - 职责清晰，易于维护

### 特殊设计考虑

#### 为什么没有独立的 StatusHandler？

**原因**：
- 魔搭的轮询逻辑相对简单（~45 行）
- 直接写在 Adapter 中更清晰，不需要额外的抽象层
- 避免过度设计（YAGNI 原则）

**对比**：
- **PPIO**：有独立的 `PPIOStatusHandler`（~110 行），因为逻辑复杂
- **Fal**：有独立的 `FalQueueHandler`（~270 行），因为队列机制特殊
- **ModelScope**：轮询逻辑简单，直接内联即可

#### 为什么使用 Tauri invoke 而非 HTTP 客户端？

**原因**：
- 魔搭 API 的特殊需求：必须使用异步模式（自定义请求头）
- 浏览器环境的 CORS 限制：无法添加自定义请求头
- 后端代理是唯一可行的解决方案

**这是魔搭适配器的独特之处**，不适合提取为通用模式。

---

## 工作流程

### 完整流程图

```
用户点击生成
    ↓
前端：MediaGenerator 调用 apiService.generateImage()
    ↓
前端：apiService 初始化 ModelscopeAdapter
    ↓
前端：ModelscopeAdapter.generateImage()
    ├─ 1. 查找路由（findRoute）
    ├─ 2. 构建请求参数（buildImageRequest）
    └─ 3. 调用 invoke('modelscope_submit_task')
        ↓
后端：Rust 接收请求
    ├─ 添加 Authorization 请求头
    ├─ 添加 X-ModelScope-Async-Mode: true
    └─ 发送 HTTP POST 到魔搭 API
        ↓
魔搭 API：返回 task_id
    ↓
后端：返回 task_id 给前端
    ↓
前端：开始轮询 pollTaskStatus()
    ├─ 每 3 秒调用一次 invoke('modelscope_check_status')
    ├─ 后端查询任务状态
    ├─ 更新进度条（基于时间：15 秒预期）
    └─ 直到 task_status === 'SUCCEED'
        ↓
前端：返回图片 URL，显示结果
```

### 关键时间节点

| 阶段 | 时间 | 说明 |
|------|------|------|
| 提交任务 | ~500ms | 前端 → 后端 → 魔搭 API |
| 轮询间隔 | 3 秒 | 每次查询状态的间隔 |
| 预期完成 | 15 秒 | 进度条预期时间（实际可能更快） |
| 最大轮询 | 6 分钟 | 120 次 × 3 秒 = 360 秒 |

---

## 支持的模型

所有魔搭模型都使用相同的后端代理模式：

| 模型 ID | 模型名称 | 说明 |
|---------|---------|------|
| `Tongyi-MAI/Z-Image-Turbo` | Z-Image-Turbo | 通义万相快速生成 |
| `Qwen/Qwen-Image` | Qwen-image | 通义千问图像生成 |
| `black-forest-labs/FLUX.1-Krea-dev` | FLUX.1-Krea-dev | FLUX 开发版 |
| `MusePublic/14_ckpt_SD_XL` | Anything XL | 万象熔炉 |
| `MusePublic/majicMIX_realistic` | majicMIX realistic | 麦橘写实 |
| `modelscope-custom` | 魔搭API文生图 | 自定义模型 |

---

## 技术要点总结

### 1. CORS 问题的本质

**CORS（跨域资源共享）**是浏览器的安全机制：

- **简单请求**：不触发预检，直接发送
  - 方法：GET、POST、HEAD
  - 请求头：Accept、Content-Type（限定值）、Authorization 等

- **复杂请求**：触发预检（OPTIONS 请求）
  - 自定义请求头（如 `X-ModelScope-Async-Mode`）
  - 服务器必须在预检响应中允许这些请求头

**魔搭 API 的问题**：
- 服务器不允许 `X-ModelScope-Async-Mode` 通过预检
- 导致浏览器阻止实际请求

### 2. 为什么后端可以绕过 CORS？

**CORS 只存在于浏览器环境**：

- 浏览器：受同源策略限制，必须遵守 CORS 规则
- 后端（Rust/Node.js/Python）：没有同源策略，可以自由发送任何请求头

**后端代理的优势**：
- ✅ 可以添加任意自定义请求头
- ✅ 不受 CORS 限制
- ✅ 可以处理复杂的认证逻辑
- ✅ 可以缓存、重试、日志记录等

### 3. Tauri invoke 机制

**Tauri** 是一个桌面应用框架，前端和后端通过 IPC（进程间通信）交互：

```typescript
// 前端调用
const result = await invoke<ResponseType>('command_name', {
  param1: value1,
  param2: value2
})

// 后端定义
#[command]
pub async fn command_name(param1: Type1, param2: Type2) -> Result<ResponseType, String> {
  // 处理逻辑
}
```

**优势**：
- 类型安全（TypeScript + Rust）
- 异步支持（async/await）
- 自动序列化/反序列化（serde）

### 4. 异步轮询的实现

**通用轮询工具**：`src/utils/polling.ts`

```typescript
export async function pollUntilComplete<T>(options: {
  checkFn: () => Promise<{ status: string; result?: T }>
  isComplete: (status: string) => boolean
  isFailed: (status: string) => boolean
  onProgress?: (progress: number, status: string) => void
  interval: number
  maxAttempts: number
  estimatedAttempts: number
}): Promise<T> {
  let attempts = 0

  while (attempts < options.maxAttempts) {
    const { status, result } = await options.checkFn()

    // 计算进度
    const progress = calculateProgress(attempts, options.estimatedAttempts)
    options.onProgress?.(progress, status)

    // 检查完成状态
    if (options.isComplete(status)) {
      return result!
    }

    if (options.isFailed(status)) {
      throw new Error(`Task failed with status: ${status}`)
    }

    // 等待下一次轮询
    await sleep(options.interval)
    attempts++
  }

  throw new Error('Polling timeout')
}
```

**进度计算**：

```typescript
export function calculateProgress(current: number, estimated: number): number {
  // 使用对数曲线，避免进度条卡在 99%
  const ratio = current / estimated
  return Math.min(95, Math.floor(ratio * 100))
}
```

---

## 与其他适配器的对比

| 特性 | PPIO | Fal | ModelScope |
|------|------|-----|------------|
| **HTTP 客户端** | axios | axios | Tauri invoke |
| **请求模式** | 同步 + 异步 | 同步 + 队列 | 异步（后端代理） |
| **轮询位置** | StatusHandler | QueueHandler | Adapter 内部 |
| **进度显示** | 基于轮询次数 | 基于队列位置 | 基于时间（15秒） |
| **特殊处理** | 多种视频模型 | 队列机制 | CORS 绕过 |

### 共性

1. 都继承 `BaseAdapter`
2. 都使用模型路由系统
3. 都有独立的响应解析器
4. 都支持进度回调

### 差异

1. **HTTP 客户端**：
   - PPIO/Fal：直接使用 axios
   - ModelScope：通过 Tauri 后端代理

2. **轮询实现**：
   - PPIO：独立的 StatusHandler（逻辑复杂）
   - Fal：独立的 QueueHandler（队列特殊）
   - ModelScope：内联在 Adapter（逻辑简单）

3. **进度计算**：
   - PPIO：基于轮询次数和预期次数
   - Fal：基于队列位置和状态
   - ModelScope：基于时间（15 秒预期）

---

## 经验教训

### 1. 不要过早优化

**错误做法**：
- 一开始就创建 StatusHandler、QueueHandler 等抽象层
- 为了"统一"而强行提取共同代码

**正确做法**：
- 先实现功能，确保能工作
- 当代码重复 3 次以上时，再考虑提取
- 简单的逻辑（<50 行）直接内联即可

### 2. 特殊情况需要特殊处理

**魔搭的特殊性**：
- CORS 限制 → 必须使用后端代理
- 这是魔搭独有的问题，不需要"通用化"

**不要为了统一而统一**：
- PPIO 用 axios 是合理的
- Fal 用 axios 是合理的
- ModelScope 用 Tauri invoke 也是合理的

### 3. 文档比代码更重要

**好的文档应该包含**：
- 问题背景和原因
- 尝试过的方案和失败原因
- 最终解决方案和实现细节
- 关键技术点的解释
- 与其他方案的对比

**这份文档的价值**：
- 新人可以快速理解为什么这么做
- 遇到类似问题时可以参考
- 避免重复踩坑

---

## 未来改进方向

### 1. 支持更多魔搭模型

当前支持 6 个模型，未来可以：
- 添加更多预设模型
- 优化自定义模型管理界面
- 支持模型参数的动态配置

### 2. 优化轮询策略

当前使用固定间隔（3 秒），可以改进为：
- 自适应间隔（根据任务状态调整）
- 指数退避（失败时逐渐增加间隔）
- 智能预测（根据历史数据预测完成时间）

### 3. 错误处理增强

当前错误处理较简单，可以：
- 区分不同类型的错误（网络、API、超时等）
- 提供更友好的错误提示
- 支持自动重试机制

### 4. 性能优化

- 缓存模型配置
- 批量提交任务
- 并发轮询多个任务

---

## 总结

魔搭 API 适配器的实现是一个**特殊案例**，核心要点：

1. **问题**：浏览器 CORS 限制导致无法使用异步模式
2. **解决方案**：通过 Tauri 后端代理，绕过 CORS 限制
3. **设计理念**：模块化 + 适配器模式，避免超大文件
4. **代码组织**：符合项目整体设计，职责清晰，易于维护
5. **特殊处理**：不强求统一，根据实际需求选择最合适的方案

**关键经验**：
- 不要过早优化，先让功能工作
- 特殊情况需要特殊处理，不要为了统一而统一
- 好的文档比完美的代码更重要

---

## 参考资料

- [魔搭 API 文档](https://www.modelscope.cn/docs/model-service/API-Inference/intro)
- [Tauri 文档](https://tauri.app/v1/guides/)
- [CORS 详解](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/CORS)
- [适配器模式](https://refactoring.guru/design-patterns/adapter)
