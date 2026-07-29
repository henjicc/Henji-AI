import { useEffect } from 'react'
import { useModelParams } from '@/hooks/useModelParams'
import type { UIState } from './useUIState'

/**
 * 模型参数状态管理（使用新系统）
 * 职责：管理当前模型的动态参数
 * 文件大小: < 150 行
 */
export const useModelState = (modelId: string, uiState: UIState) => {
  // 使用新系统的参数管理
  const {
    params,
    setParam,
    setParams,
    resetParams,
    resetParam,
    getFilteredOptions,
    getParamDef,
    validateParam,
    schema,
    defaults
  } = useModelParams(modelId)

  // 将上传的图片同步到参数中（供联动使用）
  useEffect(() => {
    setParam('uploadedImages', uiState.uploadedImages)
  }, [uiState.uploadedImages, setParam])

  // 将上传的视频同步到参数中（供联动使用）
  useEffect(() => {
    setParam('uploadedVideos', uiState.uploadedVideos)
  }, [uiState.uploadedVideos, setParam])

  // 将上传视频时长同步到参数中（供联动使用）
  useEffect(() => {
    setParam('uploadedVideoDuration', uiState.uploadedVideoDuration)
  }, [uiState.uploadedVideoDuration, setParam])

  return {
    // 参数状态
    params,

    // 参数操作
    setParam,
    setParams,
    resetParams,
    resetParam,

    // 参数查询
    getFilteredOptions,
    getParamDef,
    validateParam,

    // Schema 和默认值
    schema,
    defaults
  }
}

export type ModelState = ReturnType<typeof useModelState>
