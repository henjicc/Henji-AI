import { draw, target, type Draw, type Gpu, type Target } from 'vgpu'

import { invertImageEditTransformV3 } from '@/core/imageEdit/v3/execution/affineTransform'
import type { ImageEditCanvasGeometryV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import type { ImageEditorGpuGraphMaskV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { imageEditorGpuCameraUniformV3, imageEditorGpuOutputPixelSizeV3 } from './imageEditorGpuRasterSupportV3'
import type { ImageEditorGpuGraphSourcePlanV3 } from './imageEditorGpuRenderGraphExecutorV3'
import maskShader from './shaders/imageEditorGpuGraphMaskTileV3.wgsl?raw'

const BUFFER_COPY_DST = 0x08
const BUFFER_UNIFORM = 0x40
type NativeBuffer = ReturnType<Gpu['gpu']['createBuffer']>
type NativeBindGroup = ReturnType<Gpu['gpu']['createBindGroup']>

export interface ImageEditorGpuPreparedMaskV3 {
  readonly cacheKey: string
  readonly mask: ImageEditorGpuGraphMaskV3
  readonly target: Target
  readonly fingerprint: string
  readonly dependencies: readonly unknown[]
  readonly plan: ImageEditorGpuGraphSourcePlanV3
  readonly transform: ImageEditTransformV3
  readonly buffers: NativeBuffer[]
  readonly pending: boolean
}

interface RetainedMaskV3 {
  target: Target
  fingerprint: string
  dependencies: readonly unknown[]
  buffers: NativeBuffer[]
}

/** 把可见 sparse mask tiles 组装为视口纹理；缓存身份只依赖内容、相机和变换。 */
export class ImageEditorGpuMaskAssemblerV3 {
  private readonly drawable: Draw
  private readonly cameraBuffer: NativeBuffer
  private cameraBindGroup: NativeBindGroup | null = null
  private readonly retained = new Map<string, RetainedMaskV3>()
  private compiled = false

  constructor(private readonly gpu: Gpu, private readonly onCompiled: () => void) {
    this.drawable = draw(gpu, { shader: maskShader, vertices: 3, label: 'image-editor-graph-mask-tile' })
    this.cameraBuffer = gpu.gpu.createBuffer({
      size: 48, usage: BUFFER_UNIFORM | BUFFER_COPY_DST, label: 'image-editor-graph-mask-camera',
    })
  }

  prepare(
    cacheKey: string,
    mask: ImageEditorGpuGraphMaskV3,
    plan: ImageEditorGpuGraphSourcePlanV3,
    transform: ImageEditTransformV3,
    layout: ImageEditorViewportLayoutV3,
  ): ImageEditorGpuPreparedMaskV3 {
    const fingerprint = [mask.maskId, mask.defaultValue, mask.inverted,
      transform.join(','), layout.viewportKey,
      layout.viewport.documentX, layout.viewport.documentY, layout.viewport.zoom,
      layout.viewport.devicePixelRatio, layout.viewport.width, layout.viewport.height,
      ...plan.plan.tiles.map((tile) => tile.key.contentVersion)].join(':')
    const dependencies = [...plan.resources]
    const existing = this.retained.get(cacheKey)
    if (existing && existing.fingerprint === fingerprint && sameDependencies(existing.dependencies, dependencies)) {
      return { cacheKey, mask, target: existing.target, fingerprint, dependencies, plan, transform,
        buffers: existing.buffers, pending: false }
    }
    return {
      cacheKey, mask, fingerprint, dependencies, plan, transform, buffers: [], pending: true,
      target: target(this.gpu, {
        size: imageEditorGpuOutputPixelSizeV3(layout), format: 'rgba16float',
        clearColor: [mask.defaultValue, mask.defaultValue, mask.defaultValue, 1],
        label: `image-editor-graph-mask:${mask.maskId}`,
      }),
    }
  }

  async compile(prepared: readonly ImageEditorGpuPreparedMaskV3[]): Promise<void> {
    if (this.compiled || !prepared.some((entry) => entry.pending)) return
    await this.drawable.compile(prepared.find((entry) => entry.pending)!.target)
    this.compiled = true
    this.onCompiled()
    this.cameraBindGroup = this.gpu.gpu.createBindGroup({
      layout: this.drawable.layout(1), entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }],
    })
  }

  updateCamera(layout: ImageEditorViewportLayoutV3, geometry: ImageEditCanvasGeometryV3): void {
    this.gpu.gpu.queue.writeBuffer(this.cameraBuffer, 0, imageEditorGpuCameraUniformV3(layout, geometry))
  }

  encode(currentFrame: ReturnType<typeof import('vgpu').frame>, prepared: ImageEditorGpuPreparedMaskV3): void {
    if (!prepared.pending) return
    this.drawable.group(1, this.cameraBindGroup!)
    const inverse = invertImageEditTransformV3(prepared.transform)
    const groups = prepared.plan.plan.tiles.map((tile, index) => {
      const resource = prepared.plan.resources[index]
      if (!resource) throw new Error(`GPU RenderGraph 蒙版 ${prepared.mask.maskId} 缺少瓦片`)
      const buffer = this.uniform(new Float32Array([
        inverse[0], inverse[1], inverse[2], inverse[3], inverse[4], inverse[5], 0, 0,
        resource.tile.originX, resource.tile.originY, 2 ** tile.key.mip, resource.atlasLayer,
        resource.tile.width, resource.tile.height, 0, 0,
        tile.coreOriginX, tile.coreOriginY, tile.coreWidth, tile.coreHeight,
      ]))
      prepared.buffers.push(buffer)
      return this.gpu.gpu.createBindGroup({
        layout: this.drawable.layout(0),
        entries: [{ binding: 0, resource: resource.textureView }, { binding: 1, resource: { buffer } }],
      })
    })
    currentFrame.pass({
      target: prepared.target,
      clear: [prepared.mask.defaultValue, prepared.mask.defaultValue, prepared.mask.defaultValue, 1],
    }, (pass) => {
      for (const group of groups) { this.drawable.group(0, group); pass.draw(this.drawable) }
    })
  }

  commit(prepared: readonly ImageEditorGpuPreparedMaskV3[]): void {
    for (const entry of prepared) {
      if (!entry.pending) continue
      const previous = this.retained.get(entry.cacheKey)
      if (previous) this.destroy(previous)
      this.retained.set(entry.cacheKey, {
        target: entry.target, fingerprint: entry.fingerprint,
        dependencies: entry.dependencies, buffers: entry.buffers,
      })
    }
  }

  prune(active: ReadonlySet<string>): void {
    for (const [key, entry] of this.retained) {
      if (active.has(key)) continue
      this.destroy(entry)
      this.retained.delete(key)
    }
  }

  discard(prepared: readonly ImageEditorGpuPreparedMaskV3[]): void {
    for (const entry of prepared) {
      if (!entry.pending) continue
      for (const buffer of entry.buffers) buffer.destroy()
      entry.target.color.destroy()
    }
  }

  dispose(): void {
    for (const entry of this.retained.values()) this.destroy(entry)
    this.retained.clear()
    this.cameraBuffer.destroy()
  }

  private uniform(data: Float32Array): NativeBuffer {
    const buffer = this.gpu.gpu.createBuffer({ size: Math.ceil(data.byteLength / 16) * 16,
      usage: BUFFER_UNIFORM | BUFFER_COPY_DST })
    this.gpu.gpu.queue.writeBuffer(buffer, 0, data)
    return buffer
  }

  private destroy(entry: RetainedMaskV3): void {
    for (const buffer of entry.buffers) buffer.destroy()
    entry.target.color.destroy()
  }
}

function sameDependencies(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}
