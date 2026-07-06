import {
  appendVideoFrameExport,
  cancelVideoFrameExport,
  finishVideoFrameExport,
  startVideoFrameExport,
} from '@/commands/video'
import { createLogger } from '@/core/logging'
import { QUICK_DOWNLOAD_SETTING_SPECS, readLocalStorageSettings } from '@/hooks/useLocalStorageSetting'
import { join, saveDialog, toDisplaySrc } from '@/platform/desktopApi'
import { cropDataUrlToAspectRatio } from './cameraStageAspectCrop'

const logger = createLogger('cameraStage.videoExport')

export type CameraStageVideoResolutionPreset = '720p' | '1080p'

export interface CameraStageVideoExportResult {
  mediaUrl: string
  mediaPath: string
  savedPath: string
  durationSeconds: number
  frameCount: number
  width: number
  height: number
}

export interface CameraStageVideoExportOptions {
  projectName: string
  cameraRatio: number
  backgroundColor: string
  fps: number
  durationSeconds: number
  resolutionPreset: CameraStageVideoResolutionPreset
  captureFrame: () => string | null
  seekFrame: (time: number) => Promise<void>
  onProgress: (progress: CameraStageVideoExportProgress) => void
  onSession: (sessionId: string | null) => void
  isCancelled: () => boolean
}

export interface CameraStageVideoExportProgress {
  phase: 'rendering' | 'encoding'
  doneFrames: number
  totalFrames: number
}

export function resolveVideoExportSize(
  ratio: number,
  preset: CameraStageVideoResolutionPreset,
): { width: number; height: number } {
  const shortEdge = preset === '1080p' ? 1080 : 720
  if (ratio >= 1) {
    return { width: makeEven(shortEdge * ratio), height: makeEven(shortEdge) }
  }
  return { width: makeEven(shortEdge), height: makeEven(shortEdge / ratio) }
}

export async function waitForCameraStageRender(frames = 2): Promise<void> {
  for (let index = 0; index < frames; index += 1) {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  }
}

export async function exportCameraStageVideo(
  options: CameraStageVideoExportOptions,
): Promise<CameraStageVideoExportResult | null> {
  const fileNameStem = buildFileName(options.projectName)
  const targetPath = await resolveVideoTargetPath(fileNameStem)
  if (!targetPath) return null

  const { width, height } = resolveVideoExportSize(options.cameraRatio, options.resolutionPreset)
  const frameCount = Math.max(1, Math.round(options.durationSeconds * options.fps))
  let sessionId: string | null = null

  try {
    const session = await startVideoFrameExport({
      frameCount,
      fps: options.fps,
      width,
      height,
      fileNameStem,
    })
    sessionId = session.sessionId
    options.onSession(sessionId)

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      throwIfCancelled(options)
      const time = Math.min(options.durationSeconds, frameIndex / options.fps)
      await options.seekFrame(time)
      await waitForCameraStageRender()
      const rawDataUrl = options.captureFrame()
      if (!rawDataUrl) throw new Error('未获取到当前帧画面')
      const dataUrl = await cropDataUrlToAspectRatio(
        rawDataUrl,
        options.cameraRatio,
        options.backgroundColor,
        { width, height },
      )
      await appendVideoFrameExport({ sessionId, frameIndex, dataUrl })
      options.onProgress({ phase: 'rendering', doneFrames: frameIndex + 1, totalFrames: frameCount })
    }

    throwIfCancelled(options)
    options.onProgress({ phase: 'encoding', doneFrames: frameCount, totalFrames: frameCount })
    const result = await finishVideoFrameExport({ sessionId, targetPath })
    sessionId = null
    options.onSession(null)
    return {
      mediaUrl: toDisplaySrc(result.mediaPath),
      ...result,
    }
  } catch (error) {
    if (sessionId) {
      await cancelVideoFrameExport(sessionId).catch((cancelError) => {
        logger.warn('[cameraStage] 取消视频导出清理失败', cancelError)
      })
    }
    options.onSession(null)
    if (options.isCancelled()) return null
    logger.error('[cameraStage] 动画视频导出失败', error)
    throw error
  }
}

async function resolveVideoTargetPath(fileNameStem: string): Promise<string | null> {
  const { enableQuickDownload, quickDownloadPath } = readLocalStorageSettings(QUICK_DOWNLOAD_SETTING_SPECS)
  const targetDir = quickDownloadPath.trim()
  if (enableQuickDownload && targetDir) {
    return await join(targetDir, `${fileNameStem}.mp4`)
  }

  const targetPath = await saveDialog({
    defaultPath: `${fileNameStem}.mp4`,
    filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
  })
  if (!targetPath) return null
  return ensureMp4Path(targetPath)
}

function buildFileName(projectName: string): string {
  const stem = projectName.trim() || '运镜控制'
  const stamp = new Date()
    .toISOString()
    .replace(/[:T]/g, '-')
    .replace(/\..+$/, '')
  return `${stem}-${stamp}`
}

function ensureMp4Path(targetPath: string): string {
  if (/\.mp4$/i.test(targetPath)) return targetPath
  if (/\.[^\\/]+$/.test(targetPath)) {
    return targetPath.replace(/\.[^\\/]+$/, '.mp4')
  }
  return `${targetPath}.mp4`
}

function makeEven(value: number): number {
  const rounded = Math.max(2, Math.round(value))
  return rounded % 2 === 0 ? rounded : rounded + 1
}

function throwIfCancelled(options: CameraStageVideoExportOptions): void {
  if (options.isCancelled()) throw new Error('视频导出已取消')
}
