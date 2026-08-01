import { createLogger } from '@/core/logging'

import type { StageCameraAspectRatio, StageCameraLookAt, StageObject, StageObjectPatch, StageTransform, StageVec3 } from '../domain/sceneTypes'
import type { StageCameraEffector, StageEditorMode, StageShot } from '../domain/shotTypes'
import {
  createNewProject,
  deleteProject as deleteStoredProject,
  listProjects,
  loadProjectIntoScene,
  readProjectSnapshot,
  renameProject as renameStoredProject,
  saveCurrentProject,
  type CameraStageProjectSnapshot,
} from '../projects/cameraStageProjectService'
import { useCameraStageStore } from '../store/cameraStageStore'
import {
  calculateStageObjectBounds,
  dimensionsToScale,
  listSceneCollisionPairs,
  matchReusableSceneObject,
  resolveScenePlacement,
  type CameraStageObjectSpec,
  type CameraStagePlacementIntent,
  type StageObjectBounds,
} from './sceneAnalysis'
import { captureCameraStageUndo } from './cameraStageUndo'

const logger = createLogger('features.cameraStage.application')

export interface CameraStageObjectUpdate {
  name?: string
  visible?: boolean
  color?: string
  transform?: Partial<StageTransform>
  fov?: number
  lookAt?: StageCameraLookAt
  aspectRatio?: StageCameraAspectRatio
  variant?: 'standard' | 'strong' | 'slim' | 'child'
  effectors?: StageCameraEffector[]
}

export interface CameraStageShotUpdate {
  name?: string
  hold?: number
  transitionDuration?: number
  continuity?: StageShot['continuity']
  cameraId?: string | null
}

export interface CameraStageSceneObservation {
  project: { id: string; name: string; editorMode: StageEditorMode }
  activeCameraId: string | null
  objects: Array<{
    id: string
    type: StageObject['type']
    name: string
    visible: boolean
    transform: StageTransform
    bounds: StageObjectBounds
    primitiveKind?: string
    lookAt?: StageCameraLookAt
  }>
  shots: Array<{
    id: string
    name: string
    time: number
    hold: number
    transitionDuration: number
    continuity: StageShot['continuity']
    cameraId: string | null
  }>
  trajectories: Array<{
    shotId: string
    objectId: string
    source: string
    knotCount: number
  }>
  keyframeCount: number
  collisions: Array<{ objectIds: [string, string] }>
}

interface PlaceObjectInput {
  projectId: string
  spec: CameraStageObjectSpec
  placement: CameraStagePlacementIntent
}

function assertFiniteVec3(value: StageVec3, label: string): void {
  if (![value.x, value.y, value.z].every(Number.isFinite)) throw new Error(`INVALID_${label}`)
}

