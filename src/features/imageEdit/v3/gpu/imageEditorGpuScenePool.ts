import { createLogger } from '@/core/logging'
import { isUiInspectionGpuInitializationFailure } from '@/platform/runtime'
import {
  IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
  IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3,
  type ImageEditorGpuSceneWorkerEventV3,
  type ImageEditorGpuSceneWorkerFactoryV3,
  type ImageEditorGpuSceneWorkerPortV3,
  type ImageEditorGpuSceneWorkerRequestV3,
  type ImageEditorGpuSceneWorkerWarmth,
} from './imageEditorGpuSceneProtocolV3'

const logger = createLogger('features.image_edit.v3.gpu_scene')

function createImageEditorGpuSceneWorker(): ImageEditorGpuSceneWorkerPortV3 {
  return new Worker(
    new URL('./imageEditorGpuScene.worker.ts', import.meta.url),
    { type: 'module', name: 'image-editor-gpu-scene-v3' },
  )
}

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt)
}

/**
 * 待命池里的渲染线程。归还时线程清掉上一个会话的状态后回 released；
 * 在此之前发出的事件都属于上一个会话，一律丢弃，领用它的新会话看不到。
 */
class ImageEditorGpuScenePooledWorker implements ImageEditorGpuSceneWorkerPortV3 {
  onmessage: ImageEditorGpuSceneWorkerPortV3['onmessage'] = null
  onerror: ImageEditorGpuSceneWorkerPortV3['onerror'] = null
  warmth: ImageEditorGpuSceneWorkerWarmth = 'cold'
  private pendingReleases = 0
  private warmStartedAt: number | null = null
  private failed = false

  constructor(
    private readonly pool: ImageEditorGpuScenePool,
    private readonly worker: ImageEditorGpuSceneWorkerPortV3,
  ) {
    worker.onmessage = (message) => this.deliver(message)
    worker.onerror = (event) => {
      this.failed = true
      if (this.warmStartedAt !== null) this.finishWarm(event.message || 'GPU 渲染线程启动失败')
      this.pool.discard(this)
      this.onerror?.(event)
    }
  }

  get usable(): boolean {
    return !this.failed
  }

  postMessage(message: ImageEditorGpuSceneWorkerRequestV3, transfer?: Transferable[]): void {
    this.worker.postMessage(message, transfer)
  }

  terminate(): void {
    this.worker.postMessage({ type: 'dispose' })
    this.worker.terminate()
    this.worker.onmessage = null
    this.worker.onerror = null
  }

  release(): void {
    this.onmessage = null
    this.onerror = null
    this.pool.giveBack(this)
  }

  warm(): void {
    this.warmth = 'warming'
    this.warmStartedAt = performance.now()
    logger.info('开始预热图片编辑 GPU 渲染线程', { event: 'image_editor_v3.gpu_scene.prewarm.start' })
    this.worker.postMessage({
      type: 'warm',
      protocolVersion: IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3,
      memoryBudgetBytes: IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
    })
  }

  /** 让线程结束当前会话；released 回来之前到达的事件都不再转交。 */
  drain(): void {
    this.pendingReleases += 1
    this.warmth = 'warming'
    this.worker.postMessage({ type: 'release' })
  }

  private deliver(message: MessageEvent<ImageEditorGpuSceneWorkerEventV3>): void {
    const event = message.data
    if (event.type === 'warmed') {
      this.finishWarm(event.error)
      return
    }
    if (event.type === 'released') {
      this.pendingReleases = Math.max(0, this.pendingReleases - 1)
      if (this.pendingReleases === 0) this.warmth = event.deviceReady ? 'ready' : 'cold'
      if (event.deviceLossHistory) this.pool.replace(this)
      return
    }
    // 待命期间设备丢失：线程里已没有设备，重新预热，领用前不能再标为 ready。
    if (event.type === 'device-lost' && !this.onmessage && this.pendingReleases === 0) {
      this.warm()
      return
    }
    if (this.pendingReleases > 0 || !this.onmessage) {
      if (event.type === 'frame-ready') event.bitmap.close()
      return
    }
    this.onmessage(message)
  }

  private finishWarm(error: string | undefined): void {
    if (this.warmStartedAt === null) return
    const durationMs = elapsedSince(this.warmStartedAt)
    this.warmStartedAt = null
    if (this.warmth === 'warming') this.warmth = error ? 'failed' : 'ready'
    if (error) {
      logger.warn('图片编辑 GPU 渲染线程预热失败', {
        event: 'image_editor_v3.gpu_scene.prewarm.failed',
        context: { durationMs, reason: error },
      })
      return
    }
    logger.info('完成预热图片编辑 GPU 渲染线程', {
      event: 'image_editor_v3.gpu_scene.prewarm.completed',
      context: { durationMs },
    })
  }
}

