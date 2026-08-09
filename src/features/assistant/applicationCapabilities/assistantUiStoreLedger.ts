import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useAssistantUiStore } from '../store/assistantUiStore'

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
    setOpen: { kind: 'excluded', category: 'view_state', reason: CHROME_REASON },
    toggleOpen: { kind: 'excluded', category: 'view_state', reason: CHROME_REASON },
    setMode: { kind: 'excluded', category: 'view_state', reason: CHROME_REASON },
    setFloatingPosition: { kind: 'excluded', category: 'view_state', reason: CHROME_REASON },
    setSize: { kind: 'excluded', category: 'view_state', reason: CHROME_REASON },
    setThreadId: { kind: 'excluded', category: 'view_state', reason: CHROME_REASON },
    startNewConversation: { kind: 'excluded', category: 'view_state', reason: CHROME_REASON },
    setActiveRun: {
      kind: 'excluded',
      category: 'derived',
      reason: '当前运行 id 与目标是 useAgentRun.ts 在运行开始/推进时自动写回的派生投影，'
        + '供面板展示进度用，不是用户或助手可以独立设置的值。',
    },
    setPendingGoal: {
      kind: 'excluded',
      category: 'internal',
      reason: '面板打开前暂存的待发送目标文本，是 openAssistantDiagnosis.ts 等内部诊断入口'
        + '排队消息用的中转态，面板挂载后立即消费清空，不是独立动作。',
    },
    /*
     * 审批模式是用户对助手的授权开关（自动执行 / 每步确认等）。助手改它等于自己给自己
     * 提权，必须永久排除，理由与 4.3 任务文档的要求一致。
     */
    setApprovalMode: {
      kind: 'excluded',
      category: 'user_only',
      reason: '审批模式是用户对助手的授权开关，决定助手接下来能不能免确认执行动作；'
        + '助手改它等于自我提权，只能由用户在设置里操作。',
    },
  },
}
