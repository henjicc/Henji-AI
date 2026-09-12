import { useEffect } from 'react'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { resumeCanvasProjectGeneration } from '../application/canvasResumePollingService'

/** 界面只触发正式恢复服务；续查和结果提交不依赖 React。 */
export function useCanvasResumePolling(): void {
  const nodes = useCanvasStore((state) => state.nodes)
  const projectId = useProjectStore((state) => state.currentProjectId)
  useEffect(() => {
    if (projectId) resumeCanvasProjectGeneration(projectId)
  }, [nodes, projectId])
}
