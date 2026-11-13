import type { z } from 'zod'
import { recognizeDocumentTextCapability } from '@/core/application-control/domains/asset/documentTextCapability'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import { documentTextEstimatedCny, DocumentTextEngineError, resolveDocumentTextEngine } from '@/core/documentText'
import { getPlatform } from '@/platform/runtime'
import { withPaidOperation } from '@/services/paidApproval'

type Output = z.infer<typeof recognizeDocumentTextCapability.outputSchema>
const PREFLIGHT_ERROR = /(DOCUMENT_[A-Z_]+|LOCAL_OCR_[A-Z_]+):/

/** 本地识别直接执行；DeepSeek 识别按页计费，先过付费策略再提交。 */
export async function recognizeDocumentText(raw: unknown, signal?: AbortSignal): Promise<Output> {
  const input = recognizeDocumentTextCapability.inputSchema.parse(raw)
  let engine
  try { engine = resolveDocumentTextEngine(input.path, input.engine) } catch (error) {
    throw error instanceof DocumentTextEngineError ? notExecutedFailure(error) : error
  }
  const platform = getPlatform().documentText
  const run = async (runSignal?: AbortSignal): Promise<Output> => {
    const requestId = crypto.randomUUID()
    const cancel = (): void => { void platform.cancel(requestId) }
    runSignal?.addEventListener('abort', cancel, { once: true })
    try {
      let result
      try { result = await platform.recognize({ requestId, path: input.path, engine, layout: input.layout }) } catch (error) {
        // 本地识别没有副作用；DeepSeek 只有上传前就拒绝的错误（格式、大小、路径）才能确定没有计费。
        throw engine === 'local' || (error instanceof Error && PREFLIGHT_ERROR.test(error.message)) ? notExecutedFailure(error) : error
      }
      const incomplete = result.pages.filter(page => !page.complete).length
      const empty = result.pages.every(page => !page.text.trim())
      return {
        ...result,
        verified: true as const,
        message: empty ? '没有识别出文字。'
          : `已用${result.engine === 'local' ? '本地识别' : ' DeepSeek'}读出 ${result.pageCount} 页文字${incomplete ? `，其中 ${incomplete} 页输出达到上限、文字不完整` : ''}。`,
      }
    } finally { runSignal?.removeEventListener('abort', cancel) }
  }
  if (engine === 'local') return run(signal)
  // 付费确认之前先核对文件并统计页数：文件不存在或超限时不弹确认，估价按真实页数而不是一律按上限占额度。
  let pages
  try {
    const inspecting = platform.inspect({ path: input.path, engine })
    // 统计页数最长约 20 秒；取消时不等它结束，预检本身没有副作用。
    ;({ pages } = await (signal ? Promise.race([inspecting, new Promise<never>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason)
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })]) : inspecting))
  } catch (error) { throw notExecutedFailure(error) }
  signal?.throwIfAborted()
  return withPaidOperation({ category: 'recognition', estimatedCny: documentTextEstimatedCny(engine, pages), titleKey: 'paidApproval.recognizeDocument' }, run, signal)
}
