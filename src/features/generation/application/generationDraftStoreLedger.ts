import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useGenerationDraftStore } from '../store/generationDraftStore'

type State = ReturnType<typeof useGenerationDraftStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

/*
 * generationDraftStore 只有 6 个动作（不是 GenerationDraft 的 18 个字段——那 18 个字段
 * 通过 useUIState.ts 里包了一层的 xxx/setXxx 消费，account 的是 store 自己的方法，
 * 与 4.2/4.3 建的其它账本同一个口径）。
 */
export const GENERATION_DRAFT_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'generationDraftStore',
  title: '生成草稿',
  entries: {
    /*
     * patchField 是通用的单字段写入原语，被 useUIState.ts 包出 16 个 xxx/setXxx 用，
     * 其中 5 个对应 generation.draft 已注册的可写属性（selected_model/uploaded_videos/
     * uploaded_audios/uploaded_video_trim_start/uploaded_video_trim_end，见
     * generationDraftFields.ts 的 storeActions 声明）。其余字段（modelFilterProvider/Type/
     * Function、favoriteModels、fileOrder）是刻意排除的视图态/收藏偏好，判断依据写在
     * generationDraftFields.ts 顶部的大注释里，不在这里重复。
     */
    patchField: {
      kind: 'property',
      propertyIds: [
        'generation.draft.selected_model',
        'generation.draft.uploaded_videos',
        'generation.draft.uploaded_audios',
        'generation.draft.uploaded_video_trim_start',
        'generation.draft.uploaded_video_trim_end',
      ],
    },
    patchUploadedImages: { kind: 'property', propertyIds: ['generation.draft.uploaded_images'] },
    setLegacyInput: { kind: 'property', propertyIds: ['generation.draft.prompt_text'] },
    /*
     * loadPromptCarrier 一次性替换图片与提示词文档，等价于依次写 uploaded_images 与
     * prompt_text 两条已经独立可写的属性——不是字面调用同一个方法，是"助手有没有等效能力"，
     * 与 2.2 记录里 reorderShot 绑到 time 属性是同一个先例。
     */
    loadPromptCarrier: {
      kind: 'property',
      propertyIds: ['generation.draft.uploaded_images', 'generation.draft.prompt_text'],
    },
    patch: {
      kind: 'excluded',
      category: 'internal',
      reason: '批量写入原语，被 GenerationDraftMutationExecutor 用来一次性提交一个 mutation '
        + '步骤里的多条属性变更，不是界面上独立的用户入口。',
    },
    reset: {
      kind: 'excluded',
      category: 'internal',
      reason: '生成页界面没有"清空草稿"按钮调用这个方法，是建 store 时提供的工具方法；'
        + '助手若需要清空草稿可以逐条把已注册的可写属性写回默认值，达到等价效果。',
    },
  },
}
