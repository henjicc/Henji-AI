import path from 'node:path'
import { z } from 'zod'
import { DOCUMENT_TEXT_CHANNELS, documentTextInspectRequestSchema, documentTextRequestSchema } from '../../../src/platform/contracts/documentText'
import { registerIpcHandler } from './registry'
import { assertTrustedApplicationSender } from './application-control'
import { normalizeLocalSource } from '../services/image/source'
import { createMainLogger } from '../services/logging'
import { createDeepSeekOcr, createDocumentTextService, inspectDocumentText } from '../services/document-text/service'
import { countDocumentPages } from '../services/document-text/pageCount'
import { getLocalInferenceHost } from '../services/smart-regions/runtime'
import { ensureBundledOcrModel } from '../services/local-models/runtime'
import { executionProviderOrder } from '../services/local-inference/providers'
import { sdkRuntimeContext } from '../services/ai-runtime/sdk-runtime'

const logger = createMainLogger('main.document_text')
const running = new Map<string, AbortController>()

function absolutePath(value: string): string {
  const local = normalizeLocalSource(value)
  if (!path.isAbsolute(local)) throw new Error('DOCUMENT_PATH_NOT_ABSOLUTE: 请使用本机文件的绝对路径。')
  return local
}

export function registerDocumentTextHandlers(): void {
  const recognize = createDocumentTextService({
    ensureModel: ensureBundledOcrModel, providers: executionProviderOrder(process.platform),
    imageText: job => getLocalInferenceHost().imageText(job), cancelLocal: id => getLocalInferenceHost().cancel(id),
    deepseekOcr: createDeepSeekOcr(sdkRuntimeContext),
    log: (level, message, event, context) => logger[level](message, { event, context }),
  })
  registerIpcHandler(DOCUMENT_TEXT_CHANNELS.inspect, value => documentTextInspectRequestSchema.parse(value), async request => {
    let inspection
    try { inspection = await inspectDocumentText({ ...request, path: absolutePath(request.path) }, countDocumentPages) } catch (error) {
      logger.warn('识别文件文字预检失败', { event: 'document_text.inspect.failed', context: { engine: request.engine, message: error instanceof Error ? error.message.slice(0, 200) : String(error) } })
      throw error
    }
    logger.info('识别文件文字预检完成', { event: 'document_text.inspect.completed', context: { engine: inspection.engine, sizeBytes: inspection.sizeBytes, pages: inspection.pages } })
    return inspection
  }, assertTrustedApplicationSender)
  registerIpcHandler(DOCUMENT_TEXT_CHANNELS.recognize, value => documentTextRequestSchema.parse(value), async request => {
    if (running.has(request.requestId)) throw new Error('文字识别请求重复。')
    const local = absolutePath(request.path)
    const controller = new AbortController(); running.set(request.requestId, controller)
    try { return await recognize({ ...request, path: local }, controller.signal) }
    finally { running.delete(request.requestId) }
  }, assertTrustedApplicationSender)
  registerIpcHandler(DOCUMENT_TEXT_CHANNELS.cancel, value => z.string().min(1).max(100).parse(value), id => { running.get(id)?.abort(new Error('文字识别已取消。')) }, assertTrustedApplicationSender)
}
