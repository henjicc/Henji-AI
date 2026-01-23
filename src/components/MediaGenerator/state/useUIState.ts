import { useState } from 'react'
import { FileOrderItem } from '../components/InputArea'

/**
 * 纯 UI 状态管理（不包含模型参数）
 * 职责：管理界面交互状态
 * 文件大小: < 100 行
 */
export const useUIState = () => {
  // 基础 UI 状态
  const [input, setInput] = useState('')
  const [selectedProvider, setSelectedProvider] = useState('ppio')
  const [selectedModel, setSelectedModel] = useState('seedream-4.0')

  // 文件上传状态
  const [uploadedImages, setUploadedImages] = useState<string[]>([])
  const [uploadedFilePaths, setUploadedFilePaths] = useState<string[]>([])
  const [uploadedVideos, setUploadedVideos] = useState<string[]>([])
  const [uploadedVideoFiles, setUploadedVideoFiles] = useState<File[]>([])
  const [uploadedVideoFilePaths, setUploadedVideoFilePaths] = useState<string[]>([])
  const [fileOrder, setFileOrder] = useState<FileOrderItem[]>([])
  const [uploadedVideoDuration, setUploadedVideoDuration] = useState(0)

  // 模型筛选状态
  const [modelFilterProvider, setModelFilterProvider] = useState<string>('all')
  const [modelFilterType, setModelFilterType] = useState<'all' | 'favorite' | 'image' | 'video' | 'audio'>('all')
  const [modelFilterFunction, setModelFilterFunction] = useState<string>('all')
  const [favoriteModels, setFavoriteModels] = useState<Set<string>>(new Set())

  // 弹窗状态
  const [alertDialog, setAlertDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'warning' as 'info' | 'warning' | 'error'
  })

  // 显示提示弹窗的函数
  const showAlert = (title: string, message: string, type: 'info' | 'warning' | 'error' = 'warning') => {
    setAlertDialog({ isOpen: true, title, message, type })
  }

  return {
    // 基础状态
    input,
    setInput,
    selectedProvider,
    setSelectedProvider,
    selectedModel,
    setSelectedModel,

    // 文件上传状态
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
    fileOrder,
    setFileOrder,
    uploadedVideoDuration,
    setUploadedVideoDuration,

    // 模型筛选状态
    modelFilterProvider,
    setModelFilterProvider,
    modelFilterType,
    setModelFilterType,
    modelFilterFunction,
    setModelFilterFunction,
    favoriteModels,
    setFavoriteModels,

    // 弹窗状态
    alertDialog,
    setAlertDialog,
    showAlert
  }
}

export type UIState = ReturnType<typeof useUIState>
