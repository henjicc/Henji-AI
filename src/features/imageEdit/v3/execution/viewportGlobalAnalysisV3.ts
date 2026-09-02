import {
  DIFFUSION_V4_RECIPE_ADAPTER,
  VGPU_GLOW_V4_RECIPE_ADAPTER,
  ImageEditRenderCaches,
  ImageEditResourceBudget,
  applyDiffusionV4,
  applyFastBlurV3,
  applyVgpuGlowV4,
  buildDiffusionScatterV4,
  buildVgpuGlowScatterV4,
  convertFloat32TileColorDomainV3,
  createBuiltInImageEditRenderNodeRegistry,
  createFloat32PremultipliedRgbaTile,
  mixCustomEffectMaskV3,
  resolveFastBlurV3Geometry,
  type Float32MaskTile,
  type Float32PremultipliedRgbaTile,
  type ImageEditDocumentV3,
  type ImageEditRect,
  type ImageEditRenderPlan,
  type ImageEditRenderPlanNode,
  type ImageEditRenderQuality,
} from '@/core/imageEdit/v3'

const MEBIBYTE = 1024 * 1024
const ANALYSIS_CACHE_BYTES = 160 * MEBIBYTE
const registry = createBuiltInImageEditRenderNodeRegistry()

interface ViewportGlobalAnalysisEntryV3 {
  kind: 'fast-blur' | 'diffusion' | 'vgpu-glow'
  tile: Float32PremultipliedRgbaTile
  documentWidth: number
  documentHeight: number
  mip: number
}

export interface PrepareViewportGlobalAnalysesV3 {
  document: ImageEditDocumentV3
  originalPlan: ImageEditRenderPlan
  scaledPlan: ImageEditRenderPlan
  mip: number
  quality: ImageEditRenderQuality
  signal: AbortSignal
  renderInput(plan: ImageEditRenderPlan, region: ImageEditRect): Promise<Float32PremultipliedRgbaTile | null>
}

export interface ExecuteViewportGlobalAnalysisV3 {
  node: ImageEditRenderPlanNode
  originalNode: ImageEditRenderPlanNode
  source: Float32PremultipliedRgbaTile
  mask?: Float32MaskTile
  region: ImageEditRect
  mip: number
  document: ImageEditDocumentV3
  quality: ImageEditRenderQuality
  required?: boolean
  fallback(): Promise<Float32PremultipliedRgbaTile>
}

