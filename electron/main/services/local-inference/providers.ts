/*
 * 执行提供者（重要记录 003）：Windows DirectML → CPU，macOS CoreML → CPU，其他平台 CPU。
 * onnxruntime-node 的 Windows 包自带 DirectML（N 卡、A 卡、核显通用），没有带 CUDA；CUDA 只有 Linux 包提供，
 * 所以 CUDA 只在 Linux 且显式开启时排在最前。
 */

export type LocalExecutionProvider = 'dml' | 'coreml' | 'cuda' | 'cpu'

export function executionProviderOrder(platform: NodeJS.Platform, options: { cuda?: boolean } = {}): LocalExecutionProvider[] {
  if (platform === 'win32') return ['dml', 'cpu']
  if (platform === 'darwin') return ['coreml', 'cpu']
  if (platform === 'linux' && options.cuda) return ['cuda', 'cpu']
  return ['cpu']
}

export interface LocalInferenceLog {
  (level: 'info' | 'warn', message: string, event: string, context: Record<string, unknown>): void
}

/**
 * 按顺序尝试创建会话：某个提供者创建失败就记日志换下一个，全部失败抛出最后一个错误。
 * 推理首帧失败时调用方用 `remaining` 继续回退（显卡驱动不支持某个算子时常在首次运行才暴露）。
 */
export async function createSessionWithFallback<T>(
  order: readonly LocalExecutionProvider[],
  create: (provider: LocalExecutionProvider) => Promise<T>,
  log: LocalInferenceLog,
  model: string,
): Promise<{ session: T; provider: LocalExecutionProvider; remaining: LocalExecutionProvider[] }> {
  let lastError: unknown = new Error('没有可用的执行提供者。')
  for (const [index, provider] of order.entries()) {
    const started = Date.now()
    try {
      const session = await create(provider)
      log('info', '本地模型已加载', 'local_inference.session.created', { model, provider, durationMs: Date.now() - started })
      return { session, provider, remaining: order.slice(index + 1) }
    } catch (error) {
      lastError = error
      log('warn', '执行提供者不可用，改用下一个', 'local_inference.provider.fallback', { model, provider, reason: error instanceof Error ? error.message.slice(0, 300) : String(error) })
    }
  }
  throw lastError
}
