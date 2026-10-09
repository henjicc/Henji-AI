import type { ImageEditRenderPlan } from '../renderPlan'
import type { ImageEditRect } from '../tileGeometry'
import type { ImageEditCpuRegionRenderContextV3 } from './cpuRenderRegionExecutor'
import { resolveImageEditCpuSamplingGridV3 } from './cpuSamplingGrid'
import type { ImageEditCpuOutputTileV3 } from './cpuOutputTile'
import type { CpuRegionWorkerEventV3, CpuRegionWorkerPortV3, CpuRegionWorkerOutputV3, CpuRegionWorkerValueV3 } from './cpuRegionWorkerProtocol'

export class ImageEditCpuRegionWorkerClientV3 {
  private sequence = 0
  private closed = false
  private job: { id: number; context: ImageEditCpuRegionRenderContextV3; plan: ImageEditRenderPlan;
    resolve(tile: ImageEditCpuOutputTileV3): void; reject(error: Error): void; unsubscribe(): void } | null = null

  constructor(private readonly port: CpuRegionWorkerPortV3) {
    port.subscribe((event) => { void this.receive(event) }, (error) => this.dispose(error))
  }

  render(plan: ImageEditRenderPlan, region: ImageEditRect, context: ImageEditCpuRegionRenderContextV3,
    output: CpuRegionWorkerOutputV3): Promise<ImageEditCpuOutputTileV3> {
    if (this.closed || this.job) return Promise.reject(new Error('CPU Worker 不可用或仍在执行区域'))
    context.signal?.throwIfAborted()
    const grids = plan.nodes.flatMap((node) => [
      [`content:${node.id}`, resolveImageEditCpuSamplingGridV3(context, { kind: 'content', node })] as const,
      ...(node.mask ? [[`mask:${node.id}`, resolveImageEditCpuSamplingGridV3(context,
        { kind: 'mask', ownerNode: node, reference: node.mask })] as const] : []),
    ])
    const transparent = context.createTransparent({ x: 0, y: 0, width: 1, height: 1 })
    return new Promise((resolve, reject) => {
      const abort = () => {
        const error = new Error('图片 CPU 渲染已取消')
        error.name = 'AbortError'
        this.dispose(error)
      }
      const id = ++this.sequence
      this.job = { id, context, plan, resolve, reject, unsubscribe: () => context.signal?.removeEventListener('abort', abort) }
      context.signal?.addEventListener('abort', abort, { once: true })
      try {
        this.port.postMessage({ type: 'render', jobId: id, plan, region, grids, size: context.size,
          scaleX: context.scaleX, scaleY: context.scaleY, customEffects: !!context.executeCustomEffect,
          color: { workingSpace: transparent.workingSpace, transferFunction: transparent.transferFunction,
            referenceWhiteNits: transparent.referenceWhiteNits }, output })
      } catch (error) { this.dispose(error instanceof Error ? error : new Error(String(error))) }
    })
  }

  dispose(error = new Error('CPU Worker 已释放')): void {
    if (this.closed) return
    this.closed = true
    this.port.terminate()
    this.job?.unsubscribe()
    this.job?.reject(error)
    this.job = null
  }

  private async receive(event: CpuRegionWorkerEventV3): Promise<void> {
    const job = this.job
    if (!job || job.id !== event.jobId) return
    if (event.type !== 'callback') {
      this.job = null
      job.unsubscribe()
      if (event.type === 'failed') job.reject(new Error(event.message))
      else job.resolve(event.tile)
      return
    }
    try {
      const request = event.request
      let value: CpuRegionWorkerValueV3
      if (request.kind === 'lut') {
        if (!job.context.loadColorLut) throw new Error('缺少颜色 LUT 读取器')
        value = await job.context.loadColorLut(request.ref)
      } else {
        const node = job.plan.nodes.find((entry) => entry.id === request.nodeId)
        if (!node) throw new Error('CPU Worker 请求未知节点')
        if (request.kind === 'raster') value = await job.context.loadRaster(node, request.region)
        else if (request.kind === 'annotation') value = await job.context.rasterizeAnnotations(node, request.region)
        else if (request.kind === 'mask') {
          if (!node.mask) throw new Error('CPU Worker 请求缺少蒙版的节点')
          value = await job.context.loadMask(node.mask, node, request.region)
        } else {
          if (!job.context.executeCustomEffect) throw new Error('缺少自定义效果执行器')
          value = await job.context.executeCustomEffect(node, request.source, request.mask, request.region)
        }
      }
      // 读取器可能复用不可变瓦片，不能 transfer/detach 它持有的 ArrayBuffer。
      if (this.job === job) this.port.postMessage({ type: 'reply', jobId: job.id, callbackId: event.callbackId, value })
    } catch (error) {
      if (this.job === job) {
        try {
          this.port.postMessage({ type: 'reply', jobId: job.id, callbackId: event.callbackId,
            error: error instanceof Error ? error.message : String(error) })
        } catch (transportError) {
          this.dispose(transportError instanceof Error ? transportError : new Error(String(transportError)))
        }
      }
    }
  }
}