function numberParameter(node: ImageEditRenderPlanNode, key: string, fallback: number): number {
  const value = node.parameters[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function yieldToAnalysisEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function isSharedAnalysisNode(node: ImageEditRenderPlanNode): boolean {
  if (node.definitionId === 'effect.fast-blur') {
    return resolveFastBlurV3Geometry({
      radius: numberParameter(node, 'radius', 0),
      mip: numberParameter(node, 'mip', 0),
    }).requiresGlobalAnalysis
  }
  return node.definitionId === 'effect.diffusion' || node.definitionId === 'effect.vgpu-glow'
}

function dependencyPlan(plan: ImageEditRenderPlan, outputNodeId: string): ImageEditRenderPlan {
  const byId = new Map(plan.nodes.map((node) => [node.id, node]))
  const needed = new Set<string>()
  const visit = (nodeId: string): void => {
    if (needed.has(nodeId)) return
    const node = byId.get(nodeId)
    if (!node) throw new Error(`全局分析缺少输入节点：${nodeId}`)
    needed.add(nodeId)
    node.inputNodeIds.forEach(visit)
  }
  visit(outputNodeId)
  return {
    ...plan,
    nodes: plan.nodes.filter((node) => needed.has(node.id)),
    passes: [],
    outputNodeId,
    outputHash: byId.get(outputNodeId)?.subtreeHash ?? plan.outputHash,
  }
}

function colorKey(document: ImageEditDocumentV3): string {
  return JSON.stringify(document.color)
}

function analysisIdentity(
  node: ImageEditRenderPlanNode,
  document: ImageEditDocumentV3,
  quality: ImageEditRenderQuality,
): string {
  const definition = registry.get(node.definitionId)
  return [
    node.id,
    node.subtreeHash,
    definition?.version ?? 0,
    quality,
    colorKey(document),
    'cpu',
    'device:0',
  ].join(':')
}

function sampleAnalysisRegion(
  analysis: ViewportGlobalAnalysisEntryV3,
  region: ImageEditRect,
  source: Float32PremultipliedRgbaTile,
  mask?: Float32MaskTile,
): Float32PremultipliedRgbaTile {
  const data = new Float32Array(source.data.length)
  const tile = analysis.tile
  for (let y = 0; y < source.height; y += 1) {
    const sourceY = region.y + (y + 0.5) * region.height / source.height
    const sampleY = sourceY * tile.height / analysis.documentHeight - 0.5
    const y0 = Math.max(0, Math.min(tile.height - 1, Math.floor(sampleY)))
    const y1 = Math.min(tile.height - 1, y0 + 1)
    const fy = sampleY - Math.floor(sampleY)
    for (let x = 0; x < source.width; x += 1) {
      const sourceX = region.x + (x + 0.5) * region.width / source.width
      const sampleX = sourceX * tile.width / analysis.documentWidth - 0.5
      const x0 = Math.max(0, Math.min(tile.width - 1, Math.floor(sampleX)))
      const x1 = Math.min(tile.width - 1, x0 + 1)
      const fx = sampleX - Math.floor(sampleX)
      const target = (y * source.width + x) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        const top = tile.data[(y0 * tile.width + x0) * 4 + channel] * (1 - fx)
          + tile.data[(y0 * tile.width + x1) * 4 + channel] * fx
        const bottom = tile.data[(y1 * tile.width + x0) * 4 + channel] * (1 - fx)
          + tile.data[(y1 * tile.width + x1) * 4 + channel] * fx
        data[target + channel] = top * (1 - fy) + bottom * fy
      }
    }
  }
  const processed = createFloat32PremultipliedRgbaTile(
    source.width,
    source.height,
    'linear-light',
    data,
    source.workingSpace,
    source.transferFunction,
    source.referenceWhiteNits,
  )
  return mixCustomEffectMaskV3(source, processed, mask)
}

/** 所有全局节点共用最严格的 maxEdge，避免分析请求超过任一节点的资源契约。 */
export function resolveImageEditorViewportAnalysisMipV3(
  document: ImageEditDocumentV3,
  plan: ImageEditRenderPlan,
): number | null {
  const maxEdges = plan.nodes
    .filter(isSharedAnalysisNode)
    .map((node) => registry.get(node.definitionId)?.globalAnalysis?.maxEdge)
    .filter((value): value is number => typeof value === 'number')
  if (maxEdges.length === 0) return null
  const maxEdge = Math.min(...maxEdges)
  return Math.max(0, Math.ceil(
    Math.log2(Math.max(document.geometry.width, document.geometry.height) / maxEdge),
  ))
}

export class ImageEditorViewportGlobalAnalysisCacheV3 {
  private readonly budget = new ImageEditResourceBudget({
    totalBytes: 192 * MEBIBYTE,
    cpuCacheTargetBytes: ANALYSIS_CACHE_BYTES,
    gpuTargetBytes: 0,
  })
  private readonly caches = new ImageEditRenderCaches<ViewportGlobalAnalysisEntryV3>({
    budget: this.budget,
    tierBudgets: {
      'source-proxy': 0,
      'node-tile': 0,
      'global-analysis': ANALYSIS_CACHE_BYTES,
      viewport: 0,
    },
  })
  private readonly keyByIdentity = new Map<string, string>()

  async prepare(options: PrepareViewportGlobalAnalysesV3): Promise<void> {
    const originalById = new Map(options.originalPlan.nodes.map((node) => [node.id, node]))
    const region = {
      x: 0,
      y: 0,
      width: Math.max(1, Math.ceil(options.document.geometry.width / (2 ** options.mip))),
      height: Math.max(1, Math.ceil(options.document.geometry.height / (2 ** options.mip))),
    }
    for (const node of options.scaledPlan.nodes.filter(isSharedAnalysisNode)) {
      await yieldToAnalysisEventLoop()
      if (options.signal.aborted) throw options.signal.reason
      const originalNode = originalById.get(node.id)
      if (!originalNode) throw new Error(`全局分析找不到原始节点：${node.id}`)
      const identity = analysisIdentity(originalNode, options.document, options.quality)
      const key = `${identity}:m${options.mip}`
      const existing = this.caches.lease('global-analysis', key)
      if (existing) {
        this.keyByIdentity.set(identity, key)
        existing.release()
        continue
      }
      const inputNodeId = node.inputNodeIds[0]
      if (!inputNodeId) throw new Error(`全局效果缺少输入节点：${node.id}`)
      const input = await options.renderInput(dependencyPlan(options.scaledPlan, inputNodeId), region)
      if (!input) throw new Error(`全局效果输入无法求值：${node.id}`)
      await yieldToAnalysisEventLoop()
      if (options.signal.aborted) throw options.signal.reason
      const linear = convertFloat32TileColorDomainV3(input, 'linear-light')
      const entry = this.buildEntry(node, linear, options)
      await yieldToAnalysisEventLoop()
      if (options.signal.aborted) throw options.signal.reason
      if (!this.caches.set('global-analysis', key, {
        value: entry,
        bytes: entry.tile.data.byteLength,
        category: 'cpu-cache',
        deviceGeneration: this.budget.snapshot().deviceGeneration,
      })) throw new Error('全局分析缓存超过 Worker 资源预算')
      this.keyByIdentity.set(identity, key)
    }
  }

  async execute(options: ExecuteViewportGlobalAnalysisV3): Promise<Float32PremultipliedRgbaTile> {
    const identity = analysisIdentity(options.originalNode, options.document, options.quality)
    const key = this.keyByIdentity.get(identity)
    const lease = key ? this.caches.lease('global-analysis', key) : null
    if (!lease) {
      if (isSharedAnalysisNode(options.originalNode)) {
        const phase = options.required ? '目标视口' : '全局效果预览'
        throw new Error(`${phase}缺少共享全局分析：${options.originalNode.id}`)
      }
      return options.fallback()
    }
    try {
      const analysis = lease.value
      const scale = 2 ** options.mip
      const sourceRegion = {
        x: options.region.x * scale,
        y: options.region.y * scale,
        width: options.region.width * scale,
        height: options.region.height * scale,
      }
      if (analysis.kind === 'fast-blur') {
        return sampleAnalysisRegion(analysis, sourceRegion, options.source, options.mask)
      }
      if (analysis.kind === 'diffusion') {
        const recipe = DIFFUSION_V4_RECIPE_ADAPTER.compileRecipe(
          DIFFUSION_V4_RECIPE_ADAPTER.parseParameters(options.originalNode.parameters),
          {
            width: options.document.geometry.width,
            height: options.document.geometry.height,
            quality: options.quality === 'draft' ? 'realtime' : 'high',
          },
        )
        return applyDiffusionV4(
          convertFloat32TileColorDomainV3(options.source, 'linear-light'),
          recipe,
          { mask: options.mask, globalScatter: {
            tile: analysis.tile,
            documentWidth: analysis.documentWidth,
            documentHeight: analysis.documentHeight,
            sourceX: sourceRegion.x,
            sourceY: sourceRegion.y,
            sourceWidth: sourceRegion.width,
            sourceHeight: sourceRegion.height,
          } },
        )
      }
      const recipe = VGPU_GLOW_V4_RECIPE_ADAPTER.compileRecipe(
        VGPU_GLOW_V4_RECIPE_ADAPTER.parseParameters(options.originalNode.parameters),
        { width: options.document.geometry.width, height: options.document.geometry.height },
      )
      return applyVgpuGlowV4(
        convertFloat32TileColorDomainV3(options.source, 'linear-light'),
        recipe,
        { mask: options.mask, globalScatter: {
          tile: analysis.tile,
          documentWidth: analysis.documentWidth,
          documentHeight: analysis.documentHeight,
          sourceX: sourceRegion.x,
          sourceY: sourceRegion.y,
          sourceWidth: sourceRegion.width,
          sourceHeight: sourceRegion.height,
        } },
      )
    } finally {
      lease.release()
    }
  }

  dispose(): void {
    this.keyByIdentity.clear()
    this.caches.clearTier('global-analysis')
  }

  private buildEntry(
    node: ImageEditRenderPlanNode,
    source: Float32PremultipliedRgbaTile,
    options: PrepareViewportGlobalAnalysesV3,
  ): ViewportGlobalAnalysisEntryV3 {
    const shared = {
      documentWidth: options.document.geometry.width,
      documentHeight: options.document.geometry.height,
      mip: options.mip,
    }
    if (node.definitionId === 'effect.fast-blur') {
      return { ...shared, kind: 'fast-blur', tile: applyFastBlurV3(source, {
        radius: numberParameter(node, 'radius', 0),
        mip: numberParameter(node, 'mip', options.mip),
      }) }
    }
    if (node.definitionId === 'effect.diffusion') {
      const recipe = DIFFUSION_V4_RECIPE_ADAPTER.compileRecipe(
        DIFFUSION_V4_RECIPE_ADAPTER.parseParameters(node.parameters),
        {
          width: source.width,
          height: source.height,
          quality: options.quality === 'draft' ? 'realtime' : 'high',
        },
      )
      return { ...shared, kind: 'diffusion', tile: buildDiffusionScatterV4(source, recipe) }
    }
    const recipe = VGPU_GLOW_V4_RECIPE_ADAPTER.compileRecipe(
      VGPU_GLOW_V4_RECIPE_ADAPTER.parseParameters(node.parameters),
      { width: source.width, height: source.height },
    )
    return { ...shared, kind: 'vgpu-glow', tile: buildVgpuGlowScatterV4(source, recipe) }
  }
}
