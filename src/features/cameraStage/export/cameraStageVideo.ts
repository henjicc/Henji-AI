import {
  appendVideoFrameExport,
  cancelVideoFrameExport,
  finishVideoFrameExport,
  onVideoFrameExportProgress,
  startVideoFrameExport,
} from '@/commands/video'
import { createLogger } from '@/core/logging'
import { QUICK_DOWNLOAD_SETTING_SPECS, readLocalStorageSettings } from '@/hooks/useLocalStorageSetting'
import { join, saveDialog, toDisplaySrc } from '@/platform/desktopApi'

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
  fps: number
  durationSeconds: number
  resolutionPreset: CameraStageVideoResolutionPreset
  captureFrame: (targetSize: { width: number; height: number }) => Promise<Uint8Array | null>
  disposeCaptureFrame: () => void
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
  const unsubscribeProgress = onVideoFrameExportProgress((progress) => {
    if (progress.sessionId !== sessionId) return
    options.onProgress({
      phase: 'encoding',
      doneFrames: Math.min(progress.encodedFrames, frameCount),
      totalFrames: frameCount,
    })
  })

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
    logger.info('离屏视频导出开始', {
      event: 'camera_stage.video_export.start',
      taskId: sessionId,
      context: { width, height, frameCount, fps: options.fps },
    })

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      throwIfCancelled(options)
      const time = Math.min(options.durationSeconds, frameIndex / options.fps)
      await options.seekFrame(time)
      await waitForCameraStageRender()
      const bytes = await options.captureFrame({ width, height })
      if (!bytes) throw new Error('未获取到当前离屏视频帧')
      await appendVideoFrameExport({ sessionId, frameIndex, bytes })
      options.onProgress({ phase: 'rendering', doneFrames: frameIndex + 1, totalFrames: frameCount })
    }

    throwIfCancelled(options)
    options.onProgress({ phase: 'encoding', doneFrames: 0, totalFrames: frameCount })
    const result = await finishVideoFrameExport({ sessionId, targetPath })
    sessionId = null
    options.onSession(null)
    logger.info('离屏视频导出完成', {
      event: 'camera_stage.video_export.completed',
      taskId: session.sessionId,
      context: { width, height, frameCount },
    })
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
    if (options.isCancelled()) {
      logger.info('离屏视频导出已取消', {
        event: 'camera_stage.video_export.cancelled',
        taskId: sessionId ?? undefined,
      })
      return null
    }
    logger.error('离屏视频导出失败', error, {
      event: 'camera_stage.video_export.failed',
      taskId: sessionId ?? undefined,
    })
    throw error
  } finally {
    unsubscribeProgress()
    options.disposeCaptureFrame()
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
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    padTimePart(now.getMonth() + 1),
    padTimePart(now.getDate()),
    padTimePart(now.getHours()),
    padTimePart(now.getMinutes()),
    padTimePart(now.getSeconds()),
  ].join('-')
  return `${stem}-${stamp}`
}

function padTimePart(value: number): string {
  return String(value).padStart(2, '0')
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
