import type { ImageEditState } from '@/components/ImageEditor'
import type { MediaResult } from '@/types'

export type MediaType = 'image' | 'video' | 'audio'

export type TaskStatus = 'queued' | 'pending' | 'generating' | 'success' | 'error' | 'timeout'

export interface GeneratorOptions extends Record<string, unknown> {
  size?: string
  images?: string[]
  uploadedFilePaths?: string[]
  videos?: string[]
  uploadedVideoFilePaths?: string[]

  editStateFile?: string

  // 兼容旧模式：内联编辑状态（新逻辑优先使用 editStateFile）
  imageEditStates?: Record<string, ImageEditState>
}

export interface GenerationTask {
  id: string
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
