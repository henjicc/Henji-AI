import type { CanvasRegisteredExecutor } from './canvasExecutionContracts'

export const canvasTaskExecutors = new Map<string, CanvasRegisteredExecutor>()

/** 任务持有执行器直到业务结束，页面挂载/卸载不能替换在途执行器。 */
export function retainCanvasTaskExecutor(projectId: string, nodeId: string, executor: CanvasRegisteredExecutor): () => void {
  const key = `${projectId}:${nodeId}`
  if (canvasTaskExecutors.has(key)) throw new Error('此节点已有任务执行器，不能重复接管')
  canvasTaskExecutors.set(key, executor)
  return () => { if (canvasTaskExecutors.get(key) === executor) canvasTaskExecutors.delete(key) }
}

