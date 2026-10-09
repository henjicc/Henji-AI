import { createBuiltInImageEditRenderNodeRegistry } from '../builtInRenderNodes'
import { createFloat32PremultipliedRgbaTile, type Float32MaskTile, type Float32PremultipliedRgbaTile } from '../effects/contracts'
import type { CubeLut } from '../../../imaging/lut/cube'
import { executeImageEditCpuRenderRegionPlanV3 } from './cpuRenderRegionExecutor'
import { encodeImageEditorV3RenderedOutputTile, projectImageEditorV3RenderedRegionToOutput } from './cpuOutputTile'
import type { CpuRegionWorkerRequestV3, CpuRegionWorkerEventV3, CpuRegionWorkerValueV3, CpuRegionWorkerCallbackV3 } from './cpuRegionWorkerProtocol'

/** 传输适配器由 Web Worker / Node 测试提供；像素求值只有正式区域执行器一份。 */
export function createCpuRegionWorkerRuntimeV3(send: (event: CpuRegionWorkerEventV3, transfer?: ArrayBuffer[]) => void) {
  let activeJob: number | null = null
  let sequence = 0
  const pending = new Map<number, { resolve(value: CpuRegionWorkerValueV3): void; reject(error: Error): void }>()
  const callback = (request: CpuRegionWorkerCallbackV3): Promise<CpuRegionWorkerValueV3> => new Promise((resolve, reject) => {
    const callbackId = ++sequence
    pending.set(callbackId, { resolve, reject })
    send({ type: 'callback', jobId: activeJob!, callbackId, request })
  })
  return async (message: CpuRegionWorkerRequestV3): Promise<void> => {
    if (message.type === 'reply') {
      if (message.jobId !== activeJob) return
      const waiter = pending.get(message.callbackId)
      if (!waiter) return
      pending.delete(message.callbackId)
      if (message.error || !message.value) waiter.reject(new Error(message.error ?? 'CPU Worker 资源回执为空'))
      else waiter.resolve(message.value)
      return
    }
    if (activeJob !== null) {
      send({ type: 'failed', jobId: message.jobId, message: 'CPU Worker 已有区域任务' })
      return
    }
    activeJob = message.jobId
    const grids = new Map(message.grids)
    const transparent = (region: { width: number; height: number }) => createFloat32PremultipliedRgbaTile(
      region.width, region.height, 'linear-light', new Float32Array(region.width * region.height * 4),
      message.color.workingSpace, message.color.transferFunction, message.color.referenceWhiteNits,
    )
    try {
      const rendered = await executeImageEditCpuRenderRegionPlanV3(message.plan, message.region, {
        size: message.size, scaleX: message.scaleX, scaleY: message.scaleY,
        registry: createBuiltInImageEditRenderNodeRegistry(),
        resolveSamplingGrid: (target) => grids.get(`${target.kind}:${target.kind === 'content' ? target.node.id : target.ownerNode.id}`),
        createTransparent: transparent,
        loadRaster: async (node, region) => await callback({ kind: 'raster', nodeId: node.id, region }) as Float32PremultipliedRgbaTile,
        rasterizeAnnotations: async (node, region) => await callback({ kind: 'annotation', nodeId: node.id, region }) as Float32PremultipliedRgbaTile,
        loadMask: async (_ref, node, region) => await callback({ kind: 'mask', nodeId: node.id, region }) as Float32MaskTile,
        loadColorLut: async (ref) => await callback({ kind: 'lut', ref }) as CubeLut,
        executeCustomEffect: message.customEffects ? async (node, source, mask, region) =>
          await callback({ kind: 'effect', nodeId: node.id, source, mask, region }) as Float32PremultipliedRgbaTile : undefined,
      })
      const projected = projectImageEditorV3RenderedRegionToOutput(rendered ?? transparent(message.region),
        message.region, message.output.rect, message.output.geometry)
      const tile = encodeImageEditorV3RenderedOutputTile(projected, message.output.rect, message.output.description)
      send({ type: 'completed', jobId: message.jobId, tile }, [tile.pixels.buffer as ArrayBuffer])
    } catch (error) {
      send({ type: 'failed', jobId: message.jobId, message: error instanceof Error ? error.message : String(error) })
    } finally {
      activeJob = null
      pending.clear()
    }
  }
}
