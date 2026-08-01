import { createLogger } from '@/core/logging'
import {
  createMarkId,
  hasImageEditEffect,
  parseImageEditDocument,
  type ImageEditDocument,
} from '@/core/imageEdit'
import {
  addAssetToLibrary,
  deleteAsset,
  inspectAsset,
  listAssetLibraries,
  listAssetTags,
  queryAssets,
  removeAssetFromLibrary,
  setAssetTags,
} from '@/commands/assetLibrary'
import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore'
import { persistImageSource, readImageInfo } from '@/commands/image'
import { exportImageEditDocument } from '@/features/imageEdit/execution/browserImageEditExecution'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { addMediaReferenceToLibrary } from '@/features/assets/services/assetCollectionService'
import { assetSourceNodeData, assetSourceNodeType } from '@/features/canvas/application/assetMediaAssignment'
import { addCanvasNodeFromAgent } from '@/features/canvas/application/agentCanvasActions'
import type { AssetDragPayload } from '@/features/assets/drag/assetDragPayload'
import { notifyHostScopeChanged } from './hostContext/hostContext'
import { listStoryboardProjectSummaries, getStoryboardProjectRecord } from '@/commands/storyboardProjects'
import { buildImageEditDocumentFromAssistantOperations } from './imageEditAdapter'

const MAX_DETAIL_ITEMS = 32
const MAX_IMAGE_EDIT_PREVIEWS = 64
const logger = createLogger('features.assistant.hostActions')

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function summarizeCollection(value: unknown, fields: string[]): { count: number; ids: string[]; items: Record<string, unknown>[]; truncated: boolean } {
  const collection = Array.isArray(value) ? value : []
  const items = collection.slice(0, MAX_DETAIL_ITEMS).flatMap((item) => {
    if (!isRecord(item)) return []
    const summary: Record<string, unknown> = {}
    for (const field of fields) {
      const fieldValue = item[field]
      if (typeof fieldValue === 'string' || typeof fieldValue === 'number' || typeof fieldValue === 'boolean') summary[field] = fieldValue
    }
    return [summary]
  })
  const ids = items.flatMap((item) => typeof item.id === 'string' ? [item.id] : [])
  return { count: collection.length, ids, items, truncated: collection.length > MAX_DETAIL_ITEMS }
}

const imagePreviewRefs = new Map<string, {
  sourceRef: string
  source: string
  document: ImageEditDocument
}>()

function storeImageEditPreview(
  previewRef: string,
  preview: { sourceRef: string; source: string; document: ImageEditDocument }
): void {
  while (imagePreviewRefs.size >= MAX_IMAGE_EDIT_PREVIEWS) {
    const oldestRef = imagePreviewRefs.keys().next().value
    if (typeof oldestRef !== 'string') break
    imagePreviewRefs.delete(oldestRef)
  }
  imagePreviewRefs.set(previewRef, preview)
}

function touchAssetScope(): void {
  notifyHostScopeChanged('assets')
}

export function listToolboxToolsFromAgent(): Record<string, unknown>[] {
  return [
    { id: 'cameraStage', name: '3D 镜头参考', capabilities: ['project', 'object', 'shot', 'camera_move', 'render'] },
    { id: 'imageMark', name: '图片编辑', capabilities: ['preview', 'mark', 'crop', 'rotate', 'mirror', 'export'] },
  ]
}

export function getToolboxStateFromAgent(): Record<string, unknown> {
  const navigation = useNavigationStore.getState()
  const camera = useCameraStageStore.getState()
  return {
    activeToolId: navigation.activeToolId,
    cameraStage: {
      projectId: camera.currentProjectId,
      projectName: camera.currentProjectName,
      objectCount: camera.objects.length,
      shotCount: camera.shots.length,
      selectedObjectId: camera.selectedId,
      selectedShotId: camera.selectedShotId,
    },
  }
}

export async function listStoryboardProjectsFromAgent(): Promise<Record<string, unknown>[]> {
  return (await listStoryboardProjectSummaries()).map((project) => ({ ...project }))
}

export async function getStoryboardProjectFromAgent(projectId: string): Promise<Record<string, unknown>> {
  const project = await getStoryboardProjectRecord(projectId)
  if (!project) throw new Error('NOT_FOUND')
  const nodes = summarizeCollection(parseJsonValue(project.nodesJson), ['id', 'type', 'position', 'selected'])
  const edges = summarizeCollection(parseJsonValue(project.edgesJson), ['id', 'source', 'target', 'sourceHandle', 'targetHandle'])
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    nodeCount: project.nodeCount,
    nodeSummary: nodes,
    edgeSummary: edges,
    viewportBytes: utf8ByteLength(project.viewportJson),
  }
}

