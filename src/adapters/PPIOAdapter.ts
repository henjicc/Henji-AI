import axios, { AxiosInstance } from 'axios'
import { 
  MediaGeneratorAdapter, 
  GenerateImageParams, 
  GenerateVideoParams, 
  GenerateAudioParams, 
  ImageResult, 
  VideoResult, 
  AudioResult, 
  TaskStatus 
} from './base/BaseAdapter'

export class PPIOAdapter implements MediaGeneratorAdapter {
  name = 'PiaoYun'
  private apiClient: AxiosInstance
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
    this.apiClient = axios.create({
      baseURL: 'https://api.ppinfra.com/v3',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    })
  }

  async generateImage(params: GenerateImageParams): Promise<ImageResult> {
    try {
      // 根据模型选择不同的API端点
      let endpoint = ''
      if (params.model.includes('seedream')) {
        endpoint = '/seedream-4.0'
      } else {
        throw new Error(`Unsupported image model: ${params.model}`)
      }

      // 构建请求数据
      const requestData: any = {
        prompt: params.prompt,
        watermark: false // 默认不添加水印
      }

      // 处理上传的图片
      if (params.images && params.images.length > 0) {
        requestData.images = params.images
      }

      // 处理分辨率设置
      if (params.size) {
        requestData.size = params.size
      }

      // 处理即梦图片生成4.0的特定参数
      if (params.model === 'seedream-4.0') {
        if (params.sequential_image_generation !== undefined) {
          requestData.sequential_image_generation = params.sequential_image_generation
        }
        
        if (params.max_images !== undefined) {
          requestData.max_images = params.max_images
        }
        
        if (params.watermark !== undefined) {
          requestData.watermark = params.watermark
        }
      }

      const response = await this.apiClient.post(endpoint, requestData)

      if (response.data.images && response.data.images.length > 0) {
        // 返回所有图片URL，用分隔符连接
        return {
          url: response.data.images.join('|||'),
          createdAt: new Date()
        }
      } else {
        throw new Error('No image returned from API')
      }
    } catch (error) {
      throw this.handleError(error)
    }
  }

  async generateVideo(params: GenerateVideoParams): Promise<VideoResult> {
    try {
      // 根据模型选择不同的API端点
      let endpoint = ''
      if (params.model.includes('vidu')) {
        endpoint = '/async/vidu-q1-text2video'
      } else {
        throw new Error(`Unsupported video model: ${params.model}`)
      }

      const response = await this.apiClient.post(endpoint, {
        prompt: params.prompt,
        duration: params.duration || 5,
        aspect_ratio: '16:9'
      })

      if (response.data.task_id) {
        return {
          taskId: response.data.task_id,
          status: 'TASK_STATUS_QUEUED'
        }
      } else {
        throw new Error('No task ID returned from API')
      }
    } catch (error) {
      throw this.handleError(error)
    }
  }

  async generateAudio(params: GenerateAudioParams): Promise<AudioResult> {
    try {
      const endpoint = '/minimax-speech-02-hd'
      
      const response = await this.apiClient.post(endpoint, {
        text: params.text,
        stream: false,
        output_format: 'url',
        voice_setting: {
          voice_id: params.voiceId || 'male-qn-jingying'
        }
      })

      if (response.data.audio) {
        return {
          url: response.data.audio
        }
      } else {
        throw new Error('No audio returned from API')
      }
    } catch (error) {
      throw this.handleError(error)
    }
  }

  async checkStatus(taskId: string): Promise<TaskStatus> {
    try {
      const response = await this.apiClient.get('/async/task-result', {
        params: { task_id: taskId }
      })

      const taskData = response.data.task
      const result: TaskStatus = {
        taskId: taskData.task_id,
        status: taskData.status
      }

      // 如果任务成功，添加结果数据
      if (taskData.status === 'TASK_STATUS_SUCCEEDED') {
        if (response.data.images && response.data.images.length > 0) {
          result.result = {
            url: response.data.images[0].image_url
          } as ImageResult
        } else if (response.data.videos && response.data.videos.length > 0) {
          result.result = {
            url: response.data.videos[0].video_url
          } as VideoResult
        } else if (response.data.audios && response.data.audios.length > 0) {
          result.result = {
            url: response.data.audios[0].audio_url
          } as AudioResult
        }
      }

      // 添加进度信息（如果可用）
      if (taskData.progress_percent !== undefined) {
        result.progress = taskData.progress_percent
      }

      return result
    } catch (error) {
      throw this.handleError(error)
    }
  }

  private handleError(error: any): Error {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        const status = error.response.status
        const message = error.response.data?.message || error.response.statusText
        return new Error(`API Error ${status}: ${message}`)
      } else if (error.request) {
        return new Error('Network error: No response received from server')
      }
    }
    return new Error(`Unexpected error: ${error.message || 'Unknown error'}`)
  }
}