import { imageEditMarkItemSchema, imageEditOperationSchema } from '@/core/assistant/imageEditContracts'
import {
  addAssetToLibrary,
  createAsset,
  deleteAsset,
  inspectAsset,
  listAssetLibraries,
  listAssetTags,
  queryAssets,
  removeAssetFromLibrary,
  setAssetTags,
} from '@/commands/assetLibrary'
import {
  createNewProject,
  deleteProject as deleteCameraProject,
  listProjects as listCameraProjects,
  loadProjectIntoScene,
  renameProject as renameCameraProject,
  saveCurrentProject as saveCameraProject,
} from '@/features/cameraStage/projects/cameraStageProjectService'
import { useCameraStageSessionStore } from '@/features/cameraStage/store/cameraStageSessionStore'
import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore'
import type { StageObjectPatch, StagePrimitiveKind } from '@/features/cameraStage/domain/sceneTypes'
import { createMarkId, exportMarkedImage, type ImageMarkDoc, type MarkItem } from '@/features/imageMark'
import { applyOrientationOpToDoc, type OrientationOp } from '@/features/imageMark/domain/geometry'
import { createEmptyMarkDoc, hasMarkEffect } from '@/features/imageMark/domain/types'
import { persistImageSource, readImageInfo } from '@/commands/image'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { addMediaReferenceToLibrary } from '@/features/assets/services/assetCollectionService'
import { assetSourceNodeData, assetSourceNodeType } from '@/features/canvas/application/assetMediaAssignment'
import { addCanvasNodeFromAgent } from '@/features/canvas/application/agentCanvasActions'
import type { AssetDragPayload } from '@/features/assets/drag/assetDragPayload'
import { notifyHostScopeChanged } from './hostContext/hostContext'
import { listStoryboardProjectSummaries, getStoryboardProjectRecord } from '@/commands/storyboardProjects'

const MAX_DETAIL_ITEMS = 32

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

const imagePreviewRefs = new Map<string, { assetId: string; source: string; doc: ImageMarkDoc }>()

function requireCurrentCameraProject(projectId: string): void {
  if (useCameraStageStore.getState().currentProjectId !== projectId) {
    throw new Error('STALE_CONTEXT')
  }
}

function touchToolboxScope(): void {
  notifyHostScopeChanged('toolbox')
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

export async function listCameraStageProjectsFromAgent(): Promise<Record<string, unknown>[]> {
  return (await listCameraProjects()).map((project) => ({ ...project }))
}

export async function getCameraStageProjectFromAgent(projectId: string): Promise<Record<string, unknown>> {
  const record = await import('@/commands/cameraStageProjects').then(({ getCameraStageProjectRecord }) => getCameraStageProjectRecord(projectId))
  if (!record) throw new Error('NOT_FOUND')
  const scene = parseJsonValue(record.sceneJson)
  const sceneRecord = isRecord(scene) ? scene : {}
  const objects = summarizeCollection(sceneRecord.objects, ['id', 'type', 'name', 'visible'])
  const shots = summarizeCollection(sceneRecord.shots, ['id', 'name', 'cameraId', 'hold', 'transitionDuration', 'continuity'])
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    objectCount: record.objectCount,
    sceneBytes: utf8ByteLength(record.sceneJson),
    schemaVersion: typeof sceneRecord.schemaVersion === 'number' ? sceneRecord.schemaVersion : null,
    editorMode: sceneRecord.editorMode === 'simple' || sceneRecord.editorMode === 'pro' ? sceneRecord.editorMode : null,
    activeCameraId: typeof sceneRecord.activeCameraId === 'string' ? sceneRecord.activeCameraId : null,
    objects,
    shots,
  }
}

export async function createCameraStageProjectFromAgent(name: string, mode: 'simple' | 'pro'): Promise<Record<string, unknown>> {
  const project = await createNewProject(name, mode)
  useCameraStageSessionStore.getState().setAppView('editor')
  touchToolboxScope()
  return { projectId: project.id, name: project.name, mode }
}

export async function openCameraStageProjectFromAgent(projectId: string): Promise<Record<string, unknown>> {
  const loaded = await loadProjectIntoScene(projectId)
  if (!loaded) throw new Error('NOT_FOUND')
  useCameraStageSessionStore.getState().setAppView('editor')
  touchToolboxScope()
  const state = useCameraStageStore.getState()
  return { projectId, name: state.currentProjectName, objectCount: state.objects.length, shotCount: state.shots.length }
}

export async function renameCameraStageProjectFromAgent(projectId: string, name: string): Promise<Record<string, unknown>> {
  await renameCameraProject(projectId, name)
  touchToolboxScope()
  return { projectId, name: name.trim() }
}

