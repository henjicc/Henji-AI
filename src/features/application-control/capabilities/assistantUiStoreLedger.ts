import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useAssistantUiStore } from '../../assistant/store/assistantUiStore'

type State = ReturnType<typeof useAssistantUiStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const CHROME_REASON = '助手自己的面板显示态（开关/停靠位置/悬浮坐标/尺寸/当前显示哪个会话线程/'
  + '是否开了新会话），只影响这个面板本身看起来什么样，不产生任何工程或业务内容；助手运行'
  + '期间面板必然已经打开，没有让它自己再去挪动、缩放或切换自己所在面板的正当场景，擅自这样'
  + '做对用户来说也只是无意义的界面抖动。'

export const ASSISTANT_UI_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'assistantUiStore',
  title: '助手自身面板',
  entries: {
    setEmbeddedAccess: { kind: 'excluded', category: 'user_only', reason: '内置助手的操作授权由用户在可信界面选择，助手不能修改自己的授权。' },
    setOpen: { kind: 'excluded', category: 'view_state', reason: CHROME_REASON },
    toggleOpen: { kind: 'excluded', category: 'view_state', reason: CHROME_REASON },
    setMode: { kind: 'excluded', category: 'view_state', reason: CHROME_REASON },
    setFloatingPosition: { kind: 'excluded', category: 'view_state', reason: CHROME_REASON },
    setSize: { kind: 'excluded', category: 'view_state', reason: CHROME_REASON },
    setPendingGoal: {
      kind: 'excluded',
      category: 'internal',
      reason: '面板打开前暂存的待发送目标文本，是 openAssistantDiagnosis.ts 等内部诊断入口'
        + '排队消息用的中转态，面板挂载后立即消费清空，不是独立动作。',
    },
  },
}
