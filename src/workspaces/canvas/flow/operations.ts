import { registry } from '@/core/ModelRegistry'
import { GenerationService } from '@/core/services/GenerationService'
import { saveUploadImage } from '@/utils/save'
import { createNode, pickFirst, resolveDisplayUrl } from '@/workspaces/canvas/flow/helpers'
import { composeStoryboardImage, splitImageToStoryboardFrames } from '@/workspaces/canvas/flow/storyboard'
import { ensureStoryboardGenFrames, normalizeCount } from '@/workspaces/canvas/flow/frameUtils'
import { collectIncomingMedia } from '@/workspaces/canvas/flow/media'
import {
  CANVAS_NODE_TYPES,
  type CanvasFlowEdge,
  type CanvasFlowNode,
  type ExportImageNodeData,
  type ImageEditNodeData,
  type MediaType,
  type StoryboardFrameItem,
  type StoryboardGenNodeData,
  type StoryboardSplitNodeData,
} from '@/workspaces/canvas/types'

type NodeUpdater = (prev: Record<string, unknown>) => Record<string, unknown>

interface CanvasOperationContext {
  getNodes: () => CanvasFlowNode[]
  getEdges: () => CanvasFlowEdge[]
  updateNodeData: (nodeId: string, updater: NodeUpdater) => void
  appendNode: (node: CanvasFlowNode) => void
  connectNodes: (sourceId: string, targetId: string) => void
}

function isImageMediaType(value: MediaType): boolean {
  return value === 'image'
}

function buildGenerationParams(
  prompt: string,
  params: Record<string, unknown>,
  incoming: ReturnType<typeof collectIncomingMedia>
): Record<string, unknown> {
  const nextParams: Record<string, unknown> = { ...params, prompt, text: prompt }
  if (incoming.images.length > 0) {
    nextParams.images = incoming.images
    nextParams.uploadedFilePaths = incoming.imagePaths
  }
  if (incoming.videos.length > 0) {
    nextParams.videos = incoming.videos
    nextParams.uploadedVideoFilePaths = incoming.videoPaths
  }
  return nextParams
}

export async function handleUploadSelectFileOperation(
  ctx: CanvasOperationContext,
  nodeId: string,
  file: File
): Promise<void> {
  try {
    const saved = await saveUploadImage(file, 'persist')
    ctx.updateNodeData(nodeId, (prev) => ({
      ...prev,
      imageUrl: saved.displaySrc,
      filePath: saved.fullPath,
    }))
  } catch {
    ctx.updateNodeData(nodeId, (prev) => ({
      ...prev,
      imageUrl: URL.createObjectURL(file),
      filePath: '',
    }))
  }
}