export async function deleteCameraStageProjectFromAgent(projectId: string): Promise<Record<string, unknown>> {
  await deleteCameraProject(projectId)
  if (useCameraStageStore.getState().currentProjectId === projectId) useCameraStageStore.getState().newScene('未命名场景')
  touchToolboxScope()
  return { projectId, status: 'deleted' }
}

function requireCameraObject(projectId: string, objectId: string): void {
  requireCurrentCameraProject(projectId)
  if (!useCameraStageStore.getState().objects.some((object) => object.id === objectId)) throw new Error('NOT_FOUND')
}

export async function addCameraStageObjectFromAgent(input: { projectId: string; objectType: 'primitive' | 'character' | 'camera'; primitiveKind?: StagePrimitiveKind }): Promise<Record<string, unknown>> {
  requireCurrentCameraProject(input.projectId)
  const store = useCameraStageStore.getState()
  if (input.objectType === 'primitive') store.addPrimitive(input.primitiveKind ?? 'box')
  else if (input.objectType === 'character') store.addCharacter()
  else store.addCamera()
  const objects = useCameraStageStore.getState().objects
  const object = objects[objects.length - 1]
  if (!object) throw new Error('COMMAND_REJECTED')
  await saveCameraProject()
  touchToolboxScope()
  return { projectId: input.projectId, objectId: object.id, objectType: object.type }
}

export async function duplicateCameraStageObjectFromAgent(input: { projectId: string; objectId: string }): Promise<Record<string, unknown>> {
  requireCameraObject(input.projectId, input.objectId)
  useCameraStageStore.getState().duplicateObject(input.objectId)
  const objects = useCameraStageStore.getState().objects
  const object = objects[objects.length - 1]
  if (!object) throw new Error('COMMAND_REJECTED')
  await saveCameraProject()
  touchToolboxScope()
  return { projectId: input.projectId, objectId: object.id, duplicatedFromObjectId: input.objectId }
}

export async function deleteCameraStageObjectFromAgent(input: { projectId: string; objectId: string }): Promise<Record<string, unknown>> {
  requireCameraObject(input.projectId, input.objectId)
  useCameraStageStore.getState().removeObject(input.objectId)
  await saveCameraProject()
  touchToolboxScope()
  return { projectId: input.projectId, objectId: input.objectId, status: 'deleted' }
}

function safeObjectPatch(patch: Record<string, unknown>): StageObjectPatch {
  const output: StageObjectPatch = {}
  if (typeof patch.name === 'string' && patch.name.trim()) output.name = patch.name.trim().slice(0, 120)
  if (typeof patch.color === 'string') output.color = patch.color.slice(0, 32)
  if (typeof patch.visible === 'boolean') output.visible = patch.visible
  if (typeof patch.fov === 'number' && Number.isFinite(patch.fov)) output.fov = Math.min(179, Math.max(1, patch.fov))
  if (patch.transform && typeof patch.transform === 'object' && !Array.isArray(patch.transform)) output.transform = patch.transform as StageObjectPatch['transform']
  if (patch.lookAt && typeof patch.lookAt === 'object' && !Array.isArray(patch.lookAt)) output.lookAt = patch.lookAt as StageObjectPatch['lookAt']
  if (patch.aspectRatio && typeof patch.aspectRatio === 'object' && !Array.isArray(patch.aspectRatio)) output.aspectRatio = patch.aspectRatio as StageObjectPatch['aspectRatio']
  if (patch.variant === 'standard' || patch.variant === 'strong' || patch.variant === 'slim' || patch.variant === 'child') output.variant = patch.variant
  if (patch.pose && typeof patch.pose === 'object' && !Array.isArray(patch.pose)) output.pose = patch.pose as StageObjectPatch['pose']
  if (patch.motion && typeof patch.motion === 'object' && !Array.isArray(patch.motion)) output.motion = patch.motion as StageObjectPatch['motion']
  if (Array.isArray(patch.effectors)) output.effectors = patch.effectors as StageObjectPatch['effectors']
  return output
}

export async function updateCameraStageObjectFromAgent(input: { projectId: string; objectId: string; patch: Record<string, unknown> }): Promise<Record<string, unknown>> {
  requireCameraObject(input.projectId, input.objectId)
  const patch = safeObjectPatch(input.patch)
  if (Object.keys(patch).length === 0) throw new Error('INVALID_INPUT')
  useCameraStageStore.getState().updateObject(input.objectId, patch)
  await saveCameraProject()
  touchToolboxScope()
  return { projectId: input.projectId, objectId: input.objectId, updatedKeys: Object.keys(patch) }
}

export async function addCameraStageShotFromAgent(input: { projectId: string; name: string; cameraId: string | null }): Promise<Record<string, unknown>> {
  requireCurrentCameraProject(input.projectId)
  const store = useCameraStageStore.getState()
  store.addShot()
  const state = useCameraStageStore.getState()
  const shotId = state.selectedShotId
  if (!shotId) throw new Error('COMMAND_REJECTED')
  state.updateShotName(shotId, input.name.trim())
  state.updateShotCamera(shotId, input.cameraId)
  await saveCameraProject()
  touchToolboxScope()
  return { projectId: input.projectId, shotId, name: input.name.trim() }
}

