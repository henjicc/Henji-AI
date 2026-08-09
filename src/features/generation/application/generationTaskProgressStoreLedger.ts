import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useGenerationTaskProgressStore } from '@/stores/generationTaskProgressStore'

type State = ReturnType<typeof useGenerationTaskProgressStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const REASON = '生成任务进度（0~100）是任务轮询回调实时写回的派生投影，专门拆成独立 store 是为了'
  + '避免高频写入触发生成工作区整表重渲染（见文件头注释），与任务本身的状态无关；助手看任务'
  + '进度走任务状态查询能力，不需要读写这个进度条。'

export const GENERATION_TASK_PROGRESS_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'generationTaskProgressStore',
  title: '生成任务进度投影',
  entries: {
    setProgress: { kind: 'excluded', category: 'derived', reason: REASON },
    clearProgress: { kind: 'excluded', category: 'derived', reason: REASON },
    clearAllProgress: { kind: 'excluded', category: 'derived', reason: REASON },
  },
}
