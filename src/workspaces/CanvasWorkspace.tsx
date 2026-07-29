import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { UiButton } from '@/components/ui';
import { Canvas } from '@/features/canvas/Canvas';
import { ProjectManager } from '@/features/project/ProjectManager';
import { useProjectStore } from '@/stores/projectStore';
import '@/features/canvas/storyboard.css';

const CanvasWorkspace = (): JSX.Element => {
  const isHydrated = useProjectStore((state) => state.isHydrated);
  const hydrate = useProjectStore((state) => state.hydrate);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const closeProject = useProjectStore((state) => state.closeProject);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <ReactFlowProvider>
      <div className="h-full min-h-0 w-full bg-app text-text-dark">
        {!isHydrated && <div className="h-full w-full bg-app" />}

        {isHydrated && !currentProjectId && <ProjectManager />}

        {isHydrated && currentProjectId && (
          <div className="relative h-full w-full">
            <UiButton
              onClick={closeProject}
              /* 悬浮在画布上，背后是用户内容而非纯色 UI */
              variant="glass"
              size="sm"
              className="absolute left-3 top-3 z-sticky px-3"
            >
              返回项目
            </UiButton>
            <Canvas />
          </div>
        )}
      </div>
    </ReactFlowProvider>
  );
};

export default CanvasWorkspace;
