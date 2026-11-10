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
import type { StageRenderStyle } from '../domain/renderStyles'
import { yuv420pFrameByteLength } from '../scene/stageVideoFrameReader'

const logger = createLogger('cameraStage.videoExport')

/*
 * 逐帧流水：seek 与渲染提交在渲染线程同步完成，显卡读回、IPC 复制与编码都在别处进行。
 * 最多 READBACK_DEPTH 帧在等读回、APPEND_DEPTH 帧在等编码器接收，渲染线程只在队列满时等待；
 * 深度只需盖住各段的抖动，再深只会多占内存（1080p 每帧约 3MB）。
 */
const READBACK_DEPTH = 3
const APPEND_DEPTH = 3

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
  /** 本次导出会实际参与渲染的机位数量（由导出入口按渲染机位时间表统计） */
  renderCameraCount: number
  /** 参与机位是否超过一台；与 renderCameraCount 同源，供日志检索使用 */
  isMultiCamera: boolean
  /** 旧镜头参考或异常写入导致的画幅不一致防御标记；不阻断导出，但必须留下告警日志 */
  hasInconsistentCameraAspectRatio: boolean
  fps: number
  durationSeconds: number
  resolutionPreset: CameraStageVideoResolutionPreset
  /** 本次成片的渲染方式；只进日志，画面本身由截帧管线按镜头参考设置成像 */
  renderStyle: StageRenderStyle
  /**
   * 同步提交当前画面的离屏渲染，返回的 Promise 在 yuv420p 帧（自上而下）写入 target 后兑现；
   * 兑现前导出流程不会复用 target，也会继续 seek 并提交后续帧。
   */
  captureFrame: (request: { width: number; height: number; target: Uint8Array }) => Promise<Uint8Array | null>
  disposeCaptureFrame: () => void
  seekFrame: (time: number) => Promise<void>
  onProgress: (progress: CameraStageVideoExportProgress) => void
  onSession: (sessionId: string | null) => void
  isCancelled: () => boolean
  /** 画布输出只写入应用媒体目录，不打开系统保存对话框。 */
  saveToLocal?: boolean
}

export interface CameraStageVideoExportProgress {
  phase: 'rendering' | 'encoding'
  doneFrames: number
  totalFrames: number
}

