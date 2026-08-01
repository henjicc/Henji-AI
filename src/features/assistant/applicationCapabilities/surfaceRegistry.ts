import type { ApplicationRef } from '@/core/assistant/applicationCapabilities'
import { cameraStageApplicationService } from '@/features/cameraStage/application/cameraStageApplicationService'
import { useCameraStageSessionStore } from '@/features/cameraStage/store/cameraStageSessionStore'
import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore'
import {
  focusCanvasNode,
  openCanvasProject,
} from '@/features/canvas/application/canvasApplicationService'
import {
  closeApplicationSurface as closeSurface,
  listApplicationSurfaces,
  openApplicationSurface as openSurface,
} from '@/features/navigation/application'

import { selectAssetFromAgent } from '../hostActions'
import type { CapabilityExecutionContext } from './handlerTypes'

export type { ApplicationSurfaceDefinition } from '@/features/navigation/application'
export { listApplicationSurfaces }

type SurfaceLogContext = Pick<CapabilityExecutionContext, 'requestId' | 'taskId'>

export function openApplicationSurface(
  surfaceId: string,
  correlation: SurfaceLogContext = {}
): Record<string, unknown> {
  openSurface(surfaceId, correlation)
  return { surfaceId }
}

export function closeApplicationSurface(
  surfaceId?: string,
  correlation: SurfaceLogContext = {}
): Record<string, unknown> {
  const result = closeSurface(surfaceId, correlation)
  return { ...result, closedSurfaceId: result.surfaceId === 'none' ? null : result.surfaceId }
}

export async function focusApplicationEntity(
  ref: ApplicationRef,
  signal: AbortSignal,
  correlation: SurfaceLogContext = {}
): Promise<Record<string, unknown>> {
  if (ref.kind === 'generation.record' || ref.kind === 'generation.result') {
    return { ref, ...openApplicationSurface('workspace.generation', correlation) }
  }
  if (ref.kind === 'asset') {
    await selectAssetFromAgent(ref.id)
    return { ref, ...openApplicationSurface('workspace.assets', correlation) }
  }
  if (ref.kind === 'canvas.project') {
    await openCanvasProject(ref.id, signal)
    return { ref, ...openApplicationSurface('workspace.canvas', correlation) }
  }
  if (ref.kind === 'canvas.node') {
    const separator = ref.id.indexOf(':')
    if (separator < 1) throw new Error('INVALID_INPUT')
    const projectId = ref.id.slice(0, separator)
    const nodeId = ref.id.slice(separator + 1)
    await openCanvasProject(projectId, signal)
    const surface = openApplicationSurface('workspace.canvas', correlation)
    await focusCanvasNode(projectId, nodeId, signal)
    return { ref, ...surface }
  }
  if (ref.kind.startsWith('camera_stage.')) {
    const separator = ref.id.indexOf(':')
    if (ref.kind !== 'camera_stage.project' && ref.kind !== 'camera_stage.scene' && separator < 1) {
      throw new Error('INVALID_INPUT')
    }
    const projectId = ref.kind === 'camera_stage.project' || ref.kind === 'camera_stage.scene'
      ? ref.id
      : ref.id.slice(0, separator)
    if (!projectId) throw new Error('INVALID_INPUT')
    await cameraStageApplicationService.openProject(projectId)
    useCameraStageSessionStore.getState().setAppView('editor')
    const childId = ref.kind === 'camera_stage.project' || ref.kind === 'camera_stage.scene'
      ? null
      : ref.id.slice(separator + 1)
    if (childId && (ref.kind === 'camera_stage.object' || ref.kind === 'camera_stage.camera')) {
      useCameraStageStore.getState().setSelected(childId)
    }
    if (childId && ref.kind === 'camera_stage.shot') useCameraStageStore.getState().selectShot(childId)
    return { ref, ...openApplicationSurface('tool.camera_stage', correlation) }
  }
  throw new Error('INVALID_INPUT')
}
