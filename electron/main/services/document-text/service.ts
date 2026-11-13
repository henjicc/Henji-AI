import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createCapabilityClient, createDeepSeekDocumentOcrModule, type DocumentOcrInput, type DocumentOcrOutput, type RuntimeContext } from '@henjicc/ai-sdk'
import { DOCUMENT_TEXT_MAX_BYTES, DOCUMENT_TEXT_MEDIA_TYPES, documentTextExtension, isDocumentTextImage, resolveDocumentTextEngine, type DocumentTextEngine } from '../../../../src/core/documentText'
import type { DocumentTextInspection, DocumentTextInspectRequest, DocumentTextRequest, DocumentTextResult } from '../../../../src/platform/contracts/documentText'
import type { ImageTextJob, ImageTextLine, ImageTextResult } from '../local-inference/ocr/imageText'
import type { LocalExecutionProvider } from '../local-inference/providers'
import type { BundledOcrModelId } from '../local-models/bundledOcr'

export interface DocumentTextDependencies {
  ensureModel(id: BundledOcrModelId, role?: 'model' | 'dict'): Promise<string>
  providers: LocalExecutionProvider[]
  imageText(job: ImageTextJob): Promise<ImageTextResult>
  cancelLocal(id: string): void
  deepseekOcr(input: DocumentOcrInput, signal: AbortSignal): Promise<DocumentOcrOutput>
  log(level: 'info' | 'warn', message: string, event: string, context: Record<string, unknown>): void
}

// 与录屏隐私识别同一阈值：低于它的多为噪点或残字。
const MIN_CONFIDENCE = 0.5

/** 检测框按从上到下、从左到右排好；纵向中心落在同一行高度内的框拼成一行，用空格隔开。 */
export function composeImageTextLines(lines: readonly ImageTextLine[]): string {
  const rows: ImageTextLine[][] = []
  for (const line of lines.filter(item => item.confidence >= MIN_CONFIDENCE && item.text.trim())) {
    const center = line.box[1] + line.box[3] / 2
    const row = rows.at(-1)
    const anchor = row?.[0]
    if (row && anchor && Math.abs(anchor.box[1] + anchor.box[3] / 2 - center) < Math.min(anchor.box[3], line.box[3]) / 2) row.push(line)
    else rows.push([line])
  }
  return rows.map(row => row.sort((a, b) => a.box[0] - b.box[0]).map(item => item.text.trim()).join(' ')).join('\n')
}

/** 识别前与识别时共用的文件检查；上传前就能确定的问题都带错误码，调用方据此判定没有执行、没有计费。 */
async function checkDocumentFile(filePath: string, engine: DocumentTextEngine): Promise<number> {
  const stat = await fs.stat(filePath).catch(() => { throw new Error('DOCUMENT_NOT_FOUND: 找不到这个文件，或没有读取权限。') })
  if (!stat.isFile()) throw new Error('DOCUMENT_NOT_FILE: 路径不是文件。')
  if (engine === 'deepseek' && stat.size > DOCUMENT_TEXT_MAX_BYTES) throw new Error('DOCUMENT_TOO_LARGE: DeepSeek 文字识别单个文件最大 100 MiB，没有上传，也不收费。')
  return stat.size
}

/** 付费确认之前调用：核对文件并估出页数（图片算 1 页；统计不出的文档返回 null，由调用方按上限估价）。 */
export async function inspectDocumentText(request: DocumentTextInspectRequest, countPages: (filePath: string, extension: string) => Promise<number | null>): Promise<DocumentTextInspection> {
  const engine = resolveDocumentTextEngine(request.path, request.engine)
  const sizeBytes = await checkDocumentFile(request.path, engine)
  const pages = engine === 'local' || isDocumentTextImage(request.path) ? 1 : await countPages(request.path, documentTextExtension(request.path))
  return { engine, sizeBytes, pages }
}

export function createDocumentTextService(deps: DocumentTextDependencies) {
  return async function recognize(request: DocumentTextRequest, signal: AbortSignal): Promise<DocumentTextResult> {
    const engine = resolveDocumentTextEngine(request.path, request.engine)
    const summary = { engine, extension: documentTextExtension(request.path), layout: request.layout }
    deps.log('info', '识别文件文字开始', 'document_text.recognize.start', summary)
    const started = Date.now()
    try {
      await checkDocumentFile(request.path, engine)
      signal.throwIfAborted()
      let result: DocumentTextResult
      if (engine === 'local') {
        const recognitionId = 'text_recognition_ppocr'
        const job: ImageTextJob = {
          id: randomUUID(), imagePath: request.path, providers: deps.providers, normalization: 'rgb-half',
          models: [{ name: 'ppocr', path: await deps.ensureModel('text_detection_ppocr') }, { name: 'ppocr_rec', path: await deps.ensureModel(recognitionId) }],
          dictionaryPath: await deps.ensureModel(recognitionId, 'dict'),
        }
        signal.throwIfAborted()
        const cancel = (): void => deps.cancelLocal(job.id)
        signal.addEventListener('abort', cancel, { once: true })
        try {
          const image = await deps.imageText(job)
          result = { engine, charged: false, pageCount: 1, pages: [{ index: 0, text: composeImageTextLines(image.lines), complete: true }] }
        } finally { signal.removeEventListener('abort', cancel) }
      } else {
        const extension = documentTextExtension(request.path)
        const bytes = new Uint8Array(await fs.readFile(request.path))
        signal.throwIfAborted()
        const output = await deps.deepseekOcr({
          file: { kind: 'bytes', bytes, mediaType: DOCUMENT_TEXT_MEDIA_TYPES[extension] ?? 'application/octet-stream', filename: path.basename(request.path) },
          layout: request.layout,
        }, signal)
        result = { engine, charged: true, pageCount: output.pageCount, pages: output.pages.map(page => ({ index: page.index, text: page.text, complete: page.finishReason === 'stop' })) }
      }
      deps.log('info', '识别文件文字完成', 'document_text.recognize.completed', { ...summary, pageCount: result.pageCount, durationMs: Date.now() - started })
      return result
    } catch (error) {
      deps.log('warn', '识别文件文字失败', 'document_text.recognize.failed', { ...summary, durationMs: Date.now() - started, message: error instanceof Error ? error.message.slice(0, 300) : String(error) })
      throw error
    }
  }
}

/** DeepSeek OCR 官方总时长上限 180 秒（含上传）；多留余量给大文件上传。 */
const DEEPSEEK_OCR_TIMEOUT_MS = 200_000

export function createDeepSeekOcr(runtime: RuntimeContext): DocumentTextDependencies['deepseekOcr'] {
  const client = createCapabilityClient({ runtime, modules: [createDeepSeekDocumentOcrModule()] })
  return (input, signal) => client.execute<DocumentOcrInput, DocumentOcrOutput>('deepseek.document-ocr', input, { signal, timeoutMs: DEEPSEEK_OCR_TIMEOUT_MS })
}
