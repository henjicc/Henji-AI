import type { FileOrderItem } from '@/components/MediaGenerator/components/InputArea'
import type { MediaGeneratorPromptImage } from '@/components/MediaGenerator/promptState'
import { parseLegacyPromptString, type PromptDocumentV1 } from '@/core/inputs/promptDocument'

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
 * 空草稿不选模型。模型目录在应用启动后才异步加载，而草稿 store 在模块加载时就要初值，
 * 此时读注册表只会拿到空表，还会让每个导入生成入口的模块都被迫备好注册表；
 * “默认选中第一个可用模型”由生成页 useUIState 在模型目录就绪后补上。
 */
export function createEmptyGenerationDraft(): GenerationDraft {
  return {
    promptDocument: parseLegacyPromptString(''),
    selectedProvider: '',
    selectedModel: '',
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
