# Electron 接入

## 分层

SDK 客户端应只在 Electron **主进程**构造一次。渲染层通过 preload 白名单和 IPC 发送可序列化
DTO，不直接持有 API key，不导入 provider/runtime 实现，不直接请求供应商。

```text
renderer -> preload -> ipcMain -> createAIClient({ runtime }) -> provider
```

痕迹AI 的已验证实现在
`electron/main/services/ai-runtime/sdk-runtime.ts`，其单例 `sdkRuntimeContext` 与
`sdkAIClient` 同时服务生成和 LLM。

## 四个宿主能力

```ts
import fs from 'node:fs'
import path from 'node:path'
import {
  createAIClient,
  defaultFilename,
  inferMimeFromPath,
  normalizeLocalSource,
  parseDataUri,
  type RuntimeContext,
} from '@henjicc/ai-sdk'

const runtime: RuntimeContext = {
  transport: { fetch: (url, init) => fetch(url, init) },
  credentials: {
    get: (scope, providerId) => readFromOsProtectedStore(scope, providerId),
  },
  media: {
    async read(ref) {
      const data = parseDataUri(ref)
      if (data) {
        return { ...data, filename: defaultFilename(data.mimeType) }
      }
      const localPath = normalizeLocalSource(ref)
      if (!localPath) throw new Error(`Unsupported media ref: ${ref}`)
      return {
        bytes: new Uint8Array(fs.readFileSync(localPath)),
        mimeType: inferMimeFromPath(localPath),
        filename: path.basename(localPath),
      }
    },
  },
  logger: createSanitizedLogger(),
}

export const client = createAIClient({ runtime })
```

`readFromOsProtectedStore` 和 `createSanitizedLogger` 是宿主的安全存储/日志实现；痕迹AI 分别使用
Electron `safeStorage` 和统一结构化日志。日志不得放 API key、token、cookie 或完整授权头。

### `safeStorage` 与开发脚本身份

独立 Electron 验证脚本默认使用 `Electron` 这个 app name/profile，不能直接解密正式应用以另一
app identity 写入的密文。若维护脚本需要复用正式凭据，必须在 `app.whenReady()` **之前**设置与
正式应用相同的 `app.setName()`，并让 `userData` / `sessionData` 指向正式 profile；否则应要求用户
重新注入密钥，而不是复制密文、猜解密格式或把明文写入临时文件。这个限制只影响复用既有
`safeStorage` 密文；按本指南自行实现新宿主时，应始终让读写使用同一个应用身份。

## IPC 边界

- IPC 只传 `modelId` / 扁平 `params` / `requestId` / `taskId`等 DTO，不传函数或 `RuntimeContext`。
- `generate()` 可能返回 `pending + taskId`；宿主可立即 `continuePolling()`，或持久化 taskId 稍后续查。
- SDK 结果只有 URL/metadata，不会下载成 `filePath`。落盘、媒体协议转换、进度学习和应用 trace 留在宿主。
- 创建阶段用 requestId 取消；续轮询阶段用供应商 taskId 取消：
  `client.cancel({ namespace: 'generation', taskId })`。LLM 使用 `namespace: 'llm'`。
- 应用退出或替换 client 时调用 `dispose()`；它会注销该 client 拥有的自定义 provider。

Electron 主进程从包根 `@henjicc/ai-sdk` 导入是最兼容的写法；老的 TypeScript
`moduleResolution: "node"` 不识别 `exports` 子路径。
