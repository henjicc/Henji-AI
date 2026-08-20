import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useCanvasExecutionStateStore } from '@/stores/canvasExecutionStateStore'

type State = ReturnType<typeof useCanvasExecutionStateStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const REASON = '当前执行节点与阶段是画布执行协调器维护的瞬态 UI 投影，只用于运行光晕和状态文案；'
  + '正式运行结果、失败与生成任务状态分别由画布节点数据和生成任务真相源维护，助手无需读写这份显示状态。'

export const CANVAS_EXECUTION_STATE_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'canvasExecutionStateStore',
  title: '画布节点执行状态投影',
  entries: {
    beginNodeExecution: { kind: 'excluded', category: 'derived', reason: REASON },
    endNodeExecution: { kind: 'excluded', category: 'derived', reason: REASON },
    resetNodeExecutions: { kind: 'excluded', category: 'derived', reason: REASON },
  },
}
