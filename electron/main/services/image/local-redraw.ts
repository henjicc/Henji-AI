import { randomUUID } from 'node:crypto'

import { createMainLogger } from '../logging'
import { describeLocalRedrawError, describeLocalRedrawSource } from './local-redraw-logging'
import { loadSharp } from './sharp-loader'
import { persistImageBytes, persistImageBytesTracked } from './path-utils'
import { resolveSourceBytes } from './source'
import {
  registerLocalRedrawFramesInWorker,
  type RegistrationDiagnostics,
  type RegistrationQuality,
} from './registration'
import {
  blendMaskedPixel,
  evaluateTransformSafety,
  measureSelectionChange,
  warpPixels,
} from './local-redraw-composition'

const logger = createMainLogger('main.image.local-redraw')

export type LocalRedrawAspectRatio = 'auto' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16'

export interface LocalRedrawSettingsDto {
  contextScale: number
  aspectRatio: LocalRedrawAspectRatio
  registrationQuality: RegistrationQuality
  featherPixels: number
  forceRegistration: boolean
}

export interface LocalRedrawRectDto {
  x: number
  y: number
  width: number
  height: number
}

export interface LocalRedrawContextDto {
  version: 2
  requestId: string
  source: string
  mask: string
  sourceWidth: number
  sourceHeight: number
  crop: LocalRedrawRectDto
  matchedAspectRatio: number | null
  settings: LocalRedrawSettingsDto
}

export interface PrepareLocalRedrawPayloadDto {
  source: string
  mask: string
  settings: LocalRedrawSettingsDto
  preferredAspectRatios?: number[]
}

export interface PrepareLocalRedrawResultDto {
  cropSource: string
  createdFilePaths: string[]
  context: LocalRedrawContextDto
}

export interface ComposeLocalRedrawPayloadDto {
  generatedSource: string
  context: LocalRedrawContextDto
}

export interface ComposeLocalRedrawResultDto {
  source: string
  registrationApplied: boolean
  diagnostics: RegistrationDiagnostics
}

interface CropResolution {
  crop: LocalRedrawRectDto
  matchedAspectRatio: number | null
}

function nonZeroBounds(
  values: Uint8Array,
  width: number,
  height: number,
): LocalRedrawRectDto | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (values[y * width + x] === 0) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX >= minX && maxY >= minY
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : null
}

function toDocumentRect(
  rect: LocalRedrawRectDto | null,
  crop: LocalRedrawRectDto,
): LocalRedrawRectDto | null {
  return rect
    ? { ...rect, x: rect.x + crop.x, y: rect.y + crop.y }
    : null
}

function parseRatio(value: LocalRedrawAspectRatio): number | null {
  if (value === 'auto') return null
  const [width, height] = value.split(':').map(Number)
  return width / height
}

function exactRatioCrop(
  bounds: LocalRedrawRectDto,
  imageWidth: number,
  imageHeight: number,
  contextScale: number,
  ratio: number,
): LocalRedrawRectDto | null {
  const expandedWidth = Math.max(64, bounds.width * contextScale)
  const expandedHeight = Math.max(64, bounds.height * contextScale)
  const minimumWidth = Math.max(bounds.width, bounds.height * ratio)
  const maximumWidth = Math.min(imageWidth, imageHeight * ratio)
  if (minimumWidth > maximumWidth + 0.5) return null

  const desiredWidth = Math.max(expandedWidth, expandedHeight * ratio)
  let width = Math.min(maximumWidth, Math.max(minimumWidth, desiredWidth))
  let height = width / ratio
  width = Math.max(1, Math.round(width))
  height = Math.max(1, Math.round(height))
  if (Math.abs(width / height - ratio) > 0.002) {
    height = Math.max(1, Math.min(imageHeight, Math.round(width / ratio)))
    width = Math.max(1, Math.min(imageWidth, Math.round(height * ratio)))
  }

  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const minimumX = Math.max(0, bounds.x + bounds.width - width)
  const maximumX = Math.min(bounds.x, imageWidth - width)
  const minimumY = Math.max(0, bounds.y + bounds.height - height)
  const maximumY = Math.min(bounds.y, imageHeight - height)
  if (minimumX > maximumX || minimumY > maximumY) return null
  const x = Math.round(Math.max(minimumX, Math.min(maximumX, centerX - width / 2)))
  const y = Math.round(Math.max(minimumY, Math.min(maximumY, centerY - height / 2)))
  return { x, y, width, height }
}