export async function createImageEditPreviewFromAgent(
  assetId: string,
  operations: Record<string, unknown>[],
  existingDocument?: unknown
): Promise<Record<string, unknown>> {
  logger.debug('image_edit.preview.create.start', { assetId, operationCount: operations.length })
  try {
    const asset = await inspectAsset(assetId)
    if (asset.mediaType !== 'image') throw new Error('INVALID_INPUT')
    const info = await readImageInfo(asset.filePath)
    const document = buildImageEditDocumentFromAssistantOperations(
      operations,
      info,
      existingDocument === undefined ? undefined : parseImageEditDocument(existingDocument)
    )
    const previewRef = `image-edit-preview:${createMarkId()}`
    storeImageEditPreview(previewRef, {
      sourceRef: `asset:${assetId}`,
      source: asset.filePath,
      document,
    })
    logger.info('image_edit.preview.create.completed', {
      assetId,
      previewRef,
      operationCount: operations.length,
    })
    return {
      previewRef,
      assetId,
      operationCount: operations.length,
      hasEffect: hasImageEditEffect(document),
      width: info.width,
      height: info.height,
    }
  } catch (error) {
    logger.error('image_edit.preview.create.failed', {
      assetId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export async function createImageEditPreviewFromApplicationRef(
  sourceRef: string,
  source: string,
  operations: Record<string, unknown>[],
  existingDocument?: unknown
): Promise<Record<string, unknown>> {
  logger.debug('image_edit.preview.create.start', { sourceRef, operationCount: operations.length })
  try {
    const info = await readImageInfo(source)
    const document = buildImageEditDocumentFromAssistantOperations(
      operations,
      info,
      existingDocument === undefined ? undefined : parseImageEditDocument(existingDocument)
    )
    const previewRef = `image-edit-preview:${createMarkId()}`
    storeImageEditPreview(previewRef, { sourceRef, source, document })
    logger.info('image_edit.preview.create.completed', {
      sourceRef,
      previewRef,
      operationCount: operations.length,
    })
    return {
      previewRef,
      sourceRef,
      operationCount: operations.length,
      hasEffect: hasImageEditEffect(document),
      width: info.width,
      height: info.height,
      document,
    }
  } catch (error) {
    logger.error('image_edit.preview.create.failed', {
      sourceRef,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export async function commitImageEditFromAgent(previewRef: string, displayName?: string): Promise<Record<string, unknown>> {
  logger.debug('image_edit.preview.commit.start', { previewRef })
  try {
    const preview = imagePreviewRefs.get(previewRef)
    if (!preview) throw new Error('NOT_FOUND')
    const rendered = await exportImageEditDocument(preview.source, preview.document)
    const filePath = await persistImageSource(rendered)
    const asset = await addMediaReferenceToLibrary({
      filePath,
      mediaType: 'image',
      source: 'canvas',
      displayName: displayName?.trim() || `编辑图片-${Date.now()}`,
    })
    imagePreviewRefs.delete(previewRef)
    touchAssetScope()
    logger.info('image_edit.preview.commit.completed', { previewRef, assetId: asset.id })
    return { previewRef, assetId: asset.id, status: 'committed' }
  } catch (error) {
    logger.error('image_edit.preview.commit.failed', {
      previewRef,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export async function queryAssetsFromAgent(input: Parameters<typeof queryAssets>[0]): Promise<Record<string, unknown>> {
  const page = await queryAssets(input)
  return { ...page, items: page.items.map((asset) => ({ ...asset, filePath: undefined })) }
}

export async function getAssetFromAgent(assetId: string): Promise<Record<string, unknown>> {
  const asset = await inspectAsset(assetId)
  return { ...asset, filePath: undefined }
}

export async function listAssetLibrariesFromAgent(): Promise<Record<string, unknown>[]> {
  return (await listAssetLibraries()).map((library) => ({ ...library }))
}

export async function listAssetTagsFromAgent(): Promise<string[]> {
  return await listAssetTags()
}

export async function selectAssetFromAgent(assetId: string | null): Promise<Record<string, unknown>> {
  const store = useAssetLibraryStore.getState()
  if (assetId) store.setSelectedAsset(await inspectAsset(assetId))
  else store.setSelectedAsset(null)
  touchAssetScope()
  return { assetId }
}

export async function setAssetTagsFromAgent(assetId: string, tags: string[]): Promise<Record<string, unknown>> {
  const asset = await setAssetTags(assetId, tags)
  touchAssetScope()
  return { assetId: asset.id, tags: asset.tags }
}

export async function addAssetToLibraryFromAgent(libraryId: string, assetId: string): Promise<Record<string, unknown>> {
  await addAssetToLibrary(libraryId, assetId)
  touchAssetScope()
  return { libraryId, assetId, status: 'added' }
}

export async function removeAssetFromLibraryFromAgent(libraryId: string, assetId: string): Promise<Record<string, unknown>> {
  await removeAssetFromLibrary(libraryId, assetId)
  touchAssetScope()
  return { libraryId, assetId, status: 'removed' }
}

export async function deleteAssetFromAgent(assetId: string): Promise<Record<string, unknown>> {
  await deleteAsset(assetId)
  if (useAssetLibraryStore.getState().selectedAsset?.id === assetId) useAssetLibraryStore.getState().setSelectedAsset(null)
  touchAssetScope()
  return { assetId, status: 'deleted' }
}

export async function addAssetToCanvasFromAgent(input: { projectId: string; assetId: string; placement: { mode: 'viewport_center' } | { mode: 'right_of_node'; anchorNodeId: string } }): Promise<Record<string, unknown>> {
  const asset = await inspectAsset(input.assetId)
  const payload: AssetDragPayload = {
    assetId: asset.id,
    type: asset.mediaType,
    sourceType: 'asset',
    filePath: asset.filePath,
    imageUrl: asset.displayUrl,
    thumbnailUrl: asset.thumbnailUrl,
    aspectRatio: asset.width && asset.height ? `${asset.width}:${asset.height}` : undefined,
    durationSeconds: asset.durationSeconds,
    displayName: asset.displayName,
  }
  const result = addCanvasNodeFromAgent({
    projectId: input.projectId,
    nodeType: assetSourceNodeType(asset.mediaType),
    placement: input.placement,
    data: assetSourceNodeData(payload),
  })
  return { ...result, assetId: asset.id, mediaType: asset.mediaType }
}
