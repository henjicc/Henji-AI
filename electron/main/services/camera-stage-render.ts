import { BrowserWindow, powerSaveBlocker, webContents } from 'electron'
import path from 'node:path'
import { APP_WINDOW_BACKGROUND_HEX } from '../../../src/core/theme/colorTokens'
import { cleanupAllVideoFrameExports } from './video/frame-export'
import { createMainLogger } from './logging/main-logger'

export type CameraStageRenderResolutionPreset = '720p' | '1080p'
export type CameraStageRenderOutputKind = 'image' | 'video'

export interface CameraStageRenderRequestDto {
  requestId: string
  nodeId: string
  projectId: string
  resolutionPreset: CameraStageRenderResolutionPreset
  outputKind: CameraStageRenderOutputKind
  selectedTimeSec?: number
}

export interface CameraStageImageRenderResultDto {
  kind: 'image'
  mediaUrl: string
  mediaPath: string
  savedPath: string
  width: number
  height: number
  aspectRatio: string
  selectedTimeSec: number
}

export interface CameraStageVideoRenderResultDto {
  kind: 'video'
  mediaUrl: string
  mediaPath: string
  savedPath: string
  durationSeconds: number
  frameCount: number
  width: number
  height: number
}

export type CameraStageRenderResultDto = CameraStageImageRenderResultDto | CameraStageVideoRenderResultDto

export type CameraStageRenderEventDto =
  | {
      type: 'progress'
      requestId: string
      nodeId: string
      phase: 'preparing' | 'rendering' | 'encoding'
      progress: number
    }
  | {
      type: 'completed'
      requestId: string
      nodeId: string
      result: CameraStageRenderResultDto
    }
  | {
      type: 'failed'
      requestId: string
      nodeId: string
      message: string
    }
  | {
      type: 'cancelled'
      requestId: string
      nodeId: string
    }

interface QueuedRenderTask extends CameraStageRenderRequestDto {
  ownerWebContentsId: number
}

const logger = createMainLogger('main.camera-stage-render')
const queue: QueuedRenderTask[] = []
let workerWindow: BrowserWindow | null = null
let workerReady = false
let activeTask: QueuedRenderTask | null = null
let powerSaveBlockerId: number | null = null
let workerReadyTimer: NodeJS.Timeout | null = null
let activeTaskTimer: NodeJS.Timeout | null = null

const IMAGE_RENDER_INACTIVITY_TIMEOUT_MS = 45_000
const VIDEO_RENDER_INACTIVITY_TIMEOUT_MS = 120_000

function clearWorkerReadyTimer(): void {
  if (!workerReadyTimer) return
  clearTimeout(workerReadyTimer)
  workerReadyTimer = null
}

function clearActiveTaskTimer(): void {
  if (!activeTaskTimer) return
  clearTimeout(activeTaskTimer)
  activeTaskTimer = null
}

function failQueuedTasks(message: string): void {
  for (const task of queue.splice(0, queue.length)) {
    sendToOwner(task, {
      type: 'failed',
      requestId: task.requestId,
      nodeId: task.nodeId,
      message,
    })
  }
}

function sendToOwner(task: QueuedRenderTask, event: CameraStageRenderEventDto): void {
  const owner = webContents.fromId(task.ownerWebContentsId)
  if (!owner || owner.isDestroyed()) return
  owner.send('cameraStageRender:event', event)
}

function startPowerSaveBlocker(): void {
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) return
  powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension')
}

function stopPowerSaveBlocker(): void {
  if (powerSaveBlockerId === null) return
  if (powerSaveBlocker.isStarted(powerSaveBlockerId)) powerSaveBlocker.stop(powerSaveBlockerId)
  powerSaveBlockerId = null
}

function loadWorkerRenderer(win: BrowserWindow): void {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (!rendererUrl) {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      search: 'view=camera-stage-render',
    })
    return
  }
  const url = new URL(rendererUrl)
  url.searchParams.set('view', 'camera-stage-render')
  void win.loadURL(url.toString())
}

