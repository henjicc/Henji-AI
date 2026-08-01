import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore'
import { listImageEditorToolControls } from '@/features/imageEdit/tools/controlCatalog'
import { useNavigationStore } from '@/stores/navigationStore'

export function listToolboxTools(): Record<string, unknown>[] {
  return [
    { id: 'cameraStage', name: '3D 镜头参考', capabilities: ['project', 'object', 'shot', 'camera_move', 'render'] },
    ...listImageEditorToolControls().map((tool) => ({
      id: tool.id,
      name: tool.label,
      operationId: tool.operationId,
      controlKinds: tool.kinds,
      capabilities: ['preview', 'commit'],
    })),
  ]
}

export function getToolboxState(): Record<string, unknown> {
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
