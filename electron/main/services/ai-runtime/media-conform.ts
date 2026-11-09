import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeLocalSource, resolveRuntimeInputLimits, type JsonObject, type ModelRuntimeDefinition } from '@henjicc/ai-sdk'

import { fitMediaDimensions } from '../../../../src/core/media/fitMediaDimensions'
import { getUploadsDir } from '../image/path-utils'
import { loadSharp } from '../image/sharp-loader'
import { createMainLogger } from '../logging'
import { resolveLocalMediaPath } from '../media/shared'
import { readVideoInfo, scaleVideoToDimensions } from '../video/ops'

const logger = createMainLogger('ai-runtime.media_conform')

/** 本地参考素材在参数里的位置：上传路径与显示地址是同一组素材的两种写法，按值一并替换 */
const MEDIA_KEYS = {
  image: ['uploadedFilePaths', 'images', 'uploadedImages'],
  video: ['uploadedVideoFilePaths', 'videos', 'uploadedVideos'],
} as const

async function scaleImageToDimensions(localPath: string, width: number, height: number): Promise<string> {
  const stat = await fs.promises.stat(localPath)
  // 有损格式保持有损，避免缩小后反而因转成 PNG 变大
  const format = /\.jpe?g$/i.test(localPath) ? 'jpeg' : /\.webp$/i.test(localPath) ? 'webp' : 'png'
  const digest = crypto.createHash('md5').update(`${localPath}:${stat.mtimeMs}:${width}x${height}`).digest('hex')
  const outputPath = path.join(getUploadsDir(), `fit-${digest}.${format === 'jpeg' ? 'jpg' : format}`)
  if (fs.existsSync(outputPath)) return outputPath
  const sharp = await loadSharp()
  const temporaryPath = `${outputPath}.${crypto.randomUUID()}.tmp`
  const pipeline = sharp(localPath, { limitInputPixels: false }).rotate().resize(width, height, { fit: 'fill' })
  await (format === 'jpeg' ? pipeline.jpeg({ quality: 92 }) : format === 'webp' ? pipeline.webp({ quality: 92 }) : pipeline.png()).toFile(temporaryPath)
  try {
    await fs.promises.rename(temporaryPath, outputPath)
  } catch (error) {
    // 并发生成同一张图时另一份已经写好，用它即可
    await fs.promises.rm(temporaryPath, { force: true })
    if (!fs.existsSync(outputPath)) throw error
  }
  return outputPath
}

async function readDimensions(kind: 'image' | 'video', localPath: string, signal?: AbortSignal): Promise<{ width: number; height: number } | null> {
  try {
    if (kind === 'video') {
      const info = await readVideoInfo(localPath, signal)
      return info.width > 0 && info.height > 0 ? { width: info.width, height: info.height } : null
    }
    const meta = await (await loadSharp())(localPath, { limitInputPixels: false }).metadata()
    if (!meta.width || !meta.height) return null
    // EXIF 旋转 90° 的照片，供应商看到的是转正后的宽高
    return meta.orientation && meta.orientation >= 5 ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height }
  } catch (error) {
    logger.warn('读取参考素材尺寸失败，按原样提交', { event: 'generation.media_conform.probe_failed', context: { kind, error: String(error) } })
    return null
  }
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/**
 * 提交前把本地参考图、参考视频按模型声明的尺寸约束等比缩放（如总像素上限），代替让用户手动处理。
 * 只处理等比缩放能解决的情况；比例不对等缩放解决不了的原样交出，提交前检查已经给出提示。
 * 缩放产物缓存在上传目录，同一素材同一尺寸只处理一次。
 */
export async function conformGenerationMedia(
  model: ModelRuntimeDefinition,
  params: JsonObject,
  defaults: JsonObject,
  signal?: AbortSignal,
): Promise<JsonObject> {
  const keysByKind = {
    image: [...MEDIA_KEYS.image, ...model.params.filter(param => param.type === 'image-upload').map(param => param.id)],
    video: [...MEDIA_KEYS.video, ...model.params.filter(param => param.type === 'video-upload').map(param => param.id)],
  }
  // 本地素材以文件路径归并（同一文件的路径与显示地址算一份），远程素材以地址本身归并
  const sourceKey = (value: string): string | undefined => {
    const trimmed = value.trim()
    return /^https?:\/\//i.test(trimmed) ? trimmed : normalizeLocalSource(trimmed)
  }
  const collect = (kind: 'image' | 'video'): string[] => [...new Set(keysByKind[kind]
    .flatMap(key => strings(params[key]))
    .map(sourceKey)
    .filter((value): value is string => Boolean(value)))]
  const images = collect('image')
  const videos = collect('video')
  if (images.length === 0 && videos.length === 0) return params
  // 与界面提交前检查同一口径：参数缺省值参与条件判断
  const limits = resolveRuntimeInputLimits(model, { ...defaults, ...params }, { imagesCount: images.length, videosCount: videos.length })
  let next = params
  for (const [kind, sources] of [['image', images], ['video', videos]] as const) {
    const constraints = kind === 'image' ? limits.imageConstraints : limits.videoConstraints
    if (!constraints) continue
    const replacements = new Map<string, string>()
    for (const source of sources) {
      const localPath = await resolveLocalMediaPath(source, signal).catch(() => null)
      if (!localPath) continue
      const size = await readDimensions(kind, localPath, signal)
      if (!size) continue
      const target = fitMediaDimensions(constraints, size, { even: kind === 'video' })
      if (!target || (target.width === size.width && target.height === size.height)) continue
      try {
        replacements.set(source, kind === 'video'
          ? await scaleVideoToDimensions(localPath, target.width, target.height, signal)
          : await scaleImageToDimensions(localPath, target.width, target.height))
      } catch (error) {
        signal?.throwIfAborted()
        logger.error('参考素材缩放失败', { event: 'generation.media_conform.failed', modelId: model.meta.id, context: { kind, error: String(error) } })
        throw new Error(`参考${kind === 'video' ? '视频' : '图片'}（${size.width}×${size.height}）超出模型尺寸要求，自动缩放到 ${target.width}×${target.height} 时失败：${error instanceof Error ? error.message : String(error)}`)
      }
      logger.info('参考素材已按模型尺寸要求缩放', {
        event: 'generation.media_conform.scaled',
        modelId: model.meta.id,
        context: { kind, from: `${size.width}x${size.height}`, to: `${target.width}x${target.height}` },
      })
    }
    if (replacements.size === 0) continue
    const swap = (value: unknown): unknown => {
      if (typeof value !== 'string') return value
      const key = sourceKey(value)
      return (key && replacements.get(key)) ?? value
    }
    next = { ...next }
    for (const key of keysByKind[kind]) {
      const value = next[key]
      if (typeof value === 'string') next[key] = swap(value) as string
      else if (Array.isArray(value)) next[key] = value.map(swap) as JsonObject[string]
    }
  }
  return next
}
