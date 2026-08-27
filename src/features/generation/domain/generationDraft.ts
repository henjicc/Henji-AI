import type { FileOrderItem } from '@/components/MediaGenerator/components/InputArea'
import type { MediaGeneratorPromptImage } from '@/components/MediaGenerator/promptState'
import { parseLegacyPromptString, type PromptDocumentV1 } from '@/core/inputs/promptDocument'
import { getAvailableProviders } from '@/utils/modelHelpers'

/*
 * 生成页输入态的纯领域层（5.1）。这里只有类型和纯函数，不 import React——
 * useUIState.ts 是这个模块唯一的消费方，负责把它接进 useState/useCallback。
 *
 * 18 项字段对应 useUIState.ts 迁移前的 18 个独立 useState（详细清单见 5.1 执行记录）。
 * 部分导出值（uploadedImages/promptReferences/input/promptMediaBindings）是从这 18 项
 * 派生出来的 useMemo，不进 draft——它们的计算逻辑保持不变，只是依赖字段从 draft 上取。
 */
export type GenerationModelFilterType = 'all' | 'favorite' | 'image' | 'video' | 'audio' | 'other'

export interface GenerationDraft {
  promptDocument: PromptDocumentV1
  selectedProvider: string
  selectedModel: string
  uploadedPromptImages: MediaGeneratorPromptImage[]
  uploadedFilePaths: string[]
  uploadedVideos: string[]
  uploadedVideoFiles: File[]
  uploadedVideoFilePaths: string[]
  uploadedAudios: string[]
  uploadedAudioFilePaths: string[]
  fileOrder: FileOrderItem[]
  uploadedVideoDuration: number
  /** 裁剪窗口选中的起点（秒）；null 表示尚未裁剪过，生成时直接用完整视频 */
  uploadedVideoTrimStart: number | null
  uploadedVideoTrimEnd: number | null
  modelFilterProvider: string
  modelFilterType: GenerationModelFilterType
  modelFilterFunction: string
  favoriteModels: Set<string>
}

/**
 * 默认选中项与原实现一致：取模型注册中心里第一个供应商的第一个模型。
 * 依赖 getAvailableProviders() 而不是纯常量，是为了不改变原来"打开生成页就选中
 * 第一个可用模型"的行为——这不是严格意义上的纯函数，但迁移前 useUIState 的
 * useState 初始值本来就是这样算出来的，行为等价性优先于教科书式的纯度。
 */
export function createEmptyGenerationDraft(): GenerationDraft {
  const providers = getAvailableProviders()
  const defaultProvider = providers[0]
  const defaultModel = defaultProvider?.models[0]

  return {
    promptDocument: parseLegacyPromptString(''),
    selectedProvider: defaultModel ? defaultProvider.id : '',
    selectedModel: defaultModel ? defaultModel.id : '',
    uploadedPromptImages: [],
    uploadedFilePaths: [],
    uploadedVideos: [],
    uploadedVideoFiles: [],
    uploadedVideoFilePaths: [],
    uploadedAudios: [],
    uploadedAudioFilePaths: [],
    fileOrder: [],
    uploadedVideoDuration: 0,
    uploadedVideoTrimStart: null,
    uploadedVideoTrimEnd: null,
    modelFilterProvider: 'all',
    modelFilterType: 'all',
    modelFilterFunction: 'all',
    favoriteModels: new Set(),
  }
}

/** 不可变更新：返回一个新对象，patch 里没提到的字段原样保留。 */
export function applyGenerationDraftPatch(
  draft: GenerationDraft,
  patch: Partial<GenerationDraft>,
): GenerationDraft {
  return { ...draft, ...patch }
}
