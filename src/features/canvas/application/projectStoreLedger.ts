import type { ApplicationStoreActionBinding, ApplicationStoreActionLedger } from '@/core/application-control'

import type { useProjectStore } from '@/stores/projectStore'

/*
 * projectStore（画布页界面状态）的界面动作账本。
 *
 * 3.4 起画布是 `.henji-canvas` 文档：列出、新建、改名、移动、副本、回收站都归通用文档能力，
 * 这里只剩“显示哪份画布”的界面状态与离开流程。
 */

type State = ReturnType<typeof useProjectStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const CAPABILITY = (capabilityId: string): ApplicationStoreActionBinding => ({ kind: 'capability', capabilityId })

export const PROJECT_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'projectStore',
  title: '画布页',
  entries: {
    openProject: CAPABILITY('open_document'),
    openCanvasDocument: CAPABILITY('open_document'),
    createCanvasDraft: CAPABILITY('create_document'),
    closeProject: {
      kind: 'excluded',
      category: 'user_only',
      reason: '返回画布列表是界面导航：已保存的画布写完关闭，草稿要由用户在离开提示里选择“保存 / 不保存 / 取消”，'
        + '助手不替用户做这个选择；画布内容随时自动保存，不需要先关闭才能被读到。',
    },
    clearPersistenceError: {
      kind: 'excluded',
      category: 'internal',
      reason: '仅清除画布写盘失败提示；保存成功时会自动清除，不是业务数据操作。',
    },
    getCurrentProject: {
      kind: 'excluded',
      category: 'internal',
      reason: '纯读取访问器；助手读画布内容用 get_canvas_project。',
    },
  },
}
