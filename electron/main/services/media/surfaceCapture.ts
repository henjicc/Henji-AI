import { BrowserWindow, type WebContents } from 'electron'

import {
  surfaceCaptureRequestSchema,
  surfaceCaptureResultSchema,
  type SurfaceCaptureRequest,
  type SurfaceCaptureResult,
} from '../../../../src/core/assistant/surfaceObservation'
import { createMainLogger } from '../logging'
import { loadSharp } from '../image/sharp-loader'

const logger = createMainLogger('main.surface_observation')
const MAX_OUTPUT_EDGE = 1_600
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

export async function captureApplicationSurface(
  sender: WebContents,
  input: SurfaceCaptureRequest
): Promise<SurfaceCaptureResult> {
  const request = surfaceCaptureRequestSchema.parse(input)
  if (sender.isDestroyed()) throw new Error('SURFACE_CAPTURE_UNAVAILABLE')
  const window = BrowserWindow.fromWebContents(sender)
  if (!window || window.isDestroyed() || window.webContents.id !== sender.id) {
    throw new Error('SURFACE_CAPTURE_SENDER_INVALID')
  }
  const [contentWidth, contentHeight] = window.getContentSize()
  if (
    request.rect.x + request.rect.width > contentWidth
    || request.rect.y + request.rect.height > contentHeight
  ) {
    throw new Error('SURFACE_CAPTURE_OUT_OF_BOUNDS')
  }
  logger.info('应用表面观察截图开始', {
    event: 'surface_observation.capture.start',
    context: {
      surfaceId: request.surfaceId,
      width: request.rect.width,
      height: request.rect.height,
      maskPolicyId: request.maskPolicyId,
      maskCount: request.masks.length,
    },
  })
  const nativeImage = await sender.capturePage(request.rect)
  if (nativeImage.isEmpty()) throw new Error('SURFACE_CAPTURE_EMPTY')
  const source = nativeImage.toPNG()
  const metadata = nativeImage.getSize()
  const scaleX = metadata.width / request.rect.width
  const scaleY = metadata.height / request.rect.height
  const sharp = await loadSharp()
  const composites = request.masks.map((mask) => {
    const width = Math.max(1, Math.ceil(mask.width * scaleX))
    const height = Math.max(1, Math.ceil(mask.height * scaleY))
    return {
      input: {
        create: { width, height, channels: 4 as const, background: { r: 24, g: 24, b: 27, alpha: 1 } },
      },
      left: Math.max(0, Math.floor(mask.x * scaleX)),
      top: Math.max(0, Math.floor(mask.y * scaleY)),
    }
  })
  const bytes = await sharp(source)
    .composite(composites)
    .resize(MAX_OUTPUT_EDGE, MAX_OUTPUT_EDGE, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer()
  if (bytes.byteLength > MAX_OUTPUT_BYTES) throw new Error('SURFACE_CAPTURE_TOO_LARGE')
  const outputMetadata = await sharp(bytes).metadata()
  const result = surfaceCaptureResultSchema.parse({
    dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    width: outputMetadata.width,
    height: outputMetadata.height,
    maskedRegionCount: request.masks.length,
  })
  logger.info('应用表面观察截图完成', {
    event: 'surface_observation.capture.completed',
    context: {
      surfaceId: request.surfaceId,
      width: result.width,
      height: result.height,
      byteLength: bytes.byteLength,
      maskCount: result.maskedRegionCount,
    },
  })
  return result
}