function autoCrop(
  bounds: LocalRedrawRectDto,
  imageWidth: number,
  imageHeight: number,
  contextScale: number,
): LocalRedrawRectDto {
  const width = Math.min(imageWidth, Math.max(64, Math.round(bounds.width * contextScale)))
  const height = Math.min(imageHeight, Math.max(64, Math.round(bounds.height * contextScale)))
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const x = Math.max(0, Math.min(imageWidth - width, Math.round(centerX - width / 2)))
  const y = Math.max(0, Math.min(imageHeight - height, Math.round(centerY - height / 2)))
  return { x, y, width, height }
}

function resolveCrop(
  bounds: LocalRedrawRectDto,
  imageWidth: number,
  imageHeight: number,
  settings: LocalRedrawSettingsDto,
  preferredAspectRatios: readonly number[],
): CropResolution {
  const explicitRatio = parseRatio(settings.aspectRatio)
  const baseRatio = Math.max(64, bounds.width * settings.contextScale)
    / Math.max(64, bounds.height * settings.contextScale)
  const candidates = explicitRatio
    ? [explicitRatio]
    : [...new Set(preferredAspectRatios)]
      .filter((ratio) => Number.isFinite(ratio) && ratio > 0)
      .sort((left, right) => Math.abs(left - baseRatio) - Math.abs(right - baseRatio))
  for (const ratio of candidates) {
    const crop = exactRatioCrop(bounds, imageWidth, imageHeight, settings.contextScale, ratio)
    if (crop) return { crop, matchedAspectRatio: ratio }
  }
  return {
    crop: autoCrop(bounds, imageWidth, imageHeight, settings.contextScale),
    matchedAspectRatio: null,
  }
}

function editableBounds(mask: Uint8Array, width: number, height: number): LocalRedrawRectDto | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[(y * width + x) * 4 + 3] >= 250) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX >= minX && maxY >= minY
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : null
}

