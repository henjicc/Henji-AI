import type { ImageMarkSession } from '@/features/imageMark'
import type { MediaResult } from '@/types'

export type MediaType = 'image' | 'video' | 'audio'

export type TaskStatus = 'queued' | 'pending' | 'generating' | 'success' | 'error'

export interface GeneratorOptions extends DynamicValueMap {
  size?: string
  images?: string[]
  uploadedFilePaths?: string[]
  videos?: string[]
  uploadedVideoFilePaths?: string[]
  audios?: string[]
  uploadedAudioFilePaths?: string[]

  editStateFile?: string

  // 兼容旧模式：内联编辑状态（新逻辑优先使用 editStateFile;旧数据可能仍是 ImageEditState 形状,读取时统一 coerce）
  imageEditStates?: Record<string, ImageMarkSession>
}

export interface GenerationTask {
  id: string
  createdAt: Date
  type: MediaType
  prompt: string
  model: string
  provider?: string
  status: TaskStatus

  result?: MediaResult
  error?: string
  progress?: number

  images?: string[]
  videos?: string[]
  uploadedFilePaths?: string[]
  uploadedVideoFilePaths?: string[]
  uploadedAudioFilePaths?: string[]
  serverTaskId?: string

  dimensions?: string
  duration?: string

  options?: GeneratorOptions
}

export interface ToastNotification {
  message: string
  type: 'success' | 'error'
}

export interface ProgressStatusLike {
  progress?: number
  message?: string
}