function failActiveTask(message: string): void {
  const task = activeTask
  if (!task) return
  clearActiveTaskTimer()
  sendToOwner(task, {
    type: 'failed',
    requestId: task.requestId,
    nodeId: task.nodeId,
    message,
  })
  logger.error('隐藏渲染任务失败', {
    event: 'camera_stage.background_render.failed',
    requestId: task.requestId,
    context: { nodeId: task.nodeId, projectId: task.projectId, message },
  })
  activeTask = null
  stopPowerSaveBlocker()
}

function recycleWorkerAfterTaskFailure(message: string, reason: string): void {
  failActiveTask(message)
  workerReady = false
  void cleanupAllVideoFrameExports(reason)
  const win = workerWindow
  if (win && !win.isDestroyed()) win.destroy()
}

function armActiveTaskTimer(task: QueuedRenderTask): void {
  clearActiveTaskTimer()
  const timeoutMs = task.outputKind === 'image'
    ? IMAGE_RENDER_INACTIVITY_TIMEOUT_MS
    : VIDEO_RENDER_INACTIVITY_TIMEOUT_MS
  activeTaskTimer = setTimeout(() => {
    if (activeTask?.requestId !== task.requestId) return
    const outputLabel = task.outputKind === 'image' ? '图片' : '视频'
    recycleWorkerAfterTaskFailure(
      `${outputLabel}渲染长时间没有进展，已自动结束，请重试`,
      'camera_stage_render_inactivity_timeout',
    )
  }, timeoutMs)
}

function ensureWorkerWindow(): BrowserWindow {
  if (workerWindow && !workerWindow.isDestroyed()) return workerWindow

  workerReady = false
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    frame: false,
    skipTaskbar: true,
    backgroundColor: APP_WINDOW_BACKGROUND_HEX,
    title: '痕迹AI - 后台渲染',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })
  win.webContents.setAudioMuted(true)
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    const message = `隐藏渲染页面加载失败（${errorCode}）：${errorDescription}`
    logger.error(message, { event: 'camera_stage.background_render.worker_load_failed' })
    failQueuedTasks(message)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    failActiveTask(`隐藏渲染进程异常退出：${details.reason}`)
    void cleanupAllVideoFrameExports('camera_stage_render_process_gone')
    if (!win.isDestroyed()) win.destroy()
  })
  win.on('closed', () => {
    if (workerWindow !== win) return
    clearWorkerReadyTimer()
    workerWindow = null
    workerReady = false
    failActiveTask('隐藏渲染窗口已关闭')
    if (queue.length > 0) {
      setTimeout(() => {
        ensureWorkerWindow()
        dispatchNextTask()
      }, 0)
    }
  })
  workerWindow = win
  loadWorkerRenderer(win)
  workerReadyTimer = setTimeout(() => {
    if (workerWindow !== win || workerReady || win.isDestroyed()) return
    const message = '隐藏渲染窗口初始化超时'
    logger.error(message, { event: 'camera_stage.background_render.worker_ready_timeout' })
    failQueuedTasks(message)
    win.destroy()
  }, 30_000)
  return win
}

function dispatchNextTask(): void {
  if (activeTask || !workerReady || queue.length === 0) return
  const win = ensureWorkerWindow()
  const task = queue.shift()
  if (!task) return
  activeTask = task
  armActiveTaskTimer(task)
  startPowerSaveBlocker()
  logger.info('隐藏渲染任务开始', {
    event: 'camera_stage.background_render.start',
    requestId: task.requestId,
    context: { nodeId: task.nodeId, projectId: task.projectId, outputKind: task.outputKind },
  })
  win.webContents.send('cameraStageRender:workerJob', {
    requestId: task.requestId,
    nodeId: task.nodeId,
    projectId: task.projectId,
    resolutionPreset: task.resolutionPreset,
    outputKind: task.outputKind,
    selectedTimeSec: task.selectedTimeSec,
  } satisfies CameraStageRenderRequestDto)
}

