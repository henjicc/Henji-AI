import { draw, frame, target, type Draw, type Gpu, type Target, type Texture } from 'vgpu'
import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import type {
  ImageEditorGpuRasterSceneV3,
  ImageEditorGpuRenderGraphNodeV3,
} from './imageEditorGpuRasterSceneCompilerV3'
import type { ImageEditorGpuPlannedLayerV3 } from './imageEditorGpuTilePlannerV3'
import type { ImageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'
import type { ImageEditorGpuTileAtlasAllocationV3 } from './imageEditorGpuTileAtlasV3'
import { imageEditorGpuCameraUniformV3, imageEditorGpuOutputPixelSizeV3 } from './imageEditorGpuRasterSupportV3'
import {
  imageEditorGpuGraphAdjustmentValuesV3,
  imageEditorGpuGraphCompositeValuesV3,
  imageEditorGpuGraphCurveValuesV3,
  imageEditorGpuGraphSourceTileValuesV3,
  imageEditorGpuGraphViewportFingerprintV3,
} from './imageEditorGpuGraphUniformsV3'
import {
  ImageEditorGpuMaskAssemblerV3,
  type ImageEditorGpuPreparedMaskV3,
} from './imageEditorGpuMaskAssemblerV3'
import {
  ImageEditorGpuEffectExecutorV3,
  type ImageEditorGpuPreparedEffectV3,
} from './imageEditorGpuEffectExecutorV3'
import { ImageEditorGpuEffectCropperV3 } from './imageEditorGpuEffectCropperV3'
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
  node: Exclude<ImageEditorGpuRenderGraphNodeV3, { kind: 'alias' | 'effect' }>
  target: Target
  backdrop: Target | null
  input: Target | null
  sourcePlan: ImageEditorGpuGraphSourcePlanV3 | null
  sourceFingerprint: string | null
  mask: Target | null
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
  private readonly maskAssembler: ImageEditorGpuMaskAssemblerV3
  private readonly effectExecutor: ImageEditorGpuEffectExecutorV3
  private readonly effectCropper: ImageEditorGpuEffectCropperV3
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
    this.maskAssembler = new ImageEditorGpuMaskAssemblerV3(gpu, onPipelineCompiled)
    this.effectExecutor = new ImageEditorGpuEffectExecutorV3(gpu, this.fallbackMask, onPipelineCompiled)
    this.effectCropper = new ImageEditorGpuEffectCropperV3(gpu, onPipelineCompiled)
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
    maskPlans: ReadonlyMap<string, ImageEditorGpuGraphSourcePlanV3>,
    layout: ImageEditorViewportLayoutV3,
    outputLayout: ImageEditorViewportLayoutV3 = layout,
    cropOffset: readonly [number, number] = [0, 0],
    effectRecipeSize?: readonly [number, number],
  ): Promise<Target | null> {
    if (!this.scene?.outputNodeId) return null
    this.layout = layout
    const outputs = new Map<string, Target>()
    const fingerprints = new Map<string, string>()
    const tasks: GraphTask[] = []
    const preparedEffects: ImageEditorGpuPreparedEffectV3[] = []
    const operations: Array<{ kind: 'graph'; task: GraphTask } | {
      kind: 'effect'; effect: ImageEditorGpuPreparedEffectV3
    }> = []
    const aliases = new Set<string>()
    const virtualSources = new Map<string, VirtualSourceV3>()
    const preparedMasks: ImageEditorGpuPreparedMaskV3[] = []
    const maskTargets = new Map<string, Target>()
    const activeMaskKeys = new Set<string>()
    for (const node of this.scene.graph) {
      if (node.kind === 'source' || node.kind === 'alias') continue
      const masks = node.kind === 'composite'
        ? [node.mask]
        : node.kind === 'effect' ? [node.mask] : node.adjustments.map((entry) => entry.mask)
      for (const mask of masks) {
        if (!mask) continue
        const cacheKey = `${node.nodeId}:${mask.maskId}`
        if (maskTargets.has(cacheKey)) continue
        const plan = maskPlans.get(mask.maskId)
        if (!plan) continue
        const transform = node.kind === 'composite'
          ? this.transientTransforms.get(node.layerId) ?? node.transform
          : [1, 0, 0, 1, 0, 0] as ImageEditTransformV3
        const prepared = this.maskAssembler.prepare(cacheKey, mask, plan, transform, layout)
        preparedMasks.push(prepared)
        activeMaskKeys.add(cacheKey)
        maskTargets.set(cacheKey, prepared.target)
      }
    }
    for (const node of this.scene.graph) {
      if (node.kind === 'source') {
        const plan = sourcePlans.get(node.layerId)
        if (!plan || plan.resources.length === 0) {
          throw new Error(`GPU RenderGraph 缺少源瓦片：${node.layerId}`)
        }
        const fingerprint = `${this.fingerprint(node, fingerprints)}:${imageEditorGpuGraphViewportFingerprintV3(layout)}`
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
      if (node.kind === 'effect') {
        const input = outputs.get(node.inputNodeId)
        if (!input) throw new Error(`GPU RenderGraph 缺少效果输入：${node.nodeId}`)
        const mask = node.mask ? maskTargets.get(`${node.nodeId}:${node.mask.maskId}`) ?? null : null
        const fingerprint = `${this.fingerprint(node, fingerprints)}:${imageEditorGpuGraphViewportFingerprintV3(layout)}`
        const prepared = this.effectExecutor.prepare(
          node, input, mask, fingerprint, layout.viewport.zoom * layout.viewport.devicePixelRatio,
          effectRecipeSize,
        )
        preparedEffects.push(prepared)
        operations.push({ kind: 'effect', effect: prepared })
        outputs.set(node.nodeId, prepared.output)
        fingerprints.set(node.nodeId, fingerprint)
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
      const maskDefinition = node.kind === 'composite' ? node.mask : node.adjustments[0]?.mask ?? null
      const mask = maskDefinition ? maskTargets.get(`${node.nodeId}:${maskDefinition.maskId}`) ?? null : null
      const fingerprint = `${this.fingerprint(node, fingerprints)}:${imageEditorGpuGraphViewportFingerprintV3(layout)}`
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
      operations.push({ kind: 'graph', task: tasks[tasks.length - 1] })
    }
    this.gpu.gpu.queue.writeBuffer(
      this.cameraBuffer, 0, imageEditorGpuCameraUniformV3(layout, this.scene.geometry),
    )
    if (tasks.some((task) => task.sourcePlan)) this.ensureSourceScratch(layout)
    const graphOutput = outputs.get(this.scene.outputNodeId) ?? null
    const outputSize = imageEditorGpuOutputPixelSizeV3(outputLayout)
    const cropNeeded = graphOutput !== null && (
      cropOffset[0] !== 0 || cropOffset[1] !== 0
      || graphOutput.size[0] !== outputSize[0] || graphOutput.size[1] !== outputSize[1]
    )
    const croppedOutput = cropNeeded
      ? this.effectCropper.prepare(graphOutput, outputSize, cropOffset)
      : graphOutput
    const replacements = new Map<string, RetainedNodeState>()
    try {
      await Promise.all([this.compileTasks(tasks), this.maskAssembler.compile(preparedMasks),
        this.effectExecutor.compile(preparedEffects), ...(cropNeeded ? [this.effectCropper.compile()] : [])])
      this.maskAssembler.updateCamera(layout, this.scene.geometry)
      const submitted = operations.length > 0 || preparedMasks.some((entry) => entry.pending) || cropNeeded
        ? frame(this.gpu, (currentFrame) => {
          for (const mask of preparedMasks) this.maskAssembler.encode(currentFrame, mask)
          for (const operation of operations) {
            if (operation.kind === 'effect') this.effectExecutor.encode(currentFrame, operation.effect)
            else replacements.set(operation.task.node.nodeId, this.encodeTask(currentFrame, operation.task))
          }
          if (cropNeeded) this.effectCropper.encode(currentFrame)
        }) : null
      if (submitted) await submitted.done
    } catch (error) {
      this.maskAssembler.discard(preparedMasks); this.effectExecutor.discard(preparedEffects)
      for (const state of replacements.values()) this.destroyState(state)
      const replaced = new Set([...replacements.values()].map((state) => state.target))
      for (const task of tasks) if (!replaced.has(task.target)) task.target.color.destroy()
      throw error
    }
    this.maskAssembler.commit(preparedMasks)
    this.maskAssembler.prune(activeMaskKeys)
    this.effectExecutor.commit(preparedEffects)
    this.effectExecutor.prune(
      new Set(preparedEffects.map((entry) => entry.node.nodeId)),
      new Set(preparedEffects.map((entry) => entry.rendererKey)),
    )
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
    return croppedOutput
  }

  dispose(): void {
    this.clearRetained()
    this.fallbackMask.destroy()
    this.maskAssembler.dispose()
    this.effectExecutor.dispose()
    this.effectCropper.dispose()
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
      const values = imageEditorGpuGraphCompositeValuesV3(
        task.node, task.sourcePlan !== null, this.transientTransforms.get(task.node.layerId), this.layout!,
      )
      const buffer = this.uniform(values)
      buffers.push(buffer)
      const maskView = task.mask?.color.view ?? this.fallbackMask.view
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
      const { curve: curves, values } = imageEditorGpuGraphCurveValuesV3(adjustment)
      curveTexture = this.gpu.device.createTexture({ size: [4096, 4], format: 'r32float', usage: ['copy_dst', 'texture_binding'], label: `image-editor-curves:${task.node.layerId}` })
      this.gpu.gpu.queue.writeTexture({ texture: curveTexture.gpu }, curves.values, { bytesPerRow: 4096 * 4, rowsPerImage: 4 }, { width: 4096, height: 4, depthOrArrayLayers: 1 })
      const buffer = this.uniform(values)
      buffers.push(buffer)
      this.curvesDraw.group(0, this.bind(this.curvesDraw, [task.input!.color.view, task.mask?.color.view ?? this.fallbackMask.view, curveTexture.view, { buffer }]))
      currentFrame.pass(task.target, this.curvesDraw)
    } else {
      const buffer = this.uniform(imageEditorGpuGraphAdjustmentValuesV3(task.node))
      buffers.push(buffer)
      this.adjustmentDraw.group(0, this.bind(this.adjustmentDraw, [task.input!.color.view, task.mask?.color.view ?? this.fallbackMask.view, { buffer }]))
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
      const buffer = this.uniform(imageEditorGpuGraphSourceTileValuesV3(
        this.scene!, layer, planned, resource,
        identityTransform ? [1, 0, 0, 1, 0, 0]
          : this.transientTransforms.get(layer.layerId) ?? layer.transform,
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

function sameDependencies(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}
