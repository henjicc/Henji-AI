import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { getAvailableProviders } from '@/utils/modelHelpers'
import { showAlertDialog } from '@/stores/alertDialogStore'
import {
  compactPromptMediaReferenceSpacing,
  parseLegacyPromptString,
  toLegacyPromptString,
  type PromptMediaBinding,
} from '@/core/inputs/promptDocument'
import {
  createMediaGeneratorPromptBindings,
  createMediaGeneratorPromptReferences,
  reconcileMediaGeneratorPromptImages,
  resolveMediaGeneratorPromptCarrier,
  type MediaGeneratorPromptCarrier,
} from '../promptState'
import {
  applyGenerationDraftPatch,
  createEmptyGenerationDraft,
  type GenerationDraft,
} from '@/features/generation/domain/generationDraft'

/**
 * 纯 UI 状态管理（不包含模型参数）
 * 职责：管理界面交互状态
 *
 * 内部只有一个 GenerationDraft（5.1 抽出的纯领域层），18 个字段合并成一次 patch。
 * 对外导出的每一组 xxx/setXxx 签名与迁移前逐字一致——这是本次重构唯一的验收标准，
 * 4 个消费方（index.tsx / GeneratorConfigurationBar.tsx / useReeditContent.ts /
 * useModelState.ts）零改动。
 */

/**
 * 把 draft 上的一个字段包成独立的 Dispatch<SetStateAction<T>>，行为与原来那个字段
 * 单独一个 useState 时完全一致：既接受新值也接受 `(prev) => next` 更新函数，新值与
 * 旧值引用相等时不产生新的 draft（对应 React 对 useState 更新函数返回同值时跳过重渲染）。
 */
function usePatchedDraftField<K extends keyof GenerationDraft>(
  setDraft: Dispatch<SetStateAction<GenerationDraft>>,
  key: K,
): Dispatch<SetStateAction<GenerationDraft[K]>> {
  return useCallback((action) => {
    setDraft((current) => {
      const nextValue = typeof action === 'function'
        ? (action as (prev: GenerationDraft[K]) => GenerationDraft[K])(current[key])
        : action
      if (nextValue === current[key]) return current
      return applyGenerationDraftPatch(current, { [key]: nextValue } as Partial<GenerationDraft>)
    })
  }, [setDraft, key])
}