/**
 * 图片编辑 GPU 渲染线程的待命池：最多留一个已加载模块、已申请设备的线程。
 * 打开文档直接领用；关闭文档时归还待命而不是销毁，已有待命线程时才结束它。
 */
export class ImageEditorGpuScenePool {
  private standby: ImageEditorGpuScenePooledWorker | null = null
  private leased = 0
  private disposed = false

  constructor(private readonly createWorker: ImageEditorGpuSceneWorkerFactoryV3) {}

  /**
   * 有会话正在用线程时不预热：它关闭时会把线程归还成待命；
   * 同时再起一个线程只会和正在打开的文档抢模块加载与设备申请，并多占一份显存。
   */
  prewarm(): void {
    if (this.disposed || this.standby || this.leased > 0) return
    const worker = new ImageEditorGpuScenePooledWorker(this, this.createWorker())
    worker.warm()
    this.standby = worker
  }

  acquire(): ImageEditorGpuSceneWorkerPortV3 {
    const worker = this.standby ?? new ImageEditorGpuScenePooledWorker(this, this.createWorker())
    this.standby = null
    this.leased += 1
    logger.info('领用图片编辑 GPU 渲染线程', {
      event: 'image_editor_v3.gpu_scene.worker_acquired',
      context: { warm: worker.warmth === 'ready', warmth: worker.warmth },
    })
    return worker
  }

  giveBack(worker: ImageEditorGpuScenePooledWorker): void {
    this.leased = Math.max(0, this.leased - 1)
    const kept = !this.disposed && !this.standby && worker.usable
    logger.debug('归还图片编辑 GPU 渲染线程', {
      event: 'image_editor_v3.gpu_scene.worker_released',
      context: { kept },
    })
    if (!kept) {
      worker.terminate()
      return
    }
    worker.drain()
    this.standby = worker
  }

  discard(worker: ImageEditorGpuScenePooledWorker): void {
    if (this.standby !== worker) return
    this.standby = null
    worker.terminate()
  }

  /** 待命线程带着设备丢失历史或冷却期：结束它，换一个新线程预热。 */
  replace(worker: ImageEditorGpuScenePooledWorker): void {
    if (this.standby !== worker) return
    this.discard(worker)
    this.prewarm()
  }

  /** 结束待命线程；仍在使用的线程归还时直接结束。 */
  dispose(): void {
    this.disposed = true
    if (this.standby) this.discard(this.standby)
  }
}

const pool = new ImageEditorGpuScenePool(createImageEditorGpuSceneWorker)
// 开发版热更新会重新执行本模块：旧池的待命线程跑的是旧代码，结束它，免得被领用或泄漏。
import.meta.hot?.dispose(() => pool.dispose())

const LAST_USED_STORAGE_KEY = 'henji.imageEditor.gpuScene.lastUsedAt'
// 这段时间内用过图片编辑，启动后才预热；从不用的人不常驻渲染线程和 GPU 设备。
const RECENT_USE_MS = 7 * 24 * 60 * 60 * 1000

function rememberUse(): void {
  try {
    localStorage.setItem(LAST_USED_STORAGE_KEY, String(Date.now()))
  } catch {
    // 记不下只影响下次启动是否预热。
  }
}

function usedRecently(): boolean {
  try {
    const lastUsedAt = Number(localStorage.getItem(LAST_USED_STORAGE_KEY))
    return Number.isFinite(lastUsedAt) && lastUsedAt > 0 && Date.now() - lastUsedAt < RECENT_USE_MS
  } catch {
    return false
  }
}

/** 进入图片工具页时调用：预热一个渲染线程与设备；已有待命线程或线程正被使用时什么都不做。 */
export function prewarmImageEditorGpuScene(): void {
  // 巡检注入“GPU 初始化失败”时要验证从零申请设备的失败路径，不能先占好设备。
  if (typeof Worker === 'undefined' || isUiInspectionGpuInitializationFailure()) return
  pool.prewarm()
}

/** 首屏后调用：最近用过图片编辑才预热。 */
export function prewarmImageEditorGpuSceneIfRecentlyUsed(): void {
  if (usedRecently()) prewarmImageEditorGpuScene()
}

export function acquireImageEditorGpuSceneWorker(): ImageEditorGpuSceneWorkerPortV3 {
  rememberUse()
  return pool.acquire()
}
