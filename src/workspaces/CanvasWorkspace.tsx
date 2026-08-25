import { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { UiButton, UiError } from '@/components/ui';
import { Canvas } from '@/features/canvas/Canvas';
import { updateCanvasProjectCover } from '@/features/canvas/application/canvasProjectCover';
import { useCanvasProjectCoverAutosave } from '@/features/canvas/application/useCanvasProjectCoverAutosave';
import { ProjectManager } from '@/features/project/ProjectManager';
import { useProjectStore } from '@/stores/projectStore';
import '@/features/canvas/storyboard.css';
import { isUiInspectionReadOnly } from '@/platform/runtime';

const CanvasWorkspace = (): JSX.Element => {
  const { t } = useTranslation();
  const isHydrated = useProjectStore((state) => state.isHydrated);
  const hydrate = useProjectStore((state) => state.hydrate);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const closeProject = useProjectStore((state) => state.closeProject);
  const persistenceError = useProjectStore((state) => state.persistenceError);
  const [isLeavingProject, setIsLeavingProject] = useState(false);
  const inspectionReadOnly = isUiInspectionReadOnly();

  useCanvasProjectCoverAutosave(currentProjectId);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  /**
   * 退出项目前先更新封面。必须等封面拿到再 closeProject——
   * 没有生成结果时封面走节点区域截图，画布一旦卸载就只能截到项目列表本身。
   */
  const handleBackToProjects = useCallback(async (): Promise<void> => {
    if (isLeavingProject) return;
    const projectId = useProjectStore.getState().currentProjectId;
    setIsLeavingProject(true);
    try {
      try {
        if (projectId && !inspectionReadOnly) await updateCanvasProjectCover(projectId);
      } finally {
        await closeProject();
      }
    } catch {
      // store 已记录并公开保存错误；留在画布上，避免误导用户以为已经安全退出。
    } finally {
      setIsLeavingProject(false);
    }
  }, [closeProject, inspectionReadOnly, isLeavingProject]);

  return (
    <ReactFlowProvider>
      <div className="h-full min-h-0 w-full bg-app text-text-dark">
        {!isHydrated && <div className="h-full w-full bg-app" />}

        {isHydrated && !currentProjectId && <ProjectManager />}

        {isHydrated && currentProjectId && (
          <div className="relative h-full w-full">
            {/* 截封面期间隐藏自己：它悬在画布上，留着会被一起截进节点区域封面里 */}
            {!isLeavingProject && (
              <UiButton
                onClick={() => void handleBackToProjects()}
                /* 悬浮在画布上，背后是用户内容而非纯色 UI */
                variant="glass"
                size="sm"
                className="absolute left-3 top-3 z-sticky px-3"
              >
                返回项目
              </UiButton>
            )}
            {persistenceError && (
              <UiError
                className="absolute left-1/2 top-3 z-sticky -translate-x-1/2"
                message={t('project.persistenceFailed')}
                size="xs"
              />
            )}
            <Canvas />
          </div>
        )}
      </div>
    </ReactFlowProvider>
  );
};

export default CanvasWorkspace;
