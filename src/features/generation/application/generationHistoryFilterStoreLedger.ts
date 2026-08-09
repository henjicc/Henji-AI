import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useGenerationHistoryFilterStore } from '@/stores/generationHistoryFilterStore'

type State = ReturnType<typeof useGenerationHistoryFilterStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

/*
 * 覆盖核对（4.3 任务要求）：list_generation_history 的 inputSchema
 * （src/core/assistant/builtinApplicationCapabilities.ts）只有 mediaType / status / limit
 * 三个参数。界面上的 7 个筛选维度里，只有 mediaType 能通过它等价达成；keyword（关键词）、
 * providerId（供应商）、modelId（模型）、timePreset/startDate/endDate（时间范围）这 6 项
 * 助手完全没有对应入口——不是视图态，是真实缺口，登记为 gap。这 6 项目前不属于本任务范围内
 * 已规划的任何一期，先如实记账，交给后续排期扩展 list_generation_history 的 inputSchema。
 */
const UNCOVERED_FILTER_REASON = '界面上有对应的筛选输入框，但 list_generation_history 的 '
  + 'inputSchema 里没有覆盖这一维度（只有 mediaType/status/limit 三个参数），助手当前查不到'
  + '按这个条件筛选的历史记录；需要扩展该能力的输入 schema 才能补上，不属于本任务范围。'

export const GENERATION_HISTORY_FILTER_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'generationHistoryFilterStore',
  title: '生成历史筛选',
  entries: {
    setKeyword: { kind: 'gap', plannedPhase: '待排期', reason: UNCOVERED_FILTER_REASON },
    setProviderId: { kind: 'gap', plannedPhase: '待排期', reason: UNCOVERED_FILTER_REASON },
    setModelId: { kind: 'gap', plannedPhase: '待排期', reason: UNCOVERED_FILTER_REASON },
    /*
     * mediaType 是唯一一个 list_generation_history 已覆盖的维度——助手用
     * list_generation_history({mediaType}) 达成同样的"只看某种媒体类型的历史"效果，
     * 机制不同（查询参数 vs. 界面筛选框状态）但对用户可感知的能力等价。
     */
    setMediaType: { kind: 'capability', capabilityId: 'list_generation_history' },
    setTimePreset: { kind: 'gap', plannedPhase: '待排期', reason: UNCOVERED_FILTER_REASON },
    setStartDate: { kind: 'gap', plannedPhase: '待排期', reason: UNCOVERED_FILTER_REASON },
    setEndDate: { kind: 'gap', plannedPhase: '待排期', reason: UNCOVERED_FILTER_REASON },
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
