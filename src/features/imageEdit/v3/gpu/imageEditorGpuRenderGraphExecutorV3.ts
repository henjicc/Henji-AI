import { draw, frame, target, type Draw, type Gpu, type Target, type Texture } from 'vgpu'

import { invertImageEditTransformV3 } from '@/core/imageEdit/v3/execution/affineTransform'
import type { ImageEditBlendModeV3, ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import {
  imageEditorGpuCurveDataV3,
  imageEditorGpuExposureParametersV3,
  imageEditorGpuHslParametersV3,
  imageEditorGpuTemperatureMatrixV3,
} from './imageEditorGpuAdjustmentParametersV3'
import type {
  ImageEditorGpuGraphAdjustmentNodeV3,
  ImageEditorGpuGraphAdjustmentV3,
  ImageEditorGpuGraphCompositeNodeV3,
  ImageEditorGpuGraphMaskV3,
  ImageEditorGpuRasterSceneV3,
  ImageEditorGpuRenderGraphNodeV3,
} from './imageEditorGpuRasterSceneCompilerV3'
import type { ImageEditorGpuPlannedLayerV3, ImageEditorGpuPlannedTileV3 } from './imageEditorGpuTilePlannerV3'
import type { ImageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'
import type { ImageEditorGpuTileAtlasAllocationV3 } from './imageEditorGpuTileAtlasV3'
import {
  imageEditorGpuSourceColorUniformV3,
  packImageEditorGpuColorMatrixRowsV3,
} from './imageEditorGpuColorPipelineV3'
import { imageEditorGpuCameraUniformV3, imageEditorGpuOutputPixelSizeV3 } from './imageEditorGpuRasterSupportV3'
import adjustmentShader from './shaders/imageEditorGpuGraphAdjustmentV3.wgsl?raw'
import compositeShader from './shaders/imageEditorGpuGraphCompositeV3.wgsl?raw'
import copyShader from './shaders/imageEditorGpuGraphCopyV3.wgsl?raw'
import curvesShader from './shaders/imageEditorGpuGraphCurvesV3.wgsl?raw'
import normalShader from './shaders/imageEditorGpuGraphNormalV3.wgsl?raw'
import sourceShader from './shaders/imageEditorGpuRasterLayerV3.wgsl?raw'

const BUFFER_COPY_DST = 0x08
const BUFFER_UNIFORM = 0x40
const CLEAR = [0, 0, 0, 0] as const
type NativeBuffer = ReturnType<Gpu['gpu']['createBuffer']>
type NativeBindGroup = ReturnType<Gpu['gpu']['createBindGroup']>
type NativeBindingResource = unknown

export interface ImageEditorGpuGraphTextureV3 {
  readonly key: ImageEditorGpuSceneTileKeyV3
  readonly tile: ImageEditorGpuTileAtlasAllocationV3['tile']
  readonly textureView: ImageEditorGpuTileAtlasAllocationV3['textureView']
  readonly layerTextureView: ImageEditorGpuTileAtlasAllocationV3['layerTextureView']
  readonly atlasLayer: number
}

export interface ImageEditorGpuGraphSourcePlanV3 {
  readonly plan: ImageEditorGpuPlannedLayerV3
  readonly resources: readonly ImageEditorGpuGraphTextureV3[]
}

interface RetainedNodeState {
  fingerprint: string
  target: Target
  dependencies: readonly unknown[]
  buffers: NativeBuffer[]
  curveTexture: Texture | null
}

interface GraphTask {
  node: Exclude<ImageEditorGpuRenderGraphNodeV3, { kind: 'alias' }>
  target: Target
  backdrop: Target | null
  input: Target | null
  sourcePlan: ImageEditorGpuGraphSourcePlanV3 | null
  sourceFingerprint: string | null
  mask: ImageEditorGpuGraphTextureV3 | null
  fingerprint: string
}

interface VirtualSourceV3 {
  plan: ImageEditorGpuGraphSourcePlanV3
  fingerprint: string
}

export interface ImageEditorGpuRenderGraphStatsV3 {
  renderedNodeCount: number
  cacheHitCount: number
  invalidatedNodeCount: number
  fusedAdjustmentCount: number
  maximumTargetWidth: number
  maximumTargetHeight: number
}

/** RenderPlan 投影后的 retained executor；一批失效节点始终编码进同一个 vGPU Frame。 */
export class ImageEditorGpuRenderGraphExecutorV3 {
  private readonly sourceDraw: Draw
  private readonly copyDraw: Draw
  private readonly normalDraw: Draw
  private readonly compositeDraw: Draw
  private readonly adjustmentDraw: Draw
  private readonly curvesDraw: Draw
  private readonly compiled = new Set<Draw>()
  private readonly retained = new Map<string, RetainedNodeState>()
  private readonly transientTransforms = new Map<string, ImageEditTransformV3>()
  private readonly fallbackMask: Texture
  private readonly cameraBuffer: NativeBuffer
  private sourceScratch: Target | null = null
  private sourceScratchFingerprint: string | null = null
  private sourceScratchDependencies: readonly unknown[] = []
  private cameraBindGroup: NativeBindGroup | null = null
  private scene: ImageEditorGpuRasterSceneV3 | null = null
  private layout: ImageEditorViewportLayoutV3 | null = null
  private stats: ImageEditorGpuRenderGraphStatsV3 = {
    renderedNodeCount: 0, cacheHitCount: 0, invalidatedNodeCount: 0, fusedAdjustmentCount: 0,
    maximumTargetWidth: 0, maximumTargetHeight: 0,
  }

  constructor(private readonly gpu: Gpu, private readonly onPipelineCompiled: () => void) {
    this.sourceDraw = draw(gpu, { shader: sourceShader, vertices: 3, label: 'image-editor-graph-source' })
    this.copyDraw = draw(gpu, { shader: copyShader, vertices: 3, label: 'image-editor-graph-copy' })
    this.normalDraw = draw(gpu, { shader: normalShader, vertices: 3, blend: 'premultiplied', label: 'image-editor-graph-normal' })
    this.compositeDraw = draw(gpu, { shader: compositeShader, vertices: 3, label: 'image-editor-graph-blend' })
    this.adjustmentDraw = draw(gpu, { shader: adjustmentShader, vertices: 3, label: 'image-editor-graph-adjustment' })
    this.curvesDraw = draw(gpu, { shader: curvesShader, vertices: 3, label: 'image-editor-graph-curves' })
    this.fallbackMask = gpu.device.createTexture({
      size: [1, 1], format: 'r8unorm', usage: ['copy_dst', 'texture_binding'],
      label: 'image-editor-graph-default-mask',
    })
    gpu.gpu.queue.writeTexture({ texture: this.fallbackMask.gpu }, new Uint8Array([255]),
      { bytesPerRow: 1, rowsPerImage: 1 }, { width: 1, height: 1, depthOrArrayLayers: 1 })
    this.cameraBuffer = gpu.gpu.createBuffer({
      size: 48, usage: BUFFER_UNIFORM | BUFFER_COPY_DST, label: 'image-editor-graph-camera',
    })
  }

  syncScene(scene: ImageEditorGpuRasterSceneV3 | null): void {
    this.scene = scene
    this.transientTransforms.clear()
    if (!scene) this.clearRetained()
  }

  updateTransientTransform(layerId: string, transform: ImageEditTransformV3 | null): void {
    if (transform) this.transientTransforms.set(layerId, [...transform])
    else this.transientTransforms.delete(layerId)
  }

  snapshotStats(): ImageEditorGpuRenderGraphStatsV3 { return { ...this.stats } }

  async execute(
    resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuGraphTextureV3 | null,
    sourcePlans: ReadonlyMap<string, ImageEditorGpuGraphSourcePlanV3>,
    layout: ImageEditorViewportLayoutV3,
  ): Promise<Target | null> {
    if (!this.scene?.outputNodeId) return null
    this.layout = layout
    const outputs = new Map<string, Target>()
    const fingerprints = new Map<string, string>()
    const tasks: GraphTask[] = []
    const aliases = new Set<string>()
    const virtualSources = new Map<string, VirtualSourceV3>()
    for (const node of this.scene.graph) {
      if (node.kind === 'source') {
        const plan = sourcePlans.get(node.layerId)
        if (!plan || plan.resources.length === 0) {
          throw new Error(`GPU RenderGraph 缺少源瓦片：${node.layerId}`)
        }
        const fingerprint = `${this.fingerprint(node, fingerprints)}:${viewportFingerprint(layout)}`
        virtualSources.set(node.nodeId, { plan, fingerprint })
        fingerprints.set(node.nodeId, fingerprint)
        continue
      }
      if (node.kind === 'alias') {
        const input = outputs.get(node.inputNodeId)
        const inputFingerprint = fingerprints.get(node.inputNodeId)
        if (!input || !inputFingerprint) throw new Error(`GPU RenderGraph 缺少组输入：${node.nodeId}`)
        outputs.set(node.nodeId, input)
        fingerprints.set(node.nodeId, `${node.fingerprint}:${inputFingerprint}`)
        aliases.add(node.nodeId)
        continue
      }
      const virtualSource = node.kind === 'composite'
        ? virtualSources.get(node.contentNodeId) ?? null
        : null
      const input = virtualSource
        ? null
        : outputs.get(node.kind === 'composite' ? node.contentNodeId : node.inputNodeId) ?? null
      const backdrop = node.kind === 'composite' && node.backdropNodeId ? outputs.get(node.backdropNodeId) ?? null : null
      const sourcePlan = virtualSource?.plan ?? null
      const mask = this.resolveMask(node.kind === 'composite' ? node.mask : node.adjustments[0]?.mask ?? null, resolve)
      const fingerprint = `${this.fingerprint(node, fingerprints)}:${viewportFingerprint(layout)}`
      const dependencies = [input, backdrop, ...(sourcePlan?.resources ?? []), mask]
      const retained = this.retained.get(node.nodeId)
      if (retained && retained.fingerprint === fingerprint && sameDependencies(retained.dependencies, dependencies)) {
        outputs.set(node.nodeId, retained.target)
        fingerprints.set(node.nodeId, fingerprint)
        this.stats.cacheHitCount += 1
        continue
      }
      if (!input && !sourcePlan) throw new Error(`GPU RenderGraph 缺少节点输入：${node.nodeId}`)
      const output = target(this.gpu, {
        size: imageEditorGpuOutputPixelSizeV3(layout),
        format: 'rgba16float',
        clearColor: CLEAR,
        label: `image-editor-graph:${node.nodeId}`,
      })
      this.stats.maximumTargetWidth = Math.max(this.stats.maximumTargetWidth, output.size[0])
      this.stats.maximumTargetHeight = Math.max(this.stats.maximumTargetHeight, output.size[1])
      outputs.set(node.nodeId, output)
      fingerprints.set(node.nodeId, fingerprint)
      tasks.push({
        node, target: output, backdrop, input, sourcePlan,
        sourceFingerprint: virtualSource?.fingerprint ?? null,
        mask, fingerprint,
      })
    }
    this.gpu.gpu.queue.writeBuffer(
      this.cameraBuffer, 0, imageEditorGpuCameraUniformV3(layout, this.scene.geometry),
    )
    if (tasks.some((task) => task.sourcePlan)) this.ensureSourceScratch(layout)
    await this.compileTasks(tasks)
    const replacements = new Map<string, RetainedNodeState>()
    const submitted = tasks.length > 0 ? frame(this.gpu, (currentFrame) => {
      for (const task of tasks) replacements.set(task.node.nodeId, this.encodeTask(currentFrame, task))
    }) : null
    if (submitted) await submitted.done
    for (const [nodeId, replacement] of replacements) {
      const previous = this.retained.get(nodeId)
      if (previous) {
        this.destroyState(previous)
        this.stats.invalidatedNodeCount += 1
      }
      this.retained.set(nodeId, replacement)
      this.stats.renderedNodeCount += 1
    }
    this.pruneRetained(new Set(this.scene.graph.filter((node) => !aliases.has(node.nodeId)).map((node) => node.nodeId)))
    return outputs.get(this.scene.outputNodeId) ?? null
  }

  dispose(): void {
    this.clearRetained()
    this.fallbackMask.destroy()
    this.cameraBuffer.destroy()
    this.sourceScratch?.color.destroy()
    this.sourceScratch = null
    this.sourceScratchFingerprint = null
    this.sourceScratchDependencies = []
  }

  private fingerprint(node: Exclude<ImageEditorGpuRenderGraphNodeV3, { kind: 'alias' }>, fingerprints: ReadonlyMap<string, string>): string {
    if (node.kind === 'source') {
      return node.fingerprint
    }
    const input = fingerprints.get(node.kind === 'composite' ? node.contentNodeId : node.inputNodeId) ?? 'missing'
    const backdrop = node.kind === 'composite' && node.backdropNodeId ? fingerprints.get(node.backdropNodeId) ?? 'missing' : 'transparent'
    const transform = node.kind === 'composite'
      ? this.transientTransforms.get(node.layerId) ?? node.transform
      : null
    return `${node.fingerprint}:${input}:${backdrop}:${transform?.join(',') ?? ''}`
  }

  private resolveMask(mask: ImageEditorGpuGraphMaskV3 | null, resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuGraphTextureV3 | null): ImageEditorGpuGraphTextureV3 | null {
    return mask?.key ? resolve(mask.key) : null
  }

  private async compileTasks(tasks: readonly GraphTask[]): Promise<void> {
    const draws = new Map<Draw, Target>()
    for (const task of tasks) {
      if (task.sourcePlan) draws.set(this.sourceDraw, this.sourceScratch!)
      if (task.node.kind === 'source') draws.set(this.sourceDraw, task.target)
      else if (task.node.kind === 'composite' && (task.node.blendMode === 'normal' || !task.backdrop)) {
        draws.set(this.normalDraw, task.target)
        if (task.backdrop) draws.set(this.copyDraw, task.target)
      } else if (task.node.kind === 'composite') draws.set(this.compositeDraw, task.target)
      else if (task.node.adjustments[0]?.definitionId === 'adjustment.curves') draws.set(this.curvesDraw, task.target)
      else draws.set(this.adjustmentDraw, task.target)
    }
    for (const [drawable, compileTarget] of draws) {
      if (this.compiled.has(drawable)) continue
      await drawable.compile(compileTarget)
      this.compiled.add(drawable)
      this.onPipelineCompiled()
    }
  }

  private encodeTask(currentFrame: ReturnType<typeof frame>, task: GraphTask): RetainedNodeState {
    const buffers: NativeBuffer[] = []
    let curveTexture: Texture | null = null
    if (task.node.kind === 'source') {
      this.encodeSource(currentFrame, task.target, task.node.layerId, task.sourcePlan!, buffers)
    } else if (task.node.kind === 'composite') {
      if (task.sourcePlan) {
        const dependencies = task.sourcePlan.resources
        if (this.sourceScratchFingerprint !== task.sourceFingerprint
          || !sameDependencies(this.sourceScratchDependencies, dependencies)) {
          this.encodeSource(
            currentFrame, this.sourceScratch!, task.node.layerId, task.sourcePlan, buffers, true,
          )
          this.sourceScratchFingerprint = task.sourceFingerprint
          this.sourceScratchDependencies = [...dependencies]
        }
      }
      const input = task.sourcePlan ? this.sourceScratch : task.input
      const values = this.compositeValues(task.node, task.sourcePlan !== null)
      const buffer = this.uniform(values)
      buffers.push(buffer)
      const maskView = task.mask?.layerTextureView ?? this.fallbackMask.view
      if (task.node.blendMode === 'normal' || !task.backdrop) {
        if (task.backdrop) {
          this.copyDraw.group(0, this.bind(this.copyDraw, [task.backdrop.color.view]))
          currentFrame.pass(task.target, this.copyDraw)
        }
        this.normalDraw.group(0, this.bind(this.normalDraw, [input!.color.view, maskView, { buffer }]))
        currentFrame.pass({ target: task.target, clear: !task.backdrop }, this.normalDraw)
      } else {
        this.compositeDraw.group(0, this.bind(this.compositeDraw, [task.backdrop.color.view, input!.color.view, maskView, { buffer }]))
        currentFrame.pass(task.target, this.compositeDraw)
      }
    } else if (task.node.adjustments[0]?.definitionId === 'adjustment.curves') {
      const adjustment = task.node.adjustments[0]
      const curves = imageEditorGpuCurveDataV3(adjustment.parameters)
      curveTexture = this.gpu.device.createTexture({ size: [4096, 4], format: 'r32float', usage: ['copy_dst', 'texture_binding'], label: `image-editor-curves:${task.node.layerId}` })
      this.gpu.gpu.queue.writeTexture({ texture: curveTexture.gpu }, curves.values, { bytesPerRow: 4096 * 4, rowsPerImage: 4 }, { width: 4096, height: 4, depthOrArrayLayers: 1 })
      const buffer = this.uniform(this.curveValues(adjustment, curves.slopes))
      buffers.push(buffer)
      this.curvesDraw.group(0, this.bind(this.curvesDraw, [task.input!.color.view, task.mask?.layerTextureView ?? this.fallbackMask.view, curveTexture.view, { buffer }]))
      currentFrame.pass(task.target, this.curvesDraw)
    } else {
      const buffer = this.uniform(this.adjustmentValues(task.node))
      buffers.push(buffer)
      this.adjustmentDraw.group(0, this.bind(this.adjustmentDraw, [task.input!.color.view, task.mask?.layerTextureView ?? this.fallbackMask.view, { buffer }]))
      currentFrame.pass(task.target, this.adjustmentDraw)
      if (task.node.adjustments.length > 1) this.stats.fusedAdjustmentCount += task.node.adjustments.length - 1
    }
    return {
      fingerprint: task.fingerprint,
      target: task.target,
      dependencies: [task.input, task.backdrop, ...(task.sourcePlan?.resources ?? []), task.mask],
      buffers,
      curveTexture,
    }
  }

  private encodeSource(
    currentFrame: ReturnType<typeof frame>,
    output: Target,
    layerId: string,
    sourcePlan: ImageEditorGpuGraphSourcePlanV3,
    buffers: NativeBuffer[],
    identityTransform = false,
  ): void {
    const layer = this.scene!.layers.find((entry) => entry.layerId === layerId)
    if (!layer) throw new Error(`GPU RenderGraph 缺少源图层：${layerId}`)
    this.cameraBindGroup ??= this.gpu.gpu.createBindGroup({
      layout: this.sourceDraw.layout(1),
      entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }],
    })
    this.sourceDraw.group(1, this.cameraBindGroup)
    const draws = sourcePlan.plan.tiles.map((planned, index) => {
      const resource = sourcePlan.resources[index]
      if (!resource) throw new Error(`GPU RenderGraph 源图层 ${layerId} 缺少瓦片`)
      const buffer = this.uniform(this.sourceTileValues(
        layer, planned, resource,
        identityTransform ? [1, 0, 0, 1, 0, 0] : undefined,
      ))
      buffers.push(buffer)
      return this.bind(this.sourceDraw, [resource.textureView, { buffer }])
    })
    currentFrame.pass({ target: output, clear: CLEAR }, (pass) => {
      for (const bindGroup of draws) {
        this.sourceDraw.group(0, bindGroup)
        pass.draw(this.sourceDraw)
      }
    })
  }

  private ensureSourceScratch(layout: ImageEditorViewportLayoutV3): void {
    const size = imageEditorGpuOutputPixelSizeV3(layout)
    if (!this.sourceScratch) {
      this.sourceScratch = target(this.gpu, {
        size, format: 'rgba16float', clearColor: CLEAR,
        label: 'image-editor-graph:source-scratch',
      })
    } else if (this.sourceScratch.size[0] !== size[0] || this.sourceScratch.size[1] !== size[1]) {
      this.sourceScratch.resize(size)
      this.sourceScratchFingerprint = null
      this.sourceScratchDependencies = []
    }
    this.stats.maximumTargetWidth = Math.max(this.stats.maximumTargetWidth, size[0])
    this.stats.maximumTargetHeight = Math.max(this.stats.maximumTargetHeight, size[1])
  }

  private compositeValues(node: ImageEditorGpuGraphCompositeNodeV3, virtualSource: boolean): Float32Array {
    const transform = virtualSource
      ? this.transientTransforms.get(node.layerId) ?? node.transform
      : [1, 0, 0, 1, 0, 0] as ImageEditTransformV3
    const inverse = invertImageEditTransformV3(transform)
    const viewport = this.layout?.viewport
    const scale = viewport ? viewport.zoom * viewport.devicePixelRatio : 1
    const originX = viewport?.documentX ?? 0
    const originY = viewport?.documentY ?? 0
    const translationX = scale * (
      inverse[0] * originX + inverse[2] * originY + inverse[4] - originX
    )
    const translationY = scale * (
      inverse[1] * originX + inverse[3] * originY + inverse[5] - originY
    )
    return new Float32Array([
      inverse[0], inverse[1], inverse[2], inverse[3], translationX, translationY, 0, 0,
      node.opacity, blendIndex(node.blendMode), 0, 0,
      node.mask ? 1 : 0, node.mask?.defaultValue ?? 1, node.mask?.inverted ? 1 : 0, 0,
    ])
  }

  private sourceTileValues(
    layer: ImageEditorGpuRasterSceneV3['layers'][number],
    planned: ImageEditorGpuPlannedTileV3,
    resource: ImageEditorGpuGraphTextureV3,
    transformOverride?: ImageEditTransformV3,
  ): Float32Array {
    const transform = transformOverride
      ?? this.transientTransforms.get(layer.layerId)
      ?? layer.transform
    const inverse = invertImageEditTransformV3(transform)
    const color = imageEditorGpuSourceColorUniformV3(resource.tile, this.scene!.color)
    return new Float32Array([
      inverse[0], inverse[1], inverse[2], inverse[3], inverse[4], inverse[5], 1, 0,
      resource.tile.originX, resource.tile.originY, 2 ** planned.key.mip, resource.atlasLayer,
      resource.tile.width, resource.tile.height, color.transferCode, color.referenceWhiteNits,
      planned.coreOriginX, planned.coreOriginY, planned.coreWidth, planned.coreHeight,
      ...packImageEditorGpuColorMatrixRowsV3(color.sourceToWorking),
    ])
  }

  private adjustmentValues(node: ImageEditorGpuGraphAdjustmentNodeV3): Float32Array {
    const first = node.adjustments[0]
    const mask = first.mask
    const values = new Float32Array(40)
    const kind = first.definitionId === 'adjustment.exposure' ? 0 : first.definitionId === 'adjustment.temperature-tint' ? 1 : 2
    values.set([kind, node.adjustments.length, first.opacity, blendIndex(first.blendMode), mask ? 1 : 0, mask?.defaultValue ?? 1, mask?.inverted ? 1 : 0, 0])
    if (kind === 0) node.adjustments.slice(0, 8).forEach((entry, index) => values.set(imageEditorGpuExposureParametersV3(entry.parameters), 8 + index * 4))
    else if (kind === 1) values.set(imageEditorGpuTemperatureMatrixV3(first.parameters), 8)
    else values.set(imageEditorGpuHslParametersV3(first.parameters), 8)
    return values
  }

  private curveValues(adjustment: ImageEditorGpuGraphAdjustmentV3, slopes: Float32Array): Float32Array {
    const mask = adjustment.mask
    return new Float32Array([
      adjustment.opacity, blendIndex(adjustment.blendMode), 0, 0,
      mask ? 1 : 0, mask?.defaultValue ?? 1, mask?.inverted ? 1 : 0, 0,
      slopes[0], slopes[1], slopes[2], slopes[3], slopes[4], slopes[5], slopes[6], slopes[7],
    ])
  }

  private uniform(data: Float32Array): NativeBuffer {
    const buffer = this.gpu.gpu.createBuffer({ size: Math.ceil(data.byteLength / 16) * 16, usage: BUFFER_UNIFORM | BUFFER_COPY_DST })
    this.gpu.gpu.queue.writeBuffer(buffer, 0, data)
    return buffer
  }

  private bind(drawable: Draw, resources: readonly NativeBindingResource[]): NativeBindGroup {
    return this.gpu.gpu.createBindGroup({ layout: drawable.layout(0), entries: resources.map((resource, binding) => ({ binding, resource })) })
  }

  private pruneRetained(active: ReadonlySet<string>): void {
    for (const [nodeId, state] of this.retained) {
      if (active.has(nodeId)) continue
      this.destroyState(state)
      this.retained.delete(nodeId)
    }
  }

  private clearRetained(): void {
    for (const state of this.retained.values()) this.destroyState(state)
    this.retained.clear()
  }

  private destroyState(state: RetainedNodeState): void {
    for (const buffer of state.buffers) buffer.destroy()
    state.curveTexture?.destroy()
    state.target.color.destroy()
  }
}

function blendIndex(mode: ImageEditBlendModeV3): number {
  return mode === 'multiply' ? 1 : mode === 'screen' ? 2 : mode === 'overlay' ? 3 : mode === 'soft-light' ? 4 : 0
}

function sameDependencies(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

function viewportFingerprint(layout: ImageEditorViewportLayoutV3): string {
  const viewport = layout.viewport
  return [
    viewport.documentX, viewport.documentY, viewport.zoom, viewport.devicePixelRatio,
    viewport.width, viewport.height,
  ].join(':')
}
