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

import { assetApplicationService } from '@/features/assets/application/assetApplicationService'
import type { CapabilityExecutionContext } from './handlerTypes'
import { listApplicationSettingDefinitions } from '@/features/settings/application-control/settingsApplicationService'
import { resolveSettingsSurfaceId } from '@/features/navigation/application/surfaceCatalog'
import { resolveCanvasChildRef } from '@/features/canvas/application/canvasReflection'
import { readCanvasProjectSnapshot } from '@/features/canvas/application/canvasQueryService'

export type { ApplicationSurfaceDefinition } from '@/features/navigation/application'
export { listApplicationSurfaces }

type SurfaceLogContext = Pick<CapabilityExecutionContext, 'requestId' | 'taskId'>

export function openApplicationSurface(
  surfaceId: string,
  correlation: SurfaceLogContext = {}
): Record<string, unknown> {
  openSurface(surfaceId, { ...correlation, source: 'assistant' })
  return { surfaceId }
}

export function closeApplicationSurface(
  surfaceId?: string,
  correlation: SurfaceLogContext = {}
): Record<string, unknown> {
  const result = closeSurface(surfaceId, { ...correlation, source: 'assistant' })
  return { ...result, closedSurfaceId: result.surfaceId === 'none' ? null : result.surfaceId }
}

export async function focusApplicationEntity(
  ref: ApplicationRef,
  signal: AbortSignal,
  correlation: SurfaceLogContext = {},
  propertyIds: readonly string[] = [],
  presentation: 'surface' | 'focus' = 'focus',
): Promise<Record<string, unknown>> {
  if (ref.kind === 'settings.registry') {
    if (ref.id !== 'singleton') throw new Error('NOT_FOUND')
    const definitions = listApplicationSettingDefinitions()
    const setting = [...propertyIds].reverse().map((id) => definitions.find((item) => item.id === id)).find(Boolean)
    const surfaceId = setting ? resolveSettingsSurfaceId(setting.target.tab, setting.target.sectionId) : 'settings.general'
    if (!surfaceId) throw new Error('SURFACE_NOT_FOUND')
    return { ref, ...openApplicationSurface(surfaceId, correlation) }
  }
  if (ref.kind === 'generation.record' || ref.kind === 'generation.result') {
    return { ref, ...openApplicationSurface('workspace.generation', correlation) }
  }
  if (ref.kind === 'asset') {
    await assetApplicationService.select(ref.id)
    return { ref, ...openApplicationSurface('workspace.assets', correlation) }
  }
  if (ref.kind === 'canvas.project') {
    await openCanvasProject(ref.id, signal)
    return { ref, ...openApplicationSurface('workspace.canvas', correlation) }
  }
  if (ref.kind === 'canvas.node' || ref.kind === 'canvas.edge') {
    const { projectId, childId } = resolveCanvasChildRef(ref, ref.kind)
    const project = await readCanvasProjectSnapshot(projectId)
    const items = ref.kind === 'canvas.node' ? project.nodes : project.edges
    if (!items.some((item) => item.id === childId)) throw new Error('NOT_FOUND')
    await openCanvasProject(projectId, signal)
    const surface = openApplicationSurface('workspace.canvas', correlation)
    if (ref.kind === 'canvas.node' && presentation === 'focus') await focusCanvasNode(projectId, childId, signal)
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
    if (childId && ref.kind === 'camera_stage.state_keyframe') useCameraStageStore.getState().selectStateKeyframe(childId)
    return { ref, ...openApplicationSurface('tool.camera_stage', correlation) }
  }
  throw new Error('INVALID_INPUT')
}
