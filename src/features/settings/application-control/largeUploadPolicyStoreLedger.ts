import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useLargeUploadPromptStore } from '@/services/largeUploadPolicy'

type State = ReturnType<typeof useLargeUploadPromptStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const REASON = '大文件（>100MB）处理询问弹窗队列，只在用户策略为"每次询问"且本地磁盘文件超过'
  + '阈值时才会入队；enqueue 由 resolveLargeUploadAction 在真正遇到大文件时触发，'
  + 'settleCurrent 是用户在弹窗里点击"复制"/"引用"。这是与 alertDialogStore 同类的系统弹窗'
  + '队列，不是可配置的应用状态；策略本身已经通过 generation.large_upload_strategy 属性对'
  + '助手开放（设为固定策略可以完全绕开这个弹窗），助手不需要也不应该替用户点这个弹窗。'

/*
 * 文件名与 store 变量名不对应：文件是 largeUploadPolicy.ts（同时导出策略判断函数），
 * store 变量是 useLargeUploadPromptStore。storeId 必须是文件 basename 'largeUploadPolicy'，
 * 门禁按文件路径的 basename 匹配账本，不看 store 变量名（见 4.1 的清点逻辑）。
 */
export const LARGE_UPLOAD_POLICY_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'largeUploadPolicy',
  title: '大文件处理询问弹窗队列',
  entries: {
    enqueue: { kind: 'excluded', category: 'internal', reason: REASON },
    settleCurrent: { kind: 'excluded', category: 'internal', reason: REASON },
  },
}