export async function updateCameraStageShotFromAgent(input: { projectId: string; shotId: string; patch: { name?: string; hold?: number; transitionDuration?: number; continuity?: 'stop' | 'smooth'; cameraId?: string | null } }): Promise<Record<string, unknown>> {
  requireCurrentCameraProject(input.projectId)
  if (!useCameraStageStore.getState().shots.some((shot) => shot.id === input.shotId)) throw new Error('NOT_FOUND')
  const state = useCameraStageStore.getState()
  if (input.patch.name !== undefined) state.updateShotName(input.shotId, input.patch.name)
  if (input.patch.hold !== undefined || input.patch.transitionDuration !== undefined) state.updateShotTiming(input.shotId, { hold: input.patch.hold, transitionDuration: input.patch.transitionDuration })
  if (input.patch.continuity !== undefined) state.updateShotContinuity(input.shotId, input.patch.continuity)
  if (input.patch.cameraId !== undefined) state.updateShotCamera(input.shotId, input.patch.cameraId)
  await saveCameraProject()
  touchToolboxScope()
  return { projectId: input.projectId, shotId: input.shotId, status: 'updated' }
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

export async function createImageEditPreviewFromAgent(assetId: string, operations: Record<string, unknown>[]): Promise<Record<string, unknown>> {
  const asset = await inspectAsset(assetId)
  if (asset.mediaType !== 'image') throw new Error('INVALID_INPUT')
  const info = await readImageInfo(asset.filePath)
  let doc = createEmptyMarkDoc()
  let currentWidth = info.width
  let currentHeight = info.height
  for (const rawOperation of operations) {
    const operation = imageEditOperationSchema.parse(rawOperation)
    if (operation.kind === 'rotate_cw' || operation.kind === 'rotate_ccw' || operation.kind === 'flip_h' || operation.kind === 'flip_v') {
      const opMap: Record<string, OrientationOp> = { rotate_cw: 'rotate-cw', rotate_ccw: 'rotate-ccw', flip_h: 'flip-h', flip_v: 'flip-v' }
      const turns = operation.kind === 'rotate_cw' || operation.kind === 'rotate_ccw'
        ? (operation.degrees ?? 90) / 90
        : 1
      for (let turn = 0; turn < turns; turn += 1) {
        doc = applyOrientationOpToDoc(doc, currentWidth, currentHeight, opMap[operation.kind])
        if (operation.kind === 'rotate_cw' || operation.kind === 'rotate_ccw') {
          [currentWidth, currentHeight] = [currentHeight, currentWidth]
        }
      }
    } else if (operation.kind === 'crop') {
      if (!operation.crop) throw new Error('INVALID_INPUT')
      if (operation.crop.x < 0 || operation.crop.y < 0 || operation.crop.x + operation.crop.width > currentWidth || operation.crop.y + operation.crop.height > currentHeight) throw new Error('INVALID_INPUT')
      doc = { ...doc, crop: operation.crop }
    } else {
      if (!operation.item) throw new Error('INVALID_INPUT')
      const parsed = imageEditMarkItemSchema.parse(operation.item)
      const item = { ...parsed, id: parsed.id ?? createMarkId() } as MarkItem
      doc = { ...doc, items: [...doc.items, item] }
    }
  }
  const previewRef = `image-edit-preview:${createMarkId()}`
  imagePreviewRefs.set(previewRef, { assetId, source: asset.filePath, doc })
  return { previewRef, assetId, operationCount: operations.length, hasEffect: hasMarkEffect(doc), width: info.width, height: info.height }
}

export async function commitImageEditFromAgent(previewRef: string, displayName?: string): Promise<Record<string, unknown>> {
  const preview = imagePreviewRefs.get(previewRef)
  if (!preview) throw new Error('NOT_FOUND')
  const rendered = await exportMarkedImage(preview.source, preview.doc)
  const filePath = await persistImageSource(rendered)
  const asset = await addMediaReferenceToLibrary({
    filePath,
    mediaType: 'image',
    source: 'canvas',
    displayName: displayName?.trim() || `编辑图片-${Date.now()}`,
  })
  imagePreviewRefs.delete(previewRef)
  touchAssetScope()
  return { previewRef, assetId: asset.id, filePath: asset.filePath, status: 'committed' }
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

export async function createAssetFromAgent(input: { filePath: string; mediaType: 'image' | 'video' | 'audio'; displayName?: string }): Promise<Record<string, unknown>> {
  const asset = await createAsset({ ...input, source: 'imported' })
  touchAssetScope()
  return { assetId: asset.id, mediaType: asset.mediaType }
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
