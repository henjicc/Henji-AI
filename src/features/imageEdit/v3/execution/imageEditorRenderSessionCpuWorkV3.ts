import { compileImageEditRenderPlanV3, createBuiltInImageEditRenderNodeRegistry } from '@/core/imageEdit/v3'
import { createLogger } from '@/core/logging'
import type { ImageEditorRenderSnapshotV3 } from './imageEditorRenderSessionContractsV3'
import type { ImageEditorRenderSessionClientLanesV3 } from './imageEditorRenderSessionClientsV3'
import type { ImageEditorRenderSessionWorkLayoutV3 } from './imageEditorRenderSessionWorkV3'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'
import { createImageEditorBackdropRequestV3 } from './imageEditorRenderSessionRequestsV3'
import { resolveImageEditorViewportAnalysisMipV3 } from './viewportGlobalAnalysisV3'
import { resolveImageEditorCoarsePreviewMipV3 } from './previewFallbackMipV3'

const registry = createBuiltInImageEditRenderNodeRegistry()
const logger = createLogger('image_editor_v3.cpu_safety')
const SAFETY_DELAY_MS = 2_000
const SAFETY_IDLE_TIMEOUT_MS = 3_000

interface ImageEditorCpuSafetyInput {
  snapshot: ImageEditorRenderSnapshotV3
  layout: ImageEditorRenderSessionWorkLayoutV3
  safetyFrame: ImageEditorManagedViewportCompositeV3 | null
}

/** 先等一段时间再挑主线程空闲时执行；返回取消函数。 */
function scheduleAfterDelayWhenIdle(run: () => void): () => void {
  let idleHandle: number | null = null
  const timer = setTimeout(() => {
    if (typeof requestIdleCallback !== 'function') {
      run()
      return
    }
    idleHandle = requestIdleCallback(() => {
      idleHandle = null
      run()
    }, { timeout: SAFETY_IDLE_TIMEOUT_MS })
  }, SAFETY_DELAY_MS)
  return () => {
    clearTimeout(timer)
    if (idleHandle !== null) cancelIdleCallback(idleHandle)
  }
}

function reusableSafetyFrame({ snapshot, safetyFrame }: ImageEditorCpuSafetyInput): boolean {
  return safetyFrame?.documentId === snapshot.document.id && safetyFrame.coverage === 'document'
    && safetyFrame.mip >= resolveImageEditorCoarsePreviewMipV3({ width: safetyFrame.documentWidth, height: safetyFrame.documentHeight })
}

/** CPU 队列只在初始化/回退期间追随权威状态；GPU 接管后不再准备并丢弃 CPU 成品。 */
export class ImageEditorRenderSessionCpuWorkV3 {
  epoch = 0
  suspended = false
  analysisMip: number | null = null
  analysisReadyGeneration: number | null = null
  renderPlanCompileCount = 0
  taskStartCount = 0
  private preparedSnapshot: ImageEditorRenderSnapshotV3 | null = null
  private readonly tasks = new Set<string>()
  private safetyDocument: string | null = null
  private safetyPending = false
  private cancelSafetySchedule: (() => void) | null = null
  private disposed = false

  constructor(
    private readonly clients: ImageEditorRenderSessionClientLanesV3,
    private readonly diagnosticsChanged: () => void,
    private readonly workChanged: (settled: boolean) => void,
  ) {}

  get rendering(): boolean { return !this.suspended && this.tasks.size > 0 }

  prepare(snapshot: ImageEditorRenderSnapshotV3): void {
    if (this.suspended || this.preparedSnapshot === snapshot) return
    const plan = compileImageEditRenderPlanV3(snapshot.document, registry, snapshot.quality)
    this.preparedSnapshot = snapshot
    this.renderPlanCompileCount += 1
    this.analysisMip = resolveImageEditorViewportAnalysisMipV3(snapshot.document, plan, snapshot.quality)
    this.analysisReadyGeneration = this.analysisMip === null ? snapshot.renderGeneration : null
    this.diagnosticsChanged()
  }

  cancel(): void {
    this.epoch += 1
    this.cancelSafetySchedule?.()
    this.cancelSafetySchedule = null
    if (this.safetyPending) { this.safetyDocument = null; this.safetyPending = false }
    this.clients.cancelAll()
    this.tasks.clear()
  }

  suspend(): boolean {
    if (this.suspended) return false
    this.suspended = true
    this.cancel()
    return true
  }

  resume(): boolean {
    if (!this.suspended) return false
    this.suspended = false
    this.cancel()
    return true
  }

  removeInteractiveTasks(): void {
    for (const token of this.tasks) {
      if (token.startsWith('draft:') || token.startsWith('target:')) this.tasks.delete(token)
    }
  }

  hasTaskPrefix(prefix: string): boolean {
    return [...this.tasks].some((token) => token.startsWith(prefix))
  }

  startTask(token: string, run: () => Promise<void>): void {
    const epoch = this.epoch
    this.tasks.add(token)
    this.taskStartCount += 1
    this.diagnosticsChanged()
    if (!this.suspended) this.workChanged(false)
    void run().finally(() => {
      if (this.disposed || epoch !== this.epoch) return
      this.tasks.delete(token)
      if (!this.suspended) this.workChanged(true)
    })
  }

  /**
   * 不回读 GPU；只生成一次有界 CPU 检查点，后续编辑不得把旧检查点当最新成品。
   * GPU 首帧后先等 2 秒再挑空闲时做：它要占 CPU 和主进程读瓦片，不能挤在首帧与紧接着的操作里。
   * 开做时读当前快照与视口，等待期间的编辑也会反映进去。
   */
  captureSafetyOnce(
    documentId: string,
    read: () => ImageEditorCpuSafetyInput | null,
    accept: (result: ImageEditorManagedViewportCompositeV3) => void,
  ): void {
    const initial = read()
    if (this.safetyDocument === documentId || !initial || reusableSafetyFrame(initial)) return
    this.safetyDocument = documentId
    this.safetyPending = true
    const epoch = this.epoch
    this.cancelSafetySchedule = scheduleAfterDelayWhenIdle(() => {
      this.cancelSafetySchedule = null
      const current = read()
      if (this.disposed || epoch !== this.epoch || !this.suspended) return
      if (!current || current.snapshot.document.id !== documentId || reusableSafetyFrame(current)) {
        this.safetyPending = false
        return
      }
      this.startSafety(epoch, current, accept)
    })
  }

  private startSafety(
    epoch: number,
    { snapshot, layout }: ImageEditorCpuSafetyInput,
    accept: (result: ImageEditorManagedViewportCompositeV3) => void,
  ): void {
    this.startTask(`safety:${epoch}`, async () => {
      try {
        const request = createImageEditorBackdropRequestV3(snapshot, layout)
        const result = await this.clients.analysis.render({
          ...request, minimumMip: request.preferredMip, analysisRequested: true,
        })
        if (this.disposed || epoch !== this.epoch || !this.suspended) { result.release(); return }
        accept(result)
      } catch (error) {
        if (this.disposed || epoch !== this.epoch) return
        // GPU 仍有可见结果。记录安全帧缺失，真正设备失败时仍启动最新 CPU 渲染。
        logger.warn('图片编辑安全预览未生成，保留当前显示并按需恢复', {
          event: 'image_editor_v3.cpu_safety.failed',
          context: { documentId: snapshot.document.id, message: error instanceof Error ? error.message : String(error) },
        })
      } finally { if (epoch === this.epoch) this.safetyPending = false }
    })
  }

  dispose(): void {
    this.disposed = true
    this.cancel()
    this.preparedSnapshot = null
  }
}
