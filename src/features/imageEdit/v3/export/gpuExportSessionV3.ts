import {
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
  resolveImageEditOutputGeometryV3,
} from '@/core/imageEdit/v3'
import type { ImageEditorV3RenderedExportTile } from '@/commands/imageEditorV3Export'
import {
  IMAGE_EDITOR_GPU_SCENE_DIAGNOSTIC_EVENT_V3,
  type ImageEditorGpuSceneClientV3Like,
} from '../gpu/imageEditorGpuSceneClientV3'
import type { ImageEditorGpuSceneWorkerEventV3 } from '../gpu/imageEditorGpuSceneProtocolV3'
import type { ImageEditorRenderSnapshotV3 } from '../execution/imageEditorRenderSessionContractsV3'
import type {
  ImageEditorV3ExportRenderDependencies,
  ImageEditorV3ExportTileStream,
  RenderImageEditorV3ExportTilesRequest,
} from './contracts'
import { createImageEditorGpuExportPlanV3 } from './gpuExportPlanV3'
import { renderImageEditorV3ExportTiles } from './renderExportTilesV3'
import { createLogger } from '@/core/logging'

const nodeRegistry = createBuiltInImageEditRenderNodeRegistry()
const sessions = new Map<string, ImageEditorGpuExportSessionV3>()
const logger = createLogger('features.image_edit.v3.gpu_export')

interface ActiveExportV3 {
  requestId: string
  events: ImageEditorV3RenderedExportTile[]
  wake: (() => void) | null
  error: Error | null
  completed: boolean
  cancelSent: boolean
  diagnostics: Extract<ImageEditorGpuSceneWorkerEventV3, { type: 'export-tile' }>['diagnostics']
}

/** 将现有 GPU Scene 会话暴露给导出入口；不创建第二个 Worker/device。 */
export class ImageEditorGpuExportSessionV3 {
  private snapshot: ImageEditorRenderSnapshotV3 | null = null
  private registryKey: string | null = null
  private active: ActiveExportV3 | null = null
  private readonly diagnosticEventListener: EventListener | null

  constructor(
    private readonly client: ImageEditorGpuSceneClientV3Like | null,
    diagnosticRenderingEnabled = false,
  ) {
    this.diagnosticEventListener = diagnosticRenderingEnabled
      ? ((event) => {
          const detail = (event as CustomEvent<{ exportProbe?: unknown }>).detail
          if (detail?.exportProbe !== true) return
          void this.runDiagnosticExportProbe().catch(() => undefined)
        })
      : null
    if (this.diagnosticEventListener) {
      window.addEventListener(IMAGE_EDITOR_GPU_SCENE_DIAGNOSTIC_EVENT_V3, this.diagnosticEventListener)
    }
  }

  syncSnapshot(snapshot: ImageEditorRenderSnapshotV3): void {
    this.unregister()
    this.failActive(new Error('GPU Scene 文档版本已变化'))
    this.snapshot = snapshot
    this.registryKey = key(snapshot.document.id, snapshot.document.revision)
    sessions.set(this.registryKey, this)
  }

  handleEvent(event: ImageEditorGpuSceneWorkerEventV3): boolean {
    const active = this.active
    if (!active) return false
    if (event.type === 'export-tile' && event.requestId === active.requestId) {
      active.events.push({
        x: event.x,
        y: event.y,
        width: event.width,
        height: event.height,
        rowStride: event.rowStride,
        pixels: event.pixels,
      })
      active.completed = event.completed
      active.diagnostics = mergeDiagnostics(active.diagnostics, event.diagnostics)
      this.wake(active)
      return true
    }
    if (event.type === 'failed' && event.requestId === active.requestId) {
      this.failActive(new Error(event.message))
      return true
    }
    return false
  }

  render(request: RenderImageEditorV3ExportTilesRequest): ImageEditorV3ExportTileStream | null {
    const snapshot = this.snapshot
    if (!this.client?.requestExport || !this.client.acknowledgeExportTile || !snapshot
      || snapshot.document.id !== request.document.id
      || snapshot.document.revision !== request.document.revision
      || snapshot.renderGeneration < 1
      || this.active) return null
    const requestId = `gpu-export:${request.sessionId ?? crypto.randomUUID()}`
    const plan = compileImageEditRenderPlanV3(request.document, nodeRegistry, 'export')
    const activePlan = compileImageEditRenderPlanV3(snapshot.document, nodeRegistry, 'export')
    if (plan.outputHash !== activePlan.outputHash) return null
    const output = createImageEditorGpuExportPlanV3({
      plan,
      width: request.description.width,
      height: request.description.height,
      tileSize: request.tileSize ?? 512,
    })
    const active: ActiveExportV3 = {
      requestId,
      events: [],
      wake: null,
      error: null,
      completed: false,
      cancelSent: false,
      diagnostics: undefined,
    }
    this.active = active
    logger.info('开始图片编辑 GPU 分块导出', {
      event: 'image_editor_v3.gpu_export.started', requestId,
      context: { documentId: request.document.id, revision: request.document.revision,
        tileCount: output.tiles.length, multiscale: Boolean(output.multiscaleAnalysis) },
    })
    this.client.requestExport({
      type: 'export',
      requestId,
      sceneGeneration: snapshot.renderGeneration,
      quality: 'export',
      description: request.description,
      outputTiles: output.tiles,
      multiscaleAnalysis: output.multiscaleAnalysis,
    })
    return this.stream(active, request)
  }

  dispose(): void {
    if (this.diagnosticEventListener) {
      window.removeEventListener(IMAGE_EDITOR_GPU_SCENE_DIAGNOSTIC_EVENT_V3, this.diagnosticEventListener)
    }
    this.unregister()
    this.failActive(new Error('GPU Scene 会话已销毁'))
    this.snapshot = null
  }

