import axios, { AxiosInstance } from 'axios'
import { saveVideoFromUrl, fileToBlobSrc } from '@/utils/save'
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
      // 输出日志方便调试
      console.log('[PPIOAdapter] generateVideo 调用参数:', params)

      let endpoint = ''
      const requestData: any = {
        prompt: params.prompt,
        duration: params.duration || 5,
        resolution: params.resolution || '1080p',
        seed: params.seed,
        movement_amplitude: params.movementAmplitude || 'auto',
        bgm: params.bgm || false
      }

      // 根据模型和模式选择API端点
      if (params.model.includes('vidu-q1')) {
        const mode = params.mode || 'text-image-to-video'
        const images = params.images || []

        console.log('[PPIOAdapter] 选择的模式:', mode)
        console.log('[PPIOAdapter] 图片数量:', images.length)

        switch (mode) {
          case 'text-image-to-video':
            // 文/图生视频：根据是否有图片选择端点
            if (images.length > 0) {
              endpoint = '/async/vidu-q1-img2video'
              requestData.images = [images[0]] // 只取第一张图片
              // 图生视频不支持 aspect_ratio 和 style
              console.log('[PPIOAdapter] 使用图生视频接口')
            } else {
              endpoint = '/async/vidu-q1-text2video'
              requestData.aspect_ratio = params.aspectRatio || '16:9'
              requestData.style = params.style || 'general'
              console.log('[PPIOAdapter] 使用文生视频接口')
            }
            break

          case 'start-end-frame':
            // 首尾帧：需要2张图片
            if (images.length < 2) {
              throw new Error('首尾帧模式需要至少2张图片')
            }
            endpoint = '/async/vidu-q1-startend2video'
            requestData.images = [images[0], images[1]] // 取前两张作为首尾帧
            // 首尾帧不支持 aspect_ratio 和 style
            console.log('[PPIOAdapter] 使用首尾帧接口')
            break

          case 'reference-to-video':
            // 参考生视频：需要1-7张图片且prompt必须
            if (images.length < 1 || images.length > 7) {
              throw new Error('参考生视频模式需要1-7张图片')
            }
            if (!params.prompt || params.prompt.trim() === '') {
              throw new Error('参考生视频模式必须提供文本提示词')
            }
            endpoint = '/async/vidu-q1-reference2video'
            requestData.images = images.slice(0, 7) // 最多取7张
            requestData.aspect_ratio = params.aspectRatio || '16:9'
            // 参考生视频不支持 style
            console.log('[PPIOAdapter] 使用参考生视频接口')
            break

          default:
            throw new Error(`Unsupported video mode: ${mode}`)
        }
      } else {
        throw new Error(`Unsupported video model: ${params.model}`)
      }

      console.log('[PPIOAdapter] API端点:', endpoint)
      console.log('[PPIOAdapter] 请求数据:', requestData)

      const response = await this.apiClient.post(endpoint, requestData)

      console.log('[PPIOAdapter] API响应:', response.data)

      if (response.data.task_id) {
        return {
          taskId: response.data.task_id,
          status: 'TASK_STATUS_QUEUED'
        }
      } else {
        throw new Error('No task ID returned from API')
      }
    } catch (error) {
      console.error('[PPIOAdapter] generateVideo 错误:', error)
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
      console.log('[PPIOAdapter] 查询任务状态:', taskId)
      
      const response = await this.apiClient.get('/async/task-result', {
        params: { task_id: taskId }
      })

      console.log('[PPIOAdapter] 任务状态响应:', response.data)

      const taskData = response.data.task
      const result: TaskStatus = {
        taskId: taskData.task_id,
        status: taskData.status
      }

      // 注意：API返回的是 TASK_STATUS_SUCCEED，不是 TASK_STATUS_SUCCEEDED
      // 如果任务成功，添加结果数据
      if (taskData.status === 'TASK_STATUS_SUCCEEDED' || taskData.status === 'TASK_STATUS_SUCCEED') {
        if (response.data.images && response.data.images.length > 0) {
          result.result = {
            url: response.data.images[0].image_url
          } as ImageResult
          console.log('[PPIOAdapter] 图片生成成功:', result.result.url)
        } else if (response.data.videos && response.data.videos.length > 0) {
          const videoUrl = response.data.videos[0].video_url
          result.result = {
            url: videoUrl
          } as VideoResult
          console.log('[PPIOAdapter] 视频生成成功:', videoUrl)
          
          // 尝试保存到本地文件系统并生成显示用的 blob URL
          try {
            console.log('[PPIOAdapter] 开始保存视频到本地...')
            const { fullPath } = await saveVideoFromUrl(videoUrl)
            const blobSrc = await fileToBlobSrc(fullPath)
            result.result.url = blobSrc
            console.log('[PPIOAdapter] 视频已保存到本地并生成显示地址')
          } catch (e) {
            console.error('[PPIOAdapter] 视频本地保存失败，回退为远程URL', e)
          }
        } else if (response.data.audios && response.data.audios.length > 0) {
          result.result = {
            url: response.data.audios[0].audio_url
          } as AudioResult
          console.log('[PPIOAdapter] 音频生成成功:', result.result.url)
        }
      } else if (taskData.status === 'TASK_STATUS_FAILED') {
        console.error('[PPIOAdapter] 任务失败:', taskData.reason)
      } else if (taskData.status === 'TASK_STATUS_PROCESSING' || taskData.status === 'TASK_STATUS_QUEUED') {
        console.log('[PPIOAdapter] 任务进度:', {
          status: taskData.status,
          progress: taskData.progress_percent,
          eta: taskData.eta
        })
      }

      // 添加进度信息（如果可用）
      if (taskData.progress_percent !== undefined) {
        result.progress = taskData.progress_percent
      }

      return result
    } catch (error) {
      console.error('[PPIOAdapter] checkStatus 错误:', error)
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