export async function prepareLocalRedraw(
  payload: PrepareLocalRedrawPayloadDto,
): Promise<PrepareLocalRedrawResultDto> {
  const startedAt = performance.now()
  const requestId = randomUUID()
  logger.info('局部重绘裁剪开始', { event: 'image.local_redraw.prepare.start', requestId })
  try {
    const sharp = await loadSharp()
    const [sourceResolved, maskResolved] = await Promise.all([
      resolveSourceBytes(payload.source),
      resolveSourceBytes(payload.mask),
    ])
    const sourceMetadata = await sharp(sourceResolved.bytes).metadata()
    const width = sourceMetadata.width ?? 0
    const height = sourceMetadata.height ?? 0
    if (width < 1 || height < 1) throw new Error('源图尺寸无效')
    const { data: maskPixels, info: maskInfo } = await sharp(maskResolved.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (maskInfo.width !== width || maskInfo.height !== height) {
      throw new Error('遮罩尺寸必须与源图完全一致')
    }
    const bounds = editableBounds(maskPixels, width, height)
    if (!bounds) throw new Error('遮罩没有可编辑区域，请至少绘制一个区域')
    const { crop, matchedAspectRatio } = resolveCrop(
      bounds,
      width,
      height,
      payload.settings,
      payload.preferredAspectRatios ?? [],
    )
    const cropBytes = await sharp(sourceResolved.bytes)
      .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
      .png()
      .toBuffer()
    const persistedCrop = persistImageBytesTracked(cropBytes, 'png')
    const cropSource = persistedCrop.filePath
    logger.info('局部重绘裁剪完成', {
      event: 'image.local_redraw.prepare.completed',
      requestId,
      context: {
        bounds,
        crop,
        matchedAspectRatio,
        contextScale: payload.settings.contextScale,
        settings: payload.settings,
        artifacts: {
          source: describeLocalRedrawSource(payload.source),
          mask: describeLocalRedrawSource(payload.mask),
          crop: describeLocalRedrawSource(cropSource),
        },
        durationMs: Math.round(performance.now() - startedAt),
      },
    })
    return {
      cropSource,
      createdFilePaths: persistedCrop.created ? [cropSource] : [],
      context: {
        version: 2,
        requestId,
        source: payload.source,
        mask: payload.mask,
        sourceWidth: width,
        sourceHeight: height,
        crop,
        matchedAspectRatio,
        settings: payload.settings,
      },
    }
  } catch (error) {
    logger.error('局部重绘裁剪失败', {
      event: 'image.local_redraw.prepare.failed',
      requestId,
      error: describeLocalRedrawError(error),
      context: { durationMs: Math.round(performance.now() - startedAt) },
    })
    throw error
  }
}

export async function composeLocalRedraw(
  payload: ComposeLocalRedrawPayloadDto,
): Promise<ComposeLocalRedrawResultDto> {
  const startedAt = performance.now()
  const { requestId, crop, settings } = payload.context
  logger.info('局部重绘回贴开始', {
    event: 'image.local_redraw.compose.start',
    requestId,
    context: {
      artifacts: {
        source: describeLocalRedrawSource(payload.context.source),
        mask: describeLocalRedrawSource(payload.context.mask),
        generated: describeLocalRedrawSource(payload.generatedSource),
      },
      crop,
      featherPixels: settings.featherPixels,
    },
  })
  try {
    const sharp = await loadSharp()
    const [sourceResolved, maskResolved, generatedResolved] = await Promise.all([
      resolveSourceBytes(payload.context.source),
      resolveSourceBytes(payload.context.mask),
      resolveSourceBytes(payload.generatedSource),
    ])
    const [sourceMetadata, maskMetadata] = await Promise.all([
      sharp(sourceResolved.bytes).metadata(),
      sharp(maskResolved.bytes).metadata(),
    ])
    if (sourceMetadata.width !== payload.context.sourceWidth || sourceMetadata.height !== payload.context.sourceHeight) {
      throw new Error('源图尺寸已变化，请重新绘制遮罩后再生成')
    }
    if (maskMetadata.width !== payload.context.sourceWidth || maskMetadata.height !== payload.context.sourceHeight) {
      throw new Error('遮罩尺寸与源图不一致，请重新绘制遮罩')
    }
    if (!Number.isInteger(crop.x) || !Number.isInteger(crop.y)
      || !Number.isInteger(crop.width) || !Number.isInteger(crop.height)
      || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1
      || crop.x + crop.width > payload.context.sourceWidth
      || crop.y + crop.height > payload.context.sourceHeight) {
      throw new Error('局部重绘裁剪上下文无效，请重新生成')
    }
    const sourcePixels = await sharp(sourceResolved.bytes).toColourspace('srgb').ensureAlpha().raw().toBuffer()
    const maskPixels = await sharp(maskResolved.bytes).ensureAlpha().raw().toBuffer()
    let generatedPixels: Uint8Array = await sharp(generatedResolved.bytes)
      .resize(crop.width, crop.height, { fit: 'fill' })
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer()
    const referencePixels = await sharp(sourceResolved.bytes)
      .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer()
    const referenceRgb = await sharp(referencePixels, {
      raw: { width: crop.width, height: crop.height, channels: 4 },
    }).removeAlpha().raw().toBuffer()

    const matteRaw = new Uint8Array(crop.width * crop.height)
    for (let y = 0; y < crop.height; y += 1) {
      for (let x = 0; x < crop.width; x += 1) {
        const fullOffset = ((crop.y + y) * payload.context.sourceWidth + crop.x + x) * 4
        matteRaw[y * crop.width + x] = 255 - maskPixels[fullOffset + 3]
      }
    }
    const validMask = new Uint8Array(crop.width * crop.height)
    for (let pixel = 0; pixel < validMask.length; pixel += 1) {
      validMask[pixel] = matteRaw[pixel] <= 5 ? 255 : 0
    }

    const registrationExecution = await registerLocalRedrawFramesInWorker(
      { width: crop.width, height: crop.height, data: referenceRgb, components: 3, validMask },
      { width: crop.width, height: crop.height, data: generatedPixels, components: 4, validMask },
      settings.registrationQuality,
      settings.forceRegistration,
      { requestId },
    )
    const registration = registrationExecution.result
    generatedPixels = registrationExecution.movingData
    const safety = registration.success
      ? evaluateTransformSafety(registration.transform, crop.width, crop.height, matteRaw)
      : { safe: false, editableCoverage: 1, centerDisplacement: 0, reason: registration.diagnostics.reason }
    const registrationApplied = registration.success && safety.safe
    const aligned = registrationApplied
      ? warpPixels(generatedPixels, crop.width, crop.height, registration.transform)
      : generatedPixels
    const change = measureSelectionChange(referencePixels, aligned, matteRaw)
    if (change.selectedPixels === 0) throw new Error('遮罩没有可回贴的有效像素')
    if (change.opaqueCoverage < 0.98) throw new Error('模型结果没有完整覆盖重绘选区')
    if (change.meanAbsoluteDelta < 0.5 && change.changedFraction < 0.002) {
      throw new Error('模型结果在重绘选区内没有产生可见变化，请调整提示词后重试')
    }

    let matte: Uint8Array = matteRaw
    let matteChannels = 1
    if (settings.featherPixels > 0) {
      const feathered = await sharp(matteRaw, {
        raw: { width: crop.width, height: crop.height, channels: 1 },
      })
        .blur(Math.max(0.3, settings.featherPixels / 2))
        // Sharp 的 blur 会把灰度 raw 输出提升为 RGB；必须显式收回单通道，
        // 否则按单通道索引时会把遮罩错位到裁剪区的后半段。
        .extractChannel(0)
        .raw()
        .toBuffer({ resolveWithObject: true })
      matte = feathered.data
      matteChannels = feathered.info.channels
    }
    if (matteChannels !== 1 || matte.length !== matteRaw.length) {
      throw new Error(`羽化遮罩通道异常：期望 ${matteRaw.length} 字节单通道，实际 ${matte.length} 字节/${matteChannels} 通道`)
    }
    const appliedMatteBounds = toDocumentRect(
      nonZeroBounds(matte, crop.width, crop.height),
      crop,
    )
    for (let y = 0; y < crop.height; y += 1) {
      for (let x = 0; x < crop.width; x += 1) {
        const sourceOffset = ((crop.y + y) * payload.context.sourceWidth + crop.x + x) * 4
        const cropOffset = (y * crop.width + x) * 4
        blendMaskedPixel(sourcePixels, sourceOffset, aligned, cropOffset, matte[y * crop.width + x])
      }
    }
    const composedCropPixels = new Uint8Array(referencePixels.length)
    for (let y = 0; y < crop.height; y += 1) {
      for (let x = 0; x < crop.width; x += 1) {
        const sourceOffset = ((crop.y + y) * payload.context.sourceWidth + crop.x + x) * 4
        const cropOffset = (y * crop.width + x) * 4
        composedCropPixels.set(sourcePixels.subarray(sourceOffset, sourceOffset + 4), cropOffset)
      }
    }
    const composedChange = measureSelectionChange(referencePixels, composedCropPixels, matteRaw)
    const compositionChangeRetention = composedChange.meanAbsoluteDelta
      / Math.max(1e-8, change.meanAbsoluteDelta)
    const compositionChangedFractionRetention = composedChange.changedFraction
      / Math.max(1e-8, change.changedFraction)
    if (compositionChangeRetention < 0.02 && compositionChangedFractionRetention < 0.02) {
      throw new Error('局部重绘结果在回贴过程中丢失了模型修改，请查看回贴诊断日志')
    }
    const output = await sharp(sourcePixels, {
      raw: { width: payload.context.sourceWidth, height: payload.context.sourceHeight, channels: 4 },
    }).png().toBuffer()
    const source = await persistImageBytes(output, 'png')
    const diagnostics: RegistrationDiagnostics = {
      ...registration.diagnostics,
      compositionFallbackReason: registrationApplied ? undefined : safety.reason ?? '对齐未通过质量验收，使用原位回贴',
      selectionCoverage: safety.editableCoverage,
      selectedChangeFraction: change.changedFraction,
      selectedMeanAbsoluteDelta: change.meanAbsoluteDelta,
      composedSelectedChangeFraction: composedChange.changedFraction,
      composedSelectedMeanAbsoluteDelta: composedChange.meanAbsoluteDelta,
      compositionChangeRetention,
    }
    logger.info('局部重绘回贴完成', {
      event: 'image.local_redraw.compose.completed',
      requestId,
      context: {
        crop,
        matchedAspectRatio: payload.context.matchedAspectRatio,
        registrationApplied,
        registrationModel: registration.model,
        quality: settings.registrationQuality,
        confidence: registration.confidence,
        transform: registration.transform,
        diagnostics,
        maskProcessing: {
          sourceChannels: maskMetadata.channels,
          featheredChannels: matteChannels,
          featherPixels: settings.featherPixels,
          rawBytes: matteRaw.length,
          featheredBytes: matte.length,
          editableBounds: toDocumentRect(nonZeroBounds(matteRaw, crop.width, crop.height), crop),
          appliedBounds: appliedMatteBounds,
        },
        artifacts: {
          generated: describeLocalRedrawSource(payload.generatedSource),
          composite: describeLocalRedrawSource(source),
        },
        durationMs: Math.round(performance.now() - startedAt),
      },
    })
    return { source, registrationApplied, diagnostics }
  } catch (error) {
    logger.error('局部重绘回贴失败', {
      event: 'image.local_redraw.compose.failed',
      requestId,
      error: describeLocalRedrawError(error),
      context: { crop, durationMs: Math.round(performance.now() - startedAt) },
    })
    throw error
  }
}
