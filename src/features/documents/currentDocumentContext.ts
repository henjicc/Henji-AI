import { useCameraStageSessionStore } from '@/features/cameraStage/store/cameraStageSessionStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { useProjectStore } from '@/stores/projectStore'
import { useAudioEditStore } from '@/features/audioEdit/store/audioEditStore'
import { activeVideoEditInstance } from '@/features/videoEdit/application/videoEditService'
import { listImageEditDocumentInstancesV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'
import { getDocumentSessionRegistry } from './documentSessionRegistry'
/** 按当前宿主定位文档及其项目；后台打开的其他文档不参与默认值与记忆。 */
export function currentDocumentContext(): { documentId?: string; projectId?: string } {
  const navigation = useNavigationStore.getState()
  const images = listImageEditDocumentInstancesV3().filter(instance => instance.views > 0)
  const documentId = navigation.activeWorkspace === 'videoEdit' ? activeVideoEditInstance()?.document.id
    : navigation.activeWorkspace === 'nodes' ? useProjectStore.getState().currentProjectId ?? undefined
      : navigation.activeWorkspace === 'tools' && navigation.activeToolId === 'audioEdit' ? useAudioEditStore.getState().project?.id
        : navigation.activeWorkspace === 'tools' && navigation.activeToolId === 'cameraStage' && useCameraStageSessionStore.getState().appView === 'editor' ? useCameraStageSessionStore.getState().lastDocumentId ?? undefined
        : navigation.activeWorkspace === 'tools' && navigation.activeToolId === 'imageMark' && images.length === 1 ? images[0].documentId : undefined
  const container = documentId ? getDocumentSessionRegistry().get(documentId)?.documentMeta.container : undefined
  return { documentId, ...(container?.kind === 'project' ? { projectId: container.projectId } : {}) }
}
