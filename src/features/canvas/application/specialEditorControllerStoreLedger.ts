import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useCanvasSpecialEditorController } from './specialEditorController'

type State = ReturnType<typeof useCanvasSpecialEditorController.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const SESSION_REASON = '专用编辑器会话只保存节点外面板的初始值、未确认草稿和关闭确认状态；'
  + '确认后的业务数据由 specialEditorApplicationService 原子写回画布节点，工程持久化不读取该会话。'

export const SPECIAL_EDITOR_CONTROLLER_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'specialEditorController',
  title: '画布专用编辑器临时会话',
  entries: {
    open: { kind: 'excluded', category: 'view_state', reason: SESSION_REASON },
    updateDraft: { kind: 'excluded', category: 'view_state', reason: SESSION_REASON },
    requestCancel: { kind: 'excluded', category: 'view_state', reason: SESSION_REASON },
    keepEditing: { kind: 'excluded', category: 'view_state', reason: SESSION_REASON },
    discard: { kind: 'excluded', category: 'view_state', reason: SESSION_REASON },
    complete: {
      kind: 'excluded',
      category: 'internal',
      reason: 'specialEditorApplicationService 完成节点事务后调用该动作清空临时会话；'
        + '它不代表一次独立业务提交，也不能绕过画布节点写入服务单独执行。',
    },
  },
}
