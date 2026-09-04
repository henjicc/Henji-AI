import { draw, frame, target, type Draw, type Gpu, type Target, type Texture } from 'vgpu'

import { invertImageEditTransformV3 } from '@/core/imageEdit/v3/execution/affineTransform'
import type { ImageEditBlendModeV3, ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
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
import type { ImageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'
import adjustmentShader from './shaders/imageEditorGpuGraphAdjustmentV3.wgsl?raw'
import compositeShader from './shaders/imageEditorGpuGraphCompositeV3.wgsl?raw'
import copyShader from './shaders/imageEditorGpuGraphCopyV3.wgsl?raw'
import curvesShader from './shaders/imageEditorGpuGraphCurvesV3.wgsl?raw'
import normalShader from './shaders/imageEditorGpuGraphNormalV3.wgsl?raw'
import sourceShader from './shaders/imageEditorGpuGraphSourceV3.wgsl?raw'

const BUFFER_COPY_DST = 0x08
const BUFFER_UNIFORM = 0x40
const CLEAR = [0, 0, 0, 0] as const
type NativeBuffer = ReturnType<Gpu['gpu']['createBuffer']>
type NativeBindGroup = ReturnType<Gpu['gpu']['createBindGroup']>
type NativeBindingResource = unknown

export interface ImageEditorGpuGraphTextureV3 {
  readonly key: ImageEditorGpuSceneTileKeyV3
  readonly tile: { originX: number; originY: number; width: number; height: number }
  readonly texture: Texture
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
  resource: ImageEditorGpuGraphTextureV3 | null
  mask: ImageEditorGpuGraphTextureV3 | null
  fingerprint: string
}

export interface ImageEditorGpuRenderGraphStatsV3 {
  renderedNodeCount: number
  cacheHitCount: number
  invalidatedNodeCount: number
  fusedAdjustmentCount: number
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
  private scene: ImageEditorGpuRasterSceneV3 | null = null
  private stats: ImageEditorGpuRenderGraphStatsV3 = {
    renderedNodeCount: 0, cacheHitCount: 0, invalidatedNodeCount: 0, fusedAdjustmentCount: 0,
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
  ): Promise<Target | null> {
    if (!this.scene?.outputNodeId) return null
    const outputs = new Map<string, Target>()
    const fingerprints = new Map<string, string>()
    const tasks: GraphTask[] = []
    const aliases = new Set<string>()
    for (const node of this.scene.graph) {
      if (node.kind === 'alias') {
        const input = outputs.get(node.inputNodeId)
        const inputFingerprint = fingerprints.get(node.inputNodeId)
        if (!input || !inputFingerprint) throw new Error(`GPU RenderGraph 缺少组输入：${node.nodeId}`)
        outputs.set(node.nodeId, input)
        fingerprints.set(node.nodeId, `${node.fingerprint}:${inputFingerprint}`)
        aliases.add(node.nodeId)
        continue
      }
      const input = node.kind === 'source' ? null : outputs.get(node.kind === 'composite' ? node.contentNodeId : node.inputNodeId) ?? null
      const backdrop = node.kind === 'composite' && node.backdropNodeId ? outputs.get(node.backdropNodeId) ?? null : null
      const resource = node.kind === 'source' ? resolve(node.resourceKey) : null
      const mask = node.kind === 'source' ? null : this.resolveMask(node.kind === 'composite' ? node.mask : node.adjustments[0]?.mask ?? null, resolve)
      const fingerprint = this.fingerprint(node, fingerprints)
      const dependencies = [input, backdrop, resource, mask]
      const retained = this.retained.get(node.nodeId)
      if (retained && retained.fingerprint === fingerprint && sameDependencies(retained.dependencies, dependencies)) {
        outputs.set(node.nodeId, retained.target)
        fingerprints.set(node.nodeId, fingerprint)
        this.stats.cacheHitCount += 1
        continue
      }
      if (node.kind === 'source' && !resource) throw new Error(`GPU RenderGraph 缺少源纹理：${node.layerId}`)
      if (node.kind !== 'source' && !input) throw new Error(`GPU RenderGraph 缺少节点输入：${node.nodeId}`)
      // source decode cache is not a compositing intermediate: keep it f32 so the first
      // rgba16float attachment blend does not pay an avoidable extra half-float roundtrip.
      const output = target(this.gpu, {
        size: [this.scene.width, this.scene.height],
        format: node.kind === 'source' ? 'rgba32float' : 'rgba16float',
        clearColor: CLEAR,
        label: `image-editor-graph:${node.nodeId}`,
      })
      outputs.set(node.nodeId, output)
      fingerprints.set(node.nodeId, fingerprint)
      tasks.push({ node, target: output, backdrop, input, resource, mask, fingerprint })
    }
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
  }

  private fingerprint(node: Exclude<ImageEditorGpuRenderGraphNodeV3, { kind: 'alias' }>, fingerprints: ReadonlyMap<string, string>): string {
    if (node.kind === 'source') return node.fingerprint
    const input = fingerprints.get(node.kind === 'composite' ? node.contentNodeId : node.inputNodeId) ?? 'missing'
    const backdrop = node.kind === 'composite' && node.backdropNodeId ? fingerprints.get(node.backdropNodeId) ?? 'missing' : 'transparent'
    const transform = node.kind === 'composite' ? this.transientTransforms.get(node.layerId) ?? node.transform : null
    return `${node.fingerprint}:${input}:${backdrop}:${transform?.join(',') ?? ''}`
  }

  private resolveMask(mask: ImageEditorGpuGraphMaskV3 | null, resolve: (key: ImageEditorGpuSceneTileKeyV3) => ImageEditorGpuGraphTextureV3 | null): ImageEditorGpuGraphTextureV3 | null {
    return mask?.key ? resolve(mask.key) : null
  }

  private async compileTasks(tasks: readonly GraphTask[]): Promise<void> {
    const draws = new Map<Draw, Target>()
    for (const task of tasks) {
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
      const buffer = this.uniform(new Float32Array([task.resource!.tile.originX, task.resource!.tile.originY, task.resource!.tile.width, task.resource!.tile.height]))
      buffers.push(buffer)
      this.sourceDraw.group(0, this.bind(this.sourceDraw, [task.resource!.texture.view, { buffer }]))
      currentFrame.pass(task.target, this.sourceDraw)
    } else if (task.node.kind === 'composite') {
      const values = this.compositeValues(task.node)
      const buffer = this.uniform(values)
      buffers.push(buffer)
      const maskView = task.mask?.texture.view ?? this.fallbackMask.view
      if (task.node.blendMode === 'normal' || !task.backdrop) {
        if (task.backdrop) {
          this.copyDraw.group(0, this.bind(this.copyDraw, [task.backdrop.color.view]))
          currentFrame.pass(task.target, this.copyDraw)
        }
        this.normalDraw.group(0, this.bind(this.normalDraw, [task.input!.color.view, maskView, { buffer }]))
        currentFrame.pass({ target: task.target, clear: !task.backdrop }, this.normalDraw)
      } else {
        this.compositeDraw.group(0, this.bind(this.compositeDraw, [task.backdrop.color.view, task.input!.color.view, maskView, { buffer }]))
        currentFrame.pass(task.target, this.compositeDraw)
      }
    } else if (task.node.adjustments[0]?.definitionId === 'adjustment.curves') {
      const adjustment = task.node.adjustments[0]
      const curves = imageEditorGpuCurveDataV3(adjustment.parameters)
      curveTexture = this.gpu.device.createTexture({ size: [4096, 4], format: 'r32float', usage: ['copy_dst', 'texture_binding'], label: `image-editor-curves:${task.node.layerId}` })
      this.gpu.gpu.queue.writeTexture({ texture: curveTexture.gpu }, curves.values, { bytesPerRow: 4096 * 4, rowsPerImage: 4 }, { width: 4096, height: 4, depthOrArrayLayers: 1 })
      const buffer = this.uniform(this.curveValues(adjustment, curves.slopes))
      buffers.push(buffer)
      this.curvesDraw.group(0, this.bind(this.curvesDraw, [task.input!.color.view, task.mask?.texture.view ?? this.fallbackMask.view, curveTexture.view, { buffer }]))
      currentFrame.pass(task.target, this.curvesDraw)
    } else {
      const buffer = this.uniform(this.adjustmentValues(task.node))
      buffers.push(buffer)
      this.adjustmentDraw.group(0, this.bind(this.adjustmentDraw, [task.input!.color.view, task.mask?.texture.view ?? this.fallbackMask.view, { buffer }]))
      currentFrame.pass(task.target, this.adjustmentDraw)
      if (task.node.adjustments.length > 1) this.stats.fusedAdjustmentCount += task.node.adjustments.length - 1
    }
    return { fingerprint: task.fingerprint, target: task.target, dependencies: [task.input, task.backdrop, task.resource, task.mask], buffers, curveTexture }
  }

  private compositeValues(node: ImageEditorGpuGraphCompositeNodeV3): Float32Array {
    const transform = this.transientTransforms.get(node.layerId) ?? node.transform
    const inverse = invertImageEditTransformV3(transform)
    return new Float32Array([
      inverse[0], inverse[1], inverse[2], inverse[3], inverse[4], inverse[5], 0, 0,
      node.opacity, blendIndex(node.blendMode), 0, 0,
      node.mask ? 1 : 0, node.mask?.defaultValue ?? 1, node.mask?.inverted ? 1 : 0, 0,
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
