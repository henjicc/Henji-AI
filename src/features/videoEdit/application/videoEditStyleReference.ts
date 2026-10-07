import { z } from 'zod'
import { createLogger } from '@/core/logging'
import { stylePaletteFromClusters, type StylePaletteCluster } from '@/core/videoEdit/styleKitExtraction'
import { styleKitSchema, type StyleKit } from '@/core/videoEdit/styleKit'
import { getPlatform } from '@/platform/runtime'
import { assetApplicationService } from '@/features/assets/application/assetApplicationService'
import { requireVideoEditInstance } from './videoEditService'
import { videoEditSourceComposition } from './videoEditFrameObservation'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'
const logger = createLogger('features.videoEdit.styleKits')
export type StyleReference = { kind: 'item'; projectId: string; itemId: string; timeUs: number } | { kind: 'asset'; assetId: string }
const clusterSchema = z.array(z.object({ color: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]), weight: z.number().finite().nonnegative() }).strict()).min(1).max(8)
function quantizeInWorker(pixels: Uint8ClampedArray, signal?: AbortSignal): Promise<StylePaletteCluster[]> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../engine/videoEditStylePaletteWorker.ts', import.meta.url), { type: 'module' })
    const finish = (error?: unknown, clusters?: StylePaletteCluster[]): void => { signal?.removeEventListener('abort', cancel); worker.terminate(); if (error) reject(error); else resolve(clusters!) }
    const cancel = (): void => finish(signal?.reason ?? new DOMException('配色提取已取消。', 'AbortError'))
    signal?.addEventListener('abort', cancel, { once: true })
    worker.onerror = (): void => finish(new Error('参考配色提取失败，请重试。'))
    worker.onmessage = (event: MessageEvent<unknown>): void => { try { const value = z.object({ clusters: clusterSchema.optional(), error: z.string().optional() }).strict().parse(event.data); if (value.error) throw new Error(value.error); if (!value.clusters) throw new Error('没有返回配色候选。'); finish(undefined, value.clusters) } catch (error) { finish(error) } }
    worker.postMessage({ pixels }, [pixels.buffer])
  })
}
/** Native media reading and production source-frame rendering; no URL/path input in the public operation. */
export async function extractVideoEditReferenceStyle(reference: StyleReference, base: StyleKit, name: string, signal?: AbortSignal): Promise<StyleKit> {
  signal ??= new AbortController().signal
  logger.info('style_kit.extract_reference.start', '从参考提取风格配色', { context: { kind: reference.kind } })
  let bitmap: ImageBitmap | undefined
  try {
    signal?.throwIfAborted()
    if (reference.kind === 'asset') {
      const asset = await assetApplicationService.inspect(reference.assetId)
      if (asset.mediaType !== 'image') throw new Error('请选择资产库图片；视频帧请从剪辑素材提取。')
      const media = asset.filePath
      if (!media) throw new Error('此图片未落盘，请先下载素材。')
      bitmap = await createImageBitmap(await getPlatform().media.readLocalFileAsBlob(media))
    } else {
      const owner = requireVideoEditInstance(reference.projectId); const document = owner.document
      const item = document.items.find(value => value.id === reference.itemId); const media = document.media.find(value => value.id === item?.mediaId)
      if (!item || !media || !['image', 'video'].includes(media.kind)) throw new Error('请选择剪辑中的图片或视频素材。')
      if (media.kind === 'image') bitmap = await createImageBitmap(await getPlatform().media.readLocalFileAsBlob(media.path))
      else { const composition = videoEditSourceComposition(document, item.id, reference.timeUs); bitmap = await trialVideoEditCodeFrames([{ document: composition, frame: 0 }], signal, true); if (!bitmap) throw new Error('参考视频帧读取失败。') }
      if (requireVideoEditInstance(reference.projectId) !== owner || owner.document !== document) throw new Error('参考素材已有后续修改，请重新提取。')
    }
    signal?.throwIfAborted()
    const factor = Math.min(1, 128 / Math.max(bitmap.width, bitmap.height)); const width = Math.max(1, Math.round(bitmap.width * factor)); const height = Math.max(1, Math.round(bitmap.height * factor))
    const surface = new OffscreenCanvas(width, height); const context = surface.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('无法读取参考配色。')
    context.drawImage(bitmap, 0, 0, width, height)
    const clusters = await quantizeInWorker(context.getImageData(0, 0, width, height).data, signal); signal?.throwIfAborted()
    const result = styleKitSchema.parse({ ...base, id: crypto.randomUUID(), revision: 0, name, tokens: { ...base.tokens, palette: stylePaletteFromClusters(clusters) }, rules: `${base.rules}\n\n## 参考提取\n配色按可见面积与对比度分配；字体、动效和气质未由图片自动断言。助手可读取参考图补充建议，确认后再应用。` })
    logger.info('style_kit.extract_reference.completed', '参考风格候选已生成'); return result
  } catch (error) { logger.error('style_kit.extract_reference.failed', '参考配色提取失败', { error }); throw error }
  finally { bitmap?.close() }
}
