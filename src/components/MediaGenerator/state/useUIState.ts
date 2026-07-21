import { useEffect, useState } from 'react'
import { FileOrderItem } from '../components/InputArea'
import { getAvailableProviders } from '@/utils/modelHelpers'
/**
 * 纯 UI 状态管理（不包含模型参数）
 * 职责：管理界面交互状态
 * 文件大小: < 100 行
 */
export const useUIState = () => {
  const providersSnapshot = getAvailableProviders()
  const providersSignature = providersSnapshot.map(p => `${p.id}:${p.models.map(m => m.id).join(',')}`).join('|')
  const defaultSelection = (providersSnapshot[0] && providersSnapshot[0].models[0])
    ? { providerId: providersSnapshot[0].id, modelId: providersSnapshot[0].models[0].id }
    : { providerId: '', modelId: '' }

  const [input, setInput] = useState('')
  const [selectedProvider, setSelectedProvider] = useState(defaultSelection.providerId)
  const [selectedModel, setSelectedModel] = useState(defaultSelection.modelId)
  const [uploadedImages, setUploadedImages] = useState<string[]>([])
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

  const [alertDialog, setAlertDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'warning' as 'info' | 'warning' | 'error'
  })

  const showAlert = (title: string, message: string, type: 'info' | 'warning' | 'error' = 'warning') =>
    setAlertDialog({ isOpen: true, title, message, type })
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

    alertDialog,
    setAlertDialog,
    showAlert
  }
}

export type UIState = ReturnType<typeof useUIState>
