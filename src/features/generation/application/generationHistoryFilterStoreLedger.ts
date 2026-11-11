import type { ApplicationStoreActionBinding, ApplicationStoreActionLedger } from '@/core/application-control'

import type { useGenerationHistoryFilterStore } from '@/stores/generationHistoryFilterStore'

type State = ReturnType<typeof useGenerationHistoryFilterStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

/*
 * 覆盖核对：`list_generation_history` 的 inputSchema 现在覆盖界面上全部 7 个筛选维度
 * （keyword / providerId / modelId / mediaType / timePreset / startDate / endDate）。
 *
 * 建账当时只有 mediaType / status / limit 三个参数，另外 6 维登记成了 gap——不是视图态，
 * 是"用户筛得出来、助手查不到"的真实缺口。补的时候没有在能力侧另写一份谓词，而是把它提到
 * `@/features/generation/domain/generationHistoryFilter`，界面与助手共用：否则关键词搜哪些
 * 字段、时间预设的边界、自定义区间起止填反怎么办这几处早晚漂移，用户会撞上"我筛出 3 条、
 * 助手说只有 1 条"这种谁都说不清的问题。
 */
const FILTER_CAPABILITY: ApplicationStoreActionBinding = {
  kind: 'capability',
  capabilityId: 'list_generation_history',
}

export const GENERATION_HISTORY_FILTER_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'generationHistoryFilterStore',
  title: '生成历史筛选',
  entries: {
    setKeyword: FILTER_CAPABILITY,
    setProviderId: FILTER_CAPABILITY,
    setModelId: FILTER_CAPABILITY,
    setMediaType: FILTER_CAPABILITY,
    setTimePreset: FILTER_CAPABILITY,
    setStartDate: FILTER_CAPABILITY,
    setEndDate: FILTER_CAPABILITY,
    /*
     * resetFilters 清空的是这 7 个纯界面筛选框的本地状态，不对应任何持久化的"当前查询条件"——
     * 助手每次调用 list_generation_history 都是无状态的一次性查询，没有"重置"的概念，
     * 所以这一条本身不是 gap，是单纯的视图态。
     */
    resetFilters: {
      kind: 'excluded',
      category: 'view_state',
      reason: '清空的是 7 个筛选输入框的本地界面状态，不对应任何持久化的查询条件；助手每次'
        + '调用 list_generation_history 都是无状态的一次性查询，没有"重置"这个操作的对应物。',
    },
  },
}
