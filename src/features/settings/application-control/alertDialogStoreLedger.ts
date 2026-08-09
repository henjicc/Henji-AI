import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useAlertDialogStore } from '@/stores/alertDialogStore'

type State = ReturnType<typeof useAlertDialogStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const REASON = '全局提示/错误弹窗队列由系统在检测到错误或需要提示用户时压入（showAlertDialog），'
  + '用户点击关闭只是确认已读，不是可配置的应用状态；助手没有"弹窗提醒自己"或"替用户关闭'
  + '弹窗"的正当场景，出错时应该通过任务失败结果告知用户，而不是操作这个队列。'

export const ALERT_DIALOG_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'alertDialogStore',
  title: '全局提示/错误弹窗队列',
  entries: {
    show: { kind: 'excluded', category: 'internal', reason: REASON },
    dismissCurrent: { kind: 'excluded', category: 'internal', reason: REASON },
  },
}
