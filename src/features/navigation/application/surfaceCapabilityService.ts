import type { ApplicationRef } from '@/core/application-control/applicationCapabilities'
import { openCameraStageDocument } from '@/features/cameraStage/projects/cameraStageProjectService'
import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore'
import { focusCanvasNode, openCanvasProject } from '@/features/canvas/application/canvasApplicationService'
import { closeApplicationSurface as closeSurface, listApplicationSurfaces, openApplicationSurface as openSurface } from '@/features/navigation/application/index'

import { assetApplicationService } from '@/features/assets/application/assetApplicationService'
import { focusVideoEdit, focusVideoEditPanel, switchVideoEditSequence, setVideoEditView, setVideoEditProjectView, requireVideoEditInstance } from '@/features/videoEdit/application/videoEditService'
import { readVideoEditData, splitVideoEditRef } from '@/features/videoEdit/application/videoEditReflection'
import type { CapabilityExecutionContext } from '@/features/application-control/capabilities/handlerTypes'

export type { ApplicationSurfaceDefinition } from '@/features/navigation/application/index'
export { listApplicationSurfaces }

type SurfaceLogContext = Pick<CapabilityExecutionContext, 'requestId' | 'taskId'>

export function openApplicationSurface(
  surfaceId: string,
  correlation: SurfaceLogContext = {}
): Record<string, unknown> {
  const opened = openSurface(surfaceId, correlation)
  return { surfaceId, verification: {
    verified: opened.status === 'opened' || opened.status === 'already_active',
    condition: '导航服务已回读确认目标页面处于打开状态',
    target: { kind: 'application.surface', id: surfaceId },
  } }
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
  if (ref.kind.startsWith('video_edit.')) {
    readVideoEditData(ref)
    const { projectId, childId } = splitVideoEditRef(ref)
    focusVideoEdit(projectId)
    const instance = requireVideoEditInstance(projectId)
    const sequence = instance.document.sequences.find(sequence => sequence.id === childId || sequence.clips.some(clip => clip.id === childId) || sequence.annotations.some(mark => mark.id === childId) || sequence.tracks.some(track => track.id === childId) || sequence.markers?.some(mark => mark.id === childId) || sequence.captions?.some(caption => caption.id === childId))
    if (sequence) switchVideoEditSequence(projectId, sequence.id)
    if (ref.kind === 'video_edit.clip') setVideoEditView(projectId, { selection: childId })
    if (ref.kind === 'video_edit.bin') setVideoEditProjectView(projectId, { selectedBinId: childId, selectedItemIds: [] })
    if (ref.kind === 'video_edit.item') {
      const item = instance.document.items.find(item => item.id === childId)!
      setVideoEditProjectView(projectId, { selectedBinId: item.binId ?? '', selectedItemIds: [childId] })
    }
    if (ref.kind === 'video_edit.code_material' || ref.kind === 'video_edit.code_version') {
      const item = instance.document.items.find(item => ref.kind === 'video_edit.code_material' ? item.code?.definitionId === childId : item.code?.versionId === childId)
      const clipSequence = instance.document.sequences.find(sequence => sequence.clips.some(clip => ref.kind === 'video_edit.code_material' ? clip.code?.definitionId === childId : clip.code?.versionId === childId))
      if (item) setVideoEditProjectView(projectId, { selectedBinId: item.binId ?? '', selectedItemIds: [item.id] })
      if (clipSequence) {
        switchVideoEditSequence(projectId, clipSequence.id)
        const clip = clipSequence.clips.find(clip => ref.kind === 'video_edit.code_material' ? clip.code?.definitionId === childId : clip.code?.versionId === childId)!
        setVideoEditView(projectId, { selection: clip.id })
      }
    }
    if (ref.kind === 'video_edit.annotation') {
      const mark = sequence?.annotations.find(item => item.id === childId)
      if (!mark) throw new Error('NOT_FOUND')
      setVideoEditView(projectId, { selection: mark.clipId, frame: mark.frame, playing: false })
    }
    if (ref.kind === 'video_edit.marker' || ref.kind === 'video_edit.caption') {
      const content = ref.kind === 'video_edit.marker' ? sequence?.markers?.find(mark => mark.id === childId) : sequence?.captions?.find(caption => caption.id === childId)
      if (!content) throw new Error('NOT_FOUND')
      setVideoEditView(projectId, { selection: content.clipId ?? null, frame: 'frame' in content ? content.frame : content.start, playing: false })
      focusVideoEditPanel(projectId, 'content')
    }
    return { ref, ...openApplicationSurface('workspace.video_edit', correlation) }
  }
  if (ref.kind === 'generation.record' || ref.kind === 'generation.result') {
    return { ref, ...openApplicationSurface('workspace.generation', correlation) }
  }
  if (ref.kind === 'asset') {
    await assetApplicationService.select(ref.id)
    return { ref, ...openApplicationSurface('workspace.assets', correlation) }
  }
  if (ref.kind === 'canvas.document') {
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
    if (ref.kind !== 'camera_stage.document' && ref.kind !== 'camera_stage.scene' && separator < 1) {
      throw new Error('INVALID_INPUT')
    }
    const projectId = ref.kind === 'camera_stage.document' || ref.kind === 'camera_stage.scene'
      ? ref.id
      : ref.id.slice(0, separator)
    if (!projectId) throw new Error('INVALID_INPUT')
    await openCameraStageDocument({ id: projectId })
    const childId = ref.kind === 'camera_stage.document' || ref.kind === 'camera_stage.scene'
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
