import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useCanvasNodeFocusStore } from '@/features/canvas/hooks/useCanvasNodeFocus'

type State = ReturnType<typeof useCanvasNodeFocusStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const REASON = '记录的是"鼠标点进了哪个节点里的输入框"，用来补上原生选中在 nodrag 控件上不触发的缺口，'
  + '本身是鼠标操作的中间产物，不进工程文件也不影响产物；助手用节点 id 直接寻址，不需要先聚焦某个节点。'

export const CANVAS_NODE_FOCUS_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  // storeId 必须等于 store 文件的 basename：store 就写在 hooks/useCanvasNodeFocus.ts 里，
  // 门禁按内容识别 store 文件而不按目录约定，所以这里不是 `canvasNodeFocusStore`。
  storeId: 'useCanvasNodeFocus',
  title: '画布节点内焦点跟踪',
  entries: {
    setFocusedNodeId: { kind: 'excluded', category: 'transient_selection', reason: REASON },
  },
}
