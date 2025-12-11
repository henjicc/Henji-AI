import { PPIO_CONFIG } from './config'
import { AxiosInstance } from 'axios'
import { TaskStatus, VideoResult, ProgressStatus } from '../base/BaseAdapter'
import { parseImageResponse, parseVideoResponse, parseAudioResponse } from './parsers'
import { pollUntilComplete } from '@/utils/polling'
import { getExpectedPolls } from '@/utils/modelConfig'
import { logError, logWarning, logInfo } from '../../utils/errorLogger'

/**
 * 派欧云状态管理器
 * 负责任务状态查询和轮询
 */
export class PPIOStatusHandler {
  constructor(
    private apiClient: AxiosInstance,
    private adapter: any
  ) {}

  /**
   * 检查任务状态
   */
  async checkStatus(taskId: string): Promise<TaskStatus> {
    logInfo('[PPIOStatusHandler] 查询任务状态:', taskId)

    const response = await this.apiClient.get(PPIO_CONFIG.statusEndpoint, {
      params: { task_id: taskId }
    })

    logInfo('[PPIOStatusHandler] 任务状态响应:', response.data)

    const taskData = response.data.task
    const result: TaskStatus = {
      taskId: taskData.task_id,
      status: taskData.status
    }

    // 注意：API返回的是 TASK_STATUS_SUCCEED，不是 TASK_STATUS_SUCCEEDED
    // 如果任务成功，添加结果数据
    if (taskData.status === 'TASK_STATUS_SUCCEEDED' || taskData.status === 'TASK_STATUS_SUCCEED') {
      if (response.data.images && response.data.images.length > 0) {
        result.result = await parseImageResponse(response.data)
        logInfo('[PPIOStatusHandler] 图片生成成功:', result.result.url)
      } else if (response.data.videos && response.data.videos.length > 0) {
        result.result = await parseVideoResponse(response.data, this.adapter)
        this.adapter.log('视频生成成功:', result.result.url)
      } else if (response.data.audios && response.data.audios.length > 0) {
        result.result = await parseAudioResponse(response.data)
        logInfo('[PPIOStatusHandler] 音频生成成功:', result.result.url)
      }
    } else if (taskData.status === 'TASK_STATUS_FAILED') {
      logError('[PPIOStatusHandler] 任务失败:', taskData.reason)
    } else if (taskData.status === 'TASK_STATUS_PROCESSING' || taskData.status === 'TASK_STATUS_QUEUED') {
      logInfo('[PPIOStatusHandler] 任务进度:', {
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
  }

  /**
   * 轮询任务状态直到完成
   */
  async pollTaskStatus(
    taskId: string,
    modelId: string,
    onProgress?: (status: ProgressStatus) => void
  ): Promise<VideoResult> {
    const estimatedPolls = getExpectedPolls(modelId)

    logInfo('[PPIOStatusHandler] 开始轮询:', { taskId, modelId, estimatedPolls })

    const result = await pollUntilComplete<VideoResult>({
      checkFn: async () => {
        const status = await this.checkStatus(taskId)
        return {
          status: status.status,
          result: status.result as VideoResult | undefined
        }
      },
      isComplete: (status) => status === 'TASK_STATUS_SUCCEED' || status === 'TASK_STATUS_SUCCEEDED',
      isFailed: (status) => status === 'TASK_STATUS_FAILED',
      onProgress: (progress, status) => {
        if (onProgress) {
          let message = '生成中...'
          if (status === 'TASK_STATUS_QUEUED') {
            message = '排队中...'
          } else if (status === 'TASK_STATUS_PROCESSING') {
            message = '正在生成...'
          }

          onProgress({
            status: status as any,
            progress,
            message
          })
        }
      },
      interval: PPIO_CONFIG.pollInterval,
      maxAttempts: PPIO_CONFIG.maxPollAttempts,
      estimatedAttempts: estimatedPolls
    })

    return result
  }
}
