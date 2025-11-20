export interface MediaGeneratorAdapter {
  name: string
  generateImage(params: GenerateImageParams): Promise<ImageResult>
  generateVideo(params: GenerateVideoParams): Promise<VideoResult>
  generateAudio(params: GenerateAudioParams): Promise<AudioResult>
  checkStatus(taskId: string): Promise<TaskStatus>
}

export interface ProgressStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED'
  queue_position?: number
  message?: string
}

export interface GenerateImageParams {
  prompt: string
  model: string
  model_id?: string  // 用于区分不同的 fal 模型（nano-banana vs nano-banana-pro）
  images?: string[]
  size?: string
  sequential_image_generation?: 'auto' | 'disabled'
  max_images?: number
  watermark?: boolean
  num_images?: number  // fal 模型的图片数量参数
  aspect_ratio?: string  // fal 模型的宽高比参数
  resolution?: string  // nano-banana-pro 的分辨率参数
  onProgress?: (status: ProgressStatus) => void  // 进度回调（用于队列 API）
  [key: string]: any
}

export interface GenerateVideoParams {
  prompt: string
  model: string
  duration?: number
  mode?: 'text-image-to-video' | 'start-end-frame' | 'reference-to-video'
  images?: string[]
  aspectRatio?: string
  resolution?: string
  style?: string
  seed?: number
  movementAmplitude?: string
  bgm?: boolean
  negativePrompt?: string
  cfgScale?: number
  fastMode?: boolean
  cameraFixed?: boolean
  lastImage?: string
  size?: string
  promptExtend?: boolean
  watermark?: boolean
  audio?: boolean
  audioUrl?: string
  imageUrl?: string
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
  // 超时恢复支持
  status?: 'completed' | 'timeout'  // 任务状态
  requestId?: string  // fal 队列请求ID（用于继续查询）
  modelId?: string    // fal 模型ID（用于继续查询）
  message?: string    // 状态消息
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
  status: 'TASK_STATUS_QUEUED' | 'TASK_STATUS_SUCCEEDED' | 'TASK_STATUS_SUCCEED' | 'TASK_STATUS_FAILED' | 'TASK_STATUS_PROCESSING'
  progress?: number
  result?: ImageResult | VideoResult | AudioResult
}