function resolveVideoExportSize(
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
  const targetPath = options.saveToLocal === false ? null : await resolveVideoTargetPath(fileNameStem)
  if (options.saveToLocal !== false && !targetPath) return null

  const { width, height } = resolveVideoExportSize(options.cameraRatio, options.resolutionPreset)
  const frameCount = Math.max(1, Math.round(options.durationSeconds * options.fps))
  const exportStartedAt = performance.now()
  let seekElapsedMs = 0
  let captureElapsedMs = 0
  let readbackWaitMs = 0
  let appendWaitMs = 0
  let sessionId: string | null = null
  const readbacks: Promise<Uint8Array | null>[] = []
  const appends: Promise<unknown>[] = []
  let renderingComplete = false
  const unsubscribeProgress = onVideoFrameExportProgress((progress) => {
    if (progress.sessionId !== sessionId || !renderingComplete) return
    options.onProgress({
      phase: 'encoding',
      doneFrames: Math.min(progress.encodedFrames, frameCount),
      totalFrames: frameCount,
    })
  })

  try {
    const session = await startVideoFrameExport({
      pixelFormat: 'yuv420p',
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
      context: {
        width,
        height,
        frameCount,
        fps: options.fps,
        renderStyle: options.renderStyle,
        renderCameraCount: options.renderCameraCount,
        isMultiCamera: options.isMultiCamera,
      },
    })
    if (options.hasInconsistentCameraAspectRatio) {
      logger.warn('检测到参与导出的摄像机画幅不一致，按首摄像机画幅继续导出', {
        event: 'camera_stage.video_export.aspect_ratio_inconsistent',
        taskId: sessionId,
        context: {
          renderCameraCount: options.renderCameraCount,
          isMultiCamera: options.isMultiCamera,
          cameraRatio: options.cameraRatio,
        },
      })
    }

    const frameBuffers = Array.from({ length: READBACK_DEPTH }, () => new Uint8Array(yuv420pFrameByteLength(width, height)))
    let appendedFrames = 0
    // 按帧序取最早的读回交给主进程；append 调用当下就复制了数据，帧缓冲随即可以给后面的帧复用。
    const appendOldestFrame = async (): Promise<void> => {
      const readbackStartedAt = performance.now()
      const bytes = await readbacks.shift()
      readbackWaitMs += performance.now() - readbackStartedAt
      if (!bytes) throw new Error('未获取到当前离屏视频帧')
      appends.push(quiet(appendVideoFrameExport({ sessionId: session.sessionId, frameIndex: appendedFrames, bytes })))
      appendedFrames += 1
      options.onProgress({ phase: 'rendering', doneFrames: appendedFrames, totalFrames: frameCount })
      if (appends.length >= APPEND_DEPTH) {
        const appendStartedAt = performance.now()
        await appends.shift()
        appendWaitMs += performance.now() - appendStartedAt
      }
    }

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      throwIfCancelled(options)
      const time = Math.min(options.durationSeconds, frameIndex / options.fps)
      const seekStartedAt = performance.now()
      await options.seekFrame(time)
      seekElapsedMs += performance.now() - seekStartedAt
      const captureStartedAt = performance.now()
      readbacks.push(quiet(options.captureFrame({ width, height, target: frameBuffers[frameIndex % READBACK_DEPTH] })))
      captureElapsedMs += performance.now() - captureStartedAt
      if (readbacks.length >= READBACK_DEPTH) await appendOldestFrame()
    }
    while (readbacks.length > 0) {
      throwIfCancelled(options)
      await appendOldestFrame()
    }
    const appendStartedAt = performance.now()
    while (appends.length > 0) await appends.shift()
    appendWaitMs += performance.now() - appendStartedAt

    throwIfCancelled(options)
    const renderingElapsedMs = performance.now() - exportStartedAt
    renderingComplete = true
    options.onProgress({ phase: 'encoding', doneFrames: 0, totalFrames: frameCount })
    const result = await finishVideoFrameExport({ sessionId, targetPath: targetPath ?? undefined })
    sessionId = null
    options.onSession(null)
    logger.info('离屏视频导出完成', {
      event: 'camera_stage.video_export.completed',
      taskId: session.sessionId,
      context: {
        width,
        height,
        frameCount,
        elapsedMs: Math.round(performance.now() - exportStartedAt),
        renderingElapsedMs: Math.round(renderingElapsedMs),
        framesPerSecond: Math.round(frameCount / (renderingElapsedMs / 1000)),
        // seek 与渲染提交在渲染线程上实耗；读回、编码两项是渲染线程排队等待的时间，与前两项不重叠
        averageSeekMs: roundMs(seekElapsedMs / frameCount),
        averageCaptureMs: roundMs(captureElapsedMs / frameCount),
        averageReadbackWaitMs: roundMs(readbackWaitMs / frameCount),
        averageAppendWaitMs: roundMs(appendWaitMs / frameCount),
      },
    })
    return {
      mediaUrl: toDisplaySrc(result.mediaPath),
      ...result,
    }
  } catch (error) {
    if (sessionId) {
      // 先结束会话再等在途帧：编码器退出后，还在等管道的 append 会随之失败，不会一直挂着。
      await cancelVideoFrameExport(sessionId).catch((cancelError) => {
        logger.warn('取消视频导出清理失败', { event: 'camera_stage.video_export.cancel_failed', taskId: sessionId ?? undefined, error: cancelError })
      })
    }
    await Promise.allSettled([...readbacks, ...appends])
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
  const stem = projectName.trim() || '3D 镜头参考'
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

/** 在途的读回与 append 可能在被 await 之前就失败；先挂上空处理，避免记成未处理的拒绝，原 Promise 照常抛错。 */
function quiet<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined)
  return promise
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10
}

function throwIfCancelled(options: CameraStageVideoExportOptions): void {
  if (options.isCancelled()) throw new Error('视频导出已取消')
}
