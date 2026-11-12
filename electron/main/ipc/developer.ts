import { app } from 'electron'
import {
  createCapabilityClient,
  createQwenMtFlashTranslationModule,
  createQwenMtLiteTranslationModule,
  createQwenMtPlusTranslationModule,
  type SpeechRecognitionOutput,
  type TranslationOutput,
} from '@henjicc/ai-sdk'
import { z } from 'zod'
import { sdkRuntimeContext } from '../services/ai-runtime/sdk-runtime'
import { timestampedAsrService } from '../services/audio-edit/timestamped-asr'
import { createMainLogger } from '../services/logging'
import { parseStringField, registerIpcHandler } from './registry'
import { ASR_CATALOG } from '../../../src/core/audioEdit/asrCatalog'
import type { DeveloperTestRequest, DeveloperTestResult } from '../../../src/core/developer/developerTest'

const logger = createMainLogger('main.developer_test')

const developerTestSchema: z.ZodType<DeveloperTestRequest> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('asr'), requestId: z.string().min(1), modelId: z.string().min(1), audioPath: z.string().min(1), language: z.string().min(1).optional() }).strict(),
  z.object({ kind: z.literal('translation'), requestId: z.string().min(1), moduleId: z.string().min(1), text: z.string().min(1), targetLanguage: z.string().min(1), sourceLanguage: z.string().min(1).optional() }).strict(),
])

let translationClient: ReturnType<typeof createCapabilityClient> | undefined
// 进行中的调用，按请求标识取消：测试台点停止时连供应商请求一起停，不跑完计费
const running = new Map<string, AbortController>()

/** 开发者面板测试台：直接调用 SDK 的语音识别与翻译能力；正式安装包里拒绝调用。付费确认由渲染层发起前完成。 */
async function runDeveloperTest(request: DeveloperTestRequest): Promise<DeveloperTestResult> {
  if (app.isPackaged) throw new Error('测试台只在开发版可用')
  const startedAt = Date.now()
  const controller = new AbortController()
  running.set(request.requestId, controller)
  logger.info('测试台调用开始', { event: 'developer_test.start', requestId: request.requestId, modelId: request.kind === 'asr' ? request.modelId : request.moduleId, context: { kind: request.kind } })
  try {
    if (request.kind === 'asr') {
      // 与音频编辑的正式转写用同一组时间戳参数，测出来的结果才可比
      const entry = ASR_CATALOG.find((item) => item.descriptor.id === request.modelId)
      // 测试台没有任务回执（付费确认在渲染层发起前完成），明确声明后才放行
      const output = await timestampedAsrService.withoutReceipt(() => timestampedAsrService.client.execute<unknown, SpeechRecognitionOutput>(request.modelId, {
        audio: { kind: 'media-ref', ref: request.audioPath }, language: request.language ?? 'zh', punctuation: true, timestamps: true,
        ...(entry?.timestampOptions ? { options: entry.timestampOptions } : {}),
      }, { requestId: request.requestId, signal: controller.signal }))
      const elapsedMs = Date.now() - startedAt
      logger.info('测试台调用完成', { event: 'developer_test.completed', requestId: request.requestId, modelId: request.modelId, context: { kind: 'asr', elapsedMs, textChars: output.text.length, segments: output.segments?.length ?? 0 } })
      return { kind: 'asr', elapsedMs, output }
    }
    translationClient ??= createCapabilityClient({ runtime: sdkRuntimeContext, modules: [createQwenMtFlashTranslationModule(), createQwenMtPlusTranslationModule(), createQwenMtLiteTranslationModule()] })
    const output = await translationClient.execute<unknown, TranslationOutput>(request.moduleId, {
      source: request.text, targetLanguage: request.targetLanguage, ...(request.sourceLanguage ? { sourceLanguage: request.sourceLanguage } : {}),
    }, { requestId: request.requestId, signal: controller.signal })
    const elapsedMs = Date.now() - startedAt
    logger.info('测试台调用完成', { event: 'developer_test.completed', requestId: request.requestId, modelId: request.moduleId, context: { kind: 'translation', elapsedMs, usage: output.usage ?? null } })
    return { kind: 'translation', elapsedMs, output }
  } catch (error) {
    logger.error('测试台调用失败', { event: 'developer_test.failed', requestId: request.requestId, context: { kind: request.kind, elapsedMs: Date.now() - startedAt, cancelled: controller.signal.aborted }, error: error instanceof Error ? { name: error.name, message: error.message } : String(error) })
    throw error
  } finally {
    running.delete(request.requestId)
  }
}

export function registerDeveloperIpc(): void {
  registerIpcHandler<DeveloperTestRequest, DeveloperTestResult>('developer:runTest', (input) => developerTestSchema.parse(input), runDeveloperTest)
  registerIpcHandler<string, void>('developer:cancelTest', (input) => parseStringField(input, 'requestId'), (requestId) => { running.get(requestId)?.abort() })
}
