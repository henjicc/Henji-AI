import { useCallback, useEffect, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { getAvailableProviders } from '@/utils/modelHelpers'
import { showAlertDialog } from '@/stores/alertDialogStore'
import { toLegacyPromptString, type PromptMediaBinding } from '@/core/inputs/promptDocument'
import {
  createMediaGeneratorPromptBindings,
  createMediaGeneratorPromptReferences,
  type MediaGeneratorPromptCarrier,
} from '../promptState'
import { useGenerationDraftStore } from '@/features/generation/store/generationDraftStore'
import type { GenerationDraft } from '@/features/generation/domain/generationDraft'

/**
 * 纯 UI 状态管理（不包含模型参数）
 * 职责：管理界面交互状态
 *
 * 5.3 起这里只是 generationDraftStore 的薄适配层——草稿本身已经搬进全局 zustand store
 * （全仓库只有这一处 useUIState() 调用，没有多实例串状态的风险，见 5.3 执行记录）。
 * 对外导出的每一组 xxx/setXxx 签名与 store 化前逐字一致，4 个消费方零改动。
 */

/** 把 store 的 patchField 包成某个字段独立的 Dispatch<SetStateAction<T>>，签名与用法都不变。 */
function usePatchedField<K extends keyof GenerationDraft>(
  key: K,
): Dispatch<SetStateAction<GenerationDraft[K]>> {
  const patchField = useGenerationDraftStore((state) => state.patchField)
  return useCallback((action) => patchField(key, action), [patchField, key])
}

function useUIStateValue() {
  const providersSnapshot = getAvailableProviders()
  const providersSignature = providersSnapshot.map(p => `${p.id}:${p.models.map(m => m.id).join(',')}`).join('|')

  // 选择器精确到字段：任何一个字段变化只触发订阅了那个字段的组件重渲染，不是整个 draft。
  const promptDocument = useGenerationDraftStore((state) => state.draft.promptDocument)
  const selectedProvider = useGenerationDraftStore((state) => state.draft.selectedProvider)
  const selectedModel = useGenerationDraftStore((state) => state.draft.selectedModel)
  const uploadedPromptImages = useGenerationDraftStore((state) => state.draft.uploadedPromptImages)
  const uploadedFilePaths = useGenerationDraftStore((state) => state.draft.uploadedFilePaths)
  const uploadedVideos = useGenerationDraftStore((state) => state.draft.uploadedVideos)
  const uploadedVideoFiles = useGenerationDraftStore((state) => state.draft.uploadedVideoFiles)
  const uploadedVideoFilePaths = useGenerationDraftStore((state) => state.draft.uploadedVideoFilePaths)
  const uploadedAudios = useGenerationDraftStore((state) => state.draft.uploadedAudios)
  const uploadedAudioFilePaths = useGenerationDraftStore((state) => state.draft.uploadedAudioFilePaths)
  const fileOrder = useGenerationDraftStore((state) => state.draft.fileOrder)
  const uploadedVideoDuration = useGenerationDraftStore((state) => state.draft.uploadedVideoDuration)
  const uploadedVideoTrimStart = useGenerationDraftStore((state) => state.draft.uploadedVideoTrimStart)
  const uploadedVideoTrimEnd = useGenerationDraftStore((state) => state.draft.uploadedVideoTrimEnd)
  const modelFilterProvider = useGenerationDraftStore((state) => state.draft.modelFilterProvider)
  const modelFilterType = useGenerationDraftStore((state) => state.draft.modelFilterType)
  const modelFilterFunction = useGenerationDraftStore((state) => state.draft.modelFilterFunction)
  const favoriteModels = useGenerationDraftStore((state) => state.draft.favoriteModels)

  const setPromptDocument = usePatchedField('promptDocument')
  const setSelectedProvider = usePatchedField('selectedProvider')
  const setSelectedModel = usePatchedField('selectedModel')
  const setUploadedFilePaths = usePatchedField('uploadedFilePaths')
  const setUploadedVideos = usePatchedField('uploadedVideos')
  const setUploadedVideoFiles = usePatchedField('uploadedVideoFiles')
  const setUploadedVideoFilePaths = usePatchedField('uploadedVideoFilePaths')
  const setUploadedAudios = usePatchedField('uploadedAudios')
  const setUploadedAudioFilePaths = usePatchedField('uploadedAudioFilePaths')
  const setFileOrder = usePatchedField('fileOrder')
  const setUploadedVideoDuration = usePatchedField('uploadedVideoDuration')
  const setUploadedVideoTrimStart = usePatchedField('uploadedVideoTrimStart')
  const setUploadedVideoTrimEnd = usePatchedField('uploadedVideoTrimEnd')
  const setModelFilterProvider = usePatchedField('modelFilterProvider')
  const setModelFilterType = usePatchedField('modelFilterType')
  const setModelFilterFunction = usePatchedField('modelFilterFunction')
  const setFavoriteModels = usePatchedField('favoriteModels')

  const uploadedImages = useMemo(
    () => uploadedPromptImages.map((image) => image.url),
    [uploadedPromptImages],
  )
  const promptReferences = useMemo(
    () => createMediaGeneratorPromptReferences(uploadedPromptImages),
    [uploadedPromptImages],
  )
  const input = useMemo(
    () => toLegacyPromptString(promptDocument, { references: promptReferences }),
    [promptDocument, promptReferences],
  )
  const promptMediaBindings = useMemo<PromptMediaBinding[]>(() => (
    createMediaGeneratorPromptBindings(uploadedPromptImages, uploadedFilePaths)
  ), [uploadedFilePaths, uploadedPromptImages])

  const setUploadedImages: Dispatch<SetStateAction<string[]>> = useGenerationDraftStore(
    (state) => state.patchUploadedImages,
  )
  const setInput = useGenerationDraftStore((state) => state.setLegacyInput)
  const loadPromptCarrier: (carrier: MediaGeneratorPromptCarrier) => void = useGenerationDraftStore(
    (state) => state.loadPromptCarrier,
  )

  // 弹窗渲染统一收在 App 根部的 GlobalAlertDialog，这里只负责发起
  const showAlert = (title: string, message: string, type: 'info' | 'warning' | 'error' = 'warning') =>
    showAlertDialog({ title, message, type })
  useEffect(() => {
    const currentProviders = getAvailableProviders()
    if (currentProviders.length === 0) return

    const isValidSelection = currentProviders.some(
      provider =>
        provider.id === selectedProvider &&
        provider.models.some(model => model.id === selectedModel)
    )

    if (!isValidSelection) {
      const firstProvider = currentProviders[0]
      const firstModel = firstProvider.models[0]
      if (firstModel) {
        setSelectedProvider(firstProvider.id)
        setSelectedModel(firstModel.id)
      }
    }
  }, [providersSignature, selectedProvider, selectedModel, setSelectedProvider, setSelectedModel])

  return {
    input,
    setInput,
    promptDocument,
    setPromptDocument,
    promptReferences,
    promptMediaBindings,
    loadPromptCarrier,
    selectedProvider,
    setSelectedProvider,
    selectedModel,
    setSelectedModel,

    uploadedImages,
    setUploadedImages,
    uploadedFilePaths,
    setUploadedFilePaths,
    uploadedVideos,
    setUploadedVideos,
    uploadedVideoFiles,
    setUploadedVideoFiles,
    uploadedVideoFilePaths,
    setUploadedVideoFilePaths,
    uploadedAudios,
    setUploadedAudios,
    uploadedAudioFilePaths,
    setUploadedAudioFilePaths,
    fileOrder,
    setFileOrder,
    uploadedVideoDuration,
    setUploadedVideoDuration,
    uploadedVideoTrimStart,
    setUploadedVideoTrimStart,
    uploadedVideoTrimEnd,
    setUploadedVideoTrimEnd,

    modelFilterProvider,
    setModelFilterProvider,
    modelFilterType,
    setModelFilterType,
    modelFilterFunction,
    setModelFilterFunction,
    favoriteModels,
    setFavoriteModels,

    showAlert
  }
}

export type UIState = ReturnType<typeof useUIStateValue>

export function useUIState(): UIState {
  return useUIStateValue()
}
