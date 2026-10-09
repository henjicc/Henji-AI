import i18n from '@/i18n'
import { TOOL_CATALOG } from '@/core/toolbox/toolCatalog'
import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore'
import { listImageEditorToolControls } from '@/features/imageEdit/tools/controlCatalog'
import { useNavigationStore } from '@/stores/navigationStore'

export function listToolboxTools(): Record<string, unknown>[] {
  return [
    ...TOOL_CATALOG.tools.map((tool) => ({
      id: tool.id, name: i18n.t(tool.titleKey), description: i18n.t(tool.descriptionKey),
      surfaceId: tool.surfaceId, actions: [...tool.actions], capabilities: [...tool.capabilities],
    })),
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
      stateKeyframeCount: camera.stateKeyframes.length,
      selectedObjectId: camera.selectedId,
      selectedStateKeyframeId: camera.selectedStateKeyframeId,
    },
  }
}
