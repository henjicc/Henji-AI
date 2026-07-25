import { performance } from 'node:perf_hooks'
import { createMainLogger } from '../logging'
import { loadSharp } from './sharp-loader'
import { resolveSourceBytes } from './source'

export type SharpDiffusionMode = 'black-diffusion' | 'white-diffusion' | 'glow'
export type SharpDiffusionPurpose = 'preview' | 'export'
export type SharpDiffusionFormat = 'png' | 'jpeg' | 'webp'

export interface SharpDiffusionFallbackRequest {
  requestId: string
  source: string
  purpose: SharpDiffusionPurpose
  format: SharpDiffusionFormat
  quality?: number
  maxPreviewPixels?: number
  params: Record<string, unknown>
}

export interface SharpDiffusionFallbackResult {
  bytes: Uint8Array
  width: number
  height: number
  format: SharpDiffusionFormat
  durationMs: number
  hardCancellationSupported: false
}

export interface SharpDiffusionFallbackCapabilities {
  available: boolean
  supportedParameters: readonly ['mode', 'strength', 'radiusPixels']
  unsupportedParameters: readonly [
    'thresholdEv',
    'softKneeEv',
    'power',
    'veil',
    'blackRetention',
    'highlightCompression',
    'chromaticSpread',
    'scatterDesaturation',
    'scaleWeights'
  ]
  maxPreviewPixels: number
  hardCancellationSupported: false
  supportedFormats: readonly ['png', 'jpeg', 'webp']
  reason?: string
}

export class UnsupportedSharpDiffusionParametersError extends Error {
  readonly code = 'unsupported-parameters'

  constructor(readonly parameters: string[]) {
    super(`Sharp 柔光降级不支持参数：${parameters.join(', ')}`)
    this.name = 'UnsupportedSharpDiffusionParametersError'
  }
}

const logger = createMainLogger('main.image_diffusion_fallback')
const SUPPORTED_PARAMETERS = ['mode', 'strength', 'radiusPixels'] as const
const UNSUPPORTED_PARAMETERS = [
  'thresholdEv',
  'softKneeEv',
  'power',
  'veil',
  'blackRetention',
  'highlightCompression',
  'chromaticSpread',
  'scatterDesaturation',
  'scaleWeights',
] as const
const DEFAULT_MAX_PREVIEW_PIXELS = 1_000_000