export async function handleImageGenerateOperation(
  ctx: CanvasOperationContext,
  nodeId: string
): Promise<void> {
  const currentNode = ctx.getNodes().find((node) => node.id === nodeId)
  if (!currentNode || currentNode.type !== CANVAS_NODE_TYPES.imageEdit) return
  const data = currentNode.data as ImageEditNodeData
  const model = registry.getModel(data.model)
  if (!model) {
    ctx.updateNodeData(nodeId, (prev) => ({ ...prev, error: '模型不存在' }))
    return
  }

  const incoming = collectIncomingMedia(nodeId, ctx.getNodes(), ctx.getEdges())
  const hasInput = data.prompt.trim().length > 0 || incoming.images.length > 0 || incoming.videos.length > 0
  if (!hasInput) {
    ctx.updateNodeData(nodeId, (prev) => ({ ...prev, error: '请输入提示词或连接输入媒体' }))
    return
  }

  ctx.updateNodeData(nodeId, (prev) => ({ ...prev, isGenerating: true, progress: 0, error: '' }))
  const params = buildGenerationParams(data.prompt, data.params, incoming)

  try {
    const result = await GenerationService.getInstance().generate(data.model, params, (status) => {
      if (typeof status.progress === 'number') {
        ctx.updateNodeData(nodeId, (prev) => ({ ...prev, progress: status.progress }))
      }
    }, { progressSource: 'canvas' })
    const firstUrl = pickFirst(result.url)
    const firstPath = pickFirst(result.filePath)
    if (!firstUrl) throw new Error('生成结果缺少 URL')

    const mediaType = model.meta.type as MediaType
    const displayUrl = await resolveDisplayUrl(mediaType, firstUrl, firstPath)
    ctx.updateNodeData(nodeId, (prev) => ({
      ...prev,
      imageUrl: isImageMediaType(mediaType) ? displayUrl : (prev.imageUrl as string | null),
      filePath: firstPath ?? '',
      isGenerating: false,
      progress: 100,
      error: '',
    }))

    const resultNode = createNode(
      CANVAS_NODE_TYPES.exportImage,
      { x: currentNode.position.x + 420, y: currentNode.position.y }
    )
    resultNode.data = {
      ...(resultNode.data as ExportImageNodeData),
      displayName: '结果图',
      imageUrl: displayUrl,
      filePath: firstPath ?? '',
      mediaType,
      resultKind: 'imageGenerateOutput',
    }
    ctx.appendNode(resultNode)
    ctx.connectNodes(nodeId, resultNode.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.updateNodeData(nodeId, (prev) => ({ ...prev, isGenerating: false, error: message }))
  }
}

export async function handleStoryboardGenerateOperation(
  ctx: CanvasOperationContext,
  nodeId: string
): Promise<void> {
  const currentNode = ctx.getNodes().find((node) => node.id === nodeId)
  if (!currentNode || currentNode.type !== CANVAS_NODE_TYPES.storyboardGen) return
  const data = currentNode.data as StoryboardGenNodeData
  const model = registry.getModel(data.model)
  if (!model) {
    ctx.updateNodeData(nodeId, (prev) => ({ ...prev, error: '模型不存在' }))
    return
  }

  const rows = normalizeCount(data.gridRows)
  const cols = normalizeCount(data.gridCols)
  const frames = ensureStoryboardGenFrames(rows, cols, data.frames)
  if (!frames.some((frame) => frame.description.trim().length > 0)) {
    ctx.updateNodeData(nodeId, (prev) => ({ ...prev, error: '请至少填写一个分镜描述' }))
    return
  }

  ctx.updateNodeData(nodeId, (prev) => ({ ...prev, isGenerating: true, progress: 0, error: '', frames }))
  const incoming = collectIncomingMedia(nodeId, ctx.getNodes(), ctx.getEdges())
  const service = GenerationService.getInstance()
  const generatedFrames: StoryboardFrameItem[] = []

  try {
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index]
      const description = frame.description.trim()
      if (!description) {
        generatedFrames.push({
          id: frame.id,
          imageUrl: null,
          filePath: '',
          note: '',
          order: index,
        })
        continue
      }

      const params = buildGenerationParams(
        description,
        { ...registry.getDefaultValues(data.model), ...data.extraParams },
        incoming
      )
      const result = await service.generate(data.model, params, (status) => {
        const step = typeof status.progress === 'number' ? status.progress / 100 : 0
        ctx.updateNodeData(nodeId, (prev) => ({
          ...prev,
          progress: Math.round(((index + step) / frames.length) * 100),
        }))
      }, { progressSource: 'canvas' })

      const firstUrl = pickFirst(result.url)
      const firstPath = pickFirst(result.filePath)
      if (!firstUrl) throw new Error(`分镜 ${index + 1} 生成失败：结果缺少 URL`)
      const displayUrl = await resolveDisplayUrl('image', firstUrl, firstPath)
      generatedFrames.push({
        id: frame.id,
        imageUrl: displayUrl,
        filePath: firstPath ?? '',
        note: description,
        order: index,
      })
    }

    ctx.updateNodeData(nodeId, (prev) => ({ ...prev, isGenerating: false, progress: 100, error: '' }))
    const storyboardNode = createNode(
      CANVAS_NODE_TYPES.storyboardSplit,
      { x: currentNode.position.x + 460, y: currentNode.position.y }
    )
    storyboardNode.data = {
      ...(storyboardNode.data as StoryboardSplitNodeData),
      displayName: '分镜切割',
      gridRows: rows,
      gridCols: cols,
      frames: generatedFrames,
      frameAspectRatio: '1:1',
      isSplitting: false,
      error: '',
    }
    ctx.appendNode(storyboardNode)
    ctx.connectNodes(nodeId, storyboardNode.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.updateNodeData(nodeId, (prev) => ({ ...prev, isGenerating: false, error: message }))
  }
}

