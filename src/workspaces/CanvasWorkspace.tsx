import { ApplicationOperationReviewBanner } from '@/features/application-control'
import { useCallback, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ReactFlowProvider } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { UiButton, UiError, UiIconButton, UiLoading, UiPanel } from '@/components/ui';
import { Canvas } from '@/features/canvas/Canvas';
import { updateCanvasProjectCover } from '@/features/canvas/application/canvasProjectCover';
import { useCanvasProjectCoverAutosave } from '@/features/canvas/application/useCanvasProjectCoverAutosave';
import { CanvasLibrary } from '@/features/canvas/projects/CanvasLibrary';
import { useProjectStore } from '@/stores/projectStore';
import '@/features/canvas/storyboard.css';
import { isUiInspectionReadOnly } from '@/platform/runtime';
import { confirmCanvasPersistence } from '@/features/canvas/application/canvasPersistenceService';
import { returnFromEmbedded, useEmbeddedHost } from '@/features/documents/embeddedDocuments';
import { DocumentSaveStatus } from '@/features/documents/DocumentSaveStatus';
import { useDocumentSessionState } from '@/features/documents/useDocumentSessionState';
import { findCanvasProjectInstance } from '@/features/canvas/application/canvasProjectInstances';

/**
 * 画布工作区：“画布列表 ↔ 画布”两级视图（3.4 起画布是 `.hjcvs` 文档）。
 * 返回列表走通用离开流程：已保存的写完关闭，草稿询问“保存 / 不保存 / 取消”，取消留在画布上。
 * 从剪辑里打开的画布（4.1 嵌入模式）返回按钮是“返回剪辑 · 项目名”：离开后回到剪辑原来的位置。
 * 画布没有命令带，左上角浮一条返回条：返回箭头、画布名、保存状态，与其他编辑器命令带左端是同一组信息。
 */
const CanvasWorkspace = (): JSX.Element => {
  const { t } = useTranslation();
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const isOpeningProject = useProjectStore((state) => state.isOpeningProject);
  const openError = useProjectStore((state) => state.openError);
  const closeProject = useProjectStore((state) => state.closeProject);
  const persistenceError = useProjectStore((state) => state.persistenceError);
  const [isLeavingProject, setIsLeavingProject] = useState(false);
  const embeddedHost = useEmbeddedHost(currentProjectId);
  const inspectionReadOnly = isUiInspectionReadOnly();
  const session = currentProjectId ? findCanvasProjectInstance(currentProjectId)?.session ?? null : null;
  const sessionState = useDocumentSessionState(session);
  const backLabel = embeddedHost ? t('ui:documentLibrary.embedded.returnTo', { name: embeddedHost.label }) : t('canvas.backToProjects');

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
      const leave = async () => {
        if (projectId && !inspectionReadOnly) await updateCanvasProjectCover(projectId);
        return await closeProject();
      };
      if (projectId) await returnFromEmbedded(projectId, leave);
      else await leave();
    } catch {
      // store 已记录并公开保存错误；留在画布上，避免误导用户以为已经安全退出。
    } finally {
      setIsLeavingProject(false);
    }
  }, [closeProject, inspectionReadOnly, isLeavingProject]);

  return (
    <ReactFlowProvider>
      <div className="flex h-full min-h-0 w-full flex-col bg-window text-text1">
        {currentProjectId && <ApplicationOperationReviewBanner documentId={currentProjectId} domain="canvas" label="画布" />}
        {!currentProjectId && !isOpeningProject && <CanvasLibrary />}

        {(currentProjectId || isOpeningProject) && (
          <div className="relative min-h-0 w-full flex-1 bg-canvas" aria-busy={isOpeningProject}>
            {/* 截封面期间隐藏自己：它悬在画布上，留着会被一起截进节点区域封面里 */}
            {!isLeavingProject && (
              <div className="ui-glass absolute left-3 top-3 z-sticky flex max-w-md items-center gap-2 rounded-lg p-0.5 pr-3">
                {/* 从剪辑里打开时写明回到哪（与其他编辑器嵌入时的返回一致）；平常只放返回箭头 */}
                {embeddedHost ? (
                  <UiButton
                    size="sm"
                    onClick={() => void handleBackToProjects()}
                    disabled={isOpeningProject && Boolean(currentProjectId)}
                  >
                    <ArrowLeft />
                    {backLabel}
                  </UiButton>
                ) : (
                  <UiIconButton
                    size="sm"
                    aria-label={backLabel}
                    tooltip={backLabel}
                    onClick={() => void handleBackToProjects()}
                    disabled={isOpeningProject && Boolean(currentProjectId)}
                  >
                    <ArrowLeft />
                  </UiIconButton>
                )}
                {sessionState ? (
                  <>
                    <span className="min-w-0 truncate text-13 text-text1" title={sessionState.meta.name}>{sessionState.meta.name}</span>
                    <DocumentSaveStatus session={session} />
                  </>
                ) : null}
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
