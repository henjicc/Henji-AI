import { useCanvasStore } from '@/stores/canvasStore'

import {
  areCanvasExecutionPlanTopologiesEqual,
  createCanvasExecutionPlan,
  type CanvasDependencyMode,
  type CanvasExecutionPlan,
} from './canvasExecutionPlan'

export function assertCanvasExecutionPlanCurrent(
  rootNodeId: string,
  expected: CanvasExecutionPlan,
  getDependencyMode: (nodeId: string) => CanvasDependencyMode,
  store = useCanvasStore,
): void {
  const snapshot = store.getState()
  let current: CanvasExecutionPlan
  try {
    current = createCanvasExecutionPlan(
      rootNodeId,
      snapshot.nodes,
      snapshot.edges,
      getDependencyMode,
    )
  } catch (cause) {
    // 原计划已经有效；现在无法构建意味着运行期间依赖发生变化，不能继续旧计划。
    throw new Error('运行期间画布依赖结构已变化，请重新运行', { cause })
  }
  if (!areCanvasExecutionPlanTopologiesEqual(expected, current)) {
    throw new Error('运行期间画布依赖结构已变化，请重新运行')
  }
}
