import { AxiosInstance } from 'axios'
import { TaskStatus, VideoResult } from '../base/BaseAdapter'
import { parseVideoResponse } from './parsers'

/**
 * Fal 状态处理器
 * 负责任务状态查询
 */
export class FalStatusHandler {
  constructor(
    private apiClient: AxiosInstance,
    private adapter: any
  ) {}

  /**
   * 检查任务状态
   * taskId 格式为 "modelId:requestId"
   */
  async checkStatus(taskId: string): Promise<TaskStatus> {
    // 解析 taskId
    const [modelId, requestId] = taskId.split(':')
    if (!modelId || !requestId) {
      throw new Error('Invalid taskId format. Expected "modelId:requestId"')
    }

    const statusUrl = `/${modelId}/requests/${requestId}/status`
    const response = await this.apiClient.get(statusUrl)
    const { status } = response.data

    // 如果状态是 COMPLETED，直接获取结果
    if (status === 'COMPLETED') {
      const resultResponse = await this.apiClient.get(`/${modelId}/requests/${requestId}`)
      const result = await parseVideoResponse(resultResponse.data, this.adapter)

      return {
        taskId,
        status: 'TASK_STATUS_SUCCEED', // 转换为统一的状态格式
        result: result as VideoResult
      }
    }

    // 转换其他状态为统一格式
    let unifiedStatus: string
    switch (status) {
      case 'IN_QUEUE':
      case 'IN_PROGRESS':
        unifiedStatus = 'TASK_STATUS_PROCESSING'
        break
      case 'FAILED':
        unifiedStatus = 'TASK_STATUS_FAILED'
        break
      default:
        unifiedStatus = status as string
    }

    return {
      taskId,
      status: unifiedStatus as any,
      result: undefined
    }
  }
}
