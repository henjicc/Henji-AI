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
): void {
  const snapshot = useCanvasStore.getState()
  const current = createCanvasExecutionPlan(
    rootNodeId,
    snapshot.nodes,
    snapshot.edges,
    getDependencyMode,
  )
  if (!areCanvasExecutionPlanTopologiesEqual(expected, current)) {
    throw new Error('运行期间画布依赖结构已变化，请重新运行')
  }
}
