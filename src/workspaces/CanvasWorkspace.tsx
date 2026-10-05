import { useCallback, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { UiButton, UiError, UiLoading, UiPanel } from '@/components/ui';
import { Canvas } from '@/features/canvas/Canvas';
import { updateCanvasProjectCover } from '@/features/canvas/application/canvasProjectCover';
import { useCanvasProjectCoverAutosave } from '@/features/canvas/application/useCanvasProjectCoverAutosave';
import { CanvasLibrary } from '@/features/canvas/projects/CanvasLibrary';
import { useProjectStore } from '@/stores/projectStore';
import '@/features/canvas/storyboard.css';
import { isUiInspectionReadOnly } from '@/platform/runtime';
import { confirmCanvasPersistence } from '@/features/canvas/application/canvasPersistenceService';

/**
 * 画布工作区：“画布列表 ↔ 画布”两级视图（3.4 起画布是 `.henji-canvas` 文档）。
 * 返回列表走通用离开流程：已保存的写完关闭，草稿询问“保存 / 不保存 / 取消”，取消留在画布上。
 */
const CanvasWorkspace = (): JSX.Element => {
  const { t } = useTranslation();
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const isOpeningProject = useProjectStore((state) => state.isOpeningProject);
  const openError = useProjectStore((state) => state.openError);
  const closeProject = useProjectStore((state) => state.closeProject);
  const persistenceError = useProjectStore((state) => state.persistenceError);
  const [isLeavingProject, setIsLeavingProject] = useState(false);
  const inspectionReadOnly = isUiInspectionReadOnly();

  useCanvasProjectCoverAutosave(currentProjectId);

  /**
   * 返回列表前先更新封面。必须在离开前截——
   * 没有生成结果时封面走节点区域截图，画布一旦卸载就只能截到列表本身。
   */
  const handleBackToProjects = useCallback(async (): Promise<void> => {
    if (isLeavingProject) return;
    const projectId = useProjectStore.getState().currentProjectId;
    setIsLeavingProject(true);
    try {
      if (projectId && !inspectionReadOnly) await updateCanvasProjectCover(projectId);
      await closeProject();
    } catch {
      // store 已记录并公开保存错误；留在画布上，避免误导用户以为已经安全退出。
    } finally {
      setIsLeavingProject(false);
    }
  }, [closeProject, inspectionReadOnly, isLeavingProject]);

  return (
    <ReactFlowProvider>
      <div className="h-full min-h-0 w-full bg-window text-text1">
        {!currentProjectId && !isOpeningProject && <CanvasLibrary />}

        {(currentProjectId || isOpeningProject) && (
          <div className="relative h-full w-full bg-canvas" aria-busy={isOpeningProject}>
            {/* 截封面期间隐藏自己：它悬在画布上，留着会被一起截进节点区域封面里 */}
            {!isLeavingProject && (
              /* 没有命令带的全屏工作面：返回入口浮在画布上，走随主题的玻璃（纸白下为浅色玻璃 + 深色字），
                 一块玻璃包住静默按钮；media 档是压在图片/视频上的固定深色叠层，不跟主题。 */
              <div className="ui-glass absolute left-3 top-3 z-sticky rounded-lg p-0.5">
                <UiButton
                  onClick={() => void handleBackToProjects()}
                  disabled={isOpeningProject && Boolean(currentProjectId)}
                  size="sm"
                >
                  {t('canvas.backToProjects')}
                </UiButton>
              </div>
            )}
            {(persistenceError || openError) && (
              /* 保存/打开失败提示悬在画布与节点之上：放进玻璃面板，压在节点内容上也能读 */
              <UiPanel variant="glass" className="absolute left-1/2 top-3 z-sticky -translate-x-1/2 px-3">
                <UiError
                  message={t(openError ?? 'project.persistenceFailed')}
                  size="xs"
                  onRetry={!openError && currentProjectId
                    ? () => { void confirmCanvasPersistence(currentProjectId).catch(() => undefined); } : undefined}
                />
              </UiPanel>
            )}
            {currentProjectId && <Canvas />}
            {isOpeningProject && (
              <div className="absolute inset-0 z-raised bg-canvas">
                <UiLoading className="h-full" message={t('common.loading')} />
              </div>
            )}
          </div>
        )}
      </div>
    </ReactFlowProvider>
  );
};

export default CanvasWorkspace;