function useUIStateValue() {
  const providersSnapshot = getAvailableProviders()
  const providersSignature = providersSnapshot.map(p => `${p.id}:${p.models.map(m => m.id).join(',')}`).join('|')

  const [draft, setDraft] = useState<GenerationDraft>(createEmptyGenerationDraft)

  const setPromptDocument = usePatchedDraftField(setDraft, 'promptDocument')
  const setSelectedProvider = usePatchedDraftField(setDraft, 'selectedProvider')
  const setSelectedModel = usePatchedDraftField(setDraft, 'selectedModel')
  const setUploadedFilePaths = usePatchedDraftField(setDraft, 'uploadedFilePaths')
  const setUploadedVideos = usePatchedDraftField(setDraft, 'uploadedVideos')
  const setUploadedVideoFiles = usePatchedDraftField(setDraft, 'uploadedVideoFiles')
  const setUploadedVideoFilePaths = usePatchedDraftField(setDraft, 'uploadedVideoFilePaths')
  const setUploadedAudios = usePatchedDraftField(setDraft, 'uploadedAudios')
  const setUploadedAudioFilePaths = usePatchedDraftField(setDraft, 'uploadedAudioFilePaths')
  const setFileOrder = usePatchedDraftField(setDraft, 'fileOrder')
  const setUploadedVideoDuration = usePatchedDraftField(setDraft, 'uploadedVideoDuration')
  const setUploadedVideoTrimStart = usePatchedDraftField(setDraft, 'uploadedVideoTrimStart')
  const setUploadedVideoTrimEnd = usePatchedDraftField(setDraft, 'uploadedVideoTrimEnd')
  const setModelFilterProvider = usePatchedDraftField(setDraft, 'modelFilterProvider')
  const setModelFilterType = usePatchedDraftField(setDraft, 'modelFilterType')
  const setModelFilterFunction = usePatchedDraftField(setDraft, 'modelFilterFunction')
  const setFavoriteModels = usePatchedDraftField(setDraft, 'favoriteModels')

  const uploadedImages = useMemo(
    () => draft.uploadedPromptImages.map((image) => image.url),
    [draft.uploadedPromptImages],
  )
  const promptReferences = useMemo(
    () => createMediaGeneratorPromptReferences(draft.uploadedPromptImages),
    [draft.uploadedPromptImages],
  )
  const input = useMemo(
    () => toLegacyPromptString(draft.promptDocument, { references: promptReferences }),
    [draft.promptDocument, promptReferences],
  )
  const promptMediaBindings = useMemo<PromptMediaBinding[]>(() => (
    createMediaGeneratorPromptBindings(draft.uploadedPromptImages, draft.uploadedFilePaths)
  ), [draft.uploadedFilePaths, draft.uploadedPromptImages])

  /*
   * 三个特殊 setter：内部要同时读写多个 draft 字段，不能用 usePatchedDraftField 的
   * 单字段模型。都改成在 setDraft 的更新函数里直接读 current，取代原来闭包捕获
   * 单独 state 变量的写法——这样不再需要把 promptReferences 放进依赖数组，
   * setInput 也能保持像 setUploadedImages 一样稳定的引用。
   */
  const setUploadedImages: Dispatch<SetStateAction<string[]>> = useCallback((action) => {
    setDraft((current) => {
      const currentUrls = current.uploadedPromptImages.map((image) => image.url)
      const nextUrls = typeof action === 'function'
        ? (action as (prev: string[]) => string[])(currentUrls)
        : action
      const nextImages = reconcileMediaGeneratorPromptImages(current.uploadedPromptImages, nextUrls)
      if (nextImages === current.uploadedPromptImages) return current
      return applyGenerationDraftPatch(current, { uploadedPromptImages: nextImages })
    })
  }, [])

  const setInput = useCallback((legacyText: string): void => {
    setDraft((current) => {
      const references = createMediaGeneratorPromptReferences(current.uploadedPromptImages)
      const nextDocument = compactPromptMediaReferenceSpacing(
        parseLegacyPromptString(legacyText, { references }),
      )
      return applyGenerationDraftPatch(current, { promptDocument: nextDocument })
    })
  }, [])

  const loadPromptCarrier = useCallback((carrier: MediaGeneratorPromptCarrier): void => {
    const resolved = resolveMediaGeneratorPromptCarrier(carrier)
    setDraft((current) => applyGenerationDraftPatch(current, {
      uploadedPromptImages: resolved.images,
      promptDocument: resolved.document,
    }))
  }, [])

  // 弹窗渲染统一收在 App 根部的 GlobalAlertDialog，这里只负责发起
  const showAlert = (title: string, message: string, type: 'info' | 'warning' | 'error' = 'warning') =>
    showAlertDialog({ title, message, type })
  useEffect(() => {
    const currentProviders = getAvailableProviders()
    if (currentProviders.length === 0) return

    const isValidSelection = currentProviders.some(
      provider =>
        provider.id === draft.selectedProvider &&
        provider.models.some(model => model.id === draft.selectedModel)
    )

    if (!isValidSelection) {
      const firstProvider = currentProviders[0]
      const firstModel = firstProvider.models[0]
      if (firstModel) {
        setSelectedProvider(firstProvider.id)
        setSelectedModel(firstModel.id)
      }
    }
  }, [providersSignature, draft.selectedProvider, draft.selectedModel, setSelectedProvider, setSelectedModel])

  return {
    input,
    setInput,
    promptDocument: draft.promptDocument,
    setPromptDocument,
    promptReferences,
    promptMediaBindings,
    loadPromptCarrier,
    selectedProvider: draft.selectedProvider,
    setSelectedProvider,
    selectedModel: draft.selectedModel,
    setSelectedModel,

    uploadedImages,
    setUploadedImages,
    uploadedFilePaths: draft.uploadedFilePaths,
    setUploadedFilePaths,
    uploadedVideos: draft.uploadedVideos,
    setUploadedVideos,
    uploadedVideoFiles: draft.uploadedVideoFiles,
    setUploadedVideoFiles,
    uploadedVideoFilePaths: draft.uploadedVideoFilePaths,
    setUploadedVideoFilePaths,
    uploadedAudios: draft.uploadedAudios,
    setUploadedAudios,
    uploadedAudioFilePaths: draft.uploadedAudioFilePaths,
    setUploadedAudioFilePaths,
    fileOrder: draft.fileOrder,
    setFileOrder,
    uploadedVideoDuration: draft.uploadedVideoDuration,
    setUploadedVideoDuration,
    uploadedVideoTrimStart: draft.uploadedVideoTrimStart,
    setUploadedVideoTrimStart,
    uploadedVideoTrimEnd: draft.uploadedVideoTrimEnd,
    setUploadedVideoTrimEnd,

    modelFilterProvider: draft.modelFilterProvider,
    setModelFilterProvider,
    modelFilterType: draft.modelFilterType,
    setModelFilterType,
    modelFilterFunction: draft.modelFilterFunction,
    setModelFilterFunction,
    favoriteModels: draft.favoriteModels,
    setFavoriteModels,

    showAlert
  }
}

export type UIState = ReturnType<typeof useUIStateValue>

export function useUIState(): UIState {
  return useUIStateValue()
}
