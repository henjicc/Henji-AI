import { persistImageSourceTracked, readImageInfo } from '@/commands/image'
import { toFetchableMediaUrl } from '@/services/imageSource'
import { createLogger } from '@/core/logging'
import { registry } from '@/core/ModelRegistry'
import { OUTPAINT_WORKSPACE_MAXIMUM, OUTPAINT_REPAIR_PROMPT, isNativeOutpaintModel, readOutpaintComposition, resolveOutpaintModelParams } from '../domain/outpaintModelParams'
import type { OutpaintMargins } from '../domain/outpaintGeometry'
import type { GenerationNodeRequestPreparation, GenerationNodeRuntimePreparationContext } from '../nodes/shared/generationNodeExecutionTypes'
import { getOutpaintPreview } from './outpaintPreviewTexture'

const logger = createLogger('features.canvas.outpaint')

async function decode(source: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = source
  await image.decode()
  return image
}

/** 与工作面共用模糊底图；只在提交时合成，控件、网格线不进入模型输入。 */
export async function renderOutpaintInput(source: string, margins: OutpaintMargins): Promise<string> {
  const response = await fetch(toFetchableMediaUrl(source))
  if (!response.ok) throw new Error(`读取扩图源图片失败 (${response.status})`)
  const url = URL.createObjectURL(await response.blob())
  const image = await decode(url).finally(() => URL.revokeObjectURL(url))
  const texture = await decode(await getOutpaintPreview(image, OUTPAINT_WORKSPACE_MAXIMUM))
  const width = image.naturalWidth; const height = image.naturalHeight
  const outputWidth = width + margins.expandLeft + margins.expandRight
  const outputHeight = height + margins.expandTop + margins.expandBottom
  const scale = Math.min(1, 2048 / Math.max(outputWidth, outputHeight))
  const output = document.createElement('canvas')
  const foreground = document.createElement('canvas')
  output.width = Math.max(1, Math.round(outputWidth * scale)); output.height = Math.max(1, Math.round(outputHeight * scale))
  foreground.width = Math.max(1, Math.round(width * scale)); foreground.height = Math.max(1, Math.round(height * scale))
  try {
    const target = output.getContext('2d'); const front = foreground.getContext('2d')
    if (!target || !front) throw new Error('无法合成扩图输入图片')
    const maximum = OUTPAINT_WORKSPACE_MAXIMUM
    target.drawImage(texture, (margins.expandLeft - maximum) * scale, (margins.expandTop - maximum) * scale,
      (width + maximum * 2) * scale, (height + maximum * 2) * scale)
    front.drawImage(image, 0, 0, foreground.width, foreground.height)
    front.globalCompositeOperation = 'destination-in'
    for (const horizontal of [true, false]) {
      const gradient = front.createLinearGradient(0, 0, horizontal ? foreground.width : 0, horizontal ? 0 : foreground.height)
      // 仅用 alpha 作遮罩；与工作面的双向 12% 羽化相同。
      gradient.addColorStop(0, 'transparent'); gradient.addColorStop(0.12, 'black')
      gradient.addColorStop(0.88, 'black'); gradient.addColorStop(1, 'transparent')
      front.fillStyle = gradient; front.fillRect(0, 0, foreground.width, foreground.height)
    }
    target.drawImage(foreground, margins.expandLeft * scale, margins.expandTop * scale)
    return output.toDataURL('image/png')
  } finally {
    output.width = output.height = foreground.width = foreground.height = 0
  }
}

export async function prepareOutpaintGeneration(context: GenerationNodeRuntimePreparationContext): Promise<GenerationNodeRequestPreparation> {
  const requestId = crypto.randomUUID()
  const model = registry.getModel(context.modelId)
  if (!model || context.images.length !== 1) throw new Error('请选择图片编辑模型并连接一张图片')
  const logContext = { requestId, modelId: model.meta.id, providerId: model.meta.provider }
  logger.info('准备扩图请求', { ...logContext, event: 'outpaint.prepare.start' })
  try {
    const source = await readImageInfo(context.images[0])
    const prepared = resolveOutpaintModelParams(model, context.params, source, readOutpaintComposition(context.data))
    if (isNativeOutpaintModel(model)) {
      logger.info('专用扩图请求已准备', { ...logContext, event: 'outpaint.prepare.completed' })
      return { requestId, params: prepared.params }
    }
    const dataUrl = await renderOutpaintInput(context.images[0], prepared.margins)
    const prompt = [OUTPAINT_REPAIR_PROMPT, String(context.params.prompt ?? '').trim()].filter(Boolean).join('\n\n')
    // 持久化最后执行，成功后资源所有权立即交给共享执行器，失败/取消也会释放。
    const persisted = await persistImageSourceTracked(dataUrl)
    logger.info('模糊扩图输入已合成', { ...logContext, event: 'outpaint.prepare.completed', context: prepared.size })
    return { requestId, createdFilePaths: persisted.createdFilePaths,
      params: { ...prepared.params, prompt, text: prompt,
        images: [persisted.imagePath], uploadedFilePaths: [persisted.imagePath], uploadedImages: [persisted.imagePath] },
      inputs: { images: [persisted.imagePath], videos: [], audios: [] } }
  } catch (error) {
    logger.error('扩图请求准备失败', error, { ...logContext, event: 'outpaint.prepare.failed' })
    throw error
  }
}
