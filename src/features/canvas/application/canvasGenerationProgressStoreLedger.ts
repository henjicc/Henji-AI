import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore'

type State = ReturnType<typeof useCanvasGenerationProgressStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const REASON = '节点生成进度（0~1）是生成任务轮询回调实时写回的派生投影，专门拆成独立 store'
  + '是为了避免高频写入触发全画布重渲染（见文件头注释），与节点数据本身无关；助手看某个'
  + '生成节点是否完成走 get_canvas_node / list_generation_history，不需要读写这个进度条。'

export const CANVAS_GENERATION_PROGRESS_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'canvasGenerationProgressStore',
  title: '画布生成进度投影',
  entries: {
    setProgress: { kind: 'excluded', category: 'derived', reason: REASON },
    clearProgress: { kind: 'excluded', category: 'derived', reason: REASON },
    clearAllProgress: { kind: 'excluded', category: 'derived', reason: REASON },
  },
}
