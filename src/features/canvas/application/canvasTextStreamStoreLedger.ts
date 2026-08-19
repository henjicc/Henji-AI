import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useCanvasTextStreamStore } from '@/stores/canvasTextStreamStore'

type State = ReturnType<typeof useCanvasTextStreamStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const REASON = '文本流式预览是模型生成期间的瞬态显示投影，独立存放是为了避免高频写入 ReactFlow '
  + '节点数组；正式结果只在生成结束时写入画布节点数据，助手无需读写这份临时预览。'

export const CANVAS_TEXT_STREAM_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'canvasTextStreamStore',
  title: '画布文本流式预览',
  entries: {
    setPreview: { kind: 'excluded', category: 'derived', reason: REASON },
    clearPreviews: { kind: 'excluded', category: 'derived', reason: REASON },
    clearAllPreviews: { kind: 'excluded', category: 'derived', reason: REASON },
  },
}
