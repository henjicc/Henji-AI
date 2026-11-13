import path from 'node:path'
import { z } from 'zod'
import { DOCUMENT_TEXT_CHANNELS, documentTextRequestSchema } from '../../../src/platform/contracts/documentText'
import { registerIpcHandler } from './registry'
import { assertTrustedApplicationSender } from './application-control'
import { normalizeLocalSource } from '../services/image/source'
import { createMainLogger } from '../services/logging'
import { createDeepSeekOcr, createDocumentTextService } from '../services/document-text/service'
import { getLocalInferenceHost } from '../services/smart-regions/runtime'
import { ensureBundledOcrModel } from '../services/local-models/runtime'
import { executionProviderOrder } from '../services/local-inference/providers'
import { sdkRuntimeContext } from '../services/ai-runtime/sdk-runtime'

const logger = createMainLogger('main.document_text')
const running = new Map<string, AbortController>()

export function registerDocumentTextHandlers(): void {
  const recognize = createDocumentTextService({
    ensureModel: ensureBundledOcrModel, providers: executionProviderOrder(process.platform),
    imageText: job => getLocalInferenceHost().imageText(job), cancelLocal: id => getLocalInferenceHost().cancel(id),
    deepseekOcr: createDeepSeekOcr(sdkRuntimeContext),
    log: (level, message, event, context) => logger[level](message, { event, context }),
  })
  registerIpcHandler(DOCUMENT_TEXT_CHANNELS.recognize, value => documentTextRequestSchema.parse(value), async request => {
    if (running.has(request.requestId)) throw new Error('文字识别请求重复。')
    const local = normalizeLocalSource(request.path)
    if (!path.isAbsolute(local)) throw new Error('DOCUMENT_PATH_NOT_ABSOLUTE: 请使用本机文件的绝对路径。')
    const controller = new AbortController(); running.set(request.requestId, controller)
    try { return await recognize({ ...request, path: local }, controller.signal) }
    finally { running.delete(request.requestId) }
  }, assertTrustedApplicationSender)
  registerIpcHandler(DOCUMENT_TEXT_CHANNELS.cancel, value => z.string().min(1).max(100).parse(value), id => { running.get(id)?.abort(new Error('文字识别已取消。')) }, assertTrustedApplicationSender)
}