export async function probeSharpDiffusionFallback(): Promise<SharpDiffusionFallbackCapabilities> {
  try {
    await loadSharp()
    return {
      available: true,
      supportedParameters: SUPPORTED_PARAMETERS,
      unsupportedParameters: UNSUPPORTED_PARAMETERS,
      maxPreviewPixels: DEFAULT_MAX_PREVIEW_PIXELS,
      hardCancellationSupported: false,
      supportedFormats: ['png', 'jpeg', 'webp'],
    }
  } catch (error) {
    return {
      available: false,
      supportedParameters: SUPPORTED_PARAMETERS,
      unsupportedParameters: UNSUPPORTED_PARAMETERS,
      maxPreviewPixels: DEFAULT_MAX_PREVIEW_PIXELS,
      hardCancellationSupported: false,
      supportedFormats: ['png', 'jpeg', 'webp'],
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function renderSharpDiffusionFallback(
  request: SharpDiffusionFallbackRequest
): Promise<SharpDiffusionFallbackResult> {
  const startedAt = performance.now()
  logger.info('Sharp 柔光降级开始', {
    event: 'image_diffusion_fallback.render.start',
    context: {
      requestId: request.requestId,
      purpose: request.purpose,
      format: request.format,
    },
  })

  try {
    const parsed = parseParams(request.params)
    const { bytes: sourceBytes } = await resolveSourceBytes(request.source)
    const sharp = await loadSharp()
    const metadata = await sharp(sourceBytes).metadata()
    const sourceWidth = Math.max(1, metadata.width ?? 1)
    const sourceHeight = Math.max(1, metadata.height ?? 1)
    const outputSize = request.purpose === 'preview'
      ? fitWithinPixelBudget(
        sourceWidth,
        sourceHeight,
        request.maxPreviewPixels ?? DEFAULT_MAX_PREVIEW_PIXELS
      )
      : { width: sourceWidth, height: sourceHeight }

    const base = sharp(sourceBytes)
      .resize(outputSize.width, outputSize.height, { fit: 'fill' })
      .ensureAlpha()
    const scatter = await base
      .clone()
      .blur(parsed.radiusPixels)
      .linear(parsed.strength, 0)
      .png()
      .toBuffer()
    let pipeline = base.composite([{
      input: scatter,
      blend: parsed.mode === 'white-diffusion' ? 'soft-light' : 'screen',
    }])

    if (parsed.mode === 'white-diffusion') {
      pipeline = pipeline.linear(1, Math.round(8 * parsed.strength))
    }
    const output = await encode(pipeline, request.format, request.quality)
    const durationMs = performance.now() - startedAt
    logger.info('Sharp 柔光降级完成', {
      event: 'image_diffusion_fallback.render.completed',
      context: {
        requestId: request.requestId,
        purpose: request.purpose,
        format: request.format,
        width: outputSize.width,
        height: outputSize.height,
        durationMs,
      },
    })
    return {
      bytes: new Uint8Array(output),
      width: outputSize.width,
      height: outputSize.height,
      format: request.format,
      durationMs,
      hardCancellationSupported: false,
    }
  } catch (error) {
    logger.error('Sharp 柔光降级失败', {
      event: 'image_diffusion_fallback.render.failed',
      error,
      context: {
        requestId: request.requestId,
        purpose: request.purpose,
        format: request.format,
      },
    })
    throw error
  }
}

function parseParams(params: Record<string, unknown>): {
  mode: SharpDiffusionMode
  strength: number
  radiusPixels: number
} {
  const unsupported = Object.keys(params).filter(
    (key) => !SUPPORTED_PARAMETERS.includes(key as typeof SUPPORTED_PARAMETERS[number])
  )
  if (unsupported.length > 0) {
    throw new UnsupportedSharpDiffusionParametersError(unsupported)
  }
  const mode = params.mode ?? 'black-diffusion'
  const strength = params.strength ?? 0.25
  const radiusPixels = params.radiusPixels ?? 12
  if (!['black-diffusion', 'white-diffusion', 'glow'].includes(String(mode))) {
    throw new Error('Sharp 柔光降级 mode 非法')
  }
  if (typeof strength !== 'number' || !Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new Error('Sharp 柔光降级 strength 必须在 0～1 之间')
  }
  if (
    typeof radiusPixels !== 'number' ||
    !Number.isFinite(radiusPixels) ||
    radiusPixels < 0.3 ||
    radiusPixels > 1000
  ) {
    throw new Error('Sharp 柔光降级 radiusPixels 必须在 0.3～1000 之间')
  }
  return {
    mode: mode as SharpDiffusionMode,
    strength,
    radiusPixels,
  }
}

function fitWithinPixelBudget(
  width: number,
  height: number,
  maxPixels: number
): { width: number; height: number } {
  if (!Number.isFinite(maxPixels) || maxPixels <= 0) {
    throw new Error('Sharp 柔光降级 maxPreviewPixels 必须大于 0')
  }
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)))
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  }
}

async function encode(
  pipeline: import('sharp').Sharp,
  format: SharpDiffusionFormat,
  quality = 90
): Promise<Buffer> {
  const normalizedQuality = Math.max(1, Math.min(100, Math.round(quality)))
  if (format === 'png') return await pipeline.png().toBuffer()
  if (format === 'jpeg') return await pipeline.jpeg({ quality: normalizedQuality }).toBuffer()
  return await pipeline.webp({ quality: normalizedQuality }).toBuffer()
}