export async function handleStoryboardSplitInputOperation(
  ctx: CanvasOperationContext,
  nodeId: string
): Promise<void> {
  const currentNode = ctx.getNodes().find((node) => node.id === nodeId)
  if (!currentNode || currentNode.type !== CANVAS_NODE_TYPES.storyboardSplit) return
  const data = currentNode.data as StoryboardSplitNodeData
  const rows = normalizeCount(data.gridRows)
  const cols = normalizeCount(data.gridCols)
  const incoming = collectIncomingMedia(nodeId, ctx.getNodes(), ctx.getEdges())
  const sourceImage = incoming.images[0]
  if (!sourceImage) {
    ctx.updateNodeData(nodeId, (prev) => ({ ...prev, error: '未找到可切割的上游图片' }))
    return
  }

  ctx.updateNodeData(nodeId, (prev) => ({ ...prev, isSplitting: true, error: '' }))
  try {
    const splitFrames = await splitImageToStoryboardFrames({ imageUrl: sourceImage, rows, cols })
    const nextFrames = splitFrames.map((frame, index) => ({
      ...frame,
      note: data.frames[index]?.note ?? frame.note,
      order: index,
    }))
    ctx.updateNodeData(nodeId, (prev) => ({
      ...prev,
      gridRows: rows,
      gridCols: cols,
      frames: nextFrames,
      isSplitting: false,
      error: '',
    }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.updateNodeData(nodeId, (prev) => ({ ...prev, isSplitting: false, error: message }))
  }
}

export async function handleStoryboardExportOperation(
  ctx: CanvasOperationContext,
  nodeId: string
): Promise<void> {
  const currentNode = ctx.getNodes().find((node) => node.id === nodeId)
  if (!currentNode || currentNode.type !== CANVAS_NODE_TYPES.storyboardSplit) return
  const data = currentNode.data as StoryboardSplitNodeData
  if (data.frames.length === 0) {
    ctx.updateNodeData(nodeId, (prev) => ({ ...prev, error: '没有可导出的分镜帧' }))
    return
  }

  try {
    const exported = await composeStoryboardImage({
      frames: data.frames,
      rows: data.gridRows,
      cols: data.gridCols,
      frameAspectRatio: data.frameAspectRatio || '1:1',
    })
    const resultNode = createNode(
      CANVAS_NODE_TYPES.exportImage,
      { x: currentNode.position.x + 460, y: currentNode.position.y }
    )
    resultNode.data = {
      ...(resultNode.data as ExportImageNodeData),
      displayName: '分镜导出',
      imageUrl: exported.imageUrl,
      filePath: exported.filePath,
      mediaType: 'image',
      resultKind: 'storyboardSplitExport',
    }
    ctx.appendNode(resultNode)
    ctx.connectNodes(nodeId, resultNode.id)
    ctx.updateNodeData(nodeId, (prev) => ({ ...prev, error: '' }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.updateNodeData(nodeId, (prev) => ({ ...prev, error: message }))
  }
}

export function createCanvasOperationContext(params: {
  getNodes: () => CanvasFlowNode[]
  getEdges: () => CanvasFlowEdge[]
  updateNodeData: (nodeId: string, updater: NodeUpdater) => void
  appendNode: (node: CanvasFlowNode) => void
  connectNodes: (sourceId: string, targetId: string) => void
}): CanvasOperationContext {
  return {
    getNodes: params.getNodes,
    getEdges: params.getEdges,
    updateNodeData: params.updateNodeData,
    appendNode: params.appendNode,
    connectNodes: params.connectNodes,
  }
}