function uniqueObjectName(objects: StageObject[], requested: string, excludedId?: string): string {
  const base = requested.trim().slice(0, 120)
  if (!base) throw new Error('INVALID_INPUT')
  const occupied = new Set(objects.filter((object) => object.id !== excludedId).map((object) => object.name))
  if (!occupied.has(base)) return base
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base} ${index}`
    if (!occupied.has(candidate)) return candidate
  }
  throw new Error('NAME_CONFLICT')
}

function requireObject(projectId: string, objectId: string): StageObject {
  const state = useCameraStageStore.getState()
  if (state.currentProjectId !== projectId) throw new Error('STALE_CONTEXT')
  const object = state.objects.find((candidate) => candidate.id === objectId)
  if (!object) throw new Error('NOT_FOUND')
  return object
}

function validateObjectUpdate(object: StageObject, objects: StageObject[], update: CameraStageObjectUpdate): StageObjectPatch {
  const patch: StageObjectPatch = {}
  if (update.name !== undefined) {
    const unique = uniqueObjectName(objects, update.name, object.id)
    if (unique !== update.name.trim()) throw new Error('NAME_CONFLICT')
    patch.name = unique
  }
  if (update.visible !== undefined) patch.visible = update.visible
  if (update.color !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(update.color)) throw new Error('INVALID_COLOR')
    patch.color = update.color
  }
  if (update.transform) {
    const transform: StageTransform = {
      position: update.transform.position ?? object.transform.position,
      rotation: update.transform.rotation ?? object.transform.rotation,
      scale: update.transform.scale ?? object.transform.scale,
    }
    assertFiniteVec3(transform.position, 'POSITION')
    assertFiniteVec3(transform.rotation, 'ROTATION')
    assertFiniteVec3(transform.scale, 'SCALE')
    if ([transform.scale.x, transform.scale.y, transform.scale.z].some((value) => value <= 0)) throw new Error('INVALID_SCALE')
    patch.transform = transform
  }
  if (update.fov !== undefined) {
    if (object.type !== 'camera' || !Number.isFinite(update.fov) || update.fov < 1 || update.fov > 179) throw new Error('INVALID_FOV')
    patch.fov = update.fov
  }
  if (update.lookAt !== undefined) {
    if (object.type !== 'camera') throw new Error('OBJECT_TYPE_MISMATCH')
    if (update.lookAt.mode === 'manual') assertFiniteVec3(update.lookAt.target, 'LOOK_AT')
    else {
      const lookAtObjectId = update.lookAt.objectId
      if (lookAtObjectId === object.id || !objects.some((candidate) => candidate.id === lookAtObjectId)) throw new Error('INVALID_REFERENCE')
    }
    patch.lookAt = structuredClone(update.lookAt)
  }
  if (update.aspectRatio !== undefined) {
    if (object.type !== 'camera' || !Number.isFinite(update.aspectRatio.ratio) || update.aspectRatio.ratio <= 0) throw new Error('INVALID_ASPECT_RATIO')
    patch.aspectRatio = { ...update.aspectRatio }
  }
  if (update.variant !== undefined) {
    if (object.type !== 'character') throw new Error('OBJECT_TYPE_MISMATCH')
    patch.variant = update.variant
  }
  if (update.effectors !== undefined) {
    if (object.type !== 'camera') throw new Error('OBJECT_TYPE_MISMATCH')
    patch.effectors = structuredClone(update.effectors)
  }
  if (Object.keys(patch).length === 0) throw new Error('INVALID_INPUT')
  return patch
}

async function ensureProjectLoaded(projectId: string): Promise<void> {
  if (useCameraStageStore.getState().currentProjectId === projectId) return
  if (!await loadProjectIntoScene(projectId)) throw new Error('NOT_FOUND')
}

function sceneObservation(snapshot: CameraStageProjectSnapshot): CameraStageSceneObservation {
  return {
    project: { id: snapshot.id, name: snapshot.name, editorMode: snapshot.editorMode },
    activeCameraId: snapshot.activeCameraId,
    objects: snapshot.objects.map((object) => ({
      id: object.id,
      type: object.type,
      name: object.name,
      visible: object.visible,
      transform: structuredClone(object.transform),
      bounds: calculateStageObjectBounds(object),
      ...(object.type === 'primitive' ? { primitiveKind: object.kind } : {}),
      ...(object.type === 'camera' ? { lookAt: structuredClone(object.lookAt) } : {}),
    })),
    shots: snapshot.shots.map((shot) => ({
      id: shot.id,
      name: shot.name,
      time: shot.time,
      hold: shot.hold,
      transitionDuration: shot.transitionDuration,
      continuity: shot.continuity,
      cameraId: shot.cameraId,
    })),
    trajectories: snapshot.shots.flatMap((shot) => Object.entries(shot.transition.perObject).flatMap(([objectId, detail]) => {
      const path = detail.spatialPath
      return path ? [{ shotId: shot.id, objectId, source: path.source.kind === 'preset' ? path.source.preset.kind : 'custom', knotCount: path.knots.length }] : []
    })),
    keyframeCount: snapshot.animation.tracks.reduce((total, track) => total + track.keyframes.length, 0),
    collisions: listSceneCollisionPairs(snapshot.objects),
  }
}

async function readDomainSnapshot(projectId: string): Promise<CameraStageProjectSnapshot> {
  const current = useCameraStageStore.getState()
  if (current.currentProjectId === projectId) {
    return {
      id: projectId,
      name: current.currentProjectName,
      createdAt: 0,
      updatedAt: 0,
      objects: current.objects,
      activeCameraId: current.activeCameraId,
      animation: current.animation,
      sceneSettings: current.sceneSettings,
      editorMode: current.editorMode,
      shots: current.shots,
    }
  }
  const snapshot = await readProjectSnapshot(projectId)
  if (!snapshot) throw new Error('NOT_FOUND')
  return snapshot
}

export const cameraStageApplicationService = {
  async listProjects(): Promise<Awaited<ReturnType<typeof listProjects>>> {
    return await listProjects()
  },

  async observeProject(projectId: string): Promise<CameraStageSceneObservation> {
    return sceneObservation(await readDomainSnapshot(projectId))
  },

  async readSnapshot(projectId: string): Promise<CameraStageProjectSnapshot> {
    return await readDomainSnapshot(projectId)
  },

  async createProject(name: string, mode: StageEditorMode): Promise<{ projectId: string; name: string; mode: StageEditorMode }> {
    const project = await createNewProject(name.trim(), mode)
    return { projectId: project.id, name: project.name, mode }
  },

  async openProject(projectId: string): Promise<{ projectId: string; name: string; objectCount: number; shotCount: number }> {
    if (!await loadProjectIntoScene(projectId)) throw new Error('NOT_FOUND')
    const state = useCameraStageStore.getState()
    return { projectId, name: state.currentProjectName, objectCount: state.objects.length, shotCount: state.shots.length }
  },

  async renameProject(projectId: string, name: string): Promise<{ projectId: string; name: string }> {
    await renameStoredProject(projectId, name)
    return { projectId, name: name.trim() }
  },

  async deleteProject(projectId: string): Promise<{ projectId: string; status: 'deleted' }> {
    await deleteStoredProject(projectId)
    if (useCameraStageStore.getState().currentProjectId === projectId) useCameraStageStore.getState().newScene('未命名场景')
    return { projectId, status: 'deleted' }
  },

  async placeObject(input: PlaceObjectInput): Promise<{
    projectId: string
    objectId: string
    objectType: StageObject['type']
    decision: 'reused' | 'created'
    reason: string
    position: StageVec3
    bounds: StageObjectBounds
    conflicts: string[]
    undoToken?: string
  }> {
    logger.info('三维场景对象布置开始', {
      event: 'camera_stage.object.place.start',
      projectId: input.projectId,
      objectType: input.spec.objectType,
      reusePolicy: input.spec.reusePolicy,
    })
    try {
      await ensureProjectLoaded(input.projectId)
    const before = useCameraStageStore.getState()
    const reuse = matchReusableSceneObject(before.objects, input.spec, before.activeCameraId)
    const noPlacementChange = reuse.object && !input.placement.position && !input.placement.rotation
      && !input.placement.scale && !input.placement.dimensions && !input.placement.targetObjectId
      && input.placement.mode === 'auto'
    if (reuse.object && noPlacementChange) {
      const bounds = calculateStageObjectBounds(reuse.object)
      logger.info('三维场景对象布置完成', {
        event: 'camera_stage.object.place.completed',
        projectId: input.projectId,
        objectId: reuse.object.id,
        decision: 'reused',
        conflictCount: 0,
      })
      return {
        projectId: input.projectId,
        objectId: reuse.object.id,
        objectType: reuse.object.type,
        decision: 'reused',
        reason: reuse.reason,
        position: reuse.object.transform.position,
        bounds,
        conflicts: [],
      }
    }
    const undoToken = captureCameraStageUndo(input.projectId)
    let object = reuse.object
    if (!object) {
      if (input.spec.objectType === 'primitive') before.addPrimitive(input.spec.primitiveKind ?? 'box')
      else if (input.spec.objectType === 'character') before.addCharacter()
      else before.addCamera()
      const createdId = useCameraStageStore.getState().selectedId
      object = useCameraStageStore.getState().objects.find((candidate) => candidate.id === createdId) ?? null
      if (!object) throw new Error('CAPABILITY_REJECTED')
    }
    const state = useCameraStageStore.getState()
    const layout = resolveScenePlacement(object, state.objects, input.placement)
    const scale = input.placement.dimensions
      ? dimensionsToScale(object, input.placement.dimensions)
      : input.placement.scale ?? object.transform.scale
    const transform: StageTransform = {
      position: layout.position,
      rotation: input.placement.rotation ?? object.transform.rotation,
      scale,
    }
    const name = input.spec.name
      ? uniqueObjectName(state.objects, input.spec.name, object.id)
      : object.name
    state.updateObject(object.id, { name, transform })
    await saveCurrentProject()
    const saved = requireObject(input.projectId, object.id)
    logger.info('三维场景对象布置完成', {
      event: 'camera_stage.object.place.completed',
      projectId: input.projectId,
      objectId: saved.id,
      decision: reuse.object ? 'reused' : 'created',
      conflictCount: layout.conflicts.length,
    })
      return {
      projectId: input.projectId,
      objectId: saved.id,
      objectType: saved.type,
      decision: reuse.object ? 'reused' : 'created',
      reason: `${reuse.reason} ${layout.reason}`,
      position: saved.transform.position,
      bounds: calculateStageObjectBounds(saved),
      conflicts: layout.conflicts,
      undoToken,
      }
    } catch (error) {
      logger.error('三维场景对象布置失败', error, {
        event: 'camera_stage.object.place.failed',
        projectId: input.projectId,
        objectType: input.spec.objectType,
        reusePolicy: input.spec.reusePolicy,
      })
      throw error
    }
  },

  async updateObject(projectId: string, objectId: string, update: CameraStageObjectUpdate): Promise<{ projectId: string; objectId: string; updatedKeys: string[]; undoToken: string }> {
    await ensureProjectLoaded(projectId)
    const object = requireObject(projectId, objectId)
    const state = useCameraStageStore.getState()
    const patch = validateObjectUpdate(object, state.objects, update)
    const undoToken = captureCameraStageUndo(projectId)
    state.updateObject(objectId, patch)
    await saveCurrentProject()
    return { projectId, objectId, updatedKeys: Object.keys(patch), undoToken }
  },

  async duplicateObject(projectId: string, objectId: string): Promise<{ projectId: string; objectId: string; duplicatedFromObjectId: string; undoToken: string }> {
    await ensureProjectLoaded(projectId)
    requireObject(projectId, objectId)
    const undoToken = captureCameraStageUndo(projectId)
    useCameraStageStore.getState().duplicateObject(objectId)
    const createdId = useCameraStageStore.getState().selectedId
    if (!createdId) throw new Error('CAPABILITY_REJECTED')
    await saveCurrentProject()
    return { projectId, objectId: createdId, duplicatedFromObjectId: objectId, undoToken }
  },

  async deleteObject(projectId: string, objectId: string): Promise<{ projectId: string; objectId: string; status: 'deleted' }> {
    await ensureProjectLoaded(projectId)
    requireObject(projectId, objectId)
    useCameraStageStore.getState().removeObject(objectId)
    await saveCurrentProject()
    return { projectId, objectId, status: 'deleted' }
  },

  async addShot(projectId: string, name: string, cameraId: string | null): Promise<{ projectId: string; shotId: string; name: string; undoToken: string }> {
    await ensureProjectLoaded(projectId)
    const state = useCameraStageStore.getState()
    if (cameraId && !state.objects.some((object) => object.id === cameraId && object.type === 'camera')) throw new Error('INVALID_REFERENCE')
    const undoToken = captureCameraStageUndo(projectId)
    state.addShot()
    const next = useCameraStageStore.getState()
    if (!next.selectedShotId) throw new Error('CAPABILITY_REJECTED')
    const uniqueName = new Set(next.shots.filter((shot) => shot.id !== next.selectedShotId).map((shot) => shot.name)).has(name.trim())
      ? `${name.trim()} ${next.shots.length}`
      : name.trim()
    next.updateShotName(next.selectedShotId, uniqueName)
    next.updateShotCamera(next.selectedShotId, cameraId)
    await saveCurrentProject()
    return { projectId, shotId: next.selectedShotId, name: uniqueName, undoToken }
  },

  async updateShot(projectId: string, shotId: string, update: CameraStageShotUpdate): Promise<{ projectId: string; shotId: string; status: 'updated'; undoToken: string }> {
    await ensureProjectLoaded(projectId)
    const state = useCameraStageStore.getState()
    if (!state.shots.some((shot) => shot.id === shotId)) throw new Error('NOT_FOUND')
    if (update.cameraId && !state.objects.some((object) => object.id === update.cameraId && object.type === 'camera')) throw new Error('INVALID_REFERENCE')
    if (update.hold !== undefined && (!Number.isFinite(update.hold) || update.hold < 0)) throw new Error('INVALID_TIME_RANGE')
    if (update.transitionDuration !== undefined && (!Number.isFinite(update.transitionDuration) || update.transitionDuration < 0)) throw new Error('INVALID_TIME_RANGE')
    const undoToken = captureCameraStageUndo(projectId)
    if (update.name !== undefined) state.updateShotName(shotId, update.name)
    if (update.hold !== undefined || update.transitionDuration !== undefined) state.updateShotTiming(shotId, update)
    if (update.continuity !== undefined) state.updateShotContinuity(shotId, update.continuity)
    if (update.cameraId !== undefined) state.updateShotCamera(shotId, update.cameraId)
    await saveCurrentProject()
    return { projectId, shotId, status: 'updated', undoToken }
  },
}
