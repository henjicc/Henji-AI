import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { FileOrderItem } from '../components/InputArea'
import { getAvailableProviders } from '@/utils/modelHelpers'
import { showAlertDialog } from '@/stores/alertDialogStore'
import {
  compactPromptMediaReferenceSpacing,
  parseLegacyPromptString,
  toLegacyPromptString,
  type PromptDocumentV1,
  type PromptMediaBinding,
} from '@/core/inputs/promptDocument'
import {
  createMediaGeneratorPromptBindings,
  createMediaGeneratorPromptReferences,
  reconcileMediaGeneratorPromptImages,
  resolveMediaGeneratorPromptCarrier,
  type MediaGeneratorPromptCarrier,
  type MediaGeneratorPromptImage,
} from '../promptState'
/**
 * 纯 UI 状态管理（不包含模型参数）
 * 职责：管理界面交互状态
 */
function useUIStateValue() {
  const providersSnapshot = getAvailableProviders()
  const providersSignature = providersSnapshot.map(p => `${p.id}:${p.models.map(m => m.id).join(',')}`).join('|')
  const defaultSelection = (providersSnapshot[0] && providersSnapshot[0].models[0])
    ? { providerId: providersSnapshot[0].id, modelId: providersSnapshot[0].models[0].id }
    : { providerId: '', modelId: '' }

  const [promptDocument, setPromptDocument] = useState<PromptDocumentV1>(() => (
    parseLegacyPromptString('')
  ))
  const [selectedProvider, setSelectedProvider] = useState(defaultSelection.providerId)
  const [selectedModel, setSelectedModel] = useState(defaultSelection.modelId)
  const [uploadedPromptImages, setUploadedPromptImages] = useState<MediaGeneratorPromptImage[]>([])
  const [uploadedFilePaths, setUploadedFilePaths] = useState<string[]>([])
  const [uploadedVideos, setUploadedVideos] = useState<string[]>([])
  const [uploadedVideoFiles, setUploadedVideoFiles] = useState<File[]>([])
  const [uploadedVideoFilePaths, setUploadedVideoFilePaths] = useState<string[]>([])
  const [uploadedAudios, setUploadedAudios] = useState<string[]>([])
  const [uploadedAudioFilePaths, setUploadedAudioFilePaths] = useState<string[]>([])
  const [fileOrder, setFileOrder] = useState<FileOrderItem[]>([])
  const [uploadedVideoDuration, setUploadedVideoDuration] = useState(0)
  // 裁剪窗口选中的 [start, end]（秒）：只是附加在完整视频上的元数据，不替换 uploadedVideoFilePaths；
  // null 表示尚未裁剪过（生成时直接用完整视频）
  const [uploadedVideoTrimStart, setUploadedVideoTrimStart] = useState<number | null>(null)
  const [uploadedVideoTrimEnd, setUploadedVideoTrimEnd] = useState<number | null>(null)

  const [modelFilterProvider, setModelFilterProvider] = useState<string>('all')
  const [modelFilterType, setModelFilterType] = useState<'all' | 'favorite' | 'image' | 'video' | 'audio'>('all')
  const [modelFilterFunction, setModelFilterFunction] = useState<string>('all')
  const [favoriteModels, setFavoriteModels] = useState<Set<string>>(new Set())

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

  const setUploadedImages: Dispatch<SetStateAction<string[]>> = useCallback((action) => {
    setUploadedPromptImages((current) => {
      const currentUrls = current.map((image) => image.url)
      const nextUrls = typeof action === 'function' ? action(currentUrls) : action
      return reconcileMediaGeneratorPromptImages(current, nextUrls)
    })
  }, [])

  const setInput = useCallback((legacyText: string): void => {
    setPromptDocument(compactPromptMediaReferenceSpacing(
      parseLegacyPromptString(legacyText, { references: promptReferences }),
    ))
  }, [promptReferences])

  const loadPromptCarrier = useCallback((carrier: MediaGeneratorPromptCarrier): void => {
    const resolved = resolveMediaGeneratorPromptCarrier(carrier)
    setUploadedPromptImages(resolved.images)
    setPromptDocument(resolved.document)
  }, [])

  const promptMediaBindings = useMemo<PromptMediaBinding[]>(() => (
    createMediaGeneratorPromptBindings(uploadedPromptImages, uploadedFilePaths)
  ), [uploadedFilePaths, uploadedPromptImages])

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
  }, [providersSignature, selectedProvider, selectedModel])

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
