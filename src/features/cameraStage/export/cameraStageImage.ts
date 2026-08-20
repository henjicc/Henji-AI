import { createLogger } from '@/core/logging'
import { persistSceneScreenshot, type CameraStageFrameResult } from './cameraStageScreenshot'
import type { StageCaptureFn } from '../scene/StageCaptureBridge'

const logger = createLogger('cameraStage.imageExport')

export interface CameraStageImageCaptureResult {
  dataUrl: string
  width: number
  height: number
}

export interface CameraStageImageExportResult extends CameraStageImageCaptureResult, CameraStageFrameResult {}

export function resolveCameraStageImageSize(
  ratio: number,
  shortEdge = 720,
): { width: number; height: number } {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9
  const safeShortEdge = Math.max(2, Math.round(shortEdge))
  return safeRatio >= 1
    ? { width: Math.max(2, Math.round(safeShortEdge * safeRatio)), height: safeShortEdge }
    : { width: safeShortEdge, height: Math.max(2, Math.round(safeShortEdge / safeRatio)) }
}

/** WebGL readPixels 从左下角开始；Canvas ImageData 从左上角开始。 */
export function flipRgbaRows(
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray {
  const rowBytes = width * 4
  if (pixels.byteLength !== rowBytes * height) {
    throw new Error('3D 镜头静态帧像素长度与目标尺寸不一致')
  }
  const flipped = new Uint8ClampedArray(pixels.byteLength)
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = (height - row - 1) * rowBytes
    flipped.set(pixels.subarray(sourceOffset, sourceOffset + rowBytes), row * rowBytes)
  }
  return flipped
}

export function rgbaToPngDataUrl(
  pixels: Uint8Array,
  width: number,
  height: number,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('3D 镜头静态帧编码画布初始化失败')
  const imageData = context.createImageData(width, height)
  imageData.data.set(flipRgbaRows(pixels, width, height))
  context.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

export async function captureCameraStageImageDataUrl(
  capture: StageCaptureFn,
  cameraRatio: number,
  requestId: string = crypto.randomUUID(),
  shortEdge = 720,
): Promise<CameraStageImageCaptureResult> {
  const { width, height } = resolveCameraStageImageSize(cameraRatio, shortEdge)
  logger.info('3D 镜头静态帧捕获开始', {
    event: 'camera_stage.image_capture.start',
    requestId,
    context: { width, height },
  })
  try {
    const pixels = await capture({ width, height })
    if (!pixels) throw new Error('未获取到 3D 镜头静态帧')
    const dataUrl = rgbaToPngDataUrl(pixels, width, height)
    logger.info('3D 镜头静态帧捕获完成', {
      event: 'camera_stage.image_capture.completed',
      requestId,
      context: { width, height },
    })
    return { dataUrl, width, height }
  } catch (error) {
    logger.error('3D 镜头静态帧捕获失败', error, {
      event: 'camera_stage.image_capture.failed',
      requestId,
      context: { width, height },
    })
    throw error
  }
}

export async function exportCameraStageImage(
  capture: StageCaptureFn,
  cameraRatio: number,
  requestId: string = crypto.randomUUID(),
  shortEdge = 720,
): Promise<CameraStageImageExportResult> {
  logger.info('3D 镜头静态帧持久化开始', {
    event: 'camera_stage.image_persist.start',
    requestId,
  })
  try {
    const captured = await captureCameraStageImageDataUrl(capture, cameraRatio, requestId, shortEdge)
    const persisted = await persistSceneScreenshot(captured.dataUrl)
    logger.info('3D 镜头静态帧持久化完成', {
      event: 'camera_stage.image_persist.completed',
      requestId,
      context: { width: captured.width, height: captured.height },
    })
    return { ...captured, ...persisted }
  } catch (error) {
    logger.error('3D 镜头静态帧持久化失败', error, {
      event: 'camera_stage.image_persist.failed',
      requestId,
    })
    throw error
  }
}
