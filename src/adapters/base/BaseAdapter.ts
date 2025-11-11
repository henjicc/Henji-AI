export interface MediaGeneratorAdapter {
  name: string
  generateImage(params: GenerateImageParams): Promise<ImageResult>
  generateVideo(params: GenerateVideoParams): Promise<VideoResult>
  generateAudio(params: GenerateAudioParams): Promise<AudioResult>
  checkStatus(taskId: string): Promise<TaskStatus>
}

export interface GenerateImageParams {
  prompt: string
  model: string
  images?: string[]
  size?: string
  sequential_image_generation?: 'auto' | 'disabled'
  max_images?: number
  watermark?: boolean
  [key: string]: any
}

export interface GenerateVideoParams {
  prompt: string
  model: string
  duration?: number
  [key: string]: any
}

export interface GenerateAudioParams {
  text: string
  model: string
  voiceId?: string
  [key: string]: any
}

export interface ImageResult {
  id?: string
  url: string
  base64Data?: string  // 添加Base64数据字段，用于离线下载和复制
  createdAt?: Date
}

export interface VideoResult {
  taskId?: string
  url?: string
  status?: string
}

export interface AudioResult {
  url: string
  status?: string
}

export interface TaskStatus {
  taskId: string
  status: 'TASK_STATUS_QUEUED' | 'TASK_STATUS_SUCCEEDED' | 'TASK_STATUS_FAILED' | 'TASK_STATUS_PROCESSING'
  progress?: number
  result?: ImageResult | VideoResult | AudioResult
}