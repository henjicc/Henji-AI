import { useEffect } from 'react'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import type { CanvasNode } from '../domain/canvasNodes'
import { resumeCanvasProjectGeneration } from '../application/canvasResumePollingService'

/** 数据引用变了的节点（含新增）；拖动、缩放只换位置与尺寸，data 引用不变。 */
function collectDataChangedNodeIds(previous: readonly CanvasNode[], next: readonly CanvasNode[]): Set<string> {
  const changed = new Set<string>()
  let previousById: Map<string, CanvasNode> | null = null
  next.forEach((node, index) => {
    let before: CanvasNode | undefined = previous[index]
    if (before?.id !== node.id) {
      previousById ??= new Map(previous.map(item => [item.id, item]))
      before = previousById.get(node.id)
    }
    if (before?.data !== node.data) changed.add(node.id)
  })
  return changed
}

/**
 * 界面只触发正式恢复服务；续查和结果提交不依赖 React。
 * 打开工程时整体扫一遍，之后只把 data 变了的节点交给恢复服务，拖动时不再逐帧全量扫描。
 */
export function useCanvasResumePolling(): void {
  const projectId = useProjectStore((state) => state.currentProjectId)
  useEffect(() => {
    if (!projectId) return
    resumeCanvasProjectGeneration(projectId)
    return useCanvasStore.subscribe((state, previous) => {
      if (state.nodes === previous.nodes) return
      const changed = collectDataChangedNodeIds(previous.nodes, state.nodes)
      if (changed.size > 0) resumeCanvasProjectGeneration(projectId, changed)
    })
  }, [projectId])
}
