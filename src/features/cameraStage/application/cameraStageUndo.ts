import { saveCurrentProject } from '../projects/cameraStageProjectService'
import { useCameraStageStore } from '../store/cameraStageStore'

interface CameraStageUndoSnapshot {
  project: { id: string; name: string }
  scene: Pick<
    ReturnType<typeof useCameraStageStore.getState>,
    'objects' | 'activeCameraId' | 'animation' | 'sceneSettings' | 'editorMode' | 'shots'
  >
}

const undoSnapshots = new Map<string, CameraStageUndoSnapshot>()

function undoToken(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `camera-stage-undo:${random}`
}

export function captureCameraStageUndo(projectId: string): string {
  const state = useCameraStageStore.getState()
  if (state.currentProjectId !== projectId) throw new Error('STALE_CONTEXT')
  const token = undoToken()
  undoSnapshots.set(token, {
    project: { id: projectId, name: state.currentProjectName },
    scene: structuredClone({
      objects: state.objects,
      activeCameraId: state.activeCameraId,
      animation: state.animation,
      sceneSettings: state.sceneSettings,
      editorMode: state.editorMode,
      shots: state.shots,
    }),
  })
  return token
}

export async function restoreCameraStageUndo(token: string): Promise<{ projectId: string }> {
  const snapshot = undoSnapshots.get(token)
  if (!snapshot) throw new Error('NOT_FOUND')
  useCameraStageStore.getState().loadSnapshot(snapshot.scene, snapshot.project)
  await saveCurrentProject()
  undoSnapshots.delete(token)
  return { projectId: snapshot.project.id }
}

export function forgetCameraStageUndo(token: string): void {
  undoSnapshots.delete(token)
}
