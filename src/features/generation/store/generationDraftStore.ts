import { create } from 'zustand'

import {
  applyGenerationDraftPatch,
  createEmptyGenerationDraft,
  type GenerationDraft,
} from '../domain/generationDraft'
import {
  createMediaGeneratorPromptReferences,
  reconcileMediaGeneratorPromptImages,
  resolveMediaGeneratorPromptCarrier,
  type MediaGeneratorPromptCarrier,
} from '@/components/MediaGenerator/promptState'
import {
  compactPromptMediaReferenceSpacing,
  parseLegacyPromptString,
} from '@/core/inputs/promptDocument'

/*
 * 生成页输入态的全局 store（5.3 建 store，5.4 加 revision 与属性写入接口）。只有一个
 * 消费方（MediaGenerator/index.tsx 的 useUIState()，已用 grep 确认全仓库只有这一处
 * 调用），不存在多实例串状态的风险，走任务文档的"方案甲"：单一全局 draft，不按 scope
 * 分片。
 *
 * reducer 逻辑复用 5.1 的 applyGenerationDraftPatch，不重写；三个特殊字段的联动
 * （patchUploadedImages/setLegacyInput/loadPromptCarrier）复用既有的 promptState.ts
 * 纯函数，原样从 useUIState.ts 搬过来，行为不变。
 *
 * 这个 store 里没有模型参数（GenerationDraft 本来就不包含 params，见 5.1 执行记录的
 * 字段清单）——params 由 useModelParams 单独管理，它的联动路径已经在 5.2 接上
 * reconcileGenerationParams，与这个 store 是否存在无关。
 *
 * revision（5.4 新增）：generation.draft 反射实体注册后，mutation 执行器的
 * expectedRevisions 校验需要一个会动的版本号——每次 draft 真的变化（不是引用相等的
 * 空 patch）就 +1，供 GenerationDraftMutationExecutor 使用，与 4.4 给
 * generation.model 加 modelsRevision 计数器是同一类修复。
 */
interface GenerationDraftStoreState {
  draft: GenerationDraft
  revision: number
  /** 批量 patch，一次可以改多个字段；generation.draft 的属性写入执行器（5.4）用这个一次性提交整批变更 */
  patch: (patch: Partial<GenerationDraft>) => void
  /**
   * 单字段读写，完整支持"新值"或"更新函数"两种调用形式，新旧值引用相等时不产生新 draft——
   * 与 5.1 的 usePatchedDraftField 语义完全一致，只是从 React state 换成了 zustand set()。
   */
  patchField: <K extends keyof GenerationDraft>(
    key: K,
    action: GenerationDraft[K] | ((prev: GenerationDraft[K]) => GenerationDraft[K]),
  ) => void
  /** 对应原 setUploadedImages：按 url 数组或更新函数改 uploadedPromptImages，经 reconcile 保留 resourceId */
  patchUploadedImages: (action: string[] | ((prev: string[]) => string[])) => void
  /** 对应原 setInput：把旧版纯文本提示词解析进 promptDocument */
  setLegacyInput: (legacyText: string) => void
  /** 对应原 loadPromptCarrier：一次性替换图片与提示词文档 */
  loadPromptCarrier: (carrier: MediaGeneratorPromptCarrier) => void
  reset: () => void
}

export const useGenerationDraftStore = create<GenerationDraftStoreState>((set) => ({
  draft: createEmptyGenerationDraft(),
  revision: 0,

  patch: (patch) => set((state) => ({
    draft: applyGenerationDraftPatch(state.draft, patch),
    revision: state.revision + 1,
  })),

  patchField: (key, action) => set((state) => {
    const nextValue = typeof action === 'function'
      ? (action as (prev: typeof state.draft[typeof key]) => typeof state.draft[typeof key])(state.draft[key])
      : action
    if (nextValue === state.draft[key]) return state
    return {
      draft: applyGenerationDraftPatch(state.draft, { [key]: nextValue } as Partial<GenerationDraft>),
      revision: state.revision + 1,
    }
  }),

  patchUploadedImages: (action) => set((state) => {
    const currentUrls = state.draft.uploadedPromptImages.map((image) => image.url)
    const nextUrls = typeof action === 'function' ? action(currentUrls) : action
    const nextImages = reconcileMediaGeneratorPromptImages(state.draft.uploadedPromptImages, nextUrls)
    if (nextImages === state.draft.uploadedPromptImages) return state
    return {
      draft: applyGenerationDraftPatch(state.draft, { uploadedPromptImages: nextImages }),
      revision: state.revision + 1,
    }
  }),

  setLegacyInput: (legacyText) => set((state) => {
    const references = createMediaGeneratorPromptReferences(state.draft.uploadedPromptImages)
    const nextDocument = compactPromptMediaReferenceSpacing(
      parseLegacyPromptString(legacyText, { references }),
    )
    return {
      draft: applyGenerationDraftPatch(state.draft, { promptDocument: nextDocument }),
      revision: state.revision + 1,
    }
  }),

  loadPromptCarrier: (carrier) => set((state) => {
    const resolved = resolveMediaGeneratorPromptCarrier(carrier)
    return {
      draft: applyGenerationDraftPatch(state.draft, {
        uploadedPromptImages: resolved.images,
        promptDocument: resolved.document,
      }),
      revision: state.revision + 1,
    }
  }),

  reset: () => set((state) => ({ draft: createEmptyGenerationDraft(), revision: state.revision + 1 })),
}))