export function startCameraStageRenderTask(
  request: CameraStageRenderRequestDto,
  ownerWebContentsId: number,
): { accepted: true } {
  const duplicate = activeTask?.requestId === request.requestId
    || queue.some((task) => task.requestId === request.requestId)
  if (duplicate) throw new Error(`Camera stage render request already exists: ${request.requestId}`)

  const task: QueuedRenderTask = { ...request, ownerWebContentsId }
  queue.push(task)
  sendToOwner(task, {
    type: 'progress',
    requestId: task.requestId,
    nodeId: task.nodeId,
    phase: 'preparing',
    progress: 0,
  })
  ensureWorkerWindow()
  dispatchNextTask()
  return { accepted: true }
}

export function cancelCameraStageRenderTask(requestId: string): void {
  const queuedIndex = queue.findIndex((task) => task.requestId === requestId)
  if (queuedIndex >= 0) {
    const [task] = queue.splice(queuedIndex, 1)
    sendToOwner(task, { type: 'cancelled', requestId: task.requestId, nodeId: task.nodeId })
    return
  }
  if (activeTask?.requestId !== requestId) return
  workerWindow?.webContents.send('cameraStageRender:workerCancel', requestId)
}

export function markCameraStageRenderWorkerReady(senderWebContentsId: number): void {
  const win = workerWindow
  if (!win || win.isDestroyed() || win.webContents.id !== senderWebContentsId) {
    throw new Error('Camera stage render worker ready signal came from an unexpected renderer')
  }
  workerReady = true
  clearWorkerReadyTimer()
  logger.info('隐藏渲染窗口已就绪', { event: 'camera_stage.background_render.worker_ready' })
  dispatchNextTask()
}

export function handleCameraStageRenderWorkerEvent(
  event: CameraStageRenderEventDto,
  senderWebContentsId: number,
): void {
  const win = workerWindow
  if (!win || win.isDestroyed() || win.webContents.id !== senderWebContentsId) {
    throw new Error('Camera stage render worker event came from an unexpected renderer')
  }
  const task = activeTask
  if (!task || task.requestId !== event.requestId || task.nodeId !== event.nodeId) {
    throw new Error('Camera stage render worker event does not match the active task')
  }
  if (event.type === 'completed' && event.result.kind !== task.outputKind) {
    recycleWorkerAfterTaskFailure(
      '渲染结果类型与请求不一致，已自动结束，请重试',
      'camera_stage_render_result_kind_mismatch',
    )
    return
  }
  sendToOwner(task, event)
  if (event.type === 'progress') {
    armActiveTaskTimer(task)
    return
  }

  if (event.type === 'completed') {
    logger.info('隐藏渲染任务完成', {
      event: 'camera_stage.background_render.completed',
      requestId: task.requestId,
      context: {
        nodeId: task.nodeId,
        projectId: task.projectId,
        outputKind: event.result.kind,
        frameCount: event.result.kind === 'video' ? event.result.frameCount : 1,
      },
    })
  } else if (event.type === 'cancelled') {
    logger.info('隐藏渲染任务已取消', {
      event: 'camera_stage.background_render.cancelled',
      requestId: task.requestId,
      context: { nodeId: task.nodeId, projectId: task.projectId },
    })
  } else {
    logger.error('隐藏渲染任务失败', {
      event: 'camera_stage.background_render.failed',
      requestId: task.requestId,
      context: { nodeId: task.nodeId, projectId: task.projectId, message: event.message },
    })
  }
  workerReady = false
  clearActiveTaskTimer()
  activeTask = null
  stopPowerSaveBlocker()
}

export function closeCameraStageRenderWindow(): void {
  clearWorkerReadyTimer()
  clearActiveTaskTimer()
  queue.splice(0, queue.length)
  activeTask = null
  stopPowerSaveBlocker()
  if (workerWindow && !workerWindow.isDestroyed()) workerWindow.close()
  workerWindow = null
  workerReady = false
}
