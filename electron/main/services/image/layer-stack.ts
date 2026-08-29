import { createHash } from 'node:crypto'

import { createMainLogger } from '../logging'
import { loadSharp } from './sharp-loader'
import {
  persistImageBytesTracked,
  rollbackPersistedImageBytes,
  type PersistedImageBytes,
} from './path-utils'
import { resolveSourceBytes } from './source'
import type {
  ComposeLayerStackLayerPayloadDto,
  ComposeLayerStackPayloadDto,
  ComposeLayerStackResultDto,
  ComposedLayerStackResourceDto,
} from './types'

const logger = createMainLogger('main.image.layer-stack')

export async function composeLayerStack(
  payload: ComposeLayerStackPayloadDto,
  signal?: AbortSignal
): Promise<ComposeLayerStackResultDto> {
  const startedAt = performance.now()
  const persistedEntries: PersistedImageBytes[] = []
  validatePayload(payload)
  logger.info('图层栈合成开始', {
    event: 'image.layer_stack.compose.start',
    context: { stackId: payload.stackId, layerCount: payload.layers.length },
  })
  try {
    const sharp = await loadSharp()
    const ordered = [...payload.layers].sort((left, right) => left.zIndex - right.zIndex)
    const prepared: Array<{
      input: ComposeLayerStackLayerPayloadDto
      bytes: Buffer
      resource: ComposedLayerStackResourceDto
    }> = []
    for (const layer of ordered) {
      throwIfAborted(signal)
      const source = await resolveSourceBytes(layer.source)
      const metadata = await sharp(source.bytes).metadata()
      const width = metadata.width ?? 0
      const height = metadata.height ?? 0
      const format = normalizeFormat(metadata.format)
      if (width < 1 || height < 1 || !format) throw new Error(`图层 ${layer.sourceOutputIndex} 无法解码`)
      if (Math.abs(width - layer.declaredWidth) > 1 || Math.abs(height - layer.declaredHeight) > 1) {
        throw new Error(`图层 ${layer.sourceOutputIndex} 尺寸与响应不一致`)
      }
      if (format !== layer.declaredFormat) throw new Error(`图层 ${layer.sourceOutputIndex} MIME 与响应不一致`)
      if (layer.role === 'content' && (format !== 'png' || metadata.hasAlpha !== true)) {
        throw new Error(`内容层 ${layer.sourceOutputIndex} 必须为含透明通道的 PNG`)
      }
      const placement = resolvePlacement(layer, width, height)
      prepared.push({
        input: layer,
        bytes: source.bytes,
        resource: {
          sourceOutputIndex: layer.sourceOutputIndex,
          filePath: '',
          mimeType: format === 'jpeg' ? 'image/jpeg' : format === 'png' ? 'image/png' : 'image/webp',
          width,
          height,
          hasAlpha: metadata.hasAlpha === true,
          byteLength: source.bytes.byteLength,
          sha256: digest(source.bytes),
          placement,
        },
      })
    }

    const base = prepared[0]
    if (!base || base.input.role !== 'base') throw new Error('图层栈缺少底图')
    const overlays = []
    for (const item of prepared) {
      if (item.input.visible === false || (item.input.opacity ?? 1) === 0) continue
      const clipped = await clipOverlay(item, base.resource.width, base.resource.height)
      if (!clipped) continue
      const opacity = item.input.opacity ?? 1
      const overlayBytes = opacity === 1
        ? clipped.bytes
        : await sharp(clipped.bytes).ensureAlpha().linear([1, 1, 1, opacity], [0, 0, 0, 0]).png().toBuffer()
      overlays.push({ input: overlayBytes, left: clipped.left, top: clipped.top, blend: 'over' as const })
    }
    throwIfAborted(signal)
    const compositeBytes = await sharp({
      create: {
        width: base.resource.width,
        height: base.resource.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite(overlays).toColourspace('srgb').png().toBuffer()
    const thumbnailBytes = await sharp(compositeBytes)
      .resize(payload.thumbnailMaxSize ?? 512, payload.thumbnailMaxSize ?? 512, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer()
    const thumbnailMetadata = await sharp(thumbnailBytes).metadata()
    const thumbnailWidth = thumbnailMetadata.width ?? 0
    const thumbnailHeight = thumbnailMetadata.height ?? 0
    if (thumbnailWidth < 1 || thumbnailHeight < 1) throw new Error('图层栈缩略图尺寸无效')
    for (const item of prepared) {
      if (payload.persistSourceLayers === false) {
        item.resource.filePath = item.input.source
        continue
      }
      const persisted = persistImageBytesTracked(item.bytes, item.input.declaredFormat === 'jpeg' ? 'jpg' : item.input.declaredFormat)
      persistedEntries.push(persisted)
      item.resource.filePath = persisted.filePath
    }
    const persistedComposite = persistImageBytesTracked(compositeBytes, 'png')
    persistedEntries.push(persistedComposite)
    const persistedThumbnail = persistImageBytesTracked(thumbnailBytes, 'webp')
    persistedEntries.push(persistedThumbnail)
    const result = {
      stackId: payload.stackId,
      canvasWidth: base.resource.width,
      canvasHeight: base.resource.height,
      resources: prepared.map((item) => item.resource),
      compositePath: persistedComposite.filePath,
      compositeSha256: digest(compositeBytes),
      thumbnailPath: persistedThumbnail.filePath,
      thumbnailSha256: digest(thumbnailBytes),
      thumbnailWidth,
      thumbnailHeight,
      createdFilePaths: persistedEntries.filter((entry) => entry.created).map((entry) => entry.filePath),
    }
    logger.info('图层栈合成完成', {
      event: 'image.layer_stack.compose.completed',
      context: { stackId: payload.stackId, layerCount: prepared.length, durationMs: Math.round(performance.now() - startedAt) },
    })
    return result
  } catch (error) {
    for (const entry of persistedEntries.reverse()) rollbackPersistedImageBytes(entry)
    logger.error('图层栈合成失败', {
      event: 'image.layer_stack.compose.failed',
      context: { stackId: payload.stackId, durationMs: Math.round(performance.now() - startedAt) },
      error,
    })
    throw error
  }
}

function validatePayload(payload: ComposeLayerStackPayloadDto): void {
  if (!payload.requestId.trim()) throw new Error('requestId 不能为空')
  if (!payload.stackId.trim()) throw new Error('stackId 不能为空')
  if (payload.layers.length < 1 || payload.layers.length > 17) throw new Error('图层数量必须为 1..17')
  const z = new Set<number>()
  const sources = new Set<number>()
  for (const layer of payload.layers) {
    if (!Number.isInteger(layer.zIndex) || layer.zIndex < 0 || layer.zIndex > 16 || z.has(layer.zIndex)) throw new Error('图层 zIndex 无效或重复')
    if (!Number.isInteger(layer.sourceOutputIndex) || layer.sourceOutputIndex < 0 || sources.has(layer.sourceOutputIndex)) throw new Error('图层 sourceOutputIndex 无效或重复')
    if (!layer.source.trim()) throw new Error('图层 source 不能为空')
    if (layer.opacity !== undefined && (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1)) throw new Error('图层 opacity 必须位于 0..1')
    z.add(layer.zIndex)
    sources.add(layer.sourceOutputIndex)
  }
  if ([...z].sort((a, b) => a - b).some((value, index) => value !== index)) throw new Error('图层 zIndex 必须从 0 连续')
}

function resolvePlacement(layer: ComposeLayerStackLayerPayloadDto, width: number, height: number): ComposedLayerStackResourceDto['placement'] {
  if (layer.role === 'base') return { x: 0, y: 0, width, height }
  const absolute = layer.boundingBox?.absolute
  if (!absolute) throw new Error(`内容层 ${layer.sourceOutputIndex} 缺少 absolute bbox`)
  const [left, top, right, bottom] = absolute
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) throw new Error(`内容层 ${layer.sourceOutputIndex} bbox 无效`)
  if (Math.abs(right - left - width) > 1 || Math.abs(bottom - top - height) > 1) throw new Error(`内容层 ${layer.sourceOutputIndex} bbox 与图片尺寸偏差超过 1px`)
  return { x: Math.round(left), y: Math.round(top), width, height }
}

async function clipOverlay(
  item: { bytes: Buffer; resource: ComposedLayerStackResourceDto },
  canvasWidth: number,
  canvasHeight: number
): Promise<{ bytes: Buffer; left: number; top: number } | null> {
  const { x, y, width, height } = item.resource.placement
  const left = Math.max(0, x)
  const top = Math.max(0, y)
  const right = Math.min(canvasWidth, x + width)
  const bottom = Math.min(canvasHeight, y + height)
  if (right <= left || bottom <= top) return null
  if (left === x && top === y && right === x + width && bottom === y + height) return { bytes: item.bytes, left, top }
  const sharp = await loadSharp()
  const bytes = await sharp(item.bytes).extract({ left: left - x, top: top - y, width: right - left, height: bottom - top }).png().toBuffer()
  return { bytes, left, top }
}

function normalizeFormat(value: string | undefined): 'png' | 'jpeg' | 'webp' | null {
  if (value === 'jpg' || value === 'jpeg') return 'jpeg'
  if (value === 'png' || value === 'webp') return value
  return null
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('图层栈合成已取消', 'AbortError')
}
