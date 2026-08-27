import fs from 'node:fs'
import path from 'node:path'

import {
  createAIClient,
  defaultFilename,
  inferMimeFromPath,
  noopTracer,
  normalizeLocalSource,
  parseDataUri,
  type CredentialScope,
  type CredentialStore,
  type Logger,
  type MediaBinary,
  type MediaReader,
  type RuntimeContext,
  type Transport,
} from '@henjicc/ai-sdk'

import { getAiProviderApiKey, getKey, getLlmProviderApiKey } from '../keystore'
import { createMainLogger } from '../logging'

/**
 * `packages/ai-sdk/src/runtime/*` 定义的 5 个宿主契约接口的 Electron 实现，聚合成一个
 * 单例 `RuntimeContext` 供后续从主进程迁入 SDK 的供应商适配代码消费（任务 2.2/2.3/2.4）。
 *
 * 本文件只做「接口 -> 现有主进程能力」的组装，不重复实现已有逻辑：网络用全局 `fetch`
 * （Electron 主进程内置 Node/undici），凭据复用 `../keystore`，日志复用 `../logging`。
 * 与包根 `@henjicc/ai-sdk` 而非子路径 `@henjicc/ai-sdk/runtime` 对接，是因为
 * `tsconfig.electron.json` 的 `moduleResolution: "node"`（TS 经典解析）不识别
 * package.json 的 `exports` 字段，只认顶层 `main`/`types`——详见
 * `packages/ai-sdk/src/index.ts` 顶部注释与 docs/task/模型SDK抽离/重要记录.md 记录 012。
 */

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * 直接转发到全局 `fetch`。`retryPreconnectOnce` 这类重试策略刻意不在这里实现——
 * 那是 `providers/provider-fetch.ts` 里 `fetchProvider()` 的职责（任务 2.2/2.3 会把它
 * 迁移成包在 `Transport` 外层的 SDK 内部包装函数），`Transport` 实现本身只需要老实地
 * 发请求、老实地把失败 throw 出去。
 */
export const electronTransport: Transport = {
  fetch: (url, init) => fetch(url, init),
}

// ---------------------------------------------------------------------------
// CredentialStore
// ---------------------------------------------------------------------------

/**
 * `'generation'`/`'llm'` 两个内置作用域分别对应现有的生成模型密钥与 LLM 密钥两套
 * keystore 函数（`getLlmProviderApiKey` 内部还带着 PPIO 密钥兜底复用逻辑，原样保留）。
 * 其余任意 scope 落到 keystore 的通用 `getKey(namespace, providerId)`——这是
 * `CredentialScope` 可扩展设计（记录 005）在 Electron 侧的落地：新增一个凭据命名空间
 * 不需要改这个文件。
 */
export const electronCredentialStore: CredentialStore = {
  get(scope: CredentialScope, providerId: string): string | undefined {
    if (scope === 'generation') return getAiProviderApiKey(providerId) ?? undefined
    if (scope === 'llm') return getLlmProviderApiKey(providerId) ?? undefined
    return getKey(scope, providerId) ?? undefined
  },
}

// ---------------------------------------------------------------------------
// MediaReader
// ---------------------------------------------------------------------------

/**
 * `data:` URI 解析（`parseDataUri`）、按扩展名推断 MIME（`inferMimeFromPath`）、缺省文件名
 * （`defaultFilename`）三者都是纯字符串/字节处理，不依赖任何 Electron 专属能力，任务 2.4
 * 把它们统一收进了 `packages/ai-sdk/src/upload/media-binary.ts` 并导出——这里不再维护一份
 * 独立拷贝（2.1 产出时的实现就是这份要被替换掉的临时拷贝，语义完全一致，直接复用即可）。
 * 本文件只保留 Electron 独有的部分：本地文件系统读取（`fs.readFileSync`）与路径处理
 * （`path.basename`，取文件名——这一步不是"推断 MIME"，SDK 侧没有对应函数）。
 */
export const electronMediaReader: MediaReader = {
  async read(ref: string): Promise<MediaBinary> {
    const trimmed = ref.trim()
    const dataUri = parseDataUri(trimmed)
    if (dataUri) {
      return {
        bytes: dataUri.bytes,
        mimeType: dataUri.mimeType,
        filename: defaultFilename(dataUri.mimeType),
      }
    }

    const localPath = normalizeLocalSource(trimmed)
    if (!localPath) {
      throw new Error(`Unsupported media ref: ${ref}`)
    }
    const bytes = fs.readFileSync(localPath)
    const mimeType = inferMimeFromPath(localPath)
    return {
      bytes,
      mimeType,
      filename: path.basename(localPath) || defaultFilename(mimeType),
    }
  },
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/**
 * `LogContext` 的字段集合（`event`/`requestId`/`taskId`/`modelId`/`providerId`/
 * `context`/`error`）与 `createMainLogger` 的 `MainLoggerMeta` 完全一致，直接透传，
 * 不需要写任何字段映射代码。
 */
const mainLogger = createMainLogger('ai-runtime.sdk')

export const electronLogger: Logger = {
  info: (message, ctx) => mainLogger.info(message, ctx),
  warn: (message, ctx) => mainLogger.warn(message, ctx),
  error: (message, ctx) => mainLogger.error(message, ctx),
}

// ---------------------------------------------------------------------------
// Tracer
// ---------------------------------------------------------------------------

/**
 * 生成、LLM 流式与 LLM 模型步已经共用 SDK `Tracer` 接口。痕迹AI 助手专属 trace
 * 按重要记录 014 留在应用侧，不能塞回通用 SDK；当前 Electron 宿主没有独立 APM，
 * 因此使用 no-op 实现，既保留统一注入点，也不制造第二份助手追踪数据。
 */
export const electronTracer = noopTracer

// ---------------------------------------------------------------------------
// RuntimeContext 单例
// ---------------------------------------------------------------------------

export const sdkRuntimeContext: RuntimeContext = {
  transport: electronTransport,
  credentials: electronCredentialStore,
  media: electronMediaReader,
  logger: electronLogger,
  tracer: electronTracer,
}

/** 两类模型运行时共用同一个客户端与同一个 RuntimeContext。 */
export const sdkAIClient = createAIClient({ runtime: sdkRuntimeContext })