  reject(requestId: string, error: Error): void {
    if (this.active?.requestId === requestId) this.failActive(error)
  }

  rejectActive(error: Error): void {
    this.failActive(error)
  }

  private async *stream(
    active: ActiveExportV3,
    request: RenderImageEditorV3ExportTilesRequest,
  ): ImageEditorV3ExportTileStream {
    const abort = (): void => this.failActive(abortError(request.signal?.reason))
    request.signal?.addEventListener('abort', abort, { once: true })
    let completed = 0
    let drained = false
    try {
      for (;;) {
        while (active.events.length === 0 && !active.error) {
          if (active.completed) { drained = true; return }
          await new Promise<void>((resolve) => { active.wake = resolve })
        }
        if (active.error) throw active.error
        const tile = active.events.shift()
        if (!tile) continue
        yield tile
        completed += 1
        request.onTileRendered?.(completed, Math.ceil(request.description.width / (request.tileSize ?? 512))
          * Math.ceil(request.description.height / (request.tileSize ?? 512)))
        this.client?.acknowledgeExportTile?.(
          active.requestId,
          Math.floor(tile.x / (request.tileSize ?? 512)),
          Math.floor(tile.y / (request.tileSize ?? 512)),
        )
        if (active.completed && active.events.length === 0) { drained = true; return }
      }
    } catch (error) {
      logger.error('图片编辑 GPU 分块导出失败', error instanceof Error ? error : new Error(String(error)), {
        event: 'image_editor_v3.gpu_export.failed', requestId: active.requestId,
        context: { completedTiles: completed },
      })
      throw error
    } finally {
      request.signal?.removeEventListener('abort', abort)
      if (this.active === active) {
        this.active = null
        if (!drained) this.cancelWorker(active)
      }
      if (drained && !active.error) logger.info('完成图片编辑 GPU 分块导出', {
        event: 'image_editor_v3.gpu_export.completed', requestId: active.requestId,
        context: { completedTiles: completed, ...active.diagnostics },
      })
    }
  }

  /** 仅真实 Electron 巡检启用；复用生产 stream/backpressure，不落盘也不增加正式入口。 */
  private async runDiagnosticExportProbe(): Promise<void> {
    const snapshot = this.snapshot
    if (!snapshot || this.active) return
    const geometry = resolveImageEditOutputGeometryV3(snapshot.document.geometry)
    const document = snapshot.document
    if (document.color.bitDepth !== 8
      || document.color.workingSpace !== 'srgb'
      || document.color.transferFunction !== 'srgb') return
    const stream = this.render({
      document,
      resourceDescriptors: snapshot.resourceDescriptors,
      description: {
        width: geometry.outputWidth,
        height: geometry.outputHeight,
        bitDepth: 8,
        sampleFormat: 'uint',
        colorSpace: 'srgb',
        transferFunction: 'srgb',
        alphaMode: 'straight',
        iccProfileResourceRef: null,
        cicp: null,
        hdrMetadata: null,
      },
      tileSize: 512,
      sessionId: `reality:${crypto.randomUUID()}`,
    })
    if (!stream) return
    for await (const _tile of stream) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 250))
    }
  }

  private failActive(error: Error): void {
    const active = this.active
    if (!active) return
    active.error = error
    this.wake(active)
    this.cancelWorker(active)
  }

  private wake(active: ActiveExportV3): void {
    active.wake?.()
    active.wake = null
  }

  private cancelWorker(active: ActiveExportV3): void {
    if (active.cancelSent) return
    active.cancelSent = true
    this.client?.cancelExport?.(active.requestId)
  }

  private unregister(): void {
    if (this.registryKey && sessions.get(this.registryKey) === this) sessions.delete(this.registryKey)
    this.registryKey = null
  }
}

/** 生产导出优先复用活动 GPU Scene；无活动会话或测试注入时保持既有 CPU 合同。 */
export function renderImageEditorV3ExportTilesWithGpu(
  request: RenderImageEditorV3ExportTilesRequest,
  dependencies: ImageEditorV3ExportRenderDependencies = {},
): ImageEditorV3ExportTileStream {
  const injected = Object.keys(dependencies).length > 0
  const gpu = injected ? null : sessions.get(key(request.document.id, request.document.revision))?.render(request)
  return gpu ?? renderImageEditorV3ExportTiles(request, dependencies)
}

function key(documentId: string, revision: number): string {
  return `${documentId}:${revision}`
}

function abortError(reason: unknown): Error {
  const error = reason instanceof Error ? reason : new Error('GPU Scene 导出已取消')
  if (error.name === 'Error') error.name = 'AbortError'
  return error
}

function mergeDiagnostics(
  previous: ActiveExportV3['diagnostics'],
  current: ActiveExportV3['diagnostics'],
): ActiveExportV3['diagnostics'] {
  if (!current) return previous
  if (!previous) return current
  return {
    readbackCount: Math.max(previous.readbackCount, current.readbackCount),
    maximumTargetWidth: Math.max(previous.maximumTargetWidth, current.maximumTargetWidth),
    maximumTargetHeight: Math.max(previous.maximumTargetHeight, current.maximumTargetHeight),
    residentTileCount: Math.max(previous.residentTileCount, current.residentTileCount),
    allocatedAtlasBytes: Math.max(previous.allocatedAtlasBytes, current.allocatedAtlasBytes),
    previewResidentBytes: Math.max(previous.previewResidentBytes ?? 0, current.previewResidentBytes ?? 0),
    sharedResidentBytes: Math.max(previous.sharedResidentBytes ?? 0, current.sharedResidentBytes ?? 0),
  }
}
